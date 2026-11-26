import type { StatisticsFiles, StatisticsRecord } from "./StatisticsRepository";

export const MAX_RECORD_BYTES = 100 * 1024 * 1024;
const monthPath = /^月度\/([0-9a-f-]{36})\/(\d{4}-\d{2})-([01])\.json$/;
const archivePath = /^归档\/([0-9a-f]{64})\.json$/;

export interface StatisticsInstallation {
	id: string;
	loadSequences?(): Record<string, number>;
	saveSequences?(sequences: Record<string, number>): void;
}

export interface MonthlyFrame {
	formatVersion: 2;
	kind: "monthly";
	sequence: number;
	records: StatisticsRecord[];
}

export function isLegacyStatisticsPath(path: string): boolean {
	return path.startsWith("记录/") && path.endsWith(".json");
}

export function isStatisticsPath(path: string): boolean {
	return isLegacyStatisticsPath(path) || monthPath.test(path) || archivePath.test(path);
}

export function monthlyShard(path: string): string | undefined {
	return monthPath.test(path) ? path.slice(0, -7) : undefined;
}

export function newestMonthlyFrame(previous: MonthlyFrame | undefined, incoming: MonthlyFrame): MonthlyFrame {
	if (!previous) return incoming;
	const [older, newer] = previous.sequence < incoming.sequence ? [previous, incoming] : [incoming, previous];
	const revisions = new Map(newer.records.map(record => [record.id, record.revision] as const));
	if (older.records.some(record => (revisions.get(record.id) ?? 0) < record.revision)) {
		throw new Error("月度统计的较新版本缺少历史记录");
	}
	return newer;
}

export function checkStatisticsSize(content: string): void {
	if (new TextEncoder().encode(content).byteLength > MAX_RECORD_BYTES) throw new Error("单份统计文件超过一百兆字节");
}

export async function statisticsDigest(content: string): Promise<string> {
	const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
	return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function readStatisticsFile(path: string, content: string, parseRecord: (value: unknown) => StatisticsRecord) {
	checkStatisticsSize(content);
	const value = JSON.parse(content);
	if (isLegacyStatisticsPath(path)) return { records: [parseRecord(value)] };
	const month = monthPath.exec(path);
	if (value?.formatVersion !== 2 || !Array.isArray(value.records) || !value.records.length) {
		throw new Error("统计容器格式损坏");
	}
	const records: StatisticsRecord[] = value.records.map(parseRecord);
	if (!month) {
		if (value.kind !== "archive" || await statisticsDigest(content) !== archivePath.exec(path)?.[1]) {
			throw new Error("统计归档内容校验失败");
		}
		return { records };
	}
	if (value.kind !== "monthly" || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || value.sequence % 2 !== Number(month[3]) ||
		records.some(record => record.kind !== "statistics" || record.id === "legacy")) {
		throw new Error("月度统计文件格式损坏");
	}
	const frame: MonthlyFrame = { formatVersion: 2, kind: "monthly", sequence: value.sequence, records };
	return { records, shard: monthlyShard(path)!, frame };
}

export class MonthlyStatisticsFiles {
	private readonly frames = new Map<string, MonthlyFrame>();
	private pending?: { shard: string; frame: MonthlyFrame };

	constructor(private readonly files: StatisticsFiles, private readonly installation: StatisticsInstallation) {}

	readSequences(): Record<string, number> {
		return this.installation.loadSequences?.() ?? {};
	}

	observe(observed: ReadonlyMap<string, MonthlyFrame>, unreadable: ReadonlyMap<string, unknown>, confirmed: Record<string, number>): void {
		for (const [shard, sequence] of Object.entries(confirmed)) {
			if ((observed.get(shard)?.sequence ?? 0) < sequence) {
				throw new Error("月度统计缺少已确认的版本，等待同步完成或从备份恢复");
			}
		}
		for (const [shard, error] of unreadable) {
			if (!confirmed[shard] || !observed.has(shard)) throw error;
		}
		const current = this.readSequences();
		for (const [shard, frame] of observed) this.confirm(shard, frame, current);
		this.installation.saveSequences?.(current);
	}

	async save(record: StatisticsRecord): Promise<void> {
		const { shard, path, frame, content } = this.prepare(record);
		this.pending = { shard, frame };
		try {
			await this.files.write(path, content);
			if (await this.files.read(path) !== content) throw new Error("月度统计写入校验失败");
			this.confirm(shard, frame);
		} finally {
			this.pending = undefined;
		}
	}

	saveSync(record: StatisticsRecord): boolean {
		const { shard, path, frame, content } = this.prepare(record, true);
		if (!this.files.writeSync?.(path, content)) return false;
		this.confirm(shard, frame);
		return true;
	}

	private prepare(record: StatisticsRecord, includePending = false) {
		const date = new Date(record.updatedAt);
		const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
		const shard = `月度/${this.installation.id}/${month}`;
		const previous = this.frames.get(shard);
		const pending = includePending && this.pending?.shard === shard ? this.pending.frame : undefined;
		const sequence = Math.max(previous?.sequence ?? 0, pending?.sequence ?? 0) + 1;
		if (!Number.isSafeInteger(sequence)) throw new Error("月度统计版本号超出范围");
		const records = new Map(previous?.records.map(entry => [entry.id, entry] as const));
		for (const entry of pending?.records ?? []) {
			if ((records.get(entry.id)?.revision ?? 0) < entry.revision) records.set(entry.id, entry);
		}
		records.set(record.id, record);
		const frame: MonthlyFrame = { formatVersion: 2, kind: "monthly", sequence, records: [...records.values()] };
		const content = JSON.stringify(frame);
		checkStatisticsSize(content);
		return { shard, path: `${shard}-${sequence % 2}.json`, frame, content };
	}

	private confirm(shard: string, frame: MonthlyFrame, confirmed?: Record<string, number>): void {
		const sequences = confirmed ?? this.readSequences();
		if (frame.sequence > (sequences[shard] ?? 0)) sequences[shard] = frame.sequence;
		if (!confirmed) this.installation.saveSequences?.(sequences);
		if (!shard.startsWith(`月度/${this.installation.id}/`)) return;
		if ((this.frames.get(shard)?.sequence ?? 0) < frame.sequence) this.frames.set(shard, frame);
	}
}
