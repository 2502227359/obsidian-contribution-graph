import { GoalHeatLevel, GoalHeatScale } from "../types";

export function resolveGoalHeatLevel(
	value: number,
	heatScale: GoalHeatScale
): GoalHeatLevel | null {
	if (value <= 0 || heatScale.levels.length === 0) {
		return null;
	}

	const ratio = value / Math.max(1, heatScale.goal);
	const levels = [...heatScale.levels].sort(
		(a, b) => a.minRatio - b.minRatio
	);
	return (
		[...levels]
			.reverse()
			.find((candidate) => ratio >= candidate.minRatio) || levels[0]
	);
}
