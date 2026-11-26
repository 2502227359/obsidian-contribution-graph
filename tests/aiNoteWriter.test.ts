import { describe, expect, it } from "vitest";
import { calculateAiNoteChanges } from "../src/activity/aiNoteDiff";
import { applyNotePatches, sliceNoteLines } from "../src/activity/aiNotePatch";
import { AiNoteWriter, AiNoteStore, AiNoteSnapshot, AiEditReceipt } from "../src/activity/aiNoteWriter";
import { AiEditEvent, AiEditPolicy, AiNoteError, defaultAiWritePolicy, evaluateWritePermission } from "../src/activity/aiEditProtocol";

const basePolicy: AiEditPolicy = {
	version: 1,
	enabled: true,
	generation: "initial",
	trackedFolders: ["Notes"],
	trackedFiles: ["Homepage.md"],
	excludeWhitespace: true,
	excludeMarkdownFormatting: false,
	statisticsFolder: "Template/数据/学习统计",
	writePolicy: defaultAiWritePolicy("collection-scope"),
};

class MemoryStore implements AiNoteStore {
	content = new Map<string, string>();
	events = new Map<string, AiEditEvent>();
	receipts = new Map<string, AiEditReceipt>();
	quarantined: Array<{ id: string; reason: string }> = [];
	failEvent = false;

	async readNote(path: string): Promise<AiNoteSnapshot> {
		const exists = this.content.has(path);
		const content = this.content.get(path) ?? "";
		const hash = await digest(content);
		return { content, revision: hash, digest: hash, exists };
	}

	async commitNote(path: string, content: string, expectedRevision: string): Promise<AiNoteSnapshot> {
		const current = await this.readNote(path);
		if (current.revision !== expectedRevision) {
			throw new AiNoteError("STALE_VERSION", "版本冲突", { noteModified: false, retrySafe: true });
		}
		this.content.set(path, content);
		return this.readNote(path);
	}

	async prepareReceipt(receipt: AiEditReceipt): Promise<void> { this.receipts.set(receipt.id, receipt); }
	async listReceipts(): Promise<readonly AiEditReceipt[]> { return [...this.receipts.values()]; }
	async commitEvent(event: AiEditEvent): Promise<void> {
		if (this.failEvent) throw new Error("事件写入失败");
		this.events.set(event.id, event);
	}
	async removeReceipt(id: string): Promise<void> { this.receipts.delete(id); }
	async quarantineReceipt(id: string, reason: "invalid" | "duplicate" | "expired"): Promise<void> {
		this.receipts.delete(id);
		this.quarantined.push({ id, reason });
	}
}

async function digest(value: string): Promise<string> {
	const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

function writer(store: MemoryStore, options: { policy?: AiEditPolicy; source?: string; now?: () => number; caseInsensitivePaths?: boolean } = {}): AiNoteWriter {
	return new AiNoteWriter({
		policy: options.policy ?? basePolicy,
		source: options.source ?? "pi",
		store,
		now: options.now ?? (() => 1795700000000),
		newId: () => crypto.randomUUID(),
		caseInsensitivePaths: options.caseInsensitivePaths ?? true,
	});
}

describe("AI note diff", () => {
	it("counts grapheme additions and deletions exactly", () => {
		expect(calculateAiNoteChanges("甲乙丙 X", "甲丁丙 Y", { excludeWhitespace: true, excludeMarkdownFormatting: false }))
			.toEqual({ addedChars: 2, deletedChars: 2 });
		expect(calculateAiNoteChanges("😀", "😀😀", { excludeWhitespace: true, excludeMarkdownFormatting: false }))
			.toEqual({ addedChars: 1, deletedChars: 0 });
		expect(calculateAiNoteChanges("a b", "ab", { excludeWhitespace: true, excludeMarkdownFormatting: false }))
			.toEqual({ addedChars: 0, deletedChars: 0 });
	});

	it("supports Markdown formatting exclusion without throwing or miscounting", () => {
		const mode = { excludeWhitespace: true, excludeMarkdownFormatting: true };
		expect(calculateAiNoteChanges("**a**", "**b**", mode)).toEqual({ addedChars: 1, deletedChars: 1 });
		expect(calculateAiNoteChanges("正文", "**正文**", mode)).toEqual({ addedChars: 0, deletedChars: 0 });
		expect(calculateAiNoteChanges("标题", "## 标题", mode)).toEqual({ addedChars: 0, deletedChars: 0 });
		expect(calculateAiNoteChanges("高亮", "==🔴高亮==", mode)).toEqual({ addedChars: 0, deletedChars: 0 });
		expect(calculateAiNoteChanges("```ts\nconst a = 1;\n```", "```ts\nconst a = 2;\n```", mode))
			.toEqual({ addedChars: 1, deletedChars: 1 });
	});

	it("counts sparse edits and large multi-paragraph edits beyond 2048 chars", () => {
		const body = "保留的正文".repeat(1500);
		const mode = { excludeWhitespace: true, excludeMarkdownFormatting: false };
		expect(calculateAiNoteChanges(`甲${body}乙`, `丙${body}丁`, mode))
			.toEqual({ addedChars: 2, deletedChars: 2 });

		const existing = "---\ntitle: 临床笔记\n---\n\n# 第一章\n旧内容\n";
		const largeSection = Array.from({ length: 120 }, (_, i) => `第${i + 1}段：这是一段新增的医学知识要点说明文字。`).join("\n");
		const result = calculateAiNoteChanges(existing, `${existing}\n${largeSection}`, mode);
		expect(result.addedChars).toBeGreaterThan(2500);
		expect(result.deletedChars).toBe(0);
	});
});

describe("AI note patch & slicing", () => {
	it("applies targeted patches, rejects ambiguous matches, and preserves CRLF", () => {
		const crlf = "# 标题\r\n段落一\r\n段落二\r\n";
		const patched = applyNotePatches(crlf, [{ oldText: "段落一", newText: "段落一（已修订）" }]);
		expect(patched.eol).toBe("\r\n");
		expect(patched.content).toBe("# 标题\r\n段落一（已修订）\r\n段落二\r\n");

		expect(() => applyNotePatches("重复\n重复\n", [{ oldText: "重复", newText: "单次" }]))
			.toThrow(/匹配到 2 处/);

		const replacedAll = applyNotePatches("重复\n重复\n", [{ oldText: "重复", newText: "新版", replaceAll: true }]);
		expect(replacedAll.content).toBe("新版\n新版\n");

		const sliced = sliceNoteLines("L1\nL2\nL3\nL4", 2, 3);
		expect(sliced).toEqual({ content: "L2\nL3", startLine: 2, endLine: 3, totalLines: 4, truncated: true });
	});
});

describe("AI write policy & guards", () => {
	it("blocks protected files, out-of-scope notes, and Windows case variants of statistics folder", () => {
		expect(evaluateWritePermission("AGENTS.md", basePolicy, true)).toMatchObject({ allowed: false, code: "PATH_PROTECTED" });
		expect(evaluateWritePermission("Notes/AGENTS.md", basePolicy, true)).toMatchObject({ allowed: false, code: "PATH_PROTECTED" });
		expect(evaluateWritePermission("Notes/CMBK维护手册.md", basePolicy, true)).toMatchObject({ allowed: false, code: "PATH_PROTECTED" });
		expect(evaluateWritePermission("template/数据/学习统计/hack.md", basePolicy, true)).toMatchObject({ allowed: false, code: "PATH_PROTECTED" });
		expect(evaluateWritePermission("Other/a.md", basePolicy, true)).toMatchObject({ allowed: false, code: "OUT_OF_WRITE_SCOPE" });
		expect(evaluateWritePermission("notes/a.md", basePolicy, true)).toEqual({ allowed: true });
		expect(evaluateWritePermission("homepage.md", basePolicy, true)).toEqual({ allowed: true });
	});

	it("blocks destructive full-file writes that drop frontmatter, embeds, block IDs, or large content", async () => {
		const store = new MemoryStore();
		const original = [
			"---",
			"tags: [medicine]",
			"---",
			"# 心内科",
			"![[ecg.png]]",
			"核心要点 ^key-1",
			"详细内容。".repeat(200),
		].join("\n");
		store.content.set("Notes/heart.md", original);
		const snap = await store.readNote("Notes/heart.md");
		const service = writer(store);

		// Dropping frontmatter
		await expect(service.write({
			path: "Notes/heart.md",
			content: original.replace(/^---[\s\S]*?---\n/, ""),
			beforeSha256: snap.digest,
		})).rejects.toMatchObject({ code: "STRUCTURE_GUARD_BLOCKED" });

		// Dropping embed
		await expect(service.write({
			path: "Notes/heart.md",
			content: original.replace("![[ecg.png]]\n", ""),
			beforeSha256: snap.digest,
		})).rejects.toMatchObject({ code: "STRUCTURE_GUARD_BLOCKED" });

		// Dropping block id
		await expect(service.write({
			path: "Notes/heart.md",
			content: original.replace(" ^key-1", ""),
			beforeSha256: snap.digest,
		})).rejects.toMatchObject({ code: "STRUCTURE_GUARD_BLOCKED" });

		// Large shrink (>30% and >500 chars)
		await expect(service.write({
			path: "Notes/heart.md",
			content: "---\ntags: [medicine]\n---\n# 心内科\n![[ecg.png]]\n核心要点 ^key-1\n",
			beforeSha256: snap.digest,
		})).rejects.toMatchObject({ code: "DESTRUCTIVE_EDIT_BLOCKED" });

		// Patching a single heading succeeds cleanly without touching embeds/frontmatter
		const patched = await service.patch({
			path: "Notes/heart.md",
			beforeSha256: snap.digest,
			edits: [{ oldText: "# 心内科", newText: "# 心血管内科" }],
		});
		expect(patched.noteStatus).toBe("committed");
		expect(patched.statisticsStatus).toBe("queued");
		expect(store.content.get("Notes/heart.md")).toContain("![[ecg.png]]");
		expect(store.content.get("Notes/heart.md")).toContain("^key-1");
	});
});

describe("AI note writer", () => {
	it("records a scoped edit once, enforces create/replace modes, and rejects stale edits", async () => {
		const store = new MemoryStore();
		const service = writer(store);

		// Creating a new note explicitly
		const emptySnap = await store.readNote("Notes/new.md");
		expect(emptySnap.exists).toBe(false);
		const created = await service.write({
			path: "Notes/new.md",
			content: "old",
			beforeSha256: emptySnap.digest,
			mode: "create",
		});
		expect(created.status).toBe("committed");
		expect(created.noteStatus).toBe("committed");

		// Calling create again on existing file fails even if empty
		store.content.set("Notes/empty.md", "");
		const emptyExisting = await store.readNote("Notes/empty.md");
		await expect(service.write({
			path: "Notes/empty.md",
			content: "hello",
			beforeSha256: emptyExisting.digest,
			mode: "create",
		})).rejects.toMatchObject({ code: "NOTE_ALREADY_EXISTS" });

		// Updating with current revision
		const current = await store.readNote("Notes/new.md");
		const updated = await service.write({ path: "Notes/new.md", content: "new", expectedRevision: current.revision });
		expect(updated.status).toBe("committed");
		expect(store.events.size).toBe(2);
		expect(store.receipts.size).toBe(0);

		// Unchanged write does not emit another event
		const unchanged = await service.write({ path: "Notes/new.md", content: "new", expectedRevision: (await store.readNote("Notes/new.md")).revision });
		expect(unchanged.status).toBe("unchanged");
		expect(unchanged.noteStatus).toBe("unchanged");
		expect(store.events.size).toBe(2);

		// Stale version fails cleanly
		await expect(service.write({ path: "Notes/new.md", content: "newer", beforeSha256: "0".repeat(64) }))
			.rejects.toMatchObject({ code: "STALE_VERSION", noteModified: false, retrySafe: true });
	});

	it("allows out-of-scope write only when writePolicy mode is vault and marks statistics skipped", async () => {
		const store = new MemoryStore();
		const vaultModePolicy: AiEditPolicy = { ...basePolicy, writePolicy: defaultAiWritePolicy("vault") };
		const service = writer(store, { policy: vaultModePolicy });

		const result = await service.write({ path: "Other/a.md", content: "x" });
		expect(result.status).toBe("committed-without-statistics");
		expect(result.noteStatus).toBe("committed");
		expect(result.statisticsStatus).toBe("skipped");
		expect(result.statisticsReason).toBe("out-of-scope");
		expect(store.content.get("Other/a.md")).toBe("x");
	});

	it("reports committed-pending-statistics when event commit fails and deduplicates duplicate receipts on recovery", async () => {
		const store = new MemoryStore();
		store.content.set("Notes/a.md", "old");
		store.failEvent = true;

		const pending = await writer(store).write({ path: "Notes/a.md", content: "new" });
		expect(pending.status).toBe("committed-pending-statistics");
		expect(pending.noteStatus).toBe("committed");
		expect(pending.statisticsStatus).toBe("pending_recovery");
		expect(pending.retrySafe).toBe(false);
		expect(store.receipts.size).toBe(1);

		// Inject a second duplicate receipt pointing to the exact same afterDigest
		const [firstReceipt] = [...store.receipts.values()];
		const dupId = crypto.randomUUID();
		await store.prepareReceipt({
			...firstReceipt,
			id: dupId,
			event: { ...firstReceipt.event, id: dupId, occurredAt: firstReceipt.event.occurredAt + 1000 },
			createdAt: (firstReceipt.createdAt ?? 1795700000000) + 1000,
		});
		expect(store.receipts.size).toBe(2);

		store.failEvent = false;
		expect(await writer(store).recover()).toBe(1);
		expect(store.receipts.size).toBe(0);
		expect(store.events.size).toBe(1);
		expect(store.quarantined).toEqual([{ id: firstReceipt.id, reason: "duplicate" }]);
	});
});
