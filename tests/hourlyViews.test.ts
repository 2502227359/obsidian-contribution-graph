import { describe, expect, it } from "vitest";
import { getHourlyCaption, getHourlyViewCells } from "../src/render/hourlyView";
import { resolveHourNavigation } from "../src/render/hourlyNavigation";

describe("单日与一周时段展示", () => {
	it("向左移动到紧邻的可用小时，跳过不可用小时", () => {
		expect(resolveHourNavigation(22, "ArrowLeft", [0, 8, 10, 20, 22])).toBe(20);
	});
	it("单日和一周按可见数据汇总，保留原始小时状态", () => {
		const days: any[] = [
			{ date: "2026-11-09", cells: [{ date: "2026-11-09", hour: 9, timeStats: {seconds: 60} }] },
			{ date: "2026-11-15", cells: [{ date: "2026-11-15", hour: 8, trackingState: "PARTIAL", timeStats: {seconds: 90} }] },
		];
		expect(getHourlyViewCells(days, {view: "day", date: "2026-11-15"})).toEqual(days[1].cells);
		expect(getHourlyViewCells(days, {view: "week", date: "2026-11-15"})).toHaveLength(2);
		expect(getHourlyCaption({view: "day", date: "2026-11-15"})).toBe("当日活跃时长");
		expect(getHourlyCaption({view: "week", date: "2026-11-15"})).toBe("所选一周累计时长");
	});
});
