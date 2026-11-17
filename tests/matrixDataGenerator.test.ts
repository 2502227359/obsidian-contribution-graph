import { describe, expect, it } from "vitest";
import {
	generateByData,
	generateByFixedDate,
	generateByLatestDays,
	getDateTrackingState,
} from "../src/render/matrixDataGenerator";

describe("matrix date boundaries", () => {
	it("keeps date-only contribution strings on their local calendar day", () => {
		const result = generateByData([
			{ date: "2026-01-01", value: 3 },
			{ date: "2026-01-03", value: 5 },
		]);
		expect(result.map((item) => item.date)).toEqual([
			"2026-01-01",
			"2026-01-02",
			"2026-01-03",
		]);
		expect(result.map((item) => item.value)).toEqual([3, 0, 5]);
	});

	it("generates exactly the requested latest days", () => {
		expect(generateByLatestDays(180, [])).toHaveLength(180);
	});

	it("ignores time-of-day differences when counting calendar days", () => {
		expect(
			generateByFixedDate(
				new Date(2026, 6, 30, 23, 59, 59, 999),
				new Date(2026, 6, 31, 0, 0, 0, 1),
				[]
			)
		).toHaveLength(2);
	});

	it("returns no cells for a reversed fixed range", () => {
		expect(
			generateByFixedDate(
				new Date(2026, 6, 31),
				new Date(2026, 6, 30),
				[]
			)
		).toEqual([]);
	});
});

describe("folder collection coverage", () => {
	it("只采集指定笔记不把其父目录标为完整采集，空展示筛选仍表示全部已采集记录", () => {
		const tracking = [{ startDate: "2026-07-30" }];
		const scopes = [{ startDate: "2026-07-30", folders: [], files: ["项目/甲.md", "根笔记.md"] }];
		expect(getDateTrackingState("2026-07-31", tracking, scopes, ["项目"])).toBe("UNTRACKED");
		expect(getDateTrackingState("2026-07-31", tracking, scopes, [])).toBe("TRACKED");
	});
	it("distinguishes tracked, partial, and untracked folder dates", () => {
		const tracking = [{ startDate: "2026-07-30" }];
		expect(getDateTrackingState("2026-07-31", tracking, [
			{ startDate: "2026-07-30", folders: [] },
		], ["Projects"])).toBe("TRACKED");
		expect(getDateTrackingState("2026-07-31", tracking, [
			{ startDate: "2026-07-31", endDate: "2026-07-31", folders: [] },
			{ startDate: "2026-07-31", folders: ["Journal"] },
		], ["Projects"])).toBe("PARTIAL");
		expect(getDateTrackingState("2026-07-31", tracking, [
			{ startDate: "2026-07-30", folders: ["Journal"] },
		], ["Projects"])).toBe("UNTRACKED");
	});
});
