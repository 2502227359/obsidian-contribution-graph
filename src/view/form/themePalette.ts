import { DEFAULT_RULES } from "src/constants";
import { CellStyleRule } from "src/types";

export function generateSequentialPalette(baseColor: string): string[] {
	const normalized = normalizeHexColor(baseColor);
	if (!normalized) {
		return DEFAULT_RULES.map((rule) => rule.color);
	}
	return [0.72, 0.5, 0.26, 0].map((whiteRatio) =>
		mixWithWhite(normalized, whiteRatio)
	);
}

export function applyColorsToCellRules(
	rules: CellStyleRule[],
	colors: string[]
): CellStyleRule[] {
	if (colors.length === 0) {
		return rules.map((rule) => ({ ...rule }));
	}
	const source = rules.length > 0 ? rules : DEFAULT_RULES;
	return source.map((rule, index) => ({
		...rule,
		color: colors[Math.min(index, colors.length - 1)],
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
