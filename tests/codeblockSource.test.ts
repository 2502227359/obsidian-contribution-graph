import { describe, expect, it } from "vitest";
import { createCodeblockYamlEdit } from "../src/view/codeblock/codeblockSource";

function editFor(lines: string[], content = "title: Updated") {
	return createCodeblockYamlEdit(
		(line) => lines[line],
		{ lineStart: 1, lineEnd: lines.length - 2 },
		content
	);
}

describe("safe contributionGraph source edits", () => {
	it("replaces only YAML inside a standard fenced block", () => {
		expect(
			editFor([
				"before",
				"```contributionGraph",
				"title: Old",
				"```",
				"after",
			])
		).toEqual({
			from: { line: 2, ch: 0 },
			to: { line: 3, ch: 0 },
			insert: "title: Updated\n",
		});
	});

	it("preserves indentation and alternate fence styles", () => {
		expect(
			editFor(
				[
					"before",
					"    ~~~~contributionGraph",
					"    title: Old",
					"    ~~~~",
					"after",
				],
				"title: Updated\ndataSource:\n  type: EDIT_ACTIVITY\n"
			)?.insert
		).toBe(
			"    title: Updated\n    dataSource:\n      type: EDIT_ACTIVITY\n"
		);
	});

	it("refuses stale or mismatched source ranges", () => {
		expect(
			editFor([
				"before",
				"```javascript",
				"title: Old",
				"```",
				"after",
			])
		).toBeUndefined();
		expect(
			createCodeblockYamlEdit(
				(line) => ["```contributionGraph", "title: Old"][line],
				{ lineStart: 0, lineEnd: 1 },
				"title: Updated"
			)
		).toBeUndefined();
	});
});
