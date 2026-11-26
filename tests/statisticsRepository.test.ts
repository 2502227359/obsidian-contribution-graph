import { describe, expect, it } from "vitest";
import { StatisticsRepository, StatisticsFiles } from "../src/activity/StatisticsRepository";
import { applyStatisticsRename, closeStatistics, emptyStatistics, mergeStatistics, statisticsFrom } from "../src/activity/statisticsModel";

function files(): StatisticsFiles & { contents: Map<string, string> } {
	const contents = new Map<string, string>();
	return {
		contents,
		list: async () => [...contents.keys()],
		read: async path => { if (!contents.has(path)) throw Error("文件不存在"); return contents.get(path)!; },
		write: async (path, data) => { contents.set(path, data); },
	};
}

function sample(count: number) {
	const data = emptyStatistics();
	data.dailyStats["2026-11-15"] = { addedChars: count, deletedChars: 0,
		documents: { "笔记.md": { addedChars: count, deletedChars: 0 } } };
	return data;
}

describe("普通目录统计记录", () => {
	it("同一安装重启和退出复用当月两个文件，跨月保留此前统计且不重复累加", async () => {
		const fs = files(), installation = crypto.randomUUID();
		let now = new Date(2026, 10, 29, 10).getTime();
		fs.writeSync = (path, data) => { fs.contents.set(path, data); return true; };
		const start = async () => {
			const repo = new StatisticsRepository(fs, data => data as ReturnType<typeof sample>, () => now, { id: installation });
			await repo.initialize();
			return repo;
		};
		const first = await start();
		await first.save(sample(10));
		expect(first.saveSync(sample(15))).toBe(true);
		const second = await start();
		await second.save(sample(25));
		expect([...fs.contents.keys()].sort()).toEqual([0, 1].map(slot => `月度/${installation}/2026-11-${slot}.json`));
		now = new Date(2026, 11, 1, 10).getTime();
		await second.save(sample(30));
		expect([...fs.contents.keys()].filter(path => path.includes("2026-12"))).toHaveLength(1);
		expect((await start()).read(emptyStatistics()).dailyStats["2026-11-15"].addedChars).toBe(45);
	});

	it("历史归档保留原编号、版本和明细，旧散文件迟到也不重复统计", async () => {
		const fs = files(), id = crypto.randomUUID();
		const older = `记录/${id}-r1.json`, latest = `记录/${id}-r2.json`;
		for (const [path, revision, data] of [[older, 1, sample(10)], [latest, 2, sample(15)]] as const) {
			fs.contents.set(path, JSON.stringify({ formatVersion: 1, kind: "statistics", id, revision, updatedAt: revision, generation: "initial", data }));
		}
		const repo = new StatisticsRepository(fs, data => data as ReturnType<typeof sample>);
		await repo.initialize();
		await repo.archiveLegacyStatistics();
		await repo.archiveLegacyStatistics();
		expect(fs.contents.size).toBe(3);
		const archive = [...fs.contents].find(([path]) => path.startsWith("归档/"))!;
		expect(JSON.parse(archive[1]).records).toEqual([JSON.parse(fs.contents.get(latest)!)]);
		fs.contents.delete(latest);
		const restarted = new StatisticsRepository(fs, data => data as ReturnType<typeof sample>);
		await restarted.initialize();
		expect(restarted.read(emptyStatistics())).toEqual(repo.read(emptyStatistics()));
	});

	it("重启后识别回退的月文件，仍能读取已确认版本并恢复损坏的备用文件", async () => {
		const fs = files();
		let sequences: Record<string, number> = {};
		const installation = {
			id: crypto.randomUUID(),
			loadSequences: () => ({ ...sequences }),
			saveSequences: (value: Record<string, number>) => { sequences = value; },
		};
		const start = () => new StatisticsRepository(fs, data => data as ReturnType<typeof sample>, undefined, installation);
		const writer = start();
		await writer.initialize();
		await writer.save(sample(10));
		const older = [...fs.contents][0];
		await writer.save(sample(20));
		await writer.save(sample(30));
		const newest = fs.contents.get(older[0])!;
		fs.contents.set(...older);
		await expect(start().initialize()).rejects.toThrow("缺少已确认的版本");
		fs.contents.set(older[0], newest);
		const backup = [...fs.contents.keys()].find(path => path !== older[0])!;
		fs.contents.set(backup, "未写完");
		const restarted = start();
		await restarted.initialize();
		expect(restarted.read(emptyStatistics()).dailyStats["2026-11-15"].addedChars).toBe(30);
		await restarted.save(sample(5));
		expect(JSON.parse(fs.contents.get(backup)!).records).toHaveLength(2);
	});

	it("历史归档保留旧基线、重命名映射和替换世代链", async () => {
		const fs = files();
		const start = () => new StatisticsRepository(fs, data => data as ReturnType<typeof sample>);
		const writer = start();
		await writer.initialize(sample(10));
		writer.rename("笔记.md", "归档笔记.md", false);
		await writer.save(emptyStatistics());
		await writer.replace(sample(20));
		await writer.replace(sample(30));
		const prior = writer.readSources(emptyStatistics()).slice(0, -1);
		expect(await writer.archiveLegacyStatistics()).toBe(4);
		for (const path of fs.contents.keys()) {
			if (path.startsWith("记录/")) fs.contents.delete(path);
		}
		const restarted = start();
		await restarted.initialize();
		expect(restarted.generationId).toBe(writer.generationId);
		expect(restarted.readSources(emptyStatistics()).slice(0, -1)).toEqual(prior);
	});

	it("片段深拷贝、合并去重、冲突隔离、封口和重命名沿统计链路生效", () => {
		const first = emptyStatistics();
		first.timeActivity.timeline = { formatVersion: 1, segments: [], recordingPeriods: [] };
		first.timeActivity.buckets["2026-11-15T09-+480"] = { date: "2026-11-15", hour: 9, offsetMinutes: 480, documents: { "原/甲.md": 20 } };
		first.timeActivity.timeline!.segments = [{ id: "same", continuityId: "c", recordingPeriodId: "p", path: "原/甲.md", bucketKey: "2026-11-15T09-+480", start: 100, end: 200, seconds: 20 }];
		first.timeActivity.timeline!.recordingPeriods = [{ id: "p", start: 50, folders: [] }];
		const copy = statisticsFrom(first);
		copy.timeActivity.timeline!.segments[0].path = "副本.md";
		expect(first.timeActivity.timeline!.segments[0].path).toBe("原/甲.md");
		const second = statisticsFrom(first);
		second.timeActivity.timeline!.segments.push({ ...second.timeActivity.timeline!.segments[0], id: "other", path: "原/乙.md" });
		const conflict = statisticsFrom(first);
		conflict.timeActivity.timeline!.segments[0].path = "冲突.md";
		const merged = mergeStatistics([first, second, conflict]);
		expect(merged.timeActivity.timeline!.segments.map(segment => segment.id)).toEqual(["other"]);
		expect(merged.timeActivity.timeline!.issues).toContain("segment-conflict:same");
		expect(closeStatistics(first, 500).timeActivity.timeline!.recordingPeriods[0].end).toBe(500);
		const renamed = applyStatisticsRename(first, { oldPath: "原", newPath: "新", isFolder: true });
		expect(renamed.timeActivity.timeline!.segments[0].path).toBe("新/甲.md");
	});

	it("深拷贝、合并与重命名保留指定笔记范围元数据", () => {
		const first = emptyStatistics();
		first.collectionScopePeriods = [{
			startDate: "2026-11-15",
			folders: ["临床医学"],
			files: ["根笔记.md"],
		}];
		first.timeActivity.periods = [{
			start: 100,
			folders: ["临床医学"],
			files: ["根笔记.md"],
		}];
		first.timeActivity.timeline = {
			formatVersion: 1,
			segments: [],
			recordingPeriods: [{
				id: "p", start: 100, folders: ["临床医学"], files: ["根笔记.md"],
			}],
		};

		const copy = statisticsFrom(first);
		copy.collectionScopePeriods[0].files!.push("副本.md");
		copy.timeActivity.periods[0].files!.push("副本.md");
		copy.timeActivity.timeline!.recordingPeriods[0].files!.push("副本.md");
		expect(first.collectionScopePeriods[0].files).toEqual(["根笔记.md"]);
		expect(first.timeActivity.periods[0].files).toEqual(["根笔记.md"]);
		expect(first.timeActivity.timeline!.recordingPeriods[0].files).toEqual(["根笔记.md"]);

		const merged = mergeStatistics([first]);
		const renamed = applyStatisticsRename(merged, {
			oldPath: "根笔记.md", newPath: "新笔记.md", isFolder: false,
		});
		expect(renamed.collectionScopePeriods[0].files).toEqual(["新笔记.md"]);
		expect(renamed.timeActivity.periods[0].files).toEqual(["新笔记.md"]);
		expect(renamed.timeActivity.timeline!.recordingPeriods[0].files).toEqual(["新笔记.md"]);
	});

	it("来源读取复用有效记录选择，并暴露匿名来源标识", async () => {
		const fs = files();
		const repo = new StatisticsRepository(fs, data => data as any);
		await repo.initialize();
		const local = emptyStatistics();
		local.timeActivity.buckets["2026-11-15T09-+480"] = { date: "2026-11-15", hour: 9, offsetMinutes: 480, documents: { "甲.md": 10 } };
		const sources = repo.readSources(local);
		expect(sources).toHaveLength(1);
		expect(sources[0].id).toBeTruthy();
		expect(sources[0].data.timeActivity.buckets["2026-11-15T09-+480"].documents["甲.md"]).toBe(10);
	});

	it("较新版本的时长回撤覆盖旧值，保留其他运行且重放旧版本不复活", async () => {
		const fs = files();
		const left = new StatisticsRepository(fs, data => data as any);
		const right = new StatisticsRepository(fs, data => data as any);
		await left.initialize(); await right.initialize();
		const data = emptyStatistics(), other = emptyStatistics();
		const key = "2026-11-15T10-+480";
		data.timeActivity.buckets[key] = { date: "2026-11-15", hour: 10, offsetMinutes: 480, documents: { "甲.md": 300 } };
		other.timeActivity.buckets[key] = { date: "2026-11-15", hour: 10, offsetMinutes: 480, documents: { "甲.md": 600 } };
		await left.save(data); await right.save(other);
		const old = new Map(fs.contents);
		data.timeActivity.buckets = {};
		await left.save(data); await right.refresh();
		expect(right.read(other).timeActivity.buckets[key].documents["甲.md"]).toBe(600);
		for (const [path, value] of old) fs.contents.set(path, value);
		await right.refresh();
		expect(right.read(other).timeActivity.buckets[key].documents["甲.md"]).toBe(600);
		const restarted = new StatisticsRepository(fs, data => data as any);
		await restarted.initialize();
		expect(restarted.read(emptyStatistics()).timeActivity.buckets[key].documents["甲.md"]).toBe(600);
	});

	it("不同运行的记录相加，重复同步和旧版本不重复累计，重启不重计", async () => {
		const fs = files();
		const left = new StatisticsRepository(fs, data => data as any);
		const right = new StatisticsRepository(fs, data => data as any);
		await left.initialize(); await right.initialize();
		await left.save(sample(200));
		const old = new Map(fs.contents);
		await left.save(sample(250)); await right.save(sample(300));
		await right.refresh();
		expect(right.read(sample(300)).dailyStats["2026-11-15"].addedChars).toBe(550);
		for (const [path, data] of old) fs.contents.set(path, data);
		await right.refresh();
		expect(right.read(sample(300)).dailyStats["2026-11-15"].addedChars).toBe(550);
		const restarted = new StatisticsRepository(fs, data => data as any);
		await restarted.initialize();
		expect(restarted.read(emptyStatistics()).dailyStats["2026-11-15"].addedChars).toBe(550);
	});
	it("清空发布替换记录，离线旧记录再同步不会复活，恢复产生新世代", async () => {
		const fs = files();
		const left = new StatisticsRepository(fs, data => data as any);
		const offline = new StatisticsRepository(fs, data => data as any);
		await left.initialize(sample(10)); await offline.initialize();
		await offline.save(sample(20));
		await left.replace(emptyStatistics());
		await offline.save(sample(25));
		const restarted = new StatisticsRepository(fs, data => data as any);
		await restarted.initialize();
		expect(restarted.read(emptyStatistics()).dailyStats).toEqual({});
		await restarted.replace(sample(30));
		expect(restarted.read(emptyStatistics()).dailyStats["2026-11-15"].addedChars).toBe(30);
		await offline.refresh();
		expect(offline.read(emptyStatistics()).dailyStats["2026-11-15"].addedChars).toBe(30);
	});
	it("重命名应用到已汇总记录，重复同步映射不重复计数", async () => {
		const fs = files();
		const repo = new StatisticsRepository(fs, data => data as any);
		await repo.initialize(sample(20));
		repo.rename("笔记.md", "归档.md", false);
		await repo.save(emptyStatistics());
		const restarted = new StatisticsRepository(fs, data => data as any);
		await restarted.initialize();
		expect(restarted.read(emptyStatistics()).dailyStats["2026-11-15"].documents).toEqual({ "归档.md": { addedChars: 20, deletedChars: 0 } });
	});
	it("损坏和同版本冲突保留上次有效统计，修复后可继续读取", async () => {
		const fs = files();
		const writer = new StatisticsRepository(fs, data => data as any);
		await writer.initialize(); await writer.save(sample(20));
		const receiver = new StatisticsRepository(fs, data => data as any);
		await receiver.initialize();
		const [path, valid] = [...fs.contents][0];
		fs.contents.set(path, "{坏数据");
		await expect(receiver.refresh()).rejects.toThrow();
		expect(receiver.read(emptyStatistics()).dailyStats["2026-11-15"].addedChars).toBe(20);
		const conflicting = JSON.parse(valid); conflicting.records[0].data = sample(99);
		fs.contents.set(path, JSON.stringify(conflicting));
		await expect(receiver.refresh()).rejects.toThrow("冲突");
		fs.contents.set(path, valid); await receiver.refresh();
		expect(receiver.read(emptyStatistics()).dailyStats["2026-11-15"].addedChars).toBe(20);
	});
	it("已存在的相同旧历史只迁入一次，不同旧历史拒绝相加", async () => {
		const fs = files();
		await new StatisticsRepository(fs, data => data as any).initialize(sample(200));
		const duplicate = new StatisticsRepository(fs, data => data as any);
		await duplicate.initialize(sample(200));
		expect(duplicate.read(emptyStatistics()).dailyStats["2026-11-15"].addedChars).toBe(200);
		await expect(new StatisticsRepository(fs, data => data as any).initialize(sample(300))).rejects.toThrow("旧版历史");
	});
	it("两份不同旧历史首次离线迁移不会覆盖同一文件，汇合时明确冲突", async () => {
		const first = files(), second = files();
		await new StatisticsRepository(first, data => data as any).initialize(sample(200));
		await new StatisticsRepository(second, data => data as any).initialize(sample(300));
		for (const [path, content] of second.contents) first.contents.set(path, content);
		expect(first.contents.size).toBe(2);
		await expect(new StatisticsRepository(first, data => data as any).initialize()).rejects.toThrow("冲突");
	});
	it("替换操作乱序到达等待父操作，不提前把未完整同步的记录当零", async () => {
		const fs = files(), writer = new StatisticsRepository(fs, data => data as any);
		await writer.initialize(sample(10));
		await writer.replace(sample(20));
		await writer.replace(sample(30));
		const delivered = files();
		const entries = [...fs.contents];
		const operations = entries.filter(([, content]) => JSON.parse(content).kind === "replacement");
		const legacy = entries.find(([, content]) => JSON.parse(content).id === "legacy")!;
		delivered.contents.set(...legacy); delivered.contents.set(...operations[1]);
		const receiver = new StatisticsRepository(delivered, data => data as any);
		await receiver.initialize();
		expect(receiver.read(emptyStatistics()).dailyStats["2026-11-15"].addedChars).toBe(10);
		delivered.contents.set(...operations[0]); await receiver.refresh();
		expect(receiver.read(emptyStatistics()).dailyStats["2026-11-15"].addedChars).toBe(30);
	});
	it("并发替换明确冲突，显式导入后可以恢复一致", async () => {
		const fs = files(), peer = files();
		const left = new StatisticsRepository(fs, data => data as any), right = new StatisticsRepository(peer, data => data as any);
		await left.initialize(); await right.initialize();
		await left.replace(sample(20)); await right.replace(sample(30));
		for (const [path, content] of peer.contents) fs.contents.set(path, content);
		await expect(left.refresh()).rejects.toThrow("并发");
		expect(left.read(emptyStatistics()).dailyStats["2026-11-15"].addedChars).toBe(20);
		await expect(left.save(sample(2))).rejects.toThrow("暂停");
		await left.replace(sample(40));
		expect(left.read(emptyStatistics()).dailyStats["2026-11-15"].addedChars).toBe(40);
	});
	it("两个固定文件交替保存，较旧文件迟到后重启仍取最新累计", async () => {
		const fs = files(), repo = new StatisticsRepository(fs, data => data as any);
		await repo.initialize(); await repo.save(sample(10));
		const old = [...fs.contents][0];
		await repo.save(sample(20)); await repo.save(sample(30)); await repo.save(sample(40));
		expect(fs.contents.size).toBe(2);
		fs.contents.set(...old);
		const restarted = new StatisticsRepository(fs, data => data as any);
		await restarted.initialize();
		expect(restarted.read(emptyStatistics()).dailyStats["2026-11-15"].addedChars).toBe(40);
	});
	it("同步退出检查点高于进行中的旧写入，排队的旧快照不能覆盖最终数据", async () => {
		const fs = files();
		fs.writeSync = (path, content) => { fs.contents.set(path, content); return true; };
		const repo = new StatisticsRepository(fs, data => data as any);
		await repo.initialize();
		let release!: () => void;
		fs.write = async (path, content) => { await new Promise<void>(resolve => { release = resolve; }); fs.contents.set(path, content); };
		const older = repo.save(sample(20));
		while (!release) await Promise.resolve();
		expect(repo.saveSync(sample(30))).toBe(true);
		const queued = repo.save(sample(5));
		release(); await older; await queued;
		const restarted = new StatisticsRepository(fs, data => data as any);
		await restarted.initialize();
		expect(restarted.read(emptyStatistics()).dailyStats["2026-11-15"].addedChars).toBe(30);
	});
	it("退出检查点也保存未到期的历史路径重命名操作", async () => {
		const fs = files();
		fs.writeSync = (path, content) => { fs.contents.set(path, content); return true; };
		const repo = new StatisticsRepository(fs, data => data as any);
		await repo.initialize(sample(20));
		repo.rename("笔记.md", "归档.md", false);
		expect(repo.saveSync(emptyStatistics())).toBe(true);
		const restarted = new StatisticsRepository(fs, data => data as any);
		await restarted.initialize();
		expect(restarted.read(emptyStatistics()).dailyStats["2026-11-15"].documents).toEqual({"归档.md": {addedChars: 20, deletedChars: 0}});
	});
});
