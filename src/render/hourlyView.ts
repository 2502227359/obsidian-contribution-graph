import type { ContributionGraphConfig } from "../types";
import { getHourlyWeek, HourlyDataColumn } from "./hourlyData";

export type HourlyViewState = NonNullable<ContributionGraphConfig["hourlyViewState"]>;

export function getHourlyViewCells(days: HourlyDataColumn[], state: HourlyViewState) {
	return state.view === "week"
		? getHourlyWeek(days, state.date).flatMap(day => day.cells)
		: days.find(day => day.date === state.date)?.cells || [];
}

export function getHourlyCaption(state: HourlyViewState): string {
	return state.view === "day" ? "当日活跃时长" : "所选一周累计时长";
}
