import type { EventRef, Plugin } from "obsidian";
import {
	getTimeTrackingDescription,
	getTimeTrackingStatusText,
} from "./timeTrackingPresentation";
import type { TimeTrackingContext, TimeTrackingSnapshot } from "./types";
import { isYoloChatActivity, YOLO_CHAT_ACTIVITY_PATH, YOLO_CHAT_VIEW_TYPE } from "./timeActivitySource";

export interface TimeActivityObserverCallbacks {
	activity: (path: string) => void;
	pause: () => void;
	context: (context: TimeTrackingContext) => void;
	checkpoint: () => void;
	snapshot: () => TimeTrackingSnapshot;
	toggle: () => Promise<void>;
	subscribe: (listener: () => void) => () => void;
}

interface MarkdownViewLike {
	getViewType: () => string;
	file?: { path?: unknown; extension?: unknown };
	containerEl?: {
		contains?: (target: unknown) => boolean;
		ownerDocument?: Document;
		getClientRects?: () => ArrayLike<DOMRect>;
	};
}

interface WorkspaceLike {
	activeLeaf: { view?: MarkdownViewLike } | null;
	iterateAllLeaves: (callback: (leaf: { view?: MarkdownViewLike }) => void) => void;
	on: (name: string, callback: (...args: any[]) => void) => EventRef;
	offref: (ref: EventRef) => void;
}

type PluginLike = Pick<Plugin, "addStatusBarItem"> & {
	app: { workspace: WorkspaceLike };
};

interface EventBinding {
	target: {
		addEventListener: (
			type: string,
			listener: EventListener,
			options?: boolean | AddEventListenerOptions
		) => void;
		removeEventListener: (
			type: string,
			listener: EventListener,
			options?: boolean | EventListenerOptions
		) => void;
	};
	type: string;
	listener: EventListener;
}

interface ViewBinding {
	path: string;
	root: NonNullable<MarkdownViewLike["containerEl"]>;
	ownerDocument?: Document;
}

interface ActiveContext {
	context: TimeTrackingContext;
	view?: ViewBinding;
}

interface StatusBarItemLike {
	ownerDocument?: Document;
	setText: (value: string) => void;
	setAttribute?: (name: string, value: string) => void;
	remove?: () => void;
}

const ACTIVITY_EVENT_TYPES = [
	"beforeinput",
	"input",
	"keydown",
	"pointerdown",
	"wheel",
	"touchstart",
	"touchmove",
] as const;

const PASSIVE_ACTIVITY_EVENT_TYPES = new Set<string>([
	"wheel",
	"touchstart",
	"touchmove",
]);

const THROTTLED_ACTIVITY_EVENT_TYPES = new Set<string>([
	"beforeinput",
	"input",
	"keydown",
	"wheel",
	"touchmove",
]);

const SAME_VIEW_ACTIVITY_THROTTLE_MS = 500;
const BLOCKING_MODAL_SELECTOR = ".modal-container, .modal, .prompt, dialog[open]";
const MODAL_NODE_SELECTOR = ".modal-container, .modal, .prompt, dialog";

export function isTimeActivityEvent(event: Pick<Event, "type">): boolean {
	return (ACTIVITY_EVENT_TYPES as readonly string[]).includes(event.type);
}

export function isMarkdownFilePath(path: unknown): path is string {
	return typeof path === "string" && path.toLowerCase().endsWith(".md");
}

function isVisibleDocument(document: Document | undefined): boolean {
	return document?.visibilityState === "visible";
}

function isFocusedWindow(document: Document | undefined): boolean {
	const focusedDocument = typeof activeDocument === "undefined" ? undefined : activeDocument;
	return Boolean(document && document.hasFocus() && (!focusedDocument || focusedDocument === document));
}

function isVisibleRoot(root: ViewBinding["root"]): boolean {
	return !root.getClientRects || root.getClientRects().length > 0;
}

function getPath(view: MarkdownViewLike | undefined): string | undefined {
	if (view?.getViewType() === YOLO_CHAT_VIEW_TYPE) return YOLO_CHAT_ACTIVITY_PATH;
	if (view?.getViewType() !== "markdown") return undefined;
	const path = view.file?.path;
	return isMarkdownFilePath(path) ? path : undefined;
}

function sameView(first: ViewBinding | undefined, second: ViewBinding | undefined): boolean {
	return Boolean(
		first &&
		second &&
		first.path === second.path &&
		first.root === second.root &&
		first.ownerDocument === second.ownerDocument
	);
}

/**
 * 将 Markdown 与 YOLO 对话视图中的可信交互转换为活动回调。
 * 观察器不监听 scroll 或 mousemove：滚轮和触摸事件代表用户滚动，
 * 程序滚动保持静默。状态栏只通过自己的控件监听器执行暂停/恢复。
 */
export class TimeActivityObserver {
	private readonly bindings: EventBinding[] = [];
	private readonly documentBindings = new Map<Document, EventBinding[]>();
	private readonly workspaceRefs: EventRef[] = [];
	private readonly views: ViewBinding[] = [];
	private readonly documents = new Set<Document>();
	private readonly modalObservers = new Map<Document, MutationObserver[]>();
	private statusBarItem?: StatusBarItemLike & EventBinding["target"];
	private checkpointTimer?: ReturnType<typeof setInterval>;
	private unsubscribe?: () => void;
	private started = false;
	private currentView?: ViewBinding;
	private interactionView?: ViewBinding;
	private currentContext?: TimeTrackingContext;
	private activitySessionStarted = false;
	private lastActivityAt?: number;
	private lastStatusText?: string;
	private lastStatusDescription?: string;

	constructor(
		private readonly plugin: PluginLike,
		private readonly callbacks: TimeActivityObserverCallbacks
	) {}

	start(): void {
		if (this.started) return;
		this.started = true;
		this.lastActivityAt = undefined;
		this.lastStatusText = undefined;
		this.lastStatusDescription = undefined;
		this.statusBarItem = this.plugin.addStatusBarItem() as StatusBarItemLike & EventBinding["target"];
		this.bindStatusBarItem();
		this.bindDocument(this.statusBarItem.ownerDocument);
		this.unsubscribe = this.callbacks.subscribe(() => this.updateStatus());
		this.bindWorkspaceEvents();
		this.refreshViews();
		this.refreshCurrentContext();
		this.checkpointTimer = setInterval(() => {
			if (!this.started) return;
			if (this.currentView && !this.isCurrentContextUsable()) {
				this.refreshCurrentContext();
			}
			this.callbacks.checkpoint();
			this.updateStatus();
		}, 15_000);
		this.updateStatus();
	}

	stop(): void {
		if (!this.started) return;
		this.started = false;
		this.callbacks.pause();
		this.activitySessionStarted = false;
		this.lastActivityAt = undefined;
		this.lastStatusText = undefined;
		this.lastStatusDescription = undefined;
		this.currentView = undefined;
		this.interactionView = undefined;
		this.currentContext = undefined;
		if (this.checkpointTimer !== undefined) {
			clearInterval(this.checkpointTimer);
			this.checkpointTimer = undefined;
		}
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		for (const binding of this.bindings.splice(0)) {
			binding.target.removeEventListener(binding.type, binding.listener, true);
		}
		for (const doc of [...this.documents]) {
			this.unbindDocument(doc);
		}
		const workspace = this.plugin.app.workspace;
		for (const ref of this.workspaceRefs.splice(0)) {
			workspace.offref(ref);
		}
		this.views.length = 0;
		this.statusBarItem?.remove?.();
		this.statusBarItem = undefined;
	}

	/** 手动控制或命令面板结束后，强制重新核对宿主上下文。 */
	refreshCurrentContext(restartSession = false): void {
		if (!this.started) return;
		if (restartSession) this.activitySessionStarted = false;
		this.lastActivityAt = undefined;
		this.refreshViews();
		const active = this.getActiveContext();
		this.emitContext(active.context);
		if (!active.view) {
			this.pauseCurrentActivity();
			this.updateStatus();
			return;
		}
		if (active.context.reason !== "READY") {
			this.pauseCurrentActivity();
			this.updateStatus();
			return;
		}
		this.activateView(active.view);
		this.updateStatus();
	}

	/** 文件重命名后立即重新读取当前 Markdown 路径。 */
	handlePathRename(): void {
		this.refreshCurrentContext();
	}

	private bindStatusBarItem(): void {
		const item = this.statusBarItem;
		if (!item) return;
		item.setAttribute?.("role", "button");
		item.setAttribute?.("tabindex", "0");
		item.setAttribute?.("data-cg-time-control", "time-tracking");
		this.bindEvent(item, "mouseenter", () => this.updateStatus());
		this.bindEvent(item, "focus", () => this.updateStatus());
		this.bindEvent(item, "click", () => {
			void this.toggleFromStatusBar();
		});
		this.bindEvent(item, "keydown", event => {
			const key = (event as KeyboardEvent).key;
			if ((event as KeyboardEvent).repeat) return;
			if (key !== "Enter" && key !== " ") return;
			event.preventDefault?.();
			void this.toggleFromStatusBar();
		});
	}

	private async toggleFromStatusBar(): Promise<void> {
		if (!this.started) return;
		await this.callbacks.toggle();
		this.refreshCurrentContext();
	}

	private bindWorkspaceEvents(): void {
		const workspace = this.plugin.app.workspace;
		this.bindWorkspaceEvent(workspace, "active-leaf-change", () => {
			this.interactionView = undefined;
			this.refreshCurrentContext();
		});
		this.bindWorkspaceEvent(workspace, "file-open", () => {
			this.interactionView = undefined;
			this.refreshCurrentContext();
		});
		this.bindWorkspaceEvent(workspace, "layout-change", () => this.refreshCurrentContext());
		this.bindWorkspaceEvent(workspace, "window-open", (_workspaceWindow, window) => {
			this.bindDocument(window?.document);
			this.refreshCurrentContext();
		});
		this.bindWorkspaceEvent(workspace, "window-close", (_workspaceWindow, closedWindow) => {
			const closedDoc = closedWindow?.document;
			if (closedDoc && closedDoc !== this.statusBarItem?.ownerDocument) {
				this.unbindDocument(closedDoc);
				this.refreshCurrentContext();
			}
		});
	}

	private bindWorkspaceEvent(
		workspace: WorkspaceLike,
		name: string,
		callback: (...args: any[]) => void
	): void {
		this.workspaceRefs.push(workspace.on(name, callback));
	}

	private refreshViews(): void {
		this.views.length = 0;
		const workspace = this.plugin.app.workspace;
		const addView = (leaf: { view?: MarkdownViewLike } | null | undefined) => {
			const view = leaf?.view;
			const path = getPath(view);
			const root = view?.containerEl;
			this.bindDocument(root?.ownerDocument);
			if (!path || !root || this.views.some(item => item.root === root)) return;
			this.views.push({ path, root, ownerDocument: root.ownerDocument });
		};
		workspace.iterateAllLeaves(addView);
		addView(workspace.activeLeaf);
	}

	private bindDocument(document: Document | undefined): void {
		if (!document || this.documents.has(document)) return;
		this.documents.add(document);
		const docBindings: EventBinding[] = [];
		this.documentBindings.set(document, docBindings);
		for (const type of ACTIVITY_EVENT_TYPES) {
			this.bindEvent(
				document,
				type,
				event => this.handleDocumentEvent(event),
				docBindings,
				PASSIVE_ACTIVITY_EVENT_TYPES.has(type)
			);
		}
		this.bindEvent(document, "visibilitychange", () => this.refreshCurrentContext(), docBindings);
		const window = document.defaultView;
		if (window) {
			this.bindEvent(window, "blur", () => this.handleWindowBlur(document), docBindings);
			this.bindEvent(window, "focus", () => this.refreshCurrentContext(), docBindings);
		}
		this.bindModalObserver(document);
	}

	private unbindDocument(document: Document | undefined): void {
		if (!document || !this.documents.has(document)) return;
		this.documents.delete(document);
		const bindings = this.documentBindings.get(document);
		if (bindings) {
			for (const binding of bindings) {
				binding.target.removeEventListener(binding.type, binding.listener, true);
			}
			this.documentBindings.delete(document);
		}
		const observers = this.modalObservers.get(document);
		if (observers) {
			for (const observer of observers) {
				observer.disconnect();
			}
			this.modalObservers.delete(document);
		}
		if (this.currentView?.ownerDocument === document) {
			this.pauseCurrentActivity();
		}
		if (this.interactionView?.ownerDocument === document) {
			this.interactionView = undefined;
		}
	}

	private handleWindowBlur(document: Document): void {
		const activeView = this.currentView || this.getActiveViewBinding();
		const activeDocument = activeView?.ownerDocument || this.plugin.app.workspace.activeLeaf?.view?.containerEl?.ownerDocument || this.statusBarItem?.ownerDocument;
		if (activeDocument !== document) return;
		this.emitContext({ reason: "BACKGROUND", path: activeView?.path });
		this.pauseCurrentActivity();
		this.updateStatus();
	}

	private bindModalObserver(document: Document): void {
		const body = document.body;
		const MutationObserverConstructor = document.defaultView?.MutationObserver;
		if (!body || !MutationObserverConstructor) return;
		// 拆分为两个窄范围观察器：避免对 document.body 开启 childList+subtree 导致编辑器每次打字/滚动都触发回调。
		const bodyObserver = new MutationObserverConstructor(records => {
			if (records.some(record => record.type === "childList" && record.target === body && isRelevantModalChildMutation(record))) {
				this.handleModalMutation(document);
			}
		});
		bodyObserver.observe(body, { childList: true });
		const dialogObserver = new MutationObserverConstructor(records => {
			if (records.some(record => record.type === "attributes" && (record.target as Element).nodeName === "DIALOG")) {
				this.handleModalMutation(document);
			}
		});
		dialogObserver.observe(body, {
			subtree: true,
			attributes: true,
			attributeFilter: ["open"],
		});
		this.modalObservers.set(document, [bodyObserver, dialogObserver]);
	}

	private handleModalMutation(document: Document): void {
		const activeDocument = this.plugin.app.workspace.activeLeaf?.view?.containerEl?.ownerDocument || this.statusBarItem?.ownerDocument;
		if (this.currentView?.ownerDocument !== document && activeDocument !== document) {
			return;
		}
		this.refreshCurrentContext();
	}

	private bindEvent(
		target: EventBinding["target"],
		type: string,
		listener: EventListener,
		bucket: EventBinding[] = this.bindings,
		passive = false
	): void {
		target.addEventListener(type, listener, passive ? { capture: true, passive: true } : true);
		bucket.push({ target, type, listener });
	}

	private handleDocumentEvent(event: Event): void {
		if (!this.started || !isTimeActivityEvent(event)) return;
		if ("isTrusted" in event && event.isTrusted === false) return;
		if (this.isStatusBarTarget(event.target)) return;
		if (this.handleTimelineControl(event.target)) return;

		// 高频同视图交互（连打、触控板滚动）节流：仅在当前窗口聚焦可见、视图已就绪且事件命中当前视图时跳过重复查询。
		if (
			THROTTLED_ACTIVITY_EVENT_TYPES.has(event.type) &&
			this.activitySessionStarted &&
			this.currentView &&
			this.currentContext?.reason === "READY" &&
			this.lastActivityAt !== undefined &&
			isVisibleDocument(this.currentView.ownerDocument) &&
			isFocusedWindow(this.currentView.ownerDocument) &&
			this.contains(this.currentView.root, event.target)
		) {
			const now = Date.now();
			if (now - this.lastActivityAt < SAME_VIEW_ACTIVITY_THROTTLE_MS) {
				return;
			}
		}

		const eventView = this.views.find(candidate => this.contains(candidate.root, event.target));
		this.interactionView = eventView && isYoloChatActivity(eventView.path) ? eventView : undefined;
		const eventIsActive = eventView && (isYoloChatActivity(eventView.path) ||
			eventView.root === this.plugin.app.workspace.activeLeaf?.view?.containerEl);
		const active = this.getActiveContext(eventIsActive ? eventView : undefined);
		if (active.context.reason !== "READY") {
			this.emitContext(active.context);
			this.pauseCurrentActivity(true);
			this.updateStatus();
			return;
		}
		const activeView = active.view;
		if (!eventView || !sameView(eventView, activeView)) {
			if (eventView && !isYoloChatActivity(this.currentView?.path)) return;
			this.emitContext({ reason: "OUTSIDE_EDITOR", path: activeView?.path });
			this.pauseCurrentActivity(true);
			this.updateStatus();
			return;
		}

		this.emitContext(active.context);
		if (active.view) {
			this.activateView(active.view, true);
			if (this.activitySessionStarted) this.lastActivityAt = Date.now();
		}
		this.updateStatus();
	}

	private contains(root: ViewBinding["root"], target: EventTarget | null): boolean {
		try {
			return root === target || Boolean(root.contains?.(target));
		} catch {
			return false;
		}
	}

	private isStatusBarTarget(target: EventTarget | null): boolean {
		const item = this.statusBarItem;
		if (!item || !target) return false;
		const itemTarget = item as unknown as EventTarget & {
			contains?: (child: EventTarget) => boolean;
		};
		try {
			return itemTarget === target || Boolean(itemTarget.contains?.(target));
		} catch {
			return itemTarget === target;
		}
	}

	private handleTimelineControl(target:EventTarget|null):boolean {
		const element=target as {closest?:(selector:string)=>unknown;parentElement?:Element}|null;
		const control=element?.closest?.('[data-cg-time-control="activity-timeline"]')||element?.parentElement?.closest('[data-cg-time-control="activity-timeline"]');
		if(!control)return false;
		const view=this.currentView||this.getActiveViewBinding();
		this.emitContext({reason:"OUTSIDE_EDITOR",path:view?.path});
		this.pauseCurrentActivity(true);this.updateStatus();return true;
	}

	private emitContext(context: TimeTrackingContext): void {
		if (
			this.currentContext?.reason === context.reason &&
			this.currentContext?.path === context.path
		) {
			return;
		}
		this.currentContext = context;
		this.callbacks.context(context);
	}

	private activateView(view: ViewBinding, fromActivity = false): void {
		if (!sameView(this.currentView, view)) {
			if (this.activitySessionStarted) this.callbacks.pause();
			this.currentView = view;
			this.activitySessionStarted = false;
		}

		if (this.callbacks.snapshot().manualPaused) {
			this.activitySessionStarted = false;
			return;
		}
		if (fromActivity || !this.activitySessionStarted) {
			this.callbacks.activity(view.path);
			this.activitySessionStarted = true;
		}
	}

	private pauseCurrentActivity(force = false): void {
		if (force || this.activitySessionStarted) this.callbacks.pause();
		this.currentView = undefined;
		this.interactionView = undefined;
		this.activitySessionStarted = false;
		this.lastActivityAt = undefined;
	}

	private getActiveContext(eventView?: ViewBinding): ActiveContext {
		const view = this.plugin.app.workspace.activeLeaf?.view;
		const binding = eventView || this.getActiveViewBinding();
		const root = binding?.root || view?.containerEl;
		const path = binding?.path;
		const document = root?.ownerDocument || this.statusBarItem?.ownerDocument;
		if (document && (!isVisibleDocument(document) || !isFocusedWindow(document))) {
			return { context: { reason: "BACKGROUND", path } };
		}
		if (this.hasBlockingModal(document)) return { context: { reason: "MODAL", path } };
		if (!path || !root) return { context: { reason: "NO_MARKDOWN" } };
		return { context: { reason: "READY", path }, view: binding };
	}

	private getActiveViewBinding(): ViewBinding | undefined {
		// 侧栏滚轮不一定改变 activeLeaf 或输入焦点，以最近的可信交互为准。
		const interaction = this.views.find(candidate => sameView(candidate, this.interactionView));
		if (interaction && isVisibleRoot(interaction.root) && isFocusedWindow(interaction.ownerDocument)) return interaction;
		const focusedChat = this.views.find(candidate => isYoloChatActivity(candidate.path) &&
			isVisibleRoot(candidate.root) && isFocusedWindow(candidate.ownerDocument) && this.contains(candidate.root, candidate.ownerDocument?.activeElement || null));
		if (focusedChat) return focusedChat;
		const view = this.plugin.app.workspace.activeLeaf?.view;
		const path = getPath(view);
		const root = view?.containerEl;
		if (!path || !root || !isVisibleRoot(root)) return undefined;
		return this.views.find(candidate => candidate.root === root) || {
			path,
			root,
			ownerDocument: root.ownerDocument,
		};
	}

	private hasBlockingModal(document: Document | undefined): boolean {
		if (!document?.querySelector) return false;
		return Boolean(document.querySelector(BLOCKING_MODAL_SELECTOR));
	}

	private isCurrentContextUsable(): boolean {
		if (!this.currentView) return false;
		const activeView = this.getActiveViewBinding();
		return Boolean(
			sameView(this.currentView, activeView) &&
			!this.hasBlockingModal(this.currentView.ownerDocument) &&
			isVisibleDocument(this.currentView.ownerDocument) &&
			isFocusedWindow(this.currentView.ownerDocument)
		);
	}

	private updateStatus(): void {
		const item = this.statusBarItem;
		if (!item) return;
		const snapshot = this.callbacks.snapshot();
		const text = getTimeTrackingStatusText(snapshot);
		if (text !== this.lastStatusText) {
			this.lastStatusText = text;
			item.setText(text);
		}
		const description = getTimeTrackingDescription(snapshot);
		if (description !== this.lastStatusDescription) {
			this.lastStatusDescription = description;
			// 宿主使用 aria-label 生成提示，额外的 title 会再弹出浏览器原生提示。
			item.setAttribute?.("aria-label", description);
		}
	}
}

function isRelevantModalChildMutation(record: MutationRecord): boolean {
	const added = record.addedNodes;
	const removed = record.removedNodes;
	if (!added && !removed) return true;
	const checkList = (nodes: NodeList | undefined): boolean => {
		if (!nodes) return false;
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i] as { nodeType?: number; matches?: (s: string) => boolean; querySelector?: (s: string) => unknown };
			if (node?.nodeType !== 1) continue;
			if (node.matches?.(MODAL_NODE_SELECTOR) || node.querySelector?.(MODAL_NODE_SELECTOR)) {
				return true;
			}
		}
		return false;
	};
	return checkList(added) || checkList(removed);
}
