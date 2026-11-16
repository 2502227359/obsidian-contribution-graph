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

export default class ContributionGraph extends Plugin {
	activityService: EditActivityService;
	private timeObserver: TimeActivityObserver;
	private shuttingDown = false;

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

	async onunload() {
		this.shuttingDown = true;
		this.timeObserver?.stop();
		// @ts-ignore
		window.renderContributionGraph = undefined;
		// @ts-ignore
		window.contributionGraphApi = undefined;
		await this.activityService?.unload();
	}

	registerAppResumeEvents() {
		this.registerEvent(this.app.workspace.on("quit", tasks => {
			this.shuttingDown = true;
			this.timeObserver?.stop();
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
			if (!Renders.update(container, graphConfig)) Renders.render(container, graphConfig);
		};
		//@ts-ignore
		window.contributionGraphApi = {
			getDailyTimeStats: (query?: import("./time/types").TimeStatsQuery) => this.activityService.getDailyTimeStats(query),
			getHourlyTimeStats: (query?: import("./time/types").TimeStatsQuery) => this.activityService.getHourlyTimeStats(query),
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
				const processor = new CodeBlockProcessor(this.activityService);
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
