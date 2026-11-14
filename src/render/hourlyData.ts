import type { ContributionCellData } from "../types";
import {
	diffCalendarDays,
	isValidFormattedDate,
	parseDate,
} from "../util/dateUtils";

export interface HourlyCellData extends ContributionCellData {
	hour: number;
}

export interface HourlyDataColumn {
	date: string;
	cells: HourlyCellData[];
}

export type HourlyState = "tracked" | "partial" | "untracked" | "future";

export function getHourlyCellKey(cell: Pick<HourlyCellData, "date" | "hour">): string {
	return `${cell.date}T${cell.hour}`;
}

export function groupHourlyData(data: ContributionCellData[] = []): HourlyDataColumn[] {
	const columns = new Map<string, Map<number, HourlyCellData>>();
	for (const item of data) {
		if (!isHourlyCell(item)) {
			continue;
		}
		const cells = columns.get(item.date) || new Map<number, HourlyCellData>();
		cells.set(item.hour, item);
		columns.set(item.date, cells);
	}
	return [...columns.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([date, cells]) => ({
			date,
			cells: [...cells.values()].sort((left, right) => left.hour - right.hour),
		}));
}

export function selectHourlyDate(
	columns: readonly HourlyDataColumn[],
	requested: string | undefined,
	today: string
): string | undefined {
	const dates = columns.map((column) => column.date).sort();
	if (requested && dates.includes(requested)) {
		return requested;
	}
	if (dates.includes(today)) {
		return today;
	}
	const previous = dates.filter((date) => date <= today);
	return previous.at(-1) || dates[0];
}

export function getHourlyWeek(
	columns: readonly HourlyDataColumn[],
	date: string
): HourlyDataColumn[] {
	if (!isValidFormattedDate(date)) {
		return [];
	}
	return columns.filter((column) => {
		if (!isValidFormattedDate(column.date)) {
			return false;
		}
		const difference = diffCalendarDays(parseDate(column.date), parseDate(date));
		return difference >= 0 && difference <= 6;
	});
}

export function getHourlySeconds(cell: HourlyCellData): number {
	const seconds = cell.timeStats?.seconds ?? cell.value * 60;
	return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
}

export function getHourlyState(cell: HourlyCellData): HourlyState {
	if (cell.future) {
		return "future";
	}
	if (cell.trackingState === "UNTRACKED" || cell.tracked === false) {
		return "untracked";
	}
	if (cell.trackingState === "PARTIAL") {
		return "partial";
	}
	return "tracked";
}

function isHourlyCell(item: ContributionCellData): item is HourlyCellData {
	return (
		typeof item.date === "string" &&
		isValidFormattedDate(item.date) &&
		Number.isInteger(item.hour) &&
		(item.hour as number) >= 0 &&
		(item.hour as number) <= 23
	);
}
