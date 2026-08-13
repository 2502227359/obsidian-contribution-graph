import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState, Text } from "@codemirror/state";
import { CharacterCountOptions, countCharacters } from "./characterCounter";

export interface TextRange {
	from: number;
	to: number;
}

const MARKDOWN_MARK_NODES = new Set([
	"HeaderMark",
	"QuoteMark",
	"ListMark",
	"LinkMark",
	"EmphasisMark",
	"CodeMark",
	"StrikethroughMark",
	"TaskMarker",
	"TableDelimiter",
	"SuperscriptMark",
	"SubscriptMark",
	"HighlightMark",
	"HorizontalRule",
]);

/**
 * Only exclude parser nodes that represent formatting delimiters. Content
 * nodes (including code text, URLs, link labels, and ordinary punctuation)
 * deliberately remain countable.
 */
export function isMarkdownFormattingNode(nodeName: string): boolean {
	return MARKDOWN_MARK_NODES.has(nodeName) || nodeName.endsWith("Mark");
}

export function mergeTextRanges(ranges: TextRange[]): TextRange[] {
	if (ranges.length < 2) {
		return ranges;
	}

	const sorted = [...ranges].sort(
		(a, b) => a.from - b.from || a.to - b.to
	);
	const merged: TextRange[] = [{ ...sorted[0] }];
	for (let index = 1; index < sorted.length; index++) {
		const range = sorted[index];
		const previous = merged[merged.length - 1];
		if (range.from <= previous.to) {
			previous.to = Math.max(previous.to, range.to);
		} else {
			merged.push({ ...range });
		}
	}
	return merged;
}

export function collectMarkdownFormattingRanges(
	state: EditorState,
	from: number,
	to: number
): TextRange[] {
	if (from >= to) {
		return [];
	}

	const ranges: TextRange[] = [];
	try {
		const tree = ensureSyntaxTree(state, to, 20) || syntaxTree(state);
		tree.iterate({
			from,
			to,
			enter(node) {
				if (!isMarkdownFormattingNode(node.type.name)) {
					return;
				}
				const clippedFrom = Math.max(from, node.from);
				const clippedTo = Math.min(to, node.to);
				if (clippedFrom < clippedTo) {
					ranges.push({ from: clippedFrom, to: clippedTo });
				}
				return false;
			},
		});
	} catch (error) {
		// Some third-party editor modes may expose no compatible Markdown
		// parser. Counting normally is safer than silently losing user text.
		console.debug("Unable to inspect Markdown formatting", error);
		return [];
	}
	return mergeTextRanges(ranges);
}

export function countDocumentRange(
	document: Text,
	from: number,
	to: number,
	options: CharacterCountOptions,
	excludedRanges: TextRange[] = []
): number {
	if (from >= to) {
		return 0;
	}

	let count = 0;
	let cursor = from;
	for (const range of mergeTextRanges(
		excludedRanges
			.map((item) => ({
				from: Math.max(from, item.from),
				to: Math.min(to, item.to),
			}))
			.filter((item) => item.from < item.to)
	)) {
		if (cursor < range.from) {
			count += countCharacters(
				document.sliceString(cursor, range.from),
				options
			);
		}
		cursor = Math.max(cursor, range.to);
	}
	if (cursor < to) {
		count += countCharacters(document.sliceString(cursor, to), options);
	}
	return count;
}
