import { getWeeklyReviewPathGroup } from "./weeklyReviewAnalysis";
import type { TimeDocumentStats } from "./types";
import type { WeeklyReviewComparison, WeeklyReviewDay, WeeklyReviewSnapshot, WeeklyReviewWindow } from "./weeklyReviewTypes";

type ComparisonState = WeeklyReviewComparison["state"];
export type InsightKind = "structure" | "comparison" | "hour";
export interface WeeklyReviewInsightAction { kind: InsightKind; id: string; period?: "current" | "previous"; fromDate?: string; toDate?: string; }
export interface WeeklyReviewObservation { id: string; kind: InsightKind; text: string; action: WeeklyReviewInsightAction; }
export interface WeeklyReviewChangeDocument { path: string; currentSeconds: number; previousSeconds: number; currentKnown: boolean; previousKnown: boolean; deltaSeconds?: number; }
export interface WeeklyReviewChangeGroup {
	id: string; name: string; activity: boolean; currentSeconds: number; previousSeconds: number; currentKnown: boolean; previousKnown: boolean; deltaSeconds?: number;
	status: "INCREASE" | "DECREASE" | "ADDED" | "REMOVED" | "UNCHANGED" | "UNKNOWN"; documents: readonly WeeklyReviewChangeDocument[];
}
export interface WeeklyReviewChanges {
	state: ComparisonState; canDescribeChange: boolean; currentSeconds: number; previousSeconds: number; deltaSeconds?: number;
	groups: readonly WeeklyReviewChangeGroup[]; increases: readonly WeeklyReviewChangeGroup[]; decreases: readonly WeeklyReviewChangeGroup[];
}
export type WeeklyReviewRankStatus = "RECORDED" | "CONFIRMED_ZERO" | "UNKNOWN";
export interface WeeklyReviewRankPoint { fromDate: string; toDate?: string; seconds: number; rank: number | null; known: boolean; complete: boolean; status: WeeklyReviewRankStatus; documents: readonly TimeDocumentStats[]; connectPrevious: boolean; }
export interface WeeklyReviewRankingGroup { id: string; name: string; activity: boolean; points: readonly WeeklyReviewRankPoint[]; }
export interface WeeklyReviewRankingWindow { fromDate: string; toDate?: string; previousState: ComparisonState; points: readonly { groupId: string; rank: number | null; seconds: number; status: WeeklyReviewRankStatus }[]; }
export interface WeeklyReviewRanking { windows: readonly WeeklyReviewRankingWindow[]; groups: readonly WeeklyReviewRankingGroup[]; }
export interface WeeklyReviewInsights { observations: readonly WeeklyReviewObservation[]; changes: WeeklyReviewChanges; ranking: WeeklyReviewRanking; }

interface GroupValue { id: string; name: string; activity: boolean; seconds: number; documents: Map<string, number>; }
interface GroupPair { id: string; name: string; activity: boolean; current?: GroupValue; previous?: GroupValue; }

export function buildWeeklyReviewInsights(snapshot: WeeklyReviewSnapshot, options: { groupingRoot: string; depth: 1 | 2 }): WeeklyReviewInsights {
	const windows = snapshot.timeline?.windows || [], changes = buildChanges(snapshot, options);
	return {observations: buildObservations(snapshot, options, changes), changes, ranking: buildRanking(windows, options)};
}

function buildChanges(snapshot: WeeklyReviewSnapshot, options: { groupingRoot: string; depth: 1 | 2 }): WeeklyReviewChanges {
	const comparison = snapshot.comparison, current = aggregateDays(comparison.currentDays, options), previous = aggregateDays(comparison.previousDays, options), reliable = comparison.state === "READY";
	const groups = pairGroups(current, previous).map(pair => makeChange(pair, comparison.currentDays, comparison.previousDays, reliable));
	const increases = groups.filter(group => group.deltaSeconds !== undefined && group.deltaSeconds > 0).sort((a, b) => b.deltaSeconds! - a.deltaSeconds! || a.id.localeCompare(b.id));
	const decreases = groups.filter(group => group.deltaSeconds !== undefined && group.deltaSeconds < 0).sort((a, b) => a.deltaSeconds! - b.deltaSeconds! || a.id.localeCompare(b.id));
	return {state: comparison.state, canDescribeChange: reliable, currentSeconds: comparison.currentSeconds, previousSeconds: comparison.previousSeconds, deltaSeconds: reliable ? comparison.currentSeconds - comparison.previousSeconds : undefined, groups, increases, decreases};
}

function makeChange(pair: GroupPair, currentDays: readonly WeeklyReviewDay[], previousDays: readonly WeeklyReviewDay[], reliable: boolean): WeeklyReviewChangeGroup {
	const currentSeconds = pair.current?.seconds || 0, previousSeconds = pair.previous?.seconds || 0, currentKnown = knownGroup(pair.current, currentDays), previousKnown = knownGroup(pair.previous, previousDays);
	const deltaSeconds = reliable && currentKnown && previousKnown ? currentSeconds - previousSeconds : undefined;
	const status = deltaSeconds === undefined ? "UNKNOWN" : deltaSeconds > 0 ? previousSeconds ? "INCREASE" : "ADDED" : deltaSeconds < 0 ? currentSeconds ? "DECREASE" : "REMOVED" : "UNCHANGED";
	return {id: pair.id, name: pair.name, activity: pair.activity, currentSeconds, previousSeconds, currentKnown, previousKnown, deltaSeconds, status, documents: makeChangeDocuments(pair, currentDays, previousDays, reliable)};
}

function makeChangeDocuments(pair: GroupPair, currentDays: readonly WeeklyReviewDay[], previousDays: readonly WeeklyReviewDay[], reliable: boolean): WeeklyReviewChangeDocument[] {
	const paths = new Set<string>([...pair.current?.documents.keys() || [], ...pair.previous?.documents.keys() || []]);
	return [...paths].map(path => {
		const currentSeconds = pair.current?.documents.get(path) || 0, previousSeconds = pair.previous?.documents.get(path) || 0, currentKnown = currentSeconds > 0 || fullyTracked(currentDays), previousKnown = previousSeconds > 0 || fullyTracked(previousDays);
		return {path, currentSeconds, previousSeconds, currentKnown, previousKnown, deltaSeconds: reliable && currentKnown && previousKnown ? currentSeconds - previousSeconds : undefined};
	}).sort((a, b) => Math.abs(b.deltaSeconds || 0) - Math.abs(a.deltaSeconds || 0) || a.path.localeCompare(b.path));
}

function buildObservations(snapshot: WeeklyReviewSnapshot, options: { groupingRoot: string; depth: 1 | 2 }, changes: WeeklyReviewChanges): WeeklyReviewObservation[] {
	const result: WeeklyReviewObservation[] = [], groups = aggregateDays(snapshot.days, options), top = [...groups.values()].sort((a, b) => b.seconds - a.seconds || a.id.localeCompare(b.id))[0];
	if (top && top.seconds > 0) result.push({id: "structure:top", kind: "structure", text: `投入最多：${top.name}，${duration(top.seconds)}，占已记录时长 ${percent(top.seconds, snapshot.totalSeconds)}%。`, action: {kind: "structure", id: top.id}});
	if (changes.canDescribeChange) {
		const change = [changes.increases[0],changes.decreases[0]].filter(Boolean).sort((a,b)=>Math.abs(b.deltaSeconds!)-Math.abs(a.deltaSeconds!))[0];
		const delta=changes.deltaSeconds||0,net=delta?`${delta>0?"增加":"减少"}${duration(Math.abs(delta))}`:"持平";
		if (change && change.deltaSeconds !== undefined && change.deltaSeconds !== 0) result.push({id: "comparison:change", kind: "comparison", text: `同期合计${net}；${change.name}${change.deltaSeconds > 0 ? "增加" : "减少"}${duration(Math.abs(change.deltaSeconds))}。`, action: {kind: "comparison", id: change.id, period: "current"}});
	} else result.push({id: "comparison:uncertain", kind: "comparison", text: changes.state === "NO_COMPLETED_DAYS" ? "本周尚无已结束日期，暂不判断同期变化。" : changes.state === "POLICY_CHANGED" ? "采集口径有变化，暂不判断同期变化。" : "同期数据目前无法判断变化，仍可查看两期已记录时长。", action: {kind: "comparison", id: "comparison"}});
	const hour = topHour(snapshot);
	if (hour && hour.seconds > 0) result.push({id: "hour:top", kind: "hour", text: `记录最多时段：${hour.label}，占已记录时长 ${percent(hour.seconds, snapshot.totalSeconds)}%。`, action: {kind: "hour", id: hour.id}});
	return result.slice(0, 3);
}

function topHour(snapshot: WeeklyReviewSnapshot): {id: string; label: string; seconds: number} | undefined {
	const hours = snapshot.timeline?.hours || [], slots = Array.from({length: 4}, (_, index) => ({id: `${index * 6}-${index * 6 + 6}`, label: `${String(index * 6).padStart(2, "0")}:00–${String(index * 6 + 6).padStart(2, "0")}:00`, seconds: 0}));
	for (const hour of hours) slots[Math.floor(hour.hour / 6)].seconds += hour.seconds;
	return slots.sort((a, b) => b.seconds - a.seconds || a.id.localeCompare(b.id))[0];
}

function buildRanking(windows: readonly WeeklyReviewWindow[], options: { groupingRoot: string; depth: 1 | 2 }): WeeklyReviewRanking {
	const values = windows.map(window => aggregateDays(window.days, options)), all = new Map<string, {name: string; activity: boolean; total: number}>();
	for (const groups of values) for (const group of groups.values()) all.set(group.id, {name: group.name, activity: group.activity, total: (all.get(group.id)?.total || 0) + group.seconds});
	const selected = chooseRankingGroups([...all.entries()]), groups = selected.map(([id, descriptor]) => ({id, name: descriptor.name, activity: descriptor.activity, points: windows.map((window, index) => rankPoint(window, values[index], id, index > 0 ? windows[index - 1] : undefined))}));
	const rankingWindows = windows.map((window, index) => ({fromDate: window.fromDate, toDate: window.toDate, previousState: window.previousState, points: window.days.length ? groups.map(group => ({groupId: group.id, rank: group.points[index].rank, seconds: group.points[index].seconds, status: group.points[index].status})) : []}));
	return {windows: rankingWindows, groups};
}

function chooseRankingGroups(ordered: readonly [string, {name: string; activity: boolean; total: number}][]): [string, {name: string; activity: boolean; total: number}][] {
	const selected = [...ordered].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0])).slice(0, 6).map(item => [...item] as [string, {name: string; activity: boolean; total: number}]);
	const yolo = ordered.find(([id]) => id === "activity:yolo");
	if (yolo && !selected.some(([id]) => id === yolo[0])) selected.splice(Math.max(0, selected.length - 1), 1, yolo);
	return selected;
}

function rankPoint(window: WeeklyReviewWindow, current: Map<string, GroupValue>, id: string, previous?: WeeklyReviewWindow): WeeklyReviewRankPoint {
	if (!window.days.length) return {fromDate: window.fromDate, toDate: window.toDate, seconds: 0, rank: null, known: false, complete: false, status: "UNKNOWN", documents: [], connectPrevious: false};
	const group = current.get(id), seconds = group?.seconds || 0, known = knownGroup(group, window.days), complete = fullyTracked(window.days) && window.previousState !== "POLICY_CHANGED", status: WeeklyReviewRankStatus = seconds > 0 ? "RECORDED" : known ? "CONFIRMED_ZERO" : "UNKNOWN";
	const rank = seconds > 0 ? competitionRank([...current.values()].filter(item => item.seconds > 0), seconds) : null;
	const documents = group ? [...group.documents].map(([path, value]) => ({path, seconds: value})) : [];
	return {fromDate: window.fromDate, toDate: window.toDate, seconds, rank, known, complete, status, documents, connectPrevious: Boolean(previous && window.previousState === "READY" && complete && fullyTracked(previous.days) && status === "RECORDED")};
}

function competitionRank(groups: readonly GroupValue[], seconds: number): number { return 1 + groups.filter(group => group.seconds > seconds).length; }

function aggregateDays(days: readonly WeeklyReviewDay[], options: { groupingRoot: string; depth: 1 | 2 }): Map<string, GroupValue> {
	const groups = new Map<string, GroupValue>();
	for (const day of days) for (const document of day.documents) {
		const descriptor = getWeeklyReviewPathGroup(document.path, options.groupingRoot, options.depth), group = groups.get(descriptor.id) || {id: descriptor.id, name: descriptor.name, activity: descriptor.activity, seconds: 0, documents: new Map()};
		group.seconds += document.seconds; group.documents.set(document.path, (group.documents.get(document.path) || 0) + document.seconds); groups.set(group.id, group);
	}
	return groups;
}

function pairGroups(current: Map<string, GroupValue>, previous: Map<string, GroupValue>): GroupPair[] {
	const ids = new Set([...current.keys(), ...previous.keys()]);
	return [...ids].map(id => {const group = current.get(id) || previous.get(id)!; return {id, name: group.name, activity: group.activity, current: current.get(id), previous: previous.get(id)};}).sort((a, b) => a.id.localeCompare(b.id));
}

function knownGroup(group: GroupValue | undefined, days: readonly WeeklyReviewDay[]): boolean { return Boolean(group?.seconds || fullyTracked(days)); }
function fullyTracked(days: readonly WeeklyReviewDay[]): boolean {
	if (!days.length || !days.every(day => day.coverage === "TRACKED" && !day.future && !day.timezoneWarning)) return false;
	const signatures = days.flatMap(day => day.scopeSignatures);
	return !signatures.length || new Set(signatures).size === 1;
}
function duration(seconds: number): string { if(seconds>0&&seconds<1)return "少于1秒";const minutes = Math.floor(seconds / 60), rest = Math.floor(seconds % 60); return minutes ? `${minutes}分钟` : `${rest}秒`; }
function percent(value: number, total: number): string { return total > 0 ? (value / total * 100).toFixed(0) : "0"; }
