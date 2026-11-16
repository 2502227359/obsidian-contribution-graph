import type { TimeDocumentStats, TimeTrackingState } from "./types";

export type WeeklyReviewCoverage = TimeTrackingState | "UNKNOWN";
export type WeeklyReviewGoalState = "MET" | "MISSED" | "UNKNOWN" | "IN_PROGRESS" | "EXCLUDED";

export interface WeeklyReviewDay {
	date: string;
	seconds: number;
	documents: readonly TimeDocumentStats[];
	coverage: WeeklyReviewCoverage;
	future: boolean;
	timezoneWarning: boolean;
	scopeSignatures: readonly string[];
}

export interface WeeklyReviewComparison {
	fromDate: string;
	toDate?: string;
	referenceFromDate: string;
	referenceToDate?: string;
	currentSeconds: number;
	previousSeconds: number;
	state: "READY" | "NO_COMPLETED_DAYS" | "INCOMPLETE" | "POLICY_CHANGED";
	deltaSeconds?: number;
	percentage?: number;
	currentDays: readonly WeeklyReviewDay[];
	previousDays: readonly WeeklyReviewDay[];
}

export interface WeeklyReviewHour {
	date: string;
	hour: number;
	seconds: number;
	documents: readonly TimeDocumentStats[];
	coverage: WeeklyReviewCoverage;
	future: boolean;
	timezoneWarning: boolean;
}

export interface WeeklyReviewTimeline {
	fromDate: string;
	toDate: string;
	days: readonly WeeklyReviewDay[];
	hours: readonly WeeklyReviewHour[];
}

export interface WeeklyReviewSnapshot {
	timeline?: WeeklyReviewTimeline;
	generatedAt: number;
	today: string;
	weekStart: string;
	weekEnd: string;
	isCurrentWeek: boolean;
	root: string;
	days: readonly WeeklyReviewDay[];
	documents: readonly TimeDocumentStats[];
	totalSeconds: number;
	recordedDays: number;
	comparison: WeeklyReviewComparison;
	earliestDate: string;
	folderPaths: readonly string[];
	warnings: readonly string[];
}

export interface WeeklyReviewGroup {
	key: string;
	label: string;
	seconds: number;
	documents: readonly TimeDocumentStats[];
	activity: boolean;
}

export interface WeeklyReviewQuery {
	date?: string;
	root?: string;
}
