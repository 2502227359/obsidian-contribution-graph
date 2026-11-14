import { describe, expect, it } from "vitest";
import {
	getHourlySeconds,
	getHourlyState,
	getHourlyWeek,
	groupHourlyData,
	selectHourlyDate,
} from "../src/render/hourlyData";

const cell = (date: string, hour: number, extra: Record<string, unknown> = {}) => ({
	date,
	hour,
	value: 0,
	...extra,
} as any);

describe("小时学习时长展示数据", () => {
	it("按日期和小时排序，并去掉重复的日期小时桶", () => {
		const columns = groupHourlyData([
			cell("2026-11-14", 22, { value: 1 }),
			cell("2026-11-13", 9),
			cell("2026-11-14", 3),
			cell("2026-11-14", 3, { value: 8 }),
		]);
		expect(columns.map((item) => item.date)).toEqual(["2026-11-13", "2026-11-14"]);
		expect(columns[1].cells.map((item) => [item.hour, item.value])).toEqual([[3, 8], [22, 1]]);
	});

	it("默认日期优先今天，否则选择范围内不晚于今天的最新日期", () => {
		const columns = groupHourlyData([
			cell("2026-11-12", 1),
			cell("2026-11-14", 1),
			cell("2026-11-16", 1),
		]);
		expect(selectHourlyDate(columns, undefined, "2026-11-15")).toBe("2026-11-14");
		expect(selectHourlyDate(columns, "2026-11-12", "2026-11-15")).toBe("2026-11-12");
		expect(selectHourlyDate(columns, "2026-12-01", "2026-11-15")).toBe("2026-11-14");
	});

	it("周视图按真实日历日期取最近七天，不跨缺口补借其他日期", () => {
		const columns = groupHourlyData([
			cell("2026-11-08", 1), cell("2026-11-09", 1), cell("2026-11-11", 1),
			cell("2026-11-13", 1), cell("2026-11-14", 1), cell("2026-11-15", 1),
			cell("2026-11-16", 1),
		]);
		expect(getHourlyWeek(columns, "2026-11-14").map((item) => item.date)).toEqual([
			"2026-11-08", "2026-11-09", "2026-11-11", "2026-11-13", "2026-11-14",
		]);
	});

	it("优先使用原始秒数，且状态优先级为未来、未采集、部分采集、已采集", () => {
		expect(getHourlySeconds(cell("2026-11-14", 9, { value: 30, timeStats: { seconds: 12.5 } }))).toBe(12.5);
		expect(getHourlySeconds(cell("2026-11-14", 9, { value: -3 }))).toBe(0);
		expect(getHourlyState(cell("2026-11-14", 9, { future: true, trackingState: "TRACKED" }))).toBe("future");
		expect(getHourlyState(cell("2026-11-14", 9, { trackingState: "UNTRACKED" }))).toBe("untracked");
		expect(getHourlyState(cell("2026-11-14", 9, { trackingState: "PARTIAL" }))).toBe("partial");
		expect(getHourlyState(cell("2026-11-14", 9, { trackingState: "TRACKED" }))).toBe("tracked");
	});
});
