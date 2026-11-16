import { describe, expect, it } from "vitest";
import { buildWeeklyReviewInsights } from "../src/time/weeklyReviewInsights";
import type { TimeDocumentStats } from "../src/time/types";
import type { WeeklyReviewDay, WeeklyReviewSnapshot } from "../src/time/weeklyReviewTypes";

const row = (path: string, seconds: number): TimeDocumentStats => ({ path, seconds });
function day(date: string, documents: TimeDocumentStats[], coverage: WeeklyReviewDay["coverage"] = "TRACKED", future = false): WeeklyReviewDay {
	return {date, documents, seconds: documents.reduce((sum, item) => sum + item.seconds, 0), coverage, future, timezoneWarning: false, scopeSignatures: []};
}
function snapshot(currentDays: WeeklyReviewDay[], previousDays: WeeklyReviewDay[], state: "READY" | "INCOMPLETE" | "NO_COMPLETED_DAYS" = "READY", timelineDays = [...previousDays, ...currentDays]): WeeklyReviewSnapshot {
	const documents = currentDays.flatMap(item => item.documents);
	return {
		generatedAt: 0, today: "2026-11-18", weekStart: "2026-11-16", weekEnd: "2026-11-22", isCurrentWeek: true,
		root: "", days: currentDays, documents, totalSeconds: documents.reduce((sum, item) => sum + item.seconds, 0), recordedDays: currentDays.filter(item => item.seconds > 0).length,
		comparison: {fromDate: "2026-11-16", toDate: "2026-11-17", referenceFromDate: "2026-11-09", referenceToDate: "2026-11-10", currentSeconds: currentDays.reduce((sum, item) => sum + item.seconds, 0), previousSeconds: previousDays.reduce((sum, item) => sum + item.seconds, 0), state, currentDays, previousDays},
		earliestDate: "2026-11-09", folderPaths: [], warnings: [], timeline: {fromDate: "2026-10-26", toDate: "2026-11-22", days: timelineDays, hours: []},
	};
}
function addWindows(report: WeeklyReviewSnapshot, windows: unknown[]): WeeklyReviewSnapshot {
	(report.timeline as unknown as {windows: unknown[]}).windows = windows;
	return report;
}
const windowOf = (fromDate: string, days: WeeklyReviewDay[], previousState: string, toDate?: string) => ({fromDate, toDate, days, previousState});

describe("周回顾第三阶段只读洞察", () => {
	it("给出可追溯的结构与时段观察，且不修改快照", () => {
		const current = [day("2026-11-16", [row("医/内/甲.md", 600), row("activity://yolo-chat", 300)])];
		const report = snapshot(current, [day("2026-11-09", [row("医/内/甲.md", 100)])]);
		(report.timeline as unknown as {hours: unknown[]}).hours = Array.from({length: 24}, (_, hour) => ({date: "2026-11-16", hour, seconds: hour === 18 ? 700 : 0, documents: hour === 18 ? [row("医/内/甲.md", 700)] : [], coverage: "TRACKED", future: false, timezoneWarning: false}));
		const before = JSON.stringify(report);
		const result = buildWeeklyReviewInsights(report, {groupingRoot: "医", depth: 1});
		expect(result.observations).toHaveLength(3);
		expect(result.observations.some(item => item.kind === "structure" && item.action.id === "folder:医/内")).toBe(true);
		expect(result.observations.some(item => item.kind === "hour" && item.action.id === "18-24")).toBe(true);
		expect(JSON.stringify(report)).toBe(before);
	});

	it("洞察文案跨小时显示小时和分钟", () => {
		const report = snapshot([day("2026-11-16", [row("医/内/甲.md", 3661)])], []);
		const result = buildWeeklyReviewInsights(report, {groupingRoot: "医", depth: 1});
		expect(result.observations.find(item => item.id === "structure:top")?.text).toContain("1小时1分钟");
	});

	it("不完整同期只提示限制，不生成无依据差额", () => {
		const report = snapshot([day("2026-11-16", [row("医/内/甲.md", 600)], "PARTIAL")], [day("2026-11-09", [row("医/外/乙.md", 400)])], "INCOMPLETE");
		const result = buildWeeklyReviewInsights(report, {groupingRoot: "医", depth: 1});
		expect(result.changes.canDescribeChange).toBe(false);
		expect(result.changes.groups.every(item => item.deltaSeconds === undefined)).toBe(true);
		expect(result.observations.some(item => item.kind === "comparison" && item.text.includes("无法判断"))).toBe(true);
	});

	it("READY 变化分解按分组和笔记守恒，并标出新出现的分组", () => {
		const current = [day("2026-11-16", [row("医/内/甲.md", 900), row("activity://yolo-chat", 100)])];
		const previous = [day("2026-11-09", [row("医/内/甲.md", 300)])];
		const report = snapshot(current, previous);
		const result = buildWeeklyReviewInsights(report, {groupingRoot: "医", depth: 1});
		const inside = result.changes.groups.find(item => item.id === "folder:医/内")!;
		expect(inside).toMatchObject({currentSeconds: 900, previousSeconds: 300, deltaSeconds: 600, currentKnown: true, previousKnown: true});
		expect(inside.documents[0]).toMatchObject({path: "医/内/甲.md", deltaSeconds: 600});
		expect(result.changes.groups.find(item => item.id === "activity:yolo")).toMatchObject({previousSeconds: 0, previousKnown: true, deltaSeconds: 100, status: "ADDED"});
		expect(result.changes.groups.reduce((sum, item) => sum + (item.deltaSeconds || 0), 0)).toBe(700);
	});

	it("可靠零投入与覆盖未知分开处理", () => {
		const current = [day("2026-11-16", [row("医/内/甲.md", 100)], "TRACKED")];
		const previous = [day("2026-11-09", [], "PARTIAL")];
		const report = snapshot(current, previous, "INCOMPLETE");
		const result = buildWeeklyReviewInsights(report, {groupingRoot: "医", depth: 1});
		const rows = result.changes.groups;
		expect(rows.find(item => item.id === "folder:医/内")?.previousKnown).toBe(false);
		expect(rows.find(item => item.id === "folder:医/内")?.deltaSeconds).toBeUndefined();
	});

	it("四周排名使用竞争排名、最多六条且保留 YOLO，不合成其他", () => {
		const make = (date: string, values: Record<string, number>) => day(date, Object.entries(values).map(([path, seconds]) => row(path, seconds)));
		const windows = [
			windowOf("2026-10-26", [make("2026-10-26", {"医/一/甲.md": 100, "医/二/甲.md": 100, "activity://yolo-chat": 20})], "READY", "2026-11-01"),
			windowOf("2026-11-02", [make("2026-11-02", {"医/一/甲.md": 90, "医/二/甲.md": 80, "医/三/甲.md": 70, "医/四/甲.md": 60, "医/五/甲.md": 50, "医/六/甲.md": 40, "activity://yolo-chat": 30})], "READY", "2026-11-08"),
			windowOf("2026-11-09", [make("2026-11-09", {"医/一/甲.md": 80})], "READY", "2026-11-15"),
			windowOf("2026-11-16", [make("2026-11-16", {"医/一/甲.md": 70})], "NO_COMPLETED_DAYS"),
		];
		const report = addWindows(snapshot([make("2026-11-16", {"医/一/甲.md": 70})], [], "NO_COMPLETED_DAYS"), windows);
		const result = buildWeeklyReviewInsights(report, {groupingRoot: "医", depth: 1});
		expect(result.ranking.groups).toHaveLength(6);
		expect(result.ranking.groups.some(item => item.id === "activity:yolo")).toBe(true);
		expect(result.ranking.groups.some(item => item.id === "trend:other")).toBe(false);
		const tie = result.ranking.groups.find(item => item.id === "folder:医/一")!.points[0];
		expect(tie.rank).toBe(1);
		expect(result.ranking.groups.find(item => item.id === "folder:医/二")!.points[0].rank).toBe(1);
		expect(result.ranking.groups.find(item => item.id === "folder:医/三")!.points[1].rank).toBe(3);
	});

	it("当前周一无完成日期时不伪造排名点，窗口顺序保持旧到新", () => {
		const report = addWindows(snapshot([], [], "NO_COMPLETED_DAYS"), [windowOf("2026-10-26", [], "READY", "2026-11-01"), windowOf("2026-11-02", [], "READY", "2026-11-08"), windowOf("2026-11-09", [], "READY", "2026-11-15"), windowOf("2026-11-16", [], "NO_COMPLETED_DAYS")]);
		const result = buildWeeklyReviewInsights(report, {groupingRoot: "医", depth: 1});
		expect(result.ranking.windows.map(item => item.fromDate)).toEqual(["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"]);
		expect(result.ranking.windows[result.ranking.windows.length - 1]?.points).toHaveLength(0);
	});

	it("部分记录与规则变化不连线，确认零和未知保持无排名且保留空明细", () => {
		const make = (date: string, values: Record<string, number>, coverage: WeeklyReviewDay["coverage"] = "TRACKED") => day(date, Object.entries(values).map(([path, seconds]) => row(path, seconds)), coverage);
		const windows = [
			windowOf("2026-10-26", [make("2026-10-26", {"医/内/甲.md": 100, "医/零/甲.md": 10, "医/未知/甲.md": 8})], "READY", "2026-11-01"),
			windowOf("2026-11-02", [make("2026-11-02", {"医/内/甲.md": 150}, "PARTIAL")], "READY", "2026-11-08"),
			windowOf("2026-11-09", [make("2026-11-09", {"医/内/甲.md": 200})], "POLICY_CHANGED", "2026-11-15"),
			windowOf("2026-11-16", [make("2026-11-16", {})], "READY", "2026-11-22"),
		];
		const report = addWindows(snapshot([make("2026-11-16", {})], [], "NO_COMPLETED_DAYS"), windows);
		const ranking = buildWeeklyReviewInsights(report, {groupingRoot: "医", depth: 1}).ranking;
		const inside = ranking.groups.find(item => item.id === "folder:医/内")!;
		expect(inside.points[1]).toMatchObject({seconds: 150, complete: false, status: "RECORDED", connectPrevious: false});
		expect(inside.points[2].connectPrevious).toBe(false);
		const confirmedZero = ranking.groups.find(item => item.id === "folder:医/零")!.points[3];
		const unknown = ranking.groups.find(item => item.id === "folder:医/未知")!.points[1];
		expect(confirmedZero).toMatchObject({rank: null, status: "CONFIRMED_ZERO", known: true, documents: []});
		expect(unknown).toMatchObject({rank: null, status: "UNKNOWN", known: false, documents: []});
	});
});
