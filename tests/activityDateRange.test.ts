import { describe, expect, it } from "vitest";
import { getActivityDateRange } from "../src/activity/dateRange";

describe("getActivityDateRange", () => {
	const now = new Date(2026, 6, 31, 16, 0, 0);

	it("limits latest days to the visible range", () => {
		expect(
			getActivityDateRange(
				{
					dateRangeType: "LATEST_DAYS",
					dateRangeValue: 180,
				},
				now
			)
		).toEqual({
			fromDate: "2026-02-02",
			toDate: "2026-07-31",
		});
	});

	it("preserves a fixed date range", () => {
		expect(
			getActivityDateRange({
				dateRangeType: "FIXED_DATE_RANGE",
				fromDate: "2025-01-01",
				toDate: "2025-12-31",
			})
		).toEqual({
			fromDate: "2025-01-01",
			toDate: "2025-12-31",
		});
	});

	it("covers complete latest months", () => {
		expect(
			getActivityDateRange(
				{
					dateRangeType: "LATEST_MONTH",
					dateRangeValue: 2,
				},
				now
			)
		).toEqual({
			fromDate: "2026-06-01",
			toDate: "2026-07-31",
		});
	});

	it("covers complete latest years", () => {
		expect(
			getActivityDateRange(
				{
					dateRangeType: "LATEST_YEAR",
					dateRangeValue: 2,
				},
				now
			)
		).toEqual({
			fromDate: "2025-01-01",
			toDate: "2026-12-31",
		});
	});
});
