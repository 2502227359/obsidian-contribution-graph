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

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
