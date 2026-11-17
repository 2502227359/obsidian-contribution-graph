import { normalizeTrackedFolders } from "../activity/folderScope";
import { splitTimeSpan } from "./timeData";
import type {
	ActivitySegment,
	StoredActivityTimeline,
} from "./activityTimelineTypes";
import type { StoredTimeActivity, TimeSpan } from "./types";

const EPSILON = 1e-9;

export function ensureTimelineRecordingPeriod(
	data: StoredTimeActivity,
	at: number,
	folders: readonly string[]
): string {
	if (!Number.isFinite(at) || at < 0) throw new RangeError("记录周期起点无效");
	const timeline = data.timeline || createTimeline(data);
	const normalized = normalizeTrackedFolders([...folders]);
	const current = timeline.recordingPeriods[timeline.recordingPeriods.length - 1];
	if (current && current.end === undefined && sameFolders(current.folders, normalized)) {
		return current.id;
	}
	if (current && current.end === undefined) current.end = Math.max(current.start, at);
	const period = { id: newId(), start: at, folders: normalized };
	timeline.recordingPeriods.push(period);
	return period.id;
}

export function closeTimelineRecordingPeriod(data: StoredTimeActivity, at: number): void {
	const timeline = data.timeline;
	if (!timeline || !Number.isFinite(at)) return;
	const current = timeline.recordingPeriods[timeline.recordingPeriods.length - 1];
	if (current && current.end === undefined) current.end = Math.max(current.start, at);
}

export function applyActivityTimelineSpan(
	data: StoredTimeActivity,
	span: TimeSpan,
	operation: "add" | "remove",
	periodId: string
): void {
	if (!periodId || !isValidSpan(span)) return;
	if (!data.timeline) {
		if (!span.continuityId) return;
		data.timeline = createTimeline(data);
	}
	const timeline = data.timeline;
	if (!timeline.recordingPeriods.some(period => period.id === periodId)) {
		addIssue(timeline, `缺少记录周期:${periodId}`);
		return;
	}
	if (!span.continuityId) return;
	const pieces = splitTimeSpan(span);
	if (operation === "add") {
		for (const piece of pieces) addSegment(timeline, span, piece, periodId);
		return;
	}
	for (const piece of [...pieces].reverse()) removeSegment(timeline, span, piece, periodId);
}

function createTimeline(data: StoredTimeActivity): StoredActivityTimeline {
	return data.timeline = { formatVersion: 1, segments: [], recordingPeriods: [] };
}

function newId(): string {
	return crypto.randomUUID();
}

function sameFolders(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((folder, index) => folder === right[index]);
}

function isValidSpan(span: TimeSpan): boolean {
	return Boolean(
		span.path && span.continuityId && Number.isFinite(span.start) && span.start >= 0 &&
		Number.isFinite(span.end) && span.end > span.start &&
		Number.isFinite(span.seconds) && span.seconds > 0
	);
}

function addSegment(
	timeline: StoredActivityTimeline,
	span: TimeSpan,
	piece: { bucketKey: string; start: number; end: number; seconds: number },
	periodId: string
): void {
	const existing = [...timeline.segments].reverse().find(segment =>
		segment.continuityId === span.continuityId && segment.recordingPeriodId === periodId &&
		segment.path === span.path && segment.bucketKey === piece.bucketKey &&
		Math.abs(segment.end - piece.start) <= EPSILON
	);
	if (existing) {
		existing.end = piece.end;
		existing.seconds += piece.seconds;
		return;
	}
	timeline.segments.push({
		id: newId(), continuityId: span.continuityId!, recordingPeriodId: periodId,
		path: span.path, bucketKey: piece.bucketKey, start: piece.start,
		end: piece.end, seconds: piece.seconds,
	});
}

function removeSegment(
	timeline: StoredActivityTimeline,
	span: TimeSpan,
	piece: { bucketKey: string; start: number; end: number; seconds: number },
	periodId: string
): void {
	const index = timeline.segments.findIndex(segment =>
		segment.continuityId === span.continuityId && segment.recordingPeriodId === periodId &&
		segment.path === span.path && segment.bucketKey === piece.bucketKey &&
		Math.abs(segment.end - piece.end) <= EPSILON && piece.start >= segment.start - EPSILON
	);
	if (index < 0) {
		addIssue(timeline, `未找到可撤回片段:${span.path}:${piece.start}`);
		return;
	}
	const segment = timeline.segments[index];
	const nextSeconds = segment.seconds - piece.seconds;
	if (nextSeconds <= EPSILON || piece.start <= segment.start + EPSILON) {
		timeline.segments.splice(index, 1);
		return;
	}
	segment.end = piece.start;
	segment.seconds = nextSeconds;
}

function addIssue(timeline: StoredActivityTimeline, issue: string): void {
	if (!timeline.issues) timeline.issues = [];
	if (!timeline.issues.includes(issue)) timeline.issues.push(issue);
}
