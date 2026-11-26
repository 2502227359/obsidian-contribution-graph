import { createHash, randomUUID } from "node:crypto";
import { AiNoteChanges, calculateAiNoteChanges } from "./aiNoteDiff";
import { applyNotePatches, detectNoteEol, NotePatchEdit, restoreLineEndings, verifyNoteIntegrity } from "./aiNotePatch";
import {
	AiAuditEntry,
	AiEditEvent,
	AiEditPolicy,
	AiEditReceipt,
	AiNoteBackupMeta,
	AiNoteError,
	DEFAULT_MAX_NOTE_BYTES,
	DEFAULT_RECEIPT_TTL_MS,
	evaluateWritePermission,
	formatAiEditDate,
	isAiEditSource,
	isNoteInCollectionScope,
	parseAiEditReceipt,
	pathCompareKey,
	resolveAiWritePolicy,
} from "./aiEditProtocol";

export type { AiEditReceipt } from "./aiEditProtocol";

export interface AiNoteSnapshot {
	content: string;
	revision: string;
	digest: string;
	exists?: boolean;
	mtimeMs?: number;
	canonicalPath?: string;
	backupId?: string;
	verified?: boolean;
	verifyWarning?: string;
}

export interface AiNoteCommitContext {
	operation: "write" | "patch" | "restore";
	source: string;
	before: AiNoteSnapshot;
	backupId?: string;
}

export interface AiNoteStore {
	readNote(path: string): Promise<AiNoteSnapshot>;
	commitNote(path: string, content: string, expectedRevision: string, context?: AiNoteCommitContext): Promise<AiNoteSnapshot>;
	prepareReceipt(receipt: AiEditReceipt): Promise<void>;
	listReceipts(): Promise<readonly AiEditReceipt[]>;
	commitEvent(event: AiEditEvent): Promise<void>;
	removeReceipt(id: string): Promise<void>;
	quarantineReceipt?(id: string, reason: "invalid" | "duplicate" | "expired"): Promise<void>;
	withRecoveryLock?<T>(fn: () => Promise<T>): Promise<T>;
	listBackups?(path?: string, limit?: number): Promise<readonly AiNoteBackupMeta[]>;
	readBackup?(backupId: string): Promise<{ meta: AiNoteBackupMeta; content: string } | undefined>;
	appendAudit?(entry: AiAuditEntry): Promise<void>;
}

export interface AiNoteWriteRequest {
	path: string;
	content: string;
	expectedRevision?: string;
	beforeSha256?: string;
	mode?: "create" | "replace";
	preserveEol?: boolean;
	confirmDestructive?: boolean;
	occurredAt?: number;
}

export interface AiNotePatchRequest {
	path: string;
	edits: readonly NotePatchEdit[];
	expectedRevision?: string;
	beforeSha256?: string;
	preserveEol?: boolean;
	confirmDestructive?: boolean;
	occurredAt?: number;
}

export interface AiNoteRestoreRequest {
	backupId: string;
	expectedRevision?: string;
	beforeSha256?: string;
	occurredAt?: number;
}

export interface AiNoteWriterOptions {
	policy: AiEditPolicy;
	source: string;
	store: AiNoteStore;
	now?: () => number;
	newId?: () => string;
	caseInsensitivePaths?: boolean;
	channel?: "obsidian-bridge" | "disk";
	receiptTtlMs?: number;
}

export type NoteWriteStatus = "committed" | "unchanged" | "not_written";
export type StatisticsWriteStatus = "recorded" | "queued" | "skipped" | "pending_recovery";
export type StatisticsSkipReason = "disabled" | "out-of-scope" | "no-counted-changes" | "unavailable";

export interface AiNoteWriteResult {
	ok: true;
	status: "unchanged" | "committed" | "committed-without-statistics" | "committed-pending-statistics";
	noteStatus: NoteWriteStatus;
	statisticsStatus: StatisticsWriteStatus;
	statisticsReason?: StatisticsSkipReason | "in-scope";
	reason?: StatisticsSkipReason;
	path: string;
	beforeSha256: string;
	afterSha256: string;
	backupId?: string;
	channel: "obsidian-bridge" | "disk";
	changes?: AiNoteChanges;
	event?: AiEditEvent;
	retrySafe: boolean;
	warnings?: string[];
}

export class AiNoteWriter {
	private readonly now: () => number;
	private readonly newId: () => string;
	private readonly options: AiNoteWriterOptions;
	private readonly caseInsensitive: boolean;
	private readonly channel: "obsidian-bridge" | "disk";
	private readonly receiptTtlMs: number;

	constructor(options: AiNoteWriterOptions) {
		this.options = options;
		if (!isAiEditSource(options.source)) {
			throw new AiNoteError("INVALID_REQUEST", "AI 编辑来源名称无效");
		}
		this.now = options.now ?? (() => Date.now());
		this.newId = options.newId ?? randomUUID;
		this.caseInsensitive = options.caseInsensitivePaths ?? (process.platform === "win32");
		this.channel = options.channel ?? "disk";
		this.receiptTtlMs = options.receiptTtlMs ?? DEFAULT_RECEIPT_TTL_MS;
	}

	async write(request: AiNoteWriteRequest): Promise<AiNoteWriteResult> {
		this.assertWritablePath(request.path);
		const before = await this.options.store.readNote(request.path);
		const notePath = before.canonicalPath || request.path;
		this.assertWritablePath(notePath);
		this.assertExpectedVersion(before, request.expectedRevision ?? request.beforeSha256, request.mode);

		let targetContent = request.content;
		if (request.preserveEol !== false && before.exists !== false && before.content.length > 0) {
			targetContent = restoreLineEndings(targetContent, detectNoteEol(before.content));
		}
		this.assertMaxSize(targetContent);

		if (before.exists !== false && before.content === targetContent) {
			return this.unchangedResult(notePath, before);
		}
		const integrityWarnings = before.exists === false
			? []
			: verifyNoteIntegrity(before.content, targetContent, {
				operation: "write",
				confirmDestructive: request.confirmDestructive,
				writePolicy: resolveAiWritePolicy(this.options.policy),
			});

		return this.commitAndTrack({
			operation: "write",
			path: notePath,
			before,
			content: targetContent,
			occurredAt: request.occurredAt,
			warnings: integrityWarnings,
		});
	}

	async patch(request: AiNotePatchRequest): Promise<AiNoteWriteResult> {
		this.assertWritablePath(request.path);
		const before = await this.options.store.readNote(request.path);
		const notePath = before.canonicalPath || request.path;
		this.assertWritablePath(notePath);
		if (before.exists === false) {
			throw new AiNoteError("NOTE_NOT_FOUND", `目标笔记不存在，无法应用补丁：${notePath}`);
		}
		this.assertExpectedVersion(before, request.expectedRevision ?? request.beforeSha256, "replace");

		const patched = applyNotePatches(before.content, request.edits, request.preserveEol !== false);
		this.assertMaxSize(patched.content);

		if (patched.content === before.content) {
			return this.unchangedResult(notePath, before);
		}
		const integrityWarnings = verifyNoteIntegrity(before.content, patched.content, {
			operation: "patch",
			confirmDestructive: request.confirmDestructive,
			writePolicy: resolveAiWritePolicy(this.options.policy),
		});

		return this.commitAndTrack({
			operation: "patch",
			path: notePath,
			before,
			content: patched.content,
			occurredAt: request.occurredAt,
			warnings: integrityWarnings,
		});
	}

	async restore(request: AiNoteRestoreRequest): Promise<AiNoteWriteResult> {
		if (!this.options.store.readBackup) {
			throw new AiNoteError("IO_ERROR", "当前存储未启用备份恢复能力");
		}
		const backup = await this.options.store.readBackup(request.backupId);
		if (!backup) {
			throw new AiNoteError("BACKUP_NOT_FOUND", `未找到指定的备份快照：${request.backupId}`);
		}
		const notePath = backup.meta.path;
		this.assertWritablePath(notePath);
		const before = await this.options.store.readNote(notePath);
		this.assertExpectedVersion(before, request.expectedRevision ?? request.beforeSha256);
		this.assertMaxSize(backup.content);

		if (before.exists !== false && before.content === backup.content) {
			return this.unchangedResult(notePath, before);
		}
		return this.commitAndTrack({
			operation: "restore",
			path: notePath,
			before,
			content: backup.content,
			occurredAt: request.occurredAt,
			warnings: [],
		});
	}

	async recover(): Promise<number> {
		const run = async () => this.recoverUnlocked();
		return this.options.store.withRecoveryLock ? this.options.store.withRecoveryLock(run) : run();
	}

	private async recoverUnlocked(): Promise<number> {
		const rawReceipts = await this.options.store.listReceipts();
		if (rawReceipts.length === 0) return 0;

		const now = this.now();
		const valid: AiEditReceipt[] = [];
		for (const item of rawReceipts) {
			const parsed = parseAiEditReceipt(item);
			if (parsed) valid.push(parsed);
		}
		if (valid.length === 0) return 0;

		const snapshotCache = new Map<string, AiNoteSnapshot>();
		const readCached = async (path: string): Promise<AiNoteSnapshot> => {
			const key = pathCompareKey(path, this.caseInsensitive);
			let snapshot = snapshotCache.get(key);
			if (!snapshot) {
				snapshot = await this.options.store.readNote(path);
				snapshotCache.set(key, snapshot);
			}
			return snapshot;
		};

		const matchedByTarget = new Map<string, AiEditReceipt[]>();
		for (const receipt of valid) {
			const current = await readCached(receipt.event.path);
			if (current.exists !== false && current.digest === receipt.afterDigest) {
				const groupKey = `${pathCompareKey(receipt.event.path, this.caseInsensitive)}::${receipt.afterDigest}`;
				const group = matchedByTarget.get(groupKey) ?? [];
				group.push(receipt);
				matchedByTarget.set(groupKey, group);
			} else if (receipt.createdAt !== undefined && now - receipt.createdAt > this.receiptTtlMs) {
				await this.quarantineOrRemove(receipt.id, "expired");
			}
		}

		let recovered = 0;
		for (const group of matchedByTarget.values()) {
			group.sort((a, b) =>
				(b.createdAt ?? b.event.occurredAt) - (a.createdAt ?? a.event.occurredAt) ||
				b.id.localeCompare(a.id)
			);
			const winner = group[0];
			await this.options.store.commitEvent(winner.event);
			await this.options.store.removeReceipt(winner.id);
			recovered++;
			for (const duplicate of group.slice(1)) {
				await this.quarantineOrRemove(duplicate.id, "duplicate");
			}
		}
		return recovered;
	}

	private async quarantineOrRemove(id: string, reason: "invalid" | "duplicate" | "expired"): Promise<void> {
		if (this.options.store.quarantineReceipt) {
			await this.options.store.quarantineReceipt(id, reason);
		} else {
			await this.options.store.removeReceipt(id);
		}
	}

	private assertWritablePath(path: string): void {
		const permission = evaluateWritePermission(path, this.options.policy, this.caseInsensitive);
		if (!permission.allowed) {
			throw new AiNoteError(permission.code, permission.reason, { noteModified: false, retrySafe: false });
		}
	}

	private assertExpectedVersion(before: AiNoteSnapshot, expectedRevision: string | undefined, mode?: "create" | "replace"): void {
		if (mode === "create" && before.exists !== false) {
			throw new AiNoteError("NOTE_ALREADY_EXISTS", "目标笔记已存在，不能使用 create 模式覆盖", {
				noteModified: false,
				retrySafe: false,
				details: { currentSha256: before.digest },
			});
		}
		if (mode === "replace" && before.exists === false) {
			throw new AiNoteError("NOTE_NOT_FOUND", "目标笔记不存在，请先确认路径或使用 create 模式新建", {
				noteModified: false,
				retrySafe: false,
			});
		}
		if (expectedRevision !== undefined && expectedRevision !== before.revision) {
			throw new AiNoteError("STALE_VERSION", "AI 编辑的原始版本已变化，请重新读取后再提交", {
				noteModified: false,
				retrySafe: true,
				details: { expectedSha256: expectedRevision, currentSha256: before.digest },
			});
		}
	}

	private assertMaxSize(content: string): void {
		const maxBytes = resolveAiWritePolicy(this.options.policy).maxNoteBytes ?? DEFAULT_MAX_NOTE_BYTES;
		const bytes = Buffer.byteLength(content, "utf8");
		if (bytes > maxBytes) {
			throw new AiNoteError("NOTE_TOO_LARGE", `笔记体积 ${bytes} 字节超过上限 ${maxBytes} 字节`, {
				noteModified: false,
				retrySafe: false,
				details: { bytes, maxBytes },
			});
		}
	}

	private unchangedResult(path: string, before: AiNoteSnapshot): AiNoteWriteResult {
		return {
			ok: true,
			status: "unchanged",
			noteStatus: "unchanged",
			statisticsStatus: "skipped",
			statisticsReason: "no-counted-changes",
			path,
			beforeSha256: before.digest,
			afterSha256: before.digest,
			channel: this.channel,
			retrySafe: true,
		};
	}

	private async commitAndTrack(input: {
		operation: "write" | "patch" | "restore";
		path: string;
		before: AiNoteSnapshot;
		content: string;
		occurredAt?: number;
		warnings: string[];
	}): Promise<AiNoteWriteResult> {
		const policy = this.options.policy;
		const afterDigest = digest(input.content);
		const backupId = this.newId();
		const commitContext: AiNoteCommitContext = {
			operation: input.operation,
			source: this.options.source,
			before: input.before,
			backupId,
		};

		if (!policy.enabled) {
			return this.commitWithoutStatistics(input, afterDigest, commitContext, "disabled");
		}
		if (!isNoteInCollectionScope(input.path, policy.trackedFolders, policy.trackedFiles, this.caseInsensitive)) {
			return this.commitWithoutStatistics(input, afterDigest, commitContext, "out-of-scope");
		}

		let changes: AiNoteChanges;
		try {
			changes = calculateAiNoteChanges(input.before.content, input.content, policy);
		} catch {
			return this.commitWithoutStatistics(input, afterDigest, commitContext, "unavailable");
		}
		if (changes.addedChars + changes.deletedChars === 0) {
			return this.commitWithoutStatistics(input, afterDigest, commitContext, "no-counted-changes");
		}

		return this.commitWithStatistics(input, afterDigest, commitContext, changes);
	}

	private async commitWithoutStatistics(
		input: { operation: "write" | "patch" | "restore"; path: string; before: AiNoteSnapshot; content: string; warnings: string[] },
		afterDigest: string,
		commitContext: AiNoteCommitContext,
		reason: StatisticsSkipReason,
	): Promise<AiNoteWriteResult> {
		const committedSnapshot = await this.options.store.commitNote(input.path, input.content, input.before.revision, commitContext);
		const warnings = [...input.warnings, ...(committedSnapshot.verifyWarning ? [committedSnapshot.verifyWarning] : [])];
		const result: AiNoteWriteResult = {
			ok: true,
			status: "committed-without-statistics",
			noteStatus: "committed",
			statisticsStatus: "skipped",
			statisticsReason: reason,
			reason,
			path: input.path,
			beforeSha256: input.before.digest,
			afterSha256: committedSnapshot.digest || afterDigest,
			backupId: committedSnapshot.backupId,
			channel: this.channel,
			retrySafe: false,
			...(warnings.length ? { warnings } : {}),
		};
		await this.recordAudit(input.operation, this.newId(), result);
		return result;
	}

	private async commitWithStatistics(
		input: { operation: "write" | "patch" | "restore"; path: string; before: AiNoteSnapshot; content: string; occurredAt?: number; warnings: string[] },
		afterDigest: string,
		commitContext: AiNoteCommitContext,
		changes: AiNoteChanges,
	): Promise<AiNoteWriteResult> {
		const occurredAt = input.occurredAt ?? this.now();
		if (!Number.isSafeInteger(occurredAt) || occurredAt < 0) {
			throw new AiNoteError("INVALID_REQUEST", "AI 编辑时间无效");
		}
		const event: AiEditEvent = {
			version: 1,
			id: this.newId(),
			source: this.options.source,
			path: input.path,
			occurredAt,
			date: formatAiEditDate(occurredAt),
			generation: this.options.policy.generation,
			addedChars: changes.addedChars,
			deletedChars: changes.deletedChars,
		};
		await this.options.store.prepareReceipt({
			version: 1,
			id: event.id,
			event,
			afterDigest,
			beforeDigest: input.before.digest,
			createdAt: this.now(),
			...(input.before.mtimeMs !== undefined ? { baseMtimeMs: input.before.mtimeMs } : {}),
		});

		let committedSnapshot: AiNoteSnapshot;
		try {
			committedSnapshot = await this.options.store.commitNote(input.path, input.content, input.before.revision, commitContext);
		} catch (error) {
			await this.options.store.removeReceipt(event.id).catch(() => undefined);
			throw error;
		}

		const warnings = [...input.warnings];
		if (committedSnapshot.verifyWarning) {
			warnings.push(committedSnapshot.verifyWarning);
		} else if (committedSnapshot.verified !== false && committedSnapshot.digest !== afterDigest) {
			warnings.push("落盘后文件内容摘要与写入预期不一致，可能已被其他程序立即修改；统计回执暂保留待核验。");
			const pendingResult: AiNoteWriteResult = {
				ok: true,
				status: "committed-pending-statistics",
				noteStatus: "committed",
				statisticsStatus: "pending_recovery",
				statisticsReason: "in-scope",
				path: input.path,
				beforeSha256: input.before.digest,
				afterSha256: committedSnapshot.digest,
				backupId: committedSnapshot.backupId,
				channel: this.channel,
				changes,
				event,
				retrySafe: false,
				warnings,
			};
			await this.recordAudit(input.operation, event.id, pendingResult);
			return pendingResult;
		}

		try {
			await this.options.store.commitEvent(event);
			await this.options.store.removeReceipt(event.id).catch(() => undefined);
		} catch (error) {
			warnings.push(`正文已落盘，但统计事件入队失败（已保留待恢复回执，请勿重复写入）：${error instanceof Error ? error.message : String(error)}`);
			const pendingResult: AiNoteWriteResult = {
				ok: true,
				status: "committed-pending-statistics",
				noteStatus: "committed",
				statisticsStatus: "pending_recovery",
				statisticsReason: "in-scope",
				path: input.path,
				beforeSha256: input.before.digest,
				afterSha256: afterDigest,
				backupId: committedSnapshot.backupId,
				channel: this.channel,
				changes,
				event,
				retrySafe: false,
				warnings,
			};
			await this.recordAudit(input.operation, event.id, pendingResult);
			return pendingResult;
		}

		const result: AiNoteWriteResult = {
			ok: true,
			status: "committed",
			noteStatus: "committed",
			statisticsStatus: this.channel === "obsidian-bridge" ? "recorded" : "queued",
			statisticsReason: "in-scope",
			path: input.path,
			beforeSha256: input.before.digest,
			afterSha256: afterDigest,
			backupId: committedSnapshot.backupId,
			channel: this.channel,
			changes,
			event,
			retrySafe: false,
			...(warnings.length ? { warnings } : {}),
		};
		await this.recordAudit(input.operation, event.id, result);
		return result;
	}

	private async recordAudit(operation: "write" | "patch" | "restore", id: string, result: AiNoteWriteResult): Promise<void> {
		if (!this.options.store.appendAudit) return;
		try {
			await this.options.store.appendAudit({
				at: this.now(),
				id,
				operation,
				source: this.options.source,
				path: result.path,
				channel: result.channel,
				noteStatus: result.noteStatus,
				statisticsStatus: result.statisticsStatus,
				...(result.statisticsReason ? { statisticsReason: result.statisticsReason } : {}),
				beforeSha256: result.beforeSha256,
				afterSha256: result.afterSha256,
				...(result.backupId ? { backupId: result.backupId } : {}),
				...(result.changes ? { addedChars: result.changes.addedChars, deletedChars: result.changes.deletedChars } : {}),
			});
		} catch {
			// Audit logging must never mask a committed note write.
		}
	}
}

function digest(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}
