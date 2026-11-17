import { describe, expect, it } from "vitest";
import { emptyStatistics } from "../src/activity/statisticsModel";
import { buildActivityTimelineDay } from "../src/time/activityTimelineQuery";
import type { ActivitySegment } from "../src/time/activityTimelineTypes";

const DATE = "2026-11-14";
const NOW = Date.UTC(2026, 10, 20, 12);

function bucketKey(hour: number): string {
	return `${DATE}T${String(hour).padStart(2, "0")}-+480`;
}

function segment(id: string, path: string, hour: number, start: number, end: number, seconds: number): ActivitySegment {
	return { id, continuityId: "continuity", recordingPeriodId: "period", path, bucketKey: bucketKey(hour), start, end, seconds };
}

function data(path = "临床/甲.md", seconds = 120) {
	const result = emptyStatistics().timeActivity;
	result.buckets[bucketKey(9)] = { date: DATE, hour: 9, offsetMinutes: 480, documents: { [path]: seconds } };
	result.timeline = { formatVersion: 1, segments: [], recordingPeriods: [] };
	return result;
}

describe("学习时间轴单日查询", () => {
	it("不同笔记的汇总不能抵消片段超额，片段必须位于对应原小时", () => {
		const activity=data("临床/甲.md",30);
		activity.buckets[bucketKey(9)].documents["临床/只有汇总.md"]=60;
		activity.timeline!.segments=[segment("over","临床/甲.md",9,Date.UTC(2026,10,14,1),Date.UTC(2026,10,14,1,1),60)];
		const over=buildActivityTimelineDay([{id:"one",data:activity}],{date:DATE},NOW);
		expect(over).toMatchObject({precision:"INCONSISTENT",totalSeconds:90,locatedSeconds:0,blocks:[]});
		activity.timeline!.segments=[segment("wrong-hour","临床/甲.md",9,Date.UTC(2026,10,14,2),Date.UTC(2026,10,14,2,0,30),30)];
		expect(buildActivityTimelineDay([{id:"one",data:activity}],{date:DATE},NOW)).toMatchObject({precision:"INCONSISTENT",totalSeconds:90,blocks:[]});
	});
	it("按原桶核对片段，并把同一连续活动的相邻小时片段临时拼接", () => {
		const activity = data();
		activity.timeline!.segments = [
			segment("s1", "临床/甲.md", 9, Date.UTC(2026, 10, 14, 1), Date.UTC(2026, 10, 14, 1, 1), 60),
			segment("s2", "临床/甲.md", 9, Date.UTC(2026, 10, 14, 1, 1), Date.UTC(2026, 10, 14, 1, 2), 60),
		];
		const day = buildActivityTimelineDay([{ id: "local", data: activity }], { date: DATE, groupingRoot: "临床", depth: 1 }, NOW);
		expect(day.precision).toBe("DETAILED");
		expect(day.totalSeconds).toBe(120);
		expect(day.locatedSeconds).toBe(120);
		expect(day.blocks).toHaveLength(1);
		expect(day.blocks[0].segmentIds).toEqual(["s1", "s2"]);
		expect(day.blocks[0].startMinute).toBe(540);
		expect(day.blocks[0].endMinute).toBe(542);
		expect(day.blocks[0].groupName).toBe("根目录直属笔记");
	});

	it("旧桶只有汇总，混合来源不伪造片段且明确未定位时长", () => {
		const legacy = data("临床/旧.md", 60);
		delete (legacy as { timeline?: unknown }).timeline;
		const detailed = data("临床/新.md", 30);
		detailed.timeline!.segments = [segment("s", "临床/新.md", 9, Date.UTC(2026, 10, 14, 1), Date.UTC(2026, 10, 14, 1, 0, 30), 30)];
		const day = buildActivityTimelineDay([
			{ id: "old", data: legacy },
			{ id: "new", data: detailed },
		], { date: DATE }, NOW);
		expect(day.precision).toBe("MIXED");
		expect(day.totalSeconds).toBe(90);
		expect(day.locatedSeconds).toBe(30);
		expect(day.unlocatedSeconds).toBe(60);
		expect(day.blocks).toHaveLength(1);
		expect(day.warnings).toContain("已有部分记录无法定位");
	});

	it("同 ID 同内容只绘制一次，冲突明细隔离且目录筛选排除 YOLO", () => {
		const first = data("临床/甲.md", 30);
		first.timeline!.segments = [segment("same", "临床/甲.md", 9, Date.UTC(2026, 10, 14, 1), Date.UTC(2026, 10, 14, 1, 0, 30), 30)];
		const duplicate = data("临床/甲.md", 30);
		duplicate.timeline!.segments = [segment("same", "临床/甲.md", 9, Date.UTC(2026, 10, 14, 1), Date.UTC(2026, 10, 14, 1, 0, 30), 30)];
		const conflict = data("临床/乙.md", 10);
		conflict.timeline!.segments = [segment("same", "临床/乙.md", 9, Date.UTC(2026, 10, 14, 1), Date.UTC(2026, 10, 14, 1, 0, 10), 10)];
		const yolo = data("activity://yolo-chat", 10);
		yolo.timeline!.segments = [segment("yolo", "activity://yolo-chat", 9, Date.UTC(2026, 10, 14, 1), Date.UTC(2026, 10, 14, 1, 0, 10), 10)];
		const day = buildActivityTimelineDay([
			{ id: "a", data: first }, { id: "b", data: duplicate }, { id: "c", data: conflict }, { id: "y", data: yolo },
		], { date: DATE, folders: ["临床"] }, NOW);
		expect(day.precision).toBe("INCONSISTENT");
		expect(day.blocks).toHaveLength(0);
		expect(day.warnings).toContain("明细存在冲突，无法完整核对");
		expect(day.totalSeconds).toBe(70);
	});

	it("已有超前桶和片段保留，只提示未来时间而不延伸片段", () => {
		const activity = data("临床/未来.md", 30);
		activity.timeline!.segments = [segment("future", "临床/未来.md", 9, Date.UTC(2026, 10, 14, 1), Date.UTC(2026, 10, 14, 1, 0, 30), 30)];
		const day = buildActivityTimelineDay([{ id: "future", data: activity }], { date: DATE }, Date.UTC(2026, 10, 14, 0));
		expect(day.blocks).toHaveLength(1);
		expect(day.precision).toBe("DETAILED");
		expect(day.warnings).toContain("存在未来时段记录，请核对日期／时区");
		expect(day.blocks[0].endMinute).toBe(540.5);
	});
});
