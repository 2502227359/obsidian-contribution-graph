export interface TimelineScrollSnapshot {
	left: number;
	atLatest: boolean;
}

export interface TimelineOverflowState {
	canScrollLeft: boolean;
	canScrollRight: boolean;
}

const LATEST_EDGE_THRESHOLD = 24;

export function captureTimelineScroll(
	element: HTMLElement | null
): TimelineScrollSnapshot | undefined {
	if (!element) {
		return undefined;
	}
	const maxScrollLeft = Math.max(
		0,
		element.scrollWidth - element.clientWidth
	);
	return {
		left: element.scrollLeft,
		atLatest:
			maxScrollLeft - element.scrollLeft <= LATEST_EDGE_THRESHOLD,
	};
}

export function resolveTimelineScrollLeft(
	maxScrollLeft: number,
	previous?: TimelineScrollSnapshot
): number {
	const safeMaximum = Math.max(0, maxScrollLeft);
	if (!previous || previous.atLatest) {
		return safeMaximum;
	}
	return Math.min(Math.max(0, previous.left), safeMaximum);
}

export function resolveTimelineOverflowState(
	scrollWidth: number,
	clientWidth: number,
	scrollLeft: number
): TimelineOverflowState {
	const maxScrollLeft = Math.max(0, scrollWidth - clientWidth);
	const safeLeft = Math.min(Math.max(0, scrollLeft), maxScrollLeft);
	return {
		canScrollLeft: safeLeft > 1,
		canScrollRight: maxScrollLeft - safeLeft > 1,
	};
}

export function updateTimelineScrollAffordance(
	element: HTMLElement | null
): void {
	if (!element) {
		return;
	}
	const state = resolveTimelineOverflowState(
		element.scrollWidth,
		element.clientWidth,
		element.scrollLeft
	);
	element.classList.toggle("can-scroll-left", state.canScrollLeft);
	element.classList.toggle("can-scroll-right", state.canScrollRight);
}

export function bindTimelineScrollAffordance(
	element: HTMLElement | null
): void {
	if (!element) {
		return;
	}
	const update = () => updateTimelineScrollAffordance(element);
	element.addEventListener("scroll", update, { passive: true });
	if (
		typeof window !== "undefined" &&
		typeof window.requestAnimationFrame === "function"
	) {
		window.requestAnimationFrame(update);
	} else {
		update();
	}
}

export function restoreTimelineScroll(
	element: HTMLElement | null,
	previous?: TimelineScrollSnapshot
): void {
	if (!element) {
		return;
	}
	const apply = () => {
		if (!element.isConnected) {
			return;
		}
		const maxScrollLeft = Math.max(
			0,
			element.scrollWidth - element.clientWidth
		);
		element.scrollLeft = resolveTimelineScrollLeft(
			maxScrollLeft,
			previous
		);
		updateTimelineScrollAffordance(element);
	};

	if (
		typeof window !== "undefined" &&
		typeof window.requestAnimationFrame === "function"
	) {
		window.requestAnimationFrame(apply);
	} else {
		apply();
	}
}
