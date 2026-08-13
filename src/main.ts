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
import { EditActivityService } from "./activity/EditActivityService";
import { EditActivitySettingTab } from "./activity/EditActivitySettingTab";

export default class ContributionGraph extends Plugin {
	activityService: EditActivityService;

	async onload() {
		this.activityService = new EditActivityService(this);
		await this.activityService.initialize();
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
				void this.activityService.flush();
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
					}
					return;
				}
				if (file instanceof TFolder) {
					this.activityService.handlePathRename(
						oldPath,
						file.path,
						true
					);
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
