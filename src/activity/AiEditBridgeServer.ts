import type * as Http from "http";
import type * as Crypto from "crypto";
import type { TFile, Vault } from "obsidian";
import {
	AI_BRIDGE_PROTOCOL_VERSION,
	AiAuditEntry,
	AiEditEvent,
	AiEditPolicy,
	AiNoteError,
	DEFAULT_MAX_NOTE_BYTES,
	evaluateWritePermission,
	formatAiEditDate,
	isAiEditSource,
	isAiNotePath,
	isNoteInCollectionScope,
	pathCompareKey,
	resolveAiWritePolicy,
} from "./aiEditProtocol";
import { AiEditSpool } from "./aiEditSpool";
import { AiNoteChanges, calculateAiNoteChanges } from "./aiNoteDiff";
import { applyNotePatches, detectNoteEol, NotePatchEdit, restoreLineEndings, sliceNoteLines, verifyNoteIntegrity } from "./aiNotePatch";
import type { AiNoteWriteResult, StatisticsSkipReason } from "./aiNoteWriter";

const MAX_BODY_BYTES = 20 * 1024 * 1024;

export interface ActiveEditorCheckResult {
	active: boolean;
	reason?: string;
}

export interface AiEditBridgeOptions {
	vault: Vault;
	spool: AiEditSpool;
	policy: () => AiEditPolicy;
	saveEvents: (events: readonly AiEditEvent[]) => Promise<void>;
	checkActiveEditor?: (path: string, diskContent: string) => ActiveEditorCheckResult;
	pluginVersion?: string;
	now?: () => number;
	caseInsensitivePaths?: boolean;
	httpModule?: typeof Http;
	cryptoModule?: typeof Crypto;
}

type BridgeVault = Vault & {
	getAbstractFileByPath(path: string): unknown;
	getMarkdownFiles?(): TFile[];
	read(file: TFile): Promise<string>;
	process?(file: TFile, fn: (data: string) => string): Promise<string>;
	modify(file: TFile, data: string): Promise<void>;
	create(path: string, data: string): Promise<TFile>;
	createFolder(path: string): Promise<unknown>;
};

export class AiEditBridgeServer {
	private server?: Http.Server;
	private token = "";
	private port = 0;
	private stopped = false;
	private readonly pathQueues = new Map<string, Promise<void>>();
	private readonly http: typeof Http;
	private readonly crypto: typeof Crypto;
	private readonly now: () => number;
	private readonly caseInsensitive: boolean;

	constructor(private readonly options: AiEditBridgeOptions) {
		this.http = options.httpModule ?? require("http");
		this.crypto = options.cryptoModule ?? require("crypto");
		this.now = options.now ?? (() => Date.now());
		this.caseInsensitive = options.caseInsensitivePaths ?? (process.platform === "win32");
	}

	get listeningPort(): number {
		return this.port;
	}

	get authToken(): string {
		return this.token;
	}

	async start(): Promise<void> {
		if (this.server || this.stopped) return;
		this.token = this.crypto.randomBytes(32).toString("hex");
		const server = this.http.createServer((req, res) => {
			void this.handleRequest(req, res);
		});
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				server.removeListener("error", reject);
				resolve();
			});
		});
		const address = server.address();
		if (!address || typeof address === "string") {
			server.close();
			throw new Error("无法获取本地 AI 桥接端口");
		}
		this.server = server;
		this.port = address.port;
		await this.options.spool.writeBridgeInfoAsync({
			version: 1,
			protocolVersion: AI_BRIDGE_PROTOCOL_VERSION,
			port: this.port,
			token: this.token,
			pid: process.pid,
			vaultRoot: this.options.spool.vaultRoot,
			pluginVersion: this.options.pluginVersion ?? "",
			startedAt: this.now(),
		});
	}

	async stop(): Promise<void> {
		this.stopped = true;
		const token = this.token;
		this.options.spool.removeBridgeInfo(token || undefined);
		const server = this.server;
		this.server = undefined;
		this.port = 0;
		if (!server) return;
		await new Promise<void>(resolve => {
			server.close(() => resolve());
		});
	}

	private async handleRequest(req: Http.IncomingMessage, res: Http.ServerResponse): Promise<void> {
		try {
			if (!this.authorize(req)) {
				this.sendJson(res, 401, new AiNoteError("INVALID_REQUEST", "本地桥接鉴权失败").toJSON());
				return;
			}
			const url = req.url ?? "/";
			if (req.method === "GET" && url === "/health") {
				this.sendJson(res, 200, {
					ok: true,
					protocolVersion: AI_BRIDGE_PROTOCOL_VERSION,
					pluginVersion: this.options.pluginVersion ?? "",
					pid: process.pid,
					vaultRoot: this.options.spool.vaultRoot,
				});
				return;
			}
			if (req.method !== "POST") {
				this.sendJson(res, 405, new AiNoteError("INVALID_REQUEST", "不支持的请求方法").toJSON());
				return;
			}
			const body = await readJsonBody(req);
			if (url === "/read") {
				this.sendJson(res, 200, await this.handleRead(body));
				return;
			}
			if (url === "/write") {
				this.sendJson(res, 200, await this.handleWrite(body));
				return;
			}
			if (url === "/patch") {
				this.sendJson(res, 200, await this.handlePatch(body));
				return;
			}
			if (url === "/backups/list") {
				this.sendJson(res, 200, await this.handleListBackups(body));
				return;
			}
			if (url === "/backups/restore") {
				this.sendJson(res, 200, await this.handleRestore(body));
				return;
			}
			this.sendJson(res, 404, new AiNoteError("INVALID_REQUEST", "未知的桥接接口").toJSON());
		} catch (error) {
			if (error instanceof AiNoteError) {
				this.sendJson(res, 200, error.toJSON());
				return;
			}
			const message = error instanceof Error ? error.message : String(error);
			this.sendJson(res, 500, new AiNoteError("IO_ERROR", message).toJSON());
		}
	}

	private authorize(req: Http.IncomingMessage): boolean {
		const header = req.headers.authorization;
		if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
		const provided = Buffer.from(header.slice(7), "utf8");
		const expected = Buffer.from(this.token, "utf8");
		return provided.length === expected.length && this.crypto.timingSafeEqual(provided, expected);
	}

	private async handleRead(body: Record<string, unknown>): Promise<Record<string, unknown>> {
		const requestedPath = body.path;
		if (!isAiNotePath(requestedPath)) {
			throw new AiNoteError("PATH_INVALID", "需要库内 Markdown 笔记的相对路径");
		}
		const policy = this.options.policy();
		const file = this.findMarkdownFile(requestedPath);
		const canonicalPath = file?.path ?? requestedPath;
		const content = file ? await (this.options.vault as BridgeVault).read(file) : "";
		const exists = !!file;
		const sha = this.sha256(content);
		const eol = detectNoteEol(content);
		const slice = sliceNoteLines(
			content,
			typeof body.startLine === "number" ? body.startLine : undefined,
			typeof body.endLine === "number" ? body.endLine : undefined,
		);
		const permission = evaluateWritePermission(canonicalPath, policy, this.caseInsensitive);
		const activeCheck = exists && this.options.checkActiveEditor
			? this.options.checkActiveEditor(canonicalPath, content)
			: { active: false };
		return {
			ok: true,
			path: canonicalPath,
			content: slice.content,
			beforeSha256: sha,
			exists,
			lineCount: slice.totalLines,
			startLine: slice.startLine,
			endLine: slice.endLine,
			truncated: slice.truncated,
			eol: eol === "\r\n" ? "crlf" : "lf",
			sizeBytes: Buffer.byteLength(content, "utf8"),
			writable: permission.allowed,
			...(permission.allowed ? {} : { writeDeniedCode: permission.code, writeDeniedReason: permission.reason }),
			trackedForStatistics: policy.enabled && isNoteInCollectionScope(canonicalPath, policy.trackedFolders, policy.trackedFiles, this.caseInsensitive),
			activeInEditor: activeCheck.active,
			...(activeCheck.reason ? { activeEditorReason: activeCheck.reason } : {}),
			channel: "obsidian-bridge",
		};
	}

	private async handleWrite(body: Record<string, unknown>): Promise<AiNoteWriteResult> {
		const requestedPath = body.path;
		const content = body.content;
		const beforeSha256 = body.beforeSha256;
		const source = body.source;
		const mode = body.mode === "create" || body.mode === "replace" ? body.mode : undefined;
		const preserveEol = body.preserveEol !== false;
		const confirmDestructive = body.confirmDestructive === true;

		if (!isAiEditSource(source)) throw new AiNoteError("INVALID_REQUEST", "AI 编辑来源名称无效");
		if (!isAiNotePath(requestedPath) || typeof content !== "string" || typeof beforeSha256 !== "string" || !/^[0-9a-f]{64}$/.test(beforeSha256)) {
			throw new AiNoteError("INVALID_REQUEST", "写入需要有效路径、Markdown 内容与读取时的 SHA-256 摘要");
		}
		return this.serializePath(requestedPath, () =>
			this.executeMutation({
				operation: "write",
				source,
				requestedPath,
				beforeSha256,
				mode,
				confirmDestructive,
				computeNext: (beforeContent, exists) => {
					let next = content;
					if (preserveEol && exists && beforeContent.length > 0) {
						next = restoreLineEndings(next, detectNoteEol(beforeContent));
					}
					return next;
				},
			})
		);
	}

	private async handlePatch(body: Record<string, unknown>): Promise<AiNoteWriteResult> {
		const requestedPath = body.path;
		const edits = body.edits as readonly NotePatchEdit[] | undefined;
		const beforeSha256 = body.beforeSha256;
		const source = body.source;
		const preserveEol = body.preserveEol !== false;
		const confirmDestructive = body.confirmDestructive === true;

		if (!isAiEditSource(source)) throw new AiNoteError("INVALID_REQUEST", "AI 编辑来源名称无效");
		if (!isAiNotePath(requestedPath) || !Array.isArray(edits) || typeof beforeSha256 !== "string" || !/^[0-9a-f]{64}$/.test(beforeSha256)) {
			throw new AiNoteError("INVALID_REQUEST", "局部补丁需要有效路径、edits 数组与读取时的 SHA-256 摘要");
		}
		return this.serializePath(requestedPath, () =>
			this.executeMutation({
				operation: "patch",
				source,
				requestedPath,
				beforeSha256,
				mode: "replace",
				confirmDestructive,
				computeNext: (beforeContent) => applyNotePatches(beforeContent, edits, preserveEol).content,
			})
		);
	}

	private async handleListBackups(body: Record<string, unknown>): Promise<Record<string, unknown>> {
		const pathFilter = typeof body.path === "string" && body.path.trim() ? body.path : undefined;
		const limit = typeof body.limit === "number" && Number.isSafeInteger(body.limit) ? body.limit : 20;
		const backups = await this.options.spool.listBackups(pathFilter, limit);
		return { ok: true, backups, channel: "obsidian-bridge" };
	}

	private async handleRestore(body: Record<string, unknown>): Promise<AiNoteWriteResult> {
		const backupId = body.backupId;
		const beforeSha256 = body.beforeSha256;
		const source = body.source;
		if (!isAiEditSource(source)) throw new AiNoteError("INVALID_REQUEST", "AI 编辑来源名称无效");
		if (typeof backupId !== "string" || typeof beforeSha256 !== "string" || !/^[0-9a-f]{64}$/.test(beforeSha256)) {
			throw new AiNoteError("INVALID_REQUEST", "恢复备份需要有效的 backupId 与当前笔记的 SHA-256 摘要");
		}
		const backup = await this.options.spool.readBackup(backupId);
		if (!backup) throw new AiNoteError("BACKUP_NOT_FOUND", `未找到指定的备份快照：${backupId}`);
		return this.serializePath(backup.meta.path, () =>
			this.executeMutation({
				operation: "restore",
				source,
				requestedPath: backup.meta.path,
				beforeSha256,
				confirmDestructive: true,
				computeNext: () => backup.content,
			})
		);
	}

	private async executeMutation(input: {
		operation: "write" | "patch" | "restore";
		source: string;
		requestedPath: string;
		beforeSha256: string;
		mode?: "create" | "replace";
		confirmDestructive: boolean;
		computeNext: (beforeContent: string, exists: boolean) => string;
	}): Promise<AiNoteWriteResult> {
		const policy = this.options.policy();
		const vault = this.options.vault as BridgeVault;
		const existingFile = this.findMarkdownFile(input.requestedPath);
		const notePath = existingFile?.path ?? input.requestedPath;

		const permission = evaluateWritePermission(notePath, policy, this.caseInsensitive);
		if (!permission.allowed) {
			throw new AiNoteError(permission.code, permission.reason, { noteModified: false, retrySafe: false });
		}
		if (input.mode === "create" && existingFile) {
			throw new AiNoteError("NOTE_ALREADY_EXISTS", "目标笔记已存在，不能使用 create 模式覆盖", { noteModified: false, retrySafe: false });
		}
		if (input.mode === "replace" && !existingFile) {
			throw new AiNoteError("NOTE_NOT_FOUND", `目标笔记不存在：${notePath}`, { noteModified: false, retrySafe: false });
		}

		const initialContent = existingFile ? await vault.read(existingFile) : "";
		const initialSha = this.sha256(initialContent);
		if (initialSha !== input.beforeSha256) {
			throw new AiNoteError("STALE_VERSION", "AI 编辑的原始版本已变化，请重新读取后再提交", {
				noteModified: false,
				retrySafe: true,
				details: { expectedSha256: input.beforeSha256, currentSha256: initialSha },
			});
		}

		if (existingFile && this.options.checkActiveEditor) {
			const active = this.options.checkActiveEditor(notePath, initialContent);
			if (active.active) {
				throw new AiNoteError(
					"NOTE_ACTIVE_IN_EDITOR",
					active.reason || "该笔记正在 Obsidian 编辑器中活跃编辑，已拒绝 AI 写入以保护未保存修改",
					{ noteModified: false, retrySafe: true },
				);
			}
		}

		const candidateContent = input.computeNext(initialContent, !!existingFile);
		const maxBytes = resolveAiWritePolicy(policy).maxNoteBytes ?? DEFAULT_MAX_NOTE_BYTES;
		const afterBytes = Buffer.byteLength(candidateContent, "utf8");
		if (afterBytes > maxBytes) {
			throw new AiNoteError("NOTE_TOO_LARGE", `笔记体积 ${afterBytes} 字节超过上限 ${maxBytes} 字节`);
		}
		if (existingFile && initialContent === candidateContent) {
			return {
				ok: true,
				status: "unchanged",
				noteStatus: "unchanged",
				statisticsStatus: "skipped",
				statisticsReason: "no-counted-changes",
				path: notePath,
				beforeSha256: initialSha,
				afterSha256: initialSha,
				channel: "obsidian-bridge",
				retrySafe: true,
			};
		}
		if (existingFile && input.operation !== "restore") {
			verifyNoteIntegrity(initialContent, candidateContent, {
				operation: input.operation,
				confirmDestructive: input.confirmDestructive,
				writePolicy: resolveAiWritePolicy(policy),
			});
		}

		const afterSha = this.sha256(candidateContent);
		const backupId = await this.options.spool.saveBackup({
			path: notePath,
			source: input.source,
			operation: input.operation,
			createdAt: this.now(),
			existed: !!existingFile,
			beforeSha256: initialSha,
			afterSha256: afterSha,
			beforeBytes: Buffer.byteLength(initialContent, "utf8"),
			afterBytes,
		}, initialContent);

		let actualBefore = initialContent;
		let actualAfter = candidateContent;
		if (existingFile) {
			if (typeof vault.process === "function") {
				await vault.process(existingFile, current => {
					const currentSha = this.sha256(current);
					if (currentSha !== input.beforeSha256) {
						throw new AiNoteError("STALE_VERSION", "AI 编辑的原始版本在提交瞬间已变化，请重新读取后再提交", {
							noteModified: false,
							retrySafe: true,
							details: { expectedSha256: input.beforeSha256, currentSha256: currentSha },
						});
					}
					actualBefore = current;
					actualAfter = input.computeNext(current, true);
					if (input.operation !== "restore") {
						verifyNoteIntegrity(actualBefore, actualAfter, {
							operation: input.operation,
							confirmDestructive: input.confirmDestructive,
							writePolicy: resolveAiWritePolicy(policy),
						});
					}
					return actualAfter;
				});
			} else {
				await vault.modify(existingFile, candidateContent);
			}
		} else {
			await this.ensureParentFolders(notePath);
			await vault.create(notePath, candidateContent);
		}

		return this.finalizeStatisticsAndAudit(input.operation, input.source, notePath, actualBefore, actualAfter, backupId, policy);
	}

	private async finalizeStatisticsAndAudit(
		operation: "write" | "patch" | "restore",
		source: string,
		path: string,
		beforeContent: string,
		afterContent: string,
		backupId: string,
		policy: AiEditPolicy,
	): Promise<AiNoteWriteResult> {
		const beforeSha = this.sha256(beforeContent);
		const afterSha = this.sha256(afterContent);
		const skip = async (reason: StatisticsSkipReason): Promise<AiNoteWriteResult> => {
			const result: AiNoteWriteResult = {
				ok: true,
				status: "committed-without-statistics",
				noteStatus: "committed",
				statisticsStatus: "skipped",
				statisticsReason: reason,
				reason,
				path,
				beforeSha256: beforeSha,
				afterSha256: afterSha,
				backupId,
				channel: "obsidian-bridge",
				retrySafe: false,
			};
			await this.recordAudit(operation, this.crypto.randomUUID(), source, result);
			return result;
		};

		if (!policy.enabled) return skip("disabled");
		if (!isNoteInCollectionScope(path, policy.trackedFolders, policy.trackedFiles, this.caseInsensitive)) return skip("out-of-scope");

		let changes: AiNoteChanges;
		try {
			changes = calculateAiNoteChanges(beforeContent, afterContent, policy);
		} catch {
			return skip("unavailable");
		}
		if (changes.addedChars + changes.deletedChars === 0) return skip("no-counted-changes");

		const occurredAt = this.now();
		const event: AiEditEvent = {
			version: 1,
			id: this.crypto.randomUUID(),
			source,
			path,
			occurredAt,
			date: formatAiEditDate(occurredAt),
			generation: policy.generation,
			addedChars: changes.addedChars,
			deletedChars: changes.deletedChars,
		};

		try {
			await this.options.saveEvents([event]);
			const result: AiNoteWriteResult = {
				ok: true,
				status: "committed",
				noteStatus: "committed",
				statisticsStatus: "recorded",
				statisticsReason: "in-scope",
				path,
				beforeSha256: beforeSha,
				afterSha256: afterSha,
				backupId,
				channel: "obsidian-bridge",
				changes,
				event,
				retrySafe: false,
			};
			await this.recordAudit(operation, event.id, source, result);
			return result;
		} catch (error) {
			let queued = false;
			try {
				this.options.spool.queue(event);
				queued = true;
			} catch { /* fallback handled by warning */ }
			const result: AiNoteWriteResult = {
				ok: true,
				status: "committed-pending-statistics",
				noteStatus: "committed",
				statisticsStatus: queued ? "queued" : "pending_recovery",
				statisticsReason: "in-scope",
				path,
				beforeSha256: beforeSha,
				afterSha256: afterSha,
				backupId,
				channel: "obsidian-bridge",
				changes,
				event,
				retrySafe: false,
				warnings: [`正文已通过 Obsidian 写入，但实时统计入账失败（${queued ? "已转入本机队列等待补录" : "请检查统计存储"}）：${error instanceof Error ? error.message : String(error)}`],
			};
			await this.recordAudit(operation, event.id, source, result);
			return result;
		}
	}

	private async recordAudit(operation: "write" | "patch" | "restore", id: string, source: string, result: AiNoteWriteResult): Promise<void> {
		const entry: AiAuditEntry = {
			at: this.now(),
			id,
			operation,
			source,
			path: result.path,
			channel: "obsidian-bridge",
			noteStatus: result.noteStatus,
			statisticsStatus: result.statisticsStatus,
			...(result.statisticsReason ? { statisticsReason: result.statisticsReason } : {}),
			beforeSha256: result.beforeSha256,
			afterSha256: result.afterSha256,
			...(result.backupId ? { backupId: result.backupId } : {}),
			...(result.changes ? { addedChars: result.changes.addedChars, deletedChars: result.changes.deletedChars } : {}),
		};
		await this.options.spool.appendAudit(entry).catch(() => undefined);
	}

	private findMarkdownFile(notePath: string): TFile | undefined {
		const vault = this.options.vault as BridgeVault;
		const exact = vault.getAbstractFileByPath(notePath) as TFile | null | undefined;
		if (exact && typeof exact.path === "string" && "extension" in exact) return exact;
		if (!this.caseInsensitive || typeof vault.getMarkdownFiles !== "function") return undefined;
		const target = pathCompareKey(notePath, true);
		return vault.getMarkdownFiles().find(file => pathCompareKey(file.path, true) === target);
	}

	private async ensureParentFolders(notePath: string): Promise<void> {
		const vault = this.options.vault as BridgeVault;
		const parts = notePath.split("/").slice(0, -1);
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!vault.getAbstractFileByPath(current)) {
				try { await vault.createFolder(current); }
				catch { /* ignore already exists race */ }
			}
		}
	}

	private serializePath<T>(path: string, task: () => Promise<T>): Promise<T> {
		const key = pathCompareKey(path, this.caseInsensitive);
		const previous = this.pathQueues.get(key) ?? Promise.resolve();
		const run = previous.catch(() => undefined).then(task);
		const tail = run.then(() => undefined, () => undefined);
		this.pathQueues.set(key, tail);
		void tail.finally(() => {
			if (this.pathQueues.get(key) === tail) this.pathQueues.delete(key);
		});
		return run;
	}

	private sha256(value: string): string {
		return this.crypto.createHash("sha256").update(value, "utf8").digest("hex");
	}

	private sendJson(res: Http.ServerResponse, statusCode: number, payload: unknown): void {
		const text = JSON.stringify(payload);
		res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
		res.end(text);
	}
}

function readJsonBody(req: Http.IncomingMessage): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let total = 0;
		req.on("data", (chunk: Buffer) => {
			total += chunk.length;
			if (total > MAX_BODY_BYTES) {
				req.destroy();
				reject(new AiNoteError("NOTE_TOO_LARGE", "请求体超过大小上限"));
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				const raw = Buffer.concat(chunks).toString("utf8");
				const parsed = raw ? JSON.parse(raw) : {};
				if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
					reject(new AiNoteError("INVALID_REQUEST", "请求体必须是 JSON 对象"));
					return;
				}
				resolve(parsed as Record<string, unknown>);
			} catch {
				reject(new AiNoteError("INVALID_REQUEST", "请求 JSON 解析失败"));
			}
		});
		req.on("error", reject);
	});
}
