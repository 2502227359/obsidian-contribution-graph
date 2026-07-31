import { DEFAULT_RULES } from "src/constants";
import {
	ContributionGraphConfig,
	ContributionCellData,
	CellStyleRule,
	ContributionItem,
} from "src/types";
import { parseDate } from "src/util/dateUtils";
import {
	generateByLatestDays,
	generateByFixedDate,
	generateByData,
} from "./matrixDataGenerator";
import { matchCellStyleRule } from "src/util/utils";
import { Locals } from "src/i18/messages";
import { resolveGoalHeatLevel } from "./heatScale";

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

		const main = createDiv({
			cls: cls,
			parent: parent,
		});
		if (graphConfig.mainContainerStyle) {
			Object.assign(main.style, graphConfig.mainContainerStyle);
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

	renderCellRuleIndicator(
		graphConfig: ContributionGraphConfig,
		parent: HTMLElement
	) {
		if (graphConfig.showCellRuleIndicators === false) {
			return;
		}

		const cellRuleIndicatorContainer = createDiv({
			cls: "cell-rule-indicator-container",
			parent: parent,
		});
		const cellRules = this.getCellRules(graphConfig);
		createDiv({
			cls: "cell text",
			text: Locals.get().graph_less,
			parent: cellRuleIndicatorContainer,
		});

		if (graphConfig.heatScale?.type === "GOAL") {
			[...graphConfig.heatScale.levels]
				.sort((a, b) => a.minRatio - b.minRatio)
				.forEach((level) => {
					const cellEl = createDiv({
						cls: ["cell"],
						parent: cellRuleIndicatorContainer,
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
					parent: cellRuleIndicatorContainer,
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
			parent: cellRuleIndicatorContainer,
		});
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
			text: "x",
			parent: contaienr,
		});

		closeButton.onclick = () => {
			contaienr.empty();
			graphConfig.onActivityClose?.();
		};

		let summary = cellData.summary;
		if (cellData.tracked === false) {
			summary = Locals.get().graph_untracked_on.replace(
				"{date}",
				cellData.date
			);
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
		createDiv({
			cls: "activity-summary",
			parent: contaienr,
			text: summary,
		});

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
			(item) => item.date === graphConfig.selectedActivityDate
		);
		if (selected) {
			this.renderActivity(graphConfig, selected, activityContainer);
		}
	}

	generateContributionData(graphConfig: ContributionGraphConfig) {
		if (graphConfig.days) {
			return generateByLatestDays(
				graphConfig.days,
				graphConfig.data,
				graphConfig.trackingPeriods
			);
		} else if (graphConfig.fromDate && graphConfig.toDate) {
			const fromDate = parseDate(graphConfig.fromDate);
			const toDate = parseDate(graphConfig.toDate);
			return generateByFixedDate(
				fromDate,
				toDate,
				graphConfig.data,
				graphConfig.trackingPeriods
			);
		} else {
			return generateByData(
				graphConfig.data,
				graphConfig.trackingPeriods
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
		if (contributionItem.future) {
			cellEl.style.backgroundColor = "";
			cellEl.addClass("future");
			return;
		}
		if (contributionItem.tracked === false) {
			cellEl.style.backgroundColor = "";
			cellEl.addClass("untracked");
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
			return;
		}
		cellEl.onclick = (event: MouseEvent) => {
			if (graphConfig.onCellClick) {
				graphConfig.onCellClick(contributionItem, event);
			}

			if (activityContainer) {
				this.renderActivity(
					graphConfig,
					contributionItem,
					activityContainer
				);
			}
		};
	}

	bindCellTips(cellEl: HTMLElement, contributionItem: ContributionCellData) {
		if (contributionItem.future) {
			cellEl.ariaLabel = contributionItem.date;
			return;
		}
		if (contributionItem.tracked === false) {
			cellEl.ariaLabel = Locals.get().graph_untracked_on.replace(
				"{date}",
				contributionItem.date
			);
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
