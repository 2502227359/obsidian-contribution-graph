import { DEFAULT_RULES } from "src/constants";
import { CellStyleRule } from "src/types";

const DEFAULT_WHITE_MIXES = [0.72, 0.5, 0.26, 0];

export function generateSequentialPalette(
	baseColor: string,
	colorCount = DEFAULT_RULES.length
): string[] {
	const count = normalizeColorCount(colorCount);
	const normalized = normalizeHexColor(baseColor);
	if (!normalized) {
		return resamplePalette(
			DEFAULT_RULES.map((rule) => rule.color),
			count
		);
	}
	if (count === 1) {
		return [normalized];
	}
	return resampleNumbers(DEFAULT_WHITE_MIXES, count).map((whiteRatio) =>
		mixWithWhite(normalized, whiteRatio)
	);
}

export function resamplePalette(
	colors: string[],
	colorCount: number
): string[] {
	const count = normalizeColorCount(colorCount);
	if (colors.length === 0) {
		return [];
	}
	if (count === 1) {
		return [colors[colors.length - 1]];
	}
	if (colors.length === 1) {
		return Array.from({ length: count }, () => colors[0]);
	}
	if (colors.length === count) {
		return [...colors];
	}

	return Array.from({ length: count }, (_, index) => {
		const position = (index / (count - 1)) * (colors.length - 1);
		const lowerIndex = Math.floor(position);
		const upperIndex = Math.min(colors.length - 1, Math.ceil(position));
		if (lowerIndex === upperIndex) {
			return colors[lowerIndex];
		}
		return (
			mixHexColors(
				colors[lowerIndex],
				colors[upperIndex],
				position - lowerIndex
			) || colors[lowerIndex]
		);
	});
}

export function darkenHexColor(color: string, ratio = 0.16): string {
	return mixHexColors(color, "#000000", ratio) || color;
}

export function applyColorsToCellRules(
	rules: CellStyleRule[],
	colors: string[]
): CellStyleRule[] {
	if (colors.length === 0) {
		return rules.map((rule) => ({ ...rule }));
	}
	const source = rules.length > 0 ? rules : DEFAULT_RULES;
	const palette = resamplePalette(colors, source.length);
	return source.map((rule, index) => ({
		...rule,
		color: palette[index],
	}));
}

export function normalizeHexColor(color: string): string | undefined {
	const value = color.trim();
	if (/^#[0-9a-fA-F]{3}$/.test(value)) {
		return `#${value
			.slice(1)
			.split("")
			.map((part) => `${part}${part}`)
			.join("")}`.toLowerCase();
	}
	if (/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value)) {
		return value.slice(0, 7).toLowerCase();
	}
	return undefined;
}

function mixWithWhite(color: string, whiteRatio: number): string {
	const channels = [1, 3, 5].map((offset) =>
		Number.parseInt(color.slice(offset, offset + 2), 16)
	);
	return `#${channels
		.map((channel) =>
			Math.round(channel + (255 - channel) * whiteRatio)
				.toString(16)
				.padStart(2, "0")
		)
		.join("")}`;
}

function mixHexColors(
	fromColor: string,
	toColor: string,
	ratio: number
): string | undefined {
	const from = parseHexColor(fromColor);
	const to = parseHexColor(toColor);
	if (!from || !to) {
		return undefined;
	}
	const weight = Math.max(0, Math.min(1, ratio));
	return `#${from
		.map((channel, index) =>
			Math.round(channel + (to[index] - channel) * weight)
				.toString(16)
				.padStart(2, "0")
		)
		.join("")}`;
}

function parseHexColor(color: string): number[] | undefined {
	const normalized = normalizeHexColor(color);
	if (!normalized) {
		return undefined;
	}
	return [1, 3, 5].map((offset) =>
		Number.parseInt(normalized.slice(offset, offset + 2), 16)
	);
}

function resampleNumbers(values: number[], count: number): number[] {
	if (count === 1) {
		return [values[values.length - 1]];
	}
	return Array.from({ length: count }, (_, index) => {
		const position = (index / (count - 1)) * (values.length - 1);
		const lowerIndex = Math.floor(position);
		const upperIndex = Math.min(values.length - 1, Math.ceil(position));
		if (lowerIndex === upperIndex) {
			return values[lowerIndex];
		}
		return (
			values[lowerIndex] +
			(values[upperIndex] - values[lowerIndex]) *
				(position - lowerIndex)
		);
	});
}

function normalizeColorCount(colorCount: number): number {
	if (!Number.isFinite(colorCount)) {
		return DEFAULT_RULES.length;
	}
	return Math.max(1, Math.floor(colorCount));
}
