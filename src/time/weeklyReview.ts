import { areFoldersCoveredByScope, isFileInTrackedFolders, normalizeTrackedFolderPath, normalizeTrackedFolders } from "../activity/folderScope";
import { diffCalendarDays, isValidFormattedDate, parseDate, toFormattedDate } from "../util/dateUtils";
import { isYoloChatActivity, YOLO_CHAT_ACTIVITY_LABEL } from "./timeActivitySource";
import { getTimeTrackingState } from "./timeData";
import type { StoredTimeActivity, TimeBucket, TimeDocumentStats } from "./types";
import type { WeeklyReviewComparison, WeeklyReviewDay, WeeklyReviewGoalState, WeeklyReviewGroup, WeeklyReviewQuery, WeeklyReviewSnapshot } from "./weeklyReviewTypes";

interface ReviewRange {
	now: number;
	today: string;
	weekStart: string;
	weekEnd: string;
	fromDate: string;
	root: string;
	isCurrentWeek: boolean;
}
interface DayIndex {
	documents: Map<string, number>;
	offsets: Set<number>;
	timezoneWarning: boolean;
}
interface ReviewIndex {
	days: Map<string, DayIndex>;
	folders: Set<string>;
	earliestDate: string;
}

export function shiftReviewDate(date: string, days: number): string {
	if (!isValidFormattedDate(date) || !Number.isSafeInteger(days)) throw new Error("周回顾日期无效");
	const result = parseDate(date);
	result.setDate(result.getDate() + days);
	return toFormattedDate(result);
}

export function getReviewWeekStart(date: string): string {
	if (!isValidFormattedDate(date)) throw new Error("周回顾日期无效");
	return shiftReviewDate(date, -((parseDate(date).getDay() + 6) % 7));
}

/** 从同一份合并统计生成脱离原存储的报告，不结算当前会话。 */
export function buildWeeklyReview(data: StoredTimeActivity, query: WeeklyReviewQuery, now: number): WeeklyReviewSnapshot {
	const range = createRange(query, now);
	const index = indexReviewData(data, range);
	const coverageData = reviewCoverageData(data, range);
	const days = reviewDays(range.weekStart, range, index, coverageData);
	const previousDays = reviewDays(range.fromDate, range, index, coverageData);
	const documents = sumReviewDocuments(days);
	return {
		generatedAt: now, today: range.today, weekStart: range.weekStart, weekEnd: range.weekEnd,
		isCurrentWeek: range.isCurrentWeek, root: range.root, days, documents,
		totalSeconds: documents.reduce((sum, item) => sum + item.seconds, 0),
		recordedDays: days.filter(day => day.seconds > 0).length,
		comparison: compareWeeks(data, coverageData, range, days, previousDays),
		earliestDate: index.earliestDate, folderPaths: [...index.folders].sort((a, b) => a.localeCompare(b)),
		warnings: reviewWarnings(days, range.root),
	};
}

function createRange(query: WeeklyReviewQuery, now: number): ReviewRange {
	const today = toFormattedDate(new Date(now));
	if (!isValidFormattedDate(today)) throw new Error("报告生成时间无效");
	const weekStart = getReviewWeekStart(query.date ?? today);
	if (weekStart > getReviewWeekStart(today)) throw new Error("不能查看未来周的回顾");
	return { now, today, weekStart, weekEnd: shiftReviewDate(weekStart, 6),
		fromDate: shiftReviewDate(weekStart, -7), root: normalizeTrackedFolderPath(query.root ?? ""),
		isCurrentWeek: weekStart === getReviewWeekStart(today) };
}

function indexReviewData(data: StoredTimeActivity, range: ReviewRange): ReviewIndex {
	const result: ReviewIndex = { days: new Map(), folders: new Set(), earliestDate: range.today };
	for (const bucket of Object.values(data.buckets)) indexReviewBucket(result, bucket, range);
	for (const period of data.periods) {
		const date = toFormattedDate(new Date(period.start));
		if (isValidFormattedDate(date) && date < result.earliestDate) result.earliestDate = date;
		for (const folder of period.folders) addFolderParents(result.folders, folder);
	}
	return result;
}

function indexReviewBucket(index: ReviewIndex, bucket: TimeBucket, range: ReviewRange): void {
	if (bucket.date < index.earliestDate) index.earliestDate = bucket.date;
	const inRange = bucket.date >= range.fromDate && bucket.date <= range.weekEnd;
	for (const [path, seconds] of Object.entries(bucket.documents)) {
		if (seconds <= 0) continue;
		if (!isYoloChatActivity(path)) addFolderParents(index.folders, path.replace(/\\/g, "/").split("/").slice(0, -1).join("/"));
		if (inRange && isFileInTrackedFolders(path, range.root ? [range.root] : [])) indexDocument(index, bucket, path, seconds);
	}
}

function addFolderParents(target: Set<string>, path: string): void {
	const parts = normalizeTrackedFolderPath(path).split("/");
	for (let depth = 1; depth <= parts.length; depth++) {
		const folder = normalizeTrackedFolderPath(parts.slice(0, depth).join("/"));
		if (folder) target.add(folder);
	}
}

function indexDocument(index: ReviewIndex, bucket: TimeBucket, path: string, seconds: number): void {
	const day = index.days.get(bucket.date) || { documents: new Map<string, number>(), offsets: new Set<number>(), timezoneWarning: false };
	day.documents.set(path, (day.documents.get(path) || 0) + seconds);
	day.offsets.add(bucket.offsetMinutes);
	day.timezoneWarning ||= !bucketMatchesLocalTime(bucket);
	index.days.set(bucket.date, day);
}

function bucketMatchesLocalTime(bucket: TimeBucket): boolean {
	const [year, month, day] = bucket.date.split("-").map(Number);
	const actual = new Date(Date.UTC(year, month - 1, day, bucket.hour) - bucket.offsetMinutes * 60000);
	return toFormattedDate(actual) === bucket.date && actual.getHours() === bucket.hour;
}

function reviewCoverageData(data: StoredTimeActivity, range: ReviewRange): StoredTimeActivity {
	const start = parseDate(range.fromDate).getTime();
	const end = parseDate(shiftReviewDate(range.weekEnd, 1)).getTime();
	const folders = range.root ? [range.root] : [];
	return { buckets: {}, policyChanges: [], periods: data.periods
		.filter(period => period.start < end && (period.end ?? range.now) > start && areFoldersCoveredByScope(folders, period.folders))
		.map(period => ({ start: period.start, end: Math.min(period.end ?? range.now, range.now), folders: [...period.folders] }))
		.filter(period => period.end > period.start) };
}

function reviewDays(start: string, range: ReviewRange, index: ReviewIndex, coverageData: StoredTimeActivity): WeeklyReviewDay[] {
	return Array.from({ length: 7 }, (_, day) => makeReviewDay(shiftReviewDate(start, day), range, index, coverageData));
}

function makeReviewDay(date: string, range: ReviewRange, index: ReviewIndex, coverageData: StoredTimeActivity): WeeklyReviewDay {
	const source = index.days.get(date);
	const start = parseDate(date), end = parseDate(shiftReviewDate(date, 1));
	const documents = documentRows(source?.documents || new Map());
	const seconds = documents.reduce((sum, item) => sum + item.seconds, 0);
	const future = date > range.today;
	const timezoneWarning = Boolean(source?.timezoneWarning || (source?.offsets.size || 0) > 1 || start.getTimezoneOffset() !== end.getTimezoneOffset());
	const coverage = getTimeTrackingState(coverageData, start.getTime(), end.getTime(), range.root ? [range.root] : [], range.now);
	const uncertain = timezoneWarning || (seconds > 0 && (coverage === "UNTRACKED" || future));
	return { date, seconds, documents, future, timezoneWarning,
		coverage: uncertain ? "UNKNOWN" : coverage,
		scopeSignatures: scopeSignatures(coverageData, start.getTime(), end.getTime()) };
}

function scopeSignatures(data: StoredTimeActivity, start: number, end: number): string[] {
	return [...new Set(data.periods.filter(period => period.start < end && period.end! > start)
		.map(period => JSON.stringify(normalizeTrackedFolders(period.folders).sort())))].sort();
}

function compareWeeks(data: StoredTimeActivity, coverageData: StoredTimeActivity, range: ReviewRange,
	days: WeeklyReviewDay[], previousDays: WeeklyReviewDay[]): WeeklyReviewComparison {
	const count = range.isCurrentWeek ? diffCalendarDays(parseDate(range.weekStart), parseDate(range.today)) : 7;
	const current = days.slice(0, count), previous = previousDays.slice(0, count);
	const comparison: WeeklyReviewComparison = {
		fromDate: range.weekStart, toDate: count ? current[count - 1].date : undefined,
		referenceFromDate: range.fromDate, referenceToDate: count ? previous[count - 1].date : undefined,
		currentSeconds: current.reduce((sum, day) => sum + day.seconds, 0),
		previousSeconds: previous.reduce((sum, day) => sum + day.seconds, 0),
		state: "NO_COMPLETED_DAYS", currentDays: current, previousDays: previous,
	};
	if (!count) return comparison;
	comparison.state = comparisonState(data, coverageData, comparison);
	if (comparison.state !== "READY") return comparison;
	comparison.deltaSeconds = comparison.currentSeconds - comparison.previousSeconds;
	if (comparison.previousSeconds > 0) comparison.percentage = comparison.deltaSeconds / comparison.previousSeconds * 100;
	return comparison;
}

function comparisonState(data: StoredTimeActivity, coverageData: StoredTimeActivity,
	comparison: WeeklyReviewComparison): WeeklyReviewComparison["state"] {
	if ([...comparison.currentDays, ...comparison.previousDays].some(day => day.coverage !== "TRACKED" || day.future)) return "INCOMPLETE";
	const start = parseDate(comparison.referenceFromDate).getTime();
	const end = parseDate(shiftReviewDate(comparison.toDate!, 1)).getTime();
	const signatures = scopeSignatures(coverageData, start, end);
	if (!signatures.length) return "INCOMPLETE";
	if (signatures.length > 1 || data.policyChanges.some(change => change.at >= start && change.at < end)) return "POLICY_CHANGED";
	return "READY";
}

function documentRows(values: Map<string, number>): TimeDocumentStats[] {
	return [...values].map(([path, seconds]) => ({ path, seconds }))
		.sort((a, b) => b.seconds - a.seconds || a.path.localeCompare(b.path));
}

function sumReviewDocuments(days: readonly WeeklyReviewDay[]): TimeDocumentStats[] {
	const values = new Map<string, number>();
	for (const day of days) for (const item of day.documents) values.set(item.path, (values.get(item.path) || 0) + item.seconds);
	return documentRows(values);
}

export function getWeeklyReviewGoal(day: WeeklyReviewDay, today: string, goalMinutes?: number): WeeklyReviewGoalState {
	if (!Number.isSafeInteger(goalMinutes) || !goalMinutes || goalMinutes <= 0 || day.future) return "EXCLUDED";
	if (day.seconds / 60 >= goalMinutes) return "MET";
	if (day.date === today) return "IN_PROGRESS";
	return day.coverage === "TRACKED" ? "MISSED" : "UNKNOWN";
}

export function getWeeklyReviewGroups(snapshot: WeeklyReviewSnapshot, depth: 1 | 2): WeeklyReviewGroup[] {
	const groups = new Map<string, WeeklyReviewGroup & {documents: TimeDocumentStats[]}>();
	for (const item of snapshot.documents) {
		const activity = isYoloChatActivity(item.path);
		const parts = item.path.replace(/\\/g, "/").slice(snapshot.root ? snapshot.root.length + 1 : 0).split("/").slice(0, -1);
		const label = activity ? YOLO_CHAT_ACTIVITY_LABEL : parts.slice(0, depth).join("/") || "根目录直属笔记";
		const key = activity ? "activity:yolo" : parts.length ? `folder:${label}` : "root:";
		const group = groups.get(key) || { key, label, activity, seconds: 0, documents: [] };
		group.seconds += item.seconds;
		group.documents.push({ ...item });
		groups.set(key, group);
	}
	return [...groups.values()].sort((a, b) => b.seconds - a.seconds || a.key.localeCompare(b.key));
}

function reviewWarnings(days: WeeklyReviewDay[], root: string): string[] {
	const warnings: string[] = [];
	if (!root) warnings.push("按当时采集范围汇总，不代表整个仓库或全部设备均已完整采集。");
	if (days.some(day => day.future && day.seconds > 0)) warnings.push("包含日期超前记录，按原日期保留，不参与目标及同期比较。");
	if (days.some(day => day.timezoneWarning)) warnings.push("存在时区偏移或日界不一致，相关日期覆盖无法确认。");
	if (days.some(day => !day.future && day.coverage !== "TRACKED")) warnings.push("存在未采集、部分采集或覆盖无法确认的日期，缺失不代表零分钟。");
	return warnings;
}
