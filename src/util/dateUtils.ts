import { DateTime } from "luxon";

export function parseDate(date: string | Date) {
	if (typeof date === "string") {
		const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
		if (match) {
			return new Date(
				Number(match[1]),
				Number(match[2]) - 1,
				Number(match[3])
			);
		}
		return new Date(date);
	} else {
		return date;
	}
}

export function diffDays(date1: Date, date2: Date) {
	const from = DateTime.fromJSDate(date1);
	const to = DateTime.fromJSDate(date2);
	return to.diff(from, "days").days;
}

export function diffCalendarDays(date1: Date, date2: Date): number {
	const from = Date.UTC(
		date1.getFullYear(),
		date1.getMonth(),
		date1.getDate()
	);
	const to = Date.UTC(
		date2.getFullYear(),
		date2.getMonth(),
		date2.getDate()
	);
	return Math.round((to - from) / 86400000);
}

export function isValidFormattedDate(value: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) {
		return false;
	}
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(year, month - 1, day);
	return (
		date.getFullYear() === year &&
		date.getMonth() === month - 1 &&
		date.getDate() === day
	);
}

export function toFormattedDate(date: Date) {
	return `${date.getFullYear()}-${
		date.getMonth() < 9 ? "0" + (date.getMonth() + 1) : date.getMonth() + 1
	}-${date.getDate() < 10 ? "0" + date.getDate() : date.getDate()}`;
}

export function toFormattedYearMonth(year: number, month: number) {
	return `${year}-${month < 10 ? "0" + month : month}`;
}

export function getLastDayOfMonth(year: number, month: number) {
	return new Date(year, month + 1, 0).getDate();
}

export function distanceBeforeTheStartOfWeek(
	startOfWeek: number,
	weekDate: number
) {
	return (weekDate - startOfWeek + 7) % 7;
}

export function distanceBeforeTheEndOfWeek(
	startOfWeek: number,
	weekDate: number
) {
	return (startOfWeek - weekDate + 6) % 7;
}

export function isToday(date: Date) {
	const today = new Date();
	return (
		date.getDate() === today.getDate() &&
		date.getMonth() === today.getMonth() &&
		date.getFullYear() === today.getFullYear()
	);
}

/**
 * if years <= 1, then return the first day of the current year and the last day of the current year
 * if years = 2, then return the first day of the last year and the last day of the current year
 */

export function getLatestYearAbsoluteFromAndEnd(years: number) {
	const today = new Date();
	const normalizedYear = years <= 1 ? 1 : years;
	const start = new Date(today.getFullYear() - normalizedYear + 1, 0, 1);
	const end = new Date(today.getFullYear(), 12, 0);
	return {
		start,
		end,
	};
}

/**
 * if months <= 1, then return the first day of the current month and the last day of the current month
 * if months = 2, then return the first day of the last month and the last day of the current month
 */
export function getLatestMonthAbsoluteFromAndEnd(months: number) {
	const today = new Date();
	const normalizedMonth = months <= 1 ? 1 : months;
	const start = new Date(
		today.getFullYear(),
		today.getMonth() - normalizedMonth + 1,
		1
	);
	const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
	return {
		start,
		end,
	};
}
