import { DateRangeType, YamlGraphConfig } from "./types";
import { createDefaultGoalHeatScale } from "src/constants";
import { normalizeGraphAppearance } from "src/render/graphAppearance";

export class YamlConfigReconciler {
	constructor() {}

	static reconcile(yamlConfig: YamlGraphConfig): YamlGraphConfig {
		return YamlConfigReconciler.reconcile_from_0_4_0(yamlConfig);
	}

	static reconcile_from_0_4_0(yamlConfig: YamlGraphConfig): YamlGraphConfig {
		if (!yamlConfig.dataSource) {
			yamlConfig.dataSource = {
				type: "PAGE",
				value: yamlConfig.query || '""',
				filters: [],
				dateField: {
					type: "PAGE_PROPERTY",
					value: yamlConfig.dateField,
					format: yamlConfig.dateFieldFormat,
				},
				countField: {
					type: "DEFAULT",
				},
			};
		}

		if (!yamlConfig.dateRangeType) {
			const hasLatestDays = yamlConfig.days !== undefined;
			const dateTypeValue: DateRangeType = hasLatestDays
				? "LATEST_DAYS"
				: "FIXED_DATE_RANGE";
			yamlConfig.dateRangeType = dateTypeValue;
		}

		if (!yamlConfig.dateRangeValue) {
			yamlConfig.dateRangeValue = yamlConfig.days;
		}

		if (
			yamlConfig.dataSource?.type === "EDIT_ACTIVITY" &&
			!yamlConfig.heatScale
		) {
			yamlConfig.heatScale = createDefaultGoalHeatScale();
		}
		yamlConfig.appearance = normalizeGraphAppearance(
			yamlConfig.appearance
		);
		if (
			yamlConfig.heatScale?.type === "GOAL" &&
			(!yamlConfig.heatScale.levels ||
				yamlConfig.heatScale.levels.length === 0)
		) {
			yamlConfig.heatScale = createDefaultGoalHeatScale(
				yamlConfig.heatScale.goal || 1000
			);
		}

		yamlConfig.query = undefined;
		yamlConfig.dateField = undefined;
		yamlConfig.dateFieldFormat = undefined;
		return yamlConfig;
	}
}
