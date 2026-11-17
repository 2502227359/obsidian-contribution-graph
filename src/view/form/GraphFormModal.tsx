import { Modal, App, MarkdownView, parseYaml, stringifyYaml } from "obsidian";
import { StrictMode } from "react";
import { Root, createRoot } from "react-dom/client";
import { GraphForm } from "./GraphForm";
import { YamlGraphConfig } from "src/processor/types";
import { YamlConfigReconciler } from "src/processor/yamlConfigReconciler";
import { EditActivityService } from "src/activity/EditActivityService";

export class ContributionGraphCreateModal extends Modal {
	root: Root | null = null;

	onSave?: (content: string) => void;

	originalConfigContent?: string;

	constructor(
		app: App,
		private readonly activityService: EditActivityService,
		originalConfigContent?: string,
		onSave?: (content: string) => void
	) {
		super(app);
		this.originalConfigContent = originalConfigContent;
		this.onSave = onSave;
	}

	async onOpen() {
		const { contentEl } = this;
		this.modalEl.addClass("contribution-graph-editor-modal");
		const header = contentEl.createDiv({ cls: "cg-editor-header" });
		header.createEl("h2", {
			cls: "cg-editor-title",
			text: this.originalConfigContent ? "编辑贡献图" : "新建贡献图",
		});
		header.createEl("p", {
			cls: "cg-editor-subtitle",
			text: "调整设置后实时预览，保存时写入当前图表配置",
		});
		const rootContainer = createDiv({
			parent: contentEl,
			cls: "cg-editor-root",
		});

		let yamlConfig: YamlGraphConfig;
		let ignoreLanguagePrefix = false;
		if (this.originalConfigContent) {
			yamlConfig = this.parseFromOriginalConfig()!;
		} else {
			yamlConfig = this.parseFromSelecttion()!;
			if (yamlConfig) {
				ignoreLanguagePrefix = true;
			}
		}

		if (!yamlConfig) {
			yamlConfig = new YamlGraphConfig();
		}

		let onSubmit: (yamlGraphConfig: YamlGraphConfig) => void;
		if (this.onSave) {
			// update existing Graph
			onSubmit = (yamlGraphConfig: YamlGraphConfig) => {
				this.close();
				this.onSave!(stringifyYaml(yamlGraphConfig));
			};
		} else {
			// create new Graph
			onSubmit = (yamlGraphConfig: YamlGraphConfig) => {
				const markdownView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!markdownView) {
					return;
				}
				const editor = markdownView.editor;
				this.close();
				if (ignoreLanguagePrefix) {
					editor.replaceSelection(stringifyYaml(yamlGraphConfig));
				} else {
					const codeblock = `\`\`\`contributionGraph\n${stringifyYaml(
						yamlGraphConfig
					)}\n\`\`\`\n`;
					editor.replaceSelection(codeblock);
				}
			};
		}

		yamlConfig = YamlConfigReconciler.reconcile(yamlConfig);

		this.root = createRoot(rootContainer);
		this.root.render(
			<StrictMode>
				<GraphForm
					yamlConfig={yamlConfig}
					newGraph={!this.originalConfigContent&&!ignoreLanguagePrefix}
					onSubmit={onSubmit}
					onCancel={() => this.close()}
					app={this.app}
					activityService={this.activityService}
				/>
			</StrictMode>
		);
	}

	async onClose() {
		this.root?.unmount();
		const { contentEl } = this;
		contentEl.empty();
	}

	parseFromOriginalConfig(): YamlGraphConfig | null {
		if (
			this.originalConfigContent &&
			this.originalConfigContent.trim() != ""
		) {
			try {
				return parseYaml(this.originalConfigContent) as YamlGraphConfig;
			} catch (e) {
				return null;
			}
		} else {
			return null;
		}
	}

	parseFromSelecttion(): YamlGraphConfig | null {
		const markdownView =
			this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!markdownView) {
			return null;
		}
		const editor = markdownView.editor;
		const selection = editor.getSelection();
		if (selection && selection.trim() != "") {
			try {
				return parseYaml(selection) as YamlGraphConfig;
			} catch (e) {
				return null;
			}
		} else {
			return null;
		}
	}
}
