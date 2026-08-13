import { App } from "obsidian";

interface DataviewWaitState {
	promise: Promise<void>;
	cancel: (error: Error) => void;
	consumers: number;
	settled: boolean;
}

const waits = new WeakMap<object, DataviewWaitState>();

export class DataviewIndexTimeoutError extends Error {
	constructor() {
		super("Dataview index did not become ready in time");
		this.name = "DataviewIndexTimeoutError";
	}
}

export function waitForDataviewIndex(
	app: App,
	signal: AbortSignal,
	timeoutMs = 15000
): Promise<void> {
	if (signal.aborted) {
		return Promise.reject(createAbortError());
	}

	let state = waits.get(app);
	if (!state) {
		state = createWait(app, timeoutMs);
		waits.set(app, state);
	}
	state.consumers++;

	let abortListener: (() => void) | undefined;
	const abortPromise = new Promise<void>((_resolve, reject) => {
		abortListener = () => reject(createAbortError());
		signal.addEventListener("abort", abortListener, { once: true });
	});

	return Promise.race([state.promise, abortPromise]).finally(() => {
		if (abortListener) {
			signal.removeEventListener("abort", abortListener);
		}
		state!.consumers--;
		if (!state!.settled && state!.consumers === 0) {
			state!.cancel(createAbortError());
		}
	});
}

export function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

function createWait(app: App, timeoutMs: number): DataviewWaitState {
	const metadataCache = app.metadataCache as unknown as {
		on: (name: string, callback: () => void) => unknown;
		offref: (eventRef: unknown) => void;
	};
	let resolvePromise!: () => void;
	let rejectPromise!: (error: Error) => void;
	const state: DataviewWaitState = {
		promise: new Promise<void>((resolve, reject) => {
			resolvePromise = resolve;
			rejectPromise = reject;
		}),
		cancel: () => undefined,
		consumers: 0,
		settled: false,
	};
	const eventRef = metadataCache.on("dataview:index-ready", () => {
		settle(() => resolvePromise());
	});
	const timeout = window.setTimeout(() => {
		settle(() => rejectPromise(new DataviewIndexTimeoutError()));
	}, timeoutMs);

	const settle = (complete: () => void) => {
		if (state.settled) {
			return;
		}
		state.settled = true;
		window.clearTimeout(timeout);
		metadataCache.offref(eventRef);
		waits.delete(app);
		complete();
	};
	state.cancel = (error) => settle(() => rejectPromise(error));
	return state;
}

function createAbortError(): Error {
	const error = new Error("Dataview index wait was cancelled");
	error.name = "AbortError";
	return error;
}
