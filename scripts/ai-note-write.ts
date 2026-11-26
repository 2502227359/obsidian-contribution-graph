import { createHash, randomUUID } from "node:crypto";
import { constants, promises as fs, realpathSync } from "node:fs";
import * as http from "node:http";
import { createInterface } from "node:readline";
import { dirname, join, relative, resolve, sep } from "node:path";
import * as pathApi from "node:path";
import * as cryptoApi from "node:crypto";
import * as fsSync from "node:fs";
import {
	AI_BRIDGE_PROTOCOL_VERSION,
	AiAuditEntry,
	AiBridgeInfo,
	AiEditEvent,
	AiEditPolicy,
	AiEditReceipt,
	AiNoteBackupMeta,
	AiNoteError,
	AiNoteErrorCode,
	aiEditSpoolPath,
	DEFAULT_MAX_NOTE_BYTES,
	evaluateWritePermission,
	isAiNotePath,
	isNoteInCollectionScope,
	parseAiBridgeInfo,
	parseAiEditPolicy,
	pathCompareKey,
	resolveAiWritePolicy,
} from "../src/activity/aiEditProtocol";
import { AiEditSpool } from "../src/activity/aiEditSpool";
import { detectNoteEol, NotePatchEdit, sliceNoteLines } from "../src/activity/aiNotePatch";
import { AiNoteCommitContext, AiNoteSnapshot, AiNoteStore, AiNoteWriter } from "../src/activity/aiNoteWriter";
import { serveAiNotes } from "./ai-note-mcp";

declare const __AI_WRITER_VERSION__: string | undefined;
const WRITER_VERSION = typeof __AI_WRITER_VERSION__ === "string" ? __AI_WRITER_VERSION__ : "";
const LOCK_STALE_MS = 60_000;
const RECOVERY_STALE_MS = 15_000;
const RENAME_RETRY_DELAYS_MS = [40, 80, 160, 320];
const BRIDGE_TIMEOUT_MS = 15_000;

interface LockHandle {
	path: string;
	token: string;
	file: fs.FileHandle;
}

export class DiskStore implements AiNoteStore {
	private readonly vault: string;
	private readonly spoolRoot: string;
	private readonly spool: AiEditSpool;

	constructor(vault: string, spoolRoot: string) {
		this.vault = vault;
		this.spoolRoot = spoolRoot;
		const realVault = realpathSync(vault);
		this.spool = new AiEditSpool(fsSync, pathApi, spoolRoot, realVault, cryptoApi);
	}

	async readNote(path: string): Promise<AiNoteSnapshot> {
		const { target, canonicalPath } = await this.safeTarget(path);
		let content = "";
		let exists = true;
		let mtimeMs: number | undefined;
		try {
			const stat = await fs.stat(target);
			if (!stat.isFile()) throw new AiNoteError("PATH_INVALID", "目标路径不是普通文件");
			if (stat.size > DEFAULT_MAX_NOTE_BYTES) {
				throw new AiNoteError("NOTE_TOO_LARGE", `目标笔记体积 ${stat.size} 字节超过读取上限`);
			}
			mtimeMs = stat.mtimeMs;
			content = await fs.readFile(target, "utf8");
		} catch (error) {
			if (error instanceof AiNoteError) throw error;
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			exists = false;
		}
		const digest = hash(content);
		return { content, revision: digest, digest, exists, mtimeMs, canonicalPath };
	}

	async commitNote(path: string, content: string, expectedRevision: string, commitContext?: AiNoteCommitContext): Promise<AiNoteSnapshot> {
		const { target, canonicalPath } = await this.safeTarget(path);
		const lock = await this.acquireLock(this.noteLockPath(target));
		try {
			const verifyVersion = async () => {
				const current = await this.readNote(canonicalPath);
				if (current.revision !== expectedRevision) {
					throw new AiNoteError("STALE_VERSION", "AI 编辑的原始版本已变化，请重新读取后再提交", {
						noteModified: false,
						retrySafe: true,
						details: { expectedSha256: expectedRevision, currentSha256: current.digest },
					});
				}
				return current;
			};

			const beforeSnapshot = await verifyVersion();
			const afterDigest = hash(content);
			let backupId: string | undefined;
			if (commitContext) {
				backupId = await this.spool.saveBackup({
					path: canonicalPath,
					source: commitContext.source,
					operation: commitContext.operation,
					createdAt: Date.now(),
					existed: beforeSnapshot.exists !== false,
					beforeSha256: beforeSnapshot.digest,
					afterSha256: afterDigest,
					beforeBytes: Buffer.byteLength(beforeSnapshot.content, "utf8"),
					afterBytes: Buffer.byteLength(content, "utf8"),
				}, beforeSnapshot.content);
			}

			await this.atomicWriteNote(target, content, async () => {
				await verifyVersion();
			});

			// Once atomicWriteNote finishes, the file IS committed on disk.
			// Never throw a post-commit read failure as if the write did not happen.
			try {
				const afterSnapshot = await this.readNote(canonicalPath);
				return { ...afterSnapshot, backupId, verified: true };
			} catch (error) {
				return {
					content,
					revision: afterDigest,
					digest: afterDigest,
					exists: true,
					canonicalPath,
					backupId,
					verified: false,
					verifyWarning: `正文已落盘，但落盘后回读校验暂不可用：${error instanceof Error ? error.message : String(error)}`,
				};
			}
		} finally {
			await this.releaseLock(lock);
		}
	}

	async prepareReceipt(receipt: AiEditReceipt): Promise<void> {
		await this.atomicSpoolFile(join(this.spoolRoot, "receipts", `${receipt.id}.json`), JSON.stringify(receipt));
	}

	async listReceipts(): Promise<readonly AiEditReceipt[]> {
		const directory = join(this.spoolRoot, "receipts");
		try { await fs.access(directory, constants.F_OK); } catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}
		const receipts: AiEditReceipt[] = [];
		for (const name of await fs.readdir(directory)) {
			if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
			const fullPath = join(directory, name);
			try {
				receipts.push(JSON.parse(await fs.readFile(fullPath, "utf8")) as AiEditReceipt);
			} catch {
				await fs.rename(fullPath, `${fullPath}.invalid`).catch(() => undefined);
			}
		}
		return receipts;
	}

	async commitEvent(event: AiEditEvent): Promise<void> {
		const target = join(this.spoolRoot, "events", `${event.id}.json`);
		try {
			const existing = JSON.parse(await fs.readFile(target, "utf8")) as AiEditEvent;
			if (JSON.stringify(existing) !== JSON.stringify(event)) throw new Error("AI 编辑事件编号冲突");
			return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		await this.atomicSpoolFile(target, JSON.stringify(event));
	}

	removeReceipt(id: string): Promise<void> {
		return fs.rm(join(this.spoolRoot, "receipts", `${id}.json`), { force: true });
	}

	async quarantineReceipt(id: string, reason: "invalid" | "duplicate" | "expired"): Promise<void> {
		const source = join(this.spoolRoot, "receipts", `${id}.json`);
		await fs.rename(source, `${source}.${reason}`).catch(() => undefined);
	}

	async withRecoveryLock<T>(fn: () => Promise<T>): Promise<T> {
		const lock = await this.acquireLock(join(this.spoolRoot, "locks", "recover.lock"));
		try { return await fn(); }
		finally { await this.releaseLock(lock); }
	}

	listBackups(path?: string, limit?: number): Promise<readonly AiNoteBackupMeta[]> {
		return this.spool.listBackups(path, limit);
	}

	readBackup(backupId: string): Promise<{ meta: AiNoteBackupMeta; content: string } | undefined> {
		return this.spool.readBackup(backupId);
	}

	appendAudit(entry: AiAuditEntry): Promise<void> {
		return this.spool.appendAudit(entry);
	}

	private async safeTarget(path: string): Promise<{ target: string; canonicalPath: string }> {
		if (!/^[^\\]+(?:\/[^\\]+)*$/.test(path) || path.split("/").some(part => part === "." || part === "..")) {
			throw new AiNoteError("PATH_INVALID", "AI 编辑路径无效");
		}
		const root = await fs.realpath(this.vault);
		const target = resolve(root, path.replace(/\//g, sep));
		const value = relative(root, target);
		if (!value || value === ".." || value.startsWith(`..${sep}`)) {
			throw new AiNoteError("PATH_INVALID", "AI 编辑路径超出仓库");
		}
		let current = root;
		const resolvedParts: string[] = [];
		let missingFromHere = false;
		for (const part of value.split(sep)) {
			const nextPath = join(current, part);
			if (!missingFromHere) {
				try {
					const stat = await fs.lstat(nextPath);
					if (stat.isSymbolicLink()) {
						throw new AiNoteError("PATH_INVALID", "AI 编辑路径包含符号链接");
					}
					const actualName = await resolveExactEntryName(current, part);
					resolvedParts.push(actualName);
					current = join(current, actualName);
					continue;
				} catch (error) {
					if (error instanceof AiNoteError) throw error;
					if ((error as NodeJS.ErrnoException).code === "ENOENT") {
						missingFromHere = true;
					} else {
						throw error;
					}
				}
			}
			resolvedParts.push(part);
			current = nextPath;
		}
		return { target: current, canonicalPath: resolvedParts.join("/") };
	}

	private async atomicWriteNote(target: string, content: string, verify?: () => Promise<void>): Promise<void> {
		const targetDir = dirname(target);
		await fs.mkdir(targetDir, { recursive: true });

		let mode = 0o644;
		try {
			const existing = await fs.stat(target);
			mode = (existing.mode & 0o777) || 0o644;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}

		// Prefer staging temp files inside spool/tmp on the same filesystem so Obsidian/Sync never sees vault *.tmp files.
		const spoolTmpDir = join(this.spoolRoot, "tmp");
		await fs.mkdir(spoolTmpDir, { recursive: true, mode: 0o700 });
		let temporary = join(spoolTmpDir, `${randomUUID()}.tmp`);
		if (!(await isSameDevice(spoolTmpDir, targetDir))) {
			temporary = join(targetDir, `.cg-tmp-${randomUUID()}`);
		}

		try {
			await writeAndSyncTemp(temporary, content, mode);
			await this.renameWithRetry(temporary, target, verify);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EXDEV" && temporary.startsWith(spoolTmpDir)) {
				await fs.rm(temporary, { force: true }).catch(() => undefined);
				temporary = join(targetDir, `.cg-tmp-${randomUUID()}`);
				await writeAndSyncTemp(temporary, content, mode);
				await this.renameWithRetry(temporary, target, verify);
				return;
			}
			throw error;
		} finally {
			await fs.rm(temporary, { force: true }).catch(() => undefined);
		}
	}

	private async renameWithRetry(temporary: string, target: string, verify?: () => Promise<void>): Promise<void> {
		for (let attempt = 0; ; attempt++) {
			await verify?.();
			try {
				await fs.rename(temporary, target);
				return;
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				const retryable = process.platform === "win32" && (code === "EPERM" || code === "EBUSY" || code === "EACCES");
				if (!retryable || attempt >= RENAME_RETRY_DELAYS_MS.length) throw error;
				await sleep(RENAME_RETRY_DELAYS_MS[attempt]);
			}
		}
	}

	private async atomicSpoolFile(target: string, content: string): Promise<void> {
		await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
		const temporary = `${target}.${randomUUID()}.tmp`;
		try {
			await writeAndSyncTemp(temporary, content, 0o600);
			for (let attempt = 0; ; attempt++) {
				try {
					await fs.rename(temporary, target);
					return;
				} catch (error) {
					const code = (error as NodeJS.ErrnoException).code;
					const retryable = process.platform === "win32" && (code === "EPERM" || code === "EBUSY" || code === "EACCES");
					if (!retryable || attempt >= RENAME_RETRY_DELAYS_MS.length) throw error;
					await sleep(RENAME_RETRY_DELAYS_MS[attempt]);
				}
			}
		} finally {
			await fs.rm(temporary, { force: true }).catch(() => undefined);
		}
	}

	private async acquireLock(lockPath: string): Promise<LockHandle> {
		await fs.mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
		try { return await this.createLock(lockPath); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			return this.reclaimLock(lockPath);
		}
	}

	private async createLock(lockPath: string): Promise<LockHandle> {
		const token = randomUUID();
		const file = await fs.open(lockPath, "wx", 0o600);
		try {
			await file.writeFile(JSON.stringify({ pid: process.pid, token, startedAt: Date.now() }), "utf8");
			return { path: lockPath, token, file };
		} catch (error) {
			await file.close();
			await fs.rm(lockPath, { force: true });
			throw error;
		}
	}

	private async reclaimLock(lockPath: string): Promise<LockHandle> {
		const busy = new AiNoteError("LOCK_BUSY", "此笔记有另一笔写入正在提交，请重新读取后重试", {
			noteModified: false,
			retrySafe: true,
		});
		const recoveryPath = `${lockPath}.recovery`;
		await this.cleanupStaleRecoveryLock(recoveryPath);

		const recoveryHandle = await fs.open(recoveryPath, "wx", 0o600).catch(() => { throw busy; });
		try {
			await recoveryHandle.writeFile(JSON.stringify({ pid: process.pid, startedAt: Date.now() }), "utf8");
			const stale = await isLockStale(lockPath, LOCK_STALE_MS);
			if (!stale) throw busy;
			await fs.rm(lockPath, { force: true });
			return await this.createLock(lockPath);
		} finally {
			await recoveryHandle.close().catch(() => undefined);
			await fs.rm(recoveryPath, { force: true }).catch(() => undefined);
		}
	}

	private async cleanupStaleRecoveryLock(recoveryPath: string): Promise<void> {
		if (await isLockStale(recoveryPath, RECOVERY_STALE_MS)) {
			await fs.rm(recoveryPath, { force: true }).catch(() => undefined);
		}
	}

	private async releaseLock(lock: LockHandle): Promise<void> {
		try { await lock.file.close(); } catch { /* ignore */ }
		try {
			const raw = await fs.readFile(lock.path, "utf8");
			const parsed = JSON.parse(raw) as { token?: unknown };
			if (parsed.token === lock.token) {
				await fs.rm(lock.path, { force: true });
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				// Best-effort cleanup if unreadable/legacy format
				await fs.rm(lock.path, { force: true }).catch(() => undefined);
			}
		}
	}

	private noteLockPath(target: string): string {
		return join(this.spoolRoot, "locks", `${hash(process.platform === "win32" ? target.toLowerCase() : target)}.lock`);
	}
}

async function resolveExactEntryName(parentDir: string, segment: string): Promise<string> {
	if (process.platform !== "win32") return segment;
	try {
		const entries = await fs.readdir(parentDir);
		const lower = segment.toLowerCase();
		return entries.find(entry => entry.toLowerCase() === lower) ?? segment;
	} catch {
		return segment;
	}
}

async function isSameDevice(dirA: string, dirB: string): Promise<boolean> {
	try {
		const [a, b] = await Promise.all([fs.stat(dirA), fs.stat(dirB)]);
		return a.dev === b.dev;
	} catch {
		return false;
	}
}

async function writeAndSyncTemp(temporary: string, content: string, mode: number): Promise<void> {
	const handle = await fs.open(temporary, "wx", mode);
	try {
		await handle.writeFile(content, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function isLockStale(lockPath: string, staleMs: number): Promise<boolean> {
	try {
		const stat = await fs.stat(lockPath);
		const age = Date.now() - stat.mtimeMs;
		if (age > staleMs) return true;
		const raw = (await fs.readFile(lockPath, "utf8")).trim();
		if (!raw) return age > 5000;
		let pid: number | undefined;
		let startedAt: number | undefined;
		if (raw.startsWith("{")) {
			const parsed = JSON.parse(raw) as { pid?: unknown; startedAt?: unknown };
			if (typeof parsed.pid === "number") pid = parsed.pid;
			if (typeof parsed.startedAt === "number") startedAt = parsed.startedAt;
		} else {
			const legacyPid = Number(raw);
			if (Number.isSafeInteger(legacyPid)) pid = legacyPid;
		}
		if (startedAt !== undefined && Date.now() - startedAt > staleMs) return true;
		if (pid !== undefined && Number.isSafeInteger(pid) && pid > 0) {
			return !processExists(pid);
		}
		return age > 5000;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT";
	}
}

function processExists(id: number): boolean {
	try { process.kill(id, 0); return true; }
	catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

function hash(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function args(argv: readonly string[]): Record<string, string | boolean> {
	const result: Record<string, string | boolean> = {};
	for (let i = 0; i < argv.length; i++) {
		if (argv[i].startsWith("--")) {
			result[argv[i].slice(2)] = argv[i + 1]?.startsWith("--") || !argv[i + 1] ? true : argv[++i];
		}
	}
	return result;
}

function resolvePaths(input: Record<string, string | boolean>): { vault: string; realVault: string; source: string; spool: string; allowOutOfScope: boolean } {
	const vault = String(input.vault || process.env.CONTRIBUTION_GRAPH_AI_VAULT || "");
	const source = String(input.source || process.env.CONTRIBUTION_GRAPH_AI_SOURCE || "");
	if (!vault || !source) {
		throw new AiNoteError("INVALID_REQUEST", "需要显式提供 --vault 和 --source");
	}
	const realVault = realpathSync(vault);
	const spool = String(input["spool-root"] || process.env.CONTRIBUTION_GRAPH_AI_SPOOL ||
		aiEditSpoolPath(fsSync, pathApi, cryptoApi, realVault));
	const allowOutOfScope = input["allow-out-of-scope"] === true || process.env.CONTRIBUTION_GRAPH_AI_ALLOW_OUT_OF_SCOPE === "1";
	return { vault, realVault, source, spool, allowOutOfScope };
}

function loadPolicy(spool: string, allowOutOfScope: boolean): { policy?: AiEditPolicy; warning?: string } {
	const file = join(spool, "policy.json");
	let raw: string;
	try {
		raw = fsSync.readFileSync(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { policy: undefined };
		throw error;
	}
	let parsedJson: unknown;
	try { parsedJson = JSON.parse(raw); }
	catch { throw new AiNoteError("POLICY_INVALID", "本机策略文件 policy.json 格式损坏"); }
	const policy = parseAiEditPolicy(parsedJson);
	if (!policy) throw new AiNoteError("POLICY_INVALID", "本机策略文件 policy.json 版本或字段无效");

	if (allowOutOfScope) {
		policy.writePolicy = { ...resolveAiWritePolicy(policy), mode: "vault" };
	}
	const warning = WRITER_VERSION && policy.pluginVersion && policy.pluginVersion !== WRITER_VERSION
		? `写入脚本版本（${WRITER_VERSION}）与插件策略版本（${policy.pluginVersion}）不一致，建议重新打包并更新 ai-note-write.cjs。`
		: undefined;
	return { policy, warning };
}

function loadActiveBridge(spool: string, realVault: string): AiBridgeInfo | undefined {
	try {
		const raw = fsSync.readFileSync(join(spool, "bridge.json"), "utf8");
		const info = parseAiBridgeInfo(JSON.parse(raw));
		if (!info) return undefined;
		if (info.protocolVersion !== AI_BRIDGE_PROTOCOL_VERSION) return undefined;
		if (!processExists(info.pid)) return undefined;
		if (pathCompareKey(info.vaultRoot) !== pathCompareKey(realVault)) return undefined;
		return info;
	} catch {
		return undefined;
	}
}

function callBridge(info: AiBridgeInfo, endpoint: string, payload: Record<string, unknown>): Promise<unknown | undefined> {
	return new Promise((resolvePromise) => {
		const body = Buffer.from(JSON.stringify(payload), "utf8");
		const req = http.request({
			hostname: "127.0.0.1",
			port: info.port,
			path: endpoint,
			method: "POST",
			headers: {
				"Authorization": `Bearer ${info.token}`,
				"Content-Type": "application/json; charset=utf-8",
				"Content-Length": String(body.length),
			},
			timeout: BRIDGE_TIMEOUT_MS,
		}, res => {
			const chunks: Buffer[] = [];
			res.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
			res.on("end", () => {
				if (res.statusCode !== 200) {
					resolvePromise(undefined);
					return;
				}
				try {
					resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8")));
				} catch {
					resolvePromise(undefined);
				}
			});
		});
		req.on("timeout", () => {
			req.destroy();
			resolvePromise(undefined);
		});
		req.on("error", () => {
			resolvePromise(undefined);
		});
		req.end(body);
	});
}

function assertBridgeOrThrow(response: unknown): unknown {
	if (response && typeof response === "object" && (response as { ok?: unknown }).ok === false) {
		const err = response as { errorCode?: AiNoteErrorCode; message?: string; noteModified?: boolean; retrySafe?: boolean; details?: Record<string, unknown> };
		throw new AiNoteError(err.errorCode ?? "IO_ERROR", err.message ?? "本地桥接操作失败", {
			noteModified: err.noteModified === true,
			retrySafe: err.retrySafe === true,
			details: err.details,
		});
	}
	return response;
}

export async function executeAiNoteCommand(
	input: Record<string, string | boolean>,
	name: string,
	request: unknown,
): Promise<unknown> {
	const { vault, realVault, source, spool, allowOutOfScope } = resolvePaths(input);
	const value = (request && typeof request === "object" && !Array.isArray(request) ? request : {}) as Record<string, unknown>;

	// Prefer Obsidian live bridge when Obsidian is running (unless explicitly disabled or allow-out-of-scope overrides policy).
	const bridgeDisabled = input["no-bridge"] === true || process.env.CONTRIBUTION_GRAPH_AI_NO_BRIDGE === "1" || allowOutOfScope;
	if (!bridgeDisabled) {
		const bridge = loadActiveBridge(spool, realVault);
		if (bridge) {
			const endpointMap: Record<string, string> = {
				read_note: "/read",
				write_note: "/write",
				patch_note: "/patch",
				list_note_backups: "/backups/list",
				restore_note_backup: "/backups/restore",
			};
			const endpoint = endpointMap[name];
			if (endpoint) {
				const bridgeResponse = await callBridge(bridge, endpoint, { ...value, source });
				if (bridgeResponse !== undefined) {
					return assertBridgeOrThrow(bridgeResponse);
				}
			}
		}
	}

	const store = new DiskStore(vault, spool);
	const { policy, warning: versionWarning } = loadPolicy(spool, allowOutOfScope);

	if (name === "list_note_backups") {
		const pathFilter = typeof value.path === "string" && value.path.trim() ? value.path : undefined;
		const limit = typeof value.limit === "number" && Number.isSafeInteger(value.limit) ? value.limit : 20;
		const backups = await store.listBackups(pathFilter, limit);
		return { ok: true, backups, channel: "disk" };
	}

	if (name === "read_note") {
		if (!isAiNotePath(value.path)) throw new AiNoteError("PATH_INVALID", "需要库内 Markdown 笔记的相对路径");
		const snapshot = await store.readNote(value.path);
		const notePath = snapshot.canonicalPath || value.path;
		const eol = detectNoteEol(snapshot.content);
		const slice = sliceNoteLines(
			snapshot.content,
			typeof value.startLine === "number" ? value.startLine : undefined,
			typeof value.endLine === "number" ? value.endLine : undefined,
		);
		const permission = policy
			? evaluateWritePermission(notePath, policy)
			: { allowed: false as const, code: "POLICY_MISSING" as const, reason: "尚未检测到插件策略文件，请先打开 Obsidian 加载插件初始化" };
		return {
			ok: true,
			path: notePath,
			content: slice.content,
			beforeSha256: snapshot.digest,
			exists: snapshot.exists !== false,
			lineCount: slice.totalLines,
			startLine: slice.startLine,
			endLine: slice.endLine,
			truncated: slice.truncated,
			eol: eol === "\r\n" ? "crlf" : "lf",
			sizeBytes: Buffer.byteLength(snapshot.content, "utf8"),
			writable: permission.allowed,
			...(permission.allowed ? {} : { writeDeniedCode: permission.code, writeDeniedReason: permission.reason }),
			trackedForStatistics: policy ? (policy.enabled && isNoteInCollectionScope(notePath, policy.trackedFolders, policy.trackedFiles)) : false,
			activeInEditor: false,
			...(policy ? {} : { policyMissing: true }),
			...(versionWarning ? { warnings: [versionWarning] } : {}),
			channel: "disk",
		};
	}

	if (!policy) {
		throw new AiNoteError("POLICY_MISSING", "尚未检测到插件策略文件 policy.json，请先启动一次 Obsidian 以初始化写入护栏与统计策略", {
			noteModified: false,
			retrySafe: false,
		});
	}

	const writer = new AiNoteWriter({ policy, source, store, newId: randomUUID, channel: "disk" });
	// Opportunistic locked recovery only if receipts exist
	if ((await store.listReceipts()).length > 0) {
		await writer.recover().catch(() => undefined);
	}

	if (name === "restore_note_backup") {
		if (typeof value.backupId !== "string" || typeof value.beforeSha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.beforeSha256)) {
			throw new AiNoteError("INVALID_REQUEST", "恢复备份需要有效的 backupId 和当前笔记的 SHA-256 摘要");
		}
		const result = await writer.restore({ backupId: value.backupId, beforeSha256: value.beforeSha256 });
		return attachWarning(result, versionWarning);
	}

	if (!isAiNotePath(value.path)) {
		throw new AiNoteError("PATH_INVALID", "需要库内 Markdown 笔记的相对路径");
	}
	if (typeof value.beforeSha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.beforeSha256)) {
		throw new AiNoteError("INVALID_REQUEST", "修改笔记必须传入上一笔 read_note 返回的 64 位 SHA-256 摘要");
	}

	if (name === "patch_note") {
		if (!Array.isArray(value.edits)) {
			throw new AiNoteError("INVALID_REQUEST", "patch_note 需要 edits 数组");
		}
		const result = await writer.patch({
			path: value.path,
			edits: value.edits as readonly NotePatchEdit[],
			beforeSha256: value.beforeSha256,
			preserveEol: value.preserveEol !== false,
			confirmDestructive: value.confirmDestructive === true,
		});
		return attachWarning(result, versionWarning);
	}

	if (name === "write_note") {
		if (typeof value.content !== "string") {
			throw new AiNoteError("INVALID_REQUEST", "write_note 需要完整的 Markdown 内容");
		}
		const mode = value.mode === "create" || value.mode === "replace" ? value.mode : undefined;
		const result = await writer.write({
			path: value.path,
			content: value.content,
			beforeSha256: value.beforeSha256,
			mode,
			preserveEol: value.preserveEol !== false,
			confirmDestructive: value.confirmDestructive === true,
		});
		return attachWarning(result, versionWarning);
	}

	throw new AiNoteError("INVALID_REQUEST", `不支持的工具名称：${name}`);
}

function attachWarning<T extends { warnings?: string[] }>(result: T, warning?: string): T {
	if (!warning) return result;
	return { ...result, warnings: [...(result.warnings ?? []), warning] };
}

async function stdinText(): Promise<string> {
	const lines: string[] = [];
	for await (const line of createInterface({ input: process.stdin })) lines.push(line);
	return lines.join("\n");
}

async function main(): Promise<void> {
	const input = args(process.argv.slice(2));
	if (input.mcp === true) return serveAiNotes((name, request) => executeAiNoteCommand(input, name, request));
	const raw = await stdinText();
	const request = raw.trim() ? JSON.parse(raw) : {};
	const commandName = input.read ? "read_note"
		: input.patch ? "patch_note"
		: input["list-backups"] ? "list_note_backups"
		: input.restore ? "restore_note_backup"
		: "write_note";
	const result = await executeAiNoteCommand(input, commandName, request);
	process.stdout.write(`${JSON.stringify(result)}\n`);
}

const isCliEntry = typeof require !== "undefined" && typeof module !== "undefined" && require.main === module;
if (isCliEntry) {
	void main().catch(error => {
		const output = error instanceof AiNoteError ? JSON.stringify(error.toJSON()) : (error instanceof Error ? error.message : String(error));
		process.stderr.write(`${output}\n`);
		process.exitCode = 1;
	});
}
