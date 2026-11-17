import {
	isFileInTrackedFolders,
	normalizeTrackedFolderPath,
	normalizeTrackedFolders,
} from "../activity/folderScope";
import { getWeeklyReviewPathGroup } from "./weeklyReviewAnalysis";
import { isYoloChatActivity } from "./timeActivitySource";
import type { StoredTimeActivity, TimeBucket } from "./types";
import type {
	ActivitySegment,
	ActivityTimelineBlock,
	ActivityTimelineDay,
	ActivityTimelineQuery,
	ActivityTimelineSource,
	ActivityTimelinePrecision,
} from "./activityTimelineTypes";

const EPSILON = 1e-6;
type Candidate = { sourceId: string; segment: ActivitySegment; offsetMinutes: number; future: boolean };
interface SourceScan { id: string; total: number; candidates: Candidate[]; dates: Set<string>; inconsistent: boolean; future: boolean; }
interface SegmentQueryContext { data: StoredTimeActivity; sourceId: string; date: string; folders: readonly string[]; now: number; }

export function buildActivityTimelineDay(
	sources: readonly ActivityTimelineSource[],
	query: ActivityTimelineQuery,
	now: number,
): ActivityTimelineDay {
	const today = localDate(now);
	const folders = normalizeTrackedFolders(query.folders || []);
	if (!isDate(query.date)) return emptyDay(query.date, today, ["日期无效"]);
	const scans = sources.map(source => scanSource(source, query.date, folders, now));
	const selected = selectCandidates(scans);
	const totalSeconds = scans.reduce((sum, scan) => sum + scan.total, 0);
	const periods = new Map<string, string>();
	const rawBlocks = selected.candidates.map(candidate => {
		const block = toBlock(candidate, query);
		periods.set(block.id, candidate.segment.recordingPeriodId);
		return block;
	});
	const blocks = mergeBlocks(rawBlocks, periods);
	const locatedSeconds = selected.candidates.reduce((sum, candidate) => sum + candidate.segment.seconds, 0);
	const inconsistent = scans.some(scan => scan.inconsistent) || selected.conflicts.size > 0;
	const precision = precisionOf(totalSeconds, locatedSeconds, inconsistent, blocks.length);
	const warnings = warningsOf(precision, selected.conflicts.size > 0, scans.some(scan => scan.future));
	return {
		date: query.date, today, totalSeconds, locatedSeconds,
		...(precision === "MIXED" ? { unlocatedSeconds: totalSeconds - locatedSeconds } : {}),
		precision, blocks, warnings,
		recordedDates: [...new Set(scans.flatMap(scan => [...scan.dates]))].sort(),
	};
}

function emptyDay(date: string, today: string, warnings: string[]): ActivityTimelineDay {
	return { date, today, totalSeconds: 0, locatedSeconds: 0, precision: "EMPTY", blocks: [], warnings, recordedDates: [] };
}

function scanSource(source: ActivityTimelineSource, date: string, folders: readonly string[], now: number): SourceScan {
	const data = source.data;
	const dates = new Set<string>();
	let total = 0;
	let future = false;
	const today = localDate(now), currentHour = new Date(now).getHours();
	for (const bucket of Object.values(data.buckets || {})) {
		const seconds = selectedBucketSeconds(bucket, folders);
		if (seconds <= EPSILON) continue;
		dates.add(bucket.date);
		if (bucket.date === date) {
			total += seconds;
			future = future || date > today || (date === today && bucket.hour > currentHour);
		}
	}
	const timeline = data.timeline;
	const candidates: Candidate[] = [];
	let inconsistent = Boolean(timeline?.issues?.length);
	for (const segment of timeline?.segments || []) {
		const result = segmentCandidate(segment, { data, sourceId: source.id, date, folders, now });
		if (result === "INVALID") { inconsistent = true; continue; }
		if (result) { future = future || result.future; candidates.push(result); }
	}
	const checked=checkBucketAmounts(candidates,data);
	return { id: source.id, total, candidates:checked.valid, dates, inconsistent:inconsistent||checked.invalid, future };
}

function checkBucketAmounts(candidates:Candidate[],data:StoredTimeActivity):{valid:Candidate[];invalid:boolean} {
	const amounts=new Map<string,{seconds:number;limit:number}>();
	const key=(item:Candidate)=>JSON.stringify([item.segment.bucketKey,item.segment.path]);
	for(const item of candidates){
		const id=key(item),previous=amounts.get(id);
		amounts.set(id,{seconds:(previous?.seconds||0)+item.segment.seconds,limit:data.buckets[item.segment.bucketKey].documents[item.segment.path]});
	}
	const bad=new Set([...amounts].filter(([,amount])=>amount.seconds>amount.limit+EPSILON).map(([key])=>key));
	return {valid:candidates.filter(item=>!bad.has(key(item))),invalid:bad.size>0};
}

function selectedBucketSeconds(bucket: TimeBucket, folders: readonly string[]): number {
	return Object.entries(bucket.documents || {}).reduce((sum, [path, seconds]) => {
		return inScope(path, folders) && Number.isFinite(seconds) && seconds > 0 ? sum + seconds : sum;
	}, 0);
}

function segmentCandidate(
	segment: ActivitySegment,
	context: SegmentQueryContext,
): Candidate | "INVALID" | undefined {
	const { data, sourceId, date, folders, now } = context;
	const bucket = data.buckets?.[segment.bucketKey];
	if (!bucket) return "INVALID";
	if (bucket.date !== date || !inScope(segment.path, folders)) return undefined;
	if (!validSegment(segment, bucket)) return "INVALID";
	const range = minuteRange(segment, bucket);
	if (!range || range[1] <= range[0]) return "INVALID";
	if(range[0]<bucket.hour*60-EPSILON||range[1]>(bucket.hour+1)*60+EPSILON)return "INVALID";
	return { sourceId, segment, offsetMinutes: bucket.offsetMinutes, future: segment.start > now || segment.end > now };
}

function validSegment(segment: ActivitySegment, bucket: TimeBucket): boolean {
	return Boolean(segment.id && segment.continuityId && segment.recordingPeriodId && segment.path && segment.bucketKey) &&
		Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start &&
		Number.isFinite(segment.seconds) && segment.seconds > EPSILON &&
		Math.abs(segment.seconds - (segment.end - segment.start) / 1000) <= 0.001 && Number.isFinite(bucket.offsetMinutes) &&
		Number.isFinite(bucket.documents?.[segment.path]) && bucket.documents[segment.path] > EPSILON;
}

function selectCandidates(scans: readonly SourceScan[]): { candidates: Candidate[]; conflicts: Set<string> } {
	const byId = new Map<string, { fingerprint: string; candidate: Candidate }>();
	const conflicts = new Set<string>();
	for (const scan of scans) for (const candidate of scan.candidates) {
		const id = candidate.segment.id;
		if (conflicts.has(id)) continue;
		const fingerprint = stableKey(candidate.segment);
		const existing = byId.get(id);
		if (!existing) byId.set(id, { fingerprint, candidate });
		else if (existing.fingerprint !== fingerprint) { conflicts.add(id); byId.delete(id); }
	}
	return { candidates: [...byId.values()].map(item => item.candidate), conflicts };
}

function toBlock(candidate: Candidate, query: ActivityTimelineQuery): ActivityTimelineBlock {
	const segment = candidate.segment;
	const group = getWeeklyReviewPathGroup(segment.path, normalizeTrackedFolderPath(query.groupingRoot || ""), query.depth || 1);
	const range = minuteRange(segment, { date: query.date, offsetMinutes: candidate.offsetMinutes });
	const [startMinute, endMinute] = range!;
	return { id: segment.id, segmentIds: [segment.id], sourceId: candidate.sourceId, continuityId: segment.continuityId,
		path: segment.path, start: segment.start, end: segment.end, seconds: segment.seconds, startMinute, endMinute,
		offsetMinutes: candidate.offsetMinutes, groupId: group.id, groupName: group.name, activity: group.activity };
}

function mergeBlocks(blocks: ActivityTimelineBlock[], periods: ReadonlyMap<string, string>): ActivityTimelineBlock[] {
	blocks.sort((a, b) => a.start - b.start || a.end - b.end || a.sourceId.localeCompare(b.sourceId) || a.id.localeCompare(b.id));
	const result: ActivityTimelineBlock[] = [];
	for (const block of blocks) {
		const previous = result[result.length - 1];
		if (previous && canJoin(previous, block, periods)) {
			previous.end = block.end; previous.endMinute = block.endMinute; previous.seconds += block.seconds;
			previous.segmentIds.push(...block.segmentIds);
		} else result.push({ ...block, segmentIds: [...block.segmentIds] });
	}
	return result;
}

function canJoin(left: ActivityTimelineBlock, right: ActivityTimelineBlock, periods: ReadonlyMap<string, string>): boolean {
	return left.sourceId === right.sourceId && left.continuityId === right.continuityId && left.path === right.path &&
		periods.get(left.id) === periods.get(right.id) && left.groupId === right.groupId && left.offsetMinutes === right.offsetMinutes && left.end === right.start &&
		left.endMinute === right.startMinute;
}

function precisionOf(total: number, located: number, inconsistent: boolean, blockCount: number): ActivityTimelinePrecision {
	if (inconsistent && (total > EPSILON || blockCount > 0)) return "INCONSISTENT";
	if (total <= EPSILON && located <= EPSILON) return "EMPTY";
	if (located <= EPSILON) return "SUMMARY_ONLY";
	return located + EPSILON < total ? "MIXED" : "DETAILED";
}

function warningsOf(precision: ActivityTimelinePrecision, conflict: boolean, future: boolean): string[] {
	const warnings: string[] = [];
	if (precision === "SUMMARY_ONLY") warnings.push("当天有已记录时长，但历史仅有小时汇总，无法还原片段");
	if (precision === "MIXED") warnings.push("已有部分记录无法定位");
	if (precision === "INCONSISTENT") warnings.push("片段明细与小时累计不一致，无法完整核对");
	if (conflict) warnings.push("明细存在冲突，无法完整核对");
	if (future) warnings.push("存在未来时段记录，请核对日期／时区");
	return warnings;
}

function minuteRange(segment: Pick<ActivitySegment, "start" | "end">, bucket: Pick<TimeBucket, "date" | "offsetMinutes">): [number, number] | undefined {
	const start = clockMinute(segment.start, bucket.date, bucket.offsetMinutes);
	const end = clockMinute(segment.end, bucket.date, bucket.offsetMinutes);
	return Number.isFinite(start) && Number.isFinite(end) ? [start, end] : undefined;
}

function clockMinute(timestamp: number, date: string, offsetMinutes: number): number {
	const [year,month,day]=date.split("-").map(Number);
	return (timestamp+offsetMinutes*60000-Date.UTC(year,month-1,day))/60000;
}

function inScope(path: string, folders: readonly string[]): boolean {
	return isYoloChatActivity(path) ? folders.length === 0 : folders.length === 0 || isFileInTrackedFolders(path.replace(/\\/g, "/"), folders);
}

function isDate(value: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;
	const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
	return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]);
}

function localDate(timestamp: number): string {
	const date = new Date(timestamp);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function stableKey(value: unknown): string {
	if (!value || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
	return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stableKey((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
