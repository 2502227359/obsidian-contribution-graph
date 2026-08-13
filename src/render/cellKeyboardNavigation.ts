export function resolveCellNavigationIndex(
	currentIndex: number,
	cellCount: number,
	key: string
): number | undefined {
	if (cellCount <= 0 || currentIndex < 0 || currentIndex >= cellCount) {
		return undefined;
	}

	let target = currentIndex;
	switch (key) {
		case "ArrowLeft":
			target = currentIndex - 1;
			break;
		case "ArrowRight":
			target = currentIndex + 1;
			break;
		case "ArrowUp":
			target = currentIndex - 7;
			break;
		case "ArrowDown":
			target = currentIndex + 7;
			break;
		case "Home":
			target = 0;
			break;
		case "End":
			target = cellCount - 1;
			break;
		default:
			return undefined;
	}

	return Math.min(Math.max(0, target), cellCount - 1);
}
