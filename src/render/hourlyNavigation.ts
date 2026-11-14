export function resolveHourNavigation(
	currentHour: number,
	key: string,
	available: readonly number[]
): number | undefined {
	const hours = [...new Set(available)].filter(isValidHour).sort((left, right) => left - right);
	if (!Number.isInteger(currentHour) || hours.length === 0) {
		return undefined;
	}
	if (key === "Home") {
		return hours[0];
	}
	if (key === "End") {
		return hours[hours.length - 1];
	}
	const direction = key === "ArrowDown" || key === "ArrowRight" ? 1 : key === "ArrowUp" || key === "ArrowLeft" ? -1 : 0;
	if (direction === 0) {
		return undefined;
	}
	const ordered = direction > 0 ? hours : [...hours].reverse();
	const next = ordered.find((hour) => direction > 0 ? hour > currentHour : hour < currentHour);
	return next ?? currentHour;
}

function isValidHour(hour: number): boolean {
	return Number.isInteger(hour) && hour >= 0 && hour <= 23;
}
