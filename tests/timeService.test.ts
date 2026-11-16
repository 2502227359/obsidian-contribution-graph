import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditActivityService } from "../src/activity/EditActivityService";
import { memoryVault } from "./helpers/memoryVault";

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
		const files = new Map<string, string>();
		plugin = {
			loadData: vi.fn(async () => null),
			saveData: vi.fn(async () => undefined),
			manifest: { dir: ".obsidian/plugins/test" },
			app: { vault: memoryVault(files) },
			files,
		};
		service = new EditActivityService(plugin, () => new Date(wall), () => mono);
		await service.initialize();
	});
	afterEach(async () => { await service.unload(); vi.restoreAllMocks(); vi.useRealTimers(); });
	const advance = (seconds: number) => {
		for (let i = 0; i < seconds; i += 15) {
			wall += 15000; mono += 15000; service.checkpointTimeActivity();
		}
	};
	it("周回顾读取当前一致快照，不结算、保存或暴露可变统计", async () => {
		await service.setTimeTrackingEnabled(true);
		service.recordTimeActivity("笔记/甲.md"); advance(15);
		const before = service.getDailyTimeStats(), writes = plugin.app.vault.adapter.write.mock.calls.length;
		wall += 3000; mono += 3000;
		const report = service.getWeeklyReview({root: "笔记"});
		expect(report.totalSeconds).toBe(15);
		expect(report.days).toHaveLength(7);
		const extended = service.getWeeklyReview({root: "笔记"}, true);
		expect(extended.timeline?.days).toHaveLength(28);
		expect(extended.timeline?.hours).toHaveLength(168);
		expect(extended.totalSeconds).toBe(report.totalSeconds);
		extended.timeline!.hours.find(hour => hour.documents.length)!.documents[0].seconds = 888;
		report.documents[0].seconds = 999;
		expect(service.getDailyTimeStats()).toEqual(before);
		expect(plugin.app.vault.adapter.write).toHaveBeenCalledTimes(writes);
		await service.unload();
		expect(() => service.getWeeklyReview()).toThrow("正在关闭");
	});
	it("YOLO 独立活动不归笔记，全部时长包含它且范围筛选、暂停和空闲回撤口径一致", async () => {
		await service.setTrackedFolders(["临床医学"]);
		await service.setTimeTrackingEnabled(true);
		service.recordTimeActivity("activity://yolo-chat"); advance(30);
		expect(service.getTimeTrackingSnapshot()).toMatchObject({ reason: "ACTIVE", todaySeconds: 30, todayPendingSeconds: 30 });
		service.recordTimeActivity("范围外/甲.md");
		expect(service.getTimeTrackingSnapshot().reason).toBe("OUT_OF_SCOPE");
		service.recordTimeActivity("临床医学/甲.md"); advance(15);
		expect(service.getDailyTimeStats()[0].seconds).toBe(45);
		expect(service.getDailyTimeStats({ folders: ["临床医学"] })[0].seconds).toBe(15);
		expect(service.getTimeTrackingSnapshot().todaySeconds).toBe(45);
		await service.pauseTimeTrackingForSession();
		service.recordTimeActivity("activity://yolo-chat"); advance(15);
		expect(service.getTimeTrackingSnapshot()).toMatchObject({ reason: "MANUAL", todaySeconds: 45 });
		await service.resumeTimeTrackingForSession();
		service.recordTimeActivity("activity://yolo-chat"); advance(15);
		expect(service.getTimeTrackingSnapshot().todaySeconds).toBe(60);
		advance(285);
		expect(service.getTimeTrackingSnapshot()).toMatchObject({ reason: "IDLE", todaySeconds: 45,
			lastDiscard: { path: "activity://yolo-chat", recordedSeconds: 285, unrecordedSeconds: 15 } });
		expect(service.getDailyTimeStats()[0].documents).toContainEqual({ path: "activity://yolo-chat", seconds: 30 });
		expect(service.getDailyEditStats()).toEqual([]);
		const exported = service.exportData();
		await service.importData(exported);
		expect(service.getDailyTimeStats()[0].documents).toContainEqual({ path: "activity://yolo-chat", seconds: 30 });
		await service.setTimeTrackingEnabled(false);
		service.recordTimeActivity("activity://yolo-chat"); advance(15);
		expect(service.getDailyTimeStats()[0].seconds).toBe(45);
	});
	it("临时暂停保存并关闭覆盖，正文与后台事件不能恢复，显式恢复不补计", async () => {
		await service.setTimeTrackingEnabled(true);
		service.recordTimeActivity("笔记/甲.md"); advance(30);
		await service.pauseTimeTrackingForSession();
		const stopped = service.exportData();
		expect(service.getTimeTrackingSnapshot().reason).toBe("MANUAL");
		expect(service.getSaveStatus()).toBe("已保存");
		advance(30); service.recordTimeActivity("笔记/乙.md");
		service.setTimeTrackingContext({ reason: "MODAL" });
		service.setTimeTrackingContext({ reason: "READY", path: "笔记/乙.md" });
		await service.handleAppSuspend(); service.handleAppResume();
		await service.pauseTimeTrackingForSession();
		expect(service.getDailyTimeStats()[0].seconds).toBe(30);
		expect(JSON.parse(service.exportData()).timeActivity.periods).toEqual(JSON.parse(stopped).timeActivity.periods);
		await service.resumeTimeTrackingForSession();
		service.recordTimeActivity("笔记/乙.md"); advance(15); service.pauseTimeActivity();
		expect(service.getDailyTimeStats()[0].seconds).toBe(45);
		expect(JSON.parse(service.exportData()).timeActivity.periods).toHaveLength(2);
	});
	it("暂停不被范围、全局开关和数据替换绕过，保存失败仍暂停且运行状态不导出", async () => {
		await service.setTimeTrackingEnabled(true);
		service.recordTimeActivity("笔记/甲.md"); advance(15);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		plugin.app.vault.adapter.write.mockRejectedValueOnce(new Error("磁盘错误"));
		await service.pauseTimeTrackingForSession();
		expect(service.getSaveStatus()).toBe("保存失败，待重试");
		expect(service.getTimeTrackingSnapshot().manualPaused).toBe(true);
		await service.flush();
		const exported = service.exportData();
		await service.setTimeTrackingEnabled(false); await service.resumeTimeTrackingForSession();
		await service.setTimeTrackingEnabled(true); await service.setTrackedFolders(["笔记"]);
		await service.importData(exported); await service.clearData(); await service.restoreLatestBackup();
		service.recordTimeActivity("笔记/乙.md"); advance(15);
		expect(service.getTimeTrackingSnapshot().reason).toBe("MANUAL");
		const saved = JSON.parse(service.exportData());
		expect(saved.timeActivity.periods.every((period: { end?: number }) => period.end !== undefined)).toBe(true);
		expect(saved).not.toHaveProperty("manualTimePaused");
		expect(saved).not.toHaveProperty("lastTimeDiscard");
	});
	it("跨午夜快照只报今日已计暂计量，真实回撤结果不可被展示修改且替换后清除", async () => {
		wall = new Date(2026, 10, 14, 23, 59, 45).getTime();
		await service.setTimeTrackingEnabled(true);
		service.recordTimeActivity("笔记/甲.md"); advance(30);
		expect(service.getTimeTrackingSnapshot()).toMatchObject({ todaySeconds: 15, todayPendingSeconds: 15, remainingMs: 270000 });
		advance(270);
		const snapshot = service.getTimeTrackingSnapshot();
		expect(snapshot).toMatchObject({ reason: "IDLE", todaySeconds: 0, todayPendingSeconds: 0,
			lastDiscard: { recordedSeconds: 285, unrecordedSeconds: 15 } });
		snapshot.lastDiscard!.recordedSeconds = 999;
		expect(service.getTimeTrackingSnapshot().lastDiscard!.recordedSeconds).toBe(285);
		await service.clearData();
		expect(service.getTimeTrackingSnapshot().lastDiscard).toBeUndefined();
	});
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
		expect(plugin.saveData).toHaveBeenCalled();
		const records = [...plugin.files.entries()]
			.filter(([path]) => path.startsWith("Template/数据/学习统计/记录/") && path.endsWith(".json"))
			.map(([, content]) => JSON.parse(content));
		expect(records.at(-1)).toMatchObject({
			kind: "statistics",
			data: {
				timeActivity: { buckets: expect.any(Object) },
			},
		});
	});
	it("时长变化事件携带实际跨小时和跨午夜键", async () => {
		const events: any[] = [];
		service.subscribe(event => { if (event.type !== "SAVE_STATE") events.push(event); });
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
		service.subscribe(event => { if (event.type !== "SAVE_STATE") events.push(event); });
		await service.setTrackingEnabled(true);
		await service.setTrackingEnabled(false);
		expect(events.at(-1)).toMatchObject({ type: "COVERAGE", source: "EDIT_ACTIVITY" });
		await service.setTimeTrackingEnabled(true);
		expect(events.at(-1)).toMatchObject({ type: "TIME_STATS", source: "TIME_ACTIVITY" });
		const before = events.length;
		(service as any).recordTimeSpan({ path: "笔记/甲.md", start: 0, end: 0, seconds: 0 }, "add");
		expect(events).toHaveLength(before);
	});
	it("默认五分钟到期撤回整个尾段，设置修改只作用于之后", async () => {
		await service.setTimeTrackingEnabled(true);
		service.recordTimeActivity("笔记/甲.md");
		advance(360);
		expect(service.getDailyTimeStats()).toEqual([]);
		expect(service.getTimeTrackingStatus()).toBe("时长：空闲暂停");
		await service.setIdleTimeoutMinutes(1);
		service.recordTimeActivity("笔记/甲.md");
		advance(120);
		expect(service.getDailyTimeStats()).toEqual([]);
		await expect(service.setIdleTimeoutMinutes(0)).rejects.toThrow();
		expect(service.getSettings().idleTimeoutMinutes).toBe(1);
	});
	it("已保存的跨小时空闲尾段会撤回，重启不恢复且刷新覆盖删除的小时", async () => {
		await service.setTimeTrackingEnabled(true);
		service.recordTimeActivity("笔记/甲.md"); advance(15);
		service.recordTimeActivity("笔记/甲.md"); advance(285);
		await service.flush();
		expect(service.getDailyTimeStats()[0].seconds).toBe(300);
		const events: any[] = []; service.subscribe(event => events.push(event));
		advance(15);
		expect(service.getDailyTimeStats()[0].seconds).toBe(15);
		expect(service.getHourlyTimeStats().map(item => [item.hour, item.seconds])).toEqual([[9, 15]]);
		expect(events).toContainEqual({ type: "TIME_STATS", source: "TIME_ACTIVITY", filePath: "笔记/甲.md", timeKeys: [
			{ date: "2026-11-14", hour: 9 }, { date: "2026-11-14", hour: 10 },
		] });
		await service.flush();
		await service.unload();
		plugin.loadData.mockResolvedValue(plugin.saveData.mock.lastCall[0]);
		service = new EditActivityService(plugin, () => new Date(wall), () => mono);
		await service.initialize();
		expect(service.getDailyTimeStats()[0].seconds).toBe(15);
		service.recordTimeActivity("笔记/甲.md"); advance(30); service.pauseTimeActivity();
		expect(service.getDailyTimeStats()[0].seconds).toBe(45);
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
	it("持续操作期间心跳只结算，定时保存不被新输入推迟", async () => {
		await service.setTimeTrackingEnabled(true);
		service.recordTimeActivity("笔记/甲.md");
		for (let i = 0; i < 15; i++) {
			wall += 1000; mono += 1000;
			service.recordTimeActivity("笔记/甲.md");
		}
		service.checkpointTimeActivity();
		await vi.advanceTimersByTimeAsync(0);
		expect(service.getDailyTimeStats()[0].seconds).toBe(15);
		await vi.advanceTimersByTimeAsync(60000);
		const records = [...plugin.files.values()]
			.filter(content => content.includes('"kind": "statistics"'))
			.map(content => JSON.parse(content));
		expect(Object.keys(records.at(-1).data.timeActivity.buckets).length).toBeGreaterThan(0);
	});
});
