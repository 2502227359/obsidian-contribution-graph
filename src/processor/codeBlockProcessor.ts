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
import { areFoldersCoveredByScope, isFileInTrackedFolders, normalizeTrackedFolders } from "src/activity/folderScope";
import {
	getEditActivityMetricValue,
	sortEditActivityStatsByMetric,
} from "src/activity/metrics";
import { Locals } from "src/i18/messages";
import { CompositeDataSourceQuery } from "src/query/compositeDataSourceQuery";
import { Renders } from "src/render/renders";
import { Contribution, ContributionItem } from "src/types";
import { MISS_CONFIG } from "./bizErrors";
import { GraphProcessError } from "./graphProcessError";
import { YamlGraphConfig } from "./types";
import { YamlConfigReconciler } from "./yamlConfigReconciler";
import { queryTimeGraph } from "../time/timeGraphData";
import { createDefaultGoalHeatScale, TIME_HOURLY_RULES } from "src/constants";
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
	private unsubscribe?: () => void;
	private refreshTimer: number | null = null;

	constructor(
		container: HTMLElement,
		private readonly activityService: EditActivityService,
		private readonly refresh: () => void,
		private readonly shouldRefresh: (event: EditActivityChangeEvent) => boolean
	) {
		super(container);
	}

	onload(): void {
		this.unsubscribe = this.activityService.subscribe((event) => {
			if (!this.shouldRefresh(event)) {
				return;
			}
			if (this.refreshTimer !== null) {
				window.clearTimeout(this.refreshTimer);
			}
			this.refreshTimer = window.setTimeout(() => {
				this.refreshTimer = null;
				this.refresh();
			}, 150);
		});
	}

	onunload(): void {
		this.unsubscribe?.();
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
	}
}

export class CodeBlockProcessor {
	dataSourceQuery: CompositeDataSourceQuery = new CompositeDataSourceQuery();
	private selectedActivityDate?: string;
	private readonly abortController = new AbortController();
	private disposed = false;

	constructor(private readonly activityService: EditActivityService) {}

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
				["EDIT_ACTIVITY", "TIME_ACTIVITY"].includes(graphConfig.dataSource?.type)
			) {
				ctx.addChild(
					new ReactiveGraphRenderChild(
						el,
						this.activityService,
						() => {
							void this.renderFromYaml(graphConfig, el, app);
						},
						(event) => this.shouldRefreshGraph(event, graphConfig)
					)
				);
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
	}

	async renderFromYaml(
		graphConfig: YamlGraphConfig,
		el: HTMLElement,
		app: App
	): Promise<void> {
		try {
			YamlGraphConfig.validate(graphConfig);
			if (!["EDIT_ACTIVITY", "TIME_ACTIVITY"].includes(graphConfig.dataSource?.type)) {
				await this.ensureDataviewReady(app);
			}
			if (this.disposed) {
				return;
			}

			const inlineData = [...(graphConfig.data || [])];
			const queriedData = this.queryData(graphConfig, app);
			const renderConfig: YamlGraphConfig = {
				...graphConfig,
				dataSource: { ...graphConfig.dataSource },
				data: [...inlineData, ...queriedData],
			};
			if (graphConfig.dataSource?.type === "TIME_ACTIVITY") {
				const time = queryTimeGraph(graphConfig, this.activityService, app);
				renderConfig.data = time.data;
				renderConfig.hourlyData = time.hourlyData;
				renderConfig.timeTracking = true;
				renderConfig.activityFolders = normalizeTrackedFolders(graphConfig.dataSource.folders || []);
				renderConfig.valueUnit = "分钟";
				if (graphConfig.graphType === "hourly") {
					renderConfig.heatScale = undefined;
					renderConfig.cellStyleRules = graphConfig.cellStyleRules || TIME_HOURLY_RULES;
				}
				if (graphConfig.graphType !== "hourly") renderConfig.heatScale = graphConfig.heatScale || createDefaultGoalHeatScale(60);
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

			const contributionConfig =
				YamlGraphConfig.toContributionGraphConfig(renderConfig);
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

			Renders.render(el, contributionConfig);
		} catch (error) {
			if (this.disposed || isAbortError(error)) {
				return;
			}
			this.renderError(el, error);
		}
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

	private shouldRefreshGraph(
		event: EditActivityChangeEvent,
		graphConfig: YamlGraphConfig
	): boolean {
		if (event.type === "TIME_STATS" && graphConfig.dataSource?.type !== "TIME_ACTIVITY") return false;
		if (event.type === "STATS" && graphConfig.dataSource?.type === "TIME_ACTIVITY") return false;
		if (event.type !== "STATS") {
			return true;
		}
		const range = getActivityDateRange(graphConfig);
		if (event.date && ((range.fromDate && event.date < range.fromDate) || (range.toDate && event.date > range.toDate))) {
			return false;
		}
		const folders = normalizeTrackedFolders(graphConfig.dataSource?.folders || []);
		return !event.filePath || folders.length === 0 || isFileInTrackedFolders(event.filePath, folders);
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
