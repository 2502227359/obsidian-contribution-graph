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
			};
		};
	};
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value));
}

function createPlugin(
	initialData: unknown = null,
	saveData = vi.fn(async () => undefined)
): FakePlugin {
	return {
		loadData: vi.fn(async () => clone(initialData)),
		saveData,
		manifest: { dir: ".obsidian/plugins/contribution-graph-local" },
		app: {
			vault: {
				adapter: {
					read: vi.fn(async () => JSON.stringify(initialData)),
					write: vi.fn(async () => undefined),
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
			schemaVersion: 6,
			dailyStats: {
				"2026-07-31": {
					addedChars: 1,
					deletedChars: 0,
				},
			},
		});
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
			schemaVersion: 6,
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
