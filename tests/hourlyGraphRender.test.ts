import { describe, expect, it } from "vitest";
import {
	getHourlyCellKey,
	groupHourlyData,
} from "../src/render/hourlyGraphRender";
import {
	chooseInitialHourlyPosition,
	resolveHourlyNavigation,
} from "../src/render/hourlyNavigation";

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

describe("时段热力图键盘导航", () => {
	it("按小时上下、按日期左右移动", () => {
		expect(resolveHourlyNavigation({ day: 1, hour: 8 }, 3, "ArrowUp")).toEqual({
			day: 1,
			hour: 7,
		});
		expect(resolveHourlyNavigation({ day: 1, hour: 8 }, 3, "ArrowDown")).toEqual({
			day: 1,
			hour: 9,
		});
		expect(resolveHourlyNavigation({ day: 1, hour: 8 }, 3, "ArrowLeft")).toEqual({
			day: 0,
			hour: 8,
		});
		expect(resolveHourlyNavigation({ day: 1, hour: 8 }, 3, "ArrowRight")).toEqual({
			day: 2,
			hour: 8,
		});
	});

	it("限制日期和小时边界", () => {
		expect(resolveHourlyNavigation({ day: 0, hour: 0 }, 3, "ArrowLeft")).toEqual({
			day: 0,
			hour: 0,
		});
		expect(resolveHourlyNavigation({ day: 2, hour: 23 }, 3, "ArrowRight")).toEqual({
			day: 2,
			hour: 23,
		});
	});

	it("跳过未来小时并保留当前可用焦点", () => {
		const isAvailable = ({ hour }: { hour: number }) => hour < 23;

		expect(
			resolveHourlyNavigation({ day: 0, hour: 22 }, 1, "ArrowDown", isAvailable)
		).toBeUndefined();
		expect(
			resolveHourlyNavigation({ day: 0, hour: 22 }, 1, "ArrowUp", isAvailable)
		).toEqual({ day: 0, hour: 21 });
	});

	it("初始焦点选择最后一个可用小时而不是未来小时", () => {
		expect(
			chooseInitialHourlyPosition([
				{ day: 0, hour: 22, available: true },
				{ day: 0, hour: 23, available: false },
			])
		).toEqual({ day: 0, hour: 22 });
	});
});
