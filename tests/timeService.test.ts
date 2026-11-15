import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditActivityService } from "../src/activity/EditActivityService";

describe("时长统计的保存与查询", () => {
	let wall: number;
	let mono: number;
	let plugin: any;
	let service: EditActivityService;
	beforeEach(async () => {
		vi.useFakeTimers();
		wall = new Date(2026, 10, 14, 9, 59, 30).getTime();
		mono = 0;
		Object.defineProperty(globalThis, "window", { configurable: true, value: {
			setTimeout, clearTimeout, localStorage: { getItem: () => "zh" },
		} });
		plugin = { loadData: vi.fn(async () => null), saveData: vi.fn(async () => undefined),
			manifest: { dir: ".obsidian/plugins/test" }, app: { vault: { adapter: {
				write: vi.fn(async () => undefined), list: vi.fn(async () => ({ files: [] })),
			} } } };
		service = new EditActivityService(plugin, () => new Date(wall), () => mono);
		await service.initialize();
	});
	afterEach(async () => { await service.unload(); vi.useRealTimers(); });
	const advance = (seconds: number) => {
		for (let i = 0; i < seconds; i += 15) {
			wall += 15000; mono += 15000; service.checkpointTimeActivity();
		}
	};
	it("字数关闭时仍可独立计时，跨小时汇总与明细一致", async () => {
		expect(service.getSettings().idleTimeoutMinutes).toBe(5);
		await service.setTimeTrackingEnabled(true);
		service.recordTimeActivity("笔记/甲.md");
		advance(60);
		service.pauseTimeActivity();
		expect(service.getDailyTimeStats()[0].seconds).toBe(60);
		expect(service.getHourlyTimeStats().map(item => item.seconds)).toEqual([30, 30]);
		expect(service.getDailyEditStats()).toEqual([]);
		await service.flush();
		const saved = plugin.saveData.mock.calls.at(-1)[0];
		expect(saved.timeActivity.buckets).toBeDefined();
		expect(saved.settings.timeTrackingEnabled).toBe(true);
	});
	it("时长变化事件携带实际跨小时和跨午夜键", async () => {
		const events: any[] = [];
		service.subscribe(event => events.push(event));
		await service.setTimeTrackingEnabled(true);
		service.recordTimeActivity("笔记/甲.md");
		advance(60);
		service.pauseTimeActivity();
		const timeKeys = events.filter(event => event.type === "TIME_STATS" && event.timeKeys)
			.flatMap(event => event.timeKeys)
			.filter((key, index, keys) => keys.findIndex(item => item.date === key.date && item.hour === key.hour) === index);
		expect(timeKeys).toEqual([
			{date: "2026-11-14", hour: 9},
			{date: "2026-11-14", hour: 10},
		]);
	});
	it("统计设置事件标记来源，空时长不会广播变化", async () => {
		const events: any[] = [];
		service.subscribe(event => events.push(event));
		await service.setTrackingEnabled(true);
		await service.setTrackingEnabled(false);
		expect(events.at(-1)).toMatchObject({ type: "COVERAGE", source: "EDIT_ACTIVITY" });
		await service.setTimeTrackingEnabled(true);
		expect(events.at(-1)).toMatchObject({ type: "TIME_STATS", source: "TIME_ACTIVITY" });
		const before = events.length;
		(service as any).recordTimeSpan({ path: "笔记/甲.md", start: 0, end: 0, seconds: 0 });
		expect(events).toHaveLength(before);
	});
	it("默认五分钟到期停止，设置修改只作用于之后", async () => {
		await service.setTimeTrackingEnabled(true);
		service.recordTimeActivity("笔记/甲.md");
		advance(360);
		expect(service.getDailyTimeStats()[0].seconds).toBe(300);
		await service.setIdleTimeoutMinutes(1);
		service.recordTimeActivity("笔记/甲.md");
		advance(120);
		expect(service.getDailyTimeStats()[0].seconds).toBe(360);
		await expect(service.setIdleTimeoutMinutes(0)).rejects.toThrow();
		expect(service.getSettings().idleTimeoutMinutes).toBe(1);
	});
	it("范围外活动不计时，切换范围先结束旧会话", async () => {
		await service.setTrackedFolders(["项目"]);
		await service.setTimeTrackingEnabled(true);
		service.recordTimeActivity("项目/甲.md"); advance(30);
		service.recordTimeActivity("其他/乙.md"); advance(30);
		expect(service.getDailyTimeStats()[0].seconds).toBe(30);
		await service.setTrackedFolders(["其他"]);
		service.recordTimeActivity("其他/乙.md"); advance(30);
		expect(service.getDailyTimeStats({ folders: ["项目"] })[0].seconds).toBe(30);
		expect(service.getDailyTimeStats({ folders: ["其他"] })[0].seconds).toBe(30);
	});
	it("导出回导保持时长，清空后旧会话不再写入", async () => {
		await service.setTimeTrackingEnabled(true);
		service.recordTimeActivity("笔记/甲.md"); advance(30);
		const exported = service.exportData();
		await service.clearData();
		advance(30);
		expect(service.getDailyTimeStats()).toEqual([]);
		await service.importData(exported);
		advance(30);
		expect(service.getDailyTimeStats()[0].seconds).toBe(30);
	});
	it("持续操作期间的心跳也会保存，不被输入防抖无限推迟", async () => {
		await service.setTimeTrackingEnabled(true);
		service.recordTimeActivity("笔记/甲.md");
		for (let i = 0; i < 15; i++) {
			wall += 1000; mono += 1000;
			service.recordTimeActivity("笔记/甲.md");
		}
		service.checkpointTimeActivity();
		await vi.advanceTimersByTimeAsync(0);
		const saved = plugin.saveData.mock.calls.at(-1)[0];
		expect(Object.keys(saved.timeActivity.buckets).length).toBeGreaterThan(0);
	});
});
