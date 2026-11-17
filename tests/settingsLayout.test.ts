import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
	class FakeElement {
		children: FakeElement[] = [];
		classes = new Set<string>();
		attributes = new Map<string, string>();
		textContent = "";
		value = "";
		onchange?: () => void;
		files?: Array<{ text(): Promise<string> }>;
		listeners = new Map<string, () => void>();
		_setting?: FakeSetting;
		inputEl = this;

		constructor(readonly tagName = "div") {}

		createEl(tagName: string, options: { cls?: string; text?: string; attr?: Record<string, string> } = {}): FakeElement {
			const child = new FakeElement(tagName);
			if (options.cls) child.addClass(options.cls);
			if (options.text) child.textContent = options.text;
			for (const [key, value] of Object.entries(options.attr ?? {})) {
				child.setAttribute(key, value);
			}
			this.children.push(child);
			return child;
		}

		createDiv(options: { cls?: string; text?: string } = {}): FakeElement {
			return this.createEl("div", options);
		}

		createSpan(options: { cls?: string; text?: string } = {}): FakeElement {
			return this.createEl("span", options);
		}

		addClass(value: string): void {
			for (const className of value.split(/\s+/)) {
				if (className) this.classes.add(className);
			}
		}

		setAttribute(name: string, value: string): void {
			this.attributes.set(name, value);
		}

		empty(): void {
			this.children = [];
		}

		addEventListener(type: string, listener: () => void): void {
			this.listeners.set(type, listener);
		}

		click(): void {}

		querySelectorAll(selector: string): FakeElement[] {
			const matches = (element: FakeElement): boolean => {
				if (selector === ".cg-settings-section") {
					return element.classes.has("cg-settings-section");
				}
				if (selector === ".cg-settings-header") {
					return element.classes.has("cg-settings-header");
				}
				if (selector === ".cg-settings-status") {
					return element.classes.has("cg-settings-status");
				}
				if (selector === ".cg-settings-save-status") {
					return element.classes.has("cg-settings-save-status");
				}
				return false;
			};
			const found: FakeElement[] = [];
			const visit = (element: FakeElement): void => {
				if (matches(element)) found.push(element);
				for (const child of element.children) visit(child);
			};
			for (const child of this.children) visit(child);
			return found;
		}
	}

	class FakeSetting {
		readonly element = new FakeElement("div");
		name = "";
		description = "";
		toggle?: { value: boolean; handler?: (value: boolean) => Promise<void> };
		buttons: Array<{
			text: string;
			disabled: boolean;
			handler?: () => void | Promise<void>;
		}> = [];
		extraButtons: Array<{ handler?: () => void | Promise<void> }> = [];

		constructor(container: FakeElement) {
			this.element._setting = this;
			container.children.push(this.element);
		}

		setName(name: string): this {
			this.name = name;
			return this;
		}

		setDesc(description: string): this {
			this.description = description;
			return this;
		}

		setClass(className: string): this {
			this.element.addClass(className);
			return this;
		}

		setWarning(): this {
			return this;
		}

		addToggle(callback: (toggle: { setValue(value: boolean): any; onChange(handler: (value: boolean) => Promise<void>): any }) => void): this {
			const toggle: any = {
				value: false,
				setValue: (value: boolean) => {
					toggle.value = value;
					return toggle;
				},
				onChange: (handler: (value: boolean) => Promise<void>) => {
					this.toggle = toggle;
					toggle.handler = handler;
					return toggle;
				},
			};
			callback(toggle);
			this.toggle = toggle;
			return this;
		}

		addText(callback: (text: { setValue(value: string): any; getValue(): string; inputEl: FakeElement }) => void): this {
			const text = {
				setValue: (value: string) => {
					this.element.value = value;
					return text;
				},
				getValue: () => this.element.value,
				inputEl: this.element,
			};
			callback(text);
			return this;
		}

		addButton(callback: (button: { setButtonText(text: string): any; setDisabled(disabled: boolean): any; onClick(handler: () => void | Promise<void>): any }) => void): this {
			const record: {
				text: string;
				disabled: boolean;
				handler?: () => void | Promise<void>;
			} = {
				text: "",
				disabled: false,
			};
			const button = {
				setWarning: () => button,
				setButtonText: (text: string) => {
					record.text = text;
					if (!this.buttons.includes(record)) this.buttons.push(record);
					return button;
				},
				setDisabled: (disabled: boolean) => {
					record.disabled = disabled;
					return button;
				},
				onClick: (handler: () => void | Promise<void>) => {
					record.handler = handler;
					return button;
				},
			};
			callback(button);
			return this;
		}

		addExtraButton(callback: (button: { setIcon(icon: string): any; setTooltip(text: string): any; onClick(handler: () => void | Promise<void>): any }) => void): this {
			const record: { handler?: () => void | Promise<void> } = {};
			const button = {
				setIcon: (_icon: string) => button,
				setTooltip: (_text: string) => button,
				onClick: (handler: () => void | Promise<void>) => {
					record.handler = handler;
					return button;
				},
			};
			callback(button);
			this.extraButtons.push(record);
			return this;
		}
	}

	class FakePluginSettingTab {
		containerEl = new FakeElement("div");
		constructor(readonly app: unknown, readonly plugin: unknown) {}
		hide(): void {}
	}

	class FakeFolder {}
	class FakeFile {
		constructor(readonly path: string, readonly extension: string) {}
	}
	class FakeSuggestModal {
		static last?: FakeSuggestModal;
		constructor(_app: unknown) {
			FakeSuggestModal.last = this;
		}
		setPlaceholder(_value: string): void {}
		open(): void {}
	}

	return {
		Notice: class Notice {},
		Plugin: class Plugin {},
		PluginSettingTab: FakePluginSettingTab,
		Setting: FakeSetting,
		TFolder: FakeFolder,
		TFile: FakeFile,
		FuzzySuggestModal: FakeSuggestModal,
	};
});

import {
	EditActivitySettingTab,
	parseIdleTimeoutMinutes,
	parseSaveIntervalSeconds,
	SETTINGS_SECTION_KEYS,
} from "../src/activity/EditActivitySettingTab";
import { getSelectableVaultNotes } from "../src/activity/VaultNoteSuggestModal";
import { FuzzySuggestModal, TFile } from "obsidian";

function findSetting(container: any, name: string): any {
	const visit = (element: any): any => {
		if (element._setting?.name === name) return element._setting;
		for (const child of element.children ?? []) {
			const found = visit(child);
			if (found) return found;
		}
		return undefined;
	};
	return visit(container);
}

function makeTestFile(path: string, extension: string): TFile {
	return Object.assign(Object.create(TFile.prototype), { path, extension });
}

function createService() {
	let settings = {
		timeTrackingEnabled: false,
		idleTimeoutMinutes: 5,
		saveIntervalSeconds: 60,
		trackingEnabled: false,
		excludeWhitespace: true,
		excludeMarkdownFormatting: false,
		trackedFolders: [] as string[],
		strictUserInputOnly: true,
		countPastedText: true,
		trackedFiles: [] as string[],
	};
	let status = "时长统计：未启用";
	let saveStatus = "已保存";
	let manualPaused = false;
	const listeners = new Set<(event: { type: string }) => void>();
	const service = {
		getSettings: vi.fn(() => ({
			...settings,
			trackedFolders: [...settings.trackedFolders],
			trackedFiles: [...settings.trackedFiles],
		})),
		getStatisticsFolder: vi.fn(() => "Template/数据/学习统计"),
		getTimeTrackingStatus: vi.fn(() => status),
		getTimeTrackingSnapshot: vi.fn(() => ({
			reason: status.includes("未启用")
				? "DISABLED"
				: status.includes("手动暂停")
					? "MANUAL"
					: status.includes("计时中")
						? "ACTIVE"
						: "IDLE",
				manualPaused,
				enabled: settings.timeTrackingEnabled,
				todaySeconds: 0,
				todayPendingSeconds: 0,
				remainingMs: 300000,
			})),
		getSaveStatus: vi.fn(() => saveStatus),
		subscribe: vi.fn((listener: (event: { type: string }) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}),
		setTimeTrackingEnabled: vi.fn(async (enabled: boolean) => {
			settings = { ...settings, timeTrackingEnabled: enabled };
			status = enabled ? "时长统计：计时中" : "时长统计：未启用";
			for (const listener of listeners) listener({ type: "TIME_STATS" });
		}),
		setManualPause: vi.fn(async (paused: boolean) => {
			manualPaused = paused;
			status = paused ? "时长统计：手动暂停" : "时长统计：计时中";
			for (const listener of listeners) listener({ type: "TIME_STATUS" });
		}),
		setIdleTimeoutMinutes: vi.fn(async (minutes: number) => {
			settings = { ...settings, idleTimeoutMinutes: minutes };
		}),
		setSaveIntervalSeconds: vi.fn(async (seconds: number) => {
			settings = { ...settings, saveIntervalSeconds: seconds };
		}),
		setTrackingEnabled: vi.fn(async (enabled: boolean) => {
			settings = { ...settings, trackingEnabled: enabled };
		}),
		setExcludeWhitespace: vi.fn(async () => undefined),
		setExcludeMarkdownFormatting: vi.fn(async () => undefined),
		setStrictUserInputOnly: vi.fn(async () => undefined),
		setCountPastedText: vi.fn(async () => undefined),
		setTrackedFolders: vi.fn(async () => undefined),
		setTrackedFiles: vi.fn(async (trackedFiles: string[]) => {
			settings = { ...settings, trackedFiles: [...trackedFiles] };
		}),
		exportData: vi.fn(() => "{}"),
		importData: vi.fn(async () => undefined),
		restoreLatestBackup: vi.fn(async () => false),
		clearData: vi.fn(async () => undefined),
		emit(event: { type: string }) {
			for (const listener of listeners) listener(event);
		},
	};
	return {
		service,
		settings: () => settings,
		enabled: (value: boolean) => {
			settings = { ...settings, timeTrackingEnabled: value };
		},
		status: (value: string) => (status = value),
		setManualPause: service.setManualPause,
		saveStatus: (value: string) => (saveStatus = value),
	};
}

describe("EditActivitySettingTab layout", () => {
	it("defines the four settings sections in the agreed order", () => {
		expect(SETTINGS_SECTION_KEYS).toEqual([
				"time",
				"characters",
				"scope",
				"data",
			]);
	});

	it("validates the adjustable idle threshold", () => {
		expect(parseIdleTimeoutMinutes("5")).toBe(5);
		expect(parseIdleTimeoutMinutes("1")).toBe(1);
		expect(parseIdleTimeoutMinutes("10080")).toBe(10080);
		expect(parseIdleTimeoutMinutes("0")).toBeNull();
		expect(parseIdleTimeoutMinutes("1.5")).toBeNull();
		expect(parseIdleTimeoutMinutes("10081")).toBeNull();
	});

	it("validates the adjustable save interval", () => {
		expect(parseSaveIntervalSeconds("15")).toBe(15);
		expect(parseSaveIntervalSeconds("60")).toBe(60);
		expect(parseSaveIntervalSeconds("1800")).toBe(1800);
		expect(parseSaveIntervalSeconds("14")).toBeNull();
		expect(parseSaveIntervalSeconds("1801")).toBeNull();
		expect(parseSaveIntervalSeconds("1.5")).toBeNull();
	});

	it("lists unselected Markdown files, including files at the vault root", () => {
		const files = [
			makeTestFile("根笔记.md", "md"),
			makeTestFile("临床医学/妇产科.md", "md"),
			makeTestFile("附件/图片.png", "png"),
			makeTestFile("临床医学/已选.md", "md"),
		];
		const app = { vault: { getAllLoadedFiles: () => files } } as any;

		expect(getSelectableVaultNotes(app, ["临床医学/已选.md"]).map((file) => file.path)).toEqual([
			"根笔记.md",
			"临床医学/妇产科.md",
		]);
	});

	it("does not describe a files-only scope as whole-vault collection", () => {
		Object.defineProperty(globalThis, "window", {
			value: globalThis,
			configurable: true,
		});
		Object.defineProperty(globalThis, "localStorage", {
			value: { getItem: () => "zh" },
			configurable: true,
		});
		const { service } = createService();
		const settings = service.getSettings();
		(settings as any).trackedFiles = ["根笔记.md"];
		service.getSettings.mockReturnValue(settings);
		const app = {
			vault: {
				getAllLoadedFiles: () => [makeTestFile("根笔记.md", "md")],
				getAbstractFileByPath: (path: string) =>
					path === "根笔记.md" ? makeTestFile(path, "md") : undefined,
			},
		} as any;
		const tab = new EditActivitySettingTab(app, {} as any, service as any, service.setManualPause);

		tab.display();
		const container = (tab as any).containerEl;
		const folderSetting = findSetting(container, "采集目录");
		const noteSetting = findSetting(container, "指定笔记");

		expect(folderSetting.description).not.toContain("整个仓库");
		expect(noteSetting).toBeDefined();
	});

	it("selects a note and keeps missing configured notes removable", async () => {
		Object.defineProperty(globalThis, "window", {
			value: globalThis,
			configurable: true,
		});
		Object.defineProperty(globalThis, "localStorage", {
			value: { getItem: () => "zh" },
			configurable: true,
		});
		const { service } = createService();
		const initialSettings = service.getSettings();
		let trackedFiles = ["缺失.md"];
		service.getSettings.mockImplementation(() => ({
			...initialSettings,
			trackedFiles: [...trackedFiles],
		}));
		service.setTrackedFiles.mockImplementation(async (files) => {
			trackedFiles = [...files];
		});
		const app = {
			vault: {
				getAllLoadedFiles: () => [makeTestFile("新笔记.md", "md")],
				getAbstractFileByPath: (path: string) =>
					path === "新笔记.md" ? makeTestFile(path, "md") : undefined,
			},
		} as any;
		const tab = new EditActivitySettingTab(app, {} as any, service as any, service.setManualPause);

		tab.display();
		const notePicker = findSetting((tab as any).containerEl, "指定笔记");
		await notePicker.buttons[0].handler!();
		const modal = (FuzzySuggestModal as any).last;
		modal.onChooseItem(modal.getItems()[0]);
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		expect(service.setTrackedFiles).toHaveBeenLastCalledWith(["缺失.md", "新笔记.md"]);

		const missing = findSetting((tab as any).containerEl, "缺失.md");
		expect(missing.element.classes.has("is-missing")).toBe(true);
		await missing.extraButtons[0].handler!();
		expect(service.setTrackedFiles).toHaveBeenLastCalledWith(["新笔记.md"]);
	});

	it("renders the public display contract and keeps time and character toggles independent", async () => {
		Object.defineProperty(globalThis, "window", {
			value: globalThis,
			configurable: true,
		});
		Object.defineProperty(globalThis, "localStorage", {
			value: { getItem: () => "zh" },
			configurable: true,
		});
		const { service, enabled, status, saveStatus, setManualPause } = createService();
		const app = {
			vault: {
				getAllLoadedFiles: () => [],
				getAbstractFileByPath: () => undefined,
			},
		} as any;
		const tab = new EditActivitySettingTab(
			app,
			{} as any,
			service as any,
			setManualPause
		);

		tab.display();
		const container = (tab as any).containerEl;
		const sections = container.querySelectorAll(".cg-settings-section");
		expect(sections.map((section: any) => section.attributes.get("data-section"))).toEqual([
			"time",
			"characters",
			"scope",
			"data",
		]);
		expect(container.querySelectorAll(".cg-settings-header")).toHaveLength(1);
		expect(container.querySelectorAll(".cg-settings-status")[0].textContent).toBe(
			"时长：未启用"
		);
		const timeControl = findSetting(container, "本次时长统计");
		expect(timeControl.buttons[0]).toMatchObject({
			text: "暂停本次",
			disabled: true,
		});
		await timeControl.buttons[0].handler!();
		expect(setManualPause).not.toHaveBeenCalled();
		const saveStatusElement = container.querySelectorAll(
			".cg-settings-save-status"
		)[0];
		expect(saveStatusElement.textContent).toBe(
			"保存状态：已保存"
		);
		expect(service.subscribe).toHaveBeenCalledTimes(1);

		enabled(true);
		status("时长统计：计时中");
		service.emit({ type: "TIME_STATUS" });
		expect(container.querySelectorAll(".cg-settings-status")[0].textContent).toBe(
			"时长：计时中"
		);
		expect(timeControl.buttons[0]).toMatchObject({
			text: "暂停本次",
			disabled: false,
		});
		await timeControl.buttons[0].handler!();
		expect(setManualPause).toHaveBeenLastCalledWith(true);
		expect(container.querySelectorAll(".cg-settings-status")[0].textContent).toBe(
			"时长：手动暂停"
		);
		expect(timeControl.buttons[0].text).toBe("恢复本次");

		saveStatus("正在保存");
		service.emit({ type: "SAVE_STATE" });
		expect(container.querySelectorAll(".cg-settings-save-status")[0]).toBe(
			saveStatusElement
		);
		expect(saveStatusElement.textContent).toBe(
			"保存状态：正在保存"
		);

		const idleSetting = findSetting(container, "空闲阈值（分钟）");
		idleSetting.element.value = "12";
		await idleSetting.element.listeners.get("change")!();
		expect(service.setIdleTimeoutMinutes).toHaveBeenCalledWith(12);
		idleSetting.element.value = "0";
		await idleSetting.element.listeners.get("change")!();
		expect(service.setIdleTimeoutMinutes).toHaveBeenCalledTimes(1);
		expect(idleSetting.element.value).toBe("12");

		const saveIntervalSetting = findSetting(
			container,
			"统计自动保存间隔（秒）"
		);
		expect(saveIntervalSetting.element.value).toBe("60");
		saveIntervalSetting.element.value = "120";
		await saveIntervalSetting.element.listeners.get("change")!();
		expect(service.setSaveIntervalSeconds).toHaveBeenCalledWith(120);
		saveIntervalSetting.element.value = "14";
		await saveIntervalSetting.element.listeners.get("change")!();
		expect(service.setSaveIntervalSeconds).toHaveBeenCalledTimes(1);
		expect(saveIntervalSetting.element.value).toBe("120");
		const twoMinutePreset = saveIntervalSetting.buttons.find(
			(button: { text: string }) => button.text === "2 分钟"
		);
		expect(twoMinutePreset).toBeDefined();
		await twoMinutePreset!.handler!();
		expect(service.setSaveIntervalSeconds).toHaveBeenLastCalledWith(120);

		const timeSetting = findSetting(container, "启用时长统计");
		status("时长统计：计时中");
		await timeSetting.toggle.handler!(true);
		expect(service.setTimeTrackingEnabled).toHaveBeenCalledWith(true);
		expect(service.setTrackingEnabled).not.toHaveBeenCalled();

		const characterSetting = findSetting((tab as any).containerEl, "采集编辑活动");
		await characterSetting.toggle.handler!(true);
		expect(service.setTrackingEnabled).toHaveBeenCalledWith(true);
		expect(service.setTimeTrackingEnabled).toHaveBeenCalledTimes(1);

		const detachedStatus = container.querySelectorAll(".cg-settings-status")[0];
		const statusBeforeHide = detachedStatus.textContent;
		const detachedSaveStatus = container.querySelectorAll(".cg-settings-save-status")[0];
		const saveStatusBeforeHide = detachedSaveStatus.textContent;
		tab.hide();
		status("时长统计：空闲暂停");
		saveStatus("保存失败，待重试");
		service.emit({ type: "TIME_STATS" });
		service.emit({ type: "SAVE_STATE" });
		expect(detachedStatus.textContent).toBe(statusBeforeHide);
		expect(detachedSaveStatus.textContent).toBe(saveStatusBeforeHide);
	});
});
