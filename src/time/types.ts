export interface TimeSpan {
	path: string;
	start: number;
	end: number;
	seconds: number;
}

export type TimeContextReason = "READY" | "BACKGROUND" | "MODAL" | "NO_MARKDOWN" | "OUTSIDE_EDITOR";

export interface TimeTrackingContext {
	reason: TimeContextReason;
	path?: string;
}

export interface IdleTimeDiscard {
	path: string;
	start: number;
	detectedAt: number;
	recordedSeconds: number;
	unrecordedSeconds: number;
	reason: "idle" | "interrupted";
}

export interface TimeTrackerSnapshot {
	status: "ACTIVE" | "IDLE";
	interrupted: boolean;
	path?: string;
	pendingStart?: number;
	pendingEnd?: number;
	pendingSeconds: number;
	remainingMs: number;
}

export type TimeStatusReason = "DISABLED" | "MANUAL" | "BACKGROUND" | "MODAL" | "NO_MARKDOWN" |
	"OUT_OF_SCOPE" | "OUTSIDE_EDITOR" | "INTERRUPTED" | "IDLE" | "ACTIVE";

export interface TimeTrackingSnapshot {
	reason: TimeStatusReason;
	path?: string;
	manualPaused: boolean;
	enabled: boolean;
	todaySeconds: number;
	todayPendingSeconds: number;
	remainingMs: number;
	lastDiscard?: IdleTimeDiscard;
}

export interface TimeBucket {
	date: string;
	hour: number;
	offsetMinutes: number;
	documents: Record<string, number>;
}

export interface TimeCoveragePeriod {
	start: number;
	end?: number;
	folders: string[];
}

export interface TimePolicyChange {
	at: number;
	idleTimeoutMinutes: number;
}

export interface StoredTimeActivity {
	buckets: Record<string, TimeBucket>;
	periods: TimeCoveragePeriod[];
	policyChanges: TimePolicyChange[];
}

export interface TimeStatsQuery {
	fromDate?: string;
	toDate?: string;
	folders?: string[];
}

export interface TimeDocumentStats {
	path: string;
	seconds: number;
}

export type TimeTrackingState = "TRACKED" | "PARTIAL" | "UNTRACKED";

export interface TimeStats {
	date: string;
	hour?: number;
	seconds: number;
	documents: TimeDocumentStats[];
	trackingState: TimeTrackingState;
	future: boolean;
	policyChanged?: boolean;
}
