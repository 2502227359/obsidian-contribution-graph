import type { DailyEditStatsQuery } from "./EditActivityService";

export interface ActivityDateRangeConfig {
	dateRangeType?:
		| "LATEST_DAYS"
		| "LATEST_MONTH"
		| "LATEST_YEAR"
		| "FIXED_DATE_RANGE";
	dateRangeValue?: number;
	days?: number;
	fromDate?: string;
	toDate?: string;
}

export function getActivityDateRange(
	config: ActivityDateRangeConfig,
	now: Date = new Date()
): DailyEditStatsQuery {
	if (config.dateRangeType === "FIXED_DATE_RANGE") {
		return {
			fromDate: config.fromDate,
			toDate: config.toDate,
		};
	}

	const rangeValue = Math.max(
		1,
		config.dateRangeValue || config.days || 1
	);
	if (config.dateRangeType === "LATEST_MONTH") {
		return {
			fromDate: formatLocalDate(
				new Date(
					now.getFullYear(),
					now.getMonth() - rangeValue + 1,
					1
				)
			),
			toDate: formatLocalDate(
				new Date(now.getFullYear(), now.getMonth() + 1, 0)
			),
		};
	}

	if (config.dateRangeType === "LATEST_YEAR") {
		return {
			fromDate: formatLocalDate(
				new Date(now.getFullYear() - rangeValue + 1, 0, 1)
			),
			toDate: formatLocalDate(new Date(now.getFullYear(), 12, 0)),
		};
	}

	const fromDate = new Date(now);
	fromDate.setHours(0, 0, 0, 0);
	fromDate.setDate(fromDate.getDate() - rangeValue + 1);
	return {
		fromDate: formatLocalDate(fromDate),
		toDate: formatLocalDate(now),
	};
}

function formatLocalDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}
