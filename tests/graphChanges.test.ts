import { describe, expect, it } from "vitest";
import { getGraphChange, GraphChangeConfig } from "../src/processor/graphChanges";

const config = (overrides: Partial<GraphChangeConfig> = {}): GraphChangeConfig => ({
	graphType: "default",
	dateRangeType: "FIXED_DATE_RANGE",
	fromDate: "2026-01-01",
	toDate: "2026-01-31",
	dataSource: { type: "TIME_ACTIVITY", folders: ["临床医学"] },
	...overrides,
});

describe("图表统计变化影响范围", () => {
	it("保存状态通知不触发任何统计图查询或刷新", () => {
		expect(getGraphChange({type: "SAVE_STATE"}, config())).toBeUndefined();
		expect(getGraphChange({type: "SAVE_STATE"}, config({dataSource: {type: "EDIT_ACTIVITY"}}))).toBeUndefined();
	});
	it("只返回时长事件实际影响的日期，并排除无关文件夹和范围外日期", () => {
		expect(getGraphChange({ type: "TIME_STATS", filePath: "临床医学/甲.md", timeKeys: [
			{date: "2026-01-03", hour: 9},
			{date: "2026-01-03", hour: 10},
			{date: "2026-02-01", hour: 9},
		]}, config())).toEqual({ all: false, dates: ["2026-01-03"] });
		expect(getGraphChange({ type: "TIME_STATS", filePath: "英语/乙.md", timeKeys: [{date: "2026-01-03", hour: 9}] }, config())).toBeUndefined();
	});

	it("字数统计按文件夹和日期范围过滤", () => {
		expect(getGraphChange({ type: "STATS", date: "2026-01-08", filePath: "临床医学/甲.md" }, config({ dataSource: { type: "EDIT_ACTIVITY", folders: ["临床医学"] } }))).toEqual({ all: false, dates: ["2026-01-08"] });
		expect(getGraphChange({ type: "STATS", date: "2026-01-08", filePath: "英语/乙.md" }, config({ dataSource: { type: "EDIT_ACTIVITY", folders: ["临床医学"] } }))).toBeUndefined();
		expect(getGraphChange({ type: "STATS", date: "2026-02-08", filePath: "临床医学/甲.md" }, config({ dataSource: { type: "EDIT_ACTIVITY", folders: ["临床医学"] } }))).toBeUndefined();
	});

	it("单日和一周时长图只返回当前可见日期", () => {
		const hourly = config({ graphType: "hourly" });
		expect(getGraphChange({ type: "TIME_STATS", timeKeys: [
			{date: "2026-01-01", hour: 9}, {date: "2026-01-04", hour: 9},
		]}, hourly, {view: "day", date: "2026-01-04"})).toEqual({ all: false, dates: ["2026-01-04"] });
		expect(getGraphChange({ type: "TIME_STATS", timeKeys: [
			{date: "2025-12-29", hour: 9}, {date: "2026-01-01", hour: 9}, {date: "2026-01-04", hour: 9},
		]}, hourly, {view: "week", date: "2026-01-04"})).toEqual({ all: false, dates: ["2026-01-01", "2026-01-04"] });
	});

	it("无定位事件要求完整失效，其他数据源事件不触发", () => {
		expect(getGraphChange({ type: "TIME_STATS" }, config())).toEqual({ all: true, dates: [] });
		expect(getGraphChange({ type: "IMPORT" }, config())).toEqual({ all: true, dates: [] });
		expect(getGraphChange({ type: "STATS", date: "2026-01-03" }, config())).toBeUndefined();
		expect(getGraphChange({ type: "TIME_STATS", timeKeys: [{date: "2026-01-03", hour: 9}] }, config({ dataSource: { type: "EDIT_ACTIVITY" } }))).toBeUndefined();
	});

	it("设置和采集范围事件按来源精确过滤", () => {
		const edit = config({ dataSource: { type: "EDIT_ACTIVITY" } });
		expect(getGraphChange({ type: "SETTINGS", source: "EDIT_ACTIVITY" }, config())).toBeUndefined();
		expect(getGraphChange({ type: "SETTINGS", source: "EDIT_ACTIVITY" }, edit)).toEqual({ all: true, dates: [] });
		expect(getGraphChange({ type: "COVERAGE", source: "EDIT_ACTIVITY" }, config())).toBeUndefined();
		expect(getGraphChange({ type: "COVERAGE" }, config())).toEqual({ all: true, dates: [] });
	});
});
