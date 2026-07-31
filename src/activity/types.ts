import { DailyEditStats, EditPosition, TrackingPeriod } from "src/types";

export interface EditActivitySettings {
	trackingEnabled: boolean;
	excludeWhitespace: boolean;
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
	schemaVersion: 3;
	settings: EditActivitySettings;
	trackingPeriods: TrackingPeriod[];
	dailyStats: Record<string, StoredDailyEditStats>;
}

export const DEFAULT_EDIT_ACTIVITY_SETTINGS: EditActivitySettings = {
	trackingEnabled: false,
	excludeWhitespace: true,
};

export const EMPTY_EDIT_ACTIVITY_STORE: EditActivityStore = {
	schemaVersion: 3,
	settings: { ...DEFAULT_EDIT_ACTIVITY_SETTINGS },
	trackingPeriods: [],
	dailyStats: {},
};

export function toDailyEditStats(
	date: string,
	value: StoredDailyEditStats
): DailyEditStats {
	return {
		date,
		addedChars: value.addedChars,
		deletedChars: value.deletedChars,
		changedChars: value.addedChars + value.deletedChars,
		documents: Object.entries(value.documents || {})
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
			}),
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
