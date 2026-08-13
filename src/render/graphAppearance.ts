import { GraphAppearance, GraphDensity } from "src/types";

export const DEFAULT_GRAPH_APPEARANCE: GraphAppearance = {
	density: "BALANCED",
	cellGap: 2,
	highlightToday: true,
	highlightWeekends: false,
};

export const GRAPH_DENSITY_PRESETS: Record<
	Exclude<GraphDensity, "CUSTOM">,
	{ width: number; height: number; gap: number }
> = {
	COMPACT: { width: 8, height: 8, gap: 1 },
	BALANCED: { width: 10, height: 10, gap: 2 },
	TOUCH: { width: 14, height: 14, gap: 3 },
};

export function normalizeGraphAppearance(
	appearance?: Partial<GraphAppearance>
): GraphAppearance {
	const density: GraphDensity = [
		"COMPACT",
		"BALANCED",
		"TOUCH",
		"CUSTOM",
	].includes(appearance?.density || "")
		? (appearance?.density as GraphDensity)
		: DEFAULT_GRAPH_APPEARANCE.density;
	const gap = Number.isFinite(appearance?.cellGap)
		? Math.min(8, Math.max(0, Math.round(appearance!.cellGap!)))
		: density === "CUSTOM"
		? DEFAULT_GRAPH_APPEARANCE.cellGap
		: GRAPH_DENSITY_PRESETS[density].gap;
	return {
		density,
		cellGap: gap,
		...(appearance?.emptyCellColor
			? { emptyCellColor: appearance.emptyCellColor }
			: {}),
		highlightToday: appearance?.highlightToday !== false,
		highlightWeekends: appearance?.highlightWeekends === true,
	};
}

export function parsePixelValue(
	value: string | undefined
): number | undefined {
	if (!value) {
		return undefined;
	}
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}
