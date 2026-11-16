import { describe, expect, it, vi } from "vitest";
import {
	TimeActivityObserver,
	type TimeActivityObserverCallbacks,
	isTimeActivityEvent,
} from "../src/time/TimeActivityObserver";
import type { TimeTrackingSnapshot } from "../src/time/types";

class FakeEventTarget {
	private readonly listeners = new Map<string, Set<(event: any) => void>>();

	addEventListener(type: string, listener: (event: any) => void): void {
		const handlers = this.listeners.get(type) || new Set();
		handlers.add(listener);
		this.listeners.set(type, handlers);
	}

	removeEventListener(type: string, listener: (event: any) => void): void {
		this.listeners.get(type)?.delete(listener);
	}

	dispatch(type: string, target: unknown = this, trusted = true, details: Record<string, unknown> = {}): void {
		for (const listener of this.listeners.get(type) || []) {
			listener({ type, target, isTrusted: trusted, ...details });
		}
	}

	contains(target: unknown): boolean {
		return target === this;
	}
}

class FakeMutationObserver {
	static readonly instances: FakeMutationObserver[] = [];
	disconnected = false;
	options?: MutationObserverInit;
	private target?: Node;
	constructor(private readonly callback: (records: MutationRecord[]) => void) {
		FakeMutationObserver.instances.push(this);
	}
	observe(_target: Node, options: MutationObserverInit): void {
		this.target = _target;
		this.options = options;
	}
	disconnect(): void {
		this.disconnected = true;
	}
	trigger(records: Partial<MutationRecord>[] = [{type: "childList", target: this.target}]): void {
		this.callback(records as MutationRecord[]);
	}
}

function createView(path = "Notes/Test.md") {
	const root = {
		contains: (target: unknown) => target === root,
		ownerDocument: undefined as any,
	};
	return {
		view: {
			getViewType: () => "markdown",
			file: { path, extension: "md" },
			containerEl: root,
		},
		root,
	};
}

function createDocumentTarget() {
	const documentTarget = new FakeEventTarget() as any;
	const windowTarget = new FakeEventTarget() as any;
	documentTarget.visibilityState = "visible";
	documentTarget.hasFocus = () => true;
	documentTarget.querySelector = () => null;
	documentTarget.body = {};
	documentTarget.defaultView = windowTarget;
	windowTarget.MutationObserver = FakeMutationObserver;
	return { documentTarget, windowTarget };
}

function createPlugin(
	views: Array<ReturnType<typeof createView>>,
	documents: Array<{ documentTarget: any; windowTarget: any }> = []
) {
	const firstDocument = documents[0] || createDocumentTarget();
	const { documentTarget, windowTarget } = firstDocument;
	for (const [index, view] of views.entries()) {
		view.root.ownerDocument = (documents[index] || firstDocument).documentTarget;
	}
	const handlers = new Map<string, Set<(...args: any[]) => void>>();
	const workspace = {
		activeLeaf: views[0],
		iterateAllLeaves(callback: (leaf: unknown) => void) {
			for (const view of views) {
				callback(view);
			}
		},
		on(name: string, callback: (...args: any[]) => void) {
			const set = handlers.get(name) || new Set();
			set.add(callback);
			handlers.set(name, set);
			return { name, callback };
		},
		offref(ref: { name: string; callback: (...args: any[]) => void }) {
			handlers.get(ref.name)?.delete(ref.callback);
		},
	};
	const statusBarItem = new FakeEventTarget() as FakeEventTarget & {
		setText: ReturnType<typeof vi.fn>;
		setAttribute: ReturnType<typeof vi.fn>;
		remove: ReturnType<typeof vi.fn>;
	};
	statusBarItem.setText = vi.fn();
	statusBarItem.setAttribute = vi.fn();
	statusBarItem.remove = vi.fn();
	return {
		plugin: {
			app: { workspace },
			addStatusBarItem: vi.fn(() => statusBarItem),
		},
		documentTarget,
		windowTarget,
		handlers,
		statusBarItem,
	};
}

function createSnapshot(overrides: Partial<TimeTrackingSnapshot> = {}): TimeTrackingSnapshot {
	return {
		reason: "ACTIVE",
		path: "Notes/Test.md",
		manualPaused: false,
		enabled: true,
		todaySeconds: 0,
		todayPendingSeconds: 0,
		remainingMs: 300_000,
		...overrides,
	};
}

function createCallbacks(
	overrides: Partial<TimeActivityObserverCallbacks> = {}
): TimeActivityObserverCallbacks {
	return {
		activity: vi.fn(),
		pause: vi.fn(),
		context: vi.fn(),
		checkpoint: vi.fn(),
		snapshot: vi.fn(() => createSnapshot()),
		toggle: vi.fn(async () => undefined),
		subscribe: vi.fn(() => vi.fn()),
		...overrides,
	};
}

describe("时间活动事件策略", () => {
	it.each(["主窗口", "独立窗口"])("YOLO 对话在%s的可信操作也应产生时长活动", placement => {
		const note = createView("临床医学/测试笔记.md");
		const chat = createView();
		chat.view.getViewType = () => "yolo-chat-view";
		chat.view.file = undefined as any;
		const documents = [createDocumentTarget()];
		if (placement === "独立窗口") documents.push(createDocumentTarget());
		const { plugin } = createPlugin([note, chat], documents);
		plugin.app.workspace.activeLeaf = chat;
		const activity = vi.fn();
		const observer = new TimeActivityObserver(plugin as any, createCallbacks({ activity }));
		try {
			observer.start();
			const before = activity.mock.calls.length;
			chat.root.ownerDocument.dispatch("wheel", chat.root);
			expect(activity.mock.calls.length).toBeGreaterThan(before);
			expect(activity).toHaveBeenLastCalledWith("activity://yolo-chat");
		} finally {
			observer.stop();
		}
	});
	it("侧栏 YOLO 不依赖 activeLeaf，心跳、焦点和暂停仍按交互所在窗口判断", () => {
		vi.useFakeTimers();
		const note = createView("临床医学/测试笔记.md"), chat = createView();
		chat.view.getViewType = () => "yolo-chat-view";
		chat.view.file = undefined as any;
		const main = createDocumentTarget(), popout = createDocumentTarget();
		main.documentTarget.hasFocus = () => false;
		const { plugin } = createPlugin([note, chat], [main, popout]);
		let manualPaused = false;
		const activity = vi.fn(), pause = vi.fn(), context = vi.fn();
		const observer = new TimeActivityObserver(plugin as any, createCallbacks({ activity, pause, context,
			snapshot: () => createSnapshot({ manualPaused }) }));
		try {
			observer.start();
			popout.documentTarget.dispatch("wheel", chat.root);
			expect(activity).toHaveBeenLastCalledWith("activity://yolo-chat");
			const count = activity.mock.calls.length, pauses = pause.mock.calls.length;
			main.windowTarget.dispatch("blur");
			vi.advanceTimersByTime(15_000);
			expect(pause).toHaveBeenCalledTimes(pauses);
			expect(context).toHaveBeenLastCalledWith({ reason: "READY", path: "activity://yolo-chat" });
			popout.documentTarget.dispatch("wheel", chat.root, false);
			popout.documentTarget.dispatch("scroll", chat.root);
			manualPaused = true;
			popout.documentTarget.dispatch("input", chat.root);
			expect(activity).toHaveBeenCalledTimes(count);
			popout.documentTarget.hasFocus = () => false;
			popout.windowTarget.dispatch("blur");
			expect(context).toHaveBeenLastCalledWith({ reason: "BACKGROUND", path: "activity://yolo-chat" });
			manualPaused = false;
			popout.documentTarget.hasFocus = () => true;
			popout.documentTarget.activeElement = chat.root;
			popout.windowTarget.dispatch("focus");
			expect(activity).toHaveBeenCalledTimes(count + 1);
			popout.documentTarget.querySelector = () => ({});
			popout.documentTarget.dispatch("input", chat.root);
			expect(context).toHaveBeenLastCalledWith({ reason: "MODAL", path: "activity://yolo-chat" });
		} finally {
			observer.stop();
			vi.useRealTimers();
		}
	});
	it("观察器启动后新开的 YOLO 侧栏通过布局变化接入", () => {
		const note = createView(), chat = createView();
		chat.view.getViewType = () => "yolo-chat-view";
		chat.view.file = undefined as any;
		const leaves = [note];
		const { plugin, documentTarget, handlers } = createPlugin(leaves);
		chat.root.ownerDocument = documentTarget;
		const activity = vi.fn();
		const observer = new TimeActivityObserver(plugin as any, createCallbacks({ activity }));
		try {
			observer.start();
			leaves.push(chat);
			for (const callback of handlers.get("layout-change") || []) callback();
			documentTarget.dispatch("wheel", chat.root);
			expect(activity).toHaveBeenLastCalledWith("activity://yolo-chat");
		} finally {
			observer.stop();
		}
	});
	it.each(["切到其他笔记", "隐藏侧栏"])("YOLO 在%s时停止，不依赖迟到的活动叶事件", action => {
		const note = createView(), chat = createView();
		chat.view.getViewType = () => "yolo-chat-view";
		chat.view.file = undefined as any;
		const { plugin, documentTarget } = createPlugin([note, chat]);
		plugin.app.workspace.activeLeaf = chat;
		const pause = vi.fn(), activity = vi.fn();
		const observer = new TimeActivityObserver(plugin as any, createCallbacks({ pause, activity }));
		try {
			observer.start();
			documentTarget.dispatch("wheel", chat.root);
			const pauses = pause.mock.calls.length, activities = activity.mock.calls.length;
			if (action === "切到其他笔记") documentTarget.dispatch("pointerdown", note.root);
			else {
				documentTarget.activeElement = chat.root;
				Object.assign(chat.root, { getClientRects: () => [] });
				observer.refreshCurrentContext();
			}
			expect(pause.mock.calls.length).toBeGreaterThan(pauses);
			expect(activity).toHaveBeenCalledTimes(activities);
		} finally {
			observer.stop();
		}
	});
	it("多个窗口都报告文档焦点时，以宿主活动文档排除旧 YOLO 窗口", () => {
		const note = createView(), chat = createView();
		chat.view.getViewType = () => "yolo-chat-view";
		chat.view.file = undefined as any;
		const main = createDocumentTarget(), popout = createDocumentTarget();
		const { plugin } = createPlugin([note, chat], [main, popout]);
		popout.documentTarget.activeElement = chat.root;
		const activity = vi.fn(), pause = vi.fn();
		const observer = new TimeActivityObserver(plugin as any, createCallbacks({ activity, pause }));
		vi.stubGlobal("activeDocument", popout.documentTarget);
		try {
			observer.start();
			popout.documentTarget.dispatch("input", chat.root);
			expect(activity).toHaveBeenLastCalledWith("activity://yolo-chat");
			const pauses = pause.mock.calls.length;
			vi.stubGlobal("activeDocument", main.documentTarget);
			main.windowTarget.dispatch("focus");
			expect(pause.mock.calls.length).toBeGreaterThan(pauses);
			expect(activity).toHaveBeenLastCalledWith("Notes/Test.md");
		} finally {
			observer.stop();
			vi.unstubAllGlobals();
		}
	});
	it("文件后缀为 Markdown 的其他插件视图不计入阅读", () => {
		const view = createView("思维导图.md");
		view.view.getViewType = () => "mindmap";
		const { plugin, documentTarget } = createPlugin([view]);
		const activity = vi.fn();
		const context = vi.fn();
		const observer = new TimeActivityObserver(plugin as any, createCallbacks({ activity, context }));
		observer.start(); documentTarget.dispatch("wheel", view.root);
		expect(activity).not.toHaveBeenCalled();
		documentTarget.querySelector = () => ({});
		FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1].trigger();
		expect(context).toHaveBeenLastCalledWith({ reason: "MODAL", path: undefined });
		observer.stop();
	});
	it("当前笔记重命名后立即以新路径采集", () => {
		const view = createView("旧路径.md");
		const { plugin, documentTarget } = createPlugin([view]);
		const activity = vi.fn();
		const observer = new TimeActivityObserver(plugin as any, createCallbacks({ activity }));
		observer.start();
		view.view.file.path = "新路径.md";
		observer.handlePathRename();
		documentTarget.dispatch("wheel", view.root);
		expect(activity).toHaveBeenLastCalledWith("新路径.md");
		observer.stop();
	});
	it("接受用户交互事件并忽略被动或程序事件", () => {
		expect(isTimeActivityEvent({ type: "keydown" } as Event)).toBe(true);
		expect(isTimeActivityEvent({ type: "wheel" } as Event)).toBe(true);
		expect(isTimeActivityEvent({ type: "touchstart" } as Event)).toBe(true);
		expect(isTimeActivityEvent({ type: "input" } as Event)).toBe(true);
		expect(isTimeActivityEvent({ type: "mousemove" } as Event)).toBe(false);
		expect(isTimeActivityEvent({ type: "scroll" } as Event)).toBe(false);
	});
});

describe("时长活动观察器", () => {
	it("只把聚焦笔记交互转成活动，并在应用暂停时停止", () => {
		const view = createView();
		const { plugin, documentTarget, windowTarget } = createPlugin([view]);
		const activity = vi.fn();
		const pause = vi.fn();
		const checkpoint = vi.fn();
		const observer = new TimeActivityObserver(plugin as any, createCallbacks({ activity, pause, checkpoint }));

		observer.start();
		documentTarget.dispatch("keydown", view.root, true);
		documentTarget.dispatch("mousemove", view.root, true);
		windowTarget.dispatch("blur");
		documentTarget.dispatch("pointerdown", view.root, true);

		expect(activity).toHaveBeenCalledWith("Notes/Test.md");
		expect(activity).toHaveBeenCalledTimes(3);
		expect(pause).toHaveBeenCalledTimes(1);

		observer.stop();
		expect(pause).toHaveBeenCalledTimes(2);
	});

	it("停止后不再派发事件或工作区回调", () => {
		const view = createView();
		const { plugin, documentTarget, windowTarget, handlers, statusBarItem } = createPlugin([view]);
		const activity = vi.fn();
		const unsubscribe = vi.fn();
		const callbacks = createCallbacks({
			activity,
			subscribe: vi.fn(() => unsubscribe),
		});
		const observer = new TimeActivityObserver(plugin as any, callbacks);

		observer.start();
		activity.mockClear();
		observer.stop();
		documentTarget.dispatch("keydown", view.root);
		windowTarget.dispatch("blur");
		for (const callbacks of handlers.values()) {
			expect(callbacks.size).toBe(0);
		}
		expect(unsubscribe).toHaveBeenCalledTimes(1);
		expect(statusBarItem.remove).toHaveBeenCalledTimes(1);
		expect(activity).not.toHaveBeenCalled();
	});

	it("拒绝不可信事件、失焦文档、非笔记交互和弹窗中的交互", () => {
		const view = createView();
		const { plugin, documentTarget } = createPlugin([view]);
		const activity = vi.fn();
		const pause = vi.fn();
		const observer = new TimeActivityObserver(plugin as any, createCallbacks({ activity, pause }));
		observer.start();
		documentTarget.dispatch("pointerdown", view.root, false);
		documentTarget.dispatch("pointerdown", view.root, true);
		documentTarget.hasFocus = () => false;
		documentTarget.dispatch("wheel", view.root, true);
		documentTarget.hasFocus = () => true;
		documentTarget.dispatch("pointerdown", {} as object, true);
		documentTarget.querySelector = () => ({}) as Element;
		documentTarget.dispatch("pointerdown", view.root, true);

		expect(activity).toHaveBeenCalledTimes(2);
		expect(pause).toHaveBeenCalledTimes(3);
	});

	it("切换工作区文件时立即启动新的 Markdown 笔记", () => {
		const first = createView("Notes/First.md");
		const second = createView("Notes/Second.md");
		const { plugin, handlers } = createPlugin([first, second]);
		const activity = vi.fn();
		const observer = new TimeActivityObserver(plugin as any, createCallbacks({ activity }));
		observer.start();
		plugin.app.workspace.activeLeaf = second as any;
		for (const callback of handlers.get("active-leaf-change") || []) {
			callback(second);
		}

		expect(activity).toHaveBeenLastCalledWith("Notes/Second.md");
	});

	it("checkpoint 会在弹窗打开或文档失焦时先暂停", () => {
		vi.useFakeTimers();
		const view = createView();
		const { plugin, documentTarget } = createPlugin([view]);
		const pause = vi.fn();
		const checkpoint = vi.fn();
		const observer = new TimeActivityObserver(plugin as any, createCallbacks({ pause, checkpoint }));
		observer.start();
		documentTarget.dispatch("pointerdown", view.root, true);
		documentTarget.querySelector = () => ({}) as Element;
		vi.advanceTimersByTime(15_000);

		expect(pause).toHaveBeenCalled();
		expect(checkpoint).toHaveBeenCalledTimes(1);
		observer.stop();
		vi.useRealTimers();
	});

	it("启动和恢复焦点时立即启动当前 Markdown 笔记", () => {
		const view = createView();
		const { plugin, windowTarget } = createPlugin([view]);
		const activity = vi.fn();
		const observer = new TimeActivityObserver(plugin as any, createCallbacks({ activity }));
		observer.start();
		windowTarget.dispatch("blur");
		windowTarget.dispatch("focus");

		expect(activity).toHaveBeenNthCalledWith(1, "Notes/Test.md");
		expect(activity).toHaveBeenNthCalledWith(2, "Notes/Test.md");
		observer.stop();
	});

	it("弹窗插入会立即暂停，关闭后恢复当前笔记", () => {
		FakeMutationObserver.instances.length = 0;
		const view = createView();
		const { plugin, documentTarget } = createPlugin([view]);
		const activity = vi.fn();
		const pause = vi.fn();
		let modalOpen = false;
		documentTarget.querySelector = (selector: string) =>
			modalOpen && selector.includes(".modal") ? ({} as Element) : null;
		const observer = new TimeActivityObserver(plugin as any, createCallbacks({ activity, pause }));
		observer.start();
		documentTarget.dispatch("pointerdown", view.root, true);
		modalOpen = true;
		FakeMutationObserver.instances[0].trigger();
		expect(pause).toHaveBeenCalled();
		modalOpen = false;
		FakeMutationObserver.instances[0].trigger();

		expect(activity).toHaveBeenCalledTimes(3);
		observer.stop();
		expect(FakeMutationObserver.instances[0].disconnected).toBe(true);
		expect(FakeMutationObserver.instances[0].options).toEqual({ childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
	});

	it("页面内日历打开时暂停计时，关闭后恢复", () => {
		FakeMutationObserver.instances.length = 0;
		const {plugin, documentTarget} = createPlugin([createView()]);
		let open = false;
		documentTarget.querySelector = (selector: string) => open && selector.includes("dialog[open]") ? {} : null;
		const activity = vi.fn(), pause = vi.fn();
		const observer = new TimeActivityObserver(plugin as any, createCallbacks({ activity, pause }));
		observer.start();
		const mutation = {type: "attributes", target: {nodeName: "DIALOG"}} as unknown as MutationRecord;
		open = true;
		FakeMutationObserver.instances[0].trigger([mutation]);
		expect(pause).toHaveBeenCalledTimes(1);
		open = false;
		FakeMutationObserver.instances[0].trigger([mutation]);
		expect(activity).toHaveBeenCalledTimes(2);
		observer.stop();
	});

	it("正文内部变化不会因观察日历而刷新空闲计时", () => {
		FakeMutationObserver.instances.length = 0;
		const {plugin} = createPlugin([createView()]);
		const activity = vi.fn();
		const observer = new TimeActivityObserver(plugin as any, createCallbacks({ activity }));
		observer.start();
		FakeMutationObserver.instances[0].trigger([{type: "childList", target: {nodeName: "DIV"} as Node}]);
		expect(activity).toHaveBeenCalledTimes(1);
		observer.stop();
	});

	it("自动补全浮层不会阻断笔记计时", () => {
		const view = createView();
		const { plugin, documentTarget } = createPlugin([view]);
		documentTarget.querySelector = (selector: string) =>
			selector.includes("suggestion-container") ? ({} as Element) : null;
		const activity = vi.fn();
		const pause = vi.fn();
		const observer = new TimeActivityObserver(plugin as any, createCallbacks({ activity, pause }));
		observer.start();
		documentTarget.dispatch("pointerdown", view.root, true);

		expect(activity).toHaveBeenCalledWith("Notes/Test.md");
		expect(pause).not.toHaveBeenCalled();
		observer.stop();
	});

	it("手动暂停门控正文活动，恢复后强制重新核对上下文", () => {
		const view = createView();
		const { plugin, documentTarget } = createPlugin([view]);
		let manualPaused = false;
		const activity = vi.fn();
		const callbacks = createCallbacks({
			activity,
			snapshot: vi.fn(() => createSnapshot({ manualPaused })),
		});
		const observer = new TimeActivityObserver(plugin as any, callbacks);

		observer.start();
		const initialActivityCount = activity.mock.calls.length;
		manualPaused = true;
		documentTarget.dispatch("pointerdown", view.root);
		expect(activity).toHaveBeenCalledTimes(initialActivityCount);

		manualPaused = false;
		observer.refreshCurrentContext();
		expect(activity).toHaveBeenLastCalledWith("Notes/Test.md");
		expect(activity).toHaveBeenCalledTimes(initialActivityCount + 1);
		// 暂停与恢复在同一轮控制操作内结束时，旧启动缓存也不能挡住恢复。
		manualPaused = true; manualPaused = false;
		observer.refreshCurrentContext(true);
		expect(activity).toHaveBeenCalledTimes(initialActivityCount + 2);
		observer.stop();
	});

	it("状态栏控件只切换手动状态，支持回车和空格且不产生正文活动", async () => {
		const view = createView();
		const { plugin, documentTarget, statusBarItem } = createPlugin([view]);
		const activity = vi.fn();
		const toggle = vi.fn(async () => undefined);
		const snapshot = vi.fn(() => createSnapshot());
		const callbacks = createCallbacks({ activity, toggle, snapshot });
		const observer = new TimeActivityObserver(plugin as any, callbacks);

		observer.start();
		const initialActivityCount = activity.mock.calls.length;
		const initialSnapshotCount = snapshot.mock.calls.length;
		statusBarItem.dispatch("mouseenter", statusBarItem);
		statusBarItem.dispatch("focus", statusBarItem);
		statusBarItem.dispatch("click", statusBarItem);
		statusBarItem.dispatch("keydown", statusBarItem, true, { key: "Enter" });
		statusBarItem.dispatch("keydown", statusBarItem, true, { key: " " });
		await vi.waitFor(() => expect(toggle).toHaveBeenCalledTimes(3));
		expect(activity).toHaveBeenCalledTimes(initialActivityCount);
		expect(snapshot.mock.calls.length).toBeGreaterThanOrEqual(initialSnapshotCount + 2);
		observer.stop();
		statusBarItem.dispatch("click", statusBarItem);
		expect(toggle).toHaveBeenCalledTimes(3);
	});

	it("旧窗口的延迟 blur 不会暂停新聚焦窗口", () => {
		const first = createView("Notes/First.md");
		const second = createView("Notes/Second.md");
		const firstDocument = createDocumentTarget();
		const secondDocument = createDocumentTarget();
		const { plugin, handlers } = createPlugin([first, second], [firstDocument, secondDocument]);
		const pause = vi.fn();
		const activity = vi.fn();
		const observer = new TimeActivityObserver(plugin as any, createCallbacks({ activity, pause }));

		observer.start();
		plugin.app.workspace.activeLeaf = second as any;
		for (const callback of handlers.get("active-leaf-change") || []) {
			callback(second);
		}
		const pauseCountAfterSwitch = pause.mock.calls.length;
		firstDocument.windowTarget.dispatch("blur");

		expect(activity).toHaveBeenLastCalledWith("Notes/Second.md");
		expect(pause).toHaveBeenCalledTimes(pauseCountAfterSwitch);
		observer.stop();
	});
});
