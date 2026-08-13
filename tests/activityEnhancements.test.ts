import { describe, expect, it } from "vitest";
import { clampEditPosition } from "../src/activity/editPosition";
import {
	getEditActivityMetricValue,
	sortEditActivityStatsByMetric,
} from "../src/activity/metrics";
import { YamlGraphConfig } from "../src/processor/types";
import {
	applyThemeToGoalHeatScale,
	formatGoalHeatLevelRange,
	updateGoalHeatLevel,
} from "../src/view/form/goalHeatScaleForm";
import {
	applyColorsToCellRules,
	generateSequentialPalette,
} from "../src/view/form/themePalette";
import {
	GRAPH_DENSITY_PRESETS,
	normalizeGraphAppearance,
} from "../src/render/graphAppearance";

describe("edit activity metric details", () => {
	const documents = [
		{
			path: "Mostly deleted.md",
			addedChars: 1,
			deletedChars: 20,
			changedChars: 21,
		},
		{
			path: "Mostly added.md",
			addedChars: 15,
			deletedChars: 2,
			changedChars: 17,
		},
	];

	it("uses the selected metric for values", () => {
		expect(
			getEditActivityMetricValue("ADDED_CHARS", documents[0])
		).toBe(1);
		expect(
			getEditActivityMetricValue("DELETED_CHARS", documents[0])
		).toBe(20);
		expect(
			getEditActivityMetricValue("CHANGED_CHARS", documents[0])
		).toBe(21);
	});

	it("sorts document details using the selected metric", () => {
		expect(
			sortEditActivityStatsByMetric("ADDED_CHARS", documents).map(
				(item) => item.path
			)
		).toEqual(["Mostly added.md", "Mostly deleted.md"]);
		expect(
			sortEditActivityStatsByMetric("DELETED_CHARS", documents).map(
				(item) => item.path
			)
		).toEqual(["Mostly deleted.md", "Mostly added.md"]);
	});
});

describe("historical edit position", () => {
	it("keeps a position that is still valid", () => {
		expect(
			clampEditPosition("first\nsecond line", {
				line: 1,
				column: 4,
			})
		).toEqual({ line: 1, column: 4 });
	});

	it("clamps a stale line and column to the current document", () => {
		expect(
			clampEditPosition("short\nlast", {
				line: 20,
				column: 99,
			})
		).toEqual({ line: 1, column: 4 });
	});
});

describe("goal heat scale validation", () => {
	function configWithHeatScale(heatScale: unknown): YamlGraphConfig {
		return {
			graphType: "default",
			dataSource: {
				type: "EDIT_ACTIVITY",
				metric: "CHANGED_CHARS",
			},
			dateRangeValue: 180,
			dateRangeType: "LATEST_DAYS",
			data: [],
			titleStyle: {},
			fillTheScreen: false,
			startOfWeek: 1,
			showCellRuleIndicators: true,
			heatScale,
		} as YamlGraphConfig;
	}

	it("accepts a valid goal scale", () => {
		expect(() =>
			YamlGraphConfig.validate(
				configWithHeatScale({
					type: "GOAL",
					goal: 1000,
					levels: [
						{ minRatio: 0, color: "#9be9a8" },
						{ minRatio: 1, color: "#216e39" },
					],
				})
			)
		).not.toThrow();
	});

	it.each([
		{
			type: "GOAL",
			goal: 0,
			levels: [{ minRatio: 0, color: "#fff" }],
		},
		{
			type: "GOAL",
			goal: 1000,
			levels: [{ minRatio: 0.25, color: "#fff" }],
		},
		{
			type: "GOAL",
			goal: 1000,
			levels: [{ minRatio: 0, color: "" }],
		},
	])("rejects invalid goal scales", (heatScale) => {
		expect(() =>
			YamlGraphConfig.validate(configWithHeatScale(heatScale))
		).toThrow();
	});
});

describe("goal heat scale form mapping", () => {
	const heatScale = {
		type: "GOAL" as const,
		goal: 1500,
		levels: [
			{ minRatio: 0, color: "#111111" },
			{ minRatio: 0.25, color: "#222222" },
			{ minRatio: 0.6, color: "#333333" },
			{ minRatio: 1, color: "#444444" },
		],
	};
	const themeRules = [
		{ id: "a", min: 1, max: 2, color: "#8dd1e2" },
		{ id: "b", min: 2, max: 3, color: "#63a1be" },
		{ id: "c", min: 3, max: 5, color: "#376d93" },
		{ id: "d", min: 5, max: 9999, color: "#012f60" },
	];

	it("applies theme colors while preserving the goal and ratios", () => {
		const themed = applyThemeToGoalHeatScale(
			heatScale,
			themeRules
		);
		expect(themed.goal).toBe(1500);
		expect(themed.levels.map((level) => level.minRatio)).toEqual([
			0, 0.25, 0.6, 1,
		]);
		expect(themed.levels.map((level) => level.color)).toEqual([
			"#8dd1e2",
			"#63a1be",
			"#376d93",
			"#012f60",
		]);
		expect(heatScale.levels[0].color).toBe("#111111");
	});

	it("updates one custom level without mutating the others", () => {
		const updated = updateGoalHeatLevel(heatScale, 2, {
			color: "#abcdef",
			text: "●",
		});
		expect(updated.levels[2]).toMatchObject({
			minRatio: 0.6,
			color: "#abcdef",
			text: "●",
		});
		expect(updated.levels[1]).toEqual(heatScale.levels[1]);
		expect(heatScale.levels[2].color).toBe("#333333");
	});

	it("formats bounded and open-ended percentage labels", () => {
		expect(formatGoalHeatLevelRange(0.25, 0.6)).toBe("25%–60%");
		expect(formatGoalHeatLevelRange(1)).toBe("≥ 100%");
	});
});

describe("graph appearance helpers", () => {
	it("normalizes defaults and clamps custom gaps", () => {
		expect(normalizeGraphAppearance()).toEqual({
			density: "BALANCED",
			cellGap: GRAPH_DENSITY_PRESETS.BALANCED.gap,
			highlightToday: true,
			highlightWeekends: false,
		});
		expect(
			normalizeGraphAppearance({
				density: "CUSTOM",
				cellGap: 20,
				highlightToday: false,
				highlightWeekends: true,
			})
		).toMatchObject({
			density: "CUSTOM",
			cellGap: 8,
			highlightToday: false,
			highlightWeekends: true,
		});
	});

	it("generates a light-to-dark palette and applies it immutably", () => {
		const colors = generateSequentialPalette("#000");
		expect(colors).toEqual([
			"#b8b8b8",
			"#808080",
			"#424242",
			"#000000",
		]);
		const rules = applyColorsToCellRules([], colors);
		expect(rules.map((rule) => rule.color)).toEqual(colors);
		expect(rules).toHaveLength(4);
	});

	it("rejects malformed appearance settings", () => {
		const config = {
			graphType: "default",
			dataSource: { type: "PAGE", value: "" },
			dateRangeValue: 180,
			dateRangeType: "LATEST_DAYS",
			data: [],
			titleStyle: {},
			fillTheScreen: false,
			startOfWeek: 1,
			showCellRuleIndicators: true,
			appearance: {
				density: "BALANCED",
				cellGap: 9,
				highlightToday: true,
				highlightWeekends: false,
			},
		} as YamlGraphConfig;
		expect(() => YamlGraphConfig.validate(config)).toThrow();
	});
});
