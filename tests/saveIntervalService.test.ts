import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditActivityService } from "../src/activity/EditActivityService";
import { EMPTY_EDIT_ACTIVITY_STORE } from "../src/activity/types";
import { memoryVault } from "./helpers/memoryVault";

describe("统计保存间隔", () => {
	let service: EditActivityService;
	let mono: number;
	let vault: ReturnType<typeof memoryVault>;
	let plugin: any;
	beforeEach(async () => {
		vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 15, 10)); mono = 0;
		Object.defineProperty(globalThis, "window", {configurable: true, value: globalThis});
		Object.defineProperty(globalThis, "localStorage", {configurable: true, value: {getItem: () => "zh"}});
		const initial = JSON.parse(JSON.stringify(EMPTY_EDIT_ACTIVITY_STORE)); initial.settings.timeTrackingEnabled = true;
		vault = memoryVault();
		plugin = {manifest: {dir: ".obsidian/plugins/test"}, app: {vault}, loadData: vi.fn(async () => initial), saveData: vi.fn(async (_data: unknown) => undefined)};
		service = new EditActivityService(plugin, () => new Date(), () => mono);
		await service.initialize(); vault.adapter.write.mockClear(); plugin.saveData.mockClear();
	});
	afterEach(async () => { await service?.unload(); vi.restoreAllMocks(); vi.useRealTimers(); });
	const advance = async (seconds: number) => {
		for (let i = 0; i < seconds; i++) { mono += 1000; await vi.advanceTimersByTimeAsync(1000); }
	};
	it("默认一分钟，十五秒只结算和刷新，连续变化不推迟固定保存期限", async () => {
		expect(service.getSettings().saveIntervalSeconds).toBe(60);
		service.recordTimeActivity("学习.md");
		const events: string[] = []; service.subscribe(event => events.push(event.type));
		for (let i = 0; i < 4; i++) { await advance(15); service.checkpointTimeActivity(); }
		expect(service.getDailyTimeStats()[0].seconds).toBe(60);
		expect(events).toContain("TIME_STATS");
		expect(vault.adapter.write).not.toHaveBeenCalled();
		await advance(15);
		expect(vault.adapter.write).toHaveBeenCalledTimes(1);
		expect(plugin.saveData).not.toHaveBeenCalled();
	});
	it("设置可调整且非法值不覆盖原值，后台立即保存并合并重复通知", async () => {
		await service.setSaveIntervalSeconds(300);
		expect(plugin.saveData.mock.lastCall[0].settings.saveIntervalSeconds).toBe(300);
		for (const invalid of [0, 14, 1801, 15.5, NaN]) await expect(service.setSaveIntervalSeconds(invalid)).rejects.toThrow();
		expect(service.getSettings().saveIntervalSeconds).toBe(300);
		vault.adapter.write.mockClear(); service.recordTimeActivity("学习.md"); await advance(16);
		service.checkpointTimeActivity(); expect(service.getSaveStatus()).toBe("有待保存数据");
		expect(vault.adapter.write).not.toHaveBeenCalled();
		await Promise.all([service.handleAppSuspend(), service.handleAppSuspend()]);
		expect(vault.adapter.write).toHaveBeenCalledTimes(1);
		expect(service.getSaveStatus()).toBe("已保存");
	});
	it("退出等待已有写入及最后一批数据，重复卸载复用同一保存任务", async () => {
		let release!: () => void;
		const original = vault.adapter.write.getMockImplementation()!;
		vault.adapter.write.mockImplementationOnce(async (...args: [string, string]) => { await new Promise<void>(resolve => { release = resolve; }); await original(...args); });
		service.recordTimeActivity("学习.md"); await advance(15); service.checkpointTimeActivity();
		const saving = service.flush(); await vi.advanceTimersByTimeAsync(0);
		expect(service.getSaveStatus()).toBe("正在保存");
		await advance(10); service.checkpointTimeActivity();
		let finished = false;
		const exiting = service.unload(); expect(service.unload()).toBe(exiting);
		void exiting.then(() => { finished = true; }); await vi.advanceTimersByTimeAsync(0);
		expect(finished).toBe(false); release(); await saving; await exiting;
		expect(finished).toBe(true);
		const records = (await vault.adapter.list("Template/数据/学习统计/记录")).files;
		const latest = (await Promise.all(records.map(path => vault.adapter.read(path)))).map(value => JSON.parse(value)).sort((a,b) => b.revision-a.revision)[0];
		expect(Object.values(latest.data.timeActivity.buckets).reduce((sum: number, bucket: any) => sum + (bucket.documents["学习.md"] || 0), 0)).toBe(25);
	});
	it("失败保留待保存数据并重试，退出期间也会补做失败写入", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		service.recordTimeActivity("学习.md"); await advance(15); service.checkpointTimeActivity();
		vault.adapter.write.mockRejectedValueOnce(new Error("磁盘暂时不可用"));
		await service.flush(); expect(service.getSaveStatus()).toBe("保存失败，待重试");
		await advance(5); expect(service.getSaveStatus()).toBe("已保存");
		await advance(2); service.checkpointTimeActivity();
		vault.adapter.write.mockRejectedValueOnce(new Error("退出写入暂时失败"));
		await service.unload(); expect(service.getSaveStatus()).toBe("已保存");
	});
	it("未启用采集的旧配置也补入一分钟默认值，并且只保存一次配置", async () => {
		const settings: any = service.getSettings();
		settings.timeTrackingEnabled = false; settings.trackingEnabled = false; delete settings.saveIntervalSeconds;
		await service.unload();
		plugin.loadData.mockResolvedValue({schemaVersion: 11, settings, graphThemes: [], storage: {formatVersion: 1, folder: "Template/数据/学习统计"}});
		plugin.saveData.mockClear();
		service = new EditActivityService(plugin, () => new Date(), () => mono);
		await service.initialize();
		expect(service.getSettings().saveIntervalSeconds).toBe(60);
		expect(plugin.saveData).toHaveBeenCalledTimes(1);
		expect(plugin.saveData.mock.lastCall[0].settings.saveIntervalSeconds).toBe(60);
		await advance(120); await service.unload();
		expect(plugin.saveData).toHaveBeenCalledTimes(1);
	});
});
