export interface AiNoteDiffOptions {
	excludeWhitespace: boolean;
	excludeMarkdownFormatting: boolean;
}

export interface AiNoteChanges {
	addedChars: number;
	deletedChars: number;
}

const MAX_GRAPHEME_DISTANCE = 2048;
const MAX_GRAPHEME_COMPARISONS = 4_000_000;
const MAX_LINE_DISTANCE = 4096;
const MAX_LINE_COMPARISONS = 4_000_000;

export function calculateAiNoteChanges(before: string, after: string, options: AiNoteDiffOptions): AiNoteChanges {
	if (before === after) return { addedChars: 0, deletedChars: 0 };
	const normalizedBefore = options.excludeMarkdownFormatting ? stripMarkdownFormatting(before) : before;
	const normalizedAfter = options.excludeMarkdownFormatting ? stripMarkdownFormatting(after) : after;
	return diffStrings(normalizedBefore, normalizedAfter, options.excludeWhitespace);
}

export function stripMarkdownFormatting(markdown: string): string {
	const lines = markdown.split("\n");
	const output: string[] = [];
	let activeFence: { char: string; length: number } | undefined;

	for (const rawLine of lines) {
		const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
		const fenceMatch = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
		if (activeFence) {
			const closing = new RegExp(`^\\s{0,3}${activeFence.char}{${activeFence.length},}\\s*$`);
			if (closing.test(line)) {
				activeFence = undefined;
				output.push("");
				continue;
			}
			output.push(line);
			continue;
		}
		if (fenceMatch) {
			activeFence = { char: fenceMatch[1][0], length: fenceMatch[1].length };
			output.push(fenceMatch[2] ?? "");
			continue;
		}
		if (/^\s{0,3}(?:[-*_]\s*){3,}$/.test(line)) {
			output.push("");
			continue;
		}
		if (/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line)) {
			output.push("");
			continue;
		}
		let current = line;
		current = current.replace(/^(\s{0,3})(?:>\s?)+/, "$1");
		current = current.replace(/^(\s{0,3})#{1,6}(?=\s|$)/, "$1");
		current = current.replace(/^(\s*)(?:[-*+]|\d+[.)])(\s+)(?:\[[ xX]\]\s+)?/, "$1$2");
		output.push(stripInlineMarkdown(current));
	}
	return output.join("\n");
}

function stripInlineMarkdown(line: string): string {
	// Split out inline code spans so delimiters inside `code` remain intact while backticks are stripped.
	const parts: string[] = [];
	let index = 0;
	while (index < line.length) {
		const tick = line.indexOf("`", index);
		if (tick < 0) {
			parts.push(stripInlineOutsideCode(line.slice(index)));
			break;
		}
		let endTicks = tick;
		while (endTicks < line.length && line[endTicks] === "`") endTicks++;
		const fence = line.slice(tick, endTicks);
		const close = line.indexOf(fence, endTicks);
		if (close < 0) {
			parts.push(stripInlineOutsideCode(line.slice(index)));
			break;
		}
		if (tick > index) parts.push(stripInlineOutsideCode(line.slice(index, tick)));
		parts.push(line.slice(endTicks, close));
		index = close + fence.length;
	}
	return parts.join("");
}

function stripInlineOutsideCode(text: string): string {
	let result = text;
	// Table pipes
	result = result.replace(/\|/g, " ");
	// Wiki embeds & links: ![[a|b]] or [[a|b]]
	result = result.replace(/!?\[\[([^\]]+)\]\]/g, "$1");
	// Markdown images & links: ![alt](url) or [label](url)
	result = result.replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, "$1 $2");
	// Colored/plain Obsidian highlights ==🔴text== or ==text==
	result = result.replace(/==[🔴🟠🟡🟢🔵🟣]?/gu, "");
	// Bold / strikethrough / italic markers
	result = result.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "$1");
	result = result.replace(/__(?=\S)([\s\S]*?\S)__/g, "$1");
	result = result.replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1");
	result = result.replace(/\*(?=\S)([^*]*?\S)\*/g, "$1");
	result = result.replace(/(^|[\s(])_(?=\S)([^_]*?\S)_(?=$|[\s.,;:!?)])/g, "$1$2");
	return result;
}

function diffStrings(before: string, after: string, excludeWhitespace: boolean): AiNoteChanges {
	const left = graphemes(before, excludeWhitespace);
	const right = graphemes(after, excludeWhitespace);
	const [lStart, lEnd, rStart, rEnd] = trimCommonEdges(left, right);
	const trimmedLeft = left.slice(lStart, lEnd);
	const trimmedRight = right.slice(rStart, rEnd);
	if (!trimmedLeft.length || !trimmedRight.length) {
		return { addedChars: trimmedRight.length, deletedChars: trimmedLeft.length };
	}
	const leftChars = new Set(trimmedLeft);
	if (!trimmedRight.some(char => leftChars.has(char))) {
		return { addedChars: trimmedRight.length, deletedChars: trimmedLeft.length };
	}
	const exact = minimalEditDistance(trimmedLeft, trimmedRight, MAX_GRAPHEME_DISTANCE, MAX_GRAPHEME_COMPARISONS);
	if (exact !== undefined) {
		const lengthChange = trimmedRight.length - trimmedLeft.length;
		return { addedChars: (exact + lengthChange) / 2, deletedChars: (exact - lengthChange) / 2 };
	}
	return diffByLines(before, after, excludeWhitespace);
}

function diffByLines(before: string, after: string, excludeWhitespace: boolean): AiNoteChanges {
	const leftLines = before.split("\n");
	const rightLines = after.split("\n");
	const [lStart, lEnd, rStart, rEnd] = trimCommonEdges(leftLines, rightLines);
	const midLeft = leftLines.slice(lStart, lEnd);
	const midRight = rightLines.slice(rStart, rEnd);
	const lineOps = computeLineEditScript(midLeft, midRight);
	if (!lineOps) {
		return {
			addedChars: graphemes(midRight.join("\n"), excludeWhitespace).length,
			deletedChars: graphemes(midLeft.join("\n"), excludeWhitespace).length,
		};
	}

	let addedChars = 0;
	let deletedChars = 0;
	let removedHunk: string[] = [];
	let addedHunk: string[] = [];
	const flushHunk = () => {
		if (!removedHunk.length && !addedHunk.length) return;
		const hunk = diffHunk(removedHunk.join("\n"), addedHunk.join("\n"), excludeWhitespace);
		addedChars += hunk.addedChars;
		deletedChars += hunk.deletedChars;
		removedHunk = [];
		addedHunk = [];
	};

	for (const op of lineOps) {
		if (op.type === "equal") {
			flushHunk();
		} else if (op.type === "delete") {
			removedHunk.push(op.value);
		} else {
			addedHunk.push(op.value);
		}
	}
	flushHunk();
	return { addedChars, deletedChars };
}

function diffHunk(beforeText: string, afterText: string, excludeWhitespace: boolean): AiNoteChanges {
	const left = graphemes(beforeText, excludeWhitespace);
	const right = graphemes(afterText, excludeWhitespace);
	const [lStart, lEnd, rStart, rEnd] = trimCommonEdges(left, right);
	const trimmedLeft = left.slice(lStart, lEnd);
	const trimmedRight = right.slice(rStart, rEnd);
	if (!trimmedLeft.length || !trimmedRight.length) {
		return { addedChars: trimmedRight.length, deletedChars: trimmedLeft.length };
	}
	const exact = minimalEditDistance(trimmedLeft, trimmedRight, MAX_GRAPHEME_DISTANCE, MAX_GRAPHEME_COMPARISONS);
	if (exact !== undefined) {
		const lengthChange = trimmedRight.length - trimmedLeft.length;
		return { addedChars: (exact + lengthChange) / 2, deletedChars: (exact - lengthChange) / 2 };
	}
	return { addedChars: trimmedRight.length, deletedChars: trimmedLeft.length };
}

function trimCommonEdges<T>(left: readonly T[], right: readonly T[]): [number, number, number, number] {
	let start = 0;
	const minLength = Math.min(left.length, right.length);
	while (start < minLength && left[start] === right[start]) start++;
	let lEnd = left.length;
	let rEnd = right.length;
	while (lEnd > start && rEnd > start && left[lEnd - 1] === right[rEnd - 1]) {
		lEnd--;
		rEnd--;
	}
	return [start, lEnd, start, rEnd];
}

function minimalEditDistance<T>(left: readonly T[], right: readonly T[], maxDistance: number, maxComparisons: number): number | undefined {
	const limit = Math.min(left.length + right.length, maxDistance);
	const center = limit + 1;
	const frontier = new Int32Array(center * 2 + 1);
	let comparisons = 0;
	for (let distance = 0; distance <= limit; distance++) {
		for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
			const index = center + diagonal;
			let x = diagonal === -distance || (diagonal !== distance && frontier[index - 1] < frontier[index + 1])
				? frontier[index + 1] : frontier[index - 1] + 1;
			let y = x - diagonal;
			while (x < left.length && y < right.length && left[x] === right[y]) {
				if (++comparisons > maxComparisons) return undefined;
				x++;
				y++;
			}
			if (x >= left.length && y >= right.length) return distance;
			frontier[index] = x;
		}
	}
	return undefined;
}

type LineOp = { type: "equal" | "insert" | "delete"; value: string };

function computeLineEditScript(left: readonly string[], right: readonly string[]): LineOp[] | undefined {
	const limit = Math.min(left.length + right.length, MAX_LINE_DISTANCE);
	const center = limit + 1;
	const frontier = new Int32Array(center * 2 + 1);
	const trace: Int32Array[] = [];
	let comparisons = 0;

	for (let distance = 0; distance <= limit; distance++) {
		trace.push(frontier.slice());
		for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
			const index = center + diagonal;
			let x = diagonal === -distance || (diagonal !== distance && frontier[index - 1] < frontier[index + 1])
				? frontier[index + 1] : frontier[index - 1] + 1;
			let y = x - diagonal;
			while (x < left.length && y < right.length && left[x] === right[y]) {
				if (++comparisons > MAX_LINE_COMPARISONS) return undefined;
				x++;
				y++;
			}
			frontier[index] = x;
			if (x >= left.length && y >= right.length) {
				return backtrackLineOps(left, right, trace, center, distance);
			}
		}
	}
	return undefined;
}

function backtrackLineOps(
	left: readonly string[],
	right: readonly string[],
	trace: readonly Int32Array[],
	center: number,
	finalDistance: number,
): LineOp[] {
	const ops: LineOp[] = [];
	let x = left.length;
	let y = right.length;
	for (let distance = finalDistance; distance > 0; distance--) {
		const previous = trace[distance];
		const diagonal = x - y;
		const index = center + diagonal;
		const prevDiagonal = diagonal === -distance || (diagonal !== distance && previous[index - 1] < previous[index + 1])
			? diagonal + 1 : diagonal - 1;
		const prevX = previous[center + prevDiagonal];
		const prevY = prevX - prevDiagonal;
		while (x > prevX && y > prevY) {
			ops.push({ type: "equal", value: left[x - 1] });
			x--;
			y--;
		}
		if (x === prevX) {
			ops.push({ type: "insert", value: right[y - 1] });
			y--;
		} else {
			ops.push({ type: "delete", value: left[x - 1] });
			x--;
		}
	}
	while (x > 0 && y > 0) {
		ops.push({ type: "equal", value: left[x - 1] });
		x--;
		y--;
	}
	return ops.reverse();
}

const cachedGraphemeSegmenter = (() => {
	const Segmenter = (Intl as unknown as {
		Segmenter?: new (locale?: string, options?: { granularity: "grapheme" }) => {
			segment(input: string): Iterable<{ segment: string }>;
		};
	}).Segmenter;
	return Segmenter ? new Segmenter(undefined, { granularity: "grapheme" }) : null;
})();

function graphemes(value: string, excludeWhitespace: boolean): string[] {
	const characters: string[] = [];
	if (cachedGraphemeSegmenter) {
		for (const item of cachedGraphemeSegmenter.segment(value)) {
			if (!excludeWhitespace || item.segment.trim().length > 0) characters.push(item.segment);
		}
		return characters;
	}
	for (const char of value) {
		if (!excludeWhitespace || char.trim().length > 0) characters.push(char);
	}
	return characters;
}
