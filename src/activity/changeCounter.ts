import { ChangeSet, EditorState, Text } from "@codemirror/state";
import { countCharacters, CharacterCountOptions } from "./characterCounter";
import {
	collectMarkdownFormattingRanges,
	countDocumentRange,
} from "./markdownSyntaxCounter";

export interface CharacterChangeCount {
	addedChars: number;
	deletedChars: number;
}

export function isCountedUserEvent(event: string): boolean {
	if (!event || event.startsWith("undo") || event.startsWith("redo")) {
		return false;
	}
	return (
		event.startsWith("input") ||
		event.startsWith("delete") ||
		event === "move.drop"
	);
}

export function changesOnlyHighlightMarkers(document: Text, changes: ChangeSet): boolean {
	// 内置高亮命令用 input.type 提交成对标记，保留正文。
	const markers = /^(?:==[🔴🟠🟡🟢🔵🟣]?)*$/u;
	let onlyMarkers = true;
	let removed = 0;
	let inserted = 0;
	changes.iterChanges((from, to, _fromB, _toB, text) => {
		if (!onlyMarkers) return;
		const before = document.sliceString(from, to);
		const after = text.toString();
		onlyMarkers = markers.test(before) && markers.test(after);
		removed += before.match(/==/g)?.length ?? 0;
		inserted += after.match(/==/g)?.length ?? 0;
	});
	return onlyMarkers && removed + inserted > 0 && removed % 2 === 0 && inserted % 2 === 0;
}

export function countChangedCharacters(
	startDocument: Text,
	changes: ChangeSet,
	options: CharacterCountOptions,
	states?: { startState: EditorState; endState: EditorState }
): CharacterChangeCount {
	let addedChars = 0;
	let deletedChars = 0;

	changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
		if (options.excludeMarkdownFormatting && states) {
			deletedChars += countDocumentRange(
				startDocument,
				fromA,
				toA,
				options,
				collectMarkdownFormattingRanges(
					states.startState,
					fromA,
					toA
				)
			);
			addedChars += countDocumentRange(
				states.endState.doc,
				fromB,
				toB,
				options,
				collectMarkdownFormattingRanges(
					states.endState,
					fromB,
					toB
				)
			);
			return;
		}

		deletedChars += countCharacters(
			startDocument.sliceString(fromA, toA),
			options
		);
		addedChars += countCharacters(inserted.toString(), options);
	});

	return { addedChars, deletedChars };
}
