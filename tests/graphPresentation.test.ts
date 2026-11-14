import { describe, expect, it } from "vitest";
import { getDocumentPresentation, getGraphContext, getGraphMetric } from "../src/render/graphPresentation";

describe("图表的信息层级与详情展示", () => {
	it("时长卡片按真实秒数汇总，并明确标注范围累计", () => {
		const cells: any[] = [{ date: "2026-11-13", value: 60, timeStats: { seconds: 3600 } },
			{ date: "2026-11-14", value: 25, timeStats: { seconds: 1500 } }];
		const metric = getGraphMetric({ timeTracking: true } as any, cells);
		expect(metric.text).toBe("1 小时 25 分钟");
		expect(metric.parts).toEqual([{ value: "1", unit: "小时" }, { value: "25", unit: "分钟" }]);
		expect(metric.caption).toBe("所选范围累计时长");
		expect(cells[0].timeStats.seconds).toBe(3600);
	});
	it("字数卡片使用所选指标与单位，保持原有数据含义", () => {
		expect(getGraphMetric({ valueUnit: "字" } as any, [{ value: 12 }, { value: 8 }] as any)).toMatchObject({
			text: "20 字", parts: [{ value: "20", unit: "字" }], caption: "所选范围累计",
		});
	});
	it("零和不足一分钟分别显示，不将极短活动取整成零", () => {
		expect(getGraphMetric({ timeTracking: true } as any, []).text).toBe("0 分钟");
		expect(getGraphMetric({ timeTracking: true } as any, [{ timeStats: { seconds: 0.5 } }] as any).text).toBe("少于 1 分钟");
	});
	it("副标题显示范围和日期，排除占位格", () => {
		expect(getGraphContext({ activityFolders: ["临床医学"] } as any,
			[{ date: "$HOLE$" }, { date: "2026-11-01" }, { date: "2026-11-14" }] as any))
			.toBe("临床医学 · 2026-11-01 — 2026-11-14");
	});
	it("笔记详情把名称、目录与时长分开，保留文件缺失提示", () => {
		expect(getDocumentPresentation({ label: "临床医学/内科学/心律失常.md", value: 42,
			description: "42 分钟 · 文件已不存在" }, true)).toEqual({
			name: "心律失常", path: "临床医学/内科学", detail: "文件已不存在", value: "42 分钟",
		});
	});
	it("普通条目保留原文字与说明，不误当成笔记路径", () => {
		expect(getDocumentPresentation({ label: "复习 A/B 两种方法", value: 3, description: "原说明" }, false, "次"))
			.toEqual({ name: "复习 A/B 两种方法", path: undefined, detail: "原说明", value: "3 次" });
	});
});
