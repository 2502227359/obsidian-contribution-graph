import type { EditActivityChangeEvent } from "../activity/EditActivityService";

export interface GraphRefreshSchedulerOptions {
	container: HTMLElement;
	refresh: (events: EditActivityChangeEvent[]) => void;
	accept: (event: EditActivityChangeEvent) => boolean;
	subscribe: (listener: (event: EditActivityChangeEvent) => void) => () => void;
	hourly: boolean;
}

const REFRESH_WINDOW_MS = 150;

/** 合并统计变化并在图表可见时触发一次刷新。 */
export class GraphRefreshScheduler {
	private readonly container: HTMLElement;
	private readonly refresh: GraphRefreshSchedulerOptions["refresh"];
	private readonly accept: GraphRefreshSchedulerOptions["accept"];
	private readonly subscribe: GraphRefreshSchedulerOptions["subscribe"];
	private readonly hourly: boolean;
	private pending: EditActivityChangeEvent[] = [];
	private unsubscribe?: () => void;
	private refreshTimer?: ReturnType<typeof setTimeout>;
	private boundaryTimer?: ReturnType<typeof setTimeout>;
	private intersectionObserver?: IntersectionObserver;
	private visible = true;
	private started = false;
	private boundaryMarker = "";

	constructor(options: GraphRefreshSchedulerOptions) {
		this.container = options.container;
		this.refresh = options.refresh;
		this.accept = options.accept;
		this.subscribe = options.subscribe;
		this.hourly = options.hourly;
	}

	start(): void {
		if (this.started) return;
		this.started = true;
		this.unsubscribe = this.subscribe(event => this.enqueue(event));
		this.boundaryMarker = this.getBoundaryMarker(new Date());
		this.bindVisibility();
		this.scheduleBoundary();
	}

	stop(): void {
		if (!this.started) return;
		this.started = false;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer);
		if (this.boundaryTimer !== undefined) clearTimeout(this.boundaryTimer);
		this.refreshTimer = undefined;
		this.boundaryTimer = undefined;
		this.pending = [];
		this.boundaryMarker = "";
		this.unbindVisibility();
	}

	private enqueue(event: EditActivityChangeEvent): void {
		if (!this.started || !this.accept(event)) return;
		this.mergePending(event);
		if (this.refreshTimer === undefined) {
			this.refreshTimer = setTimeout(() => {
				this.refreshTimer = undefined;
				this.flushIfVisible();
			}, REFRESH_WINDOW_MS);
		}
	}

	private flushIfVisible(): void {
		if (!this.started || !this.isVisible() || !this.pending.length) return;
		const events = this.pending;
		this.pending = [];
		this.refresh(events);
	}

	private bindVisibility(): void {
		const document = this.container.ownerDocument;
		const view = document?.defaultView;
		document?.addEventListener("visibilitychange", this.handleVisibility);
		view?.addEventListener("pageshow", this.handleVisibility);
		const Constructor = view?.IntersectionObserver;
		if (typeof Constructor === "function") {
			this.intersectionObserver = new Constructor(entries => {
				this.visible = entries[0]?.isIntersecting !== false;
				if (this.visible) {
					this.queueMissedBoundary();
					this.flushIfVisible();
				}
			});
			this.intersectionObserver.observe(this.container);
		}
	}

	private unbindVisibility(): void {
		const document = this.container.ownerDocument;
		const view = document?.defaultView;
		document?.removeEventListener("visibilitychange", this.handleVisibility);
		view?.removeEventListener("pageshow", this.handleVisibility);
		this.intersectionObserver?.disconnect();
		this.intersectionObserver = undefined;
		this.visible = true;
	}

	private readonly handleVisibility = (): void => {
		if (this.isDocumentVisible()) {
			this.queueMissedBoundary();
			this.flushIfVisible();
		}
	};

	private isDocumentVisible(): boolean {
		return this.container.ownerDocument?.visibilityState !== "hidden";
	}

	private isVisible(): boolean {
		if (!this.isDocumentVisible() || this.container.isConnected === false || !this.visible) return false;
		if (this.intersectionObserver) return true;
		const rect = this.container.getBoundingClientRect?.();
		return !rect || (rect.width > 0 && rect.height > 0);
	}

	private mergePending(event: EditActivityChangeEvent): void {
		if (this.pending.some(candidate => ["IMPORT", "COVERAGE", "TEMPORAL", "SETTINGS"].includes(candidate.type))) return;
		const incoming = this.copyEvent(event);
		if (["IMPORT", "COVERAGE", "TEMPORAL", "SETTINGS"].includes(incoming.type)) {
			this.pending = [incoming];
			return;
		}
		if (incoming.type === "TIME_STATS" && !incoming.timeKeys?.length) {
			this.pending = this.pending.filter(candidate => candidate.type !== "TIME_STATS");
			this.pending.push(incoming);
			return;
		}
		if (this.pending.some(candidate => candidate.type === "TIME_STATS" && !candidate.timeKeys?.length)) {
			return;
		}
		const index = this.pending.findIndex(candidate =>
			candidate.type === incoming.type &&
			candidate.date === incoming.date
		);
		if (index < 0) {
			this.pending.push(incoming);
			return;
		}
		const existing = this.pending[index];
		const keys = new Map((existing.timeKeys || []).map(key => [`${key.date}T${key.hour}`, key]));
		for (const key of incoming.timeKeys || []) keys.set(`${key.date}T${key.hour}`, key);
		const merged = {...existing, ...incoming};
		if (keys.size) merged.timeKeys = [...keys.values()];
		this.pending = [...this.pending.slice(0, index), merged, ...this.pending.slice(index + 1)];
	}

	private copyEvent(event: EditActivityChangeEvent): EditActivityChangeEvent {
		const {filePath: _filePath, ...copy} = event;
		return {
			...copy,
			...(event.timeKeys ? {timeKeys: event.timeKeys.map(key => ({...key}))} : {}),
		};
	}

	private queueMissedBoundary(): void {
		const marker = this.getBoundaryMarker(new Date());
		if (marker === this.boundaryMarker) return;
		this.boundaryMarker = marker;
		this.enqueue({type: "TEMPORAL"});
	}

	private scheduleBoundary(): void {
		const now = new Date();
		const next = this.hourly
			? new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1)
			: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
		const delay = Math.max(1, next.getTime() - now.getTime());
		this.boundaryTimer = setTimeout(() => {
			this.boundaryTimer = undefined;
			this.queueMissedBoundary();
			this.scheduleBoundary();
		}, delay);
	}

	private getBoundaryMarker(date: Date): string {
		const day = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
		return this.hourly ? `${day}-${date.getHours()}` : day;
	}
}
