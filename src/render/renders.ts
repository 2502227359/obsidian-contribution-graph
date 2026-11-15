import { ContributionGraphConfig } from "src/types";
import { CalendarGraphRender } from "./calendarGraphRender";
import { MonthTrackGraphRender } from "./monthTrackGraphRender";
import { GitStyleTrackGraphRender } from "./gitStyleTrackGraphRender";
import { HourlyGraphRender } from "./hourlyGraphRender";
import { captureDatePicker, restoreDatePicker } from "../view/datePicker/DatePicker";
import {
	bindTimelineScrollAffordance,
	captureTimelineScroll,
	restoreTimelineScroll,
} from "./timelineScroll";

export class Renders {
	static renders = [
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

	static renderErrorTips(container: HTMLElement, summary: string, recommends?: string[]): void {
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
