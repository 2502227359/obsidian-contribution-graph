import {
	App,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	Platform,
	TFile,
	parseYaml,
} from "obsidian";
import { getAPI } from "obsidian-dataview";
import { getActivityDateRange } from "src/activity/dateRange";
import { clampEditPosition } from "src/activity/editPosition";
import { EditActivityService } from "src/activity/EditActivityService";
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

class ReactiveGraphRenderChild extends MarkdownRenderChild {
	private unsubscribe?: () => void;
	private refreshTimer: number | null = null;

	constructor(
		container: HTMLElement,
		private readonly activityService: EditActivityService,
		private readonly refresh: () => void
	) {
		super(container);
	}

	onload(): void {
		this.unsubscribe = this.activityService.subscribe(() => {
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

	constructor(private readonly activityService: EditActivityService) {}

	async renderFromCodeBlock(
		code: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
		app: App
	) {
		try {
			const graphConfig: YamlGraphConfig = this.loadYamlConfig(el, code);
			await this.renderFromYaml(graphConfig, el, app);

			if (graphConfig.dataSource?.type === "EDIT_ACTIVITY") {
				ctx.addChild(
					new ReactiveGraphRenderChild(
						el,
						this.activityService,
						() => {
							void this.renderFromYaml(graphConfig, el, app);
						}
					)
				);
			}
		} catch (error) {
			this.renderError(el, error);
		}
	}

	async renderFromYaml(
		graphConfig: YamlGraphConfig,
		el: HTMLElement,
		app: App
	): Promise<void> {
		try {
			YamlGraphConfig.validate(graphConfig);
			if (graphConfig.dataSource?.type !== "EDIT_ACTIVITY") {
				await this.ensureDataviewReady(app);
			}

			const inlineData = [...(graphConfig.data || [])];
			const queriedData = this.queryData(graphConfig, app);
			const renderConfig: YamlGraphConfig = {
				...graphConfig,
				dataSource: { ...graphConfig.dataSource },
				data: [...inlineData, ...queriedData],
			};

			if (graphConfig.dataSource?.type === "EDIT_ACTIVITY") {
				renderConfig.trackingPeriods =
					this.activityService.getTrackingPeriods();
				renderConfig.valueUnit = Locals.get().graph_characters_unit;
			}

			const contributionConfig =
				YamlGraphConfig.toContributionGraphConfig(renderConfig);
			if (graphConfig.dataSource?.type === "EDIT_ACTIVITY") {
				contributionConfig.selectedActivityDate =
					this.selectedActivityDate;
				contributionConfig.onCellClick = (cellData) => {
					this.selectedActivityDate = cellData.date;
				};
				contributionConfig.onActivityClose = () => {
					this.selectedActivityDate = undefined;
				};
			}

			Renders.render(el, contributionConfig);
		} catch (error) {
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
		if (graphConfig.dataSource?.type === "EDIT_ACTIVITY") {
			const metric =
				graphConfig.dataSource.metric || "CHANGED_CHARS";
			const goal = Math.max(1, graphConfig.heatScale?.goal || 1000);
			return this.activityService
				.getDailyEditStats(getActivityDateRange(graphConfig))
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
				const attributedAdded = stats.documents.reduce(
					(sum, document) => sum + document.addedChars,
					0
				);
				const attributedDeleted = stats.documents.reduce(
					(sum, document) => sum + document.deletedChars,
					0
				);
				const unattributedAdded = Math.max(
					0,
					stats.addedChars - attributedAdded
				);
				const unattributedDeleted = Math.max(
					0,
					stats.deletedChars - attributedDeleted
				);
				if (unattributedAdded > 0 || unattributedDeleted > 0) {
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
				return {
					date: stats.date,
					value,
					editStats: stats,
					items,
					summary: Locals.get()
						.graph_edit_activity_summary.replace(
							"{date}",
							stats.date
						)
						.replace("{added}", stats.addedChars.toString())
						.replace(
							"{deleted}",
							stats.deletedChars.toString()
						)
						.replace(
							"{changed}",
							stats.changedChars.toString()
						)
						.replace(
							"{percent}",
							Math.round((value / goal) * 100).toString()
						),
				};
				});
		}

		return this.dataSourceQuery.query(graphConfig.dataSource, app);
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

		await new Promise<void>((resolve) => {
			const metadataCache = app.metadataCache as unknown as {
				on: (
					name: string,
					callback: () => void
				) => unknown;
				offref: (eventRef: unknown) => void;
			};
			const eventRef = metadataCache.on(
				"dataview:index-ready",
				() => {
					metadataCache.offref(eventRef);
					resolve();
				}
			);
		});
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
