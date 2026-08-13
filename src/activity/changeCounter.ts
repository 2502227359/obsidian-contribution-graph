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
