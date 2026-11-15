import { applyStatisticsRename, closeStatistics, emptyStatistics, mergeStatistics, StatisticsData, statisticsFrom } from "./statisticsModel";

export const DEFAULT_STATISTICS_FOLDER = "Template/数据/学习统计";

export interface StatisticsFiles {
	list(): Promise<string[]>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	remove(path: string): Promise<void>;
	writeSync?(path: string, data: string): boolean;
}

interface StatisticsRecord {
	formatVersion: 1;
	kind: "statistics" | "replacement" | "rename";
	id: string;
	revision: number;
	updatedAt: number;
	generation: string;
	data: StatisticsData;
	parents?: string[];
	rename?: { oldPath: string; newPath: string; isFolder: boolean; targets: string[]; predecessors: string[] };
}

export function canonicalStatistics(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalStatistics).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalStatistics((value as Record<string, unknown>)[key])}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

export class StatisticsRepository {
	private records = new Map<string, StatisticsRecord>();
	private recordId = crypto.randomUUID();
	private revision = 0;
	private generation = "initial";
	private saved = "";
	private conflicting = false;
	private pendingRenames = new Set<string>();
	private queue: Promise<void> = Promise.resolve();
	private ownVersions: string[] = [];
	private sealed = false;
	version = 0;
	get generationId(): string { return this.generation; }

	constructor(
		readonly files: StatisticsFiles,
		private readonly validate: (data: unknown) => StatisticsData,
		private readonly now: () => number = () => Date.now(),
	) {}

	async initialize(legacy?: StatisticsData): Promise<void> {
		await this.refresh();
		if (legacy) {
			const existing = this.records.get("legacy");
			if (existing && canonicalStatistics(existing.data) !== canonicalStatistics(legacy)) {
				throw new Error("发现不同的旧版历史统计，已停止自动迁移，避免重复累计");
			}
			if (!existing) await this.writeRecord({ formatVersion: 1, kind: "statistics", id: "legacy", revision: 1,
				updatedAt: this.now(), generation: "initial", data: statisticsFrom(legacy) });
		}
	}

	read(local: StatisticsData): StatisticsData {
		const renames = this.orderedRenames();
		const remote = [...this.records.values()].sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id))
			.filter(record => record.kind !== "rename" && record.id !== this.recordId && record.generation === this.generation)
			.map(record => {
				let data = closeStatistics(record.data, record.updatedAt);
				for (const operation of renames) {
					if (operation.rename!.targets.includes(record.id)) data = applyStatisticsRename(data, operation.rename!);
				}
				return data;
			});
		return mergeStatistics([...remote, local]);
	}

	rename(oldPath: string, newPath: string, isFolder: boolean): boolean {
		const targets = [...this.records.values()].filter(record => record.kind !== "rename" && record.id !== this.recordId && record.generation === this.generation).map(record => record.id);
		if (!targets.length) return false;
		const id = crypto.randomUUID();
		this.records.set(id, { formatVersion: 1, kind: "rename", id, revision: 1, generation: this.generation,
			updatedAt: this.now(), data: emptyStatistics(), rename: { oldPath, newPath, isFolder, targets,
				predecessors: this.orderedRenames().map(record => record.id) } });
		this.pendingRenames.add(id); this.version++;
		return true;
	}

	async save(local: StatisticsData, generation = this.generation): Promise<void> {
		const data = statisticsFrom(local);
		const serialized = canonicalStatistics(data);
		const id = this.recordId;
		const save = this.queue.catch(() => undefined).then(async () => {
			if (this.sealed) return;
			if (this.conflicting) throw new Error("存在并发替换操作，统计保存已暂停");
			if (generation !== this.generation) return;
			for (const pending of this.pendingRenames) {
				await this.writeRecord(this.records.get(pending)!); this.pendingRenames.delete(pending);
			}
			if (serialized === this.saved) return;
			const record: StatisticsRecord = { formatVersion: 1, kind: "statistics", id,
				revision: ++this.revision, updatedAt: this.now(), generation, data };
			await this.writeRecord(record);
			this.saved = serialized;
			await this.pruneOwnVersions();
		});
		this.queue = save;
		await save;
	}

	saveSync(local: StatisticsData): boolean {
		if (this.sealed) return true;
		if (!this.files.writeSync) return false;
		for (const id of this.pendingRenames) {
			const operation = this.records.get(id)!;
			if (!this.files.writeSync(`记录/${id}-r${operation.revision}.json`, JSON.stringify(operation, null, 2))) return false;
			this.pendingRenames.delete(id);
		}
		const record: StatisticsRecord = {formatVersion: 1, kind: "statistics", id: this.recordId,
			revision: ++this.revision, updatedAt: this.now(), generation: this.generation, data: this.validate(statisticsFrom(local))};
		if (!this.files.writeSync(`记录/${record.id}-r${record.revision}.json`, JSON.stringify(record, null, 2))) return false;
		// 退出检查点高于已发起写入的版本；排队的旧快照不能再获得更新版本。
		this.sealed = true;
		this.records.set(record.id, record);
		this.version++;
		return true;
	}

	async replace(data: StatisticsData): Promise<void> {
		await this.queue.catch(() => undefined);
		await this.refresh().catch(error => { if (!this.conflicting) throw error; });
		const id = crypto.randomUUID();
		await this.writeRecord({ formatVersion: 1, kind: "replacement", id, revision: 1,
			generation: id, updatedAt: this.now(), data: statisticsFrom(data), parents: this.heads(this.records) });
		this.adoptGeneration(id);
		this.conflicting = false;
	}

	async refresh(beforeReplacement?: () => Promise<void>): Promise<boolean> {
		const next = await this.loadRecords();
		const heads = this.heads(next);
		const generation = heads[0] || "initial";
		if (heads.length <= 1 && generation !== this.generation && beforeReplacement) {
			await beforeReplacement();
			const own = this.records.get(this.recordId);
			if (own) next.set(own.id, own);
		}
		if (canonicalStatistics([...next]) !== canonicalStatistics([...this.records])) {
			this.records = next; this.version++;
		}
		this.conflicting = heads.length > 1;
		if (this.conflicting) throw new Error("发现并发清空或导入，已保留上次有效统计，请先解决替换冲突");
		if (generation === this.generation) return false;
		this.adoptGeneration(generation);
		return true;
	}

	private async loadRecords(): Promise<Map<string, StatisticsRecord>> {
		const next = new Map(this.records);
		const paths = (await this.files.list()).filter(path => path.startsWith("记录/") && path.endsWith(".json"));
		const found = new Set<string>();
		for (const path of paths) {
			const record = this.parse(await this.files.read(path));
			found.add(record.id);
			const existing = next.get(record.id);
			const sameLegacy = record.id === "legacy" && existing && canonicalStatistics(existing.data) === canonicalStatistics(record.data);
			if (existing && !sameLegacy && existing.revision === record.revision && canonicalStatistics(existing) !== canonicalStatistics(record)) {
				throw new Error(`统计记录版本冲突：${record.id}，已保留上次有效统计`);
			}
			if (!existing || existing.revision < record.revision) next.set(record.id, record);
		}
		if ([...this.records.values()].some(record => !found.has(record.id) && !this.pendingRenames.has(record.id) &&
			(record.generation === this.generation || record.kind === "replacement"))) {
			throw new Error("统计记录文件被删除或尚未同步完成，已保留上次有效统计");
		}
		return next;
	}

	private heads(records: Map<string, StatisticsRecord>): string[] {
		const resolved = new Set<string>();
		const operations = [...records.values()].filter(record => record.kind === "replacement");
		let previous = -1;
		while (previous !== resolved.size) {
			previous = resolved.size;
			for (const record of operations) {
				if (record.parents!.every(id => resolved.has(id))) resolved.add(record.id);
			}
		}
		const parents = new Set(operations.filter(record => resolved.has(record.id)).reduce<string[]>((all, record) => all.concat(record.parents!), []));
		return [...resolved].filter(id => !parents.has(id)).sort();
	}

	private orderedRenames(): StatisticsRecord[] {
		const result: StatisticsRecord[] = [];
		const ids = new Set<string>();
		const operations = [...this.records.values()].filter(record => record.kind === "rename" && record.generation === this.generation).sort((a, b) => a.id.localeCompare(b.id));
		let previous = -1;
		while (previous !== ids.size) {
			previous = ids.size;
			for (const record of operations) {
				if (!ids.has(record.id) && record.rename!.predecessors.every(id => ids.has(id))) { ids.add(record.id); result.push(record); }
			}
		}
		return result;
	}

	private adoptGeneration(generation: string): void {
		this.generation = generation;
		this.recordId = crypto.randomUUID();
		this.revision = 0;
		this.saved = "";
		this.ownVersions = [];
		this.version++;
	}

	private parse(serialized: string): StatisticsRecord {
		if (new TextEncoder().encode(serialized).byteLength > 100 * 1024 * 1024) throw new Error("单份统计记录超过一百兆字节");
		const record = JSON.parse(serialized) as StatisticsRecord;
		if (!record || record.formatVersion !== 1 || !["statistics", "replacement", "rename"].includes(record.kind) || !/^(legacy|[0-9a-f-]{36})$/.test(record.id) ||
			!Number.isSafeInteger(record.revision) || record.revision < 1 ||
			!Number.isFinite(record.updatedAt) || record.updatedAt < 0 || record.updatedAt > 8640000000000000 ||
			 typeof record.generation !== "string" || !/^(initial|[0-9a-f-]{36})$/.test(record.generation)) {
			throw new Error("统计记录格式损坏，已保留上次有效统计");
		}
		if (record.id === "legacy" && (record.kind !== "statistics" || record.revision !== 1 || record.generation !== "initial")) {
			throw new Error("历史统计基线不可更新");
		}
		if (record.kind === "replacement" && (record.generation !== record.id || record.revision !== 1 ||
			!Array.isArray(record.parents) || record.parents.some(id => typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id) || id === record.id))) {
			throw new Error("统计替换记录格式损坏");
		}
		if (record.kind === "rename" && (!record.rename || typeof record.rename.oldPath !== "string" || !record.rename.oldPath ||
			 typeof record.rename.newPath !== "string" || !record.rename.newPath || typeof record.rename.isFolder !== "boolean" ||
			 !Array.isArray(record.rename.targets) || !Array.isArray(record.rename.predecessors) ||
			 [...record.rename.targets, ...record.rename.predecessors].some(id => typeof id !== "string" || !/^(legacy|[0-9a-f-]{36})$/.test(id)))) {
			throw new Error("统计路径映射格式损坏");
		}
		return { ...record, data: this.validate(record.data) };
	}

	private async writeRecord(record: StatisticsRecord): Promise<void> {
		record = { ...record, data: this.validate(record.data) };
		const path = `记录/${record.id === "legacy" ? `legacy-${await this.digest(record.data)}` : `${record.id}-r${record.revision}`}.json`;
		await this.files.write(path, JSON.stringify(record, null, 2));
		const verified = this.parse(await this.files.read(path));
		if (canonicalStatistics(verified) !== canonicalStatistics(record)) throw new Error("统计记录写入校验失败");
		this.records.set(record.id, verified);
		if (record.id === this.recordId) this.ownVersions.push(path);
		this.version++;
	}

	private async pruneOwnVersions(): Promise<void> {
		while (this.ownVersions.length > 2) {
			try { await this.files.remove(this.ownVersions[0]); this.ownVersions.shift(); }
			catch (error) { console.warn("旧统计版本清理失败，已保留文件", error); return; }
		}
	}

	private async digest(data: StatisticsData): Promise<string> {
		const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalStatistics(data)));
		return Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, "0")).join("");
	}
}
