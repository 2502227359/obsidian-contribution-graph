import { describe, expect, it } from "vitest";
import type { TimeDocumentStats } from "../src/time/types";
import type { WeeklyReviewDay, WeeklyReviewSnapshot } from "../src/time/weeklyReviewTypes";
import { buildWeeklyReviewAnalysis } from "../src/time/weeklyReviewAnalysis";

function documents(entries: Record<string, number>): TimeDocumentStats[] {
	return Object.entries(entries).map(([path, seconds]) => ({ path, seconds }));
}

function day(date: string, entries: Record<string, number>): WeeklyReviewDay {
	const rows = documents(entries);
	return {
		date, seconds: rows.reduce((sum, item) => sum + item.seconds, 0), documents: rows,
		coverage: "TRACKED", future: false, timezoneWarning: false, scopeSignatures: [],
	};
}

function snapshot(
	documentRows: TimeDocumentStats[],
	currentDays: WeeklyReviewDay[] = [],
	previousDays: WeeklyReviewDay[] = [],
	state: "READY" | "NO_COMPLETED_DAYS" | "INCOMPLETE" | "POLICY_CHANGED" = "READY",
): WeeklyReviewSnapshot {
	const currentSeconds = currentDays.reduce((sum, item) => sum + item.seconds, 0);
	const previousSeconds = previousDays.reduce((sum, item) => sum + item.seconds, 0);
	return {
		generatedAt: 0, today: "2026-11-18", weekStart: "2026-11-16", weekEnd: "2026-11-22",
		isCurrentWeek: true, root: "", days: currentDays, documents: documentRows,
		totalSeconds: documentRows.reduce((sum, item) => sum + item.seconds, 0), recordedDays: 1,
		comparison: {
			fromDate: "2026-11-16", toDate: "2026-11-17", referenceFromDate: "2026-11-09", referenceToDate: "2026-11-10",
			currentSeconds, previousSeconds, state, currentDays, previousDays,
			...(state === "READY" ? { deltaSeconds: currentSeconds - previousSeconds } : {}),
		},
		earliestDate: "2026-11-09", folderPaths: [], warnings: [],
	};
}

describe("周回顾分析模型", () => {
	it("旭日树保留笔记与 YOLO，目录层级及根目录直属笔记守恒", () => {
		const input = documents({
			"临床医学/内科/心.md": 10.125, "临床医学/外科/心.md": 20,
			"临床医学/安排.md": 5, "其他/内科/心.md": 7, "根.md": 3,
			"activity://yolo-chat": 12,
		});
		const report = snapshot(input);
		const before = JSON.stringify(report);
		const analysis = buildWeeklyReviewAnalysis(report, { groupingRoot: "临床医学" });

		expect(analysis.tree.seconds).toBe(report.totalSeconds);
		expect(analysis.tree.children.map(item => item.name)).toEqual(["笔记", "YOLO 对话活动"]);
		expect(analysis.tree.children.reduce((sum, item) => sum + item.seconds, 0)).toBe(report.totalSeconds);
		const notes = analysis.tree.children[0];
		expect(notes.children.map(item => item.path).sort()).toEqual(["临床医学", "临床医学/内科", "临床医学/外科", "其他", undefined].sort());
		expect(notes.children.find(item => item.path === "临床医学/内科")?.seconds).toBe(10.125);
		expect(notes.children.find(item => item.id === "direct:临床医学")?.seconds).toBe(5);
		expect(notes.children.find(item => item.path === "其他")?.children[0].id).not.toBe(
			notes.children.find(item => item.path === "临床医学/内科")?.id,
		);
		expect(analysis.tree.children[1]).toMatchObject({ activity: true, path: "activity://yolo-chat", seconds: 12 });
		expect(JSON.stringify(report)).toBe(before);
	});

	it("显式分组基准只改变展示，不筛掉基准外记录且同名目录按完整路径区分", () => {
		const report = snapshot(documents({ "医/内/甲.md": 10, "其他/内/甲.md": 20 }));
		const analysis = buildWeeklyReviewAnalysis(report, { groupingRoot: "医" });
		const notes = analysis.tree.children[0];

		expect(analysis.tree.seconds).toBe(30);
		expect(notes.seconds).toBe(30);
		expect(notes.children.map(item => item.path).sort()).toEqual(["医/内", "其他"].sort());
		expect(notes.children.find(item => item.path === "医/内")?.id).not.toBe(notes.children.find(item => item.path === "其他")?.children[0].id);
	});

	it("同期行只使用 currentDays 与 previousDays，不把快照今日明细带入", () => {
		const current = day("2026-11-16", { "医/内/甲.md": 10 });
		const previous = day("2026-11-09", { "医/内/甲.md": 4 });
		const report = snapshot(documents({ "医/内/甲.md": 10, "医/今天.md": 90 }), [current], [previous]);
		const comparison = buildWeeklyReviewAnalysis(report, { groupingRoot: "医", groupingDepth: 1 }).comparison;
		const row = comparison.rows.find(item => item.path === "医/内");

		expect(comparison.currentSeconds).toBe(10);
		expect(comparison.previousSeconds).toBe(4);
		expect(comparison.rows.reduce((sum, item) => sum + item.currentSeconds, 0)).toBe(10);
		expect(row).toMatchObject({ currentSeconds: 10, previousSeconds: 4, deltaSeconds: 6 });
		expect(row?.currentDocuments).toEqual([{ path: "医/内/甲.md", seconds: 10 }]);
		expect(comparison.rows.some(item => item.currentDocuments.some(document => document.path === "医/今天.md"))).toBe(false);
	});

	it("无已完成日期不造比较行，不完整状态保留区间值但不声明可比较变化", () => {
		const noDays = buildWeeklyReviewAnalysis(snapshot(documents({ "甲.md": 2 }), [], [], "NO_COMPLETED_DAYS"));
		expect(noDays.comparison).toMatchObject({ state: "NO_COMPLETED_DAYS", rows: [], canDescribeChange: false });

		const incomplete = buildWeeklyReviewAnalysis(snapshot(documents({ "甲.md": 2 }), [day("2026-11-16", { "甲.md": 2 })], [day("2026-11-09", { "甲.md": 1 })], "INCOMPLETE"));
		expect(incomplete.comparison).toMatchObject({ state: "INCOMPLETE", currentSeconds: 2, previousSeconds: 1, canDescribeChange: false });
		expect(incomplete.comparison.rows[0].deltaSeconds).toBeUndefined();
	});
	it("每层子节点合计守恒，子目录与同目录直属笔记都能独立选择", () => {
		const report = snapshot(documents({"医/内/甲.md": 2.25, "医/内/心/乙.md": 3.5}));
		const tree = buildWeeklyReviewAnalysis(report, {groupingRoot:"医"}).tree;
		const check = (node: typeof tree): void => {
			if (node.children.length) expect(node.children.reduce((sum, child) => sum + child.seconds, 0)).toBe(node.seconds);
			for (const child of node.children) check(child);
		};
		check(tree);
	});
	it("不完整期未出现的学科不当作已确认零，可靠期零值可比较", () => {
		const current = day("2026-11-16", {"医/内/甲.md": 5}); current.coverage="PARTIAL";
		const previous = day("2026-11-09", {"医/外/乙.md": 3});
		const report = snapshot(documents({"医/内/甲.md":5}),[current],[previous],"INCOMPLETE");
		let rows=buildWeeklyReviewAnalysis(report,{groupingRoot:"医"}).comparison.rows;
		expect(rows.find(row=>row.path==="医/外")).toMatchObject({currentSeconds:0,currentKnown:false,previousKnown:true});
		expect(rows.find(row=>row.path==="医/内")).toMatchObject({currentKnown:true,previousKnown:true,previousSeconds:0});
		current.coverage="TRACKED";report.comparison.state="READY";report.comparison.deltaSeconds=2;
		rows=buildWeeklyReviewAnalysis(report,{groupingRoot:"医"}).comparison.rows;
		expect(rows.every(row=>row.currentKnown&&row.previousKnown)).toBe(true);
		expect(rows.reduce((sum,row)=>sum+row.deltaSeconds!,0)).toBe(2);
	});

});
