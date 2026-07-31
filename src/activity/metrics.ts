import { EditActivityMetric } from "src/query/types";

export interface EditMetricStats {
	addedChars: number;
	deletedChars: number;
	changedChars: number;
}

export function getEditActivityMetricValue(
	metric: EditActivityMetric,
	stats: EditMetricStats
): number {
	switch (metric) {
		case "ADDED_CHARS":
			return stats.addedChars;
		case "DELETED_CHARS":
			return stats.deletedChars;
		default:
			return stats.changedChars;
	}
}

export function sortEditActivityStatsByMetric<
	T extends EditMetricStats & { path: string }
>(metric: EditActivityMetric, stats: readonly T[]): T[] {
	return [...stats].sort((a, b) => {
		const difference =
			getEditActivityMetricValue(metric, b) -
			getEditActivityMetricValue(metric, a);
		return difference !== 0
			? difference
			: a.path.localeCompare(b.path);
	});
}
