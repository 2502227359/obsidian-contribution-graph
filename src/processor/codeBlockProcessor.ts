import {
	App,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	Platform,
	TFile,
	TFolder,
	parseYaml,
} from "obsidian";
import { getAPI } from "obsidian-dataview";
import { getActivityDateRange } from "src/activity/dateRange";
import { clampEditPosition } from "src/activity/editPosition";
import { EditActivityChangeEvent, EditActivityService } from "src/activity/EditActivityService";
import { areFoldersCoveredByScope, normalizeTrackedFolders } from "src/activity/folderScope";
import {
	getEditActivityMetricValue,
	sortEditActivityStatsByMetric,
} from "src/activity/metrics";
import { Locals } from "src/i18/messages";
import { CompositeDataSourceQuery } from "src/query/compositeDataSourceQuery";
import { Renders } from "src/render/renders";
import { Contribution, ContributionCellData, ContributionGraphConfig, ContributionItem } from "src/types";
import { MISS_CONFIG } from "./bizErrors";
import { GraphProcessError } from "./graphProcessError";
import { YamlGraphConfig } from "./types";
import { YamlConfigReconciler } from "./yamlConfigReconciler";
import { queryTimeGraph, TimeGraphSelection } from "../time/timeGraphData";
import { GraphRefreshScheduler } from "./graphRefreshScheduler";
import { getGraphChange, GraphViewState } from "./graphChanges";
import { mergeGraphRows } from "./activityGraphData";
import { getHourlyWeek, groupHourlyData } from "../render/hourlyData";
import { createDefaultGoalHeatScale, TIME_HOURLY_RULES } from "src/constants";
import { createActivityTimelineOptions } from "../view/ActivityTimelineModal";
import {
	DataviewIndexTimeoutError,
	isAbortError,
	waitForDataviewIndex,
} from "./dataviewReady";

class ProcessorLifecycleRenderChild extends MarkdownRenderChild {
	constructor(container: HTMLElement, private readonly dispose: () => void) {
		super(container);
	}

	onunload(): void {
		this.dispose();
	}
}

class ReactiveGraphRenderChild extends MarkdownRenderChild {
	constructor(container: HTMLElement, private readonly scheduler: GraphRefreshScheduler) { super(container); }
	onload(): void { this.scheduler.start(); }
	onunload(): void { this.scheduler.stop(); }
}

export class CodeBlockProcessor {
	dataSourceQuery: CompositeDataSourceQuery = new CompositeDataSourceQuery();
	private selectedActivityDate?: string;
	private readonly abortController = new AbortController();
	private disposed = false;
	private queriedData: Contribution[] = [];
	private queriedHours: ContributionCellData[] = [];
	private currentConfig?: ContributionGraphConfig;
	private rangeKey?: string;
	private requestedView?: GraphViewState;
	private renderedContainer?:HTMLElement;

	constructor(private readonly activityService: EditActivityService, private readonly openWeeklyReview?: (owner: Document) => void) {}

	async renderFromCodeBlock(
		code: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
		app: App
	) {
		ctx.addChild(
			new ProcessorLifecycleRenderChild(el, () => this.dispose())
		);
		try {
			const graphConfig: YamlGraphConfig = this.loadYamlConfig(el, code);
			await this.renderFromYaml(graphConfig, el, app);

			if (
				!this.disposed &&
				["EDIT_ACTIVITY", "TIME_ACTIVITY"].includes(graphConfig.dataSource?.type)&&graphConfig.graphType!=="timeline"
			) {
				ctx.addChild(new ReactiveGraphRenderChild(el, new GraphRefreshScheduler({
					container: el,
					hourly: graphConfig.graphType === "hourly",
					subscribe: listener => this.activityService.subscribe(listener),
					accept: event => Boolean(getGraphChange(event, graphConfig, this.readViewState(el))),
					refresh: events => this.refreshGraph(events, graphConfig, el, app),
				})));
			}
		} catch (error) {
			if (this.disposed || isAbortError(error)) {
				return;
			}
			this.renderError(el, error);
		}
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.abortController.abort();
		if(this.renderedContainer)Renders.dispose(this.renderedContainer);
	}

	async renderFromYaml(
		graphConfig: YamlGraphConfig,
		el: HTMLElement,
		app: App,
		selection?: TimeGraphSelection
	): Promise<void> {
		try {
			YamlGraphConfig.validate(graphConfig);
			if (!["EDIT_ACTIVITY", "TIME_ACTIVITY"].includes(graphConfig.dataSource?.type)) {
				await this.ensureDataviewReady(app);
			}
			if (this.disposed) {
				return;
			}
			this.renderedContainer=el;

			this.updateQueryCache(graphConfig, app, selection);
			const contributionConfig = YamlGraphConfig.toContributionGraphConfig(this.buildRenderConfig(graphConfig));
			contributionConfig.openWeeklyReview = this.openWeeklyReview;
			this.bindActivityState(contributionConfig, graphConfig, el, app);
			if(graphConfig.graphType==="timeline")contributionConfig.activityTimeline=createActivityTimelineOptions(app,this.activityService,contributionConfig,el.ownerDocument);
			if (!this.currentConfig || !Renders.update(el, contributionConfig)) Renders.render(el, contributionConfig);
			this.currentConfig = contributionConfig;
			this.requestedView = undefined;
		} catch (error) {
			if (this.disposed || isAbortError(error)) {
				return;
			}
			this.requestedView = undefined;
			this.renderError(el, error);
		}
	}

	private buildRenderConfig(graphConfig: YamlGraphConfig): YamlGraphConfig {
		const renderConfig: YamlGraphConfig = {
			...graphConfig,
			dataSource: { ...graphConfig.dataSource },
			data: [...(graphConfig.data || []), ...this.queriedData],
		};
		if (graphConfig.dataSource?.type === "TIME_ACTIVITY") {
			renderConfig.data = this.queriedData;
			renderConfig.hourlyData = this.queriedHours;
			renderConfig.timeTracking = true;
			renderConfig.activityFolders = normalizeTrackedFolders(graphConfig.dataSource.folders || []);
			renderConfig.valueUnit = "分钟";
			if (graphConfig.graphType === "hourly") {
				renderConfig.heatScale = undefined;
				renderConfig.cellStyleRules = graphConfig.cellStyleRules || TIME_HOURLY_RULES;
			}
			if (!["hourly","timeline"].includes(graphConfig.graphType)) renderConfig.heatScale = graphConfig.heatScale || createDefaultGoalHeatScale(60);
			if(graphConfig.graphType==="timeline")renderConfig.heatScale=undefined;
		}

		if (graphConfig.dataSource?.type === "EDIT_ACTIVITY") {
			renderConfig.trackingPeriods =
				this.activityService.getTrackingPeriods();
			renderConfig.collectionScopePeriods =
				this.activityService.getCollectionScopePeriods();
			renderConfig.activityFolders = normalizeTrackedFolders(
				graphConfig.dataSource.folders || []
			);
			renderConfig.valueUnit = Locals.get().graph_characters_unit;
		}

		return renderConfig;
	}

	private bindActivityState(contributionConfig: ContributionGraphConfig, graphConfig: YamlGraphConfig, el: HTMLElement, app: App): void {
		if (["EDIT_ACTIVITY", "TIME_ACTIVITY"].includes(graphConfig.dataSource?.type)) {
			contributionConfig.selectedActivityDate =
				this.selectedActivityDate;
			contributionConfig.onCellClick = (cellData) => {
				this.selectedActivityDate = cellData.hour === undefined ? cellData.date : `${cellData.date}T${cellData.hour}`;
			};
			contributionConfig.onActivityClose = () => {
				this.selectedActivityDate = undefined;
			};
		}

		contributionConfig.hourlyViewState = this.readViewState(el);
		if (graphConfig.graphType === "hourly") contributionConfig.onHourlyViewChange = state => {
			contributionConfig.hourlyViewState = state;
			this.requestedView = state;
			this.currentConfig = contributionConfig;
			const dates = this.visibleDates(state);
			void this.renderFromYaml(graphConfig, el, app, {dates});
		};
	}

	loadYamlConfig(_el: HTMLElement, code: string): YamlGraphConfig {
		if (code == null || code.trim() == "") {
			throw new GraphProcessError(MISS_CONFIG());
		}

		try {
			const yamlConfig: YamlGraphConfig = parseYaml(code);
			return YamlConfigReconciler.reconcile(yamlConfig);
		} catch (error) {
			const yamlError = error as { mark?: { line?: number } };
			if (yamlError.mark?.line !== undefined) {
				throw new GraphProcessError({
					summary:
						"yaml parse error at line " +
						(yamlError.mark.line + 1) +
						", please check the format",
				});
			}
			throw new GraphProcessError({
				summary:
					"content parse error, please check the format(such as blank, indent)",
			});
		}
	}

	private queryData(graphConfig: YamlGraphConfig, app: App): Contribution[] {
		if (graphConfig.dataSource?.type === "TIME_ACTIVITY") return [];
		if (graphConfig.dataSource?.type === "EDIT_ACTIVITY") {
			const folders = normalizeTrackedFolders(
				graphConfig.dataSource.folders || []
			);
			for (const folder of folders) {
				if (!(app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
					throw new GraphProcessError({
						summary: Locals.get().graph_folder_missing.replace("{folder}", folder),
					});
				}
				if (!areFoldersCoveredByScope([folder], this.activityService.getSettings().trackedFolders)) {
					throw new GraphProcessError({
						summary: Locals.get().graph_folder_outside_scope.replace("{folder}", folder),
					});
				}
			}
			const metric =
				graphConfig.dataSource.metric || "CHANGED_CHARS";
			const goal = Math.max(1, graphConfig.heatScale?.goal || 1000);
			return this.activityService
				.getDailyEditStats({
					...getActivityDateRange(graphConfig),
					folders,
				})
				.map((stats) => {
				const value = getEditActivityMetricValue(metric, stats);
				const documents = sortEditActivityStatsByMetric(
					metric,
					stats.documents
				);
				const items: ContributionItem[] = documents.map(
					(document) => {
						const file = app.vault.getAbstractFileByPath(
							document.path
						);
						const characterSummary = Locals.get()
							.graph_edit_activity_document_summary.replace(
								"{added}",
								document.addedChars.toString()
							)
							.replace(
								"{deleted}",
								document.deletedChars.toString()
							)
							.replace(
								"{changed}",
								document.changedChars.toString()
							);
						const positionSummary = document.lastEditPosition
							? Locals.get()
									.graph_edit_activity_last_position.replace(
										"{line}",
										(
											document.lastEditPosition.line + 1
										).toString()
									)
									.replace(
										"{column}",
										(
											document.lastEditPosition.column + 1
										).toString()
									)
							: undefined;
						return {
							label: document.path,
							value: getEditActivityMetricValue(
								metric,
								document
							),
							description: positionSummary
								? `${characterSummary} · ${positionSummary}`
								: characterSummary,
							link:
								file instanceof TFile
									? {
											href: document.path,
											className: "internal-link",
											rel: "noopener",
									  }
									: undefined,
							open:
								file instanceof TFile
									? async (event: MouseEvent) => {
											const position =
												await this.resolveCurrentPosition(
													app,
													file,
													document.lastEditPosition
												);
											const openViewState = position
												? {
														eState: {
															cursor: {
																from: {
																	line: position.line,
																	ch: position.column,
																},
																to: {
																	line: position.line,
																	ch: position.column,
																},
															},
															line: position.line,
														},
												  }
												: undefined;
											void app.workspace.openLinkText(
												document.path,
												"",
												event.ctrlKey ||
													(event.metaKey &&
														Platform.isMacOS),
												openViewState as any
											);
									  }
									: undefined,
						};
					}
				);
				const unattributedAdded = stats.unattributedAddedChars || 0;
				const unattributedDeleted = stats.unattributedDeletedChars || 0;
				if (folders.length === 0 && (unattributedAdded > 0 || unattributedDeleted > 0)) {
					items.push({
						label:
							Locals.get()
								.graph_edit_activity_unattributed_document,
						value: unattributedAdded + unattributedDeleted,
						description: Locals.get()
							.graph_edit_activity_document_summary.replace(
								"{added}",
								unattributedAdded.toString()
							)
							.replace(
								"{deleted}",
								unattributedDeleted.toString()
							)
							.replace(
								"{changed}",
								(
									unattributedAdded + unattributedDeleted
								).toString()
						),
					});
				}
				let baseSummary = Locals.get()
					.graph_edit_activity_summary.replace("{date}", stats.date)
					.replace("{added}", stats.addedChars.toString())
					.replace("{deleted}", stats.deletedChars.toString())
					.replace("{changed}", stats.changedChars.toString())
					.replace("{percent}", Math.round((value / goal) * 100).toString());
				if (stats.countingPolicyChanged) {
					baseSummary = `${baseSummary} ${Locals.get().graph_counting_policy_changed}`;
				}
				return {
					date: stats.date,
					value,
					editStats: stats,
					items,
					summary:
						folders.length > 0 && (unattributedAdded > 0 || unattributedDeleted > 0)
							? `${baseSummary} ${Locals.get().graph_folder_legacy_excluded}`
							: baseSummary,
				};
				});
		}

		return this.dataSourceQuery.query(graphConfig.dataSource, app);
	}

	private readViewState(el: HTMLElement): GraphViewState | undefined {
		if (this.requestedView) return this.requestedView;
		const chart = el.querySelector<HTMLElement>(".charts.hourly-profile");
		if (!chart) return this.currentConfig?.hourlyViewState;
		return {view: chart.dataset.view === "week" ? "week" : "day", date: chart.dataset.selectedDate || ""};
	}

	private visibleDates(state: GraphViewState): string[] {
		const days = groupHourlyData(this.queriedHours);
		return state.view === "week" ? getHourlyWeek(days, state.date).map(day => day.date) : [state.date];
	}

	private refreshGraph(events: EditActivityChangeEvent[], config: YamlGraphConfig, el: HTMLElement, app: App): void {
		if (this.disposed) return;
		const state = this.readViewState(el);
		const changes = events.map(event => getGraphChange(event, config, state)).filter(Boolean);
		if (!changes.length) return;
		const all = changes.some(change => change!.all);
		const dates = all ? undefined : [...new Set(changes.flatMap(change => change!.dates))];
		const timeKeys = !all && config.graphType === "hourly" ? events.flatMap(event => event.timeKeys || []).filter(key => dates!.includes(key.date)) : undefined;
		const selection = dates ? {dates, timeKeys} : undefined;
		void this.renderFromYaml(config, el, app, selection);
	}

	private updateQueryCache(config: YamlGraphConfig, app: App, selection?: TimeGraphSelection): void {
		if(config.graphType==="timeline"){this.queriedData=[];this.queriedHours=[];return;}
		const range = getActivityDateRange(config);
		const rangeKey = `${range.fromDate}/${range.toDate}`;
		if (rangeKey !== this.rangeKey) selection = undefined;
		if (config.dataSource?.type === "TIME_ACTIVITY") {
			const time = queryTimeGraph(config, this.activityService, app, selection);
			this.queriedData = mergeGraphRows(this.queriedData, time.data, selection);
			this.queriedHours = mergeGraphRows(this.queriedHours, time.hourlyData, selection);
		} else {
			const rows = selection ? selection.dates.flatMap(date => this.queryData({...config, dateRangeType: "FIXED_DATE_RANGE", fromDate: date, toDate: date}, app)) : this.queryData(config, app);
			this.queriedData = mergeGraphRows(this.queriedData, rows, selection);
		}
		this.rangeKey = rangeKey;
	}

	private async resolveCurrentPosition(
		app: App,
		file: TFile,
		position?: { line: number; column: number }
	): Promise<{ line: number; column: number } | undefined> {
		if (!position) {
			return undefined;
		}

		try {
			const content = await app.vault.cachedRead(file);
			return clampEditPosition(content, position);
		} catch (error) {
			console.warn(
				`Failed to validate edit position for ${file.path}`,
				error
			);
			return position;
		}
	}

	private async ensureDataviewReady(app: App): Promise<void> {
		const dataview = getAPI(app);
		if (!dataview) {
			throw new GraphProcessError({
				summary: "Initialize Dataview failed",
				recommends: ["Please install Dataview plugin"],
			});
		}
		if (dataview.index.initialized) {
			return;
		}

		try {
			await waitForDataviewIndex(
				app,
				this.abortController.signal
			);
		} catch (error) {
			if (isAbortError(error)) {
				throw error;
			}
			if (error instanceof DataviewIndexTimeoutError) {
				throw new GraphProcessError({
					summary: Locals.get().graph_dataview_timeout,
					recommends: [
						Locals.get().graph_dataview_timeout_recommendation,
					],
				});
			}
			throw error;
		}
	}

	private renderError(el: HTMLElement, error: unknown): void {
		if (error instanceof GraphProcessError) {
			Renders.renderErrorTips(el, error.summary, error.recommends);
			return;
		}
		console.error(error);
		const message =
			error instanceof Error ? error.message : String(error);
		Renders.renderErrorTips(el, "unexpected error: " + message);
	}
}
