import { describe, expect, it } from "vitest";
import {
	resolveTimelineOverflowState,
	resolveTimelineScrollLeft,
} from "../src/render/timelineScroll";

describe("timeline scroll positioning", () => {
	it("shows the latest dates on first render", () => {
		expect(resolveTimelineScrollLeft(640)).toBe(640);
	});

	it("continues following the latest edge after a refresh", () => {
		expect(
			resolveTimelineScrollLeft(720, { left: 640, atLatest: true })
		).toBe(720);
	});

	it("preserves a user's historical position after a refresh", () => {
		expect(
			resolveTimelineScrollLeft(720, { left: 180, atLatest: false })
		).toBe(180);
	});

	it("clamps a preserved position when the graph becomes narrower", () => {
		expect(
			resolveTimelineScrollLeft(120, { left: 180, atLatest: false })
		).toBe(120);
	});
});

describe("timeline overflow affordance", () => {
	it("shows only the edge that contains hidden content", () => {
		expect(resolveTimelineOverflowState(900, 300, 0)).toEqual({
			canScrollLeft: false,
			canScrollRight: true,
		});
		expect(resolveTimelineOverflowState(900, 300, 260)).toEqual({
			canScrollLeft: true,
			canScrollRight: true,
		});
		expect(resolveTimelineOverflowState(900, 300, 600)).toEqual({
			canScrollLeft: true,
			canScrollRight: false,
		});
	});

	it("does not show an affordance when the chart fits", () => {
		expect(resolveTimelineOverflowState(300, 420, 0)).toEqual({
			canScrollLeft: false,
			canScrollRight: false,
		});
	});
});
