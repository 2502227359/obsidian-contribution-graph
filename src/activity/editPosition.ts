import { EditPosition } from "src/types";

export function clampEditPosition(
	content: string,
	position: EditPosition
): EditPosition {
	const lines = content.split(/\r?\n/);
	const line = Math.min(
		Math.max(0, position.line),
		Math.max(0, lines.length - 1)
	);
	const column = Math.min(
		Math.max(0, position.column),
		(lines[line] || "").length
	);
	return { line, column };
}
