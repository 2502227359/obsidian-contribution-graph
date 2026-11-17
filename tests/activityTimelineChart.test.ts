import { beforeEach, describe, expect, it, vi } from "vitest";
import * as echarts from "echarts/core";
import { ActivityTimelineChart } from "../src/view/activityTimelineChart";
import type { ActivityTimelineDay } from "../src/time/activityTimelineTypes";

vi.mock("echarts/core", async () => ({...await vi.importActual<any>("echarts/core"), init: vi.fn()}));

const chart = {on: vi.fn(), setOption: vi.fn()};
const day = {blocks: [{id: "a", path: "学科/笔记.md", startMinute: 10, endMinute: 50, seconds: 2400}]} as ActivityTimelineDay;

function option(highlightedPath?: string) {
	const win = {matchMedia: () => ({matches: true}), getComputedStyle: () => ({fontFamily: "霞鹜文楷", getPropertyValue: () => ""})};
	const owner = {defaultView: win, documentElement: {classList: {contains: () => false}}};
	const host = {ownerDocument: owner, clientWidth: 900, setAttribute: vi.fn()} as unknown as HTMLElement;
	new ActivityTimelineChart(host, {id: "heading"} as HTMLElement, {onSelect: vi.fn(), onWindowChange: vi.fn()})
		.render(day, [{id: "row", label: "学科", groupId: "g", depth: 1, blockIds: ["a"]}], {window: [0, 100], highlightedPath});
	return chart.setOption.mock.calls[0][0];
}

function render(start: number, end: number) {
	return option().series[0].renderItem({coordSys: {x: 0, y: 0, width: 200, height: 60}}, {
		value: (index: number) => [0, start, end, "完整笔记名称", "霞鹜文楷", "#123456"][index],
		coord: ([x]: number[]) => [x, 30], size: () => [0, 40], style: () => ({fill: "#aabbcc"}),
	});
}

describe("时间轴色块显示", () => {
	beforeEach(() => { vi.clearAllMocks(); vi.mocked(echarts.init).mockReturnValue(chart as any); });
	it("短片段保留真实宽度，不放大或泄漏到视口内", () => {
		expect(render(10, 10.4).shape.width).toBeCloseTo(.4);
		expect(render(-1, -.5)).toBeUndefined();
	});
	it("色块统一小圆角，裁剪后仍保持真实边界", () => {
		const block = render(-20, 80).children[0];
		expect(block.shape).toMatchObject({x: 0, width: 80, height: 24});
		expect(block.shape.r).toEqual([0, 4, 4, 0]);
	});
	it("短片段不塞文字，长片段文字不截获片段点击", () => {
		expect(render(10, 30).type).toBe("rect");
		const text = render(10, 150).children[1];
		expect(text.silent).toBe(true);
		expect(text.style).toMatchObject({text: "完整笔记名称", fontFamily: "霞鹜文楷", overflow: "truncate"});
	});
	it("选中同篇后其他色块仍保持可读，不大片变灰", () => {
		const series = option("其他笔记.md").series[0];
		expect(series.data[0].itemStyle.opacity).toBeGreaterThanOrEqual(.7);
		expect(series.emphasis.itemStyle.borderWidth).toBeGreaterThan(1);
	});
});
