import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryTimeGraph } from "../src/time/timeGraphData";
import { YamlGraphConfig } from "../src/processor/types";
import { generateByFixedDate } from "../src/render/matrixDataGenerator";

describe("两种时长热力图的数据接线", () => {
	beforeEach(() => {
		vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 14, 12));
		Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: () => "zh" } } });
	});
	afterEach(() => { vi.useRealTimers(); });
	const createInputs = () => {
		const day = { date: "2026-11-14", seconds: 90, documents: [{ path: "笔记/甲.md", seconds: 90 }], trackingState: "PARTIAL", future: false };
		const service: any = { getSettings: () => ({ trackedFolders: [] }),
			getDailyTimeStats: () => [day], getHourlyTimeStats: () => [{ ...day, hour: 10 }],
			getTimeCellInfo: (start: number) => ({ trackingState: start < new Date(2026, 10, 14, 10).getTime() ? "UNTRACKED" : "TRACKED", future: start > Date.now() }) };
		const app: any = { vault: { getAbstractFileByPath: () => null }, workspace: { openLinkText: vi.fn() } };
		const config = Object.assign(new YamlGraphConfig(), { dateRangeType: "FIXED_DATE_RANGE", dateRangeValue: undefined,
			fromDate: "2026-11-14", toDate: "2026-11-14", dataSource: { type: "TIME_ACTIVITY" } });
		return { service, app, config };
	};
	it("每日图使用分钟值并保留秒数、覆盖状态和删除笔记明细", () => {
		const { service, app, config } = createInputs();
		const { data } = queryTimeGraph(config, service, app);
		expect(data[0].value).toBe(1.5);
		expect(data[0].items?.[0].description).toContain("文件已不存在");
		const cells = generateByFixedDate(new Date(2026, 10, 14), new Date(2026, 10, 14), data);
		expect(cells[0].timeStats?.seconds).toBe(90);
		expect(cells[0].trackingState).toBe("PARTIAL");
	});
	it("时段图填满二十四小时，区分启用前与未来，总量等于每日图", () => {
		const { service, app, config } = createInputs();
		const daily = queryTimeGraph(config, service, app);
		config.graphType = "hourly";
		const hourly = queryTimeGraph(config, service, app).hourlyData;
		expect(hourly).toHaveLength(24);
		expect(hourly[9].trackingState).toBe("UNTRACKED");
		expect(hourly[13].future).toBe(true);
		expect(hourly.reduce((sum, row) => sum + row.value, 0)).toBe(daily.data[0].value);
	});
	it("禁止把时段图连接到字数或文件数量数据源", () => {
		const { config } = createInputs();
		config.graphType = "hourly"; config.dataSource.type = "PAGE";
		expect(() => YamlGraphConfig.validate(config)).toThrow();
	});
	it("限制时段图的格子数量，避免过大范围阻塞编辑器", () => {
		const { service, app, config } = createInputs();
		config.graphType = "hourly"; config.fromDate = "2025-01-01";
		expect(() => queryTimeGraph(config, service, app)).toThrow("最多显示 366 天");
	});
});
