import { describe, expect, it } from "vitest";
import { resolveCellNavigationIndex } from "../src/render/cellKeyboardNavigation";

describe("cell keyboard navigation", () => {
	it("moves between days and weeks", () => {
		expect(resolveCellNavigationIndex(10, 30, "ArrowLeft")).toBe(9);
		expect(resolveCellNavigationIndex(10, 30, "ArrowRight")).toBe(11);
		expect(resolveCellNavigationIndex(10, 30, "ArrowUp")).toBe(3);
		expect(resolveCellNavigationIndex(10, 30, "ArrowDown")).toBe(17);
	});

	it("supports range edges without leaving the graph", () => {
		expect(resolveCellNavigationIndex(0, 30, "ArrowLeft")).toBe(0);
		expect(resolveCellNavigationIndex(28, 30, "ArrowDown")).toBe(29);
		expect(resolveCellNavigationIndex(12, 30, "Home")).toBe(0);
		expect(resolveCellNavigationIndex(12, 30, "End")).toBe(29);
	});

	it("ignores non-navigation keys and invalid ranges", () => {
		expect(resolveCellNavigationIndex(3, 10, "Enter")).toBeUndefined();
		expect(resolveCellNavigationIndex(-1, 10, "ArrowRight")).toBeUndefined();
	});
});
