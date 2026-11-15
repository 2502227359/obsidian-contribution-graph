import type { TimeGraphSelection } from "../time/timeGraphData";
import { toFormattedDate } from "../util/dateUtils";

/** 替换实际重算的位置，避免清空目标数据时遗留旧值。 */
export function mergeGraphRows<T extends {date: string | Date; hour?: number}>(
	previous: T[], changed: T[], selection?: TimeGraphSelection
): T[] {
	if (!selection) return changed;
	const dates = new Set(selection.dates);
	const keys = selection.timeKeys && new Set(selection.timeKeys.map(key => `${key.date}T${key.hour}`));
	const keep = previous.filter(row => {
		const date = dateKey(row.date);
		return !dates.has(date) || (keys && row.hour !== undefined && !keys.has(`${date}T${row.hour}`));
	});
	return [...keep, ...changed].sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)) || (a.hour ?? 0) - (b.hour ?? 0));
}

function dateKey(date: string | Date): string { return typeof date === "string" ? date : toFormattedDate(date); }
