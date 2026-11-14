import { DEFAULT_RULES } from "./constants";
import { TimeStats } from "./time/types";

export interface DailyEditStats {
	date: string;
	addedChars: number;
	deletedChars: number;
	changedChars: number;
	documents: DocumentEditStats[];
	unattributedAddedChars?: number;
	unattributedDeletedChars?: number;
	countingPolicyChanged?: boolean;
}

export interface DocumentEditStats {
	path: string;
	addedChars: number;
	deletedChars: number;
	changedChars: number;
	lastEditPosition?: EditPosition;
}

export interface EditPosition {
	/** Zero-based line number. */
	line: number;
	/** Zero-based column number. */
	column: number;
}

export interface TrackingPeriod {
	startDate: string;
	endDate?: string;
}

export interface CollectionScopePeriod extends TrackingPeriod {
	folders: string[];
}

export interface GoalHeatLevel {
	minRatio: number;
	color: string;
	text?: string;
}

export interface GoalHeatScale {
	type: "GOAL";
	goal: number;
	levels: GoalHeatLevel[];
}

export type GraphDensity = "COMPACT" | "BALANCED" | "TOUCH" | "CUSTOM";

export interface GraphAppearance {
	density: GraphDensity;
	cellGap: number;
	emptyCellColor?: string;
	highlightToday: boolean;
	highlightWeekends: boolean;
}

export interface SavedGraphTheme {
	id: string;
	name: string;
	colors: string[];
	density: GraphDensity;
	cellWidth?: number;
	cellHeight?: number;
	cellGap: number;
	cellShape?: string;
	emptyCellColor?: string;
	highlightToday: boolean;
	highlightWeekends: boolean;
	backgroundColor?: string;
	enableShadow: boolean;
}

export class ContributionGraphConfig {
	timeTracking?: boolean;
	hourlyData?: ContributionCellData[];
	/**
	 * the title of the graph
	 */
	title = "Contribution Graph";

	/**
	 * the style of the title
	 */
	titleStyle: Partial<CSSStyleDeclaration> = {};

	/**
	 * the style of the main container
	 */
	mainContainerStyle: Partial<CSSStyleDeclaration> = {};

	/**
	 * recent days to show
	 */
	days?: number | undefined;

	/**
	 * the start date of the graph，if `days` is set, this value will be ignored
	 */
	fromDate?: Date | string | undefined;

	/**
	 * the end date of the graph，if `days` is set, this value will be ignored
	 */
	toDate?: Date | string | undefined;

	/**
	 * the data to show at cell
	 */
	data: Contribution[];

	/**
	 * the global style of the cell, could be override by `cellStyleRules`
	 */
	cellStyle: Partial<CSSStyleDeclaration> = {};

	/**
	 * the rules to style the cell
	 */
	cellStyleRules: CellStyleRule[] = DEFAULT_RULES;

	/**
	 * Optional goal-based heat scale. When present it takes precedence over
	 * fixed cellStyleRules.
	 */
	heatScale?: GoalHeatScale;

	/** Responsive density and calendar-emphasis settings. */
	appearance?: GraphAppearance;

	/**
	 * Coverage information for internally tracked data sources.
	 */
	trackingPeriods?: TrackingPeriod[];

	/** Collection-scope history for distinguishing zero from uncollected data. */
	collectionScopePeriods?: CollectionScopePeriod[];

	/** Folder filter requested by this edit-activity graph. */
	activityFolders?: string[];

	/**
	 * Display unit used by legends, tooltips, and activity summaries.
	 */
	valueUnit?: string;

	/**
	 * set true to fill the screen, default value is false
	 *
	 * notice: it's not work when `graphType` is `calendar`
	 */
	fillTheScreen = false;

	/**
	 * set true to add box-shadow to main container, default is false
	 * 
	 * notice: this would be override if mainContainerStyle's boxShadow is set
	 */
	enableMainContainerShadow = false;

	/**
	 * set false to hide rule indicators
	 */
	showCellRuleIndicators = true;

	/**
	 * `default`: every column is a week day from top to bottom
	 * `month-track`: every row is a month from left to right
	 *
	 * default value: `default`
	 */
	graphType: "default" | "month-track" | "calendar" | "hourly" = "default";

	/**
	 * value range: 0->Sunday, 1->Monday, 2->Tuesday, 3->Wednesday, 4->Thursday, 5->Friday, 6->Saturday
	 * default value: 0
	 * notice: it's not work when `graphType` is `month-track`
	 */
	startOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 0;

	/**
	 * callback when cell is clicked
	 */
	onCellClick?: (
		cellData: ContributionCellData,
		event: MouseEvent | undefined
	) => void | undefined;

	/**
	 * Internal activity-detail state used to preserve the selected day across
	 * reactive refreshes.
	 */
	selectedActivityDate?: string;

	/** 时段图的临时视图状态，不写入笔记配置或统计数据。 */
	hourlyViewState?: { view: "day" | "week"; date: string };

	/**
	 * Called when the activity-detail panel is closed.
	 */
	onActivityClose?: () => void;
}

export interface Contribution {
	timeStats?: TimeStats;
	/**
	 * the date of the contribution, format: yyyy-MM-dd
	 */
	date: string | Date;
	/**
	 * the value of the contribution
	 */
	value: number;
	/**
	 * the summary of the contribution, will be shown when hover on the cell
	 */
	summary?: string | undefined;

	items?: ContributionItem[];
	editStats?: DailyEditStats;
}

export interface ContributionItem {
	label: string;
	value: number;
	description?: string;
	link?: ContributionItemLink;
	open?: (e: MouseEvent) => void | Promise<void>;
}

export interface ContributionItemLink {
	href: string;
	target?: string;
	className?: string;
	rel?: string;
}

export interface CellStyleRule {
	id: string | number;
	// the background color for the cell
	color: string;
	// the text in the cell
	text?: string | undefined;
	// the inlusive min value
	min: number;
	// the exclusive max value
	max: number;
}

export class ContributionCellData {
	hour?: number;
	timeStats?: TimeStats;
	date: string; // yyyy-MM-dd
	weekDay: number; // 0 - 6
	month: number; // 0 - 11
	monthDate: number; // 1 - 31
	year: number; // sample: 2020
	value: number;
	summary?: string;
	items?: ContributionItem[];
	editStats?: DailyEditStats;
	tracked?: boolean;
	trackingState?: "TRACKED" | "PARTIAL" | "UNTRACKED";
	future?: boolean;
}
