import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { tmpdir } from "node:os";
import { AiEditPolicy, defaultAiWritePolicy } from "../src/activity/aiEditProtocol";
import { AiEditSpool } from "../src/activity/aiEditSpool";
import { AiEditBridgeServer } from "../src/activity/AiEditBridgeServer";
import { DiskStore, executeAiNoteCommand } from "../scripts/ai-note-write";
import { respond } from "../scripts/ai-note-mcp";

function sha256(text: string): string {
	return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function makeTempVault() {
	const root = fs.mkdtempSync(path.join(tmpdir(), "cg-ai-hardening-"));
	const vault = path.join(root, "vault");
	const spool = path.join(root, "spool");
	fs.mkdirSync(path.join(vault, "临床医学"), { recursive: true });
	fs.mkdirSync(spool, { recursive: true });
	const policy: AiEditPolicy = {
		version: 1,
		enabled: true,
		generation: "initial",
		trackedFolders: ["临床医学"],
		trackedFiles: [],
		excludeWhitespace: true,
		excludeMarkdownFormatting: false,
		statisticsFolder: "Template/数据/学习统计",
		pluginVersion: "0.29.5",
		writePolicy: defaultAiWritePolicy("collection-scope"),
	};
	return {
		root,
		vault,
		spool,
		policy,
		writePolicy(p: AiEditPolicy = policy) {
			fs.writeFileSync(path.join(spool, "policy.json"), JSON.stringify(p), "utf8");
		},
		cleanup() {
			fs.rmSync(root, { recursive: true, force: true });
		},
	};
}

describe("DiskStore & MCP hardening", () => {
	it("supports cold-start read without policy.json, and blocks writes with POLICY_MISSING", async () => {
		const env = makeTempVault();
		try {
			fs.writeFileSync(path.join(env.vault, "临床医学", "内科学.md"), "# 内科学\n正文\n", "utf8");
			const input = { vault: env.vault, source: "codex", "spool-root": env.spool };
			const readRes = await executeAiNoteCommand(input, "read_note", { path: "临床医学/内科学.md" }) as any;
			expect(readRes.ok).toBe(true);
			expect(readRes.policyMissing).toBe(true);
			expect(readRes.writable).toBe(false);
			expect(readRes.writeDeniedCode).toBe("POLICY_MISSING");

			await expect(executeAiNoteCommand(input, "patch_note", {
				path: "临床医学/内科学.md",
				beforeSha256: readRes.beforeSha256,
				edits: [{ oldText: "正文", newText: "新版正文" }],
			})).rejects.toMatchObject({ code: "POLICY_MISSING", noteModified: false });
		} finally {
			env.cleanup();
		}
	});

	it("patches notes with pre-write backups, restores backups, stages temp outside vault, and writes audit log", async () => {
		const env = makeTempVault();
		try {
			env.writePolicy();
			const noteFile = path.join(env.vault, "临床医学", "内科学.md");
			const initial = "---\r\ntitle: 内科学\r\n---\r\n# 章节\r\n旧段落\r\n![[fig.png]]\r\n";
			fs.writeFileSync(noteFile, initial, "utf8");

			const input = { vault: env.vault, source: "antigravity", "spool-root": env.spool };
			const readRes = await executeAiNoteCommand(input, "read_note", { path: "临床医学/内科学.md" }) as any;
			expect(readRes.writable).toBe(true);
			expect(readRes.eol).toBe("crlf");

			const patchRes = await executeAiNoteCommand(input, "patch_note", {
				path: "临床医学/内科学.md",
				beforeSha256: readRes.beforeSha256,
				edits: [{ oldText: "旧段落", newText: "修订后的段落" }],
			}) as any;
			expect(patchRes.noteStatus).toBe("committed");
			expect(patchRes.statisticsStatus).toBe("queued");
			expect(patchRes.backupId).toBeTruthy();

			const updatedDisk = fs.readFileSync(noteFile, "utf8");
			expect(updatedDisk).toBe("---\r\ntitle: 内科学\r\n---\r\n# 章节\r\n修订后的段落\r\n![[fig.png]]\r\n");
			// No temporary files left inside vault directory
			expect(fs.readdirSync(path.join(env.vault, "临床医学"))).toEqual(["内科学.md"]);

			// List backups and restore
			const listRes = await executeAiNoteCommand(input, "list_note_backups", { path: "临床医学/内科学.md" }) as any;
			expect(listRes.backups.length).toBe(1);
			expect(listRes.backups[0].id).toBe(patchRes.backupId);

			const restoreRes = await executeAiNoteCommand(input, "restore_note_backup", {
				backupId: patchRes.backupId,
				beforeSha256: patchRes.afterSha256,
			}) as any;
			expect(restoreRes.noteStatus).toBe("committed");
			expect(fs.readFileSync(noteFile, "utf8")).toBe(initial);

			// Audit log recorded without note body
			const auditLines = fs.readFileSync(path.join(env.spool, "audit.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
			expect(auditLines.length).toBe(2);
			expect(auditLines[0].operation).toBe("patch");
			expect(auditLines[1].operation).toBe("restore");
			expect(JSON.stringify(auditLines)).not.toContain("修订后的段落");
		} finally {
			env.cleanup();
		}
	});

	it("reclaims stale .lock and stale .lock.recovery files instead of deadlocking forever", async () => {
		const env = makeTempVault();
		try {
			env.writePolicy();
			const noteFile = path.join(env.vault, "临床医学", "锁测试.md");
			fs.writeFileSync(noteFile, "初版", "utf8");

			const realNote = fs.realpathSync(noteFile);
			const lockHash = sha256(process.platform === "win32" ? realNote.toLowerCase() : realNote);
			const locksDir = path.join(env.spool, "locks");
			fs.mkdirSync(locksDir, { recursive: true });
			const lockPath = path.join(locksDir, `${lockHash}.lock`);
			const recoveryPath = `${lockPath}.recovery`;

			// Simulate a crashed process that left both .lock and .lock.recovery behind with dead PID + old timestamp
			const stalePayload = JSON.stringify({ pid: 99999999, token: "dead", startedAt: Date.now() - 120_000 });
			fs.writeFileSync(lockPath, stalePayload, "utf8");
			fs.writeFileSync(recoveryPath, stalePayload, "utf8");
			const past = new Date(Date.now() - 120_000);
			fs.utimesSync(lockPath, past, past);
			fs.utimesSync(recoveryPath, past, past);

			const store = new DiskStore(env.vault, env.spool);
			const committed = await store.commitNote("临床医学/锁测试.md", "新版", sha256("初版"));
			expect(committed.content).toBe("新版");
			expect(fs.existsSync(lockPath)).toBe(false);
			expect(fs.existsSync(recoveryPath)).toBe(false);
		} finally {
			env.cleanup();
		}
	});

	it("deduplicates duplicate receipts and quarantines corrupt/expired receipts asynchronously in AiEditSpool", async () => {
		const env = makeTempVault();
		try {
			const noteFile = path.join(env.vault, "临床医学", "回执.md");
			fs.writeFileSync(noteFile, "已落盘内容", "utf8");
			const afterDigest = sha256("已落盘内容");
			const receiptsDir = path.join(env.spool, "receipts");
			fs.mkdirSync(receiptsDir, { recursive: true });

			const now = 1_800_000_000_000;
			const id1 = crypto.randomUUID();
			const id2 = crypto.randomUUID();
			const expiredId = crypto.randomUUID();
			const corruptId = crypto.randomUUID();

			const makeEvent = (id: string, occurredAt: number) => ({
				version: 1, id, source: "codex", path: "临床医学/回执.md",
				occurredAt, date: "2026-11-26", generation: "initial", addedChars: 5, deletedChars: 0,
			});

			// Two matching receipts for same content
			fs.writeFileSync(path.join(receiptsDir, `${id1}.json`), JSON.stringify({
				version: 1, id: id1, event: makeEvent(id1, now - 5000), afterDigest, createdAt: now - 5000,
			}));
			fs.writeFileSync(path.join(receiptsDir, `${id2}.json`), JSON.stringify({
				version: 1, id: id2, event: makeEvent(id2, now - 1000), afterDigest, createdAt: now - 1000,
			}));
			// One expired unmatched receipt
			fs.writeFileSync(path.join(receiptsDir, `${expiredId}.json`), JSON.stringify({
				version: 1, id: expiredId, event: makeEvent(expiredId, now - 200_000_000), afterDigest: sha256("过期内容"), createdAt: now - 200_000_000,
			}));
			// One corrupt receipt
			fs.writeFileSync(path.join(receiptsDir, `${corruptId}.json`), "{not-json");

			const spool = new AiEditSpool(fs, path, env.spool, fs.realpathSync(env.vault), crypto, () => now);
			const events = await spool.readAsync();
			expect(events.map(e => e.id)).toEqual([id2]);
			expect(fs.existsSync(path.join(receiptsDir, `${id1}.json.duplicate`))).toBe(true);
			expect(fs.existsSync(path.join(receiptsDir, `${expiredId}.json.expired`))).toBe(true);
			expect(fs.existsSync(path.join(receiptsDir, `${corruptId}.json.invalid`))).toBe(true);
		} finally {
			env.cleanup();
		}
	});

	it("preserves committed status and statistics when post-rename readback fails on DiskStore", async () => {
		const env = makeTempVault();
		try {
			env.writePolicy();
			const noteFile = path.join(env.vault, "临床医学", "回读失败.md");
			fs.writeFileSync(noteFile, "旧正文", "utf8");

			const { AiNoteWriter } = await import("../src/activity/aiNoteWriter");
			const store = new DiskStore(env.vault, env.spool);
			const origRead = store.readNote.bind(store);
			let calls = 0;
			store.readNote = async (notePath: string) => {
				calls++;
				// 1: writer initial read, 2: commitNote pre-backup verify, 3: atomicWriteNote pre-rename verify, 4: post-rename readback
				if (calls === 4) throw new Error("模拟杀软占句柄导致落盘后回读失败");
				return origRead(notePath);
			};

			const writer = new AiNoteWriter({ policy: env.policy, source: "codex", store });
			const result = await writer.write({
				path: "临床医学/回读失败.md",
				content: "新正文内容",
				beforeSha256: sha256("旧正文"),
			});
			expect(result.noteStatus).toBe("committed");
			expect(result.statisticsStatus).toBe("queued");
			expect(result.retrySafe).toBe(false);
			expect(result.warnings?.some(w => w.includes("回读"))).toBe(true);
			expect(fs.readFileSync(noteFile, "utf8")).toBe("新正文内容");
			// Event must be committed into events/ and not lost!
			const eventsDir = path.join(env.spool, "events");
			expect(fs.readdirSync(eventsDir).filter(f => f.endsWith(".json")).length).toBe(1);
		} finally {
			env.cleanup();
		}
	});
});

describe("Obsidian live bridge (Channel A)", () => {
	it("routes MCP calls through live bridge, blocks active dirty editors without disk fallback, and records stats", async () => {
		const env = makeTempVault();
		let bridge: AiEditBridgeServer | undefined;
		try {
			env.writePolicy();
			const files = new Map<string, string>([["临床医学/外科学.md", "# 外科学\n原始段落\n"]]);
			const savedEvents: any[] = [];
			let activeEditor = false;

			const fakeVault: any = {
				getAbstractFileByPath(notePath: string) {
					return files.has(notePath) ? { path: notePath, extension: "md" } : null;
				},
				getMarkdownFiles() {
					return [...files.keys()].map(p => ({ path: p, extension: "md" }));
				},
				async read(file: { path: string }) {
					return files.get(file.path) ?? "";
				},
				async process(file: { path: string }, fn: (current: string) => string) {
					const next = fn(files.get(file.path) ?? "");
					files.set(file.path, next);
					return next;
				},
				async modify(file: { path: string }, data: string) {
					files.set(file.path, data);
				},
				async create(notePath: string, data: string) {
					files.set(notePath, data);
					return { path: notePath, extension: "md" };
				},
				async createFolder() {},
			};

			const spool = new AiEditSpool(fs, path, env.spool, fs.realpathSync(env.vault), crypto);
			bridge = new AiEditBridgeServer({
				vault: fakeVault,
				spool,
				policy: () => env.policy,
				saveEvents: async events => { savedEvents.push(...events); },
				checkActiveEditor: () => activeEditor
					? { active: true, reason: "用户正在编辑中" }
					: { active: false },
				pluginVersion: "0.29.5",
			});
			await bridge.start();
			expect(fs.existsSync(path.join(env.spool, "bridge.json"))).toBe(true);

			const input = { vault: env.vault, source: "codex", "spool-root": env.spool };
			const readRes = await executeAiNoteCommand(input, "read_note", { path: "临床医学/外科学.md" }) as any;
			expect(readRes.channel).toBe("obsidian-bridge");
			expect(readRes.activeInEditor).toBe(false);

			// When editor is active/dirty, bridge rejects and CLI MUST NOT fall back to disk
			activeEditor = true;
			await expect(executeAiNoteCommand(input, "patch_note", {
				path: "临床医学/外科学.md",
				beforeSha256: readRes.beforeSha256,
				edits: [{ oldText: "原始段落", newText: "冲突修改" }],
			})).rejects.toMatchObject({ code: "NOTE_ACTIVE_IN_EDITOR", noteModified: false, retrySafe: true });
			expect(files.get("临床医学/外科学.md")).toBe("# 外科学\n原始段落\n");
			expect(fs.existsSync(path.join(env.vault, "临床医学", "外科学.md"))).toBe(false);

			// Once editor is clean, patch succeeds through Obsidian vault.process and records stats immediately
			activeEditor = false;
			const patchRes = await executeAiNoteCommand(input, "patch_note", {
				path: "临床医学/外科学.md",
				beforeSha256: readRes.beforeSha256,
				edits: [{ oldText: "原始段落", newText: "最新修订段落" }],
			}) as any;
			expect(patchRes.channel).toBe("obsidian-bridge");
			expect(patchRes.noteStatus).toBe("committed");
			expect(patchRes.statisticsStatus).toBe("recorded");
			expect(files.get("临床医学/外科学.md")).toBe("# 外科学\n最新修订段落\n");
			expect(savedEvents.length).toBe(1);
			expect(savedEvents[0].addedChars).toBe(4);
			expect(savedEvents[0].deletedChars).toBe(2);
		} finally {
			await bridge?.stop();
			env.cleanup();
		}
	});
});

describe("MCP JSON-RPC surface", () => {
	it("exposes all 5 tools with non-idempotent write_note and returns structured error payloads", async () => {
		const list = await respond({ jsonrpc: "2.0", id: 1, method: "tools/list" }, async () => ({})) as any;
		const names = list.result.tools.map((t: any) => t.name);
		expect(names).toEqual(["read_note", "patch_note", "write_note", "list_note_backups", "restore_note_backup"]);
		const writeTool = list.result.tools.find((t: any) => t.name === "write_note");
		expect(writeTool.annotations.idempotentHint).toBe(false);

		const env = makeTempVault();
		try {
			env.writePolicy();
			const errResp = await respond(
				{ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "write_note", arguments: { path: "AGENTS.md", content: "hack", beforeSha256: sha256("") } } },
				(name, args) => executeAiNoteCommand({ vault: env.vault, source: "codex", "spool-root": env.spool }, name, args),
			) as any;
			expect(errResp.result.isError).toBe(true);
			const parsed = JSON.parse(errResp.result.content[0].text);
			expect(parsed).toMatchObject({ ok: false, errorCode: "PATH_PROTECTED", noteModified: false, retrySafe: false });
		} finally {
			env.cleanup();
		}
	});

	it("ignores blank stdio lines and serves initialize/tools/call end-to-end on the packaged cjs binary", async () => {
		const bundlePath = path.resolve("dist", "contribution-graph-local", "ai-note-write.cjs");
		if (!fs.existsSync(bundlePath)) return;
		const { spawnSync } = await import("node:child_process");
		const env = makeTempVault();
		try {
			env.writePolicy();
			const noteFile = path.join(env.vault, "临床医学", "打包验收.md");
			fs.writeFileSync(noteFile, "# 标题\n旧句\n", "utf8");
			const stdin = [
				"",
				"   ",
				JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } }),
				JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "patch_note", arguments: {
					path: "临床医学/打包验收.md",
					beforeSha256: sha256("# 标题\n旧句\n"),
					edits: [{ oldText: "旧句", newText: "新句" }],
				} } }),
				"",
			].join("\n");
			const run = spawnSync(process.execPath, [bundlePath, "--mcp", "--vault", env.vault, "--source", "codex", "--spool-root", env.spool], {
				input: stdin,
				encoding: "utf8",
				windowsHide: true,
			});
			expect(run.status).toBe(0);
			const lines = run.stdout.trim().split("\n").map(line => JSON.parse(line));
			expect(lines.length).toBe(2);
			expect(lines[0].result.serverInfo.version).toBe("2.0.0");
			const patchPayload = JSON.parse(lines[1].result.content[0].text);
			expect(patchPayload.noteStatus).toBe("committed");
			expect(patchPayload.statisticsStatus).toBe("queued");
			expect(fs.readFileSync(noteFile, "utf8")).toBe("# 标题\n新句\n");
		} finally {
			env.cleanup();
		}
	});
});
