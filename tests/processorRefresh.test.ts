import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeBlockProcessor } from "../src/processor/codeBlockProcessor";
import { Renders } from "src/render/renders";
import type { EditActivityChangeEvent } from "../src/activity/EditActivityService";

vi.mock("obsidian-dataview", () => ({getAPI: () => undefined}));
vi.mock("../src/view/ActivityTimelineModal", () => ({createActivityTimelineOptions: () => ({})}));
vi.mock("obsidian", () => ({
	MarkdownRenderChild: class { constructor(public containerEl: unknown) {} },
	TFile: class {}, TFolder: class {}, parseYaml: JSON.parse,
}));
vi.mock("src/render/renders", () => ({Renders: {render: vi.fn(), update: vi.fn(() => true), renderErrorTips: vi.fn(), dispose: vi.fn()}}));

describe("统计代码块的局部刷新接线", () => {
	const children: {onload?: () => void; onunload?: () => void}[] = [];
	beforeEach(() => {
		vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 15, 12)); vi.clearAllMocks();
		Object.defineProperty(globalThis, "window", {configurable: true, value: {localStorage: {getItem: () => "zh"}}});
	});
	afterEach(() => {children.splice(0).forEach(child => child.onunload?.()); vi.useRealTimers();});
	it("时间轴由代码块宿主卸载，注册一个生命周期且不重复订阅", async () => {
		const service:any={getSettings:()=>({trackedFolders:[]}),subscribe:vi.fn()};
		const el:any={querySelector:()=>null,ownerDocument:{}};
		const ctx:any={addChild(child:typeof children[number]){children.push(child);child.onload?.();}};
		const config={graphType:"timeline",dateRangeType:"LATEST_DAYS",dateRangeValue:30,dataSource:{type:"TIME_ACTIVITY"}};
		await new CodeBlockProcessor(service).renderFromCodeBlock(JSON.stringify(config),el,ctx,{} as any);
		expect(vi.mocked(Renders.render).mock.calls[0][1].activityTimeline).toMatchObject({hostOwnsLifecycle:true});
		expect(children).toHaveLength(1);
		expect(service.subscribe).not.toHaveBeenCalled();
		children.splice(0).forEach(child=>child.onunload?.());
		expect(Renders.dispose).toHaveBeenCalledWith(el);
	});

	it("无关时长不查询，相关时长只查询变化日并接入更新入口", async () => {
		let notify: (event: EditActivityChangeEvent) => void = () => undefined;
		const service: any = {
			getSettings: () => ({trackedFolders: []}),
			getDailyTimeStats: vi.fn(() => [{date: "2026-11-15", seconds: 60, documents: [], trackingState: "TRACKED", future: false}]),
			getTimeCellInfo: () => ({trackingState: "TRACKED", future: false}),
			subscribe: (listener: typeof notify) => {notify = listener; return () => {notify = () => undefined;};},
		};
		const el: any = {querySelector: () => null, isConnected: true, getBoundingClientRect: () => ({width: 400, height: 300}),
			ownerDocument: {visibilityState: "visible", addEventListener() {}, removeEventListener() {}}};
		const ctx: any = {addChild(child: typeof children[number]) {children.push(child); child.onload?.();}};
		const app: any = {vault: {getAbstractFileByPath: () => ({children: []})}};
		const config = {graphType: "default", dateRangeType: "FIXED_DATE_RANGE", fromDate: "2026-11-14", toDate: "2026-11-15", dataSource: {type: "TIME_ACTIVITY", folders: ["临床医学"]}};
		await new CodeBlockProcessor(service).renderFromCodeBlock(JSON.stringify(config), el, ctx, app);
		expect(Renders.render).toHaveBeenCalledTimes(1);
		service.getDailyTimeStats.mockClear();
		notify({type: "TIME_STATS", filePath: "其他/笔记.md", timeKeys: [{date: "2026-11-15", hour: 10}]});
		await vi.advanceTimersByTimeAsync(200);
		expect(service.getDailyTimeStats).not.toHaveBeenCalled();
		expect(Renders.update).not.toHaveBeenCalled();
		notify({type: "TIME_STATS", filePath: "临床医学/笔记.md", timeKeys: [{date: "2026-11-15", hour: 10}]});
		await vi.advanceTimersByTimeAsync(150);
		expect(service.getDailyTimeStats.mock.calls).toEqual([[{fromDate: "2026-11-15", toDate: "2026-11-15", folders: ["临床医学"]}]]);
		expect(Renders.update).toHaveBeenCalledTimes(1);
		expect(Renders.render).toHaveBeenCalledTimes(1);
	});
	it("历史单日不查询今天，切回今天时重查可见数据而不是使用旧缓存", async () => {
		let notify: (event: EditActivityChangeEvent) => void = () => undefined;
		let seconds = 90;
		const service: any = {
			getSettings: () => ({trackedFolders: []}),
			getHourlyTimeStats: vi.fn(() => [{date: "2026-11-15", hour: 10, seconds, documents: [], trackingState: "TRACKED", future: false}]),
			getTimeCellInfo: () => ({trackingState: "TRACKED", future: false}),
			subscribe: (listener: typeof notify) => {notify = listener; return () => {notify = () => undefined;};},
		};
		let chart: {dataset: {selectedDate: string; view: string}} | undefined;
		const el: any = {querySelector: () => chart, isConnected: true, getBoundingClientRect: () => ({width: 400, height: 300}),
			ownerDocument: {visibilityState: "visible", addEventListener() {}, removeEventListener() {}}};
		const ctx: any = {addChild(child: typeof children[number]) {children.push(child); child.onload?.();}};
		const config = {graphType: "hourly", dateRangeType: "FIXED_DATE_RANGE", fromDate: "2026-11-14", toDate: "2026-11-15", dataSource: {type: "TIME_ACTIVITY"}};
		await new CodeBlockProcessor(service).renderFromCodeBlock(JSON.stringify(config), el, ctx, {vault: {getAbstractFileByPath: () => null}} as any);
		const firstConfig = vi.mocked(Renders.render).mock.calls[0][1];
		chart = {dataset: {selectedDate: "2026-11-15", view: "day"}};
		firstConfig.onHourlyViewChange!({view: "day", date: "2026-11-14"});
		expect(vi.mocked(Renders.update).mock.calls.at(-1)![1].hourlyViewState?.date).toBe("2026-11-14");
		chart.dataset.selectedDate = "2026-11-14";
		service.getHourlyTimeStats.mockClear(); seconds = 120;
		notify({type: "TIME_STATS", filePath: "笔记.md", timeKeys: [{date: "2026-11-15", hour: 10}]});
		await vi.advanceTimersByTimeAsync(200);
		expect(service.getHourlyTimeStats).not.toHaveBeenCalled();
		vi.mocked(Renders.update).mock.calls.at(-1)![1].onHourlyViewChange!({view: "day", date: "2026-11-15"});
		expect(service.getHourlyTimeStats.mock.calls).toEqual([[{fromDate: "2026-11-15", toDate: "2026-11-15", folders: []}]]);
		const latest = vi.mocked(Renders.update).mock.calls.at(-1)![1];
		expect(latest.hourlyData?.find(cell => cell.date === "2026-11-15" && cell.hour === 10)?.timeStats?.seconds).toBe(120);
		service.getHourlyTimeStats.mockClear(); seconds = 30;
		notify({type: "IMPORT"});
		await vi.advanceTimersByTimeAsync(150);
		expect(service.getHourlyTimeStats.mock.calls).toEqual([[{fromDate: "2026-11-14", toDate: "2026-11-15", folders: []}]]);
		expect(vi.mocked(Renders.update).mock.calls.at(-1)![1].hourlyData?.find(cell => cell.hour === 10 && cell.date === "2026-11-15")?.timeStats?.seconds).toBe(30);
	});
	it("字数事件只重算变化日并复用历史数据，卸载后停止查询", async () => {
		let notify: (event: EditActivityChangeEvent) => void = () => undefined;
		let value = 9;
		const service: any = {
			getSettings: () => ({trackedFolders: []}), getTrackingPeriods: () => [], getCollectionScopePeriods: () => [],
			getDailyEditStats: vi.fn((q: {fromDate: string; toDate: string}) => [
				{date: "2026-11-14", addedChars: 7, deletedChars: 0, changedChars: 7, documents: []},
				{date: "2026-11-15", addedChars: value, deletedChars: 0, changedChars: value, documents: []},
			].filter(row => row.date >= q.fromDate && row.date <= q.toDate)),
			subscribe: (listener: typeof notify) => {notify = listener; return () => {notify = () => undefined;};},
		};
		const el: any = {querySelector: () => null, isConnected: true, getBoundingClientRect: () => ({width: 400, height: 300}),
			ownerDocument: {visibilityState: "visible", addEventListener() {}, removeEventListener() {}}};
		const ctx: any = {addChild(child: typeof children[number]) {children.push(child); child.onload?.();}};
		const config = {graphType: "default", dateRangeType: "FIXED_DATE_RANGE", fromDate: "2026-11-14", toDate: "2026-11-15", dataSource: {type: "EDIT_ACTIVITY"}};
		await new CodeBlockProcessor(service).renderFromCodeBlock(JSON.stringify(config), el, ctx, {} as any);
		const previous = vi.mocked(Renders.render).mock.calls[0][1].data[0];
		service.getDailyEditStats.mockClear(); value = 12;
		notify({type: "STATS", date: "2026-11-15", filePath: "笔记.md"});
		await vi.advanceTimersByTimeAsync(150);
		expect(service.getDailyEditStats.mock.calls).toEqual([[{fromDate: "2026-11-15", toDate: "2026-11-15", folders: []}]]);
		const latest = vi.mocked(Renders.update).mock.calls.at(-1)![1].data;
		expect(latest.map(row => row.value)).toEqual([7, 12]);
		expect(latest[0]).toBe(previous);
		children.splice(0).forEach(child => child.onunload?.());
		service.getDailyEditStats.mockClear();
		notify({type: "STATS", date: "2026-11-15"});
		await vi.advanceTimersByTimeAsync(200);
		expect(service.getDailyEditStats).not.toHaveBeenCalled();
	});
});
