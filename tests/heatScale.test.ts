import { describe, expect, it } from "vitest";
import { createDefaultGoalHeatScale } from "../src/constants";
import { resolveGoalHeatLevel } from "../src/render/heatScale";
import { isDateTracked } from "../src/render/matrixDataGenerator";

describe("resolveGoalHeatLevel", () => {
	const scale = createDefaultGoalHeatScale(1000);

	it("keeps zero empty", () => {
		expect(resolveGoalHeatLevel(0, scale)).toBeNull();
	});

	it.each([
		[1, 0],
		[249, 0],
		[250, 0.25],
		[599, 0.25],
		[600, 0.6],
		[999, 0.6],
		[1000, 1],
		[8000, 1],
	])("maps %i characters to the %f ratio level", (value, ratio) => {
		expect(resolveGoalHeatLevel(value, scale)?.minRatio).toBe(ratio);
	});
});

describe("tracking coverage", () => {
	const periods = [
		{ startDate: "2026-07-01", endDate: "2026-07-10" },
		{ startDate: "2026-07-20" },
	];

	it("distinguishes tracked, paused, and pre-tracking dates", () => {
		expect(isDateTracked("2026-06-30", periods)).toBe(false);
		expect(isDateTracked("2026-07-01", periods)).toBe(true);
		expect(isDateTracked("2026-07-10", periods)).toBe(true);
		expect(isDateTracked("2026-07-15", periods)).toBe(false);
		expect(isDateTracked("2026-07-31", periods)).toBe(true);
	});
});
