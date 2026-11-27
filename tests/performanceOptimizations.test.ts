import { describe, expect, it, vi } from "vitest";
import { TimeActivityObserver, type TimeActivityObserverCallbacks } from "../src/time/TimeActivityObserver";
import { StatisticsRepository, type StatisticsFiles } from "../src/activity/StatisticsRepository";
import { emptyStatistics, mergeStatistics, mergeStatisticsOverlay } from "../src/activity/statisticsModel";
import { EditActivityService } from "../src/activity/EditActivityService";
import { queryTimeStats } from "../src/time/timeData";
import { applyActivityTimelineSpan, ensureTimelineRecordingPeriod } from "../src/time/activityTimeline";
import { countCharacters } from "../src/activity/characterCounter";
import { memoryVault } from "./helpers/memoryVault";
import type { StoredTimeActivity } from "../src/time/types";

class RecordingEventTarget {
	readonly calls: Array<{ type: string; options: unknown }> = [];
	readonly listeners = new Map<string, Set<(event: any) => void>>();

	addEventListener(type: string, listener: (event: any) => void, options?: unknown): void {
		this.calls.push({ type, options });
		const set = this.listeners.get(type) || new Set();
		set.add(listener);
		this.listeners.set(type, set);
	}

	removeEventListener(type: string, listener: (event: any) => void): void {
		this.listeners.get(type)?.delete(listener);
	}

	dispatch(type: string, target: unknown = this, trusted = true): void {
		for (const listener of this.listeners.get(type) || []) {
			listener({ type, target, isTrusted: trusted });
		}
	}

	contains(target: unknown): boolean {
		return target === this;
	}
}

class TrackingMutationObserver {
	static readonly instances: TrackingMutationObserver[] = [];
	disconnected = false;
	options?: MutationObserverInit;
	private target?: Node;
	constructor(private readonly callback: (records: MutationRecord[]) => void) {
		TrackingMutationObserver.instances.push(this);
	}
	observe(target: Node, options: MutationObserverInit): void {
		this.target = target;
		this.options = options;
	}
	disconnect(): void {
		this.disconnected = true;
	}
	trigger(records: Partial<MutationRecord>[]): void {
		this.callback(records as MutationRecord[]);
	}
}

describe("性能优化回归测试", () => {
	it("TimeActivityObserver 对滚动事件启用 passive，对高频同视图事件节流，并清理独立窗口监听", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 10, 27, 10, 0, 0));
		TrackingMutationObserver.instances.length = 0;

		const makeDoc = () => {
			const doc = new RecordingEventTarget() as any;
			const win = new RecordingEventTarget() as any;
			doc.visibilityState = "visible";
			doc.hasFocus = () => true;
			doc.querySelector = () => null;
			doc.body = {};
			doc.defaultView = win;
			win.document = doc;
			win.MutationObserver = TrackingMutationObserver;
			return { doc, win };
		};

		const main = makeDoc();
		const popout = makeDoc();
		const root = { contains: (t: unknown) => t === root, ownerDocument: main.doc };
		const leaf = { view: { getViewType: () => "markdown", file: { path: "Notes/A.md", extension: "md" }, containerEl: root } };
		const workspaceHandlers = new Map<string, Set<(...args: any[]) => void>>();
		const statusBarItem = new RecordingEventTarget() as any;
		statusBarItem.ownerDocument = main.doc;
		statusBarItem.setText = vi.fn();
		statusBarItem.setAttribute = vi.fn();
		statusBarItem.remove = vi.fn();

		const plugin = {
			addStatusBarItem: () => statusBarItem,
			app: {
				workspace: {
					activeLeaf: leaf,
					iterateAllLeaves: (cb: (item: unknown) => void) => cb(leaf),
					on: (name: string, cb: (...args: any[]) => void) => {
						const set = workspaceHandlers.get(name) || new Set();
						set.add(cb);
						workspaceHandlers.set(name, set);
						return { name, cb };
					},
					offref: (ref: { name: string; cb: (...args: any[]) => void }) => {
						workspaceHandlers.get(ref.name)?.delete(ref.cb);
					},
				},
			},
		};

		const activity = vi.fn();
		const callbacks: TimeActivityObserverCallbacks = {
			activity,
			pause: vi.fn(),
			context: vi.fn(),
			checkpoint: vi.fn(),
			snapshot: vi.fn(() => ({
				reason: "ACTIVE",
				path: "Notes/A.md",
				manualPaused: false,
				enabled: true,
				todaySeconds: 0,
				todayPendingSeconds: 0,
				remainingMs: 300_000,
			})),
			toggle: vi.fn(async () => undefined),
			subscribe: vi.fn(() => vi.fn()),
		};

		const observer = new TimeActivityObserver(plugin as any, callbacks);
		try {
			observer.start();

			// wheel / touchstart / touchmove 必须使用 passive: true
			for (const type of ["wheel", "touchstart", "touchmove"]) {
				const binding = main.doc.calls.find((call: { type: string }) => call.type === type);
				expect(binding?.options).toEqual({ capture: true, passive: true });
			}

			// 同视图 500ms 内连续 50 次 wheel + keydown 应合并为 1 次 activity 回调
			activity.mockClear();
			for (let i = 0; i < 50; i++) {
				main.doc.dispatch("wheel", root, true);
				main.doc.dispatch("keydown", root, true);
			}
			expect(activity).toHaveBeenCalledTimes(1);

			// 超过节流窗口后再次触发会正常上报
			vi.advanceTimersByTime(500);
			main.doc.dispatch("wheel", root, true);
			expect(activity).toHaveBeenCalledTimes(2);

			// 非弹窗 body 直接子节点变动（例如悬浮提示）不会触发无谓的上下文刷新
			const statusCallsBefore = vi.mocked(callbacks.snapshot).mock.calls.length;
			const tooltipEl = { nodeType: 1, matches: () => false, querySelector: () => null };
			TrackingMutationObserver.instances[0].trigger([{
				type: "childList",
				target: main.doc.body,
				addedNodes: [tooltipEl] as unknown as NodeList,
				removedNodes: [] as unknown as NodeList,
			}]);
			expect(vi.mocked(callbacks.snapshot).mock.calls.length).toBe(statusCallsBefore);

			// 独立窗口打开再关闭后，应释放其全部 DOM 监听和 MutationObserver
			const beforePopoutObservers = TrackingMutationObserver.instances.length;
			for (const cb of workspaceHandlers.get("window-open") || []) cb({}, popout.win);
			expect(TrackingMutationObserver.instances.length).toBe(beforePopoutObservers + 2);
			expect(popout.doc.listeners.get("wheel")?.size).toBe(1);

			for (const cb of workspaceHandlers.get("window-close") || []) cb({}, popout.win);
			expect(popout.doc.listeners.get("wheel")?.size).toBe(0);
			expect(TrackingMutationObserver.instances.slice(beforePopoutObservers).every(item => item.disconnected)).toBe(true);
		} finally {
			observer.stop();
			vi.useRealTimers();
		}
	});

	it("本机统计保存不会自触发全目录刷新重读，增量 stat 缓存跳过未变化的历史文件", async () => {
		vi.useFakeTimers();
		Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
		Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => "zh" } });
		const files = new Map<string, string>();
		const vault = memoryVault(files);
		const plugin = {
			manifest: { dir: ".obsidian/plugins/test" },
			app: { vault },
			loadData: vi.fn(async () => null),
			saveData: vi.fn(async () => undefined),
		};
		const service = new EditActivityService(plugin as never);
		try {
			await service.initialize();
			await service.setTimeTrackingEnabled(true);
			service.recordTimeActivity("Notes/A.md");
			vault.adapter.list.mockClear();
			vault.adapter.read.mockClear();

			await service.flush();
			await vi.advanceTimersByTimeAsync(500);
			// 本机 flush 写盘后不应触发自刷新的 adapter.list 全目录扫描
			expect(vault.adapter.list).not.toHaveBeenCalled();
		} finally {
			await service.unload();
			vi.useRealTimers();
		}

		// 验证 StatisticsRepository 在 stat 未变化时跳过重读历史文件
		const contents = new Map<string, string>();
		const stats = new Map<string, { mtime: number; size: number }>();
		const readSpy = vi.fn(async (path: string) => contents.get(path)!);
		const statFiles: StatisticsFiles = {
			list: async () => [...contents.keys()],
			read: readSpy,
			write: async (path, data) => {
				contents.set(path, data);
				stats.set(path, { mtime: Date.now(), size: data.length });
			},
			stat: async path => stats.get(path) ?? null,
		};
		for (let i = 0; i < 20; i++) {
			const id = crypto.randomUUID();
			const data = emptyStatistics();
			data.dailyStats[`2026-01-${String(i + 1).padStart(2, "0")}`] = {
				addedChars: 10 + i,
				deletedChars: 0,
				documents: { "Notes/A.md": { addedChars: 10 + i, deletedChars: 0 } },
			};
			await statFiles.write(`记录/${id}-r1.json`, JSON.stringify({
				formatVersion: 1, kind: "statistics", id, revision: 1, updatedAt: 1000 + i, generation: "initial", data,
			}));
		}
		const repo = new StatisticsRepository(statFiles, data => data as any);
		await repo.initialize();
		expect(readSpy).toHaveBeenCalledTimes(20);

		readSpy.mockClear();
		await repo.refresh();
		// 未变化的历史文件不再重复 read
		expect(readSpy).toHaveBeenCalledTimes(0);
	});

	it("mergeStatisticsOverlay 与 mergeStatistics 结果一致且共享未修改历史引用", () => {
		const base = emptyStatistics();
		base.dailyStats["2026-01-01"] = { addedChars: 100, deletedChars: 5, documents: { "old.md": { addedChars: 100, deletedChars: 5 } } };
		base.dailyStats["2026-11-27"] = { addedChars: 20, deletedChars: 1, documents: { "today.md": { addedChars: 20, deletedChars: 1 } } };
		base.timeActivity.buckets["2026-01-01T09-+480"] = { date: "2026-01-01", hour: 9, offsetMinutes: 480, documents: { "old.md": 600 } };
		base.timeActivity.buckets["2026-11-27T10-+480"] = { date: "2026-11-27", hour: 10, offsetMinutes: 480, documents: { "today.md": 120 } };

		const local = emptyStatistics();
		local.dailyStats["2026-11-27"] = { addedChars: 30, deletedChars: 2, documents: { "today.md": { addedChars: 30, deletedChars: 2 } } };
		local.timeActivity.buckets["2026-11-27T10-+480"] = { date: "2026-11-27", hour: 10, offsetMinutes: 480, documents: { "today.md": 60 } };

		const full = mergeStatistics([base, local]);
		const overlay = mergeStatisticsOverlay(base, local, new Set());
		expect(overlay).toEqual(full);
		// 未被本机修改的历史日期和历史分桶应直接共享基线引用，避免深拷贝
		expect(overlay.dailyStats["2026-01-01"]).toBe(base.dailyStats["2026-01-01"]);
		expect(overlay.timeActivity.buckets["2026-01-01T09-+480"]).toBe(base.timeActivity.buckets["2026-01-01T09-+480"]);
		// 本机修改的日期与分桶不得污染基线
		expect(base.dailyStats["2026-11-27"].addedChars).toBe(20);
		expect(base.timeActivity.buckets["2026-11-27T10-+480"].documents["today.md"]).toBe(120);
	});

	it("queryTimeStats 与时间轴片段合并在大量分桶和片段下保持线性性能与准确性", () => {
		const timeActivity: StoredTimeActivity = { buckets: Object.create(null), periods: [{ start: 0, folders: [] }], policyChanges: [] };
		for (let day = 1; day <= 120; day++) {
			const date = new Date(Date.UTC(2026, 0, day));
			const dateStr = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
			for (let hour = 8; hour < 20; hour++) {
				const key = `${dateStr}T${String(hour).padStart(2, "0")}-+480`;
				timeActivity.buckets[key] = { date: dateStr, hour, offsetMinutes: 480, documents: { "Notes/Study.md": 300 } };
			}
		}
		const start = performance.now();
		const rows = queryTimeStats(timeActivity, {}, Date.UTC(2026, 11, 1), true);
		const elapsedMs = performance.now() - start;
		expect(rows).toHaveLength(1440);
		expect(elapsedMs).toBeLessThan(200);

		const periodId = ensureTimelineRecordingPeriod(timeActivity, 1000, []);
		const baseTs = new Date(2026, 10, 27, 10, 0, 0).getTime();
		for (let i = 0; i < 200; i++) {
			applyActivityTimelineSpan(timeActivity, {
				path: "Notes/Study.md",
				start: baseTs + i * 1000,
				end: baseTs + (i + 1) * 1000,
				seconds: 1,
				continuityId: "session-1",
			}, "add", periodId);
		}
		expect(timeActivity.timeline?.segments).toHaveLength(1);
		expect(timeActivity.timeline?.segments[0].seconds).toBe(200);
		expect(countCharacters("你好 世界 😀\n\t", { excludeWhitespace: true })).toBe(5);
	});
});
