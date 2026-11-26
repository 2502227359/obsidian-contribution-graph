import type * as FileSystem from "fs";
import type * as Paths from "path";
import type * as Crypto from "crypto";

export const AI_EDIT_BRIDGE = Symbol.for("contribution-graph-local:record-ai-note-edit");
export const AI_EDIT_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const AI_BRIDGE_PROTOCOL_VERSION = 2;
export const DEFAULT_MAX_NOTE_BYTES = 16 * 1024 * 1024;
export const DEFAULT_DESTRUCTIVE_DELETION_RATIO = 0.3;
export const DEFAULT_DESTRUCTIVE_DELETION_MIN_CHARS = 500;
export const DEFAULT_RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_PROTECTED_PATHS = [
	"AGENTS.md",
	"CLAUDE.md",
	"GEMINI.md",
	"COPILOT.md",
	"README.md",
	"STATUS.md",
] as const;
export const DEFAULT_PROTECTED_GLOBS = [
	"**/AGENTS.md",
	"**/CLAUDE.md",
	"**/GEMINI.md",
	"**/*.excalidraw.md",
	"**/*维护手册*.md",
] as const;

const sourceName = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

export type AiWritePolicyMode = "collection-scope" | "explicit" | "vault";

export interface AiWritePolicy {
	mode: AiWritePolicyMode;
	allowedFolders: string[];
	allowedFiles: string[];
	protectedPaths: string[];
	protectedGlobs: string[];
	maxNoteBytes?: number;
	destructiveDeletionRatio?: number;
	destructiveDeletionMinChars?: number;
}

export interface AiEditPolicy {
	version: 1;
	enabled: boolean;
	generation: string;
	trackedFolders: string[];
	trackedFiles: string[];
	excludeWhitespace: boolean;
	excludeMarkdownFormatting: boolean;
	statisticsFolder: string;
	pluginVersion?: string;
	writePolicy?: AiWritePolicy;
}

export interface AiEditEvent {
	version: 1;
	id: string;
	source: string;
	path: string;
	occurredAt: number;
	date: string;
	generation: string;
	addedChars: number;
	deletedChars: number;
}

export type AiNoteEdit = Pick<AiEditEvent, "id" | "source" | "path" | "occurredAt"> & {
	before: string;
	after: string;
};

export interface AiEditReceipt {
	version: 1;
	id: string;
	event: AiEditEvent;
	afterDigest: string;
	beforeDigest?: string;
	createdAt?: number;
	baseMtimeMs?: number;
}

export interface AiBridgeInfo {
	version: 1;
	protocolVersion: number;
	port: number;
	token: string;
	pid: number;
	vaultRoot: string;
	pluginVersion: string;
	startedAt: number;
}

export interface AiNoteBackupMeta {
	version: 1;
	id: string;
	path: string;
	source: string;
	operation: "write" | "patch" | "restore";
	createdAt: number;
	existed: boolean;
	beforeSha256: string;
	afterSha256: string;
	beforeBytes: number;
	afterBytes: number;
}

export interface AiAuditEntry {
	at: number;
	id: string;
	operation: "write" | "patch" | "restore";
	source: string;
	path: string;
	channel: "obsidian-bridge" | "disk";
	noteStatus: "committed" | "unchanged" | "not_written";
	statisticsStatus: "recorded" | "queued" | "skipped" | "pending_recovery";
	statisticsReason?: string;
	errorCode?: AiNoteErrorCode;
	beforeSha256?: string;
	afterSha256?: string;
	backupId?: string;
	addedChars?: number;
	deletedChars?: number;
}

export type AiNoteErrorCode =
	| "INVALID_REQUEST"
	| "PATH_INVALID"
	| "PATH_PROTECTED"
	| "OUT_OF_WRITE_SCOPE"
	| "NOTE_ALREADY_EXISTS"
	| "NOTE_NOT_FOUND"
	| "NOTE_TOO_LARGE"
	| "STALE_VERSION"
	| "PATCH_NOT_FOUND"
	| "PATCH_AMBIGUOUS"
	| "DESTRUCTIVE_EDIT_BLOCKED"
	| "STRUCTURE_GUARD_BLOCKED"
	| "NOTE_ACTIVE_IN_EDITOR"
	| "LOCK_BUSY"
	| "POLICY_MISSING"
	| "POLICY_INVALID"
	| "BACKUP_NOT_FOUND"
	| "BRIDGE_UNAVAILABLE"
	| "IO_ERROR";

export class AiNoteError extends Error {
	readonly code: AiNoteErrorCode;
	readonly noteModified: boolean;
	readonly retrySafe: boolean;
	readonly details?: Record<string, unknown>;

	constructor(
		code: AiNoteErrorCode,
		message: string,
		options: { noteModified?: boolean; retrySafe?: boolean; details?: Record<string, unknown> } = {},
	) {
		super(message);
		this.name = "AiNoteError";
		this.code = code;
		this.noteModified = options.noteModified ?? false;
		this.retrySafe = options.retrySafe ?? !this.noteModified;
		this.details = options.details;
	}

	toJSON(): Record<string, unknown> {
		return {
			ok: false,
			errorCode: this.code,
			message: this.message,
			noteModified: this.noteModified,
			retrySafe: this.retrySafe,
			...(this.details ? { details: this.details } : {}),
		};
	}
}

export function defaultAiWritePolicy(mode: AiWritePolicyMode = "collection-scope"): AiWritePolicy {
	return {
		mode,
		allowedFolders: [],
		allowedFiles: [],
		protectedPaths: [...DEFAULT_PROTECTED_PATHS],
		protectedGlobs: [...DEFAULT_PROTECTED_GLOBS],
		maxNoteBytes: DEFAULT_MAX_NOTE_BYTES,
		destructiveDeletionRatio: DEFAULT_DESTRUCTIVE_DELETION_RATIO,
		destructiveDeletionMinChars: DEFAULT_DESTRUCTIVE_DELETION_MIN_CHARS,
	};
}

export function resolveAiWritePolicy(policy: AiEditPolicy): AiWritePolicy {
	const defaults = defaultAiWritePolicy();
	const custom = policy.writePolicy;
	if (!custom) return defaults;
	return {
		mode: custom.mode === "explicit" || custom.mode === "vault" ? custom.mode : "collection-scope",
		allowedFolders: Array.isArray(custom.allowedFolders) ? custom.allowedFolders.map(normalizeVaultPath).filter(Boolean) : [],
		allowedFiles: Array.isArray(custom.allowedFiles) ? custom.allowedFiles.map(normalizeVaultPath).filter(Boolean) : [],
		protectedPaths: Array.isArray(custom.protectedPaths) ? custom.protectedPaths.map(normalizeVaultPath).filter(Boolean) : defaults.protectedPaths,
		protectedGlobs: Array.isArray(custom.protectedGlobs) ? custom.protectedGlobs.map(item => item.trim()).filter(Boolean) : defaults.protectedGlobs,
		maxNoteBytes: typeof custom.maxNoteBytes === "number" && Number.isSafeInteger(custom.maxNoteBytes) && custom.maxNoteBytes > 0
			? custom.maxNoteBytes : DEFAULT_MAX_NOTE_BYTES,
		destructiveDeletionRatio: typeof custom.destructiveDeletionRatio === "number" && custom.destructiveDeletionRatio > 0 && custom.destructiveDeletionRatio <= 1
			? custom.destructiveDeletionRatio : DEFAULT_DESTRUCTIVE_DELETION_RATIO,
		destructiveDeletionMinChars: typeof custom.destructiveDeletionMinChars === "number" && Number.isSafeInteger(custom.destructiveDeletionMinChars) && custom.destructiveDeletionMinChars >= 0
			? custom.destructiveDeletionMinChars : DEFAULT_DESTRUCTIVE_DELETION_MIN_CHARS,
	};
}

export function normalizeVaultPath(path: string): string {
	return path.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
}

export function pathCompareKey(path: string, caseInsensitive = process.platform === "win32"): string {
	const normalized = normalizeVaultPath(path);
	return caseInsensitive ? normalized.toLowerCase() : normalized;
}

export function isStatisticsPath(path: string, folder: string, caseInsensitive = process.platform === "win32"): boolean {
	const normalizedFolder = pathCompareKey(folder, caseInsensitive);
	const normalizedPath = pathCompareKey(path, caseInsensitive);
	return normalizedFolder !== "" && (normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`));
}

export function isNoteInCollectionScope(
	path: string,
	trackedFolders: readonly string[],
	trackedFiles: readonly string[],
	caseInsensitive = process.platform === "win32",
): boolean {
	const folders = trackedFolders.map(item => pathCompareKey(item, caseInsensitive)).filter(Boolean);
	const files = trackedFiles.map(item => pathCompareKey(item, caseInsensitive)).filter(Boolean);
	if (folders.length === 0 && files.length === 0) return true;
	const target = pathCompareKey(path, caseInsensitive);
	return files.includes(target) || folders.some(folder => target.startsWith(`${folder}/`));
}

export function matchVaultGlob(path: string, glob: string, caseInsensitive = process.platform === "win32"): boolean {
	const target = pathCompareKey(path, caseInsensitive);
	const pattern = pathCompareKey(glob, caseInsensitive);
	if (!pattern) return false;
	const regex = globToRegExp(pattern);
	return regex.test(target);
}

function globToRegExp(pattern: string): RegExp {
	let source = "^";
	for (let i = 0; i < pattern.length; i++) {
		if (pattern[i] === "*" && pattern[i + 1] === "*") {
			if (pattern[i + 2] === "/") {
				source += "(?:.*/)?";
				i += 2;
			} else {
				source += ".*";
				i += 1;
			}
		} else if (pattern[i] === "*") {
			source += "[^/]*";
		} else if (pattern[i] === "?") {
			source += "[^/]";
		} else {
			source += pattern[i].replace(/[.+^${}()|[\]\\]/g, "\\$&");
		}
	}
	source += "$";
	return new RegExp(source);
}

export type WritePermissionResult =
	| { allowed: true }
	| { allowed: false; code: "PATH_INVALID" | "PATH_PROTECTED" | "OUT_OF_WRITE_SCOPE"; reason: string };

export function evaluateWritePermission(
	path: string,
	policy: AiEditPolicy,
	caseInsensitive = process.platform === "win32",
): WritePermissionResult {
	if (!isAiNotePath(path)) {
		return { allowed: false, code: "PATH_INVALID", reason: "仅允许写入库内有效的 Markdown 相对路径" };
	}
	if (isStatisticsPath(path, policy.statisticsFolder, caseInsensitive)) {
		return { allowed: false, code: "PATH_PROTECTED", reason: "禁止直接修改统计目录内的文件" };
	}
	const writePolicy = resolveAiWritePolicy(policy);
	const targetKey = pathCompareKey(path, caseInsensitive);
	for (const protectedPath of writePolicy.protectedPaths) {
		const key = pathCompareKey(protectedPath, caseInsensitive);
		if (key && (targetKey === key || targetKey.startsWith(`${key}/`))) {
			return { allowed: false, code: "PATH_PROTECTED", reason: `路径受写保护：${path}` };
		}
	}
	for (const glob of writePolicy.protectedGlobs) {
		if (matchVaultGlob(path, glob, caseInsensitive)) {
			return { allowed: false, code: "PATH_PROTECTED", reason: `路径命中受保护规则（${glob}）：${path}` };
		}
	}
	if (writePolicy.mode === "vault") return { allowed: true };
	if (writePolicy.mode === "explicit") {
		if (writePolicy.allowedFolders.length === 0 && writePolicy.allowedFiles.length === 0) {
			return { allowed: false, code: "OUT_OF_WRITE_SCOPE", reason: "当前未配置可写白名单目录或文件" };
		}
		return isNoteInCollectionScope(path, writePolicy.allowedFolders, writePolicy.allowedFiles, caseInsensitive)
			? { allowed: true }
			: { allowed: false, code: "OUT_OF_WRITE_SCOPE", reason: `路径不在允许的 AI 写入白名单内：${path}` };
	}
	return isNoteInCollectionScope(path, policy.trackedFolders, policy.trackedFiles, caseInsensitive)
		? { allowed: true }
		: { allowed: false, code: "OUT_OF_WRITE_SCOPE", reason: `路径不在允许的采集/写入范围内：${path}` };
}

export function parseAiEditPolicy(input: unknown): AiEditPolicy | undefined {
	const value = input as Partial<AiEditPolicy> | null;
	if (!value || value.version !== 1 || typeof value.enabled !== "boolean" ||
		typeof value.generation !== "string" || (value.generation !== "initial" && !AI_EDIT_ID.test(value.generation)) ||
		!Array.isArray(value.trackedFolders) || value.trackedFolders.some(item => typeof item !== "string") ||
		!Array.isArray(value.trackedFiles) || value.trackedFiles.some(item => typeof item !== "string") ||
		typeof value.excludeWhitespace !== "boolean" || typeof value.excludeMarkdownFormatting !== "boolean" ||
		typeof value.statisticsFolder !== "string") {
		return undefined;
	}
	return {
		version: 1,
		enabled: value.enabled,
		generation: value.generation,
		trackedFolders: [...value.trackedFolders],
		trackedFiles: [...value.trackedFiles],
		excludeWhitespace: value.excludeWhitespace,
		excludeMarkdownFormatting: value.excludeMarkdownFormatting,
		statisticsFolder: value.statisticsFolder,
		...(typeof value.pluginVersion === "string" ? { pluginVersion: value.pluginVersion } : {}),
		...(value.writePolicy && typeof value.writePolicy === "object" ? { writePolicy: resolveAiWritePolicy(value as AiEditPolicy) } : {}),
	};
}

export function parseAiBridgeInfo(input: unknown): AiBridgeInfo | undefined {
	const value = input as Partial<AiBridgeInfo> | null;
	if (!value || value.version !== 1 ||
		typeof value.protocolVersion !== "number" || !Number.isSafeInteger(value.protocolVersion) ||
		typeof value.port !== "number" || !Number.isSafeInteger(value.port) || value.port <= 0 || value.port > 65535 ||
		typeof value.token !== "string" || value.token.length < 16 ||
		typeof value.pid !== "number" || !Number.isSafeInteger(value.pid) || value.pid <= 0 ||
		typeof value.vaultRoot !== "string" || !value.vaultRoot ||
		typeof value.pluginVersion !== "string" ||
		typeof value.startedAt !== "number" || !Number.isSafeInteger(value.startedAt) || value.startedAt < 0) {
		return undefined;
	}
	return {
		version: 1,
		protocolVersion: value.protocolVersion,
		port: value.port,
		token: value.token,
		pid: value.pid,
		vaultRoot: value.vaultRoot,
		pluginVersion: value.pluginVersion,
		startedAt: value.startedAt,
	};
}

export function parseAiEditReceipt(input: unknown): AiEditReceipt | undefined {
	const receipt = input as Partial<AiEditReceipt> | null;
	const event = parseAiEditEvent(receipt?.event);
	if (!receipt || receipt.version !== 1 || !event || event.id !== receipt.id ||
		typeof receipt.afterDigest !== "string" || !sha256Pattern.test(receipt.afterDigest)) return undefined;
	if (receipt.beforeDigest !== undefined && (typeof receipt.beforeDigest !== "string" || !sha256Pattern.test(receipt.beforeDigest))) {
		return undefined;
	}
	if (receipt.createdAt !== undefined && (typeof receipt.createdAt !== "number" || !Number.isSafeInteger(receipt.createdAt) || receipt.createdAt < 0)) {
		return undefined;
	}
	if (receipt.baseMtimeMs !== undefined && (typeof receipt.baseMtimeMs !== "number" || !Number.isFinite(receipt.baseMtimeMs) || receipt.baseMtimeMs < 0)) {
		return undefined;
	}
	return {
		version: 1,
		id: event.id,
		event,
		afterDigest: receipt.afterDigest,
		...(receipt.beforeDigest !== undefined ? { beforeDigest: receipt.beforeDigest } : {}),
		...(receipt.createdAt !== undefined ? { createdAt: receipt.createdAt } : {}),
		...(receipt.baseMtimeMs !== undefined ? { baseMtimeMs: receipt.baseMtimeMs } : {}),
	};
}

export function isAiNotePath(path: unknown): path is string {
	return typeof path === "string" && /\.md$/i.test(path) &&
		!/[\\:<>"|?*\x00-\x1f]/.test(path) && path.split("/").every(part => part && !part.startsWith(".") &&
			!/[ .]$/.test(part) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

export function formatAiEditDate(at: number): string {
	const date = new Date(at);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isAiEditSource(source: unknown): source is string {
	return typeof source === "string" && sourceName.test(source);
}

export function parseAiEditEvent(input: unknown): AiEditEvent | undefined {
	const event = input as Partial<AiEditEvent> | null;
	if (!event || event.version !== 1 || typeof event.id !== "string" || !AI_EDIT_ID.test(event.id) ||
		!isAiEditSource(event.source) || !isAiNotePath(event.path) ||
		typeof event.generation !== "string" || (event.generation !== "initial" && !AI_EDIT_ID.test(event.generation)) ||
		typeof event.occurredAt !== "number" || !Number.isSafeInteger(event.occurredAt) || event.occurredAt < 0 ||
		!validDay(event.date) || !validCount(event.addedChars) || !validCount(event.deletedChars) ||
		event.addedChars + event.deletedChars === 0) return undefined;
	const { id, source, path, occurredAt, date, generation, addedChars, deletedChars } = event;
	return { version: 1, id, source, path, occurredAt, date, generation, addedChars, deletedChars };
}

function validDay(date: unknown): date is string {
	if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
	const value = new Date(`${date}T00:00:00Z`);
	return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === date;
}

function validCount(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 16 * 1024 * 1024;
}

export function aiEditSpoolPath(
	fs: typeof FileSystem, paths: typeof Paths, crypto: typeof Crypto, vaultRoot: string,
	stateRoot = process.platform === "win32" ? process.env.LOCALAPPDATA :
		process.env.XDG_STATE_HOME || paths.join(require("os").homedir(), ".local", "state")
): string {
	if (!stateRoot) throw new Error("找不到本机应用数据目录");
	const real = fs.realpathSync(vaultRoot);
	const key = crypto.createHash("sha256").update(process.platform === "win32" ? real.toLowerCase() : real).digest("hex");
	return paths.join(stateRoot, "contribution-graph-local", "ai-edits", key);
}
