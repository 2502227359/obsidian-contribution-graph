import {
	CollectionScopePeriod,
	DailyEditStats,
	EditPosition,
	TrackingPeriod,
	SavedGraphTheme,
} from "src/types";
import { createEmptyTimeActivity } from "../time/timeData";
import { StoredTimeActivity } from "../time/types";

export interface EditActivitySettings {
	timeTrackingEnabled: boolean;
	idleTimeoutMinutes: number;
	saveIntervalSeconds: number;
	trackingEnabled: boolean;
	excludeWhitespace: boolean;
	excludeMarkdownFormatting: boolean;
	trackedFolders: string[];
	strictUserInputOnly: boolean;
	countPastedText: boolean;
}

export type CountingPolicy = Pick<
	EditActivitySettings,
	| "excludeWhitespace"
	| "excludeMarkdownFormatting"
	| "strictUserInputOnly"
	| "countPastedText"
>;

export interface CountingPolicyPeriod {
	startedAt: string;
	endedAt?: string;
	policy: CountingPolicy;
}

export interface StoredDailyEditStats {
	addedChars: number;
	deletedChars: number;
	documents: Record<string, StoredDocumentEditStats>;
}

export interface StoredDocumentEditStats {
	addedChars: number;
	deletedChars: number;
	lastEditPosition?: EditPosition;
}

export interface EditActivityStore {
	schemaVersion: 12;
	timeActivity: StoredTimeActivity;
	settings: EditActivitySettings;
	graphThemes: SavedGraphTheme[];
	trackingPeriods: TrackingPeriod[];
	collectionScopePeriods: CollectionScopePeriod[];
	countingPolicyPeriods: CountingPolicyPeriod[];
	dailyStats: Record<string, StoredDailyEditStats>;
}

export const DEFAULT_EDIT_ACTIVITY_SETTINGS: EditActivitySettings = {
	timeTrackingEnabled: false,
	idleTimeoutMinutes: 5,
	saveIntervalSeconds: 60,
	trackingEnabled: false,
	excludeWhitespace: true,
	excludeMarkdownFormatting: false,
	trackedFolders: [],
	strictUserInputOnly: true,
	countPastedText: true,
};

export function isValidSaveIntervalSeconds(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 15 && value <= 1800;
}

export const EMPTY_EDIT_ACTIVITY_STORE: EditActivityStore = {
	schemaVersion: 12,
	timeActivity: createEmptyTimeActivity(),
	settings: {
		...DEFAULT_EDIT_ACTIVITY_SETTINGS,
		trackedFolders: [],
	},
	graphThemes: [],
	trackingPeriods: [],
	collectionScopePeriods: [],
	countingPolicyPeriods: [],
	dailyStats: {},
};

export function getCountingPolicy(
	settings: EditActivitySettings
): CountingPolicy {
	return {
		excludeWhitespace: settings.excludeWhitespace,
		excludeMarkdownFormatting: settings.excludeMarkdownFormatting,
		strictUserInputOnly: settings.strictUserInputOnly,
		countPastedText: settings.countPastedText,
	};
}

export function countingPoliciesEqual(
	left: CountingPolicy,
	right: CountingPolicy
): boolean {
	return (
		left.excludeWhitespace === right.excludeWhitespace &&
		left.excludeMarkdownFormatting ===
			right.excludeMarkdownFormatting &&
		left.strictUserInputOnly === right.strictUserInputOnly &&
		left.countPastedText === right.countPastedText
	);
}

export function toDailyEditStats(
	date: string,
	value: StoredDailyEditStats
): DailyEditStats {
	const documents = Object.entries(value.documents || {})
		.map(([path, stats]) => ({
			path,
			addedChars: stats.addedChars,
			deletedChars: stats.deletedChars,
			changedChars: stats.addedChars + stats.deletedChars,
			...(stats.lastEditPosition
				? {
						lastEditPosition: {
							...stats.lastEditPosition,
						},
				  }
				: {}),
		}))
		.sort((a, b) => {
			const difference = b.changedChars - a.changedChars;
			return difference !== 0
				? difference
				: a.path.localeCompare(b.path);
		});
	const attributedAdded = documents.reduce(
		(sum, document) => sum + document.addedChars,
		0
	);
	const attributedDeleted = documents.reduce(
		(sum, document) => sum + document.deletedChars,
		0
	);
	return {
		date,
		addedChars: value.addedChars,
		deletedChars: value.deletedChars,
		changedChars: value.addedChars + value.deletedChars,
		documents,
		unattributedAddedChars: Math.max(
			0,
			value.addedChars - attributedAdded
		),
		unattributedDeletedChars: Math.max(
			0,
			value.deletedChars - attributedDeleted
		),
	};
}

export function migrateDocumentPaths(
	dailyStats: Record<string, StoredDailyEditStats>,
	oldPath: string,
	newPath: string,
	isFolder: boolean
): string[] {
	const changedDates: string[] = [];
	const oldPrefix = oldPath.endsWith("/") ? oldPath : `${oldPath}/`;
	const newPrefix = newPath.endsWith("/") ? newPath : `${newPath}/`;

	for (const [date, day] of Object.entries(dailyStats)) {
		let changed = false;
		for (const [path, stats] of Object.entries(day.documents)) {
			const targetPath = isFolder
				? path.startsWith(oldPrefix)
					? `${newPrefix}${path.slice(oldPrefix.length)}`
					: undefined
				: path === oldPath
				? newPath
				: undefined;
			if (!targetPath || targetPath === path) {
				continue;
			}

			const existing = day.documents[targetPath];
			if (existing) {
				existing.addedChars += stats.addedChars;
				existing.deletedChars += stats.deletedChars;
				existing.lastEditPosition =
					stats.lastEditPosition || existing.lastEditPosition;
			} else {
				day.documents[targetPath] = stats;
			}
			delete day.documents[path];
			changed = true;
		}
		if (changed) {
			changedDates.push(date);
		}
	}

	return changedDates;
}
