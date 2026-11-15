import { describe, expect, it } from "vitest";
import { StatisticsRepository, StatisticsFiles } from "../src/activity/StatisticsRepository";
import { emptyStatistics } from "../src/activity/statisticsModel";

function files(): StatisticsFiles & { contents: Map<string, string> } {
	const contents = new Map<string, string>();
	return {
		contents,
		list: async () => [...contents.keys()],
		read: async path => { if (!contents.has(path)) throw Error("文件不存在"); return contents.get(path)!; },
		write: async (path, data) => { contents.set(path, data); },
		remove: async path => { contents.delete(path); },
	};
}

function sample(count: number) {
	const data = emptyStatistics();
	data.dailyStats["2026-11-15"] = { addedChars: count, deletedChars: 0,
		documents: { "笔记.md": { addedChars: count, deletedChars: 0 } } };
	return data;
}

describe("普通目录统计记录", () => {
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
		for (const [path, data] of old) fs.contents.set(`记录/重复-${path.split("/").pop()}`, data);
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
		const conflicting = JSON.parse(valid); conflicting.data = sample(99);
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
	it("版本使用独立文件，保留最近两版，旧版本迟到后重启仍取最新累计", async () => {
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
