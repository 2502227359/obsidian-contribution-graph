export type TrustedInputIntent =
	| "TYPE"
	| "COMPOSE"
	| "PASTE"
	| "CUT"
	| "DROP"
	| "DELETE_BACKWARD"
	| "DELETE_FORWARD";

export interface TrustedDomEventLike {
	type: string;
	isTrusted: boolean;
	inputType?: string;
	key?: string;
	ctrlKey?: boolean;
	metaKey?: boolean;
	altKey?: boolean;
}

export function classifyTrustedInputEvent(
	event: TrustedDomEventLike
): TrustedInputIntent | undefined {
	if (!event.isTrusted) {
		return undefined;
	}

	if (event.type === "paste") {
		return "PASTE";
	}
	if (event.type === "cut") {
		return "CUT";
	}
	if (event.type === "drop") {
		return "DROP";
	}
	if (event.type === "beforeinput") {
		switch (event.inputType) {
			case "insertFromPaste":
				return "PASTE";
			case "deleteByCut":
				return "CUT";
			case "insertFromDrop":
			case "deleteByDrag":
				return "DROP";
			case "insertCompositionText":
			case "deleteCompositionText":
				return "COMPOSE";
			case "deleteContentBackward":
				return "DELETE_BACKWARD";
			case "deleteContentForward":
				return "DELETE_FORWARD";
			default:
				return event.inputType?.startsWith("insert")
					? "TYPE"
					: undefined;
		}
	}
	if (
		event.type === "keydown" &&
		!event.ctrlKey &&
		!event.metaKey &&
		!event.altKey
	) {
		switch (event.key) {
			case "Backspace":
				return "DELETE_BACKWARD";
			case "Delete":
				return "DELETE_FORWARD";
			case "Enter":
			case "Tab":
				return "TYPE";
		}
	}
	return undefined;
}

export function intentMatchesUserEvent(
	intent: TrustedInputIntent,
	userEvent: string
): boolean {
	switch (intent) {
		case "TYPE":
			return (
				(userEvent === "input.type" ||
					userEvent.startsWith("input.type.")) &&
				!userEvent.startsWith("input.type.compose")
			);
		case "COMPOSE":
			return userEvent.startsWith("input.type.compose");
		case "PASTE":
			return userEvent === "input.paste";
		case "CUT":
			return (
				userEvent === "delete.cut" ||
				userEvent === "delete.selection"
			);
		case "DROP":
			return userEvent === "input.drop" || userEvent === "move.drop";
		case "DELETE_BACKWARD":
			return (
				userEvent === "delete.backward" ||
				userEvent === "delete.selection"
			);
		case "DELETE_FORWARD":
			return (
				userEvent === "delete.forward" ||
				userEvent === "delete.selection"
			);
	}
}
