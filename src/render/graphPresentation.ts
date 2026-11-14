import type { ContributionCellData, ContributionGraphConfig, ContributionItem } from "../types";
import { formatDuration } from "../time/timeData";

interface MetricPart { value: string; unit: string; }

export function getGraphMetric(config: ContributionGraphConfig, cells: ContributionCellData[]) {
	if (config.timeTracking) {
		const seconds = cells.reduce((sum, cell) => sum + (cell.timeStats?.seconds || 0), 0);
		return { text: formatDuration(seconds), parts: durationParts(seconds), caption: "所选范围累计时长" };
	}
	const value = cells.reduce((sum, cell) => sum + (cell.value || 0), 0).toLocaleString();
	const unit = config.valueUnit || "次贡献";
	return { text: `${value} ${unit}`, parts: [{ value, unit }], caption: "所选范围累计" };
}

export function durationParts(seconds: number): MetricPart[] {
	if (seconds > 0 && seconds < 60) return [{ value: "<1", unit: "分钟" }];
	const minutes = Math.floor(Math.max(0, seconds) / 60);
	const parts: MetricPart[] = [];
	if (minutes >= 60) parts.push({ value: String(Math.floor(minutes / 60)), unit: "小时" });
	if (minutes % 60 > 0 || parts.length === 0) parts.push({ value: String(minutes % 60), unit: "分钟" });
	return parts;
}

export function getGraphContext(config: ContributionGraphConfig, cells: ContributionCellData[]): string {
	const dates = cells.map(cell => cell.date).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
	const scope = config.activityFolders?.length ? config.activityFolders.join("、") : undefined;
	const range = !dates.length ? "暂无记录" : dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} — ${dates[dates.length - 1]}`;
	return scope ? `${scope} · ${range}` : range;
}

export function getDocumentPresentation(item: ContributionItem, timeTracking: boolean, unit = "") {
	const pathParts = /\.md$/i.test(item.label) ? item.label.replace(/\\/g, "/").split("/") : [];
	const name = pathParts.length ? pathParts.pop()!.replace(/\.md$/i, "") : item.label;
	return { name, path: pathParts.length ? pathParts.join("/") : undefined,
		detail: timeTracking ? item.description?.includes("文件已不存在") ? "文件已不存在" : undefined : item.description,
		value: timeTracking ? formatDuration(item.value * 60) : `${item.value.toLocaleString()}${unit ? ` ${unit}` : ""}` };
}

export function getDetailHeading(cell: ContributionCellData): string {
	return cell.hour === undefined ? cell.date : `${cell.date} · ${String(cell.hour).padStart(2, "0")}:00—${String(cell.hour + 1).padStart(2, "0")}:00`;
}
