import { createDefaultGoalHeatScale } from "src/constants";
import {
	CellStyleRule,
	GoalHeatLevel,
	GoalHeatScale,
} from "src/types";

export function copyGoalHeatScale(
	heatScale?: GoalHeatScale
): GoalHeatScale {
	const source = heatScale || createDefaultGoalHeatScale();
	return {
		...source,
		levels: source.levels.map((level) => ({ ...level })),
	};
}

export function applyThemeToGoalHeatScale(
	heatScale: GoalHeatScale | undefined,
	rules: CellStyleRule[]
): GoalHeatScale {
	const next = copyGoalHeatScale(heatScale);
	if (rules.length === 0) {
		return next;
	}
	next.levels = next.levels.map((level, index) => ({
		...level,
		color: rules[Math.min(index, rules.length - 1)].color,
	}));
	return next;
}

export function applyColorsToGoalHeatScale(
	heatScale: GoalHeatScale | undefined,
	colors: string[]
): GoalHeatScale {
	const next = copyGoalHeatScale(heatScale);
	if (colors.length === 0) {
		return next;
	}
	next.levels = next.levels.map((level, index) => ({
		...level,
		color: colors[Math.min(index, colors.length - 1)],
	}));
	return next;
}

export function updateGoalHeatLevel(
	heatScale: GoalHeatScale | undefined,
	index: number,
	patch: Partial<GoalHeatLevel>
): GoalHeatScale {
	const next = copyGoalHeatScale(heatScale);
	if (index < 0 || index >= next.levels.length) {
		return next;
	}
	next.levels[index] = {
		...next.levels[index],
		...patch,
	};
	return next;
}

export function formatGoalHeatLevelRange(
	minRatio: number,
	nextMinRatio?: number
): string {
	const min = Math.round(minRatio * 100);
	return nextMinRatio === undefined
		? `≥ ${min}%`
		: `${min}%–${Math.round(nextMinRatio * 100)}%`;
}
