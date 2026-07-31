import {
	App,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFolder,
} from "obsidian";
import { Locals } from "src/i18/messages";
import { EditActivityService } from "./EditActivityService";
import {
	getSelectableVaultFolders,
	VaultFolderSuggestModal,
} from "./VaultFolderSuggestModal";

export class EditActivitySettingTab extends PluginSettingTab {
	constructor(
		app: App,
		plugin: Plugin,
		private readonly activityService: EditActivityService
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const local = Locals.get();
		const settings = this.activityService.getSettings();
		containerEl.empty();
		containerEl.addClass("contribution-graph-settings");

		containerEl.createEl("h2", {
			text: local.settings_activity_heading,
		});
		containerEl.createEl("p", {
			cls: "setting-item-description contribution-graph-settings-intro",
			text: local.settings_activity_description,
		});

		new Setting(containerEl)
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

		new Setting(containerEl)
			.setName(local.settings_exclude_whitespace)
			.setDesc(local.settings_exclude_whitespace_description)
			.addToggle((toggle) =>
				toggle
					.setValue(settings.excludeWhitespace)
					.onChange(async (excludeWhitespace) => {
						await this.activityService.setExcludeWhitespace(
							excludeWhitespace
						);
					})
			);

		const selectableFolders = getSelectableVaultFolders(
			this.app,
			settings.trackedFolders
		);
		new Setting(containerEl)
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
			const exists =
				this.app.vault.getAbstractFileByPath(folderPath) instanceof
				TFolder;
			const folderSetting = new Setting(containerEl)
				.setName(folderPath)
				.setClass("contribution-graph-tracked-folder-item")
				.addExtraButton((button) =>
					button
						.setIcon("trash")
						.setTooltip(local.settings_tracked_folders_remove)
						.onClick(async () => {
							await this.activityService.setTrackedFolders(
								settings.trackedFolders.filter(
									(path) => path !== folderPath
								)
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

		const dataHeading = containerEl.createEl("h3", {
			text: local.settings_data_heading,
		});
		dataHeading.addClass("contribution-graph-settings-section");

		new Setting(containerEl)
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

		const importInput = containerEl.createEl("input", {
			type: "file",
			attr: {
				accept: "application/json,.json",
				"aria-label": local.settings_import,
			},
		});
		importInput.addClass("contribution-graph-hidden-input");
		importInput.onchange = async () => {
			const file = importInput.files?.[0];
			if (!file) {
				return;
			}
			try {
				await this.activityService.importData(await file.text());
				new Notice(local.settings_import_success);
				this.display();
			} catch (error) {
				console.error(error);
				new Notice(local.settings_import_failed);
			}
		};

		new Setting(containerEl)
			.setName(local.settings_import)
			.setDesc(local.settings_import_description)
			.addButton((button) =>
				button
					.setButtonText(local.settings_import_button)
					.onClick(() => importInput.click())
			);

		new Setting(containerEl)
			.setName(local.settings_clear)
			.setDesc(local.settings_clear_description)
			.addButton((button) =>
				button
					.setWarning()
					.setButtonText(local.settings_clear_button)
					.onClick(async () => {
						if (!window.confirm(local.settings_clear_confirm)) {
							return;
						}
						await this.activityService.clearData();
						new Notice(local.settings_clear_success);
					})
			);
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
