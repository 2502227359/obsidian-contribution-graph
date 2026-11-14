import { describe, expect, it } from "vitest";
import { getHourlyCellKey, groupHourlyData } from "../src/render/hourlyData";
import { resolveHourNavigation } from "../src/render/hourlyNavigation";

describe("时段热力图数据", () => {
	it("按日期分组并保持小时顺序", () => {
		const cells = [
			{ date: "2026-11-14", hour: 22 },
			{ date: "2026-11-13", hour: 9 },
			{ date: "2026-11-14", hour: 3 },
		] as any;

		const columns = groupHourlyData(cells);

		expect(columns.map((column) => column.date)).toEqual([
			"2026-11-13",
			"2026-11-14",
		]);
		expect(columns[1].cells.map((cell: any) => cell.hour)).toEqual([3, 22]);
	});

	it("生成稳定的日期小时键", () => {
		expect(getHourlyCellKey({ date: "2026-01-02", hour: 3 } as any)).toBe(
			"2026-01-02T3"
		);
	});
});

describe("单日柱图键盘导航", () => {
	it("按小时上下移动并跳过未来或缺失小时", () => {
		expect(resolveHourNavigation(8, "ArrowDown", [8, 9, 11])).toBe(9);
		expect(resolveHourNavigation(9, "ArrowDown", [8, 9, 11])).toBe(11);
		expect(resolveHourNavigation(11, "ArrowDown", [8, 9, 11])).toBe(11);
		expect(resolveHourNavigation(8, "ArrowUp", [8, 9, 11])).toBe(8);
	});

	it("Home/End 定位到可用小时，未知按键不改变焦点", () => {
		expect(resolveHourNavigation(9, "Home", [3, 9, 22])).toBe(3);
		expect(resolveHourNavigation(9, "End", [3, 9, 22])).toBe(22);
		expect(resolveHourNavigation(9, "PageDown", [3, 9, 22])).toBeUndefined();
	});
});
