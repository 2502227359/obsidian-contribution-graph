import type { EditActivityChangeEvent } from "../activity/EditActivityService";
import type { StoredTimeActivity } from "./types";

export interface ActivitySegment {
 id: string;
 continuityId: string;
 recordingPeriodId: string;
 path: string;
 bucketKey: string;
 start: number;
 end: number;
 seconds: number;
}

export interface TimelineRecordingPeriod {
 id: string;
 start: number;
 end?: number;
 folders: string[];
	files?: string[];
}

export interface StoredActivityTimeline {
 formatVersion: 1;
 segments: ActivitySegment[];
 recordingPeriods: TimelineRecordingPeriod[];
 /** 自动读取时隔离的明细异常，不改变原桶。 */
 issues?: string[];
}

export interface ActivityTimelineSource { id: string; data: StoredTimeActivity; }
export interface ActivityTimelineQuery { date: string; folders?: readonly string[]; groupingRoot?: string; depth?: 1 | 2; }
export type ActivityTimelinePrecision = "EMPTY" | "SUMMARY_ONLY" | "MIXED" | "DETAILED" | "INCONSISTENT";

export interface ActivityTimelineBlock {
 id: string;
 segmentIds: string[];
 sourceId: string;
 continuityId: string;
 path: string;
 start: number;
 end: number;
 seconds: number;
 startMinute: number;
 endMinute: number;
 offsetMinutes: number;
 groupId: string;
 groupName: string;
 activity: boolean;
 provisional?: boolean;
}

export interface ActivityTimelineDay {
 date: string;
 today: string;
 totalSeconds: number;
 locatedSeconds: number;
 unlocatedSeconds?: number;
 precision: ActivityTimelinePrecision;
 blocks: ActivityTimelineBlock[];
 warnings: string[];
 recordedDates: string[];
}

export interface ActivityTimelineService {
 getActivityTimelineDay(query: ActivityTimelineQuery): ActivityTimelineDay;
	getSettings(): {trackedFolders: string[]; trackedFiles?: string[]; timeTrackingEnabled: boolean};
 subscribe(listener: (event: EditActivityChangeEvent) => void): () => void;
}

export interface ActivityTimelineViewState {
 date: string;
 followToday: boolean;
 window: [number, number];
 depth: 1 | 2;
 expanded: string[];
 selectedId?: string;
 highlightedPath?: string;
}

export interface ActivityTimelineViewOptions {
	/** 代码块或表单宿主负责卸载，临时离开文档时不销毁视图。 */
	hostOwnsLifecycle?: boolean;
	getDateRange?: () => {fromDate:string;toDate:string};
	title?: string;
 service: ActivityTimelineService;
 fromDate: string;
 toDate: string;
 date?: string;
 folders?: readonly string[];
 groupingRoot?: string;
 depth?: 1 | 2;
 initialState?: ActivityTimelineViewState;
 fileExists(path: string): boolean;
 onOpenDocument(path: string, event: MouseEvent | KeyboardEvent): void;
 onExpand?(state: ActivityTimelineViewState): void;
 onHourly?(date: string, folders: readonly string[]): void;
}
