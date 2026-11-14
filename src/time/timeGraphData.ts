import type { App } from "obsidian";
import type { EditActivityService } from "../activity/EditActivityService";
import { getActivityDateRange } from "../activity/dateRange";
import { normalizeTrackedFolders, areFoldersCoveredByScope } from "../activity/folderScope";
import type { YamlGraphConfig } from "../processor/types";
import type { Contribution, ContributionCellData, ContributionItem } from "../types";
import { diffCalendarDays, parseDate, toFormattedDate } from "../util/dateUtils";
import { formatDuration } from "./timeData";
import { TimeStats } from "./types";

export function queryTimeGraph(config: YamlGraphConfig, service: EditActivityService, app: App) {
	const folders = normalizeTrackedFolders(config.dataSource.folders || []);
	validateTimeFolders(folders, service, app);
	const range = getActivityDateRange(config);
	const query = { ...range, folders };
	const hourly = config.graphType === "hourly";
	if (hourly && diffCalendarDays(parseDate(range.fromDate!), parseDate(range.toDate!)) >= 366) throw new Error("时段图最多显示 366 天，请缩短日期范围");
	const rows = hourly ? service.getHourlyTimeStats(query) : service.getDailyTimeStats(query);
	const indexed = new Map(rows.map(row => [timeKey(row), row]));
	const data: Contribution[] = [];
	const hourlyData: ContributionCellData[] = [];
	const first = parseDate(range.fromDate!);
	const last = parseDate(range.toDate!);
	for (const day = new Date(first); day <= last; day.setDate(day.getDate() + 1)) {
		for (let hour = 0; hour < (hourly ? 24 : 1); hour++) {
			const date = toFormattedDate(day);
			const bucket = { date, hour: hourly ? hour : undefined };
			const stats = indexed.get(timeKey(bucket)) || emptyStats(service, bucket, timeBounds(day, bucket.hour), folders);
			const contribution = toTimeContribution(stats, app);
			if (!hourly) data.push(contribution);
			else hourlyData.push({ ...contribution, date, hour, timeStats: stats, trackingState: stats.trackingState,
				tracked: stats.trackingState !== "UNTRACKED", future: stats.future,
				year: day.getFullYear(), month: day.getMonth(), monthDate: day.getDate(), weekDay: day.getDay() });
		}
	}
	return { data, hourlyData };
}

function validateTimeFolders(folders: string[], service: EditActivityService, app: App): void {
	if (!areFoldersCoveredByScope(folders, service.getSettings().trackedFolders)) throw new Error("所选文件夹超出全局采集范围");
	for (const folder of folders) {
		const file = app.vault.getAbstractFileByPath(folder);
		if (!file || !("children" in file)) throw new Error(`文件夹不存在：${folder}`);
	}
}

function timeKey(row: Pick<TimeStats, "date" | "hour">): string {
	return row.hour === undefined ? row.date : `${row.date}T${row.hour}`;
}

function timeBounds(day: Date, hour?: number): { start: Date; end: Date } {
	const start = new Date(day); start.setHours(hour ?? 0, 0, 0, 0);
	const end = new Date(start);
	if (hour === undefined) end.setDate(end.getDate() + 1); else end.setHours(hour + 1);
	return { start, end };
}

function emptyStats(service: EditActivityService, key: { date: string; hour?: number }, range: { start: Date; end: Date }, folders: string[]): TimeStats {
	return { ...key, seconds: 0, documents: [],
		...service.getTimeCellInfo(range.start.getTime(), range.end.getTime(), folders) };
}

function toTimeContribution(stats: TimeStats, app: App): Contribution {
	const label = stats.hour === undefined ? stats.date : `${stats.date} ${String(stats.hour).padStart(2, "0")}:00—${String(stats.hour + 1).padStart(2, "0")}:00`;
	const policy = stats.policyChanged ? "；当日调整过空闲阈值，按各时段规则累计" : "";
	return { date: stats.date, value: stats.seconds / 60, timeStats: stats,
		summary: `${label}：${formatDuration(stats.seconds)}${policy}`,
		items: stats.documents.map(document => timeDocumentItem(document, app)) };
}

function timeDocumentItem(document: { path: string; seconds: number }, app: App): ContributionItem {
	const file = app.vault.getAbstractFileByPath(document.path);
	const exists = file && "extension" in file;
	return { label: document.path, value: document.seconds / 60,
		description: `${formatDuration(document.seconds)}${exists ? "" : " · 文件已不存在"}`,
		...(exists ? { open: (event: MouseEvent) => app.workspace.openLinkText(document.path, "", event.ctrlKey || event.metaKey) } : {}) };
}
