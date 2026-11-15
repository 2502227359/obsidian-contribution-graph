import { describe, expect, it } from "vitest";
import {
	getCalendarDates,
	resolveCalendarKey,
	shiftCalendarMonth,
} from "../src/view/datePicker/calendarDates";

describe("页面内日期选择器日期模型", () => {
	it("生成周一开始的42天月份网格", () => {
		const dates = getCalendarDates("2026-11");
		expect(dates).toHaveLength(42);
		expect(dates[0]).toBe("2026-10-26");
		expect(dates[41]).toBe("2026-12-06");
	});

	it("处理闰年和无效月份", () => {
		expect(getCalendarDates("2024-02")[0]).toBe("2024-01-29");
		expect(getCalendarDates("2024-02")[32]).toBe("2024-03-01");
		expect(getCalendarDates("2024-13")).toEqual([]);
	});

	it("按月移动时夹到目标月份最后一天", () => {
		expect(shiftCalendarMonth("2024-01-31", 1)).toBe("2024-02-29");
		expect(shiftCalendarMonth("2023-12-31", 1)).toBe("2024-01-31");
		expect(shiftCalendarMonth("2024-02-29", -12)).toBe("2023-02-28");
		expect(shiftCalendarMonth("bad-date", 1)).toBe("bad-date");
	});

	it("支持箭头、Home/End和按月键盘操作，并限制在可选日期", () => {
		const dates = getCalendarDates("2026-11");
		expect(resolveCalendarKey("2026-11-10", "ArrowRight", { dates })).toBe("2026-11-11");
		expect(resolveCalendarKey("2026-11-10", "ArrowUp", { dates })).toBe("2026-11-03");
		expect(resolveCalendarKey("2026-11-10", "Home", { dates })).toBe("2026-11-09");
		expect(resolveCalendarKey("2026-11-10", "End", { dates })).toBe("2026-11-15");
		expect(resolveCalendarKey("2026-11-10", "PageDown", { dates })).toBe("2026-12-06");
		expect(resolveCalendarKey("2026-11-10", "PageDown", { dates, shiftKey: true })).toBe("2026-12-06");
		expect(resolveCalendarKey("2026-11-30", "ArrowRight", { dates: ["2026-11-29", "2026-12-02"] })).toBe("2026-12-02");
		expect(resolveCalendarKey("2026-11-01", "ArrowLeft", { dates: ["2026-11-01", "2026-11-03"] })).toBe("2026-11-01");
		expect(resolveCalendarKey("2026-11-10", "Escape", { dates })).toBeUndefined();
		expect(resolveCalendarKey("2026-11-10", "ArrowRight", { dates: [] })).toBeUndefined();
	});
});
