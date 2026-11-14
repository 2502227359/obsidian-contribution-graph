import { DEFAULT_RULES } from "src/constants";
import {
	ContributionGraphConfig,
	ContributionCellData,
	CellStyleRule,
	ContributionItem,
} from "src/types";
import { parseDate, toFormattedDate } from "src/util/dateUtils";
import {
	generateByLatestDays,
	generateByFixedDate,
	generateByData,
} from "./matrixDataGenerator";
import { matchCellStyleRule } from "src/util/utils";
import { Locals } from "src/i18/messages";
import { resolveGoalHeatLevel } from "./heatScale";
import { resolveCellNavigationIndex } from "./cellKeyboardNavigation";
import { normalizeGraphAppearance } from "./graphAppearance";
import { formatDuration } from "../time/timeData";

export interface GraphRender {
	render(container: HTMLElement, graphConfig: ContributionGraphConfig): void;

	graphType(): string;
}

export abstract class BaseGraphRender implements GraphRender {
	constructor() { }

	render(container: HTMLElement, graphConfig: ContributionGraphConfig): void {
		throw new Error("Method not implemented.");
	}

	abstract graphType(): string;

	createGraphEl(root: HTMLElement): HTMLDivElement {
		return createDiv({
			cls: "contribution-graph",
			parent: root,
		});
	}

	createMainEl(
		parent: HTMLElement,
		graphConfig: ContributionGraphConfig
	): HTMLDivElement {
		let cls = "main";
		if (graphConfig.fillTheScreen && this.graphType() != "calendar") {
			cls = `main ${graphConfig.fillTheScreen ? "fill-the-screen" : ""}`;
		}

		if (graphConfig.enableMainContainerShadow) {
			cls += " shadow";
		}
		const appearance = normalizeGraphAppearance(graphConfig.appearance);
		cls += ` density-${appearance.density.toLowerCase()}`;

		const main = createDiv({
			cls: cls,
			parent: parent,
		});
		if (graphConfig.mainContainerStyle) {
			Object.assign(main.style, graphConfig.mainContainerStyle);
		}
		main.style.setProperty("--cg-cell-gap", `${appearance.cellGap}px`);
		if (appearance.emptyCellColor) {
			main.style.setProperty(
				"--cg-empty-cell-color",
				appearance.emptyCellColor
			);
		}
		return main;
	}

	renderTitle(
		graphConfig: ContributionGraphConfig,
		parent: HTMLElement
	): HTMLElement {
		const titleEl = document.createElement("div");
		titleEl.className = "title";
		if (graphConfig.title) {
			titleEl.innerText = graphConfig.title;
		}
		if (graphConfig.titleStyle) {
			Object.assign(titleEl.style, graphConfig.titleStyle);
		}
		parent.appendChild(titleEl);
		return titleEl;
	}

	renderHeader(
		graphConfig: ContributionGraphConfig,
		parent: HTMLElement,
		contributionData: ContributionCellData[]
	): HTMLElement | undefined {
		const hasTitle = Boolean(graphConfig.title?.trim());
		if (!hasTitle && graphConfig.showCellRuleIndicators === false && !graphConfig.timeTracking) {
			return undefined;
		}

		const header = createDiv({
			cls: "graph-header",
			parent,
		});
		if (hasTitle) {
			this.renderTitle(graphConfig, header);
		}
		this.renderCellRuleIndicator(graphConfig, header, contributionData);
		if (graphConfig.timeTracking) {
			createDiv({ cls: "time-total", parent: header, text: `范围累计：${formatDuration(contributionData.reduce((sum, cell) => sum + (cell.timeStats?.seconds || 0), 0))}` });
		}
		return header;
	}

	renderCellRuleIndicator(
		graphConfig: ContributionGraphConfig,
		parent: HTMLElement,
		contributionData: ContributionCellData[] = []
	) {
		if (graphConfig.showCellRuleIndicators === false) {
			return;
		}

		const cellRuleIndicatorContainer = createDiv({
			cls: "cell-rule-indicator-container",
			parent: parent,
		});
		const cellRules = this.getCellRules(graphConfig);
		if (graphConfig.heatScale?.type === "GOAL") {
			createSpan({
				cls: "goal-caption",
				text: Locals.get()
					.graph_daily_goal.replace(
						"{goal}",
						graphConfig.heatScale.goal.toLocaleString()
					)
					.replace("{unit}", graphConfig.valueUnit || ""),
				parent: cellRuleIndicatorContainer,
			});
		}

		const heatLegend = createDiv({
			cls: "heat-legend",
			parent: cellRuleIndicatorContainer,
		});
		createDiv({
			cls: "cell text",
			text: Locals.get().graph_less,
			parent: heatLegend,
		});

		if (graphConfig.heatScale?.type === "GOAL") {
			[...graphConfig.heatScale.levels]
				.sort((a, b) => a.minRatio - b.minRatio)
				.forEach((level) => {
					const cellEl = createDiv({
						cls: ["cell"],
						parent: heatLegend,
					});
					cellEl.style.backgroundColor = level.color;
					cellEl.innerText = level.text || "";
					cellEl.ariaLabel = `${Math.round(
						level.minRatio * 100
					)}% ${graphConfig.valueUnit || ""}`.trim();
				});
		} else {
			[...cellRules]
				.sort((a, b) => a.min - b.min)
				.forEach((rule) => {
					const cellEl = createDiv({
						cls: ["cell"],
						parent: heatLegend,
				});
				cellEl.className = "cell";
				cellEl.style.backgroundColor = rule.color;
				cellEl.innerText = rule.text || "";

				// bind tips event
				const unit = graphConfig.valueUnit || "contributions";
				const summary = `${rule.min} ≤ ${unit} ＜ ${rule.max}`;
				cellEl.ariaLabel = summary;
			});
		}
		createDiv({
			cls: "cell text",
			text: Locals.get().graph_more,
			parent: heatLegend,
		});

		const states = [
			{
				visible: contributionData.some(
					(item) =>
						item.trackingState === "UNTRACKED" ||
						item.tracked === false
				),
				className: "untracked",
				label: Locals.get().graph_status_untracked,
			},
			{
				visible: contributionData.some(
					(item) => item.trackingState === "PARTIAL"
				),
				className: "partial",
				label: Locals.get().graph_status_partial,
			},
			{
				visible: contributionData.some((item) => item.future),
				className: "future",
				label: Locals.get().graph_status_future,
			},
		].filter((state) => state.visible);

		if (states.length > 0) {
			const stateLegend = createDiv({
				cls: "tracking-state-legend",
				parent: cellRuleIndicatorContainer,
			});
			states.forEach((state) => {
				const item = createDiv({
					cls: "state-legend-item",
					parent: stateLegend,
				});
				createDiv({
					cls: ["cell", state.className],
					parent: item,
				});
				createSpan({ text: state.label, parent: item });
			});
		}
	}

	renderActivityContainer(
		graphConfig: ContributionGraphConfig,
		parent: HTMLElement
	): HTMLElement {
		const activityContainer = createDiv({
			cls: "activity-container",
			parent: parent,
		});
		return activityContainer;
	}

	renderActivity(
		graphConfig: ContributionGraphConfig,
		cellData: ContributionCellData,
		contaienr: HTMLElement
	) {
		contaienr.empty();

		const closeButton = createEl("button", {
			cls: "close-button",
			text: "×",
			parent: contaienr,
			attr: {
				type: "button",
				"aria-label": Locals.get().graph_close_details,
				title: Locals.get().graph_close_details,
			},
		});

		closeButton.onclick = () => {
			const selectedCell = contaienr
				.closest(".main")
				?.querySelector<HTMLElement>(".cell.is-selected");
			this.clearSelectedCell(contaienr.closest(".main"));
			contaienr.empty();
			graphConfig.onActivityClose?.();
			selectedCell?.focus();
		};

		let summary = cellData.summary;
		if (cellData.trackingState === "UNTRACKED" || cellData.tracked === false) {
			summary = Locals.get().graph_untracked_on.replace(
				"{date}",
				cellData.date
			);
		} else if (cellData.trackingState === "PARTIAL") {
			const partial = Locals.get().graph_partially_tracked_on.replace("{date}", cellData.date);
			summary = summary ? `${partial} ${summary}` : partial;
		} else if (!summary && cellData.editStats) {
			const goal = Math.max(1, graphConfig.heatScale?.goal || 1000);
			summary = Locals.get()
				.graph_edit_activity_summary.replace("{date}", cellData.date)
				.replace("{added}", cellData.editStats.addedChars.toString())
				.replace(
					"{deleted}",
					cellData.editStats.deletedChars.toString()
				)
				.replace(
					"{changed}",
					cellData.editStats.changedChars.toString()
				)
				.replace(
					"{percent}",
					Math.round(
						(cellData.editStats.changedChars / goal) * 100
					).toString()
				);
		} else if (!summary && graphConfig.trackingPeriods) {
			summary = Locals.get()
				.graph_edit_activity_summary.replace("{date}", cellData.date)
				.replace("{added}", "0")
				.replace("{deleted}", "0")
				.replace("{changed}", "0")
				.replace("{percent}", "0");
		} else if (!summary && cellData.value > 0) {
			summary = Locals.get()
				.you_have_contributed_to.replace("{date}", cellData.date)
				.replace("{value}", cellData.value.toString());
		} else if (!summary) {
			summary = Locals.get()
				.you_have_no_contributions_on.replace("{date}", cellData.date)
				.replace("{value}", "0");
		}
		const isEditActivity = Boolean(
			graphConfig.trackingPeriods ||
				cellData.editStats ||
				cellData.tracked !== undefined ||
				cellData.trackingState
		);
		if (isEditActivity && !graphConfig.timeTracking) {
			this.renderEditActivitySummary(
				graphConfig,
				cellData,
				contaienr,
				summary
			);
		} else {
			createDiv({
				cls: "activity-summary",
				parent: contaienr,
				text: summary,
			});
		}

		if ((cellData.items || []).length === 0) {
			return;
		}

		const content = createDiv({
			cls: "activity-content",
			parent: contaienr,
		});

		// list-main
		const list = createDiv({
			cls: "activity-list",
			parent: content,
		});

		// show top 10 items
		const size = 10;
		const items = cellData.items || [];
		list.setAttribute("role", "list");
		list.setAttribute("tabindex", "0");
		list.setAttribute(
			"aria-label",
			Locals.get()
				.graph_edit_activity_document_history.replace(
					"{count}",
					items.length.toString()
				)
		);
		renderActivityItem(items.slice(0, size), list);

		const navigation = createDiv({
			cls: "activity-navigation",
			parent: content,
		});

		let page = 1;
		if (items.length > size) {
			const loadMore = createEl("a", {
				text: Locals.get().click_to_load_more,
				href: "#",
				parent: navigation,
			});
			loadMore.onclick = (event) => {
				event.preventDefault();
				const previousScrollHeight = list.scrollHeight;
				page++;
				renderActivityItem(
					items.slice((page - 1) * size, page * size),
					list
				);
				list.scrollTo({
					top: Math.max(0, previousScrollHeight - 16),
					behavior: "smooth",
				});
				if (page * size >= items.length) {
					loadMore.remove();
				}
			};
		}
	}

	restoreSelectedActivity(
		graphConfig: ContributionGraphConfig,
		contributionData: ContributionCellData[],
		activityContainer: HTMLElement
	): void {
		if (!graphConfig.selectedActivityDate) {
			return;
		}
		const selected = contributionData.find(
			(item) => this.getCellKey(item) === graphConfig.selectedActivityDate
		);
		if (selected) {
			this.renderActivity(graphConfig, selected, activityContainer);
		}
	}

	private renderEditActivitySummary(
		graphConfig: ContributionGraphConfig,
		cellData: ContributionCellData,
		parent: HTMLElement,
		fallbackSummary: string
	): void {
		const summary = createDiv({
			cls: ["activity-summary", "edit-activity-summary"],
			parent,
		});
		createDiv({
			cls: "activity-date",
			text: cellData.date,
			parent: summary,
		});

		const untracked =
			cellData.trackingState === "UNTRACKED" ||
			cellData.tracked === false;
		if (!untracked) {
			const stats = cellData.editStats || {
				date: cellData.date,
				addedChars: 0,
				deletedChars: 0,
				changedChars: 0,
				documents: [],
			};
			const goal = Math.max(1, graphConfig.heatScale?.goal || 1000);
			const percent = Math.round((cellData.value / goal) * 100);
			const statsEl = createDiv({
				cls: "activity-stats",
				parent: summary,
			});
			[
				{
					className: "added",
					label: Locals.get().graph_stat_added,
					value: stats.addedChars.toLocaleString(),
				},
				{
					className: "deleted",
					label: Locals.get().graph_stat_deleted,
					value: stats.deletedChars.toLocaleString(),
				},
				{
					className: "changed",
					label: Locals.get().graph_stat_changed,
					value: stats.changedChars.toLocaleString(),
				},
				{
					className: "goal",
					label: Locals.get().graph_stat_goal,
					value: `${percent}%`,
				},
			].forEach((stat) => {
				const statEl = createDiv({
					cls: ["activity-stat", stat.className],
					parent: statsEl,
				});
				createSpan({
					cls: "activity-stat-label",
					text: stat.label,
					parent: statEl,
				});
				createSpan({
					cls: "activity-stat-value",
					text: stat.value,
					parent: statEl,
				});
			});
		}

		const warnings: string[] = [];
		if (untracked) {
			warnings.push(fallbackSummary);
		} else if (cellData.trackingState === "PARTIAL") {
			warnings.push(
				Locals.get().graph_partially_tracked_on.replace(
					"{date}",
					cellData.date
				)
			);
		}
		if (cellData.editStats?.countingPolicyChanged) {
			warnings.push(Locals.get().graph_counting_policy_changed);
		}
		const legacyWarning = Locals.get().graph_folder_legacy_excluded;
		if (cellData.summary?.includes(legacyWarning)) {
			warnings.push(legacyWarning);
		}

		if (warnings.length > 0) {
			const warningEl = createDiv({
				cls: "activity-warnings",
				parent: summary,
			});
			warnings.forEach((warning) => {
				createDiv({ text: warning, parent: warningEl });
			});
		}
	}

	generateContributionData(graphConfig: ContributionGraphConfig) {
		if (graphConfig.days) {
			return generateByLatestDays(
				graphConfig.days,
				graphConfig.data,
				graphConfig.trackingPeriods,
				graphConfig.collectionScopePeriods,
				graphConfig.activityFolders
			);
		} else if (graphConfig.fromDate && graphConfig.toDate) {
			const fromDate = parseDate(graphConfig.fromDate);
			const toDate = parseDate(graphConfig.toDate);
			return generateByFixedDate(
				fromDate,
				toDate,
				graphConfig.data,
				graphConfig.trackingPeriods,
				graphConfig.collectionScopePeriods,
				graphConfig.activityFolders
			);
		} else {
			return generateByData(
				graphConfig.data,
				graphConfig.trackingPeriods,
				graphConfig.collectionScopePeriods,
				graphConfig.activityFolders
			);
		}
	}

	getCellRules(graphConfig: ContributionGraphConfig) {
		return graphConfig.cellStyleRules &&
			graphConfig.cellStyleRules.length > 0
			? graphConfig.cellStyleRules
			: DEFAULT_RULES;
	}

	bindMonthTips(
		monthCell: HTMLElement,
		contributionItem: ContributionCellData,
		contributionMapByYearMonth: Map<string, number>,
		graphConfig: ContributionGraphConfig
	) {
		const yearMonth = `${contributionItem.year}-${contributionItem.month + 1
			}`;
		const yearMonthValue = contributionMapByYearMonth.get(yearMonth) || 0;
		// tips event
		monthCell.ariaLabel = `${yearMonthValue} ${
			graphConfig.valueUnit || "contributions"
		} on ${yearMonth}.`;
	}

	applyCellGlobalStyle(
		cellEl: HTMLElement,
		graphConfig: ContributionGraphConfig
	) {
		if (graphConfig.cellStyle) {
			Object.assign(cellEl.style, graphConfig.cellStyle);
		}
	}

	applyCellGlobalStylePartial(
		cellEl: HTMLElement,
		graphConfig: ContributionGraphConfig,
		props: string[]
	) {
		if (graphConfig.cellStyle) {
			const partialStyle = props.reduce((acc, cur) => {
				// @ts-ignore
				acc[cur] = graphConfig.cellStyle[cur];
				return acc;
			}, {});
			Object.assign(cellEl.style, partialStyle);
		}
	}

	applyCellStyleRule(
		cellEl: HTMLElement,
		contributionItem: ContributionCellData,
		cellRules: CellStyleRule[],
		graphConfig: ContributionGraphConfig,
		defaultCellStyleRule?: () => CellStyleRule
	) {
		this.applyDateEmphasis(
			cellEl,
			contributionItem,
			graphConfig
		);
		if (contributionItem.future) {
			cellEl.style.backgroundColor = "";
			cellEl.addClass("future");
			return;
		}
		if (contributionItem.trackingState === "UNTRACKED" || contributionItem.tracked === false) {
			cellEl.style.backgroundColor = "";
			cellEl.addClass("untracked");
			return;
		}
		if (contributionItem.trackingState === "PARTIAL") {
			cellEl.addClass("partial");
		}
		if (graphConfig.timeTracking && contributionItem.value <= 0) {
			cellEl.addClass("empty");
			return;
		}

		if (graphConfig.heatScale?.type === "GOAL") {
			if (contributionItem.value <= 0) {
				return;
			}
			const level = resolveGoalHeatLevel(
				contributionItem.value,
				graphConfig.heatScale
			);
			if (level) {
				cellEl.style.backgroundColor = level.color;
				cellEl.innerText = level.text || "";
			}
			return;
		}

		const cellStyleRule = matchCellStyleRule(
			contributionItem.value,
			cellRules
		);
		if (cellStyleRule != null) {
			cellEl.style.backgroundColor = cellStyleRule.color;
			cellEl.innerText = cellStyleRule.text || "";
			return;
		}

		if (defaultCellStyleRule) {
			const sortedRules = [...cellRules].sort(
				(a, b) => a.min - b.min
			);
			const defaultRule =
				[...sortedRules]
					.reverse()
					.find((rule) => contributionItem.value >= rule.min) ||
				defaultCellStyleRule();
			cellEl.style.backgroundColor = defaultRule.color;
			cellEl.innerText = defaultRule.text || "";
		}
	}

	private applyDateEmphasis(
		cellEl: HTMLElement,
		contributionItem: ContributionCellData,
		graphConfig: ContributionGraphConfig
	): void {
		if (contributionItem.date === "$HOLE$") {
			return;
		}
		const appearance = normalizeGraphAppearance(graphConfig.appearance);
		if (
			appearance.highlightToday &&
			contributionItem.date === toFormattedDate(new Date())
		) {
			cellEl.classList.add("is-today");
		}
		if (
			appearance.highlightWeekends &&
			!contributionItem.future &&
			(contributionItem.weekDay === 0 || contributionItem.weekDay === 6)
		) {
			cellEl.classList.add("is-weekend");
		}
	}

	bindCellAttribute(
		cellEl: HTMLElement,
		contributionItem: ContributionCellData
	) {
		cellEl.setAttribute("data-year", contributionItem.year.toString());
		cellEl.setAttribute("data-month", contributionItem.month.toString());
		cellEl.setAttribute("data-date", contributionItem.date.toString());
	}

	bindCellClickEvent(
		cellEl: HTMLElement,
		contributionItem: ContributionCellData,
		graphConfig: ContributionGraphConfig,
		activityContainer?: HTMLElement
	) {
		if (contributionItem.future) {
			if (cellEl instanceof HTMLButtonElement) {
				cellEl.disabled = true;
			}
			return;
		}
		if (cellEl instanceof HTMLButtonElement) {
			cellEl.type = "button";
		} else {
			cellEl.setAttribute("role", "button");
			cellEl.tabIndex = 0;
			cellEl.onkeydown = (event: KeyboardEvent) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					cellEl.click();
				}
			};
		}
		this.applySelectedCellState(
			cellEl,
			contributionItem,
			graphConfig.selectedActivityDate
		);
		cellEl.onclick = (event: MouseEvent) => {
			if (graphConfig.onCellClick) {
				graphConfig.onCellClick(contributionItem, event);
			}
			this.clearSelectedCell(cellEl.closest(".main"));
			cellEl
				.closest(".charts")
				?.querySelectorAll<HTMLButtonElement>("button.cell")
				.forEach((cell) => (cell.tabIndex = -1));
			cellEl.tabIndex = 0;
			cellEl.classList.add("is-selected");
			cellEl.setAttribute("aria-pressed", "true");

			if (activityContainer) {
				this.renderActivity(
					graphConfig,
					contributionItem,
					activityContainer
				);
			}
		};
	}

	setupCellKeyboardNavigation(chartsEl: HTMLElement): void {
		const cells = Array.from(
			chartsEl.querySelectorAll<HTMLButtonElement>(
				"button.cell:not(:disabled)"
			)
		);
		if (cells.length === 0) {
			return;
		}
		const initial =
			cells.find((cell) => cell.classList.contains("is-selected")) ||
			cells[cells.length - 1];
		cells.forEach((cell) => (cell.tabIndex = cell === initial ? 0 : -1));

		chartsEl.addEventListener("keydown", (event: KeyboardEvent) => {
			const target = event.target;
			if (!(target instanceof HTMLButtonElement)) {
				return;
			}
			const availableCells = Array.from(
				chartsEl.querySelectorAll<HTMLButtonElement>(
					"button.cell:not(:disabled)"
				)
			);
			const targetIndex = resolveCellNavigationIndex(
				availableCells.indexOf(target),
				availableCells.length,
				event.key
			);
			if (targetIndex === undefined) {
				return;
			}
			event.preventDefault();
			availableCells.forEach((cell, index) => {
				cell.tabIndex = index === targetIndex ? 0 : -1;
			});
			availableCells[targetIndex].focus();
		});
	}

	private applySelectedCellState(
		cellEl: HTMLElement,
		contributionItem: ContributionCellData,
		selectedDate?: string
	): void {
		const selected = selectedDate === this.getCellKey(contributionItem);
		cellEl.classList.toggle("is-selected", selected);
		cellEl.setAttribute("aria-pressed", selected ? "true" : "false");
	}

	getCellKey(cell: ContributionCellData): string {
		return cell.hour === undefined ? cell.date : `${cell.date}T${cell.hour}`;
	}

	private clearSelectedCell(root: Element | null): void {
		root
			?.querySelectorAll<HTMLElement>(".cell.is-selected")
			.forEach((cell) => {
				cell.classList.remove("is-selected");
				cell.setAttribute("aria-pressed", "false");
			});
	}

	bindCellTips(cellEl: HTMLElement, contributionItem: ContributionCellData) {
		if (contributionItem.future) {
			cellEl.ariaLabel = contributionItem.date;
			return;
		}
		if (contributionItem.trackingState === "UNTRACKED" || contributionItem.tracked === false) {
			cellEl.ariaLabel = Locals.get().graph_untracked_on.replace(
				"{date}",
				contributionItem.date
			);
			return;
		}
		if (contributionItem.trackingState === "PARTIAL") {
			const partial = Locals.get().graph_partially_tracked_on.replace("{date}", contributionItem.date);
			cellEl.ariaLabel = contributionItem.summary ? `${partial}. ${contributionItem.summary}` : partial;
			return;
		}
		if (
			contributionItem.tracked === true &&
			!contributionItem.summary
		) {
			cellEl.ariaLabel = Locals.get()
				.graph_edit_activity_summary.replace(
					"{date}",
					contributionItem.date
				)
				.replace("{added}", "0")
				.replace("{deleted}", "0")
				.replace("{changed}", "0")
				.replace("{percent}", "0");
			return;
		}
		const summary = contributionItem.summary
			? contributionItem.summary
			: `${contributionItem.value} contributions on ${contributionItem.date}.`;
		cellEl.ariaLabel = summary;
	}
}

function renderActivityItem(items: ContributionItem[], listMain: HTMLElement) {
	(items || []).slice(0, 10).forEach((item) => {
		const listItem = createDiv({
			cls: "activity-item",
			parent: listMain,
		});
		listItem.setAttribute("role", "listitem");

		const labelEl =
			item.link || item.open
				? createEl("a", {
						text: item.label,
						parent: listItem,
						cls: `label ${item.link?.className || ""}`,
				  })
				: createSpan({
						text: item.label,
						parent: listItem,
						cls: "label",
				  });
		labelEl.ariaLabel = item.label;
		if (item.link) {
			const link = item.link;
			labelEl.setAttribute("data-href", link.href || "#");
			labelEl.setAttribute("href", link.href || "#");
			labelEl.setAttribute("target", link.target || "_blank");
			labelEl.setAttribute("rel", link.rel || "noopener");
		}
		labelEl.onclick = (event) => {
			if (item.open) {
				event.preventDefault();
				item.open(event);
			}
		};
		if (item.description) {
			createSpan({
				text: item.description,
				parent: listItem,
				cls: "description",
			});
		}
	});
}
