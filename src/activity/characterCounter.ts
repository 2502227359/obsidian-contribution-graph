export interface CharacterCountOptions {
	excludeWhitespace: boolean;
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

	const segments = graphemeSegmenter
		? Array.from(graphemeSegmenter.segment(text), (item) => item.segment)
		: Array.from(text);

	if (!options.excludeWhitespace) {
		return segments.length;
	}

	return segments.reduce(
		(count, segment) => count + (segment.trim().length > 0 ? 1 : 0),
		0
	);
}
