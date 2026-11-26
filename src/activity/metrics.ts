import { EditActivityMetric } from "src/query/types";

export interface EditMetricStats {
	addedChars: number;
	deletedChars: number;
	changedChars: number;
	aiAddedChars?: number;
	aiDeletedChars?: number;
	aiChangedChars?: number;
}

export interface EditOriginSplit {
	total: number;
	ai: number;
	manual: number;
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

export function getEditActivityOriginSplit(
	metric: EditActivityMetric,
	stats: EditMetricStats
): EditOriginSplit {
	const total = Math.max(0, getEditActivityMetricValue(metric, stats));
	const rawAi = metric === "ADDED_CHARS"
		? (stats.aiAddedChars || 0)
		: metric === "DELETED_CHARS"
			? (stats.aiDeletedChars || 0)
			: (stats.aiChangedChars ?? ((stats.aiAddedChars || 0) + (stats.aiDeletedChars || 0)));
	const ai = Math.min(total, Math.max(0, rawAi));
	return { total, ai, manual: Math.max(0, total - ai) };
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
