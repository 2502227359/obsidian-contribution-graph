import {
	App,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFolder,
} from "obsidian";
import { Locals } from "src/i18/messages";
import {
	EditActivityBackupError,
	EditActivityService,
} from "./EditActivityService";
import {
	getSelectableVaultFolders,
	VaultFolderSuggestModal,
} from "./VaultFolderSuggestModal";

export const SETTINGS_SECTION_KEYS = [
	"time",
	"characters",
	"scope",
	"data",
] as const;

export function parseIdleTimeoutMinutes(value: string): number | null {
	const minutes = Number(value);
	return Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= 10080
		? minutes
		: null;
}

export class EditActivitySettingTab extends PluginSettingTab {
	private unsubscribeService?: () => void;
	private timeStatusEl?: HTMLElement;

	constructor(
		app: App,
		plugin: Plugin,
		private readonly activityService: EditActivityService
	) {
		super(app, plugin);
	}

	display(): void {
		this.stopServiceListening();
		this.timeStatusEl = undefined;
		const { containerEl } = this;
		const local = Locals.get();
		const settings = this.activityService.getSettings();
		containerEl.empty();
		containerEl.addClass("contribution-graph-settings");
		containerEl.addClass("cg-settings");
		this.createHeader(containerEl);
		this.createTimeSection(containerEl, settings);
		this.createCharacterSection(containerEl, settings);
		this.createScopeSection(containerEl, settings);
		this.createDataSection(containerEl, local);
		this.startServiceListening();
	}

	hide(): void {
		this.stopServiceListening();
		this.timeStatusEl = undefined;
		super.hide();
	}

	private createHeader(container: HTMLElement): void {
		const header = container.createDiv({ cls: "cg-settings-header" });
		header.createEl("h2", { text: "活动统计" });
		header.createEl("p", {
			cls: "setting-item-description contribution-graph-settings-intro",
			text: "管理阅读与编辑时长、字符采集和统计数据。记录保存在当前仓库，不保存笔记正文。",
		});
	}

	private createTimeSection(container: HTMLElement, settings: ReturnType<EditActivityService["getSettings"]>): void {
		const section = this.createSection(
			container,
			"time",
			"活跃使用时长",
			this.activityService.getTimeTrackingStatus()
		);
		new Setting(section)
			.setName("启用时长统计")
			.setDesc(
				"自动累计 Markdown 笔记的阅读和编辑时长，与字符统计独立。后台、弹窗和空闲时暂停；仅保存本机统计，不保存正文。"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(settings.timeTrackingEnabled)
					.onChange(async (enabled) => {
						await this.activityService.setTimeTrackingEnabled(enabled);
						this.display();
					})
			);
		new Setting(section)
			.setName("空闲阈值（分钟）")
			.setDesc(
				"默认 5 分钟。最后一次正文操作后继续计时到阈值；静止阅读可能少计，前台挂机可能多计。修改仅影响后续记录。"
			)
			.addText((text) => {
				text.setValue(String(settings.idleTimeoutMinutes));
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text.inputEl.max = "10080";
				text.inputEl.step = "1";
				text.inputEl.addEventListener("change", async () => {
					const minutes = parseIdleTimeoutMinutes(text.getValue());
					if (minutes === null) {
						this.resetIdleTimeoutInput(text);
						return;
					}
					try {
						await this.activityService.setIdleTimeoutMinutes(minutes);
						this.updateTimeStatus();
					} catch {
						this.resetIdleTimeoutInput(text);
					}
				});
			});
	}

	private createCharacterSection(
		container: HTMLElement,
		settings: ReturnType<EditActivityService["getSettings"]>
	): void {
		const local = Locals.get();
		const section = this.createSection(container, "characters", "字符统计");
		new Setting(section)
			.setName(local.settings_tracking_enabled)
			.setDesc(local.settings_tracking_enabled_description)
			.addToggle((toggle) =>
				toggle
					.setValue(settings.trackingEnabled)
					.onChange(async (enabled) => {
						await this.activityService.setTrackingEnabled(enabled);
						new Notice(
							enabled
								? local.settings_tracking_started
								: local.settings_tracking_paused
						);
						this.display();
					})
			);
		this.createCountingSummary(section, settings, local);
		section.createEl("h4", {
			cls: "cg-settings-subsection-title",
			text: local.settings_character_rules_heading,
		});
		this.createCharacterRuleSettings(section, settings, local);
		section.createEl("h4", {
			cls: "cg-settings-subsection-title",
			text: local.settings_input_sources_heading,
		});
		this.createInputSourceSettings(section, settings, local);
	}

	private createCountingSummary(
		container: HTMLElement,
		settings: ReturnType<EditActivityService["getSettings"]>,
		local: ReturnType<typeof Locals.get>
	): void {
		const summary = container.createDiv({
			cls: `contribution-graph-counting-summary${
				settings.trackingEnabled ? "" : " is-paused"
			}`,
		});
		summary.createDiv({
			cls: "contribution-graph-counting-summary-title",
			text: local.settings_counting_summary,
		});
		const summaryItems = [
			settings.strictUserInputOnly
				? local.settings_summary_strict
				: local.settings_summary_compatible,
			settings.countPastedText
				? local.settings_summary_include_paste
				: local.settings_summary_exclude_paste,
			settings.excludeWhitespace
				? local.settings_summary_ignore_whitespace
				: local.settings_summary_include_whitespace,
			settings.excludeMarkdownFormatting
				? local.settings_summary_ignore_markdown
				: local.settings_summary_include_markdown,
			settings.trackedFolders.length === 0
				? local.settings_summary_all_folders
				: local.settings_summary_folder_count.replace(
						"{count}",
						settings.trackedFolders.length.toString()
				  ),
		];
		const summaryItemsEl = summary.createDiv({
			cls: "contribution-graph-counting-summary-items",
		});
		for (const item of summaryItems) {
			summaryItemsEl.createSpan({ text: item });
		}
	}

	private createCharacterRuleSettings(
		container: HTMLElement,
		settings: ReturnType<EditActivityService["getSettings"]>,
		local: ReturnType<typeof Locals.get>
	): void {
		new Setting(container)
			.setName(local.settings_exclude_whitespace)
			.setDesc(local.settings_exclude_whitespace_description)
			.addToggle((toggle) =>
				toggle
					.setValue(settings.excludeWhitespace)
					.onChange(async (excludeWhitespace) => {
						await this.activityService.setExcludeWhitespace(
							excludeWhitespace
						);
						new Notice(local.settings_counting_policy_updated);
						this.display();
					})
			);
		new Setting(container)
			.setName(local.settings_exclude_markdown_formatting)
			.setDesc(local.settings_exclude_markdown_formatting_description)
			.addToggle((toggle) =>
				toggle
					.setValue(settings.excludeMarkdownFormatting)
					.onChange(async (excludeMarkdownFormatting) => {
						await this.activityService.setExcludeMarkdownFormatting(
							excludeMarkdownFormatting
						);
						new Notice(local.settings_counting_policy_updated);
						this.display();
					})
			);
	}

	private createInputSourceSettings(
		container: HTMLElement,
		settings: ReturnType<EditActivityService["getSettings"]>,
		local: ReturnType<typeof Locals.get>
	): void {
		new Setting(container)
			.setName(local.settings_strict_user_input)
			.setDesc(local.settings_strict_user_input_description)
			.addToggle((toggle) =>
				toggle
					.setValue(settings.strictUserInputOnly)
					.onChange(async (strictUserInputOnly) => {
						await this.activityService.setStrictUserInputOnly(
							strictUserInputOnly
						);
						new Notice(local.settings_counting_policy_updated);
						this.display();
					})
			);
		new Setting(container)
			.setName(local.settings_count_pasted_text)
			.setDesc(local.settings_count_pasted_text_description)
			.addToggle((toggle) =>
				toggle
					.setValue(settings.countPastedText)
					.onChange(async (countPastedText) => {
						await this.activityService.setCountPastedText(countPastedText);
						new Notice(local.settings_counting_policy_updated);
						this.display();
					})
			);
	}

	private createScopeSection(
		container: HTMLElement,
		settings: ReturnType<EditActivityService["getSettings"]>
	): void {
		const local = Locals.get();
		const section = this.createSection(
			container,
			"scope",
			local.settings_collection_scope_heading
		);
		const selectableFolders = getSelectableVaultFolders(
			this.app,
			settings.trackedFolders
		);
		new Setting(section)
			.setName(local.settings_tracked_folders)
			.setDesc(
				settings.trackedFolders.length === 0
					? `${local.settings_tracked_folders_description} ${local.settings_tracked_folders_all}`
					: local.settings_tracked_folders_description
			)
			.addButton((button) =>
				button
					.setButtonText(local.settings_tracked_folders_choose)
					.setDisabled(selectableFolders.length === 0)
					.onClick(() => {
						new VaultFolderSuggestModal(
							this.app,
							selectableFolders,
							local.settings_tracked_folders_choose,
							async (folder) => {
								await this.activityService.setTrackedFolders([
									...settings.trackedFolders,
									folder.path,
								]);
								this.display();
							}
						).open();
					})
			);
		for (const folderPath of settings.trackedFolders) {
			this.createTrackedFolderSetting(section, folderPath, settings, local);
		}
	}

	private createTrackedFolderSetting(
		container: HTMLElement,
		folderPath: string,
		settings: ReturnType<EditActivityService["getSettings"]>,
		local: ReturnType<typeof Locals.get>
	): void {
		const exists =
			this.app.vault.getAbstractFileByPath(folderPath) instanceof TFolder;
		const folderSetting = new Setting(container)
			.setName(folderPath)
			.setClass("contribution-graph-tracked-folder-item")
			.addExtraButton((button) =>
				button
					.setIcon("trash")
					.setTooltip(local.settings_tracked_folders_remove)
					.onClick(async () => {
						await this.activityService.setTrackedFolders(
							settings.trackedFolders.filter((path) => path !== folderPath)
						);
						this.display();
					})
			);
		if (!exists) {
			folderSetting
				.setDesc(local.settings_tracked_folder_missing)
				.setClass("is-missing");
		}
	}

	private createDataSection(
		container: HTMLElement,
		local: ReturnType<typeof Locals.get>
	): void {
		const section = this.createSection(container, "data", local.settings_data_heading);
		new Setting(section)
			.setName(local.settings_export)
			.setDesc(local.settings_export_description)
			.addButton((button) =>
				button
					.setButtonText(local.settings_export_button)
					.onClick(async () => {
						const serialized = this.activityService.exportData();
						try {
							await navigator.clipboard.writeText(serialized);
							new Notice(local.settings_export_success);
						} catch (_error) {
							this.downloadExport(serialized);
							new Notice(local.settings_export_downloaded);
						}
					})
			);
		const importInput = this.createImportInput(section, local);
		new Setting(section)
			.setName(local.settings_import)
			.setDesc(local.settings_import_description)
			.addButton((button) =>
				button
					.setButtonText(local.settings_import_button)
					.onClick(() => importInput.click())
			);
		this.createRestoreSetting(section, local);
		this.createClearSetting(section, local);
	}

	private createImportInput(
		container: HTMLElement,
		local: ReturnType<typeof Locals.get>
	): HTMLInputElement {
		const importInput = container.createEl("input", {
			type: "file",
			attr: {
				accept: "application/json,.json",
				"aria-label": local.settings_import,
			},
		}) as HTMLInputElement;
		importInput.addClass("contribution-graph-hidden-input");
		importInput.onchange = async () => {
			const file = importInput.files?.[0];
			if (!file) {
				return;
			}
			try {
				const serialized = await file.text();
				if (
					!window.confirm(
						"导入会替换当前字数和时长统计；不含时长的旧备份会清空现有时长。替换前会自动备份。继续导入？"
					)
				) {
					return;
				}
				await this.activityService.importData(serialized);
				new Notice(local.settings_import_success);
				this.display();
			} catch (error) {
				console.error(error);
				new Notice(
					error instanceof EditActivityBackupError
						? local.settings_backup_failed
						: local.settings_import_failed
				);
			}
		};
		return importInput;
	}

	private createRestoreSetting(
		container: HTMLElement,
		local: ReturnType<typeof Locals.get>
	): void {
		new Setting(container)
			.setName(local.settings_restore)
			.setDesc(local.settings_restore_description)
			.addButton((button) =>
				button
					.setButtonText(local.settings_restore_button)
					.onClick(async () => {
						if (!window.confirm(local.settings_restore_confirm)) {
							return;
						}
						try {
							const restored =
								await this.activityService.restoreLatestBackup();
							new Notice(
								restored
									? local.settings_restore_success
									: local.settings_restore_none
							);
							if (restored) {
								this.display();
							}
						} catch (error) {
							console.error(error);
							new Notice(local.settings_restore_failed);
						}
					})
			);
	}

	private createClearSetting(
		container: HTMLElement,
		local: ReturnType<typeof Locals.get>
	): void {
		new Setting(container)
			.setName(local.settings_clear)
			.setDesc(local.settings_clear_description)
			.setClass("cg-settings-danger")
			.addButton((button) =>
				button
					.setWarning()
					.setButtonText(local.settings_clear_button)
					.onClick(async () => {
						if (!window.confirm(local.settings_clear_confirm)) {
							return;
						}
						try {
							await this.activityService.clearData();
							new Notice(local.settings_clear_success);
						} catch (error) {
							console.error(error);
							new Notice(local.settings_backup_failed);
						}
					})
			);
	}

	private createSection(
		container: HTMLElement,
		key: (typeof SETTINGS_SECTION_KEYS)[number],
		title: string,
		status?: string
	): HTMLElement {
		const section = container.createDiv({ cls: "cg-settings-section" });
		section.setAttribute("data-section", key);
		const header = section.createDiv({ cls: "cg-settings-section-head" });
		header.createEl("h3", { text: title });
		if (status !== undefined) {
			this.timeStatusEl = header.createSpan({
				cls: "cg-settings-status",
				text: status,
			});
			this.timeStatusEl.setAttribute("aria-live", "polite");
		}
		return section;
	}

	private resetIdleTimeoutInput(text: { setValue(value: string): unknown }): void {
		new Notice("请输入 1—10080 的整数分钟，原设置未变更。");
		text.setValue(String(this.activityService.getSettings().idleTimeoutMinutes));
	}

	private updateTimeStatus(): void {
		if (this.timeStatusEl) {
			this.timeStatusEl.textContent =
				this.activityService.getTimeTrackingStatus();
		}
	}

	private startServiceListening(): void {
		this.stopServiceListening();
		this.unsubscribeService = this.activityService.subscribe((event) => {
			if (
				event.type === "TIME_STATS" ||
				event.type === "COVERAGE" ||
				event.type === "IMPORT" ||
				event.type === "SETTINGS"
			) {
				this.updateTimeStatus();
			}
		});
	}

	private stopServiceListening(): void {
		this.unsubscribeService?.();
		this.unsubscribeService = undefined;
	}

	private downloadExport(serialized: string): void {
		const blob = new Blob([serialized], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = "contribution-graph-edit-activity.json";
		link.click();
		window.setTimeout(() => URL.revokeObjectURL(url), 0);
	}
}
