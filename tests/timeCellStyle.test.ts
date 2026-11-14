import { describe, expect, it } from "vitest";
import { GitStyleTrackGraphRender } from "../src/render/gitStyleTrackGraphRender";
import { TIME_HOURLY_RULES } from "../src/constants";

describe("时长格子的空值样式", () => {
	it("已记录但为零的时长使用空格颜色，不匹配最低绿色档", () => {
		const classes: string[] = [];
		const cell: any = { style: {}, classList: { add: (name: string) => classes.push(name) }, addClass: (name: string) => classes.push(name) };
		new GitStyleTrackGraphRender().applyCellStyleRule(cell,
			{ date: "2026-01-01", value: 0, trackingState: "TRACKED" } as any,
			TIME_HOURLY_RULES, { timeTracking: true } as any);
		expect(cell.style.backgroundColor).toBeUndefined();
		expect(classes).toContain("empty");
	});
});
