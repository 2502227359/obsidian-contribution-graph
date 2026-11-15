import { describe, expect, it } from "vitest";
import { mergeGraphRows } from "../src/processor/activityGraphData";

describe("图表查询结果局部合并", () => {
	it("重算一个日期时清除旧结果，并保留其他日期的原对象", () => {
		const yesterday = {date: "2026-11-14", value: 12};
		const today = {date: "2026-11-15", value: 9};
		const result = mergeGraphRows([yesterday, today], [], {dates: ["2026-11-15"]});
		expect(result).toEqual([{date: "2026-11-14", value: 12}]);
		expect(result[0]).toBe(yesterday);
	});
	it("小时更新只替换指定小时，不覆盖同一天其他小时", () => {
		const first = {date: "2026-11-15", hour: 9, value: 10};
		const second = {date: "2026-11-15", hour: 10, value: 4};
		const result = mergeGraphRows([first, second], [{...second, value: 6}], {dates: ["2026-11-15"], timeKeys: [{date: "2026-11-15", hour: 10}]});
		expect(result.map(row => row.value)).toEqual([10, 6]);
		expect(result[0]).toBe(first);
	});
	it("全量替换不保留清空或导入前的旧数据", () => {
		expect(mergeGraphRows([{date: "2026-11-15", value: 9}], [])).toEqual([]);
	});
	it("日期对象与字符串都按本地自然日排序", () => {
		const result = mergeGraphRows([{date: new Date(2026, 10, 15), value: 1}], [{date: new Date(2026, 10, 16), value: 2}], {dates: ["2026-11-16"]});
		expect(result.map(row => row.value)).toEqual([1, 2]);
	});
});
