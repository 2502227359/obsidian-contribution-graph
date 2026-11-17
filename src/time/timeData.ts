import {
	areFoldersCoveredByScope,
	isFileInTrackedFolders,
	migrateTrackedFilePaths,
	normalizeTrackedFolderPath,
	normalizeTrackedFiles,
	normalizeTrackedFolders,
} from "../activity/folderScope";
import { isValidFormattedDate } from "../util/dateUtils";
import { isYoloChatActivity } from "./timeActivitySource";
import { normalizeActivityTimeline } from "./activityTimelineFormat";
import {
	StoredTimeActivity,
	TimeBucket,
	TimeCoveragePeriod,
	TimeDocumentStats,
	TimeSpan,
	TimeStats,
	TimeStatsQuery,
	TimeTrackingState,
} from "./types";
import type { TimelineRecordingPeriod } from "./activityTimelineTypes";

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_IDLE_TIMEOUT_MINUTES = 10080;

export interface TimeActivityKey {
	date: string;
	hour: number;
}

export interface TimeSpanSegment extends TimeActivityKey {
	bucketKey: string;
	offsetMinutes: number;
	start: number;
	end: number;
	seconds: number;
}

export function createEmptyTimeActivity(): StoredTimeActivity {
	return {
		buckets: Object.create(null),
		periods: [],
		policyChanges: [],
	};
}

export function addTimeSpan(data: StoredTimeActivity, span: TimeSpan): TimeActivityKey[] {
	return applyTimeSpan(data, span, 1);
}

export function removeTimeSpan(data: StoredTimeActivity, span: TimeSpan): TimeActivityKey[] {
	return applyTimeSpan(data, span, -1);
}

function applyTimeSpan(data: StoredTimeActivity, span: TimeSpan, direction: 1 | -1): TimeActivityKey[] {
	const changed = new Map<string, TimeActivityKey>();
	for (const segment of splitTimeSpan(span)) {
		const key = { date: segment.date, hour: segment.hour };
		if (updateBucketSeconds(data, new Date(segment.start), span.path, segment.seconds * direction)) {
			changed.set(`${key.date}T${String(key.hour).padStart(2, "0")}`, key);
		}
	}
	return [...changed.values()];
}

export function splitTimeSpan(span: TimeSpan): TimeSpanSegment[] {
	if (!isValidTimeSpan(span) || span.seconds <= 0) return [];
	const totalMilliseconds = span.end - span.start;
	let remainingSeconds = span.seconds;
	let cursor = span.start;
	const result: TimeSpanSegment[] = [];
	while (cursor < span.end) {
		const date = new Date(cursor);
		const end = getSpanSegmentEnd(date, cursor, span.end);
		const seconds = end === span.end
			? remainingSeconds
			: span.seconds * (end - cursor) / totalMilliseconds;
		const dateValue = formatDate(date);
		const hour = date.getHours();
		const offsetMinutes = -date.getTimezoneOffset();
		result.push({
			bucketKey: formatBucketKey(dateValue, hour, offsetMinutes),
			date: dateValue, hour, offsetMinutes, start: cursor, end, seconds,
		});
		remainingSeconds -= seconds;
		cursor = end;
	}
	return result;
}

export function queryTimeStats(
	data: StoredTimeActivity,
	query: TimeStatsQuery,
	now: number,
	hourly: boolean
): TimeStats[] {
	const folders = normalizeTrackedFolders(query.folders || []);
	const grouped = new Map<string, TimeStats>();
	for (const bucket of Object.values(data.buckets)) {
		if (
			(query.fromDate && bucket.date < query.fromDate) ||
			(query.toDate && bucket.date > query.toDate)
		) {
			continue;
		}
		const documents = getFilteredDocuments(bucket, folders);
		if (documents.length === 0) {
			continue;
		}
		const key = hourly ? `${bucket.date}/${bucket.hour}` : bucket.date;
		const existing = grouped.get(key);
		if (existing) {
			existing.seconds += sumDocuments(documents);
			mergeDocuments(existing.documents, documents);
			continue;
		}
		const bounds = getBucketBounds(data, bucket, hourly);
		const start = bounds.start;
		const end = bounds.end;
		grouped.set(
			key,
			createTimeStat({ data, bucket, documents, folders, now, hourly, start, end })
		);
	}
	return Array.from(grouped.values()).sort((left, right) =>
		left.date.localeCompare(right.date) || (left.hour ?? -1) - (right.hour ?? -1)
	);
}

export function getTimeTrackingState(
	data: StoredTimeActivity,
	start: number,
	end: number,
	folders: readonly string[],
	now: number
): TimeTrackingState {
	if (start > now) {
		return "UNTRACKED";
	}
	const requested = normalizeTrackedFolders(folders);
	const relevant = data.periods.filter((period) =>
		periodCoversFolders(period, requested)
	);
	let coveredSeconds = 0;
	let currentStart = 0;
	let currentEnd = 0;
	for (const period of relevant.sort((a, b) => a.start - b.start)) {
		const periodEnd = period.end ?? now;
		const overlapStart = Math.max(start, period.start);
		const overlapEnd = Math.min(end, periodEnd);
		if (overlapEnd <= overlapStart) {
			continue;
		}
		if (currentEnd === 0) {
			currentStart = overlapStart;
			currentEnd = overlapEnd;
		} else if (overlapStart <= currentEnd) {
			currentEnd = Math.max(currentEnd, overlapEnd);
		} else {
			coveredSeconds += currentEnd - currentStart;
			currentStart = overlapStart;
			currentEnd = overlapEnd;
		}
	}
	if (currentEnd > currentStart) {
		coveredSeconds += currentEnd - currentStart;
	}
	const requiredSeconds = Math.max(0, end - start);
	return coveredSeconds >= requiredSeconds
		? "TRACKED"
		: coveredSeconds > 0
			? "PARTIAL"
			: "UNTRACKED";
}

export function normalizeTimeActivity(
	raw: unknown,
	strict: boolean,
	detailStrict = strict
): StoredTimeActivity {
	const result = createEmptyTimeActivity();
	if (!raw || typeof raw !== "object") {
		if (strict) {
			throw new Error("时长活动数据无效");
		}
		return result;
	}
	const value = raw as Record<string, unknown>;
	if (value.buckets !== undefined) {
		if (!value.buckets || typeof value.buckets !== "object" || Array.isArray(value.buckets)) {
				if (strict) throw new Error("时长分桶数据无效");
		} else {
			for (const [key, candidate] of Object.entries(value.buckets)) {
				try {
					const bucket = normalizeBucket(key, candidate);
					result.buckets[key] = bucket;
				} catch (error) {
					if (strict) throw error;
				}
			}
		}
	}
	result.periods = normalizePeriods(value.periods, strict);
	result.policyChanges = normalizePolicyChanges(value.policyChanges, strict);
	const timeline = normalizeActivityTimeline(value.timeline, detailStrict);
	if (timeline) result.timeline = timeline;
	return result;
}

export function renameTimePaths(
	data: StoredTimeActivity,
	oldPath: string,
	newPath: string,
	isFolder: boolean
): boolean {
	const oldNormalized = normalizeTrackedFolderPath(oldPath);
	const newNormalized = normalizeTrackedFolderPath(newPath);
	if (!oldNormalized || !newNormalized || DANGEROUS_KEYS.has(newNormalized)) {
		return false;
	}
	const prefix = `${oldNormalized}/`;
	let changed = false;
	for (const segment of data.timeline?.segments || []) {
		const target = mapRenamedPath(segment.path, oldNormalized, newNormalized, prefix, isFolder);
		if (target !== segment.path) changed = true;
		segment.path = target;
	}
	for (const bucket of Object.values(data.buckets)) {
		const next: Record<string, number> = Object.create(null);
		for (const [path, seconds] of Object.entries(bucket.documents)) {
			const target = mapRenamedPath(
				path,
				oldNormalized,
				newNormalized,
				prefix,
				isFolder
			);
			if (target !== path) changed = true;
			next[target] = (next[target] || 0) + seconds;
		}
		bucket.documents = next;
	}
	changed = renameTimePeriods(
		[...data.periods, ...(data.timeline?.recordingPeriods || [])],
		oldNormalized,
		newNormalized,
		isFolder,
		prefix
	) || changed;
	return changed;
}

function renameTimePeriods(
	periods: Array<TimeCoveragePeriod | TimelineRecordingPeriod>,
	oldPath: string,
	newPath: string,
	isFolder: boolean,
	prefix: string
): boolean {
	let changed = false;
	for (const period of periods) {
		const originalFolders = period.folders;
		const nextFolders = normalizeTrackedFolders(originalFolders.map(folder => mapRenamedFolder(folder, oldPath, newPath, prefix, isFolder)));
		if (isFolder && (originalFolders.length !== nextFolders.length || originalFolders.some((folder, index) => folder !== nextFolders[index]))) changed = true;
		period.folders = nextFolders;
		if (!period.files?.length) continue;
		const originalFiles = period.files;
		const nextFiles = migrateTrackedFilePaths(originalFiles, oldPath, newPath, isFolder);
		if (originalFiles.length !== nextFiles.length || originalFiles.some((file, index) => file !== nextFiles[index])) changed = true;
		if (nextFiles.length) period.files = nextFiles;
		else delete period.files;
	}
	return changed;
}

function mapRenamedPath(
	path: string,
	oldPath: string,
	newPath: string,
	prefix: string,
	isFolder: boolean
): string {
	if (isYoloChatActivity(path)) return path;
	if (!isFolder) {
		return path === oldPath ? newPath : path;
	}
	return path.startsWith(prefix)
		? `${newPath}/${path.slice(prefix.length)}`
		: path;
}

function mapRenamedFolder(
	folder: string,
	oldPath: string,
	newPath: string,
	prefix: string,
	isFolder: boolean
): string {
	if (!isFolder || (folder !== oldPath && !folder.startsWith(prefix))) {
		return folder;
	}
	return folder === oldPath
		? newPath
		: `${newPath}/${folder.slice(prefix.length)}`;
}

export function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) {
		return "0 分钟";
	}
	if (seconds < 60) {
		return "少于 1 分钟";
	}
	const totalMinutes = Math.floor(seconds / 60);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	const parts: string[] = [];
	if (hours > 0) parts.push(`${hours} 小时`);
	if (minutes > 0) parts.push(`${minutes} 分钟`);
	return parts.join(" ");
}

function isValidTimeSpan(span: TimeSpan): boolean {
	return Boolean(
		span &&
		span.path &&
		!DANGEROUS_KEYS.has(span.path) &&
		Number.isFinite(span.start) &&
		Number.isFinite(span.end) &&
		Number.isFinite(span.seconds) &&
		span.seconds >= 0 &&
		span.end > span.start
	);
}

function getSpanSegmentEnd(date: Date, start: number, end: number): number {
	const boundary = new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
		date.getHours() + 1,
		0,
		0,
		0
	).getTime();
	return Math.min(end, boundary > start ? boundary : end);
}

function updateBucketSeconds(
	data: StoredTimeActivity,
	date: Date,
	path: string,
	seconds: number
): boolean {
	const key = getBucketKey(date);
	if (seconds < 0 && !data.buckets[key]?.documents[path]) return false;
	const bucket =
		data.buckets[key] ||
		(data.buckets[key] = {
			date: formatDate(date),
			hour: date.getHours(),
			offsetMinutes: -date.getTimezoneOffset(),
			documents: Object.create(null),
		});
	const next = (bucket.documents[path] || 0) + seconds;
	// 合并与整段撤回的浮点舍入可能留下不足一纳秒的残值。
	if (seconds < 0 && next < 1e-9) {
		delete bucket.documents[path];
		if (Object.keys(bucket.documents).length === 0) delete data.buckets[key];
	} else {
		bucket.documents[path] = next;
	}
	return true;
}

function getFilteredDocuments(
	bucket: TimeBucket,
	folders: readonly string[]
): TimeDocumentStats[] {
	return Object.entries(bucket.documents)
		.filter(([path, seconds]) =>
			Number.isFinite(seconds) &&
			seconds > 0 &&
			isFileInTrackedFolders(path, folders)
		)
		.map(([path, seconds]) => ({ path, seconds }))
		.sort((left, right) => right.seconds - left.seconds || left.path.localeCompare(right.path));
}

function sumDocuments(documents: TimeDocumentStats[]): number {
	return documents.reduce((sum, item) => sum + item.seconds, 0);
}

function createTimeStat(
	context: {
		data: StoredTimeActivity;
		bucket: TimeBucket;
		documents: TimeDocumentStats[];
		folders: string[];
		now: number;
		hourly: boolean;
		start: number;
		end: number;
	}
): TimeStats {
	const { data, bucket, documents, folders, now, hourly, start, end } = context;
	return {
		date: bucket.date,
		...(hourly ? { hour: bucket.hour } : {}),
		seconds: sumDocuments(documents),
		documents,
		trackingState: getTimeTrackingState(data, start, end, folders, now),
		future: start > now,
		policyChanged: hasPolicyChange(data, start, end),
	};
}

function getBucketKey(date: Date): string {
	const offset = -date.getTimezoneOffset();
	return formatBucketKey(formatDate(date), date.getHours(), offset);
}

function formatBucketKey(date: string, hour: number, offsetMinutes: number): string {
	const sign = offsetMinutes >= 0 ? "+" : "-";
	return `${date}T${String(hour).padStart(2, "0")}-${sign}${Math.abs(offsetMinutes)}`;
}

function formatDate(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getBucketBounds(
	data: StoredTimeActivity,
	bucket: TimeBucket,
	hourly: boolean
): { start: number; end: number } {
	const start = localDateTimeToEpoch(bucket.date, hourly ? bucket.hour : 0, bucket.offsetMinutes);
	if (hourly) {
		const next = getNextLocalHour(bucket.date, bucket.hour);
		const nextBucket = Object.values(data.buckets).find(
			(candidate) => candidate.date === next.date && candidate.hour === next.hour
		);
		return {
			start,
			end: nextBucket
				? localDateTimeToEpoch(next.date, next.hour, nextBucket.offsetMinutes)
				: start + 60 * 60 * 1000,
		};
	}
	const nextDate = getNextLocalDate(bucket.date);
	const nextBucket = Object.values(data.buckets).find(
		(candidate) => candidate.date === nextDate
	);
	return {
		start,
		end: localDateTimeToEpoch(
			nextDate,
			0,
			nextBucket?.offsetMinutes ?? bucket.offsetMinutes
		),
	};
}

function localDateTimeToEpoch(date: string, hour: number, offsetMinutes: number): number {
	const [year, month, day] = date.split("-").map(Number);
	return Date.UTC(year, month - 1, day, hour) - offsetMinutes * 60 * 1000;
}

export function getNextLocalDate(date: string): string {
	const [year, month, day] = date.split("-").map(Number);
	const next = new Date(Date.UTC(year, month - 1, day + 1));
	return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function getNextLocalHour(date: string, hour: number): { date: string; hour: number } {
	return hour < 23
		? { date, hour: hour + 1 }
		: { date: getNextLocalDate(date), hour: 0 };
}

function mergeDocuments(target: TimeDocumentStats[], source: TimeDocumentStats[]): void {
	const merged = new Map(target.map((item) => [item.path, item.seconds]));
	for (const item of source) merged.set(item.path, (merged.get(item.path) || 0) + item.seconds);
	target.splice(0, target.length, ...Array.from(merged.entries())
		.map(([path, seconds]) => ({ path, seconds }))
		.sort((left, right) => right.seconds - left.seconds || left.path.localeCompare(right.path)));
}

function periodCoversFolders(period: TimeCoveragePeriod, requested: string[]): boolean {
	return areFoldersCoveredByScope(requested, period.folders, period.files || []);
}

function hasPolicyChange(data: StoredTimeActivity, start: number, end: number): boolean {
	return data.policyChanges.some((change) => change.at > start && change.at < end);
}

function normalizeBucket(key: string, candidate: unknown): TimeBucket {
	if (!candidate || typeof candidate !== "object") throw new Error("时长分桶无效");
	const value = candidate as Record<string, unknown>;
	const date = value.date;
	const hour = value.hour;
	const offsetMinutes = value.offsetMinutes;
	if (
		typeof date !== "string" ||
		!isValidFormattedDate(date) ||
		!Number.isInteger(hour) || (hour as number) < 0 || (hour as number) > 23 ||
		!Number.isInteger(offsetMinutes) ||
		(offsetMinutes as number) < -840 ||
		(offsetMinutes as number) > 840
	) throw new Error("时长分桶字段无效");
	if (key !== formatBucketKey(date as string, hour as number, offsetMinutes as number)) {
		throw new Error("时长分桶键无效");
	}
	const documents: Record<string, number> = Object.create(null);
	if (!value.documents || typeof value.documents !== "object" || Array.isArray(value.documents)) {
		throw new Error("时长分桶文档数据无效");
	}
	for (const [path, seconds] of Object.entries(value.documents as Record<string, unknown>)) {
		if (DANGEROUS_KEYS.has(path)) continue;
		if (!Number.isFinite(seconds) || (seconds as number) < 0) throw new Error("时长数值无效");
		documents[path] = seconds as number;
	}
	return { date, hour: hour as number, offsetMinutes: offsetMinutes as number, documents };
}

function normalizePeriods(raw: unknown, strict: boolean): TimeCoveragePeriod[] {
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) {
		if (strict) throw new Error("时长覆盖周期无效");
		return [];
	}
	const periods: TimeCoveragePeriod[] = [];
	for (const candidate of raw) {
		try {
			const period = normalizeTimePeriod(candidate);
			if (period) periods.push(period);
		} catch (error) {
			if (strict) throw error;
		}
	}
	return periods;
}

function normalizeTimePeriod(candidate: unknown): TimeCoveragePeriod | undefined {
	if (!candidate || typeof candidate !== "object") throw new Error("时长覆盖周期无效");
	const value = candidate as Record<string, unknown>;
	if (!Number.isFinite(value.start) || (value.start as number) < 0) {
		throw new Error("时长覆盖起点无效");
	}
	if (
		value.end !== undefined &&
		(!Number.isFinite(value.end) || (value.end as number) < (value.start as number))
	) {
		throw new Error("时长覆盖终点无效");
	}
	if (value.end !== undefined && value.end === value.start) {
		return undefined;
	}
	if (
		!Array.isArray(value.folders) ||
		value.folders.some((folder) => typeof folder !== "string")
	) {
		throw new Error("时长覆盖文件夹无效");
	}
	const files = normalizePeriodFiles(value.files);
	return {
		start: value.start as number,
		...(value.end === undefined ? {} : { end: value.end as number }),
		folders: normalizeTrackedFolders(value.folders as string[]),
		...(files.length ? { files } : {}),
	};
}

function normalizePeriodFiles(raw: unknown): string[] {
	if (raw === undefined) return [];
	if (!Array.isArray(raw) || raw.some(file => typeof file !== "string" || normalizeTrackedFiles([file]).length === 0)) {
		throw new Error("时长覆盖指定笔记无效");
	}
	return normalizeTrackedFiles(raw as string[]);
}

function normalizePolicyChanges(raw: unknown, strict: boolean) {
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) {
		if (strict) throw new Error("时长策略变更无效");
		return [];
	}
	return raw.flatMap((candidate) => {
		try {
			if (!candidate || typeof candidate !== "object") throw new Error("时长策略变更无效");
			const value = candidate as Record<string, unknown>;
			if (!Number.isFinite(value.at) || (value.at as number) < 0 || !Number.isSafeInteger(value.idleTimeoutMinutes) || (value.idleTimeoutMinutes as number) < 1 || (value.idleTimeoutMinutes as number) > MAX_IDLE_TIMEOUT_MINUTES) throw new Error("时长策略变更无效");
			return [{ at: value.at as number, idleTimeoutMinutes: value.idleTimeoutMinutes as number }];
		} catch (error) {
			if (strict) throw error;
			return [];
		}
	});
}
