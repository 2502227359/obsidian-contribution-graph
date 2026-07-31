import { ChangeSet, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { countCharacters } from "../src/activity/characterCounter";
import {
	countChangedCharacters,
	isCountedUserEvent,
} from "../src/activity/changeCounter";
import {
	migrateDocumentPaths,
	toDailyEditStats,
} from "../src/activity/types";

describe("countCharacters", () => {
	it("counts Chinese, punctuation, and emoji as visible characters", () => {
		expect(
			countCharacters("你好，👨‍👩‍👧‍👦", {
				excludeWhitespace: true,
			})
		).toBe(4);
	});

	it("excludes whitespace by default policy", () => {
		expect(
			countCharacters("a b\n\tc", {
				excludeWhitespace: true,
			})
		).toBe(3);
		expect(
			countCharacters("a b\n\tc", {
				excludeWhitespace: false,
			})
		).toBe(6);
	});
});

describe("user event filtering", () => {
	it.each(["input.type", "input.paste", "delete.backward", "delete.cut"])(
		"counts %s",
		(event) => {
			expect(isCountedUserEvent(event)).toBe(true);
		}
	);

	it.each(["", "undo", "redo", "select.pointer"])("ignores %s", (event) => {
		expect(isCountedUserEvent(event)).toBe(false);
	});
});

describe("countChangedCharacters", () => {
	it("counts replacements as additions plus deletions", () => {
		const document = Text.of(["hello"]);
		const changes = ChangeSet.of(
			[{ from: 0, to: 5, insert: "你好" }],
			document.length
		);
		expect(
			countChangedCharacters(document, changes, {
				excludeWhitespace: true,
			})
		).toEqual({
			addedChars: 2,
			deletedChars: 5,
		});
	});

	it("collapses IME composition updates into the final committed change", () => {
		const document = Text.of([""]);
		const first = ChangeSet.of([{ from: 0, insert: "n" }], 0);
		const second = ChangeSet.of(
			[{ from: 0, to: 1, insert: "ni" }],
			1
		);
		const committed = ChangeSet.of(
			[{ from: 0, to: 2, insert: "你" }],
			2
		);
		const composed = first.compose(second).compose(committed);

		expect(
			countChangedCharacters(document, composed, {
				excludeWhitespace: true,
			})
		).toEqual({
			addedChars: 1,
			deletedChars: 0,
		});
	});
});

describe("toDailyEditStats", () => {
	it("returns document details sorted by changed characters", () => {
		expect(
			toDailyEditStats("2026-07-31", {
				addedChars: 12,
				deletedChars: 5,
				documents: {
					"Notes/Small.md": {
						addedChars: 2,
						deletedChars: 1,
					},
					"Notes/Large.md": {
						addedChars: 7,
						deletedChars: 4,
					},
				},
			})
		).toEqual({
			date: "2026-07-31",
			addedChars: 12,
			deletedChars: 5,
			changedChars: 17,
			unattributedAddedChars: 3,
			unattributedDeletedChars: 0,
			documents: [
				{
					path: "Notes/Large.md",
					addedChars: 7,
					deletedChars: 4,
					changedChars: 11,
				},
				{
					path: "Notes/Small.md",
					addedChars: 2,
					deletedChars: 1,
					changedChars: 3,
				},
			],
		});
	});

	it("preserves the last edit position", () => {
		const stats = toDailyEditStats("2026-07-31", {
			addedChars: 3,
			deletedChars: 0,
			documents: {
				"Notes/Position.md": {
					addedChars: 3,
					deletedChars: 0,
					lastEditPosition: {
						line: 11,
						column: 7,
					},
				},
			},
		});

		expect(stats.documents[0].lastEditPosition).toEqual({
			line: 11,
			column: 7,
		});
	});
});

describe("migrateDocumentPaths", () => {
	it("moves a renamed file and merges an existing historical path", () => {
		const dailyStats = {
			"2026-07-31": {
				addedChars: 12,
				deletedChars: 5,
				documents: {
					"Old.md": {
						addedChars: 3,
						deletedChars: 2,
						lastEditPosition: { line: 4, column: 5 },
					},
					"New.md": {
						addedChars: 2,
						deletedChars: 1,
					},
				},
			},
		};

		expect(
			migrateDocumentPaths(dailyStats, "Old.md", "New.md", false)
		).toEqual(["2026-07-31"]);
		expect(dailyStats["2026-07-31"].documents).toEqual({
			"New.md": {
				addedChars: 5,
				deletedChars: 3,
				lastEditPosition: { line: 4, column: 5 },
			},
		});
	});

	it("moves all document paths under a renamed folder", () => {
		const dailyStats = {
			"2026-07-31": {
				addedChars: 1,
				deletedChars: 0,
				documents: {
					"Old/Sub/Note.md": {
						addedChars: 1,
						deletedChars: 0,
					},
				},
			},
		};

		migrateDocumentPaths(dailyStats, "Old", "Archive", true);
		expect(dailyStats["2026-07-31"].documents).toHaveProperty(
			"Archive/Sub/Note.md"
		);
	});
});
