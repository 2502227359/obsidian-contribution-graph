import { describe, expect, it } from "vitest";
import {
	applyStatisticsRename,
	closeStatistics,
	emptyStatistics,
	mergeStatistics,
	statisticsFrom,
} from "../src/activity/statisticsModel";
import { StatisticsData } from "../src/activity/statisticsModel";

function sample(overrides: Partial<StatisticsData> = {}): StatisticsData {
	return {
		dailyStats: Object.assign(Object.create(null), {
			"2026-11-14": {
				addedChars: 200,
				deletedChars: 10,
				documents: Object.assign(Object.create(null), {
					"临床/甲.md": {
						addedChars: 200,
						deletedChars: 10,
						lastEditPosition: { line: 1, column: 2 },
					},
				}),
			},
		}),
		timeActivity: {
			buckets: Object.assign(Object.create(null), {
				"2026-11-14T09-+480": {
					date: "2026-11-14",
					hour: 9,
					offsetMinutes: 480,
					documents: Object.assign(Object.create(null), {
						"临床/甲.md": 1200,
					}),
				},
			}),
			periods: [{ start: 1000, folders: ["临床"] }],
			policyChanges: [{ at: 1000, idleTimeoutMinutes: 5 }],
		},
		trackingPeriods: [{ startDate: "2026-11-14" }],
		collectionScopePeriods: [{ startDate: "2026-11-14", folders: ["临床"] }],
		countingPolicyPeriods: [{
			startedAt: "2026-11-14T00:00:00.000Z",
			policy: {
				excludeWhitespace: true,
				excludeMarkdownFormatting: false,
				strictUserInputOnly: true,
				countPastedText: true,
			},
		}],
		...overrides,
	};
}

describe("普通目录统计的纯合并模型", () => {
	it("合并两份记录并按记录内容去重后的视图相加", () => {
		const second = sample({
			dailyStats: Object.assign(Object.create(null), {
				"2026-11-14": {
					addedChars: 300,
					deletedChars: 5,
					documents: Object.assign(Object.create(null), {
						"临床/甲.md": {
							addedChars: 100,
							deletedChars: 2,
							lastEditPosition: { line: 4, column: 5 },
						},
						"临床/乙.md": { addedChars: 200, deletedChars: 3 },
					}),
				},
			}),
			timeActivity: {
				buckets: Object.assign(Object.create(null), {
					"2026-11-14T09-+480": {
						date: "2026-11-14", hour: 9, offsetMinutes: 480,
						documents: Object.assign(Object.create(null), { "临床/甲.md": 1800 }),
					},
				}),
				periods: [{ start: 1000, folders: ["临床"] }],
				policyChanges: [{ at: 1000, idleTimeoutMinutes: 5 }],
			},
		});
		const firstBefore = JSON.stringify(sample());
		const merged = mergeStatistics([sample(), sample(), second]);
		const day = merged.dailyStats["2026-11-14"];
		expect(day.addedChars).toBe(700);
		expect(day.deletedChars).toBe(25);
		expect(day.documents["临床/甲.md"].addedChars).toBe(500);
		expect(day.documents["临床/乙.md"].addedChars).toBe(200);
		expect(day.documents["临床/甲.md"].lastEditPosition).toEqual({ line: 4, column: 5 });
		expect(merged.timeActivity.buckets["2026-11-14T09-+480"].documents["临床/甲.md"]).toBe(4200);
		expect(merged.trackingPeriods).toHaveLength(1);
		expect(merged.collectionScopePeriods).toHaveLength(1);
		expect(merged.countingPolicyPeriods).toHaveLength(1);
		expect(Object.getPrototypeOf(merged.dailyStats)).toBeNull();
		expect(Object.getPrototypeOf(merged.timeActivity.buckets)).toBeNull();
		expect(JSON.stringify(sample())).toBe(firstBefore);
	});

	it("生成空统计并从整库副本中只取统计字段", () => {
		const empty = emptyStatistics();
		expect(empty.dailyStats).toEqual({});
		expect(Object.getPrototypeOf(empty.dailyStats)).toBeNull();
		const source = { ...sample(), settings: { trackingEnabled: true }, graphThemes: [{ id: "theme" }] };
		const copy = statisticsFrom(source as never);
		copy.dailyStats["2026-11-14"].addedChars = 999;
		expect(source.dailyStats["2026-11-14"].addedChars).toBe(200);
	});

	it("关闭开放覆盖和策略区间，保留原有闭合历史", () => {
		const closed = closeStatistics(sample({
			timeActivity: {
				buckets: Object.create(null),
				periods: [{ start: 1000, folders: [] }, { start: 2000, end: 2500, folders: [] }],
				policyChanges: [],
			},
			trackingPeriods: [{ startDate: "2026-11-01" }, { startDate: "2026-11-02", endDate: "2026-11-03" }],
			collectionScopePeriods: [{ startDate: "2026-11-01", folders: [] }],
			countingPolicyPeriods: [{ startedAt: "2026-11-01T00:00:00.000Z", policy: { excludeWhitespace: true, excludeMarkdownFormatting: false, strictUserInputOnly: true, countPastedText: true } }],
		}), 10_000);
		expect(closed.timeActivity.periods.map(period => period.end)).toEqual([10000, 2500]);
		expect(closed.trackingPeriods.map(period => period.endDate)).toEqual(["2026-11-01", "2026-11-03"]);
		expect(closed.collectionScopePeriods[0].endDate).toBe("2026-11-01");
		expect(closed.countingPolicyPeriods[0].endedAt).toBe("2026-11-01T00:00:00.000Z");
	});

	it("重命名字数、时长和范围路径但不改变计数", () => {
		const renamed = applyStatisticsRename(sample(), { oldPath: "临床", newPath: "复习", isFolder: true });
		expect(renamed.dailyStats["2026-11-14"].documents["复习/甲.md"].addedChars).toBe(200);
		expect(renamed.timeActivity.buckets["2026-11-14T09-+480"].documents["复习/甲.md"]).toBe(1200);
		expect(renamed.collectionScopePeriods[0].folders).toEqual(["复习"]);
		expect(sample().dailyStats["2026-11-14"].documents["临床/甲.md"]).toBeDefined();
	});
});
