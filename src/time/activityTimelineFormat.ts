import { normalizeTrackedFiles, normalizeTrackedFolders } from "../activity/folderScope";
import { isValidFormattedDate } from "../util/dateUtils";
import type { ActivitySegment, StoredActivityTimeline, TimelineRecordingPeriod } from "./activityTimelineTypes";

const SEGMENT_SECONDS_TOLERANCE = 0.001;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function normalizeActivityTimeline(
	raw: unknown,
	strict: boolean
): StoredActivityTimeline | undefined {
	if (raw === undefined) return undefined;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		if (strict) throw new Error("时间轴明细无效");
		return emptyTimeline(["时间轴明细无效"]);
	}
	const value = raw as Record<string, unknown>;
	const issues = readIssues(value.issues, strict);
	if (value.formatVersion !== 1) {
		if (strict) throw new Error("时间轴版本无效");
		issues.push("时间轴版本无效");
		return emptyTimeline(issues);
	}
	const periods = normalizeRecordingPeriods(value.recordingPeriods, strict, issues);
	const periodIds = new Set(periods.map(period => period.id));
	const segments = normalizeSegments(value.segments, strict, issues, periodIds);
	return {
		formatVersion: 1,
		segments,
		recordingPeriods: periods,
		...(issues.length ? { issues } : {}),
	};
}

function emptyTimeline(issues: string[]): StoredActivityTimeline {
	return { formatVersion: 1, segments: [], recordingPeriods: [], issues: [...new Set(issues)] };
}

function readIssues(raw: unknown, strict: boolean): string[] {
	if (raw === undefined) return [];
	if (!Array.isArray(raw) || raw.some(issue => typeof issue !== "string")) {
		if (strict) throw new Error("时间轴问题记录无效");
		return ["时间轴问题记录无效"];
	}
	return [...new Set(raw)];
}

function normalizeRecordingPeriods(
	raw: unknown,
	strict: boolean,
	issues: string[]
): TimelineRecordingPeriod[] {
	if (!Array.isArray(raw)) return invalidCollection(strict, issues, "时间轴记录周期无效");
	const seen = new Set<string>();
	return raw.flatMap((candidate, index) => {
		try {
			const period = normalizePeriod(candidate);
			if (seen.has(period.id)) throw new Error("时间轴记录周期重复");
			seen.add(period.id);
			return [period];
		} catch (error) {
			return handleInvalid(strict, issues, `记录周期${index}无效`, error);
		}
	});
}

function normalizeSegments(
	raw: unknown,
	strict: boolean,
	issues: string[],
	periodIds: Set<string>
): ActivitySegment[] {
	if (!Array.isArray(raw)) return invalidCollection(strict, issues, "时间轴片段无效");
	const seen = new Set<string>();
	return raw.flatMap((candidate, index) => {
		try {
			const segment = normalizeSegment(candidate, periodIds);
			if (seen.has(segment.id)) throw new Error("时间轴片段重复");
			seen.add(segment.id);
			return [segment];
		} catch (error) {
			return handleInvalid(strict, issues, `时间轴片段${index}无效`, error);
		}
	});
}

function invalidCollection<T>(strict: boolean, issues: string[], message: string): T[] {
	if (strict) throw new Error(message);
	issues.push(message);
	return [];
}

function handleInvalid<T>(strict: boolean, issues: string[], message: string, error: unknown): T[] {
	if (strict) throw error;
	issues.push(message);
	return [];
}

function normalizePeriod(candidate: unknown): TimelineRecordingPeriod {
	if (!candidate || typeof candidate !== "object") throw new Error("记录周期字段无效");
	const value = candidate as Record<string, unknown>;
	if (typeof value.id !== "string" || !value.id || !Number.isFinite(value.start) || (value.start as number) < 0) {
		throw new Error("记录周期字段无效");
	}
	if (value.end !== undefined && (!Number.isFinite(value.end) || (value.end as number) < (value.start as number))) {
		throw new Error("记录周期终点无效");
	}
	if (!Array.isArray(value.folders) || value.folders.some(folder => typeof folder !== "string")) {
		throw new Error("记录周期文件夹无效");
	}
	const files = normalizePeriodFiles(value.files);
	return {
		id: value.id,
		start: value.start as number,
		...(value.end === undefined ? {} : { end: value.end as number }),
		folders: normalizeTrackedFolders(value.folders as string[]),
		...(files.length ? { files } : {}),
	};
}

function normalizePeriodFiles(raw: unknown): string[] {
	if (raw === undefined) return [];
	if (!Array.isArray(raw) || raw.some(file => typeof file !== "string" || normalizeTrackedFiles([file]).length === 0)) {
		throw new Error("记录周期指定笔记无效");
	}
	return normalizeTrackedFiles(raw as string[]);
}

function normalizeSegment(candidate: unknown, periodIds: Set<string>): ActivitySegment {
	if (!candidate || typeof candidate !== "object") throw new Error("片段字段无效");
	const value = candidate as Record<string, unknown>;
	const fields = ["id", "continuityId", "recordingPeriodId", "path", "bucketKey"];
	if (fields.some(field => typeof value[field] !== "string" || !value[field])) throw new Error("片段字段无效");
	if (DANGEROUS_KEYS.has(value.path as string)) throw new Error("片段路径无效");
	if (!periodIds.has(value.recordingPeriodId as string)) throw new Error("片段记录周期不存在");
	if (!isValidBucketKey(value.bucketKey as string)) throw new Error("片段桶键无效");
	if (!Number.isFinite(value.start) || (value.start as number) < 0 || !Number.isFinite(value.end) || (value.end as number) <= (value.start as number) || !Number.isFinite(value.seconds) || (value.seconds as number) <= 0) {
		throw new Error("片段数值无效");
	}
	const durationSeconds = ((value.end as number) - (value.start as number)) / 1000;
	if (Math.abs(durationSeconds - (value.seconds as number)) > SEGMENT_SECONDS_TOLERANCE) {
		throw new Error("片段时长与墙钟区间不一致");
	}
	return {
		id: value.id as string, continuityId: value.continuityId as string,
		recordingPeriodId: value.recordingPeriodId as string, path: value.path as string,
		bucketKey: value.bucketKey as string, start: value.start as number,
		end: value.end as number, seconds: value.seconds as number,
	};
}

function isValidBucketKey(key: string): boolean {
	const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-([+-])(\d{1,3})$/.exec(key);
	if (!match) return false;
	const date = match[1];
	const hour = Number(match[2]);
	const offset = (match[3] === "-" ? -1 : 1) * Number(match[4]);
	return isValidFormattedDate(date) && Number.isInteger(hour) && hour >= 0 && hour <= 23 &&
		Number.isInteger(offset) && offset >= -840 && offset <= 840 &&
		formatBucketKey(date, hour, offset) === key;
}

function formatBucketKey(date: string, hour: number, offsetMinutes: number): string {
	const sign = offsetMinutes >= 0 ? "+" : "-";
	return `${date}T${String(hour).padStart(2, "0")}-${sign}${Math.abs(offsetMinutes)}`;
}
