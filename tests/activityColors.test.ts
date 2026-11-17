import { describe, expect, it } from "vitest";
import { color } from "echarts/core";
import { activityColor, activityPalette, mutedActivityColor } from "../src/view/activityColors";

describe("活动颜色", () => {
	it("回顾与时间轴共用低饱和度配色，文字对比度仍不低于四点五", () => {
		for (const dark of [false,true]) for (const path of ["学科/笔记.md", "目录/另一篇.md", "activity://yolo-chat"]) {
			const base = activityColor(path,dark), timeline = mutedActivityColor(path,dark);
			const chroma = (fill:string) => {const rgb=color.parse(fill).slice(0,3);return Math.max(...rgb)-Math.min(...rgb);};
			expect(chroma(timeline.fill)).toBeLessThan(chroma(base.fill));
			expect(contrastRatio(timeline.fill,timeline.text)).toBeGreaterThanOrEqual(4.5);
		}
	});
	it("轨道色标取自真实笔记片段，不用上层目录重新取色", () => {
		const paths=["临床医学/临床医学/妇产科学/甲.md","临床医学/临床医学/内科学/乙.md"];
		for(const dark of [false,true]){
			const expected=paths.map(path=>mutedActivityColor(path,dark).fill).sort();
			expect(activityPalette([...paths,paths[0]],dark)).toEqual(expected);
			expect(activityPalette([...paths].reverse(),dark)).toEqual(expected);
			expect(activityPalette([],dark)).toEqual([]);
		}
	});
	it("完整路径重复计算时保持稳定", () => {
		const first = activityColor("临床医学/临床医学/妇产科学/甲.md", false);
		const second = activityColor("临床医学/临床医学/妇产科学/甲.md", false);
		expect(first).toEqual(second);
	});

	it("真实层级下不同学科不会共用主色", () => {
		const obstetrics = activityColor("临床医学/临床医学/妇产科学/甲.md", false);
		const internal = activityColor("临床医学/临床医学/内科学/乙.md", false);
		expect(obstetrics.fill).not.toBe(internal.fill);
		expect(obstetrics.stroke).not.toBe(internal.stroke);
	});

	it("同一目录及直属笔记保持同色系且笔记有变体", () => {
		const directory = activityColor("临床医学/临床医学/妇产科学", false);
		const note = activityColor("临床医学/临床医学/妇产科学/甲.md", false);
		expect(directory.stroke).toBe(note.stroke);
		expect(directory.fill).not.toBe(note.fill);
	});

	it("同名笔记位于不同目录时颜色不同", () => {
		const first = activityColor("临床医学/临床医学/妇产科学/甲.md", false);
		const second = activityColor("临床医学/临床医学/内科学/甲.md", false);
		expect(first.fill).not.toBe(second.fill);
		expect(first.stroke).not.toBe(second.stroke);
	});

	it("YOLO 使用独立且随主题变化的可读颜色", () => {
		const note = activityColor("临床医学/临床医学/妇产科学/甲.md", false);
		const light = activityColor("activity://yolo-chat", false);
		const dark = activityColor("activity://yolo-chat", true);
		expect(light.fill).not.toBe(note.fill);
		expect(light).not.toEqual(dark);
		expect(light.text).toBeTruthy();
		expect(dark.text).toBeTruthy();
		expect(light.fill).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
	});

	it("深浅主题的色块文字保持可读对比度", () => {
		for (const dark of [false, true]) {
			const samples = [
				activityColor("临床医学/临床医学/内科学", dark),
				activityColor("临床医学/临床医学/内科学/乙.md", dark),
				activityColor("activity://yolo-chat", dark),
				activityColor("学科/目录12/笔记.md", dark),
			];
			for (const sample of samples) expect(contrastRatio(sample.fill, sample.text)).toBeGreaterThanOrEqual(4.5);
		}
	});

	it("规范路径分隔符且不依赖数据顺序", () => {
		expect(activityColor("临床医学\\临床医学\\妇产科学\\甲.md", false)).toEqual(activityColor("临床医学/临床医学/妇产科学/甲.md", false));
	});
});

function contrastRatio(background: string, foreground: string): number {
	const first = luminance(color.parse(background)), second = luminance(color.parse(foreground));
	return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
}

function luminance(rgba: number[]): number {
	const channels = rgba.slice(0, 3).map(value => value / 255).map(value => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
	return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
}
