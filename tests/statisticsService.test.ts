import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditActivityService } from "../src/activity/EditActivityService";
import { EMPTY_EDIT_ACTIVITY_STORE } from "../src/activity/types";
import { memoryVault, persistedStatistics } from "./helpers/memoryVault";
import { emptyStatistics } from "../src/activity/statisticsModel";
import { StatisticsRepository } from "../src/activity/StatisticsRepository";
import { VaultStatisticsFiles } from "../src/activity/VaultStatisticsFiles";

describe("活动服务普通目录存储", () => {
	let service: EditActivityService;
	beforeEach(() => {
		vi.useFakeTimers(); Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
		Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => "zh" } });
	});
	afterEach(async () => { await service?.unload(); vi.useRealTimers(); });
	it("迁移保留历史，持续计时及卸载不写插件配置", async () => {
		let time = new Date(2026, 10, 15, 10).getTime(), mono = 0;
		const initial = JSON.parse(JSON.stringify(EMPTY_EDIT_ACTIVITY_STORE));
		initial.settings.timeTrackingEnabled = true;
		initial.dailyStats["2026-11-14"] = { addedChars: 200, deletedChars: 3, documents: {} };
		const vault = memoryVault();
		const plugin = { manifest: {dir: ".obsidian/plugins/test"}, app: {vault},
			loadData: vi.fn(async () => initial), saveData: vi.fn(async (_data: unknown) => undefined) };
		service = new EditActivityService(plugin as never, () => new Date(time), () => mono);
		await service.initialize(); await service.flush();
		expect(service.getDailyEditStats()[0]).toMatchObject({ addedChars: 200, deletedChars: 3 });
		expect(plugin.saveData.mock.lastCall?.[0]).not.toHaveProperty("dailyStats");
		plugin.saveData.mockClear();
		service.recordTimeActivity("笔记.md");
		for (let i = 0; i < 4; i++) { time += 15000; mono += 15000; service.checkpointTimeActivity(); await service.flush(); }
		await service.unload();
		expect(plugin.saveData).not.toHaveBeenCalled();
		expect(vault.adapter.write.mock.calls.every(([path]) => !path.startsWith(".obsidian/"))).toBe(true);
		expect(service.getDailyTimeStats()[0].seconds).toBe(60);
	});
	it("外部记录更新汇总并发出局部通知，重复同步不回写、不算本机输入", async () => {
		const files = new Map<string, string>(), vault = memoryVault(files);
		const plugin = { manifest: {dir: ".obsidian/plugins/test"}, app: {vault},
			loadData: vi.fn(async () => null), saveData: vi.fn(async (_data: unknown) => undefined) };
		service = new EditActivityService(plugin as never);
		await service.initialize(); plugin.saveData.mockClear();
		const data = emptyStatistics();
		data.dailyStats["2026-11-15"] = { addedChars: 300, deletedChars: 5, documents: { "笔记.md": { addedChars: 300, deletedChars: 5 } } };
		data.timeActivity.buckets["2026-11-15T10-+480"] = { date: "2026-11-15", hour: 10, offsetMinutes: 480, documents: { "笔记.md": 1800 } };
		const id = crypto.randomUUID(), path = `Template/数据/学习统计/记录/${id}.json`;
		const record = { formatVersion: 1, kind: "statistics", id, revision: 1, updatedAt: Date.now(), generation: "initial", data };
		const events: any[] = []; service.subscribe(event => events.push(event));
		await vault.create(path, JSON.stringify(record)); await vi.advanceTimersByTimeAsync(151);
		expect(service.getDailyEditStats()[0]).toMatchObject({ addedChars: 300, deletedChars: 5 });
		expect(service.getDailyTimeStats()[0].seconds).toBe(1800);
		expect(events).toContainEqual({type: "STATS", source: "EDIT_ACTIVITY", date: "2026-11-15"});
		expect(events).toContainEqual({type: "TIME_STATS", source: "TIME_ACTIVITY", timeKeys: [{ date: "2026-11-15", hour: 10 }]});
		events.length = 0; vault.adapter.write.mockClear();
		await vault.adapter.write(path, JSON.stringify(record)); await vi.advanceTimersByTimeAsync(151);
		expect(events).toEqual([]);
		expect(vault.adapter.write).toHaveBeenCalledTimes(1);
		expect(plugin.saveData).not.toHaveBeenCalled();
		await service.flush();
		const own = persistedStatistics([...files.entries()].filter(([key]) => key !== path).map(([, value]) => value));
		expect(own.every(record => Object.keys(record.data.dailyStats).length === 0)).toBe(true);
	});
	it("启用后立即退出的零长度覆盖也能成功持久化", async () => {
		const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const vault = memoryVault();
		const plugin = { manifest: {dir: ".obsidian/plugins/test"}, app: {vault},
			loadData: vi.fn(async () => null), saveData: vi.fn(async (_data: unknown) => undefined) };
		const now = new Date(2026, 10, 15, 10);
		service = new EditActivityService(plugin as never, () => now);
		await service.initialize(); await service.setTimeTrackingEnabled(true); await service.unload();
		expect(errors).not.toHaveBeenCalled(); errors.mockRestore();
	});
	it("远端替换前保存尚未结算的本机时长到旧世代，随后显示新统计", async () => {
		const files = new Map<string, string>(), vault = memoryVault(files);
		let wall = new Date(2026, 10, 15, 10).getTime(), mono = 0;
		const initial = JSON.parse(JSON.stringify(EMPTY_EDIT_ACTIVITY_STORE)); initial.settings.timeTrackingEnabled = true;
		const plugin = { manifest: {dir: ".obsidian/plugins/test"}, app: {vault},
			loadData: vi.fn(async () => initial), saveData: vi.fn(async (_data: unknown) => undefined) };
		service = new EditActivityService(plugin as never, () => new Date(wall), () => mono);
		await service.initialize(); plugin.saveData.mockClear(); service.recordTimeActivity("本机.md");
		wall += 10000; mono += 10000;
		const incoming = new Map<string, string>();
		const writer = new StatisticsRepository({list: async () => [...incoming.keys()], read: async path => incoming.get(path)!, write: async (path, value) => { incoming.set(path, value); }}, data => data as any);
		await writer.initialize(); await writer.replace(emptyStatistics());
		for (const [path, content] of incoming) await vault.create(`Template/数据/学习统计/${path}`, content);
		await vi.advanceTimersByTimeAsync(151);
		expect(service.getDailyTimeStats()).toEqual([]);
		const old = persistedStatistics(files.values()).filter(record => record.generation === "initial");
		const seconds = old.flatMap(record => Object.values(record.data.timeActivity.buckets) as any[]).reduce((sum, bucket) => sum + (bucket.documents["本机.md"] || 0), 0);
		expect(seconds).toBe(10); expect(plugin.saveData).not.toHaveBeenCalled();
	});
	it("冷启动仓库尚未建立 TFile 索引时，覆盖已有月度文件不报保存失败", async () => {
		const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const installationId = "3d4efae1-e874-4cc0-8ae8-d3d5709a845e";
		const storage = new Map<string, string>([
			["language", "zh"],
			["contribution-graph-local:statistics-installation", installationId],
		]);
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: {
				getItem: (key: string) => storage.get(key) ?? null,
				setItem: (key: string, value: string) => { storage.set(key, value); },
			},
		});
		const baseData = emptyStatistics();
		baseData.dailyStats["2026-11-14"] = {
			addedChars: 120,
			deletedChars: 10,
			documents: { "笔记.md": { addedChars: 120, deletedChars: 10 } },
		};
		const prevRecord = {
			formatVersion: 1 as const,
			kind: "statistics" as const,
			id: "11111111-1111-4111-8111-111111111111",
			revision: 2,
			updatedAt: new Date(2026, 10, 15, 9).getTime(),
			generation: "initial",
			data: baseData,
		};
		const frame1 = { formatVersion: 2, kind: "monthly", sequence: 1, records: [{ ...prevRecord, revision: 1 }] };
		const frame2 = { formatVersion: 2, kind: "monthly", sequence: 2, records: [prevRecord] };
		const files = new Map<string, string>([
			[`Template/数据/学习统计/月度/${installationId}/2026-11-1.json`, JSON.stringify(frame1)],
			[`Template/数据/学习统计/月度/${installationId}/2026-11-0.json`, JSON.stringify(frame2)],
		]);
		const vault = memoryVault(files);
		// 模拟 Obsidian 启动阶段：插件 onload 早于 vault.load()，getAbstractFileByPath 全部返回 null，
		// 且 vault.create 与真实 Obsidian 一样在磁盘已有文件时抛出 File already exists.
		vault.getAbstractFileByPath = vi.fn(() => null);
		const createSpy = vi.fn(async (path: string, content: string) => {
			if (await vault.adapter.exists(path)) throw new Error("File already exists.");
			await vault.adapter.write(path, content);
			return { path, extension: "json" };
		});
		vault.create = createSpy;
		const savedConfig = {
			schemaVersion: 13,
			settings: { ...EMPTY_EDIT_ACTIVITY_STORE.settings, trackingEnabled: true, timeTrackingEnabled: true },
			graphThemes: [],
			storage: { formatVersion: 1, folder: "Template/数据/学习统计" },
		};
		const plugin = {
			manifest: { dir: ".obsidian/plugins/test", version: "0.30.3" },
			app: { vault },
			loadData: vi.fn(async () => savedConfig),
			saveData: vi.fn(async () => undefined),
		};
		const now = new Date(2026, 10, 15, 10);
		service = new EditActivityService(plugin as never, () => now);
		await service.initialize();
		expect(errors).not.toHaveBeenCalled();
		expect(service.getSaveStatus()).toBe("已保存");
		expect(createSpy).not.toHaveBeenCalled();
		const updatedFrame = JSON.parse(files.get(`Template/数据/学习统计/月度/${installationId}/2026-11-1.json`)!);
		expect(updatedFrame.sequence).toBe(3);
		expect(service.getDailyEditStats()[0]).toMatchObject({ addedChars: 120, deletedChars: 10 });
		errors.mockRestore();
	});
	it("VaultStatisticsFiles 在并发建文件冲突时兜底覆盖，真实写入错误仍向上抛出", async () => {
		const files = new Map<string, string>();
		const vault = memoryVault(files);
		vault.getAbstractFileByPath = () => null;
		vault.create = vi.fn(async (path: string) => {
			// 模拟并发：adapter.exists 检查时尚未出现，create 瞬间远端同步已先落盘
			files.set(path, "remote-first");
			throw new Error("File already exists.");
		});
		const statsFiles = new VaultStatisticsFiles(vault as never, "Template/数据/学习统计");
		await statsFiles.write("月度/test/2026-11-0.json", "local-win");
		expect(files.get("Template/数据/学习统计/月度/test/2026-11-0.json")).toBe("local-win");

		vault.create = vi.fn(async () => {
			throw new Error("ENOSPC: no space left on device");
		});
		await expect(statsFiles.write("月度/test/2026-11-1.json", "fail-me")).rejects.toThrow("ENOSPC");
	});
});
