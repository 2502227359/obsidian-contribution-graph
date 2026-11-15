import type { EditActivityChangeEvent } from "../activity/EditActivityService";
import { getActivityDateRange } from "../activity/dateRange";
import { isFileInTrackedFolders, normalizeTrackedFolders } from "../activity/folderScope";
import { isValidFormattedDate, parseDate, toFormattedDate } from "../util/dateUtils";

export interface GraphChangeConfig {
	graphType?: string;
	dateRangeType?: "LATEST_DAYS" | "LATEST_MONTH" | "LATEST_YEAR" | "FIXED_DATE_RANGE";
	dateRangeValue?: number;
	days?: number;
	fromDate?: string;
	toDate?: string;
	dataSource?: { type?: string; folders?: readonly string[] };
}

export interface GraphViewState {
	view: "day" | "week";
	date: string;
}

export interface GraphChange {
	all: boolean;
	dates: string[];
}

export function getGraphChange(
	event: EditActivityChangeEvent,
	config: GraphChangeConfig,
	viewState?: GraphViewState
): GraphChange | undefined {
	if (event.source && event.source !== config.dataSource?.type) {
		return undefined;
	}
	if (["IMPORT", "COVERAGE", "TEMPORAL", "SETTINGS"].includes(event.type)) {
		return { all: true, dates: [] };
	}
	if (event.type === "STATS" && config.dataSource?.type !== "EDIT_ACTIVITY") return undefined;
	if (event.type === "TIME_STATS" && config.dataSource?.type !== "TIME_ACTIVITY") return undefined;
	if (event.type !== "STATS" && event.type !== "TIME_STATS") return undefined;
	if (event.filePath && !isFileInTrackedFolders(event.filePath, normalizeTrackedFolders(config.dataSource?.folders || []))) return undefined;
	if (event.type === "TIME_STATS" && !event.timeKeys?.length) return { all: true, dates: [] };
	const dates = event.type === "STATS"
		? event.date ? [event.date] : []
		: event.timeKeys?.map(key => key.date) || [];
	if (!dates.length) return { all: true, dates: [] };
	const range = getActivityDateRange(config);
	const visible = new Set(dates.filter(date =>
		isValidFormattedDate(date) && (!range.fromDate || date >= range.fromDate) && (!range.toDate || date <= range.toDate)
	));
	if (config.graphType === "hourly" && viewState && isValidFormattedDate(viewState.date)) {
		const datesInView = getHourlyViewDates(viewState);
		for (const date of [...visible]) if (!datesInView.has(date)) visible.delete(date);
	}
	const changedDates = [...visible].sort();
	return changedDates.length ? { all: false, dates: changedDates } : undefined;
}

function getHourlyViewDates(viewState: GraphViewState): Set<string> {
	const dates = new Set<string>();
	const selected = parseDate(viewState.date);
	const count = viewState.view === "week" ? 7 : 1;
	for (let offset = 0; offset < count; offset += 1) {
		const date = new Date(selected);
		date.setDate(date.getDate() - offset);
		dates.add(toFormattedDate(date));
	}
	return dates;
}
