export interface HourlyNavigationPosition {
	day: number;
	hour: number;
}

export interface HourlyNavigationCellState extends HourlyNavigationPosition {
	available: boolean;
	selected?: boolean;
}

export function chooseInitialHourlyPosition(
	cells: readonly HourlyNavigationCellState[]
): HourlyNavigationPosition | undefined {
	const available = cells.filter((cell) => cell.available);
	const selected = available.find((cell) => cell.selected);
	const initial = selected || available[available.length - 1];
	return initial ? { day: initial.day, hour: initial.hour } : undefined;
}

/**
 * 处理日期与小时网格的二维键盘移动。
 * 横轴为日期，纵轴为小时。
 */
export function resolveHourlyNavigation(
	current: HourlyNavigationPosition,
	dayCount: number,
	key: string,
	isAvailable: (position: HourlyNavigationPosition) => boolean = () => true
): HourlyNavigationPosition | undefined {
	if (!isValidHourlyPosition(current, dayCount)) {
		return undefined;
	}
	const target = getHourlyNavigationTarget(current, dayCount, key);
	if (!target) {
		return undefined;
	}
	if (isAvailable(target)) {
		return target;
	}
	return findAvailableHourlyPosition(target, dayCount, key, isAvailable);
}

function isValidHourlyPosition(
	position: HourlyNavigationPosition,
	dayCount: number
): boolean {
	return (
		dayCount > 0 &&
		Number.isInteger(position.day) &&
		Number.isInteger(position.hour) &&
		position.day >= 0 &&
		position.day < dayCount &&
		position.hour >= 0 &&
		position.hour <= 23
	);
}

function getNavigationDelta(key: string): HourlyNavigationPosition | undefined {
	switch (key) {
		case "ArrowLeft":
			return { day: -1, hour: 0 };
		case "ArrowRight":
			return { day: 1, hour: 0 };
		case "ArrowUp":
			return { day: 0, hour: -1 };
		case "ArrowDown":
			return { day: 0, hour: 1 };
		default:
			return undefined;
	}
}

function getHourlyNavigationTarget(
	current: HourlyNavigationPosition,
	dayCount: number,
	key: string
): HourlyNavigationPosition | undefined {
	if (key === "Home") {
		return { day: 0, hour: 0 };
	}
	if (key === "End") {
		return { day: dayCount - 1, hour: 23 };
	}
	const delta = getNavigationDelta(key);
	if (!delta) {
		return undefined;
	}
	return {
		day: Math.min(Math.max(0, current.day + delta.day), dayCount - 1),
		hour: Math.min(Math.max(0, current.hour + delta.hour), 23),
	};
}

function findAvailableHourlyPosition(
	target: HourlyNavigationPosition,
	dayCount: number,
	key: string,
	isAvailable: (position: HourlyNavigationPosition) => boolean
): HourlyNavigationPosition | undefined {
	const delta = getNavigationDelta(key);
	if (!delta) {
		return undefined;
	}
	let candidate = target;
	while (true) {
		candidate = {
			day: candidate.day + delta.day,
			hour: candidate.hour + delta.hour,
		};
		if (!isValidHourlyPosition(candidate, dayCount)) {
			return undefined;
		}
		if (isAvailable(candidate)) {
			return candidate;
		}
	}
}
