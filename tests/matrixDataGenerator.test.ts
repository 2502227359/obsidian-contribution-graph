import { describe, expect, it } from "vitest";
import {
	generateByFixedDate,
	generateByLatestDays,
	getDateTrackingState,
} from "../src/render/matrixDataGenerator";

describe("matrix date boundaries", () => {
	it("generates exactly the requested latest days", () => {
		expect(generateByLatestDays(180, [])).toHaveLength(180);
	});

	it("ignores time-of-day differences when counting calendar days", () => {
		expect(
			generateByFixedDate(
				new Date(2026, 6, 30, 23, 59, 59, 999),
				new Date(2026, 6, 31, 0, 0, 0, 1),
				[]
			)
		).toHaveLength(2);
	});

	it("returns no cells for a reversed fixed range", () => {
		expect(
			generateByFixedDate(
				new Date(2026, 6, 31),
				new Date(2026, 6, 30),
				[]
			)
		).toEqual([]);
	});
});

describe("folder collection coverage", () => {
	it("distinguishes tracked, partial, and untracked folder dates", () => {
		const tracking = [{ startDate: "2026-07-30" }];
		expect(getDateTrackingState("2026-07-31", tracking, [
			{ startDate: "2026-07-30", folders: [] },
		], ["Projects"])).toBe("TRACKED");
		expect(getDateTrackingState("2026-07-31", tracking, [
			{ startDate: "2026-07-31", endDate: "2026-07-31", folders: [] },
			{ startDate: "2026-07-31", folders: ["Journal"] },
		], ["Projects"])).toBe("PARTIAL");
		expect(getDateTrackingState("2026-07-31", tracking, [
			{ startDate: "2026-07-30", folders: ["Journal"] },
		], ["Projects"])).toBe("UNTRACKED");
	});
});
