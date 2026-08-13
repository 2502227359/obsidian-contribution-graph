import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DataviewIndexTimeoutError,
	waitForDataviewIndex,
} from "../src/processor/dataviewReady";

function createApp() {
	let ready: (() => void) | undefined;
	const eventRef = {};
	const metadataCache = {
		on: vi.fn((_name: string, callback: () => void) => {
			ready = callback;
			return eventRef;
		}),
		offref: vi.fn(),
	};
	return {
		app: { metadataCache } as never,
		metadataCache,
		triggerReady: () => ready?.(),
		eventRef,
	};
}

describe("shared Dataview index wait", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		Object.defineProperty(globalThis, "window", {
			value: globalThis,
			configurable: true,
		});
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	it("shares one listener and removes it when the index becomes ready", async () => {
		const { app, metadataCache, triggerReady, eventRef } = createApp();
		const first = waitForDataviewIndex(app, new AbortController().signal);
		const second = waitForDataviewIndex(app, new AbortController().signal);
		expect(metadataCache.on).toHaveBeenCalledTimes(1);

		triggerReady();
		await expect(Promise.all([first, second])).resolves.toEqual([
			undefined,
			undefined,
		]);
		expect(metadataCache.offref).toHaveBeenCalledWith(eventRef);
	});

	it("cleans the listener when the last rendered block is destroyed", async () => {
		const { app, metadataCache } = createApp();
		const firstController = new AbortController();
		const secondController = new AbortController();
		const first = waitForDataviewIndex(app, firstController.signal);
		const second = waitForDataviewIndex(app, secondController.signal);
		firstController.abort();
		await expect(first).rejects.toMatchObject({ name: "AbortError" });
		expect(metadataCache.offref).not.toHaveBeenCalled();

		secondController.abort();
		await expect(second).rejects.toMatchObject({ name: "AbortError" });
		expect(metadataCache.offref).toHaveBeenCalledTimes(1);
	});

	it("times out and removes a listener that never fires", async () => {
		const { app, metadataCache } = createApp();
		const waiting = waitForDataviewIndex(
			app,
			new AbortController().signal,
			100
		);
		const rejection = expect(waiting).rejects.toBeInstanceOf(
			DataviewIndexTimeoutError
		);
		await vi.advanceTimersByTimeAsync(100);
		await rejection;
		expect(metadataCache.offref).toHaveBeenCalledTimes(1);
	});
});
