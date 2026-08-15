import { isZh } from "src/i18/messages";
import { DataSource } from "src/query/types";
import {
	Contribution,
	CellStyleRule,
	ContributionGraphConfig,
	GoalHeatScale,
	GraphAppearance,
	TrackingPeriod,
	CollectionScopePeriod,
} from "src/types";
import { DEFAULT_GRAPH_APPEARANCE } from "src/render/graphAppearance";
import { MAX_GOAL_HEAT_LEVELS } from "src/constants";
import {
	MISS_CONFIG,
	MISS_DATASOURCE_OR_DATA,
	INVALID_GRAPH_TYPE,
	MISS_DAYS_OR_RANGE_DATE,
	INVALID_DATE_FORMAT,
	INVALID_DATE_RANGE,
	INVALID_START_OF_WEEK,
	INVALID_HEAT_SCALE,
} from "./bizErrors";
import { GraphProcessError } from "./graphProcessError";
import {
	getLatestMonthAbsoluteFromAndEnd,
	getLatestYearAbsoluteFromAndEnd,
	diffCalendarDays,
	isValidFormattedDate,
	parseDate,
	toFormattedDate,
} from "src/util/dateUtils";

const MAX_GRAPH_DAYS = 3650;
const MAX_GRAPH_MONTHS = 120;
const MAX_GRAPH_YEARS = 10;

export class YamlGraphConfig {
	/**
	 * basic settings
	 */
	title?: string;
	graphType: string;
	dataSource: DataSource;
	dateRangeValue?: number;
	dateRangeType?: DateRangeType;
	fromDate?: string;
	toDate?: string;
	data: Contribution[];

	/**
	 * style settings
	 */
	titleStyle: Partial<CSSStyleDeclaration>;
	fillTheScreen: boolean;
	startOfWeek: number;
	enableMainContainerShadow?: boolean;
	showCellRuleIndicators: boolean;
	mainContainerStyle?: Partial<CSSStyleDeclaration>;
	cellStyle?: Partial<CSSStyleDeclaration>;
	cellStyleRules?: CellStyleRule[];
	heatScale?: GoalHeatScale;
	appearance?: GraphAppearance;
	trackingPeriods?: TrackingPeriod[];
	collectionScopePeriods?: CollectionScopePeriod[];
	activityFolders?: string[];
	valueUnit?: string;

	// deprecated
	days?: number;
	query?: string;
	dateField?: string;
	dateFieldFormat?: string;

	constructor() {
		this.title = "Contributions";
		this.graphType = "default";
		this.dateRangeValue = 180;
		this.dateRangeType = "LATEST_DAYS";
		this.startOfWeek = isZh() ? 1 : 0;
		this.showCellRuleIndicators = true;
		this.titleStyle = {
			textAlign: "left",
			fontSize: "1.5em",
			fontWeight: "normal",
		};
		this.dataSource = {
			type: "PAGE",
			value: "",
			dateField: {},
		} as DataSource;
		this.fillTheScreen = false;
		this.enableMainContainerShadow = false;
		this.appearance = { ...DEFAULT_GRAPH_APPEARANCE };

		// deprecated
		this.query = undefined;
		this.dateFieldFormat = undefined;
		this.dateField = undefined;
		this.days = undefined;
	}

	static toContributionGraphConfig(
		config: YamlGraphConfig
	): ContributionGraphConfig {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { query, dateField, ...rest } = config;
		
		if (config.dateRangeType != "FIXED_DATE_RANGE") {
			if (config.dateRangeType == "LATEST_DAYS") {
				return {
					days: config.dateRangeValue,
					...rest,
				} as ContributionGraphConfig;
			}

			if (config.dateRangeType == "LATEST_MONTH") {
				const { start, end } = getLatestMonthAbsoluteFromAndEnd(
					config.dateRangeValue || 0
				);
				return {
					...rest,
					days: undefined,
					fromDate: toFormattedDate(start),
					toDate: toFormattedDate(end),
				} as ContributionGraphConfig;
			}

			if (config.dateRangeType == "LATEST_YEAR") {
				const { start, end } = getLatestYearAbsoluteFromAndEnd(
					config.dateRangeValue || 0
				);
				return {
					...rest,
					days: undefined,
					fromDate: toFormattedDate(start),
					toDate: toFormattedDate(end),
				} as ContributionGraphConfig;
			}
		}
		return rest as ContributionGraphConfig;
	}

	static validate(config: YamlGraphConfig): void {
		if (!config) {
			throw new GraphProcessError(MISS_CONFIG());
		}
		if (!config.dataSource && !config.data) {
			throw new GraphProcessError(MISS_DATASOURCE_OR_DATA());
		}

		if (config.graphType) {
			const graphTypes = ["default", "month-track", "calendar"];
			if (!graphTypes.includes(config.graphType)) {
				throw new GraphProcessError(
					INVALID_GRAPH_TYPE(config.graphType)
				);
			}
		}

		if (!config.dateRangeValue) {
			if (!config.fromDate || !config.toDate) {
				throw new GraphProcessError(MISS_DAYS_OR_RANGE_DATE());
			}
		}
		if (
			config.dataSource?.type === "EDIT_ACTIVITY" &&
			config.dataSource.folders !== undefined &&
			(!Array.isArray(config.dataSource.folders) ||
				config.dataSource.folders.length > 100 ||
				config.dataSource.folders.some(
					(folder) =>
						typeof folder !== "string" ||
						folder.trim().length === 0 ||
						folder.length > 1024 ||
						folder.includes("\u0000")
				))
		) {
			throw new GraphProcessError({
				summary: "Invalid edit activity folder filter",
			});
		}

		if (config.dateRangeValue !== undefined) {
			if (
				!Number.isSafeInteger(config.dateRangeValue) ||
				config.dateRangeValue <= 0
			) {
				throw new GraphProcessError(
					INVALID_DATE_RANGE("value must be a positive integer")
				);
			}
			const limit =
				config.dateRangeType === "LATEST_MONTH"
					? MAX_GRAPH_MONTHS
					: config.dateRangeType === "LATEST_YEAR"
					? MAX_GRAPH_YEARS
					: MAX_GRAPH_DAYS;
			if (config.dateRangeValue > limit) {
				throw new GraphProcessError(
					INVALID_DATE_RANGE(`value cannot exceed ${limit}`)
				);
			}
		}

		if (config.fromDate || config.toDate) {
			if (
				config.fromDate &&
				!isValidFormattedDate(config.fromDate)
			) {
				throw new GraphProcessError(
					INVALID_DATE_FORMAT(config.fromDate)
				);
			}

			if (config.toDate && !isValidFormattedDate(config.toDate)) {
				throw new GraphProcessError(INVALID_DATE_FORMAT(config.toDate));
			}
			if (config.fromDate && config.toDate) {
				const rangeDays =
					diffCalendarDays(
						parseDate(config.fromDate),
						parseDate(config.toDate)
					) + 1;
				if (rangeDays <= 0) {
					throw new GraphProcessError(
						INVALID_DATE_RANGE(
							"fromDate must not be after toDate"
						)
					);
				}
				if (rangeDays > MAX_GRAPH_DAYS) {
					throw new GraphProcessError(
						INVALID_DATE_RANGE(
							`fixed ranges cannot exceed ${MAX_GRAPH_DAYS} days`
						)
					);
				}
			}
		}

		if (config.heatScale !== undefined) {
			const heatScale = config.heatScale as GoalHeatScale;
			if (!heatScale || heatScale.type !== "GOAL") {
				throw new GraphProcessError(
					INVALID_HEAT_SCALE('type must be "GOAL"')
				);
			}
			if (
				!Number.isSafeInteger(heatScale.goal) ||
				heatScale.goal <= 0
			) {
				throw new GraphProcessError(
					INVALID_HEAT_SCALE(
						"goal must be a positive integer"
					)
				);
			}
			if (
				!Array.isArray(heatScale.levels) ||
				heatScale.levels.length === 0 ||
				heatScale.levels.length > MAX_GOAL_HEAT_LEVELS
			) {
				throw new GraphProcessError(
					INVALID_HEAT_SCALE(
						`levels must contain between 1 and ${MAX_GOAL_HEAT_LEVELS} entries`
					)
				);
			}
			const ratios = new Set<number>();
			for (const level of heatScale.levels) {
				if (
					!level ||
					typeof level.minRatio !== "number" ||
					!Number.isFinite(level.minRatio) ||
					level.minRatio < 0
				) {
					throw new GraphProcessError(
						INVALID_HEAT_SCALE(
							"each minRatio must be a finite non-negative number"
						)
					);
				}
				if (ratios.has(level.minRatio)) {
					throw new GraphProcessError(
						INVALID_HEAT_SCALE(
							"minRatio values must be unique"
						)
					);
				}
				ratios.add(level.minRatio);
				if (
					typeof level.color !== "string" ||
					level.color.trim().length === 0 ||
					level.color.length > 100
				) {
					throw new GraphProcessError(
						INVALID_HEAT_SCALE(
							"each level must have a valid color"
						)
					);
				}
				if (
					level.text !== undefined &&
					typeof level.text !== "string"
				) {
					throw new GraphProcessError(
						INVALID_HEAT_SCALE(
							"level text must be a string"
						)
					);
				}
			}
			if (!ratios.has(0)) {
				throw new GraphProcessError(
					INVALID_HEAT_SCALE(
						"levels must include a minRatio of 0"
					)
				);
			}
		}

		if (config.appearance !== undefined) {
			const appearance = config.appearance as GraphAppearance;
			if (
				!["COMPACT", "BALANCED", "TOUCH", "CUSTOM"].includes(
					appearance.density
				) ||
				!Number.isSafeInteger(appearance.cellGap) ||
				appearance.cellGap < 0 ||
				appearance.cellGap > 8 ||
				typeof appearance.highlightToday !== "boolean" ||
				typeof appearance.highlightWeekends !== "boolean" ||
				(appearance.emptyCellColor !== undefined &&
					(typeof appearance.emptyCellColor !== "string" ||
						appearance.emptyCellColor.trim().length === 0 ||
						appearance.emptyCellColor.length > 100))
			) {
				throw new GraphProcessError({
					summary: "Invalid graph appearance settings",
				});
			}
		}

		if (config.startOfWeek) {
			const statOfWeeks = [0, 1, 2, 3, 4, 5, 6];
			if (typeof config.startOfWeek !== "number") {
				try {
					config.startOfWeek = parseInt(config.startOfWeek);
				} catch (e) {
					throw new GraphProcessError(
						INVALID_START_OF_WEEK(config.startOfWeek)
					);
				}
			}
			if (!statOfWeeks.includes(config.startOfWeek)) {
				throw new GraphProcessError(
					INVALID_START_OF_WEEK(config.startOfWeek)
				);
			}
		}
	}
}

export class ValidationResult {
	valid: boolean;
	message?: string;
}

export type DateRangeType =
	| "LATEST_DAYS"
	| "LATEST_MONTH"
	| "LATEST_YEAR"
	| "FIXED_DATE_RANGE";
