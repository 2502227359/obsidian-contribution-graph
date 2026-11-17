import { ContributionGraphConfig } from "src/types";
import { CalendarGraphRender } from "./calendarGraphRender";
import { MonthTrackGraphRender } from "./monthTrackGraphRender";
import { GitStyleTrackGraphRender } from "./gitStyleTrackGraphRender";
import { HourlyGraphRender } from "./hourlyGraphRender";
import { BaseGraphRender } from "./graphRender";
import { ContributionCellData } from "../types";
import { toFormattedDate } from "../util/dateUtils";
import { captureDatePicker, restoreDatePicker } from "../view/datePicker/DatePicker";
import { ActivityTimelineGraphRender } from "./activityTimelineGraphRender";
import {
	bindTimelineScrollAffordance,
	captureTimelineScroll,
	restoreTimelineScroll,
} from "./timelineScroll";

export class Renders {
	private static readonly states = new WeakMap<HTMLElement, RenderState>();
	static renders = [
		new ActivityTimelineGraphRender(),
		new HourlyGraphRender(),
		new CalendarGraphRender(),
		new MonthTrackGraphRender(),
		new GitStyleTrackGraphRender(),
	];

	static render(
		container: HTMLElement,
		graphConfig: ContributionGraphConfig
	): void {
		const focused = container.ownerDocument.activeElement as HTMLElement | null;
		this.dispose(container);
		const calendar = captureDatePicker(container);
		const focusedCell = focused && container.contains(focused) && focused.matches("button.cell")
			? { date: focused.dataset.date, hour: focused.dataset.hour } : undefined;
		const hourly = container.querySelector<HTMLElement>(".charts.hourly-profile");
		if (hourly) graphConfig.hourlyViewState = {
			view: hourly.dataset.view === "week" ? "week" : "day",
			date: hourly.dataset.selectedDate || "",
		};
		const focusKey = focused && container.contains(focused) ? focused.dataset.timeFocus : undefined;
		const previousTimelineScroll = captureTimelineScroll(
			container.querySelector<HTMLElement>(".charts.default")
		);
		const previousMonthTrackScroll = captureTimelineScroll(
			container.querySelector<HTMLElement>(".charts.month-track")
		);
		container.empty();
		if (graphConfig.graphType === undefined) {
			graphConfig.graphType = "default";
		}
		const render = this.renders.find(
			(r) => r.graphType() === graphConfig.graphType
		);
		if (render) {
			render.render(container, graphConfig);
			this.states.set(container, {
				graphType: graphConfig.graphType,
				config: graphConfig,
				structure: getStructureKey(graphConfig),
				cells: snapshotCells(graphConfig.graphType === "hourly" ? graphConfig.hourlyData || [] : render instanceof BaseGraphRender ? render.generateContributionData(graphConfig) : []),
			});
			restoreDatePicker(container, calendar);
			const timeline = container.querySelector<HTMLElement>(
				".charts.default, .charts.month-track"
			);
			if (graphConfig.graphType === "default") {
				restoreTimelineScroll(
					timeline,
					previousTimelineScroll
				);
			} else if (graphConfig.graphType === "month-track") {
				restoreTimelineScroll(
					timeline,
					previousMonthTrackScroll || {
						left: 0,
						atLatest: false,
					}
				);
			}
			bindTimelineScrollAffordance(timeline);
			if (focusKey) Array.from(container.querySelectorAll<HTMLElement>("[data-time-focus]:not(:disabled)"))
				.find(element => element.dataset.timeFocus === focusKey)?.focus({preventScroll: true});
			if (focusedCell) {
				Array.from(container.querySelectorAll<HTMLButtonElement>("button.cell:not(:disabled)"))
					.find(cell => cell.dataset.date === focusedCell.date && cell.dataset.hour === focusedCell.hour)?.focus({ preventScroll: true });
			}
		} else {
			this.renderErrorTips(
				container,
				`invalid graphType "${graphConfig.graphType}"`,
				[
					`please set graphType to one of ${Renders.renders
						.map((r) => r.graphType())
						.join(", ")}`
				]
			);
		}
	}

	/** 将数据变化补丁应用到现有图表 DOM；返回 false 表示必须完整重建。 */
	static update(container: HTMLElement, nextConfig: ContributionGraphConfig): boolean {
		const state = this.states.get(container);
		const graphType = nextConfig.graphType || "default";
		if (!state || state.graphType !== graphType || state.structure !== getStructureKey(nextConfig)) return false;
		const renderer = this.renders.find(item => item.graphType() === graphType);
		if (!renderer) return false;
		Object.assign(state.config, nextConfig);
		const config = state.config;
		if(renderer instanceof ActivityTimelineGraphRender)return renderer.update(container,config);
		if (graphType === "hourly" && renderer instanceof HourlyGraphRender) {
			const changed = renderer.update(container, config, state.cells);
			state.cells = snapshotCells(config.hourlyData || []);
			return changed;
		}
		if (!(renderer instanceof BaseGraphRender)) return false;
		const cells = renderer.generateContributionData(config);
		const activity = container.querySelector<HTMLElement>(".activity-container");
		const main = container.querySelector<HTMLElement>(".contribution-graph .main");
		if (!activity || !main) return false;
		const oldCells = state.cells;
		const nextCells = snapshotCells(cells);
		const oldKeys = new Set(oldCells.map(cell => cell.key));
		const nextKeys = new Set(nextCells.map(cell => cell.key));
		if (oldKeys.size !== nextKeys.size || oldKeys.size !== nextCells.length || nextCells.some(cell => !oldKeys.has(cell.key))) return false;
		const oldByKey = new Map(oldCells.map(cell => [cell.key, cell.signature]));
		for (const cell of nextCells) {
			if (oldByKey.get(cell.key) === cell.signature) continue;
			const node = findContributionNode(container, cell.data.date.toString());
			if (node) renderer.patchContributionCell(node, cell.data, config, activity);
		}
		renderer.patchContributionSummary(main, config, cells, activity);
		state.cells = nextCells;
		return true;
	}

	static renderErrorTips(container: HTMLElement, summary: string, recommends?: string[]): void {
		this.dispose(container);
		container.empty();
		const errDiv = createDiv({
			cls: "contribution-graph-render-error-container",
			parent: container
		});

		createEl("p", {
			text: summary,
			cls: "summary",
			parent: errDiv
		})

		if (recommends) {
			recommends.forEach(r => {
				createEl("pre", {
					text: r,
					cls: "recommend",
					parent: errDiv
				})
			})
		}

	}

	static dispose(container:HTMLElement):void {
		const renderer=this.renders.find(item=>item instanceof ActivityTimelineGraphRender) as ActivityTimelineGraphRender|undefined;
		renderer?.dispose(container);this.states.delete(container);
	}

	static renderError(container: HTMLElement, {
		summary,
		recommends
	}: {
		summary: string,
		recommends?: string[]
	}): void {
		Renders.renderErrorTips(container, summary, recommends)
	}
}

interface RenderState {
	graphType: ContributionGraphConfig["graphType"];
	config: ContributionGraphConfig;
	structure: string;
	cells: RenderCellSnapshot[];
}

interface RenderCellSnapshot {
	key: string;
	signature: string;
	data: ContributionCellData;
}

function snapshotCells(cells: ContributionCellData[]): RenderCellSnapshot[] {
	return cells.map(data => ({
		key: data.hour === undefined ? data.date : `${data.date}T${data.hour}`,
		signature: JSON.stringify({data, isToday: data.date === toFormattedDate(new Date())}),
		data,
	}));
}

function getStructureKey(config: ContributionGraphConfig): string {
	return JSON.stringify({
		graphType: config.graphType,
		title: config.title,
		titleStyle: config.titleStyle,
		mainContainerStyle: config.mainContainerStyle,
		days: config.days,
		fromDate: config.fromDate,
		toDate: config.toDate,
		startOfWeek: config.startOfWeek,
		appearance: config.appearance,
		cellStyle: config.cellStyle,
		cellStyleRules: config.cellStyleRules,
		heatScale: config.heatScale,
		fillTheScreen: config.fillTheScreen,
		enableMainContainerShadow: config.enableMainContainerShadow,
		showCellRuleIndicators: config.showCellRuleIndicators,
		valueUnit: config.valueUnit,
		timeTracking: config.timeTracking,
		activityFolders: config.activityFolders,
	});
}

function findContributionNode(container: HTMLElement, date: string): HTMLElement | undefined {
	return Array.from(container.querySelectorAll<HTMLElement>(".charts .cell[data-date]"))
		.find(cell => cell.dataset.date === date);
}
