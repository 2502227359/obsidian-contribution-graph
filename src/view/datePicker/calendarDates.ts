import {
	getLastDayOfMonth,
	isValidFormattedDate,
	parseDate,
	toFormattedDate,
} from "../../util/dateUtils";

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY_KEY_OFFSETS: Record<string, number> = {
	ArrowLeft: -1,
	ArrowRight: 1,
	ArrowUp: -7,
	ArrowDown: 7,
};

function isValidMonth(value: string): boolean {
	return MONTH_PATTERN.test(value) && isValidFormattedDate(`${value}-01`);
}

function addCalendarDays(value: string, amount: number): string {
	const date = parseDate(value);
	date.setDate(date.getDate() + amount);
	return toFormattedDate(date);
}

function getWeekBoundary(value: string, offset: number): string {
	const date = parseDate(value);
	const mondayOffset = (date.getDay() + 6) % 7;
	return addCalendarDays(value, offset === 0 ? -mondayOffset : 6 - mondayOffset);
}

function getKeyTarget(
	date: string,
	key: string,
	shiftKey: boolean
): { target: string; direction: number } | undefined {
	const dayOffset = DAY_KEY_OFFSETS[key];
	if (dayOffset !== undefined) {
		return { target: addCalendarDays(date, dayOffset), direction: dayOffset };
	}
	if (key === "Home") {
		return { target: getWeekBoundary(date, 0), direction: -1 };
	}
	if (key === "End") {
		return { target: getWeekBoundary(date, 1), direction: 1 };
	}
	if (key === "PageUp" || key === "PageDown") {
		const amount = (shiftKey ? 12 : 1) * (key === "PageUp" ? -1 : 1);
		return { target: shiftCalendarMonth(date, amount), direction: amount };
	}
	return undefined;
}

function getAllowedDates(dates: readonly string[]): string[] {
	return [...new Set(dates.filter(isValidFormattedDate))].sort();
}

function findAllowedDate(
	target: string,
	direction: number,
	allowedDates: readonly string[]
): string {
	if (allowedDates.includes(target)) {
		return target;
	}
	if (direction > 0) {
		return (
			allowedDates.find((date) => date > target) ??
			allowedDates[allowedDates.length - 1]
		);
	}
	for (let index = allowedDates.length - 1; index >= 0; index -= 1) {
		if (allowedDates[index] < target) {
			return allowedDates[index];
		}
	}
	return allowedDates[0];
}

export function getCalendarDates(month: string): string[] {
	if (!isValidMonth(month)) {
		return [];
	}
	const [year, monthNumber] = month.split("-").map(Number);
	const first = new Date(year, monthNumber - 1, 1);
	first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
	return Array.from({ length: 42 }, (_, index) => {
		const date = new Date(first);
		date.setDate(first.getDate() + index);
		return toFormattedDate(date);
	});
}

export function shiftCalendarMonth(date: string, amount: number): string {
	if (!isValidFormattedDate(date) || !Number.isSafeInteger(amount)) {
		return date;
	}
	const source = parseDate(date);
	const target = new Date(source.getFullYear(), source.getMonth() + amount, 1);
	if (Number.isNaN(target.getTime())) {
		return date;
	}
	target.setDate(
		Math.min(
			source.getDate(),
			getLastDayOfMonth(target.getFullYear(), target.getMonth())
		)
	);
	return toFormattedDate(target);
}

export function resolveCalendarKey(
	date: string,
	key: string,
	options: { dates: readonly string[]; shiftKey?: boolean }
): string | undefined {
	const allowedDates = getAllowedDates(options.dates);
	if (!allowedDates.length || !isValidFormattedDate(date)) {
		return undefined;
	}
	const keyTarget = getKeyTarget(date, key, options.shiftKey === true);
	return keyTarget
		? findAllowedDate(keyTarget.target, keyTarget.direction, allowedDates)
		: undefined;
}
