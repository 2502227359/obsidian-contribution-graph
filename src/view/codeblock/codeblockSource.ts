export interface CodeblockSectionRange {
	lineStart: number;
	lineEnd: number;
}

export interface CodeblockYamlEdit {
	from: { line: number; ch: number };
	to: { line: number; ch: number };
	insert: string;
}

/**
 * Build a conservative editor change for a rendered contributionGraph block.
 * The source fence itself is preserved so backticks, tildes, indentation, and
 * blockquote prefixes are never reconstructed from DOM offsets.
 */
export function createCodeblockYamlEdit(
	getLine: (line: number) => string,
	section: CodeblockSectionRange,
	content: string
): CodeblockYamlEdit | undefined {
	if (
		!Number.isSafeInteger(section.lineStart) ||
		!Number.isSafeInteger(section.lineEnd) ||
		section.lineStart < 0 ||
		section.lineEnd <= section.lineStart
	) {
		return undefined;
	}

	const openingLine = getLine(section.lineStart);
	const opening = /^(\s*(?:>\s*)*)(`{3,}|~{3,})\s*contributionGraph(?:\s+.*)?$/i.exec(
		openingLine
	);
	if (!opening) {
		return undefined;
	}

	const prefix = opening[1];
	const fence = opening[2];
	const closingLine = getLine(section.lineEnd);
	const closing = new RegExp(
		`^${escapeRegExp(prefix)}${escapeRegExp(fence[0])}{${
			fence.length
		},}\\s*$`
	);
	if (!closing.test(closingLine)) {
		return undefined;
	}

	const normalizedContent = content
		.replace(/\r\n?/g, "\n")
		.replace(/\n+$/g, "");
	const insert = normalizedContent
		.split("\n")
		.map((line) => `${prefix}${line}`)
		.join("\n");

	return {
		from: { line: section.lineStart + 1, ch: 0 },
		to: { line: section.lineEnd, ch: 0 },
		insert: `${insert}\n`,
	};
}

/** 在已读入的正文中应用保守的代码块替换，并保留原文件换行符。 */
export function applyCodeblockYamlEdit(
	source: string,
	section: CodeblockSectionRange,
	content: string
): string | undefined {
	const lines = source.split(/\r\n|\n|\r/);
	const edit = createCodeblockYamlEdit((line) => lines[line], section, content);
	if (!edit) {
		return undefined;
	}
	const breaks = [...source.matchAll(/\r\n|\n|\r/g)];
	const offsets = [0, ...breaks.map(match => match.index! + match[0].length)];
	const newline = breaks[section.lineStart]?.[0] || "\n";
	return source.slice(0, offsets[edit.from.line]) +
		edit.insert.replace(/\n/g, newline) + source.slice(offsets[edit.to.line]);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
