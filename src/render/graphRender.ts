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
import { durationParts, getDetailHeading, getDocumentPresentation, getGraphContext, getGraphMetric } from "./graphPresentation";

export interface GraphRender {
	render(container: HTMLElement, graphConfig: ContributionGraphConfig): void;

	graphType(): string;
}

interface CellBinding { cell: ContributionCellData; config: ContributionGraphConfig; activity?: HTMLElement; }

export abstract class BaseGraphRender implements GraphRender {
	private readonly cellBindings = new WeakMap<HTMLElement, CellBinding>();
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
		const heading = createDiv({ cls: "graph-heading", parent: header });
		if (hasTitle) {
			this.renderTitle(graphConfig, heading);
		}
		createDiv({ cls: "graph-subtitle", parent: heading, text: getGraphContext(graphConfig, contributionData) });
		if (graphConfig.timeTracking && graphConfig.openWeeklyReview) {
			const button = header.createEl("button", { cls: "cg-weekly-review-entry", text: "周回顾", attr: {type: "button", "aria-label": "查看周回顾"} });
			button.onclick = () => graphConfig.openWeeklyReview?.(button.ownerDocument);
		}
		const metric = getGraphMetric(graphConfig, contributionData);
		const metricEl = createDiv({ cls: "cg-metric", parent });
		const valueEl = createDiv({ cls: "cg-metric-value", parent: metricEl, attr: { "aria-label": metric.text } });
		renderMetricParts(valueEl, metric.parts);
		valueEl.dataset.metricSignature = metricSignature(metric.parts);
		createDiv({ cls: "cg-metric-caption", parent: metricEl, text: metric.caption });
		const legend = createDiv({ cls: "graph-legend", parent });
		this.renderCellRuleIndicator(graphConfig, legend, contributionData);
		legend.dataset.renderSignature = legendSignature(graphConfig, contributionData, this.getCellRules(graphConfig));
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
		const legend = parent.querySelector(".graph-legend");
		if (legend) parent.appendChild(legend);
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
			graphConfig.selectedActivityDate = undefined;
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
		if (graphConfig.timeTracking) {
			this.renderTimeActivitySummary(graphConfig, cellData, contaienr);
		} else if (isEditActivity) {
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
		list.dataset.activityVisibleCount = String(Math.min(size, items.length));
		renderActivityItem(items.slice(0, size), list, graphConfig);

		const navigation = createDiv({
			cls: "activity-navigation",
			parent: content,
		});

		this.patchActivityNavigation(contaienr, navigation, list, items, graphConfig);
	}

	private renderTimeActivitySummary(config: ContributionGraphConfig, cell: ContributionCellData, parent: HTMLElement): void {
		const summary = createDiv({ cls: "activity-summary cg-detail-summary", parent });
		createDiv({ cls: "cg-detail-heading", parent: summary, text: getDetailHeading(cell) });
		const untracked = cell.trackingState === "UNTRACKED" || cell.tracked === false;
		const value = createDiv({ cls: "cg-detail-value", parent: summary });
		if (untracked) value.textContent = "未采集";
		else renderMetricParts(value, durationParts(cell.timeStats?.seconds ?? cell.value * 60));
		const goal = config.heatScale?.goal;
		const meta = goal && cell.hour === undefined ? `每日目标 ${goal} 分钟 · 已完成 ${Math.round(cell.value / goal * 100)}%` : "阅读与编辑的活跃使用时长";
		createDiv({ cls: "cg-detail-meta", parent: summary, text: meta });
		const warnings: string[] = [];
		if (untracked) warnings.push("该时段未采集数据，不代表没有活动。");
		if (cell.trackingState === "PARTIAL") warnings.push("该时段仅部分时间处于采集范围内。");
		if (cell.timeStats?.policyChanged) warnings.push("当日调整过空闲阈值，记录按各时段规则累计。");
		if (warnings.length) createDiv({ cls: "activity-warnings", parent: summary, text: warnings.join(" ") });
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

	bindCellClickEvent(cellEl: HTMLElement, contributionItem: ContributionCellData, graphConfig: ContributionGraphConfig, activityContainer?: HTMLElement): void {
		const existing = this.cellBindings.get(cellEl);
		if (existing) {
			Object.assign(existing, {cell: contributionItem, config: graphConfig, activity: activityContainer});
			return;
		}
		const binding = {cell: contributionItem, config: graphConfig, activity: activityContainer};
		this.cellBindings.set(cellEl, binding);
		if (cellEl instanceof HTMLButtonElement) {
			cellEl.type = "button";
			cellEl.disabled = Boolean(contributionItem.future);
		} else {
			cellEl.setAttribute("role", "button");
			cellEl.tabIndex = 0;
			cellEl.onkeydown = event => {
				if (event.key === "Enter" || event.key === " ") { event.preventDefault(); cellEl.click(); }
			};
		}
		this.applySelectedCellState(cellEl, contributionItem, graphConfig.selectedActivityDate);
		cellEl.onclick = event => this.handleCellClick(cellEl, binding, event);
	}

	private handleCellClick(cellEl: HTMLElement, binding: CellBinding, event: MouseEvent): void {
		const {cell, config, activity} = binding;
		if (cell.future) return;
		config.selectedActivityDate = this.getCellKey(cell);
		config.onCellClick?.(cell, event);
		this.clearSelectedCell(cellEl.closest(".main"));
		cellEl.closest(".charts")?.querySelectorAll<HTMLButtonElement>("button.cell").forEach(node => node.tabIndex = -1);
		cellEl.tabIndex = 0;
		cellEl.classList.add("is-selected");
		cellEl.setAttribute("aria-pressed", "true");
		if (activity) this.renderActivity(config, cell, activity);
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

	/** 原位更新一个字数格子，保留其 DOM 节点。 */
	patchContributionCell(
		cellEl: HTMLElement,
		contributionItem: ContributionCellData,
		graphConfig: ContributionGraphConfig,
		activityContainer?: HTMLElement
	): void {
		const template = cellEl.ownerDocument.createElement("button");
		template.className = contributionItem.value === 0 ? "cell empty" : "cell";
		this.applyCellGlobalStyle(template, graphConfig);
		this.applyCellStyleRule(template, contributionItem, this.getCellRules(graphConfig), graphConfig,
			contributionItem.value === 0 ? undefined : () => this.getCellRules(graphConfig)[0]);
		this.bindCellAttribute(template, contributionItem);
		this.bindCellTips(template, contributionItem);
		template.disabled = Boolean(contributionItem.future);
		const selected = cellEl.classList.contains("is-selected") && !contributionItem.future;
		template.classList.toggle("is-selected", selected);
		template.setAttribute("aria-pressed", String(selected));
		for (const name of ["class", "style", "aria-label", "disabled", "data-year", "data-month", "data-date", "aria-pressed"]) {
			const value = template.getAttribute(name);
			if (value === cellEl.getAttribute(name)) continue;
			if (value === null) cellEl.removeAttribute(name); else cellEl.setAttribute(name, value);
		}
		if (cellEl.textContent !== template.textContent) cellEl.textContent = template.textContent;
		this.bindCellClickEvent(cellEl, contributionItem, graphConfig, activityContainer);
	}

	/** 数据变化后原位更新稳定的页眉与详情节点。 */
	patchContributionSummary(
		main: HTMLElement,
		graphConfig: ContributionGraphConfig,
		cells: ContributionCellData[],
		activityContainer: HTMLElement,
		metricOverride?: ReturnType<typeof getGraphMetric>
	): void {
		const metric = metricOverride || getGraphMetric(graphConfig, cells);
		const metricValue = main.querySelector<HTMLElement>(".cg-metric-value");
		const metricKey = metricSignature(metric.parts);
		if (metricValue && metricValue.dataset.metricSignature !== metricKey) {
			patchMetricParts(metricValue, metric.parts);
			metricValue.dataset.metricSignature = metricKey;
			metricValue.ariaLabel = metric.text;
		}
		const caption = main.querySelector<HTMLElement>(".cg-metric-caption");
		if (caption && caption.textContent !== metric.caption) caption.textContent = metric.caption;
		const subtitle = main.querySelector<HTMLElement>(".graph-subtitle");
		const context = getGraphContext(graphConfig, cells);
		if (subtitle && subtitle.textContent !== context) subtitle.textContent = context;
		const legend = main.querySelector<HTMLElement>(".graph-legend");
		const legendKey = legendSignature(graphConfig, cells, this.getCellRules(graphConfig));
		if (legend && legend.dataset.renderSignature !== legendKey) {
			legend.replaceChildren();
			this.renderCellRuleIndicator(graphConfig, legend, cells);
			legend.dataset.renderSignature = legendKey;
		}
		if (graphConfig.selectedActivityDate) {
			const selected = cells.find(cell => this.getCellKey(cell) === graphConfig.selectedActivityDate);
			if (selected) this.patchActivity(graphConfig, selected, activityContainer);
		}
	}

	patchActivity(
		graphConfig: ContributionGraphConfig,
		cellData: ContributionCellData,
		container: HTMLElement
	): void {
		const summary = container.querySelector<HTMLElement>(".activity-summary");
		if (!summary) {
			this.renderActivity(graphConfig, cellData, container);
			return;
		}
		if (graphConfig.timeTracking) {
			const heading = summary.querySelector<HTMLElement>(".cg-detail-heading");
			const headingText = getDetailHeading(cellData);
			if (heading && heading.textContent !== headingText) heading.textContent = headingText;
			const value = summary.querySelector<HTMLElement>(".cg-detail-value");
			if (value) {
				if (cellData.trackingState === "UNTRACKED" || cellData.tracked === false) {
					if (value.textContent !== "未采集") value.textContent = "未采集";
					delete value.dataset.metricSignature;
				} else {
					const parts = durationParts(cellData.timeStats?.seconds ?? cellData.value * 60);
					if (value.dataset.metricSignature !== metricSignature(parts) || value.children.length !== parts.length * 2) {
						patchMetricParts(value, parts);
						value.dataset.metricSignature = metricSignature(parts);
					}
				}
			}
			const meta = summary.querySelector<HTMLElement>(".cg-detail-meta");
			const goal = graphConfig.heatScale?.goal;
			const metaText = goal && cellData.hour === undefined ? `每日目标 ${goal} 分钟 · 已完成 ${Math.round(cellData.value / goal * 100)}%` : "阅读与编辑的活跃使用时长";
			if (meta && meta.textContent !== metaText) meta.textContent = metaText;
		} else {
			const date = summary.querySelector<HTMLElement>(".activity-date");
			if (date && date.textContent !== cellData.date) date.textContent = cellData.date;
			this.patchEditSummary(summary, cellData, graphConfig);
		}
		this.patchActivityWarnings(summary, cellData, graphConfig);
		this.patchActivityItems(container, cellData.items || [], graphConfig);
	}

	private patchEditSummary(
		summary: HTMLElement,
		cellData: ContributionCellData,
		graphConfig: ContributionGraphConfig
	): void {
		const untracked = cellData.trackingState === "UNTRACKED" || cellData.tracked === false;
		if (untracked) { summary.querySelector(".activity-stats")?.remove(); return; }
		if (!summary.querySelector(".activity-stats")) {
			const draft = summary.ownerDocument.createElement("div");
			this.renderEditActivitySummary(graphConfig, cellData, draft, cellData.summary || "");
			const stats = draft.querySelector(".activity-stats");
			if (stats) summary.insertBefore(stats, summary.querySelector(".activity-warnings"));
		}
		const stats = cellData.editStats || {addedChars: 0, deletedChars: 0, changedChars: 0};
		const values: Record<string, string> = {
			added: stats.addedChars.toLocaleString(),
			deleted: stats.deletedChars.toLocaleString(),
			changed: stats.changedChars.toLocaleString(),
			goal: `${Math.round((cellData.value / Math.max(1, graphConfig.heatScale?.goal || 1000)) * 100)}%`,
		};
		for (const [name, value] of Object.entries(values)) {
			const node = summary.querySelector<HTMLElement>(`.activity-stat.${name} .activity-stat-value`);
			if (node && node.textContent !== value) node.textContent = value;
		}
	}

	private patchActivityWarnings(
		summary: HTMLElement,
		cellData: ContributionCellData,
		graphConfig: ContributionGraphConfig
	): void {
		const messages: string[] = [];
		const untracked = cellData.trackingState === "UNTRACKED" || cellData.tracked === false;
		if (graphConfig.timeTracking) {
			if (untracked) messages.push("该时段未采集数据，不代表没有活动。");
			if (cellData.trackingState === "PARTIAL") messages.push("该时段仅部分时间处于采集范围内。");
			if (cellData.timeStats?.policyChanged) messages.push("当日调整过空闲阈值，记录按各时段规则累计。");
		} else {
			if (untracked) messages.push(Locals.get().graph_untracked_on.replace("{date}", cellData.date));
			if (cellData.trackingState === "PARTIAL") messages.push(Locals.get().graph_partially_tracked_on.replace("{date}", cellData.date));
			if (cellData.editStats?.countingPolicyChanged) messages.push(Locals.get().graph_counting_policy_changed);
			const legacyWarning = Locals.get().graph_folder_legacy_excluded;
			if (cellData.summary?.includes(legacyWarning)) messages.push(legacyWarning);
		}
		let warning = summary.querySelector<HTMLElement>(".activity-warnings");
		if (!warning && messages.length > 0) warning = createDiv({cls: "activity-warnings", parent: summary});
		if (!warning) return;
		const signature = messages.join("\n");
		if (graphConfig.timeTracking) {
			const text = messages.join(" ");
			if (warning.textContent !== text || warning.childElementCount) warning.textContent = text;
		} else if (warning.dataset.signature !== signature) {
			warning.replaceChildren(...messages.map(message => createDiv({text: message})));
			warning.dataset.signature = signature;
		}
		const hidden = messages.length === 0;
		if (warning.hidden !== hidden) warning.hidden = hidden;
	}

	private patchActivityItems(
		container: HTMLElement,
		items: ContributionItem[],
		graphConfig: ContributionGraphConfig,
		requestedCount?: number
	): void {
		let content = container.querySelector<HTMLElement>(".activity-content");
		if (!items.length) {
			content?.remove();
			return;
		}
		if (!content) content = createDiv({cls: "activity-content", parent: container});
		let list = content.querySelector<HTMLElement>(".activity-list");
		if (!list) {
			list = createDiv({cls: "activity-list", parent: content, attr: {role: "list", tabindex: "0"}});
		}
		const oldRows = Array.from(list.querySelectorAll<HTMLElement>(".activity-item"));
		const currentCount = Number(list.dataset.activityVisibleCount || oldRows.length);
		const targetCount = Math.max(10, requestedCount ?? currentCount);
		const scrollTop = list.scrollTop;
		const focused = list.ownerDocument.activeElement as HTMLElement | null;
		const rowsByKey = new Map<string, HTMLElement[]>();
		for (const row of oldRows) {
			const key = row.dataset.activityKey || row.querySelector<HTMLElement>(".label")?.getAttribute("title") || "";
			const rows = rowsByKey.get(key) || [];
			rows.push(row);
			rowsByKey.set(key, rows);
		}
		const visibleItems = items.slice(0, targetCount);
		for (const [index, item] of visibleItems.entries()) {
			const rows = rowsByKey.get(item.label) || [];
			const row = rows.shift() || createActivityItem(item, list, graphConfig);
			this.patchActivityRow(row, item, graphConfig);
			const current = list.children[index] as HTMLElement | undefined;
			if (current !== row) list.insertBefore(row, current || null);
		}
		for (const rows of rowsByKey.values()) rows.forEach(row => row.remove());
		if (list.dataset.activityVisibleCount !== String(targetCount)) list.dataset.activityVisibleCount = String(targetCount);
		const label = Locals.get().graph_edit_activity_document_history.replace("{count}", String(items.length));
		if (list.getAttribute("aria-label") !== label) list.setAttribute("aria-label", label);
		let navigation = content.querySelector<HTMLElement>(".activity-navigation");
		if (!navigation) navigation = createDiv({cls: "activity-navigation", parent: content});
		this.patchActivityNavigation(container, navigation, list, items, graphConfig);
		list.scrollTop = scrollTop;
		if (focused && list.contains(focused)) focused.focus({preventScroll: true});
	}

	private patchActivityNavigation(
		container: HTMLElement,
		navigation: HTMLElement,
		list: HTMLElement,
		items: ContributionItem[],
		graphConfig: ContributionGraphConfig
	): void {
		const visibleCount = Number(list.dataset.activityVisibleCount || list.querySelectorAll(".activity-item").length);
		let loadMore = navigation.querySelector<HTMLAnchorElement>(".activity-load-more");
		if (visibleCount >= items.length) {
			loadMore?.remove();
			return;
		}
		if (!loadMore) {
			loadMore = createEl("a", {text: Locals.get().click_to_load_more, href: "#", parent: navigation});
			loadMore.classList.add("activity-load-more");
		}
		loadMore.onclick = event => {
			event.preventDefault();
			const previousScrollHeight = list.scrollHeight;
			this.patchActivityItems(container, items, graphConfig, visibleCount + 10);
			list.scrollTo({top: Math.max(0, previousScrollHeight - 16), behavior: "smooth"});
		};
	}

	private patchActivityRow(row: HTMLElement, item: ContributionItem, graphConfig: ContributionGraphConfig): void {
		if (row.dataset.activityKey !== item.label) row.dataset.activityKey = item.label;
		const presentation = getDocumentPresentation(item, Boolean(graphConfig.timeTracking), graphConfig.valueUnit);
		const main = row.querySelector<HTMLElement>(".cg-document-main")!;
		const name = patchActivityLabel(main, item);
		if (name.textContent !== presentation.name) name.textContent = presentation.name;
		patchOptionalText(main, "cg-document-path", presentation.path);
		patchOptionalText(main, "cg-document-description", presentation.detail, "description");
		const value = row.querySelector<HTMLElement>(".cg-document-value");
		if (value && value.textContent !== presentation.value) value.textContent = presentation.value;
	}

}

function patchOptionalText(parent: HTMLElement, cls: string, text?: string, extra = ""): void {
	let node = parent.querySelector<HTMLElement>(`.${cls}`);
	if (!text) { node?.remove(); return; }
	if (!node) node = createSpan({cls: `${cls} ${extra}`.trim(), parent});
	if (node.textContent !== text) node.textContent = text;
}

function patchActivityLabel(parent: HTMLElement, item: ContributionItem): HTMLElement {
	let label = parent.querySelector<HTMLElement>(".label")!;
	const tag = item.link || item.open ? "A" : "SPAN";
	if (label.tagName !== tag) {
		const focused = label === label.ownerDocument.activeElement;
		const replacement = createActivityLabel(item, parent);
		replacement.classList.add("cg-document-name");
		label.replaceWith(replacement);
		label = replacement;
		if (focused) label.focus({preventScroll: true});
	}
	const cls = `label ${item.link?.className || ""} cg-document-name`.replace(/\s+/g, " ").trim();
	if (label.className !== cls) label.className = cls;
	const attributes: Record<string, string | undefined> = {"aria-label": item.label, title: item.label,
		"data-href": item.link ? item.link.href || "#" : undefined, href: item.link ? item.link.href || "#" : item.open ? "#" : undefined,
		target: item.link ? item.link.target || "_blank" : undefined, rel: item.link ? item.link.rel || "noopener" : undefined};
	for (const [name, value] of Object.entries(attributes)) {
		if (label.getAttribute(name) === (value ?? null)) continue;
		if (value === undefined) label.removeAttribute(name); else label.setAttribute(name, value);
	}
	label.onclick = event => { if (item.open) { event.preventDefault(); void item.open(event); } };
	return label;
}

function metricSignature(parts: { value: string; unit: string }[]): string {
	return JSON.stringify(parts);
}

function legendSignature(
	config: ContributionGraphConfig,
	cells: ContributionCellData[],
	rules: CellStyleRule[]
): string {
	return JSON.stringify({
		show: config.showCellRuleIndicators,
		rules,
		heatScale: config.heatScale,
		states: {
			untracked: cells.some(cell => cell.trackingState === "UNTRACKED" || cell.tracked === false),
			partial: cells.some(cell => cell.trackingState === "PARTIAL"),
			future: cells.some(cell => cell.future),
		},
	});
}

function patchMetricParts(parent: HTMLElement, parts: { value: string; unit: string }[]): void {
	parts.forEach((part, index) => {
		const numberIndex = index * 2;
		let number = parent.children[numberIndex] as HTMLElement | undefined;
		if (!number || !number.classList.contains("cg-metric-number")) {
			number = createSpan({cls: "cg-metric-number"});
			parent.insertBefore(number, parent.children[numberIndex] || null);
		}
		if (number.textContent !== part.value) number.textContent = part.value;
		let unit = parent.children[numberIndex + 1] as HTMLElement | undefined;
		if (!unit || !unit.classList.contains("cg-metric-unit")) {
			unit = createSpan({cls: "cg-metric-unit"});
			parent.insertBefore(unit, parent.children[numberIndex + 1] || null);
		}
		if (unit.textContent !== part.unit) unit.textContent = part.unit;
	});
	while (parent.children.length > parts.length * 2) parent.lastElementChild?.remove();
}

function renderMetricParts(parent: HTMLElement, parts: { value: string; unit: string }[]): void {
	for (const part of parts) {
		createSpan({ cls: "cg-metric-number", parent, text: part.value });
		createSpan({ cls: "cg-metric-unit", parent, text: part.unit });
	}
}

function renderActivityItem(items: ContributionItem[], listMain: HTMLElement, config: ContributionGraphConfig): void {
	for (const item of items.slice(0, 10)) createActivityItem(item, listMain, config);
}

function createActivityItem(item: ContributionItem, listMain: HTMLElement, config: ContributionGraphConfig): HTMLElement {
	const listItem = createDiv({ cls: "activity-item", parent: listMain, attr: { role: "listitem" } });
	listItem.dataset.activityKey = item.label;
	const main = createDiv({ cls: "cg-document-main", parent: listItem });
	const presentation = getDocumentPresentation(item, Boolean(config.timeTracking), config.valueUnit);
	const label = createActivityLabel(item, main);
	label.classList.add("cg-document-name");
	label.textContent = presentation.name;
	if (presentation.path) createSpan({ cls: "cg-document-path", parent: main, text: presentation.path });
	if (presentation.detail) createSpan({ cls: "description cg-document-description", parent: main, text: presentation.detail });
	createSpan({ cls: "cg-document-value", parent: listItem, text: presentation.value });
	return listItem;
}

function createActivityLabel(item: ContributionItem, parent: HTMLElement): HTMLElement {
	const label = item.link || item.open
		? createEl("a", { parent, cls: `label ${item.link?.className || ""}` })
		: createSpan({ parent, cls: "label" });
	label.ariaLabel = item.label;
	label.title = item.label;
	if (item.link) {
		label.setAttribute("data-href", item.link.href || "#");
		label.setAttribute("href", item.link.href || "#");
		label.setAttribute("target", item.link.target || "_blank");
		label.setAttribute("rel", item.link.rel || "noopener");
	}
	else if (item.open) label.setAttribute("href", "#");
	label.onclick = event => {
		if (!item.open) return;
		event.preventDefault();
		void item.open(event);
	};
	return label;
}
