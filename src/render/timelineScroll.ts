export interface TimelineScrollSnapshot {
	left: number;
	atLatest: boolean;
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
