import { describe, expect, it } from "vitest";
import { resolveTimelineScrollLeft } from "../src/render/timelineScroll";

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
