export interface TimeSpan {
	path: string;
	start: number;
	end: number;
	seconds: number;
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
