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
	trackedFiles: string[];
	strictUserInputOnly: boolean;
	countPastedText: boolean;
	countAiEdits: boolean;
}

export type CountingPolicy = Pick<
	EditActivitySettings,
	| "excludeWhitespace"
	| "excludeMarkdownFormatting"
	| "strictUserInputOnly"
	| "countPastedText"
> & { countAiEdits?: true };

export interface CountingPolicyPeriod {
	startedAt: string;
	endedAt?: string;
	policy: CountingPolicy;
}

export interface StoredDailyEditStats {
	addedChars: number;
	deletedChars: number;
	aiAddedChars?: number;
	aiDeletedChars?: number;
	documents: Record<string, StoredDocumentEditStats>;
}

export interface StoredDocumentEditStats {
	addedChars: number;
	deletedChars: number;
	aiAddedChars?: number;
	aiDeletedChars?: number;
	lastEditPosition?: EditPosition;
}

export interface EditActivityStore {
	schemaVersion: 13;
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
	trackedFiles: [],
	strictUserInputOnly: true,
	countPastedText: true,
	countAiEdits: false,
};

export function isValidSaveIntervalSeconds(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 15 && value <= 1800;
}

export const EMPTY_EDIT_ACTIVITY_STORE: EditActivityStore = {
	schemaVersion: 13,
	timeActivity: createEmptyTimeActivity(),
	settings: {
		...DEFAULT_EDIT_ACTIVITY_SETTINGS,
		trackedFolders: [],
		trackedFiles: [],
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
		...(settings.countAiEdits ? { countAiEdits: true } : {}),
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
		left.countPastedText === right.countPastedText &&
		left.countAiEdits === right.countAiEdits
	);
}

export function toDailyEditStats(
	date: string,
	value: StoredDailyEditStats
): DailyEditStats {
	const documents = Object.entries(value.documents || {})
		.map(([path, stats]) => {
			const aiAdded = Math.min(stats.addedChars, Math.max(0, stats.aiAddedChars || 0));
			const aiDeleted = Math.min(stats.deletedChars, Math.max(0, stats.aiDeletedChars || 0));
			const aiChanged = aiAdded + aiDeleted;
			return {
				path,
				addedChars: stats.addedChars,
				deletedChars: stats.deletedChars,
				changedChars: stats.addedChars + stats.deletedChars,
				...(aiChanged > 0 ? { aiAddedChars: aiAdded, aiDeletedChars: aiDeleted, aiChangedChars: aiChanged } : {}),
				...(stats.lastEditPosition
					? {
							lastEditPosition: {
								...stats.lastEditPosition,
							},
					  }
					: {}),
			};
		})
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
	const aiAddedChars = Math.min(value.addedChars, Math.max(0, value.aiAddedChars || 0));
	const aiDeletedChars = Math.min(value.deletedChars, Math.max(0, value.aiDeletedChars || 0));
	const aiChangedChars = aiAddedChars + aiDeletedChars;
	return {
		date,
		addedChars: value.addedChars,
		deletedChars: value.deletedChars,
		changedChars: value.addedChars + value.deletedChars,
		...(aiChangedChars > 0 ? { aiAddedChars, aiDeletedChars, aiChangedChars } : {}),
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
				const mergedAiAdded = (existing.aiAddedChars || 0) + (stats.aiAddedChars || 0);
				const mergedAiDeleted = (existing.aiDeletedChars || 0) + (stats.aiDeletedChars || 0);
				if (mergedAiAdded > 0) existing.aiAddedChars = mergedAiAdded;
				if (mergedAiDeleted > 0) existing.aiDeletedChars = mergedAiDeleted;
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
