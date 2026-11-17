import {
	Editor,
	MarkdownFileInfo,
	MarkdownView,
	Notice,
	Plugin,
	TFile,
	TFolder,
} from "obsidian";
import { ContributionGraphConfig } from "./types";
import { Renders } from "./render/renders";
import { CodeBlockProcessor } from "./processor/codeBlockProcessor";
import { ContributionGraphCreateModal } from "./view/form/GraphFormModal";
import { mountEditButtonToCodeblock } from "./view/codeblock/CodeblockEditButtonMount";
import { Locals } from "./i18/messages";
import "../style/styles.css";
import "../style/timeGraph.css";
import "../style/apple.css";
import "../style/datePicker.css";
import { EditActivityService } from "./activity/EditActivityService";
import { EditActivitySettingTab } from "./activity/EditActivitySettingTab";
import { TimeActivityObserver } from "./time/TimeActivityObserver";
import { WeeklyReviewModal } from "./view/WeeklyReviewModal";
import "../style/weeklyReview.css";
import "../style/weeklyReviewCharts.css";
import "../style/weeklyReviewTimeline.css";
import "../style/weeklyReviewInsights.css";
import "../style/activityTimeline.css";
import "../style/activityTimelineHost.css";
import { closeActivityTimelineModals, createActivityTimelineOptions } from "./view/ActivityTimelineModal";
import { ActivityTimelineView } from "./view/ActivityTimelineView";

export default class ContributionGraph extends Plugin {
	activityService: EditActivityService;
	private timeObserver: TimeActivityObserver;
	private shuttingDown = false;
	private readonly weeklyReviewModals = new Map<Document, WeeklyReviewModal>();

	async onload() {
		this.shuttingDown = false;
		this.activityService = new EditActivityService(this);
		await this.activityService.initialize();
		this.timeObserver = new TimeActivityObserver(this, {
			activity: path => this.activityService.recordTimeActivity(path),
			pause: () => this.activityService.pauseTimeActivity(),
			checkpoint: () => this.activityService.checkpointTimeActivity(),
			context: context => this.activityService.setTimeTrackingContext(context),
			snapshot: () => this.activityService.getTimeTrackingSnapshot(),
			toggle: () => this.setManualTimePaused(!this.activityService.getTimeTrackingSnapshot().manualPaused),
			subscribe: listener => this.activityService.subscribe(event => {
				if (["TIME_STATUS", "TIME_STATS", "COVERAGE", "SETTINGS", "IMPORT", "TEMPORAL"].includes(event.type)) listener();
			}),
		});
		this.app.workspace.onLayoutReady(() => { if (!this.shuttingDown) this.timeObserver.start(); });
		this.registerEditorExtension(
			this.activityService.createEditorExtension()
		);
		this.addSettingTab(
			new EditActivitySettingTab(
				this.app,
				this,
				this.activityService,
				paused => this.setManualTimePaused(paused)
			)
		);
		this.registerAppResumeEvents();
		this.registerFileRenameTracking();
		this.registerGlobalRenderApi();
		this.registerCodeblockProcessor();
		this.registerContributionGraphCreateCommand();
		this.registerTimeTrackingCommands();
		this.registerWeeklyReviewCommand();
		this.registerContextMenu();
	}

	private async setManualTimePaused(paused: boolean): Promise<void> {
		if (this.shuttingDown) return;
		if (!this.activityService.getSettings().timeTrackingEnabled) {
			new Notice("请先在插件设置中启用时长统计。");
			return;
		}
		const previous = this.activityService.getTimeTrackingSnapshot().manualPaused;
		if (paused) await this.activityService.pauseTimeTrackingForSession();
		else await this.activityService.resumeTimeTrackingForSession();
		const changed = previous !== this.activityService.getTimeTrackingSnapshot().manualPaused;
		if (!this.shuttingDown) this.timeObserver.refreshCurrentContext(changed);
	}

	private registerTimeTrackingCommands(): void {
		for (const [id, name, paused] of [
			["pause-time-tracking", "暂停本次时长统计", true],
			["resume-time-tracking", "恢复本次时长统计", false],
		] as const) {
			this.addCommand({ id, name, callback: () => { void this.setManualTimePaused(paused); } });
		}
	}

	private registerWeeklyReviewCommand(): void {
		this.addCommand({ id: "weekly-review", name: "查看学科周回顾", callback: () => this.openWeeklyReview() });
		this.addRibbonIcon("calendar-days", "周回顾", () => this.openWeeklyReview());
		this.registerEvent(this.app.workspace.on("window-close", (_workspaceWindow, closedWindow) => {
			for (const [owner, modal] of this.weeklyReviewModals) if (owner.defaultView === closedWindow) modal.close();
			closeActivityTimelineModals(closedWindow);
			ActivityTimelineView.disposeAll(closedWindow);
		}));
	}

	private openWeeklyReview(owner = typeof activeDocument === "undefined" ? document : activeDocument): void {
		if (this.shuttingDown) return;
		closeActivityTimelineModals(owner);
		const existing = this.weeklyReviewModals.get(owner);
		if (existing) { existing.focus(); return; }
		const modal = new WeeklyReviewModal(this.app, this.activityService, () => this.weeklyReviewModals.delete(owner));
		this.weeklyReviewModals.set(owner, modal);
		modal.open();
	}

	async onunload() {
		this.shuttingDown = true;
		this.timeObserver?.stop();
		this.closeWeeklyReviews();
		// @ts-ignore
		window.renderContributionGraph = undefined;
		// @ts-ignore
		window.contributionGraphApi = undefined;
		await this.activityService?.unload();
	}

	private closeWeeklyReviews(): void {
		ActivityTimelineView.disposeAll();
		closeActivityTimelineModals();
		for (const modal of this.weeklyReviewModals.values()) modal.close();
		this.weeklyReviewModals.clear();
	}

	registerAppResumeEvents() {
		this.registerEvent(this.app.workspace.on("quit", tasks => {
			this.shuttingDown = true;
			this.timeObserver?.stop();
			this.closeWeeklyReviews();
			tasks.addPromise(this.activityService.unload());
		}));
		this.registerDomEvent(window, "focus", () => {
			this.activityService.handleAppResume();
		});
		this.registerDomEvent(document, "visibilitychange", () => {
			if (document.visibilityState === "visible") {
				this.activityService.handleAppResume();
			} else {
				this.activityService.handleAppSuspend();
			}
		});
	}

	registerFileRenameTracking() {
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile) {
					if (file.extension.toLowerCase() === "md") {
						this.activityService.handlePathRename(
							oldPath,
							file.path,
							false
						);
						this.timeObserver.handlePathRename();
					}
					return;
				}
				if (file instanceof TFolder) {
					this.activityService.handlePathRename(
						oldPath,
						file.path,
						true
					);
					this.timeObserver.handlePathRename();
				}
			})
		);
	}

	registerContextMenu() {
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, info) => {
				menu.addItem((item) => {
					item.setTitle(Locals.get().context_menu_create);
					item.setIcon("gantt-chart");
					item.onClick(() => {
						new ContributionGraphCreateModal(
							this.app,
							this.activityService
						).open();
					});
				});
			})
		);
	}

	registerGlobalRenderApi() {
		//@ts-ignore
		window.renderContributionGraph = (
			container: HTMLElement,
			graphConfig: ContributionGraphConfig
		): void => {
			graphConfig.openWeeklyReview = owner => this.openWeeklyReview(owner);
			if(graphConfig.graphType==="timeline")graphConfig.activityTimeline=createActivityTimelineOptions(this.app,this.activityService,graphConfig,container.ownerDocument);
			if (!Renders.update(container, graphConfig)) Renders.render(container, graphConfig);
		};
		//@ts-ignore
		window.contributionGraphApi = {
			getDailyTimeStats: (query?: import("./time/types").TimeStatsQuery) => this.activityService.getDailyTimeStats(query),
			getHourlyTimeStats: (query?: import("./time/types").TimeStatsQuery) => this.activityService.getHourlyTimeStats(query),
			getActivityTimelineDay:(query:import("./time/activityTimelineTypes").ActivityTimelineQuery)=>this.activityService.getActivityTimelineDay(query),
			getDailyEditStats: (query?: {
				fromDate?: string;
				toDate?: string;
				folders?: string[];
			}) => this.activityService.getDailyEditStats(query),
		};
	}

	registerCodeblockProcessor() {
		this.registerMarkdownCodeBlockProcessor(
			"contributionGraph",
			(code, el, ctx) => {
				const processor = new CodeBlockProcessor(this.activityService, owner => this.openWeeklyReview(owner));
				processor.renderFromCodeBlock(code, el, ctx, this.app);
				if (el.parentElement) {
					mountEditButtonToCodeblock(
						this.app,
						this.activityService,
						code,
						el.parentElement,
						el,
						ctx
					);
				}
			}
		);
	}

	registerContributionGraphCreateCommand() {
		this.addCommand({
			id: "create-graph",
			name: Locals.get().context_menu_create,
			editorCallback: (
				editor: Editor,
				ctx: MarkdownView | MarkdownFileInfo
			) => {
				new ContributionGraphCreateModal(
					this.app,
					this.activityService
				).open();
			},
		});
	}
}
