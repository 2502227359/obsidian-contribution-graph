import {
	ChangeSet,
	EditorState,
	Text,
	Transaction,
} from "@codemirror/state";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import { EditActivityService } from "../src/activity/EditActivityService";

interface FakePlugin {
	loadData: ReturnType<typeof vi.fn>;
	saveData: ReturnType<typeof vi.fn>;
	manifest: { dir: string };
	app: {
		vault: {
			adapter: {
				read: ReturnType<typeof vi.fn>;
				write: ReturnType<typeof vi.fn>;
				list: ReturnType<typeof vi.fn>;
			};
		};
	};
	files: Map<string, string>;
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value));
}

function createPlugin(
	initialData: unknown = null,
	saveData = vi.fn(async () => undefined)
): FakePlugin {
	const files = new Map<string, string>();
	return {
		loadData: vi.fn(async () => clone(initialData)),
		saveData,
		manifest: { dir: ".obsidian/plugins/contribution-graph-local" },
		app: {
			vault: {
				adapter: {
					read: vi.fn(async (path: string) =>
						files.get(path) ?? JSON.stringify(initialData)
					),
					write: vi.fn(async (path: string, content: string) => {
						files.set(path, content);
					}),
					list: vi.fn(async () => ({
						files: [...files.keys()],
						folders: [],
					})),
				},
			},
		},
		files,
	};
}

function createStoredData(addedChars: number) {
	return {
		schemaVersion: 8,
		settings: {
			trackingEnabled: true,
			excludeWhitespace: true,
			excludeMarkdownFormatting: false,
			trackedFolders: [],
			strictUserInputOnly: true,
			countPastedText: true,
		},
		trackingPeriods: [{ startDate: "2026-07-31" }],
		collectionScopePeriods: [
			{ startDate: "2026-07-31", folders: [] },
		],
		dailyStats: {
			"2026-07-31": {
				addedChars,
				deletedChars: 0,
				documents: {
					"Notes/Test.md": {
						addedChars,
						deletedChars: 0,
					},
				},
			},
		},
	};
}

describe("EditActivityService persistence and lifecycle", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		Object.defineProperty(globalThis, "window", {
			value: globalThis,
			configurable: true,
		});
		Object.defineProperty(globalThis, "localStorage", {
			value: {
				getItem: () => "en",
			},
			configurable: true,
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	it("persists a recorded edit when the plugin unloads", async () => {
		const now = new Date(2026, 6, 31, 16, 0, 0);
		const plugin = createPlugin();
		const service = new EditActivityService(
			plugin as never,
			() => now
		);
		await service.initialize();
		await service.setTrackingEnabled(true);
		plugin.saveData.mockClear();

		const startDocument = Text.of(["hello"]);
		const changes = ChangeSet.of(
			[{ from: 5, insert: "你" }],
			startDocument.length
		);
		(
			service as unknown as {
				recordChanges: (
					startDocument: Text,
					changes: ChangeSet,
					filePath: string,
					cursorOffset: number
				) => void;
			}
		).recordChanges(startDocument, changes, "Notes/Test.md", 6);

		expect(service.getDailyEditStats()).toEqual([
			expect.objectContaining({
				date: "2026-07-31",
				addedChars: 1,
				deletedChars: 0,
				changedChars: 1,
				documents: [
					expect.objectContaining({
						path: "Notes/Test.md",
						lastEditPosition: { line: 0, column: 6 },
					}),
				],
			}),
		]);

		await service.unload();
		expect(plugin.saveData).toHaveBeenCalledTimes(1);
		expect(plugin.saveData.mock.calls[0][0]).toMatchObject({
			schemaVersion: 10,
			dailyStats: {
				"2026-07-31": {
					addedChars: 1,
					deletedChars: 0,
				},
			},
		});
	});

	it("records counting policy changes while tracking is enabled", async () => {
		const plugin = createPlugin();
		const service = new EditActivityService(
			plugin as never,
			() => new Date(2026, 6, 31, 16, 0, 0)
		);
		await service.initialize();
		await service.setTrackingEnabled(true);
		const record = (text: string) => {
			const document = Text.of([""]);
			const changes = ChangeSet.of(
				[{ from: 0, insert: text }],
				document.length
			);
			(
				service as unknown as {
					recordChanges: (
						document: Text,
						changes: ChangeSet,
						filePath: string,
						cursorOffset: number
					) => void;
				}
			).recordChanges(document, changes, "Notes/Policy.md", text.length);
		};
		record("a");
		await service.setExcludeMarkdownFormatting(true);
		record("b");

		const exported = JSON.parse(service.exportData());
		expect(exported).toMatchObject({
			schemaVersion: 10,
			countingPolicyPeriods: [
				{
					startedAt: "2026-07-31T08:00:00.000Z",
					endedAt: "2026-07-31T08:00:00.000Z",
					policy: { excludeMarkdownFormatting: false },
				},
				{
					startedAt: "2026-07-31T08:00:00.000Z",
					policy: { excludeMarkdownFormatting: true },
				},
			],
		});
		expect(service.getDailyEditStats()[0].countingPolicyChanged).toBe(true);
		await service.unload();
	});

	it("settles Markdown-aware edits when the editor loses focus", async () => {
		const plugin = createPlugin();
		const service = new EditActivityService(
			plugin as never,
			() => new Date(2026, 6, 31, 16, 0, 0)
		);
		await service.initialize();
		await service.setTrackingEnabled(true);
		await service.setStrictUserInputOnly(false);
		await service.setExcludeMarkdownFormatting(true);
		(
			service as unknown as { getMarkdownFilePath: () => string }
		).getMarkdownFilePath = () => "Notes/Markdown.md";

		const view = { hasFocus: true, composing: false };
		const firstState = EditorState.create({ doc: "" });
		const first = firstState.update({
			changes: { from: 0, insert: "**" },
			annotations: Transaction.userEvent.of("input.type"),
		});
		const second = first.state.update({
			changes: { from: 2, insert: "正文**" },
			annotations: Transaction.userEvent.of("input.type"),
		});
		const handleUpdate = (transaction: Transaction) =>
			(
				service as unknown as {
					handleEditorUpdate: (update: unknown) => void;
				}
			).handleEditorUpdate({
				docChanged: true,
				selectionSet: true,
				state: transaction.state,
				view,
				transactions: [transaction],
			});
		handleUpdate(first);
		handleUpdate(second);
		expect(service.getDailyEditStats()).toEqual([]);

		(
			service as unknown as {
				handleTrustedDomEvent: (view: unknown, event: unknown) => void;
			}
		).handleTrustedDomEvent(view, { type: "blur", isTrusted: true });
		expect(service.getDailyEditStats()[0]).toMatchObject({
			addedChars: 6,
			deletedChars: 0,
		});
		await service.unload();
	});

	it("keeps a pending line edit on the date when it started", async () => {
		let now = new Date(2026, 6, 31, 23, 59, 59);
		const plugin = createPlugin();
		const service = new EditActivityService(plugin as never, () => now);
		await service.initialize();
		await service.setTrackingEnabled(true);
		await service.setStrictUserInputOnly(false);
		await service.setExcludeMarkdownFormatting(true);
		(
			service as unknown as { getMarkdownFilePath: () => string }
		).getMarkdownFilePath = () => "Notes/Midnight.md";

		const view = { hasFocus: true, composing: false };
		const state = EditorState.create({ doc: "" });
		const transaction = state.update({
			changes: { from: 0, insert: "before midnight" },
			annotations: Transaction.userEvent.of("input.type"),
		});
		(
			service as unknown as {
				handleEditorUpdate: (update: unknown) => void;
			}
		).handleEditorUpdate({
			docChanged: true,
			selectionSet: true,
			state: transaction.state,
			view,
			transactions: [transaction],
		});
		now = new Date(2026, 7, 1, 0, 0, 1);
		service.handleAppSuspend();

		expect(service.getDailyEditStats()).toEqual([
			expect.objectContaining({
				date: "2026-07-31",
				addedChars: 14,
			}),
		]);
		await service.unload();
	});

	it("retries a failed save without losing the pending state", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const saveData = vi
			.fn()
			.mockRejectedValueOnce(new Error("disk unavailable"))
			.mockResolvedValue(undefined);
		const plugin = createPlugin(null, saveData);
		const service = new EditActivityService(
			plugin as never,
			() => new Date(2026, 6, 31, 16, 0, 0)
		);
		await service.initialize();

		await service.setTrackingEnabled(true);
		expect(saveData).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(5000);
		expect(saveData).toHaveBeenCalledTimes(2);
		expect(saveData.mock.calls[1][0]).toMatchObject({
			settings: { trackingEnabled: true },
			trackingPeriods: [{ startDate: "2026-07-31" }],
		});

		await service.unload();
	});

	it("keeps distinct date coverage when tracking is paused and resumed", async () => {
		let now = new Date(2026, 6, 31, 16, 0, 0);
		const plugin = createPlugin();
		const service = new EditActivityService(
			plugin as never,
			() => now
		);
		await service.initialize();
		await service.setTrackingEnabled(true);

		now = new Date(2026, 7, 2, 9, 0, 0);
		await service.setTrackingEnabled(false);
		now = new Date(2026, 7, 5, 10, 0, 0);
		await service.setTrackingEnabled(true);

		expect(service.getTrackingPeriods()).toEqual([
			{ startDate: "2026-07-31", endDate: "2026-08-02" },
			{ startDate: "2026-08-05" },
		]);

		await service.unload();
	});

	it("normalizes, saves, and migrates tracked folder settings", async () => {
		const plugin = createPlugin();
		const service = new EditActivityService(
			plugin as never,
			() => new Date(2026, 6, 31, 16, 0, 0)
		);
		await service.initialize();

		await service.setTrackedFolders([
			"Projects/Writing/",
			"Projects",
			"Daily Notes",
		]);
		expect(service.getSettings().trackedFolders).toEqual([
			"Daily Notes",
			"Projects",
		]);

		service.handlePathRename("Projects", "Archive", true);
		expect(service.getSettings().trackedFolders).toEqual([
			"Archive",
			"Daily Notes",
		]);

		await service.unload();
		expect(plugin.saveData.mock.lastCall?.[0]).toMatchObject({
			schemaVersion: 10,
			settings: {
				trackedFolders: ["Archive", "Daily Notes"],
			},
		});
	});

	it("records editor transactions only inside configured folders", async () => {
		const plugin = createPlugin();
		const service = new EditActivityService(
			plugin as never,
			() => new Date(2026, 6, 31, 16, 0, 0)
		);
		await service.initialize();
		await service.setTrackingEnabled(true);
		await service.setTrackedFolders(["Projects"]);

		let currentPath = "Archive/Excluded.md";
		(
			service as unknown as {
				getMarkdownFilePath: () => string;
			}
		).getMarkdownFilePath = () => currentPath;
		const view = { hasFocus: true, composing: false };
		const dispatchInput = (text: string) => {
			(
				service as unknown as {
					handleTrustedDomEvent: (
						view: unknown,
						event: unknown
					) => void;
				}
			).handleTrustedDomEvent(view, {
				type: "beforeinput",
				isTrusted: true,
				inputType: "insertText",
			});
			const state = EditorState.create({ doc: "" });
			const transaction = state.update({
				changes: { from: 0, insert: text },
				annotations: Transaction.userEvent.of("input.type"),
			});
			(
				service as unknown as {
					handleEditorUpdate: (update: unknown) => void;
				}
			).handleEditorUpdate({
				docChanged: true,
				view,
				transactions: [transaction],
			});
		};

		dispatchInput("excluded");
		expect(service.getDailyEditStats()).toEqual([]);

		currentPath = "Projects/Included.md";
		dispatchInput("included");
		expect(service.getDailyEditStats()).toEqual([
			expect.objectContaining({
				addedChars: 8,
				documents: [
					expect.objectContaining({
						path: "Projects/Included.md",
					}),
				],
			}),
		]);

		await service.unload();
	});

	it("requires a matching trusted input intent and keeps intents view-local", async () => {
		const plugin = createPlugin();
		const service = new EditActivityService(
			plugin as never,
			() => new Date(2026, 6, 31, 16, 0, 0)
		);
		await service.initialize();
		await service.setTrackingEnabled(true);
		(
			service as unknown as { getMarkdownFilePath: () => string }
		).getMarkdownFilePath = () => "Notes/Trusted.md";

		const firstView = { hasFocus: true, composing: false };
		const secondView = { hasFocus: true, composing: false };
		const trustTyping = (view: unknown) =>
			(
				service as unknown as {
					handleTrustedDomEvent: (view: unknown, event: unknown) => void;
				}
			).handleTrustedDomEvent(view, {
				type: "beforeinput",
				isTrusted: true,
				inputType: "insertText",
			});
		const dispatch = (
			view: unknown,
			text: string,
			remote = false
		) => {
			const state = EditorState.create({ doc: "" });
			const transaction = state.update({
				changes: { from: 0, insert: text },
				annotations: remote
					? [
							Transaction.userEvent.of("input.type"),
							Transaction.remote.of(true),
					  ]
					: Transaction.userEvent.of("input.type"),
			});
			(
				service as unknown as {
					handleEditorUpdate: (update: unknown) => void;
				}
			).handleEditorUpdate({
				docChanged: true,
				view,
				transactions: [transaction],
			});
		};

		// A template-like input.type transaction has no trusted DOM intent.
		dispatch(firstView, "template");
		expect(service.getDailyEditStats()).toEqual([]);

		// An intent from another pane cannot authorize this pane.
		trustTyping(firstView);
		dispatch(secondView, "other-pane");
		expect(service.getDailyEditStats()).toEqual([]);

		dispatch(firstView, "typed");
		expect(service.getDailyEditStats()[0]).toMatchObject({
			addedChars: 5,
		});

		// The intent is single-use, and remote edits remain excluded.
		dispatch(firstView, "automatic");
		trustTyping(firstView);
		dispatch(firstView, "remote", true);
		expect(service.getDailyEditStats()[0]).toMatchObject({
			addedChars: 5,
		});
		await service.unload();
	});

	it("excludes the whole paste replacement when paste counting is disabled", async () => {
		const plugin = createPlugin();
		const service = new EditActivityService(
			plugin as never,
			() => new Date(2026, 6, 31, 16, 0, 0)
		);
		await service.initialize();
		await service.setTrackingEnabled(true);
		await service.setCountPastedText(false);
		expect(service.getSettings().countPastedText).toBe(false);
		(
			service as unknown as { getMarkdownFilePath: () => string }
		).getMarkdownFilePath = () => "Notes/Paste.md";

		const view = { hasFocus: true, composing: false };
		(
			service as unknown as {
				handleTrustedDomEvent: (view: unknown, event: unknown) => void;
			}
		).handleTrustedDomEvent(view, {
			type: "paste",
			isTrusted: true,
		});
		const pasteState = EditorState.create({ doc: "replace me" });
		const pasteTransaction = pasteState.update({
			changes: { from: 0, to: 10, insert: "pasted text" },
			annotations: Transaction.userEvent.of("input.paste"),
		});
		(
			service as unknown as {
				handleEditorUpdate: (update: unknown) => void;
			}
		).handleEditorUpdate({
			docChanged: true,
			view,
			transactions: [pasteTransaction],
		});
		expect(service.getDailyEditStats()).toEqual([]);

		(
			service as unknown as {
				handleTrustedDomEvent: (view: unknown, event: unknown) => void;
			}
		).handleTrustedDomEvent(view, {
			type: "beforeinput",
			isTrusted: true,
			inputType: "insertText",
		});
		const typingState = EditorState.create({ doc: "" });
		const typingTransaction = typingState.update({
			changes: { from: 0, insert: "typed" },
			annotations: Transaction.userEvent.of("input.type"),
		});
		(
			service as unknown as {
				handleEditorUpdate: (update: unknown) => void;
			}
		).handleEditorUpdate({
			docChanged: true,
			view,
			transactions: [typingTransaction],
		});
		expect(service.getDailyEditStats()[0]).toMatchObject({
			addedChars: 5,
			deletedChars: 0,
		});
		await service.unload();
	});

	it("uses a real paste event as a compatibility-mode fallback", async () => {
		const plugin = createPlugin();
		const service = new EditActivityService(
			plugin as never,
			() => new Date(2026, 6, 31, 16, 0, 0)
		);
		await service.initialize();
		await service.setTrackingEnabled(true);
		await service.setStrictUserInputOnly(false);
		await service.setCountPastedText(false);
		(
			service as unknown as { getMarkdownFilePath: () => string }
		).getMarkdownFilePath = () => "Notes/CompatiblePaste.md";

		const view = { hasFocus: true, composing: false };
		(
			service as unknown as {
				handleTrustedDomEvent: (view: unknown, event: unknown) => void;
			}
		).handleTrustedDomEvent(view, {
			type: "paste",
			isTrusted: true,
		});
		const state = EditorState.create({ doc: "" });
		const transaction = state.update({
			changes: { from: 0, insert: "clipboard" },
			// Some editor integrations downgrade paste to a generic input event.
			annotations: Transaction.userEvent.of("input.type"),
		});
		(
			service as unknown as {
				handleEditorUpdate: (update: unknown) => void;
			}
		).handleEditorUpdate({
			docChanged: true,
			view,
			transactions: [transaction],
		});
		expect(service.getDailyEditStats()).toEqual([]);
		await service.unload();
	});

	it("restores the legacy userEvent policy in compatibility mode", async () => {
		const plugin = createPlugin();
		const service = new EditActivityService(
			plugin as never,
			() => new Date(2026, 6, 31, 16, 0, 0)
		);
		await service.initialize();
		await service.setTrackingEnabled(true);
		await service.setStrictUserInputOnly(false);
		(
			service as unknown as { getMarkdownFilePath: () => string }
		).getMarkdownFilePath = () => "Notes/Compatible.md";
		const state = EditorState.create({ doc: "" });
		const transaction = state.update({
			changes: { from: 0, insert: "legacy" },
			annotations: Transaction.userEvent.of("input.type"),
		});
		(
			service as unknown as {
				handleEditorUpdate: (update: unknown) => void;
			}
		).handleEditorUpdate({
			docChanged: true,
			view: { hasFocus: true, composing: false },
			transactions: [transaction],
		});
		expect(service.getDailyEditStats()[0]).toMatchObject({
			addedChars: 6,
		});
		await service.unload();
	});

	it("filters daily totals and documents independently for each graph folder", async () => {
		const plugin = createPlugin({
			schemaVersion: 5,
			settings: { trackingEnabled: false, excludeWhitespace: true, trackedFolders: [] },
			trackingPeriods: [{ startDate: "2026-07-31" }],
			collectionScopePeriods: [{ startDate: "2026-07-31", folders: [] }],
			dailyStats: {
				"2026-07-31": {
					addedChars: 15,
					deletedChars: 5,
					documents: {
						"Projects/A.md": { addedChars: 8, deletedChars: 2 },
						"Journal/B.md": { addedChars: 4, deletedChars: 3 },
					},
				},
			},
		});
		const service = new EditActivityService(plugin as never);
		await service.initialize();
		expect(service.getSettings().strictUserInputOnly).toBe(true);
		expect(service.getSettings().countPastedText).toBe(true);
		expect(service.getSettings().excludeMarkdownFormatting).toBe(false);

		expect(service.getDailyEditStats({ folders: ["Projects"] })[0]).toMatchObject({
			addedChars: 8,
			deletedChars: 2,
			changedChars: 10,
			documents: [{ path: "Projects/A.md" }],
			unattributedAddedChars: 3,
			unattributedDeletedChars: 0,
		});

		await service.unload();
	});

	it("records collection scope changes as separate coverage periods", async () => {
		let now = new Date(2026, 6, 31, 10, 0, 0);
		const plugin = createPlugin();
		const service = new EditActivityService(plugin as never, () => now);
		await service.initialize();
		await service.setTrackingEnabled(true);
		now = new Date(2026, 7, 1, 10, 0, 0);
		await service.setTrackedFolders(["Projects"]);

		expect(service.getCollectionScopePeriods()).toEqual([
			{ startDate: "2026-07-31", endDate: "2026-08-01", folders: [] },
			{ startDate: "2026-08-01", folders: ["Projects"] },
		]);
		await service.unload();
	});

	it("migrates schema 9 data without losing edit statistics", async () => {
		const stored = {
			...createStoredData(12),
			schemaVersion: 9,
			countingPolicyPeriods: [],
		};
		const plugin = createPlugin(stored);
		const service = new EditActivityService(plugin as never);
		await service.initialize();

		expect(service.getDailyEditStats()[0]).toMatchObject({
			addedChars: 12,
			deletedChars: 0,
		});
		expect(service.getGraphThemes()).toEqual([]);
		expect(JSON.parse(service.exportData())).toMatchObject({
			schemaVersion: 10,
			graphThemes: [],
		});
		await service.unload();
	});

	it("saves, replaces, and deletes reusable graph themes", async () => {
		const plugin = createPlugin();
		const service = new EditActivityService(plugin as never);
		await service.initialize();
		const theme = {
			id: "custom-writing",
			name: "Writing",
			colors: ["#dbe9f4", "#91bad6", "#477da7", "#153b5b"],
			density: "BALANCED" as const,
			cellWidth: 10,
			cellHeight: 10,
			cellGap: 2,
			cellShape: "50%",
			highlightToday: true,
			highlightWeekends: false,
			enableShadow: false,
		};

		await service.saveGraphTheme(theme);
		expect(service.getGraphThemes()).toEqual([theme]);
		await service.saveGraphTheme({
			...theme,
			colors: ["#fff0c2", "#e5bd62", "#a87921", "#5c3b00"],
		});
		expect(service.getGraphThemes()).toHaveLength(1);
		expect(service.getGraphThemes()[0].colors[0]).toBe("#fff0c2");

		await service.deleteGraphTheme(theme.id);
		expect(service.getGraphThemes()).toEqual([]);
		await service.unload();
	});

	it("accepts one to twenty theme colors and rejects larger palettes", async () => {
		const plugin = createPlugin();
		const service = new EditActivityService(plugin as never);
		await service.initialize();
		const theme = {
			id: "variable-palette",
			name: "Variable palette",
			colors: ["#123456"],
			density: "BALANCED" as const,
			cellGap: 2,
			highlightToday: true,
			highlightWeekends: false,
			enableShadow: false,
		};

		await expect(service.saveGraphTheme(theme)).resolves.toMatchObject({
			colors: ["#123456"],
		});
		const twentyColors = Array.from({ length: 20 }, (_, index) =>
			`#${index.toString(16).padStart(6, "0")}`
		);
		await expect(
			service.saveGraphTheme({ ...theme, colors: twentyColors })
		).resolves.toMatchObject({ colors: twentyColors });
		await expect(
			service.saveGraphTheme({ ...theme, colors: [] })
		).rejects.toThrow("Invalid graph theme");
		await expect(
			service.saveGraphTheme({
				...theme,
				colors: [...twentyColors, "#ffffff"],
			})
		).rejects.toThrow("Invalid graph theme");
		expect(service.getGraphThemes()[0].colors).toEqual(twentyColors);
		await service.unload();
	});

	it("backs up existing data before import and restores the latest backup", async () => {
		const plugin = createPlugin(createStoredData(4));
		const service = new EditActivityService(
			plugin as never,
			() => new Date(2026, 6, 31, 16, 0, 0)
		);
		await service.initialize();
		await service.importData(JSON.stringify(createStoredData(9)));
		expect(service.getDailyEditStats()[0].addedChars).toBe(9);
		const importBackup = [...plugin.files.keys()].find((path) =>
			path.endsWith("-import.json")
		);
		expect(importBackup).toBeDefined();

		const restoredPath = await service.restoreLatestBackup();
		expect(restoredPath).toBe(importBackup);
		expect(service.getDailyEditStats()[0].addedChars).toBe(4);
		expect(
			[...plugin.files.keys()].some((path) =>
				path.endsWith("-restore.json")
			)
		).toBe(true);
		await service.unload();
	});

	it("backs up before clearing and stops if the backup cannot be written", async () => {
		const plugin = createPlugin(createStoredData(6));
		const service = new EditActivityService(
			plugin as never,
			() => new Date(2026, 6, 31, 16, 0, 0)
		);
		await service.initialize();
		await service.clearData();
		expect(service.getDailyEditStats()).toEqual([]);
		expect(
			[...plugin.files.keys()].some((path) =>
				path.endsWith("-clear.json")
			)
		).toBe(true);

		await service.restoreLatestBackup();
		expect(service.getDailyEditStats()[0].addedChars).toBe(6);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		plugin.app.vault.adapter.write.mockRejectedValueOnce(
			new Error("disk unavailable")
		);
		const before = service.exportData();
		await expect(service.clearData()).rejects.toMatchObject({
			name: "EditActivityBackupError",
		});
		expect(service.exportData()).toBe(before);
		await service.unload();
	});

	it("rejects malformed imports without replacing current data", async () => {
		const initialData = {
			schemaVersion: 3,
			settings: {
				trackingEnabled: false,
				excludeWhitespace: true,
			},
			trackingPeriods: [],
			dailyStats: {
				"2026-07-31": {
					addedChars: 2,
					deletedChars: 1,
					documents: {},
				},
			},
		};
		const plugin = createPlugin(initialData);
		const service = new EditActivityService(
			plugin as never,
			() => new Date(2026, 6, 31, 16, 0, 0)
		);
		await service.initialize();
		expect(service.getSettings().trackedFolders).toEqual([]);
		const before = service.exportData();

		await expect(
			service.importData(
				JSON.stringify({
					...initialData,
					dailyStats: {
						"2026-07-31": {
							addedChars: -1,
							deletedChars: 1,
							documents: {},
						},
					},
				})
			)
		).rejects.toThrow();
		expect(service.exportData()).toBe(before);

		await service.unload();
	});
});
