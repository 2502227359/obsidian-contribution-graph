import { ChangeSet, Text } from "@codemirror/state";
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
			schemaVersion: 3,
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
