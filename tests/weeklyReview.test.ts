import { describe, expect, it } from "vitest";
import { createEmptyTimeActivity } from "../src/time/timeData";
import { buildWeeklyReview, getReviewWeekStart, getWeeklyReviewGoal, getWeeklyReviewGroups, shiftReviewDate } from "../src/time/weeklyReview";
import type { StoredTimeActivity } from "../src/time/types";

const epoch = (date: string, hour = 0) => new Date(`${date}T${String(hour).padStart(2, "0")}:00:00`).getTime();
const now = epoch("2026-11-18", 12);
function put(data: StoredTimeActivity, date: string, documents: Record<string, number>, offset?: number) {
	const offsetMinutes = offset ?? -new Date(epoch(date, 10)).getTimezoneOffset();
	data.buckets[`${date}/${offsetMinutes}`] = { date, hour: 10, offsetMinutes, documents };
}
function cover(data: StoredTimeActivity, start = "2026-11-09", end = "2026-11-23", folders: string[] = []) {
	data.periods.push({ start: epoch(start), end: epoch(end), folders });
}

describe("学科周回顾的公共计算行为", () => {
	it("指定笔记范围变化阻断同期比较，单篇不代表整个父目录已采集", () => {
		const data = createEmptyTimeActivity();
		data.periods = [
			{ start: epoch("2026-11-09"), end: epoch("2026-11-16"), folders: [], files: ["独立/甲.md"] },
			{ start: epoch("2026-11-16"), end: epoch("2026-11-23"), folders: [], files: ["独立/乙.md", "根笔记.md"] },
		];
		const before = JSON.stringify(data);
		const report = buildWeeklyReview(data, {}, now);
		expect(report.comparison.state).toBe("POLICY_CHANGED");
		expect(report.folderPaths).toEqual(["独立"]);
		expect(buildWeeklyReview(data, { root: "独立" }, now).days[0].coverage).toBe("UNTRACKED");
		expect(JSON.stringify(data)).toBe(before);
	});
	it("旧范围缺少指定笔记字段等价于空列表，不改变原比较结果", () => {
		const data = createEmptyTimeActivity();
		data.periods = [
			{ start: epoch("2026-11-09"), end: epoch("2026-11-16"), folders: ["医"] },
			{ start: epoch("2026-11-16"), end: epoch("2026-11-23"), folders: ["医"], files: [] },
		];
		expect(buildWeeklyReview(data, {}, now).comparison.state).toBe("READY");
	});
	it("本周累计含今天，同期只比已结束日期，历史周比较完整七天", () => {
		const data = createEmptyTimeActivity(); cover(data);
		put(data, "2026-11-09", { "医/甲.md": 1800 });
		put(data, "2026-11-10", { "医/甲.md": 900 });
		put(data, "2026-11-16", { "医/甲.md": 3600 });
		put(data, "2026-11-17", { "医/甲.md": 1800 });
		put(data, "2026-11-18", { "医/甲.md": 1200 });
		const report = buildWeeklyReview(data, {root: "医"}, now);
		expect([report.weekStart, report.weekEnd, report.totalSeconds, report.recordedDays]).toEqual(["2026-11-16", "2026-11-22", 6600, 3]);
		expect(report.comparison).toMatchObject({ fromDate: "2026-11-16", toDate: "2026-11-17",
			referenceFromDate: "2026-11-09", referenceToDate: "2026-11-10", currentSeconds: 5400, previousSeconds: 2700,
			state: "READY", deltaSeconds: 2700, percentage: 100 });
		const history = buildWeeklyReview(data, {date: "2026-11-10"}, now);
		expect(history.isCurrentWeek).toBe(false);
		expect(history.comparison.toDate).toBe("2026-11-15");
		expect(history.comparison.currentDays).toHaveLength(7);
	});
	it("没有时长行时仍补七天，区分已覆盖零、部分、未采集和未来", () => {
		const data = createEmptyTimeActivity();
		cover(data, "2026-11-16", "2026-11-17", ["医"]);
		data.periods.push({ start: epoch("2026-11-17", 12), end: epoch("2026-11-17", 13), folders: ["医"] });
		const days = buildWeeklyReview(data, {root: "医"}, now).days;
		expect(days).toHaveLength(7);
		expect(days.map(d => d.coverage)).toEqual(["TRACKED", "PARTIAL", "UNTRACKED", "UNTRACKED", "UNTRACKED", "UNTRACKED", "UNTRACKED"]);
		expect(days.map(d => d.future)).toEqual([false, false, false, true, true, true, true]);
		expect(days.every(d => d.seconds === 0)).toBe(true);
	});
	it("按目录边界唯一归组，切层级守恒，YOLO 独立且不进入目录元数据", () => {
		const data = createEmptyTimeActivity();
		put(data, "2026-11-16", { "医/内/心/甲.md": 10.5, "医/内/总论.md": 20, "医/外/总论.md": 20,
			"医/安排.md": 5, "医学/漏纳.md": 99, "activity://yolo-chat": 120 });
		const report = buildWeeklyReview(data, {root: "/医/"}, now);
		expect(report.totalSeconds).toBe(55.5);
		const first = getWeeklyReviewGroups(report, 1), second = getWeeklyReviewGroups(report, 2);
		expect(first.map(g => [g.label, g.seconds])).toEqual([["内", 30.5], ["外", 20], ["根目录直属笔记", 5]]);
		expect(second.find(g => g.label === "内/心")?.seconds).toBe(10.5);
		expect(second.reduce((sum, g) => sum + g.seconds, 0)).toBe(55.5);
		const all = buildWeeklyReview(data, {}, now);
		expect(getWeeklyReviewGroups(all, 1).find(g => g.activity)).toMatchObject({ label: "YOLO 对话活动", seconds: 120 });
		expect(all.folderPaths.some(path => path.includes("activity:"))).toBe(false);
		expect(getWeeklyReviewGroups(all, 1).reduce((sum, g) => sum + g.seconds, 0)).toBe(274.5);
	});
	it("目标按原始秒数判断，部分采集达标有效，未知及今日不提前判失败", () => {
		const data = createEmptyTimeActivity(); cover(data, "2026-11-16", "2026-11-17");
		put(data, "2026-11-16", { "甲.md": 3599.9 });
		put(data, "2026-11-17", { "甲.md": 3600 });
		const days = buildWeeklyReview(data, {}, now).days;
		expect(days.map(d => getWeeklyReviewGoal(d, "2026-11-18", 60))).toEqual(["MISSED", "MET", "IN_PROGRESS", "EXCLUDED", "EXCLUDED", "EXCLUDED", "EXCLUDED"]);
		expect(getWeeklyReviewGoal({...days[0], coverage: "PARTIAL"}, "2026-11-18", 60)).toBe("UNKNOWN");
		expect(getWeeklyReviewGoal(days[0], "2026-11-18", undefined)).toBe("EXCLUDED");
		expect(getWeeklyReviewGoal(days[0], "2026-11-18", 0)).toBe("EXCLUDED");
	});
	it("零分母不计算增长率，比较间隔或无活动日的范围及阈值调整也会阻断结论", () => {
		const data = createEmptyTimeActivity(); cover(data);
		const zero = buildWeeklyReview(data, {}, now).comparison;
		expect(zero).toMatchObject({ state: "READY", deltaSeconds: 0 });
		expect(zero.percentage).toBeUndefined();
		put(data, "2026-11-16", { "甲.md": 100 });
		expect(buildWeeklyReview(data, {}, now).comparison).toMatchObject({ state: "READY", deltaSeconds: 100 });
		data.policyChanges.push({ at: epoch("2026-11-12", 10), idleTimeoutMinutes: 10 });
		const changed = buildWeeklyReview(data, {}, now).comparison;
		expect(changed.state).toBe("POLICY_CHANGED");
		expect(changed.percentage).toBeUndefined();
		expect(changed.deltaSeconds).toBeUndefined();
		data.policyChanges = [];
		data.periods = [{ start: epoch("2026-11-09"), end: epoch("2026-11-16"), folders: ["医"] },
			{ start: epoch("2026-11-16"), end: epoch("2026-11-23"), folders: ["英语"] }];
		expect(buildWeeklyReview(data, {}, now).comparison.state).toBe("POLICY_CHANGED");
		data.periods = [];
		expect(buildWeeklyReview(data, {}, now).comparison.state).toBe("INCOMPLETE");
	});
	it("时区异常、超前日期和无覆盖的正时长不丢失，也不伪造完整覆盖", () => {
		const data = createEmptyTimeActivity(); cover(data);
		const offset = -new Date(epoch("2026-11-16", 10)).getTimezoneOffset();
		put(data, "2026-11-16", { "甲.md": 3600 }, offset);
		put(data, "2026-11-16", { "甲.md": 3600 }, offset + 60);
		put(data, "2026-11-19", { "甲.md": 120 });
		const before = JSON.stringify(data), report = buildWeeklyReview(data, {}, now);
		expect(report.totalSeconds).toBe(7320);
		expect(report.days[0]).toMatchObject({ seconds: 7200, coverage: "UNKNOWN", timezoneWarning: true });
		expect(report.days[3]).toMatchObject({ seconds: 120, coverage: "UNKNOWN", future: true });
		expect(getWeeklyReviewGoal(report.days[3], report.today, 1)).toBe("EXCLUDED");
		expect(report.comparison.state).toBe("INCOMPLETE");
		expect(JSON.stringify(data)).toBe(before);
		data.periods = [];
		expect(buildWeeklyReview(data, {}, now).days[0].coverage).toBe("UNKNOWN");
	});
	it("周一无同期结论，跨年按日历定位，最早覆盖日期及历史目录可导航", () => {
		const data = createEmptyTimeActivity(); cover(data, "2026-11-02", "2026-11-03", ["旧目录"]);
		const report = buildWeeklyReview(data, {}, epoch("2026-11-16", 12));
		expect(report.comparison).toMatchObject({ state: "NO_COMPLETED_DAYS", toDate: undefined });
		expect(report.earliestDate).toBe("2026-11-02");
		expect(report.folderPaths).toContain("旧目录");
		expect(getReviewWeekStart("2027-01-01")).toBe("2026-12-28");
		expect(shiftReviewDate("2027-01-01", -1)).toBe("2026-12-31");
		expect(() => buildWeeklyReview(data, {date: "2026-02-30"}, now)).toThrow();
		expect(() => buildWeeklyReview(data, {date: "2026-12-01"}, now)).toThrow();
	});
});
