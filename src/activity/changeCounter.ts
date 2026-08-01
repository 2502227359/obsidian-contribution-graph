import { ChangeSet, Text } from "@codemirror/state";
import { countCharacters, CharacterCountOptions } from "./characterCounter";

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
	options: CharacterCountOptions
): CharacterChangeCount {
	let addedChars = 0;
	let deletedChars = 0;

	changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
		deletedChars += countCharacters(
			startDocument.sliceString(fromA, toA),
			options
		);
		addedChars += countCharacters(inserted.toString(), options);
	});

	return { addedChars, deletedChars };
}
