import { describe, expect, it } from "vitest";
import { axisDuration, detailDuration, timeAxisOptions } from "../src/view/weeklyReviewChartStyle";

describe("周回顾图表时长展示", () => {
	it("按完整的小时、分钟和秒数显示坐标轴刻度", () => {
		expect(axisDuration(0)).toBe("0");
		expect(axisDuration(30)).toBe("30秒");
		expect(axisDuration(1800)).toBe("30分");
		expect(axisDuration(3600)).toBe("1小时");
		expect(axisDuration(5400)).toBe("1小时30分");
	});

	it("正文明细保留跨小时的分钟", () => {
		expect(detailDuration(3660)).toBe("1小时 1分钟");
	});

	it("为零值和小秒数生成不截断的标尺", () => {
		for (const seconds of [0, 0.5, 8]) {
			const option = timeAxisOptions(seconds);
			expect(option.min).toBe(0);
			expect(option.max).toBeGreaterThanOrEqual(seconds);
			expect(option.interval).toBeGreaterThan(0);
		}
		expect(timeAxisOptions(0.5).axisLabel.formatter(0.5)).not.toBe("0");
	});

	it("跨天时仍使用整齐的刻度并覆盖最大值", () => {
		const option = timeAxisOptions(3 * 24 * 60 * 60 + 3600);
		expect(option.max).toBeGreaterThanOrEqual(3 * 24 * 60 * 60 + 3600);
		expect(option.interval).toBeGreaterThan(0);
		expect(option.axisLabel.formatter(option.interval)).not.toMatch(/\.\d/);
	});
});
