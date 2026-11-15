import { afterEach, describe, expect, it, vi } from "vitest";

import { GraphRefreshScheduler } from "../src/processor/graphRefreshScheduler";
import type { EditActivityChangeEvent } from "../src/activity/EditActivityService";

type Listener = () => void;

function createHost() {
	const documentListeners = new Map<string, Set<Listener>>();
	const windowListeners = new Map<string, Set<Listener>>();
	const documentTarget = {
		visibilityState: "visible",
		addEventListener(type: string, listener: Listener) {
			const listeners = documentListeners.get(type) || new Set<Listener>();
			listeners.add(listener);
			documentListeners.set(type, listeners);
		},
		removeEventListener(type: string, listener: Listener) {
			documentListeners.get(type)?.delete(listener);
		},
		dispatch(type: string) {
			documentListeners.get(type)?.forEach(listener => listener());
		},
	};
	const windowTarget = {
		addEventListener(type: string, listener: Listener) {
			const listeners = windowListeners.get(type) || new Set<Listener>();
			listeners.add(listener);
			windowListeners.set(type, listeners);
		},
		IntersectionObserver: undefined as unknown,
		removeEventListener(type: string, listener: Listener) {
			windowListeners.get(type)?.delete(listener);
		},
		dispatch(type: string) {
			windowListeners.get(type)?.forEach(listener => listener());
		},
	};
	const ownerDocument = {...documentTarget, defaultView: windowTarget};
	const element = {ownerDocument, isConnected: true, getBoundingClientRect: () => ({width: 100, height: 100} as DOMRect)};
	const container = element as unknown as HTMLElement;
	return {container, element, ownerDocument, windowTarget};
}

function event(type: EditActivityChangeEvent["type"] = "TIME_STATS"): EditActivityChangeEvent {
	return type === "TIME_STATS"
		? {type, date: "2026-11-15", filePath: "临床医学/笔记.md", timeKeys: [{date: "2026-11-15", hour: 9}]}
		: {type, date: "2026-11-15", filePath: "临床医学/笔记.md"};
}

describe("图表局部刷新调度器", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("在固定150毫秒窗口合并相关事件，不重置窗口", async () => {
		vi.useFakeTimers();
		const host = createHost();
		let notify: ((change: EditActivityChangeEvent) => void) | undefined;
		const refresh = vi.fn();
		const scheduler = new GraphRefreshScheduler({
			container: host.container,
			refresh,
			accept: () => true,
			subscribe: listener => {
				notify = listener;
				return () => { notify = undefined; };
			},
			hourly: true,
		});
		scheduler.start();
		notify?.(event());
		await vi.advanceTimersByTimeAsync(100);
		notify?.({...event(), date: "2026-11-14"});
		await vi.advanceTimersByTimeAsync(50);
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(refresh.mock.calls[0][0]).toHaveLength(2);
		scheduler.stop();
	});

	it("隐藏页面只累积事件，恢复后一次性刷新", async () => {
		vi.useFakeTimers();
		const host = createHost();
		let notify: ((change: EditActivityChangeEvent) => void) | undefined;
		const refresh = vi.fn();
		const scheduler = new GraphRefreshScheduler({
			container: host.container,
			refresh,
			accept: () => true,
			subscribe: listener => {
				notify = listener;
				return () => { notify = undefined; };
			},
			hourly: false,
		});
		scheduler.start();
		host.ownerDocument.visibilityState = "hidden";
		notify?.(event());
		await vi.advanceTimersByTimeAsync(150);
		expect(refresh).not.toHaveBeenCalled();
		host.ownerDocument.visibilityState = "visible";
		host.ownerDocument.dispatch("visibilitychange");
		expect(refresh).toHaveBeenCalledTimes(1);
		scheduler.stop();
	});

	it("忽略无关事件，并在停止后取消所有刷新", async () => {
		vi.useFakeTimers();
		const host = createHost();
		let notify: ((change: EditActivityChangeEvent) => void) | undefined;
		const refresh = vi.fn();
		const scheduler = new GraphRefreshScheduler({
			container: host.container,
			refresh,
			accept: change => change.type === "TIME_STATS",
			subscribe: listener => {
				notify = listener;
				return () => { notify = undefined; };
			},
			hourly: true,
		});
		scheduler.start();
		notify?.(event("STATS"));
		await vi.advanceTimersByTimeAsync(200);
		expect(refresh).not.toHaveBeenCalled();
		notify?.(event());
		scheduler.stop();
		await vi.advanceTimersByTimeAsync(200);
		host.ownerDocument.dispatch("visibilitychange");
		expect(refresh).not.toHaveBeenCalled();
	});

	it("在下一个整点产生一次时间边界事件", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 10, 15, 9, 59, 59, 900));
		const host = createHost();
		let notify: ((change: EditActivityChangeEvent) => void) | undefined;
		const refresh = vi.fn();
		const scheduler = new GraphRefreshScheduler({
			container: host.container,
			refresh,
			accept: () => true,
			subscribe: listener => {
				notify = listener;
				return () => { notify = undefined; };
			},
			hourly: true,
		});
		scheduler.start();
		await vi.advanceTimersByTimeAsync(250);
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(refresh.mock.calls[0][0][0].type).toBe("TEMPORAL");
		scheduler.stop();
	});

	it("后台重复事件压缩为定位范围，广泛失效覆盖普通事件", async () => {
		vi.useFakeTimers();
		const host = createHost();
		let notify: ((change: EditActivityChangeEvent) => void) | undefined;
		const refresh = vi.fn();
		const scheduler = new GraphRefreshScheduler({
			container: host.container,
			refresh,
			accept: () => true,
			subscribe: listener => { notify = listener; return () => { notify = undefined; }; },
			hourly: true,
		});
		scheduler.start();
		host.ownerDocument.visibilityState = "hidden";
		for (let i = 0; i < 100; i++) notify?.({type: "TIME_STATS", filePath: "临床医学/笔记.md", timeKeys: [{date: "2026-11-15", hour: 9}]});
		notify?.({type: "TIME_STATS", filePath: "临床医学/笔记.md", timeKeys: [{date: "2026-11-16", hour: 10}]});
		await vi.advanceTimersByTimeAsync(150);
		host.ownerDocument.visibilityState = "visible";
		host.ownerDocument.dispatch("visibilitychange");
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(refresh.mock.calls[0][0]).toHaveLength(1);
		expect(refresh.mock.calls[0][0][0].timeKeys).toEqual([
			{date: "2026-11-15", hour: 9},
			{date: "2026-11-16", hour: 10},
		]);
		notify?.({type: "TIME_STATS", timeKeys: [{date: "2026-11-17", hour: 11}]});
		notify?.({type: "IMPORT"});
		notify?.({type: "TIME_STATS", timeKeys: [{date: "2026-11-18", hour: 12}]});
		await vi.advanceTimersByTimeAsync(150);
		expect(refresh).toHaveBeenCalledTimes(2);
		expect(refresh.mock.calls[1][0]).toEqual([{type: "IMPORT"}]);
		scheduler.stop();
	});

	it("IntersectionObserver离开时不绘制，恢复时只刷新一次并断开观察", async () => {
		vi.useFakeTimers();
		const host = createHost();
		let intersectionCallback: ((entries: Array<{isIntersecting: boolean}>) => void) | undefined;
		let disconnected = false;
		class FakeIntersectionObserver {
			constructor(callback: (entries: Array<{isIntersecting: boolean}>) => void) { intersectionCallback = callback; }
			observe(): void {}
			disconnect(): void { disconnected = true; }
		}
		(host.windowTarget as any).IntersectionObserver = FakeIntersectionObserver;
		let notify: ((change: EditActivityChangeEvent) => void) | undefined;
		const refresh = vi.fn();
		const scheduler = new GraphRefreshScheduler({
			container: host.container,
			refresh,
			accept: () => true,
			subscribe: listener => { notify = listener; return () => { notify = undefined; }; },
			hourly: true,
		});
		scheduler.start();
		intersectionCallback?.([{isIntersecting: false}]);
		notify?.(event());
		await vi.advanceTimersByTimeAsync(150);
		expect(refresh).not.toHaveBeenCalled();
		intersectionCallback?.([{isIntersecting: true}]);
		expect(refresh).toHaveBeenCalledTimes(1);
		scheduler.stop();
		expect(disconnected).toBe(true);
	});

	it("没有IntersectionObserver时，脱离或零尺寸容器不绘制", async () => {
		vi.useFakeTimers();
		const host = createHost();
		let notify: ((change: EditActivityChangeEvent) => void) | undefined;
		const refresh = vi.fn();
		const scheduler = new GraphRefreshScheduler({
			container: host.container,
			refresh,
			accept: () => true,
			subscribe: listener => { notify = listener; return () => { notify = undefined; }; },
			hourly: true,
		});
		scheduler.start();
		host.element.isConnected = false;
		notify?.(event());
		await vi.advanceTimersByTimeAsync(150);
		expect(refresh).not.toHaveBeenCalled();
		host.element.isConnected = true;
		host.element.getBoundingClientRect = () => ({width: 100, height: 0} as DOMRect);
		notify?.(event("TIME_STATS"));
		await vi.advanceTimersByTimeAsync(150);
		expect(refresh).not.toHaveBeenCalled();
		host.element.getBoundingClientRect = () => ({width: 100, height: 100} as DOMRect);
		host.ownerDocument.dispatch("visibilitychange");
		expect(refresh).toHaveBeenCalledTimes(1);
		scheduler.stop();
	});

	it("恢复可见时补齐尚未触发的午夜边界", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 10, 15, 23, 30));
		const host = createHost();
		let notify: ((change: EditActivityChangeEvent) => void) | undefined;
		const refresh = vi.fn();
		const scheduler = new GraphRefreshScheduler({
			container: host.container,
			refresh,
			accept: () => true,
			subscribe: listener => { notify = listener; return () => { notify = undefined; }; },
			hourly: false,
		});
		scheduler.start();
		host.ownerDocument.visibilityState = "hidden";
		vi.setSystemTime(new Date(2026, 10, 16, 0, 30));
		host.ownerDocument.visibilityState = "visible";
		host.ownerDocument.dispatch("visibilitychange");
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(refresh.mock.calls[0][0]).toEqual([{type: "TEMPORAL"}]);
		scheduler.stop();
	});

	it("不同笔记同一时段只保留一个摘要，并复制冻结的广播事件", async () => {
		vi.useFakeTimers();
		const host = createHost();
		let notify: ((change: EditActivityChangeEvent) => void) | undefined;
		const refresh = vi.fn();
		const scheduler = new GraphRefreshScheduler({
			container: host.container,
			refresh,
			accept: () => true,
			subscribe: listener => { notify = listener; return () => { notify = undefined; }; },
			hourly: true,
		});
		scheduler.start();
		const first = Object.freeze({type: "TIME_STATS" as const, filePath: "临床医学/一.md", timeKeys: Object.freeze([{date: "2026-11-15", hour: 9}])}) as unknown as EditActivityChangeEvent;
		const second = Object.freeze({type: "TIME_STATS" as const, filePath: "临床医学/二.md", timeKeys: Object.freeze([{date: "2026-11-15", hour: 9}])}) as unknown as EditActivityChangeEvent;
		for (let index = 0; index < 1000; index++) notify?.(index === 0 ? first : second);
		await vi.advanceTimersByTimeAsync(150);
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(refresh.mock.calls[0][0]).toEqual([{type: "TIME_STATS", timeKeys: [{date: "2026-11-15", hour: 9}]}]);
		expect(first.filePath).toBe("临床医学/一.md");
		expect(first.timeKeys).toEqual([{date: "2026-11-15", hour: 9}]);
		scheduler.stop();
	});

	it("无定位的时长事件覆盖已经累积的时段键", async () => {
		vi.useFakeTimers();
		const host = createHost();
		let notify: ((change: EditActivityChangeEvent) => void) | undefined;
		const refresh = vi.fn();
		const scheduler = new GraphRefreshScheduler({
			container: host.container,
			refresh,
			accept: () => true,
			subscribe: listener => { notify = listener; return () => { notify = undefined; }; },
			hourly: true,
		});
		scheduler.start();
		notify?.({type: "TIME_STATS", timeKeys: [{date: "2026-11-15", hour: 9}]});
		notify?.({type: "TIME_STATS"});
		notify?.({type: "TIME_STATS", timeKeys: [{date: "2026-11-15", hour: 10}]});
		await vi.advanceTimersByTimeAsync(150);
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(refresh.mock.calls[0][0]).toEqual([{type: "TIME_STATS"}]);
		scheduler.stop();
	});
});
