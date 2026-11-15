import {
	EditActivityStore,
	StoredDailyEditStats,
	StoredDocumentEditStats,
	migrateDocumentPaths,
} from "./types";
import { migrateTrackedFolderPaths } from "./folderScope";
import { renameTimePaths } from "../time/timeData";
import {
	StoredTimeActivity,
	TimeBucket,
	TimeCoveragePeriod,
	TimePolicyChange,
} from "../time/types";

export type StatisticsData = Pick<
	EditActivityStore,
	| "dailyStats"
	| "timeActivity"
	| "trackingPeriods"
	| "collectionScopePeriods"
	| "countingPolicyPeriods"
>;

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function emptyStatistics(): StatisticsData {
	return {
		dailyStats: Object.create(null),
		timeActivity: {
			buckets: Object.create(null),
			periods: [],
			policyChanges: [],
		},
		trackingPeriods: [],
		collectionScopePeriods: [],
		countingPolicyPeriods: [],
	};
}

export function statisticsFrom(store: StatisticsData): StatisticsData {
	return {
		dailyStats: cloneDailyStats(store.dailyStats),
		timeActivity: cloneTimeActivity(store.timeActivity),
		trackingPeriods: store.trackingPeriods.map((period) => ({ ...period })),
		collectionScopePeriods: store.collectionScopePeriods.map((period) => ({
			...period,
			folders: [...period.folders],
		})),
		countingPolicyPeriods: store.countingPolicyPeriods.map((period) => ({
			...period,
			policy: { ...period.policy },
		})),
	};
}

export function mergeStatistics(inputs: readonly StatisticsData[]): StatisticsData {
	const result = emptyStatistics();
	for (const input of inputs) {
		mergeDailyStats(result.dailyStats, input.dailyStats);
		mergeTimeActivity(result.timeActivity, input.timeActivity);
		result.trackingPeriods = dedupeSorted(
			[...result.trackingPeriods, ...input.trackingPeriods],
			period => period.startDate
		);
		result.collectionScopePeriods = dedupeSorted(
			[...result.collectionScopePeriods, ...input.collectionScopePeriods],
			period => period.startDate
		).map((period) => ({ ...period, folders: [...period.folders] }));
		result.countingPolicyPeriods = dedupeSorted(
			[...result.countingPolicyPeriods, ...input.countingPolicyPeriods],
			period => period.startedAt
		).map((period) => ({ ...period, policy: { ...period.policy } }));
	}
	return result;
}

export function closeStatistics(data: StatisticsData, at: number): StatisticsData {
	const result = statisticsFrom(data);
	const closeAt = Number.isFinite(at) ? at : Date.now();
	for (const period of result.timeActivity.periods) {
		if (period.end === undefined) {
			period.end = Math.max(period.start, closeAt);
		}
	}
	for (const period of result.trackingPeriods) {
		if (period.endDate === undefined) {
			period.endDate = maxDateString(period.startDate, formatLocalDate(closeAt));
		}
	}
	for (const period of result.collectionScopePeriods) {
		if (period.endDate === undefined) {
			period.endDate = maxDateString(period.startDate, formatLocalDate(closeAt));
		}
	}
	for (const period of result.countingPolicyPeriods) {
		if (period.endedAt === undefined) {
			const startedAt = Date.parse(period.startedAt);
			period.endedAt = new Date(Math.max(
				Number.isFinite(startedAt) ? startedAt : closeAt,
				closeAt
			)).toISOString();
		}
	}
	return result;
}

export function applyStatisticsRename(
	data: StatisticsData,
	rename: { oldPath: string; newPath: string; isFolder: boolean }
): StatisticsData {
	const result = statisticsFrom(data);
	migrateDocumentPaths(
		result.dailyStats,
		rename.oldPath,
		rename.newPath,
		rename.isFolder
	);
	renameTimePaths(
		result.timeActivity,
		rename.oldPath,
		rename.newPath,
		rename.isFolder
	);
	if (rename.isFolder) {
		for (const period of result.collectionScopePeriods) {
			period.folders = migrateTrackedFolderPaths(
				period.folders,
				rename.oldPath,
				rename.newPath
			);
		}
	}
	return result;
}

function mergeDailyStats(
	target: Record<string, StoredDailyEditStats>,
	source: Record<string, StoredDailyEditStats>
): void {
	for (const [date, sourceDay] of Object.entries(source)) {
		if (DANGEROUS_KEYS.has(date)) continue;
		const targetDay = target[date] || (target[date] = {
			addedChars: 0,
			deletedChars: 0,
			documents: Object.create(null),
		});
		targetDay.addedChars += safeNumber(sourceDay.addedChars);
		targetDay.deletedChars += safeNumber(sourceDay.deletedChars);
		for (const [path, sourceDocument] of Object.entries(sourceDay.documents || {})) {
			if (DANGEROUS_KEYS.has(path)) continue;
			const existing = targetDay.documents[path];
			if (!existing) {
				targetDay.documents[path] = cloneDocument(sourceDocument);
				continue;
			}
			existing.addedChars += safeNumber(sourceDocument.addedChars);
			existing.deletedChars += safeNumber(sourceDocument.deletedChars);
			if (sourceDocument.lastEditPosition) {
				existing.lastEditPosition = { ...sourceDocument.lastEditPosition };
			}
		}
	}
}

function mergeTimeActivity(target: StoredTimeActivity, source: StoredTimeActivity): void {
	for (const [key, sourceBucket] of Object.entries(source.buckets || {})) {
		if (DANGEROUS_KEYS.has(key)) continue;
		const created = !target.buckets[key];
		const targetBucket = target.buckets[key] || (target.buckets[key] = cloneBucket(sourceBucket));
		if (created) continue;
		for (const [path, seconds] of Object.entries(sourceBucket.documents || {})) {
			if (DANGEROUS_KEYS.has(path)) continue;
			targetBucket.documents[path] =
				(targetBucket.documents[path] || 0) + safeNumber(seconds);
		}
	}
	target.periods = dedupeSorted(
		[...target.periods, ...source.periods].map(cloneCoveragePeriod),
		period => period.start
	);
	target.policyChanges = dedupeSorted(
		[...target.policyChanges, ...source.policyChanges].map((change) => ({ ...change })),
		change => change.at
	);
}

function cloneDailyStats(source: Record<string, StoredDailyEditStats>): Record<string, StoredDailyEditStats> {
	const result: Record<string, StoredDailyEditStats> = Object.create(null);
	for (const [date, day] of Object.entries(source || {})) {
		if (DANGEROUS_KEYS.has(date)) continue;
		const documents: Record<string, StoredDocumentEditStats> = Object.create(null);
		for (const [path, document] of Object.entries(day.documents || {})) {
			if (!DANGEROUS_KEYS.has(path)) documents[path] = cloneDocument(document);
		}
		const clone = {
			addedChars: safeNumber(day.addedChars),
			deletedChars: safeNumber(day.deletedChars),
			documents,
		};
		result[date] = clone;
	}
	return result;
}

function cloneTimeActivity(source: StoredTimeActivity): StoredTimeActivity {
	const result: StoredTimeActivity = {
		buckets: Object.create(null),
		periods: (source.periods || []).map(cloneCoveragePeriod),
		policyChanges: (source.policyChanges || []).map((change) => ({ ...change })),
	};
	for (const [key, bucket] of Object.entries(source.buckets || {})) {
		if (!DANGEROUS_KEYS.has(key)) result.buckets[key] = cloneBucket(bucket);
	}
	return result;
}

function cloneBucket(bucket: TimeBucket): TimeBucket {
	const documents: Record<string, number> = Object.create(null);
	for (const [path, seconds] of Object.entries(bucket.documents || {})) {
		if (!DANGEROUS_KEYS.has(path)) documents[path] = safeNumber(seconds);
	}
	return {
		date: bucket.date,
		hour: bucket.hour,
		offsetMinutes: bucket.offsetMinutes,
		documents,
	};
}

function cloneCoveragePeriod(period: TimeCoveragePeriod): TimeCoveragePeriod {
	return { ...period, folders: [...period.folders] };
}

function cloneDocument(document: StoredDocumentEditStats): StoredDocumentEditStats {
	const result: StoredDocumentEditStats = {
		addedChars: safeNumber(document.addedChars),
		deletedChars: safeNumber(document.deletedChars),
	};
	if (document.lastEditPosition) result.lastEditPosition = { ...document.lastEditPosition };
	return result;
}

function dedupeSorted<T>(items: T[], getStart: (item: T) => string | number): T[] {
	const seen = new Set<string>();
	const result: T[] = [];
	for (const item of items) {
		const key = stableKey(item);
		if (!seen.has(key)) {
			seen.add(key);
			result.push(item);
		}
	}
	return result.sort((left, right) => compareStart(getStart(left), getStart(right)) || stableKey(left).localeCompare(stableKey(right)));
}

function compareStart(left: string | number, right: string | number): number {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

function stableKey(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
	if (!value || typeof value !== "object") return JSON.stringify(value);
	return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stableKey((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function safeNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatLocalDate(timestamp: number): string {
	const date = new Date(timestamp);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function maxDateString(left: string, right: string): string {
	return left > right ? left : right;
}
