import { describe, expect, it } from "vitest";
import {
	applyActivityTimelineSpan,
	closeTimelineRecordingPeriod,
	ensureTimelineRecordingPeriod,
} from "../src/time/activityTimeline";
import { normalizeActivityTimeline } from "../src/time/activityTimelineFormat";
import { createEmptyTimeActivity } from "../src/time/timeData";
import { TimeSpan } from "../src/time/types";

const at = Date.UTC(2026, 0, 1, 9);
const timelineSpan = (start: number, end: number, continuityId = "continuity-1"): TimeSpan => ({
	path: "Notes/a.md", start, end, seconds: (end - start) / 1000, continuityId,
});

describe("学习时间轴明细", () => {
	it("记录周期可复用，关闭后才创建新的周期", () => {
		const data = createEmptyTimeActivity();
		const id = ensureTimelineRecordingPeriod(data, at, ["Notes"]);
		expect(ensureTimelineRecordingPeriod(data, at + 1000, ["Notes"])).toBe(id);
		closeTimelineRecordingPeriod(data, at + 2000);
		const next = ensureTimelineRecordingPeriod(data, at + 3000, ["Notes"]);
		expect(next).not.toBe(id);
		expect(data.timeline?.recordingPeriods).toMatchObject([
			{ id, start: at, end: at + 2000, folders: ["Notes"] },
			{ id: next, start: at + 3000, folders: ["Notes"] },
		]);
	});

	it("跨小时片段按桶原子存储，相邻同身份延长，撤回只修改尾部", () => {
		const data = createEmptyTimeActivity();
		const periodId = ensureTimelineRecordingPeriod(data, at, ["Notes"]);
		applyActivityTimelineSpan(data, timelineSpan(at + 59 * 60 * 1000, at + 61 * 60 * 1000), "add", periodId);
		expect(data.timeline?.segments).toHaveLength(2);
		const firstId = data.timeline?.segments[0].id;
		applyActivityTimelineSpan(data, timelineSpan(at + 61 * 60 * 1000, at + 62 * 60 * 1000), "add", periodId);
		expect(data.timeline?.segments).toHaveLength(2);
		expect(data.timeline?.segments.find(segment => segment.id === firstId)?.end).toBe(at + 60 * 60 * 1000);
		applyActivityTimelineSpan(data, timelineSpan(at + 60 * 60 * 1000, at + 62 * 60 * 1000), "remove", periodId);
		expect(data.timeline?.segments).toHaveLength(1);
		expect(data.timeline?.segments[0].end).toBe(at + 60 * 60 * 1000);
	});

	it("没有连续身份的旧片段只保留原桶，不伪造明细", () => {
		const data = createEmptyTimeActivity();
		const periodId = ensureTimelineRecordingPeriod(data, at, []);
		applyActivityTimelineSpan(data, { path: "old.md", start: at, end: at + 1000, seconds: 1 }, "add", periodId);
		expect(data.timeline?.segments).toEqual([]);
	});

	it("宽松规范化隔离坏片段，严格规范化拒绝坏片段", () => {
		const raw = {
			formatVersion: 1,
			segments: [{ id: "bad", continuityId: "c", recordingPeriodId: "p", path: "a.md", bucketKey: "bad", start: 10, end: 9, seconds: 1 }],
			recordingPeriods: [{ id: "p", start: 10, folders: [] }],
		};
		const normalized = normalizeActivityTimeline(raw, false);
		expect(normalized?.segments).toEqual([]);
		expect(normalized?.issues?.length).toBeGreaterThan(0);
		expect(() => normalizeActivityTimeline(raw, true)).toThrow();
	});

	it("组合边界拒绝非法桶键和墙钟时长，未知版本隔离为空明细", () => {
		const raw = {
			formatVersion: 1,
			recordingPeriods: [{ id: "p", start: at, folders: [] }],
			segments: [{ id: "s", continuityId: "c", recordingPeriodId: "p", path: "a.md",
				bucketKey: "2026-02-31T09-+480", start: at, end: at + 1000, seconds: 3600 }],
		};
		expect(normalizeActivityTimeline(raw, false)?.segments).toEqual([]);
		expect(() => normalizeActivityTimeline(raw, true)).toThrow();
		const unknown = normalizeActivityTimeline({ ...raw, formatVersion: 99 }, false);
		expect(unknown?.segments).toEqual([]);
		expect(unknown?.issues).toContain("时间轴版本无效");
		expect(normalizeActivityTimeline(null, false)?.issues).toContain("时间轴明细无效");
	});
});
