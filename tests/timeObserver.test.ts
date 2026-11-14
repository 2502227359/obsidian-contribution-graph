import { describe, expect, it, vi } from "vitest";
import {
	TimeActivityObserver,
	isTimeActivityEvent,
} from "../src/time/TimeActivityObserver";

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

	dispatch(type: string, target: unknown = this, trusted = true): void {
		for (const listener of this.listeners.get(type) || []) {
			listener({ type, target, isTrusted: trusted });
		}
	}
}

class FakeMutationObserver {
	static readonly instances: FakeMutationObserver[] = [];
	disconnected = false;
	options?: MutationObserverInit;
	constructor(private readonly callback: () => void) {
		FakeMutationObserver.instances.push(this);
	}
	observe(_target: Node, options: MutationObserverInit): void {
		this.options = options;
	}
	disconnect(): void {
		this.disconnected = true;
	}
	trigger(): void {
		this.callback();
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

function createPlugin(views: Array<ReturnType<typeof createView>>) {
	const documentTarget = new FakeEventTarget() as any;
	const windowTarget = new FakeEventTarget() as any;
	documentTarget.visibilityState = "visible";
	documentTarget.hasFocus = () => true;
	documentTarget.querySelector = () => null;
	documentTarget.body = {};
	documentTarget.defaultView = windowTarget;
	windowTarget.MutationObserver = FakeMutationObserver;
	for (const view of views) {
		view.root.ownerDocument = documentTarget;
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
	return {
		plugin: {
			app: { workspace },
			addStatusBarItem: vi.fn(() => ({ setText: vi.fn(), remove: vi.fn() })),
		},
		documentTarget,
		windowTarget,
		handlers,
	};
}

describe("时间活动事件策略", () => {
	it("文件后缀为 Markdown 的其他插件视图不计入阅读", () => {
		const view = createView("思维导图.md");
		view.view.getViewType = () => "mindmap";
		const { plugin, documentTarget } = createPlugin([view]);
		const activity = vi.fn();
		const observer = new TimeActivityObserver(plugin as any, { activity, pause: vi.fn(), checkpoint: vi.fn(), status: () => "暂停" });
		observer.start(); documentTarget.dispatch("wheel", view.root);
		expect(activity).not.toHaveBeenCalled();
		observer.stop();
	});
	it("当前笔记重命名后立即以新路径采集", () => {
		const view = createView("旧路径.md");
		const { plugin, documentTarget } = createPlugin([view]);
		const activity = vi.fn();
		const observer = new TimeActivityObserver(plugin as any, { activity, pause: vi.fn(), checkpoint: vi.fn(), status: () => "计时中" });
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
		const observer = new TimeActivityObserver(plugin as any, {
			activity,
			pause,
			checkpoint,
			status: () => "计时中",
		});

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
		const { plugin, documentTarget, windowTarget, handlers } = createPlugin([view]);
		const activity = vi.fn();
		const observer = new TimeActivityObserver(plugin as any, {
			activity,
			pause: vi.fn(),
			checkpoint: vi.fn(),
			status: () => "已暂停",
		});

		observer.start();
		activity.mockClear();
		observer.stop();
		documentTarget.dispatch("keydown", view.root);
		windowTarget.dispatch("blur");
		for (const callbacks of handlers.values()) {
			expect(callbacks.size).toBe(0);
		}
		expect(activity).not.toHaveBeenCalled();
	});

	it("拒绝不可信事件、失焦文档、非笔记交互和弹窗中的交互", () => {
		const view = createView();
		const { plugin, documentTarget } = createPlugin([view]);
		const activity = vi.fn();
		const pause = vi.fn();
		const observer = new TimeActivityObserver(plugin as any, {
			activity,
			pause,
			checkpoint: vi.fn(),
			status: () => "计时中",
		});
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
		const observer = new TimeActivityObserver(plugin as any, {
			activity,
			pause: vi.fn(),
			checkpoint: vi.fn(),
			status: () => "计时中",
		});
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
		const observer = new TimeActivityObserver(plugin as any, {
			activity: vi.fn(),
			pause,
			checkpoint,
			status: () => "计时中",
		});
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
		const observer = new TimeActivityObserver(plugin as any, {
			activity,
			pause: vi.fn(),
			checkpoint: vi.fn(),
			status: () => "计时中",
		});
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
		const observer = new TimeActivityObserver(plugin as any, {
			activity,
			pause,
			checkpoint: vi.fn(),
			status: () => "计时中",
		});
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
		expect(FakeMutationObserver.instances[0].options).toEqual({ childList: true });
	});

	it("自动补全浮层不会阻断笔记计时", () => {
		const view = createView();
		const { plugin, documentTarget } = createPlugin([view]);
		documentTarget.querySelector = (selector: string) =>
			selector.includes("suggestion-container") ? ({} as Element) : null;
		const activity = vi.fn();
		const pause = vi.fn();
		const observer = new TimeActivityObserver(plugin as any, {
			activity,
			pause,
			checkpoint: vi.fn(),
			status: () => "计时中",
		});
		observer.start();
		documentTarget.dispatch("pointerdown", view.root, true);

		expect(activity).toHaveBeenCalledWith("Notes/Test.md");
		expect(pause).not.toHaveBeenCalled();
		observer.stop();
	});
});
