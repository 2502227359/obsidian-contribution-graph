import type * as FileSystem from "fs";
import type * as Paths from "path";
import type * as Crypto from "crypto";
import {
	AI_EDIT_ID,
	AiAuditEntry,
	AiBridgeInfo,
	AiEditEvent,
	AiEditPolicy,
	AiEditReceipt,
	AiNoteBackupMeta,
	aiEditSpoolPath,
	DEFAULT_MAX_NOTE_BYTES,
	DEFAULT_RECEIPT_TTL_MS,
	parseAiEditEvent,
	parseAiEditReceipt,
	pathCompareKey,
} from "./aiEditProtocol";

const MAX_BACKUPS = 200;
const MAX_AUDIT_BYTES = 5 * 1024 * 1024;
const BACKUP_ID_PATTERN = /^\d{13}-[0-9a-f-]{36}$/;

export class AiEditSpool {
	private lastPolicy = "";

	constructor(
		private readonly fs: typeof FileSystem,
		private readonly paths: typeof Paths,
		readonly root: string,
		readonly vaultRoot: string,
		private readonly hash: typeof Crypto,
		private readonly now: () => number = () => Date.now(),
		private readonly receiptTtlMs: number = DEFAULT_RECEIPT_TTL_MS,
	) {}

	publish(policy: AiEditPolicy): void {
		const content = JSON.stringify(policy);
		if (content === this.lastPolicy) return;
		this.write(this.paths.join(this.root, "policy.json"), content);
		this.lastPolicy = content;
	}

	writeBridgeInfo(info: AiBridgeInfo): void {
		this.write(this.bridgeInfoPath(), JSON.stringify(info));
	}

	removeBridgeInfo(expectedToken?: string): void {
		const file = this.bridgeInfoPath();
		try {
			if (expectedToken) {
				const raw = this.readJson(file) as { token?: unknown } | undefined;
				if (raw && raw.token !== expectedToken) return;
			}
			this.fs.rmSync(file, { force: true });
		} catch { /* ignore */ }
	}

	queue(event: AiEditEvent): void {
		this.write(this.eventPath(event.id), JSON.stringify(event));
	}

	read(): AiEditEvent[] {
		const folder = this.paths.join(this.root, "events");
		const events: AiEditEvent[] = [];
		for (const entry of this.eventFiles(folder)) {
			const id = entry.slice(0, -5);
			const path = this.eventPath(id);
			const event = parseAiEditEvent(this.readJson(path));
			if (!event || event.id !== id) {
				this.quarantineFileSync(path, "invalid");
				console.warn("已隔离格式无效的 AI 编辑记录", id);
				continue;
			}
			events.push(event);
			if (events.length >= 128) break;
		}
		if (events.length < 128) {
			const known = new Set(events.map(event => event.id));
			const recovered = this.recoverReceiptsSync(known, 128 - events.length);
			events.push(...recovered);
		}
		return events;
	}

	async readAsync(): Promise<AiEditEvent[]> {
		const fsp = this.fs.promises;
		if (!fsp) return this.read();
		const folder = this.paths.join(this.root, "events");
		const events: AiEditEvent[] = [];
		for (const entry of await this.eventFilesAsync(folder)) {
			const id = entry.slice(0, -5);
			const path = this.eventPath(id);
			const event = parseAiEditEvent(await this.readJsonAsync(path));
			if (!event || event.id !== id) {
				await this.quarantineFileAsync(path, "invalid");
				console.warn("已隔离格式无效的 AI 编辑记录", id);
				continue;
			}
			events.push(event);
			if (events.length >= 128) break;
		}
		if (events.length < 128) {
			const known = new Set(events.map(event => event.id));
			const recovered = await this.recoverReceiptsAsync(known, 128 - events.length);
			events.push(...recovered);
		}
		return events;
	}

	acknowledge(events: readonly AiEditEvent[]): void {
		for (const event of events) {
			this.fs.rmSync(this.eventPath(event.id), { force: true });
			this.fs.rmSync(this.receiptPath(event.id), { force: true });
		}
	}

	async saveBackup(meta: Omit<AiNoteBackupMeta, "version" | "id"> & { id?: string }, content: string): Promise<string> {
		const fsp = this.fs.promises;
		const backupId = meta.id && BACKUP_ID_PATTERN.test(meta.id)
			? meta.id
			: `${String(meta.createdAt).padStart(13, "0")}-${this.hash.randomUUID()}`;
		const fullMeta: AiNoteBackupMeta = {
			version: 1,
			id: backupId,
			path: meta.path,
			source: meta.source,
			operation: meta.operation,
			createdAt: meta.createdAt,
			existed: meta.existed,
			beforeSha256: meta.beforeSha256,
			afterSha256: meta.afterSha256,
			beforeBytes: meta.beforeBytes,
			afterBytes: meta.afterBytes,
		};
		const dir = this.backupsDir();
		await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
		await this.writeAsync(this.paths.join(dir, `${backupId}.md`), content);
		await this.writeAsync(this.paths.join(dir, `${backupId}.meta.json`), JSON.stringify(fullMeta));
		await this.pruneBackupsAsync().catch(() => undefined);
		return backupId;
	}

	async listBackups(pathFilter?: string, limit = 20): Promise<readonly AiNoteBackupMeta[]> {
		const fsp = this.fs.promises;
		const dir = this.backupsDir();
		let entries: string[];
		try { entries = await fsp.readdir(dir); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}
		const metas = entries
			.filter(name => name.endsWith(".meta.json") && BACKUP_ID_PATTERN.test(name.slice(0, -10)))
			.sort()
			.reverse();
		const targetKey = pathFilter ? pathCompareKey(pathFilter) : undefined;
		const results: AiNoteBackupMeta[] = [];
		for (const name of metas) {
			const parsed = await this.readJsonAsync(this.paths.join(dir, name)) as Partial<AiNoteBackupMeta> | undefined;
			if (!parsed || parsed.version !== 1 || typeof parsed.id !== "string" || typeof parsed.path !== "string") continue;
			if (targetKey && pathCompareKey(parsed.path) !== targetKey) continue;
			results.push(parsed as AiNoteBackupMeta);
			if (results.length >= Math.max(1, Math.min(limit, MAX_BACKUPS))) break;
		}
		return results;
	}

	async readBackup(backupId: string): Promise<{ meta: AiNoteBackupMeta; content: string } | undefined> {
		if (!BACKUP_ID_PATTERN.test(backupId)) return undefined;
		const dir = this.backupsDir();
		const meta = await this.readJsonAsync(this.paths.join(dir, `${backupId}.meta.json`)) as Partial<AiNoteBackupMeta> | undefined;
		if (!meta || meta.version !== 1 || meta.id !== backupId || typeof meta.path !== "string") return undefined;
		try {
			const content = await this.fs.promises.readFile(this.paths.join(dir, `${backupId}.md`), "utf8");
			return { meta: meta as AiNoteBackupMeta, content };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw error;
		}
	}

	async appendAudit(entry: AiAuditEntry): Promise<void> {
		const fsp = this.fs.promises;
		const file = this.paths.join(this.root, "audit.jsonl");
		await fsp.mkdir(this.root, { recursive: true, mode: 0o700 });
		try {
			const info = await fsp.stat(file);
			if (info.size > MAX_AUDIT_BYTES) {
				await fsp.rename(file, `${file}.1`).catch(() => undefined);
			}
		} catch { /* file does not exist yet */ }
		await fsp.appendFile(file, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
	}

	private recoverReceiptsSync(known: Set<string>, limit: number): AiEditEvent[] {
		const files = this.eventFiles(this.paths.join(this.root, "receipts"));
		if (files.length === 0) return [];
		const now = this.now();
		const digestCache = new Map<string, string | null>();
		const matchedGroups = new Map<string, AiEditReceipt[]>();

		for (const filename of files) {
			const id = filename.slice(0, -5);
			if (known.has(id)) continue;
			const path = this.receiptPath(id);
			const receipt = parseAiEditReceipt(this.readJson(path));
			if (!receipt || receipt.id !== id) {
				this.quarantineFileSync(path, "invalid");
				continue;
			}
			const fileDigest = this.computeVaultFileDigestSync(receipt.event.path, digestCache);
			if (fileDigest !== null && fileDigest === receipt.afterDigest) {
				const key = `${pathCompareKey(receipt.event.path)}::${receipt.afterDigest}`;
				const group = matchedGroups.get(key) ?? [];
				group.push(receipt);
				matchedGroups.set(key, group);
			} else if (receipt.createdAt !== undefined && now - receipt.createdAt > this.receiptTtlMs) {
				this.quarantineFileSync(path, "expired");
			}
		}

		const events: AiEditEvent[] = [];
		for (const group of matchedGroups.values()) {
			group.sort((a, b) =>
				(b.createdAt ?? b.event.occurredAt) - (a.createdAt ?? a.event.occurredAt) ||
				b.id.localeCompare(a.id)
			);
			const winner = group[0];
			for (const duplicate of group.slice(1)) {
				this.quarantineFileSync(this.receiptPath(duplicate.id), "duplicate");
			}
			if (events.length < limit) events.push(winner.event);
		}
		return events;
	}

	private async recoverReceiptsAsync(known: Set<string>, limit: number): Promise<AiEditEvent[]> {
		const files = await this.eventFilesAsync(this.paths.join(this.root, "receipts"));
		if (files.length === 0) return [];
		const now = this.now();
		const digestCache = new Map<string, string | null>();
		const matchedGroups = new Map<string, AiEditReceipt[]>();

		for (const filename of files) {
			const id = filename.slice(0, -5);
			if (known.has(id)) continue;
			const path = this.receiptPath(id);
			const receipt = parseAiEditReceipt(await this.readJsonAsync(path));
			if (!receipt || receipt.id !== id) {
				await this.quarantineFileAsync(path, "invalid");
				continue;
			}
			const fileDigest = await this.computeVaultFileDigestAsync(receipt.event.path, digestCache);
			if (fileDigest !== null && fileDigest === receipt.afterDigest) {
				const key = `${pathCompareKey(receipt.event.path)}::${receipt.afterDigest}`;
				const group = matchedGroups.get(key) ?? [];
				group.push(receipt);
				matchedGroups.set(key, group);
			} else if (receipt.createdAt !== undefined && now - receipt.createdAt > this.receiptTtlMs) {
				await this.quarantineFileAsync(path, "expired");
			}
		}

		const events: AiEditEvent[] = [];
		for (const group of matchedGroups.values()) {
			group.sort((a, b) =>
				(b.createdAt ?? b.event.occurredAt) - (a.createdAt ?? a.event.occurredAt) ||
				b.id.localeCompare(a.id)
			);
			const winner = group[0];
			for (const duplicate of group.slice(1)) {
				await this.quarantineFileAsync(this.receiptPath(duplicate.id), "duplicate");
			}
			if (events.length < limit) events.push(winner.event);
		}
		return events;
	}

	private computeVaultFileDigestSync(notePath: string, cache: Map<string, string | null>): string | null {
		const cacheKey = pathCompareKey(notePath);
		if (cache.has(cacheKey)) return cache.get(cacheKey)!;
		try {
			const target = this.fs.realpathSync(this.paths.join(this.vaultRoot, notePath));
			const relative = this.paths.relative(this.vaultRoot, target);
			if (!relative || relative === ".." || relative.startsWith(`..${this.paths.sep}`) || this.paths.isAbsolute(relative)) {
				cache.set(cacheKey, null);
				return null;
			}
			const info = this.fs.statSync(target);
			if (!info.isFile() || info.size > DEFAULT_MAX_NOTE_BYTES) {
				cache.set(cacheKey, null);
				return null;
			}
			const digest = this.hash.createHash("sha256").update(this.fs.readFileSync(target)).digest("hex");
			cache.set(cacheKey, digest);
			return digest;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				cache.set(cacheKey, null);
				return null;
			}
			throw error;
		}
	}

	private async computeVaultFileDigestAsync(notePath: string, cache: Map<string, string | null>): Promise<string | null> {
		const cacheKey = pathCompareKey(notePath);
		if (cache.has(cacheKey)) return cache.get(cacheKey)!;
		const fsp = this.fs.promises;
		try {
			const target = await fsp.realpath(this.paths.join(this.vaultRoot, notePath));
			const relative = this.paths.relative(this.vaultRoot, target);
			if (!relative || relative === ".." || relative.startsWith(`..${this.paths.sep}`) || this.paths.isAbsolute(relative)) {
				cache.set(cacheKey, null);
				return null;
			}
			const info = await fsp.stat(target);
			if (!info.isFile() || info.size > DEFAULT_MAX_NOTE_BYTES) {
				cache.set(cacheKey, null);
				return null;
			}
			const digest = this.hash.createHash("sha256").update(await fsp.readFile(target)).digest("hex");
			cache.set(cacheKey, digest);
			return digest;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				cache.set(cacheKey, null);
				return null;
			}
			throw error;
		}
	}

	private readJson(path: string): unknown {
		try {
			const info = this.fs.lstatSync(path);
			if (!info.isFile() || info.size > 64 * 1024) return undefined;
			return JSON.parse(this.fs.readFileSync(path, "utf8"));
		} catch (error) {
			if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw error;
		}
	}

	private async readJsonAsync(path: string): Promise<unknown> {
		try {
			const info = await this.fs.promises.lstat(path);
			if (!info.isFile() || info.size > 64 * 1024) return undefined;
			return JSON.parse(await this.fs.promises.readFile(path, "utf8"));
		} catch (error) {
			if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw error;
		}
	}

	private quarantineFileSync(path: string, suffix: string): void {
		try { this.fs.renameSync(path, `${path}.${suffix}`); }
		catch { /* ignore concurrent rename/remove */ }
	}

	private async quarantineFileAsync(path: string, suffix: string): Promise<void> {
		try { await this.fs.promises.rename(path, `${path}.${suffix}`); }
		catch { /* ignore concurrent rename/remove */ }
	}

	private eventFiles(folder: string): string[] {
		return this.fs.existsSync(folder) ? this.fs.readdirSync(folder)
			.filter(name => name.endsWith(".json") && AI_EDIT_ID.test(name.slice(0, -5))).sort() : [];
	}

	private async eventFilesAsync(folder: string): Promise<string[]> {
		try {
			const names = await this.fs.promises.readdir(folder);
			return names.filter(name => name.endsWith(".json") && AI_EDIT_ID.test(name.slice(0, -5))).sort();
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}
	}

	private async pruneBackupsAsync(): Promise<void> {
		const fsp = this.fs.promises;
		const dir = this.backupsDir();
		const entries = await fsp.readdir(dir);
		const ids = entries
			.filter(name => name.endsWith(".meta.json") && BACKUP_ID_PATTERN.test(name.slice(0, -10)))
			.map(name => name.slice(0, -10))
			.sort();
		if (ids.length <= MAX_BACKUPS) return;
		const toRemove = ids.slice(0, ids.length - MAX_BACKUPS);
		for (const id of toRemove) {
			await fsp.rm(this.paths.join(dir, `${id}.md`), { force: true });
			await fsp.rm(this.paths.join(dir, `${id}.meta.json`), { force: true });
		}
	}

	private eventPath(id: string): string {
		return this.paths.join(this.root, "events", `${id}.json`);
	}

	private receiptPath(id: string): string {
		return this.paths.join(this.root, "receipts", `${id}.json`);
	}

	private backupsDir(): string {
		return this.paths.join(this.root, "backups");
	}

	private bridgeInfoPath(): string {
		return this.paths.join(this.root, "bridge.json");
	}

	private write(target: string, content: string): void {
		this.fs.mkdirSync(this.paths.dirname(target), { recursive: true, mode: 0o700 });
		const temporary = `${target}.${this.hash.randomUUID()}.tmp`;
		try {
			const fd = this.fs.openSync(temporary, "wx", 0o600);
			try { this.fs.writeFileSync(fd, content, "utf8"); this.fs.fsyncSync(fd); }
			finally { this.fs.closeSync(fd); }
			this.fs.renameSync(temporary, target);
		} finally {
			this.fs.rmSync(temporary, { force: true });
		}
	}

	private async writeAsync(target: string, content: string): Promise<void> {
		const fsp = this.fs.promises;
		await fsp.mkdir(this.paths.dirname(target), { recursive: true, mode: 0o700 });
		const temporary = `${target}.${this.hash.randomUUID()}.tmp`;
		try {
			const handle = await fsp.open(temporary, "wx", 0o600);
			try { await handle.writeFile(content, "utf8"); await handle.sync(); }
			finally { await handle.close(); }
			await fsp.rename(temporary, target);
		} finally {
			await fsp.rm(temporary, { force: true });
		}
	}
}

export function createAiEditSpool(vaultRoot: string): AiEditSpool {
	const fs: typeof FileSystem = require("fs");
	const paths: typeof Paths = require("path");
	const hash: typeof Crypto = require("crypto");
	const real = fs.realpathSync(vaultRoot);
	return new AiEditSpool(fs, paths, aiEditSpoolPath(fs, paths, hash, real), real, hash);
}
