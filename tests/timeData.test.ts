import { describe, expect, it } from "vitest";
import {
	addTimeSpan,
	createEmptyTimeActivity,
	formatDuration,
	getNextLocalDate,
	getTimeTrackingState,
	normalizeTimeActivity,
	queryTimeStats,
	renameTimePaths,
	removeTimeSpan,
	splitTimeSpan,
} from "../src/time/timeData";
import { TimeSpan } from "../src/time/types";

const span = (path: string, start: number, end: number): TimeSpan => ({
	path,
	start,
	end,
	seconds: (end - start) / 1000,
});

const bucketKey = (date: Date): string => {
	const offset = -date.getTimezoneOffset();
	const sign = offset >= 0 ? "+" : "-";
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}-${sign}${Math.abs(offset)}`;
};

describe("time activity data", () => {
	it("整段撤回零碎心跳不会留下浮点残值或负数", () => {
		const data = createEmptyTimeActivity();
		const start = new Date(2026, 0, 1, 10).getTime();
		for (let i = 0; i < 1000; i++) addTimeSpan(data, span("甲.md", start + i, start + i + 1));
		removeTimeSpan(data, span("甲.md", start, start + 1000));
		expect(Object.keys(data.buckets)).toEqual([]);
		addTimeSpan(data, span("甲.md", start, start + 1000));
		removeTimeSpan(data, span("甲.md", start, start + 2000));
		expect(Object.keys(data.buckets)).toEqual([]);
	});

	it("撤回跨午夜空闲尾段，保留此前时长和其他文档并移除空桶", () => {
		const data = createEmptyTimeActivity();
		const start = new Date(2026, 0, 1, 23, 58).getTime();
		addTimeSpan(data, span("甲.md", start - 30000, start + 300000));
		addTimeSpan(data, span("乙.md", start - 10000, start));
		expect(removeTimeSpan(data, span("甲.md", start, start + 300000))).toEqual([
			{ date: "2026-01-01", hour: 23 }, { date: "2026-01-02", hour: 0 },
		]);
		expect(Object.keys(data.buckets)).toHaveLength(1);
		expect(queryTimeStats(data, {}, start + 300000, true)[0]).toMatchObject({
			seconds: 40, documents: [{ path: "甲.md", seconds: 30 }, { path: "乙.md", seconds: 10 }],
		});
		removeTimeSpan(data, span("甲.md", start - 30000, start));
		expect(queryTimeStats(data, {}, start + 300000, false)[0].seconds).toBe(10);
		expect(removeTimeSpan(data, span("不存在.md", start, start + 300000))).toEqual([]);
		expect(queryTimeStats(data, {}, start + 300000, false)[0].seconds).toBe(10);
	});

	it("跨小时和午夜拆分时长", () => {
		const data = createEmptyTimeActivity();
		const start = new Date(2026, 0, 1, 23, 50).getTime();
		const changed = addTimeSpan(data, span("Notes/a.md", start, start + 20 * 60 * 1000));

		expect(changed).toEqual([
			{date: "2026-01-01", hour: 23},
			{date: "2026-01-02", hour: 0},
		]);

		expect(Object.keys(data.buckets)).toEqual([
			bucketKey(new Date(2026, 0, 1, 23)),
			bucketKey(new Date(2026, 0, 2, 0)),
		]);
		expect(data.buckets[bucketKey(new Date(2026, 0, 1, 23))].documents["Notes/a.md"]).toBe(600);
		expect(data.buckets[bucketKey(new Date(2026, 0, 2, 0))].documents["Notes/a.md"]).toBe(600);
	});

	it("导出的分桶片段与原时长分配保持一致并保留毫秒精度", () => {
		const start = new Date(2026, 0, 1, 23, 59, 59, 125).getTime();
		const end = start + 1250;
		const pieces = splitTimeSpan({ path: "a.md", start, end, seconds: 1.25 });
		expect(pieces).toHaveLength(2);
		expect(pieces[0]).toMatchObject({ start, end: start + 875, seconds: 0.875 });
		expect(pieces[1]).toMatchObject({ start: start + 875, end, seconds: 0.375 });
		expect(pieces.reduce((sum, item) => sum + item.seconds, 0)).toBeCloseTo(1.25);
	});

	it("保持日汇总与小时汇总一致并支持文件夹筛选", () => {
		const data = createEmptyTimeActivity();
		const start = new Date(2026, 0, 1, 9).getTime();
		addTimeSpan(data, span("Projects/a.md", start, start + 30 * 60 * 1000));
		addTimeSpan(data, span("Journal/b.md", start, start + 15 * 60 * 1000));

		const daily = queryTimeStats(data, { fromDate: "2026-01-01", toDate: "2026-01-01", folders: ["Projects"] }, start, false);
		const hourly = queryTimeStats(data, { fromDate: "2026-01-01", toDate: "2026-01-01", folders: ["Projects"] }, start, true);

		expect(daily).toHaveLength(1);
		expect(daily[0].seconds).toBe(1800);
		expect(hourly).toHaveLength(1);
		expect(hourly[0].hour).toBe(9);
		expect(hourly[0].seconds).toBe(1800);
		expect(hourly[0].documents).toEqual([{ path: "Projects/a.md", seconds: 1800 }]);
	});

	it("采集从日中开始时标记为部分覆盖", () => {
		const data = createEmptyTimeActivity();
		const dayStart = new Date(2026, 0, 1, 0).getTime();
		data.periods = [{ start: dayStart + 10 * 60 * 60 * 1000, folders: [] }];

		expect(
			getTimeTrackingState(
				data,
				dayStart,
				dayStart + 24 * 60 * 60 * 1000,
				[],
				dayStart + 12 * 60 * 60 * 1000
			)
		).toBe("PARTIAL");
	});

	it("仅指定笔记的覆盖周期不宣称覆盖其父目录", () => {
		const start = Date.UTC(2026, 0, 1);
		const data = createEmptyTimeActivity();
		data.periods = [{ start, end: start + 60 * 60 * 1000, folders: [], files: ["Root/A.md"] }];
		expect(getTimeTrackingState(data, start, start + 60 * 60 * 1000, ["Root"], start + 60 * 60 * 1000)).toBe("UNTRACKED");
		expect(getTimeTrackingState(data, start, start + 60 * 60 * 1000, [], start + 60 * 60 * 1000)).toBe("TRACKED");
	});

	it("合并零散覆盖周期并识别完整覆盖", () => {
		const start = Date.UTC(2026, 0, 1);
		const end = start + 10 * 60 * 60 * 1000;
		const data = createEmptyTimeActivity();
		data.periods = [
			{ start: start + 60 * 60 * 1000, end: start + 2 * 60 * 60 * 1000, folders: [] },
			{ start: start + 5 * 60 * 60 * 1000, end, folders: [] },
		];
		expect(getTimeTrackingState(data, start, end, [], end)).toBe("PARTIAL");
		data.periods = [
			{ start, end: start + 5 * 60 * 60 * 1000, folders: [] },
			{ start: start + 5 * 60 * 60 * 1000, end, folders: [] },
		];
		expect(getTimeTrackingState(data, start, end, [], end)).toBe("TRACKED");
	});

	it("迁移文件和文件夹路径且避免前缀误匹配", () => {
		const data = createEmptyTimeActivity();
		const start = new Date(2026, 0, 1, 9).getTime();
		addTimeSpan(data, span("Projects/a.md", start, start + 60 * 1000));
		addTimeSpan(data, span("Projects-old/b.md", start, start + 60 * 1000));
		renameTimePaths(data, "Projects", "Archive", true);

		expect(data.buckets[bucketKey(new Date(2026, 0, 1, 9))].documents).toEqual({
			"Archive/a.md": 60,
			"Projects-old/b.md": 60,
		});
	});

	it("迁移时长覆盖周期和时间轴周期中的指定笔记", () => {
		const data = createEmptyTimeActivity();
		data.periods = [{ start: 1, folders: [], files: ["Projects/A.md", "Other/B.md"] }];
		data.timeline = { formatVersion: 1, segments: [], recordingPeriods: [
			{ id: "p", start: 1, folders: [], files: ["Projects/A.md"] },
		] };
		expect(renameTimePaths(data, "Projects", "Archive", true)).toBe(true);
		expect(data.periods[0].files).toEqual(["Archive/A.md", "Other/B.md"]);
		expect(data.timeline?.recordingPeriods[0].files).toEqual(["Archive/A.md"]);
	});

	it("改名为非 Markdown 时保留原指定笔记范围", () => {
		const data = createEmptyTimeActivity();
		data.periods = [{ start: 1, folders: [], files: ["A.md"] }];
		expect(renameTimePaths(data, "A.md", "A.txt", false)).toBe(false);
		expect(data.periods[0].files).toEqual(["A.md"]);
	});

	it("规范化导入值并格式化时长", () => {
		const normalized = normalizeTimeActivity({
			buckets: {
				"2026-01-01T09-+480": {
					date: "2026-01-01",
					hour: 9,
					offsetMinutes: 480,
					documents: { "a.md": 12, __proto__: 99 },
				},
			},
			periods: [{ start: 100, folders: [] }],
			policyChanges: [{ at: 100, idleTimeoutMinutes: 5 }],
		}, true);

		expect(normalized.buckets["2026-01-01T09-+480"].documents).toEqual({ "a.md": 12 });
		expect(formatDuration(0)).toBe("0 分钟");
		expect(formatDuration(30)).toBe("少于 1 分钟");
		expect(formatDuration(3661)).toBe("1 小时 1 分钟");
	});

	it("使用传入时长并支持导入最大空闲阈值", () => {
		const data = createEmptyTimeActivity();
		const start = new Date(2026, 0, 1, 9).getTime();
		addTimeSpan(data, {
			path: "a.md",
			start,
			end: start + 10 * 60 * 1000,
			seconds: 100,
		});
		const rows = queryTimeStats(data, { fromDate: "2026-01-01", toDate: "2026-01-01" }, start, false);
		expect(rows[0].seconds).toBe(100);
		expect(
			normalizeTimeActivity({
				policyChanges: [{ at: start, idleTimeoutMinutes: 10080 }],
			}, true).policyChanges[0].idleTimeoutMinutes
		).toBe(10080);
	});

	it("忽略零长度覆盖周期", () => {
		const start = Date.UTC(2026, 0, 1);
		expect(
			normalizeTimeActivity({ periods: [{ start, end: start, folders: [] }] }, true).periods
		).toEqual([]);
	});

	it("在负时区递进到下一个本地日期", () => {
		const previous = process.env.TZ;
		process.env.TZ = "America/Los_Angeles";
		try {
			expect(getNextLocalDate("2026-01-01")).toBe("2026-01-02");
		} finally {
			if (previous === undefined) delete process.env.TZ;
			else process.env.TZ = previous;
		}
	});

	it("严格导入时拒绝伪日期和非法时区偏移", () => {
		const bucket = (date: string, offsetMinutes: number) => ({
			date,
			hour: 9,
			offsetMinutes,
			documents: {},
		});
		expect(() => normalizeTimeActivity({ buckets: { "2026-02-31T09-+480": bucket("2026-02-31", 480) } }, true)).toThrow();
		expect(() => normalizeTimeActivity({ buckets: { "2026-01-01T09-+480": bucket("2026-01-01", 480.5) } }, true)).toThrow();
		expect(() => normalizeTimeActivity({ buckets: { "2026-01-01T09-+1000": bucket("2026-01-01", 1000) } }, true)).toThrow();
	});
});
