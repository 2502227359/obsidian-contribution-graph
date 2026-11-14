import { CellStyleRule, GoalHeatLevel, GoalHeatScale } from "./types";

export const DEFAULT_RULES: CellStyleRule[] = [
	{
		id: "default_b",
		color: "#c7e6ff",
		min: 1,
		max: 2,
	},
	{
		id: "default_c",
		color: "#79beff",
		min: 2,
		max: 5,
	},
	{
		id: "default_d",
		color: "#3297f8",
		min: 5,
		max: 10,
	},
	{
		id: "default_e",
		color: "#0a6cdb",
		min: 10,
		max: 999,
	},
];

export const TIME_HOURLY_RULES: CellStyleRule[] = [
	{ id: "time-15", min: 0, max: 15, color: "#c7e6ff" },
	{ id: "time-30", min: 15, max: 30, color: "#79beff" },
	{ id: "time-45", min: 30, max: 45, color: "#3297f8" },
	{ id: "time-60", min: 45, max: 100000, color: "#0a6cdb" },
];

export const DEFAULT_GOAL_HEAT_LEVELS: GoalHeatLevel[] = [
	{ minRatio: 0, color: "#c7e6ff" },
	{ minRatio: 0.25, color: "#79beff" },
	{ minRatio: 0.6, color: "#3297f8" },
	{ minRatio: 1, color: "#0a6cdb" },
];

export const MAX_GOAL_HEAT_LEVELS = 20;
export const MAX_EDITABLE_GOAL_HEAT_LEVELS = 8;
export const DEFAULT_GOAL_HEAT_LEVEL_STEP = 0.25;

export function createDefaultGoalHeatScale(goal = 1000): GoalHeatScale {
	return {
		type: "GOAL",
		goal,
		levels: DEFAULT_GOAL_HEAT_LEVELS.map((level) => ({ ...level })),
	};
}
