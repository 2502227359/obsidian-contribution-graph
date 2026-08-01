import { describe, expect, it } from "vitest";
import {
	classifyTrustedInputEvent,
	intentMatchesUserEvent,
} from "../src/activity/trustedInput";

describe("trusted input classification", () => {
	it("recognizes direct text, clipboard, drop, and delete actions", () => {
		expect(
			classifyTrustedInputEvent({
				type: "beforeinput",
				isTrusted: true,
				inputType: "insertText",
			})
		).toBe("TYPE");
		expect(
			classifyTrustedInputEvent({ type: "paste", isTrusted: true })
		).toBe("PASTE");
		expect(
			classifyTrustedInputEvent({ type: "cut", isTrusted: true })
		).toBe("CUT");
		expect(
			classifyTrustedInputEvent({ type: "drop", isTrusted: true })
		).toBe("DROP");
		expect(
			classifyTrustedInputEvent({
				type: "keydown",
				isTrusted: true,
				key: "Backspace",
			})
		).toBe("DELETE_BACKWARD");
	});

	it("rejects synthetic events and modified command shortcuts", () => {
		expect(
			classifyTrustedInputEvent({
				type: "beforeinput",
				isTrusted: false,
				inputType: "insertText",
			})
		).toBeUndefined();
		expect(
			classifyTrustedInputEvent({
				type: "keydown",
				isTrusted: true,
				key: "Enter",
				ctrlKey: true,
			})
		).toBeUndefined();
	});

	it("maps beforeinput variants without leaving duplicate generic intents", () => {
		expect(
			classifyTrustedInputEvent({
				type: "beforeinput",
				isTrusted: true,
				inputType: "insertFromPaste",
			})
		).toBe("PASTE");
		expect(
			classifyTrustedInputEvent({
				type: "beforeinput",
				isTrusted: true,
				inputType: "insertCompositionText",
			})
		).toBe("COMPOSE");
	});
});

describe("trusted intent matching", () => {
	it("only authorizes the matching CodeMirror user event", () => {
		expect(intentMatchesUserEvent("TYPE", "input.type")).toBe(true);
		expect(intentMatchesUserEvent("TYPE", "input.type.compose")).toBe(false);
		expect(intentMatchesUserEvent("TYPE", "input.complete")).toBe(false);
		expect(intentMatchesUserEvent("PASTE", "input.paste")).toBe(true);
		expect(intentMatchesUserEvent("PASTE", "input.type")).toBe(false);
		expect(
			intentMatchesUserEvent("DELETE_BACKWARD", "delete.selection")
		).toBe(true);
	});
});
