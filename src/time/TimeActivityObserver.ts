import type { EventRef, Plugin } from "obsidian";

export interface TimeActivityObserverCallbacks {
	activity: (path: string) => void;
	pause: () => void;
	checkpoint: () => void;
	status: () => string;
}

interface MarkdownViewLike {
	getViewType: () => string;
	file?: { path?: unknown; extension?: unknown };
	containerEl?: {
		contains?: (target: unknown) => boolean;
		ownerDocument?: Document;
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

const ACTIVITY_EVENT_TYPES = [
	"beforeinput",
	"input",
	"keydown",
	"pointerdown",
	"wheel",
	"touchstart",
	"touchmove",
] as const;

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
	return Boolean(document && document.hasFocus());
}

function getPath(view: MarkdownViewLike | undefined): string | undefined {
	if (view?.getViewType() !== "markdown") return undefined;
	const path = view?.file?.path;
	return isMarkdownFilePath(path) ? path : undefined;
}

/**
 * 将 Markdown 视图中的可信交互转换为活动回调。
 * 观察器不监听 scroll 或 mousemove：滚轮和触摸事件代表用户滚动，
 * 程序滚动保持静默。
 */
export class TimeActivityObserver {
	private readonly bindings: EventBinding[] = [];
	private readonly workspaceRefs: EventRef[] = [];
	private readonly views: ViewBinding[] = [];
	private readonly documents = new Set<Document>();
	private readonly modalObservers = new Map<Document, MutationObserver>();
	private statusBarItem?: HTMLElement & { setText(value: string): void };
	private checkpointTimer?: ReturnType<typeof setInterval>;
	private started = false;
	private currentPath?: string;
	private currentDocument?: Document;

	constructor(
		private readonly plugin: PluginLike,
		private readonly callbacks: TimeActivityObserverCallbacks
	) {}

	start(): void {
		if (this.started) {
			return;
		}
		this.started = true;
		this.statusBarItem = this.plugin.addStatusBarItem() as HTMLElement & {
			setText(value: string): void;
		};
		this.bindWorkspaceEvents();
		this.refreshViews();
		this.startActiveView();
		this.checkpointTimer = setInterval(() => {
			if (!this.started) {
				return;
			}
			if (this.currentPath && !this.isCurrentContextUsable()) {
				this.pauseCurrentActivity();
			}
			this.callbacks.checkpoint();
			this.updateStatus();
		}, 15_000);
		this.updateStatus();
	}

	stop(): void {
		if (!this.started) {
			return;
		}
		this.started = false;
		this.callbacks.pause();
		if (this.checkpointTimer !== undefined) {
			clearInterval(this.checkpointTimer);
			this.checkpointTimer = undefined;
		}
		for (const binding of this.bindings.splice(0)) {
			binding.target.removeEventListener(binding.type, binding.listener, true);
		}
		const workspace = this.plugin.app.workspace;
		for (const ref of this.workspaceRefs.splice(0)) {
			workspace.offref(ref);
		}
		for (const observer of this.modalObservers.values()) {
			observer.disconnect();
		}
		this.modalObservers.clear();
		this.documents.clear();
		this.views.length = 0;
		this.currentPath = undefined;
		this.currentDocument = undefined;
		this.statusBarItem?.remove();
		this.statusBarItem = undefined;
	}

	handlePathRename(): void {
		this.pauseCurrentActivity(true);
		this.refreshViews();
		this.startActiveView();
		this.updateStatus();
	}

	private bindWorkspaceEvents(): void {
		const workspace = this.plugin.app.workspace;
		this.bindWorkspaceEvent(workspace, "active-leaf-change", () => {
			this.callbacks.pause();
			this.currentPath = undefined;
			this.currentDocument = undefined;
			this.refreshViews();
			this.startActiveView();
			this.updateStatus();
		});
		this.bindWorkspaceEvent(workspace, "file-open", () => {
			this.callbacks.pause();
			this.currentPath = undefined;
			this.currentDocument = undefined;
			this.refreshViews();
			this.startActiveView();
			this.updateStatus();
		});
		this.bindWorkspaceEvent(workspace, "window-open", (_workspaceWindow, window) => {
			this.bindDocument(window?.document);
			this.refreshViews();
			this.startActiveView();
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
			if (!path || !root || this.views.some((item) => item.root === root)) {
				return;
			}
			this.views.push({ path, root, ownerDocument: root.ownerDocument });
			this.bindDocument(root.ownerDocument);
		};
		workspace.iterateAllLeaves(addView);
		addView(workspace.activeLeaf);
	}

	private bindDocument(document: Document | undefined): void {
		if (!document || this.documents.has(document)) {
			return;
		}
		this.documents.add(document);
		for (const type of ACTIVITY_EVENT_TYPES) {
			this.bindEvent(document, type, (event) => this.handleDocumentEvent(event));
		}
		this.bindEvent(document, "visibilitychange", () => {
			if (!isVisibleDocument(document)) {
				this.pauseCurrentActivity();
			} else {
				this.refreshViews();
				this.startActiveView();
				this.updateStatus();
			}
		});
		const window = document.defaultView;
		if (window) {
			this.bindEvent(window, "blur", () => this.pauseCurrentActivity());
			this.bindEvent(window, "focus", () => {
				this.refreshViews();
				this.startActiveView();
				this.updateStatus();
			});
		}
		this.bindModalObserver(document);
	}

	private bindModalObserver(document: Document): void {
		const body = document.body;
		const MutationObserverConstructor = document.defaultView?.MutationObserver;
		if (!body || !MutationObserverConstructor) {
			return;
		}
		const observer = new MutationObserverConstructor(records => {
			const modalChanged = records.some(record =>
				(record.type === "childList" && record.target === body) ||
				(record.type === "attributes" && record.target.nodeName === "DIALOG")
			);
			if (modalChanged) this.handleModalMutation(document);
		});
		observer.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
		this.modalObservers.set(document, observer);
	}

	private handleModalMutation(document: Document): void {
		if (this.hasBlockingModal(document)) {
			if (this.currentDocument === document) {
				this.pauseCurrentActivity();
			}
			return;
		}
		this.startActiveView();
		this.updateStatus();
	}

	private bindEvent(
		target: EventBinding["target"],
		type: string,
		listener: EventListener
	): void {
		target.addEventListener(type, listener, true);
		this.bindings.push({ target, type, listener });
	}

	private handleDocumentEvent(event: Event): void {
		if (!this.started) {
			return;
		}
		if (event.type === "visibilitychange") {
			return;
		}
		if (!isTimeActivityEvent(event)) {
			return;
		}
		if ("isTrusted" in event && event.isTrusted === false) {
			return;
		}
		const target = event.target;
		const view = this.views.find((candidate) => {
			try {
				return candidate.root === target || Boolean(candidate.root.contains?.(target));
			} catch {
				return false;
			}
		});
		if (
			!view ||
			this.hasBlockingModal(view.ownerDocument) ||
			!isVisibleDocument(view.ownerDocument) ||
			!isFocusedWindow(view.ownerDocument)
		) {
			this.pauseCurrentActivity(true);
			return;
		}
		if (this.currentPath && this.currentPath !== view.path) {
			this.callbacks.pause();
		}
		this.currentPath = view.path;
		this.currentDocument = view.ownerDocument;
		this.callbacks.activity(view.path);
		this.updateStatus();
	}

	private pauseCurrentActivity(force = false): void {
		if (force || this.currentPath !== undefined) {
			this.callbacks.pause();
		}
		if (this.currentPath !== undefined) {
			this.currentPath = undefined;
			this.currentDocument = undefined;
			this.updateStatus();
		}
	}

	private startActiveView(): void {
		const view = this.getActiveViewBinding();
		if (
			!view ||
			this.hasBlockingModal(view.ownerDocument) ||
			!isVisibleDocument(view.ownerDocument) ||
			!isFocusedWindow(view.ownerDocument)
		) {
			return;
		}
		if (
			this.currentPath === view.path &&
			this.currentDocument === view.ownerDocument
		) {
			return;
		}
		this.currentPath = view.path;
		this.currentDocument = view.ownerDocument;
		this.callbacks.activity(view.path);
	}

	private getActiveViewBinding(): ViewBinding | undefined {
		const view = this.plugin.app.workspace.activeLeaf?.view;
		const path = getPath(view);
		const root = view?.containerEl;
		if (!path || !root) {
			return undefined;
		}
		return (
			this.views.find((candidate) => candidate.root === root) || {
				path,
				root,
				ownerDocument: root.ownerDocument,
			}
		);
	}

	private hasBlockingModal(document: Document | undefined): boolean {
		if (!document?.querySelector) {
			return false;
		}
		return Boolean(
			document.querySelector(
				".modal-container, .modal, .prompt, dialog[open]"
			)
		);
	}

	private isCurrentContextUsable(): boolean {
		if (!this.currentPath || !this.currentDocument) {
			return false;
		}
		const view = this.views.find(
			(candidate) =>
				candidate.path === this.currentPath &&
				candidate.ownerDocument === this.currentDocument
		);
		const activeView = this.getActiveViewBinding();
		return Boolean(
			view &&
			activeView?.path === this.currentPath &&
			activeView.ownerDocument === this.currentDocument &&
			!this.hasBlockingModal(view.ownerDocument) &&
			isVisibleDocument(view.ownerDocument) &&
			isFocusedWindow(view.ownerDocument)
		);
	}

	private updateStatus(): void {
		if (!this.statusBarItem) {
			return;
		}
		this.statusBarItem.setText(this.callbacks.status());
	}
}
