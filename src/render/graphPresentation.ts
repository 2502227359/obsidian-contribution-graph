import type { ContributionCellData, ContributionGraphConfig, ContributionItem } from "../types";
import { getEditActivityOriginSplit } from "../activity/metrics";
import { formatDuration } from "../time/timeData";

interface MetricPart { value: string; unit: string; }

export interface EditOriginSummary {
	total: number;
	manual: number;
	ai: number;
	manualPercent: number;
	aiPercent: number;
}

export function getEditOriginSummary(config: ContributionGraphConfig, cells: ContributionCellData[]): EditOriginSummary | undefined {
	if (config.timeTracking) return undefined;
	const hasEditStats = Boolean(config.editMetric || cells.some(cell => cell.editStats));
	if (!hasEditStats) return undefined;
	const metric = config.editMetric || "CHANGED_CHARS";
	let total = 0;
	let ai = 0;
	for (const cell of cells) {
		if (cell.editStats) {
			const split = getEditActivityOriginSplit(metric, cell.editStats);
			total += split.total;
			ai += split.ai;
		} else {
			total += Math.max(0, cell.value || 0);
		}
	}
	const clampedAi = Math.min(total, ai);
	const manual = Math.max(0, total - clampedAi);
	const aiPercent = total > 0 ? Math.round((clampedAi / total) * 100) : 0;
	const manualPercent = total > 0 ? 100 - aiPercent : 0;
	return { total, manual, ai: clampedAi, manualPercent, aiPercent };
}

export function getGraphMetric(config: ContributionGraphConfig, cells: ContributionCellData[]) {
	if (config.timeTracking) {
		const seconds = cells.reduce((sum, cell) => sum + (cell.timeStats?.seconds || 0), 0);
		return { text: formatDuration(seconds), parts: durationParts(seconds), caption: "所选范围累计时长" };
	}
	const total = cells.reduce((sum, cell) => sum + (cell.value || 0), 0);
	const value = total.toLocaleString();
	const unit = config.valueUnit || "次贡献";
	const origin = getEditOriginSummary(config, cells);
	const caption = origin && origin.total > 0
		? `所选范围累计 · 手动 ${origin.manual.toLocaleString()} (${origin.manualPercent}%) · AI ${origin.ai.toLocaleString()} (${origin.aiPercent}%)`
		: "所选范围累计";
	return { text: `${value} ${unit}`, parts: [{ value, unit }], caption };
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
