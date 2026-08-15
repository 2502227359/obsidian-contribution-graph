import {
	createDefaultGoalHeatScale,
	DEFAULT_GOAL_HEAT_LEVEL_STEP,
	MAX_EDITABLE_GOAL_HEAT_LEVELS,
} from "src/constants";
import {
	CellStyleRule,
	GoalHeatLevel,
	GoalHeatScale,
} from "src/types";
import { darkenHexColor, resamplePalette } from "./themePalette";

export type GoalHeatLevelRatioError =
	| "INVALID"
	| "DUPLICATE"
	| "ZERO_LOCKED";

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
	return applyColorsToGoalHeatScale(
		heatScale,
		rules.map((rule) => rule.color)
	);
}

export function applyColorsToGoalHeatScale(
	heatScale: GoalHeatScale | undefined,
	colors: string[]
): GoalHeatScale {
	const next = copyGoalHeatScale(heatScale);
	if (colors.length === 0) {
		return next;
	}
	const palette = resamplePalette(colors, next.levels.length);
	next.levels = next.levels.map((level, index) => ({
		...level,
		color: palette[index],
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
	next.levels.sort((a, b) => a.minRatio - b.minRatio);
	return next;
}

export function validateGoalHeatLevelRatio(
	heatScale: GoalHeatScale | undefined,
	index: number,
	minRatio: number
): GoalHeatLevelRatioError | undefined {
	const next = copyGoalHeatScale(heatScale);
	if (
		index < 0 ||
		index >= next.levels.length ||
		!Number.isFinite(minRatio) ||
		minRatio < 0
	) {
		return "INVALID";
	}
	if (next.levels[index].minRatio === 0 && minRatio !== 0) {
		return "ZERO_LOCKED";
	}
	if (
		next.levels.some(
			(level, candidateIndex) =>
				candidateIndex !== index && level.minRatio === minRatio
		)
	) {
		return "DUPLICATE";
	}
	return undefined;
}

export function updateGoalHeatLevelRatio(
	heatScale: GoalHeatScale | undefined,
	index: number,
	minRatio: number
): GoalHeatScale {
	if (validateGoalHeatLevelRatio(heatScale, index, minRatio)) {
		return copyGoalHeatScale(heatScale);
	}
	return updateGoalHeatLevel(heatScale, index, { minRatio });
}

export function addGoalHeatLevel(
	heatScale: GoalHeatScale | undefined,
	limit = MAX_EDITABLE_GOAL_HEAT_LEVELS
): GoalHeatScale {
	const next = copyGoalHeatScale(heatScale);
	if (next.levels.length >= limit) {
		return next;
	}
	const highest = [...next.levels].sort(
		(a, b) => b.minRatio - a.minRatio
	)[0];
	next.levels.push({
		minRatio:
			Math.round(
				(highest.minRatio + DEFAULT_GOAL_HEAT_LEVEL_STEP) * 10000
			) / 10000,
		color: darkenHexColor(highest.color),
	});
	next.levels.sort((a, b) => a.minRatio - b.minRatio);
	return next;
}

export function removeGoalHeatLevel(
	heatScale: GoalHeatScale | undefined,
	index: number
): GoalHeatScale {
	const next = copyGoalHeatScale(heatScale);
	if (
		next.levels.length <= 1 ||
		index < 0 ||
		index >= next.levels.length ||
		next.levels[index].minRatio === 0
	) {
		return next;
	}
	next.levels.splice(index, 1);
	next.levels.sort((a, b) => a.minRatio - b.minRatio);
	return next;
}

export function formatGoalHeatLevelRange(
	minRatio: number,
	nextMinRatio?: number
): string {
	const min = formatPercentage(minRatio);
	return nextMinRatio === undefined
		? `≥ ${min}%`
		: `${min}%–${formatPercentage(nextMinRatio)}%`;
}

function formatPercentage(ratio: number): string {
	return String(Math.round(ratio * 10000) / 100);
}
