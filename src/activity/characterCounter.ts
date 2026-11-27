export interface CharacterCountOptions {
	excludeWhitespace: boolean;
	excludeMarkdownFormatting?: boolean;
}

interface Segment {
	segment: string;
}

interface SegmenterLike {
	segment(input: string): Iterable<Segment>;
}

function createSegmenter(): SegmenterLike | null {
	const Segmenter = (Intl as unknown as {
		Segmenter?: new (
			locale?: string,
			options?: { granularity: "grapheme" }
		) => SegmenterLike;
	}).Segmenter;

	return Segmenter
		? new Segmenter(undefined, { granularity: "grapheme" })
		: null;
}

const graphemeSegmenter = createSegmenter();

export function countCharacters(
	text: string,
	options: CharacterCountOptions
): number {
	if (!text) {
		return 0;
	}

	let count = 0;
	if (graphemeSegmenter) {
		if (!options.excludeWhitespace) {
			for (const _item of graphemeSegmenter.segment(text)) count++;
			return count;
		}
		for (const item of graphemeSegmenter.segment(text)) {
			if (item.segment.trim().length > 0) count++;
		}
		return count;
	}

	if (!options.excludeWhitespace) {
		for (const _char of text) count++;
		return count;
	}
	for (const char of text) {
		if (char.trim().length > 0) count++;
	}
	return count;
}
