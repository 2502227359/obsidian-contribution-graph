import { describe, expect, it } from "vitest";
import {
	applyCodeblockYamlEdit,
	createCodeblockYamlEdit,
} from "../src/view/codeblock/codeblockSource";

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

	it("在预览模式按原换行符只替换代码块正文", () => {
		const source = [
			"# 标题",
			"",
			"```contributionGraph",
			"title: Old",
			"```",
			"",
			"正文中的 ```javascript 不能动",
		].join("\r\n");
		expect(
			applyCodeblockYamlEdit(
				source,
				{ lineStart: 2, lineEnd: 4 },
				"title: Updated\ndataSource:\n  type: TIME_ACTIVITY\n"
			)
		).toBe(
			[
				"# 标题",
				"",
				"```contributionGraph",
				"title: Updated",
				"dataSource:",
				"  type: TIME_ACTIVITY",
				"```",
				"",
				"正文中的 ```javascript 不能动",
			].join("\r\n")
		);
	});

	it("保留代码块外混合换行，并拒绝过期范围", () => {
		const source = "标题\r\n```contributionGraph\ntitle: Old\n```\r\n正文\n";
		expect(applyCodeblockYamlEdit(source, {lineStart: 1, lineEnd: 3}, "title: New"))
			.toBe("标题\r\n```contributionGraph\ntitle: New\n```\r\n正文\n");
		expect(applyCodeblockYamlEdit(source, {lineStart: 0, lineEnd: 3}, "title: New"))
			.toBeUndefined();
	});
});
