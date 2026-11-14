import {
	Editor,
	MarkdownFileInfo,
	MarkdownView,
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
import { EditActivityService } from "./activity/EditActivityService";
import { EditActivitySettingTab } from "./activity/EditActivitySettingTab";
import { TimeActivityObserver } from "./time/TimeActivityObserver";

export default class ContributionGraph extends Plugin {
	activityService: EditActivityService;
	private timeObserver: TimeActivityObserver;

	async onload() {
		this.activityService = new EditActivityService(this);
		await this.activityService.initialize();
		this.timeObserver = new TimeActivityObserver(this, {
			activity: path => this.activityService.recordTimeActivity(path),
			pause: () => this.activityService.pauseTimeActivity(),
			checkpoint: () => this.activityService.checkpointTimeActivity(),
			status: () => this.activityService.getTimeTrackingStatus(),
		});
		this.app.workspace.onLayoutReady(() => this.timeObserver.start());
		this.registerEditorExtension(
			this.activityService.createEditorExtension()
		);
		this.addSettingTab(
			new EditActivitySettingTab(
				this.app,
				this,
				this.activityService
			)
		);
		this.registerAppResumeEvents();
		this.registerFileRenameTracking();
		this.registerGlobalRenderApi();
		this.registerCodeblockProcessor();
		this.registerContributionGraphCreateCommand();
		this.registerContextMenu();
	}

	async onunload() {
		this.timeObserver?.stop();
		// @ts-ignore
		window.renderContributionGraph = undefined;
		// @ts-ignore
		window.contributionGraphApi = undefined;
		await this.activityService?.unload();
	}

	registerAppResumeEvents() {
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
			Renders.render(container, graphConfig);
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
