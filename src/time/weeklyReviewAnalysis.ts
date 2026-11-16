import { isYoloChatActivity, YOLO_CHAT_ACTIVITY_LABEL, YOLO_CHAT_ACTIVITY_PATH } from "./timeActivitySource";
import type { TimeDocumentStats } from "./types";
import type { WeeklyReviewComparison, WeeklyReviewDay, WeeklyReviewSnapshot } from "./weeklyReviewTypes";

export interface WeeklyReviewAnalysisOptions {
	groupingRoot?: string;
	groupingDepth?: 1 | 2;
}

export interface WeeklyReviewAnalysisNode {
	id: string;
	name: string;
	seconds: number;
	path?: string;
	activity: boolean;
	documents: readonly TimeDocumentStats[];
	children: readonly WeeklyReviewAnalysisNode[];
}

export interface WeeklyReviewComparisonRow {
	id: string;
	name: string;
	path?: string;
	activity: boolean;
	currentSeconds: number;
	previousSeconds: number;
	deltaSeconds?: number;
	currentKnown: boolean;
	previousKnown: boolean;
	currentDocuments: readonly TimeDocumentStats[];
	previousDocuments: readonly TimeDocumentStats[];
}

export interface WeeklyReviewAnalysisComparison {
	fromDate: string;
	toDate?: string;
	referenceFromDate: string;
	referenceToDate?: string;
	currentSeconds: number;
	previousSeconds: number;
	state: WeeklyReviewComparison["state"];
	deltaSeconds?: number;
	percentage?: number;
	canDescribeChange: boolean;
	rows: readonly WeeklyReviewComparisonRow[];
}

export interface WeeklyReviewAnalysis {
	tree: WeeklyReviewAnalysisNode;
	comparison: WeeklyReviewAnalysisComparison;
	groupingRoot: string;
	groupingDepth: 1 | 2;
}

interface MutableNode {
	id: string;
	name: string;
	path?: string;
	activity: boolean;
	documents: TimeDocumentStats[];
	children: Map<string, MutableNode>;
}

interface GroupDescriptor {
	id: string;
	name: string;
	path?: string;
	activity: boolean;
}

interface PeriodGroup {
	descriptor: GroupDescriptor;
	seconds: number;
	documents: Map<string, number>;
	hasPositiveRecord: boolean;
}

const DIRECT_NOTE_LABEL = "根目录直属笔记";

export function buildWeeklyReviewAnalysis(snapshot: WeeklyReviewSnapshot, options: WeeklyReviewAnalysisOptions = {}): WeeklyReviewAnalysis {
	const groupingRoot = normalizePath(options.groupingRoot ?? snapshot.root);
	const groupingDepth = options.groupingDepth || 1;
	return { tree: buildAnalysisTree(snapshot, groupingRoot),
		comparison: buildComparison(snapshot.comparison, groupingRoot, groupingDepth), groupingRoot, groupingDepth };
}

function buildAnalysisTree(snapshot: WeeklyReviewSnapshot, groupingRoot: string): WeeklyReviewAnalysisNode {
	const notes = createMutableNode("notes", "笔记", undefined, false);
	const yoloDocuments: TimeDocumentStats[] = [];
	for (const item of snapshot.documents) {
		const document = cloneDocument(item);
		if (isYoloChatActivity(item.path)) {
			yoloDocuments.push(document);
			continue;
		}
		getNoteLeaf(notes, item.path, groupingRoot).documents.push(document);
	}
	const noteTree = materialize(notes);
	const yoloTree: WeeklyReviewAnalysisNode = {
		id: "activity:yolo", name: YOLO_CHAT_ACTIVITY_LABEL, path: YOLO_CHAT_ACTIVITY_PATH,
		seconds: sumSeconds(yoloDocuments), activity: true, documents: documentRows(yoloDocuments), children: [],
	};
	return {
		id: "root", name: "本周投入", seconds: snapshot.totalSeconds, activity: false,
		documents: cloneDocumentRows(snapshot.documents), children: [noteTree, yoloTree],
	};
}

function getNoteLeaf(notes: MutableNode, rawPath: string, groupingRoot: string): MutableNode {
	const path = normalizePath(rawPath);
	const directories = splitPath(path).slice(0, -1);
	const inside = Boolean(groupingRoot && isPathInside(path, groupingRoot));
	const prefix = inside ? splitPath(groupingRoot) : [];
	const visible = inside ? directories.slice(prefix.length) : directories;
	let current = notes;
	for (const part of visible) {
		prefix.push(part);
		const fullPath = prefix.join("/");
		const id = `folder:${fullPath}`;
		if (!current.children.has(id)) current.children.set(id, createMutableNode(id, part, fullPath, false));
		current = current.children.get(id)!;
	}
	if (!visible.length) {
		const id = inside ? `direct:${groupingRoot}` : "direct:workspace";
		const label = inside ? `${groupingRoot.split("/").pop()}直属笔记` : "仓库直属笔记";
		if (!current.children.has(id)) current.children.set(id, createMutableNode(id, label, inside ? groupingRoot : undefined, false));
		current = current.children.get(id)!;
	}
	return current;
}

function createMutableNode(id: string, name: string, path: string | undefined, activity: boolean): MutableNode {
	return { id, name, path, activity, documents: [], children: new Map() };
}

function materialize(node: MutableNode): WeeklyReviewAnalysisNode {
	const children = [...node.children.values()].map(materialize);
	if (children.length && node.documents.length) {
		const own = documentRows(node.documents);
		children.push({ id: `direct:${node.path}`, name: "本目录直属笔记", path: node.path,
			activity: false, seconds: sumSeconds(own), documents: own, children: [] });
	}
	const documents = children.length ? documentRows(children.flatMap(child => child.documents)) : documentRows(node.documents);
	children.sort(compareNodes);
	return { id: node.id, name: node.name, ...(node.path ? {path:node.path} : {}), activity: node.activity,
		seconds: sumSeconds(documents), documents, children };
}

function compareNodes(left: WeeklyReviewAnalysisNode, right: WeeklyReviewAnalysisNode): number {
	return right.seconds - left.seconds || left.id.localeCompare(right.id);
}

function buildComparison(
	comparison: WeeklyReviewComparison,
	groupingRoot: string,
	groupingDepth: 1 | 2,
): WeeklyReviewAnalysisComparison {
	const canBuildRows = comparison.state !== "NO_COMPLETED_DAYS";
	const current = canBuildRows ? aggregatePeriod(comparison.currentDays, groupingRoot, groupingDepth) : new Map<string, PeriodGroup>();
	const previous = canBuildRows ? aggregatePeriod(comparison.previousDays, groupingRoot, groupingDepth) : new Map<string, PeriodGroup>();
	const keys = new Set([...current.keys(), ...previous.keys()]);
	const rows = [...keys].map(key => buildComparisonRow(key, current, previous, comparison)).sort(compareRows);
	return {
		fromDate: comparison.fromDate, toDate: comparison.toDate,
		referenceFromDate: comparison.referenceFromDate, referenceToDate: comparison.referenceToDate,
		currentSeconds: comparison.currentSeconds, previousSeconds: comparison.previousSeconds,
		state: comparison.state, deltaSeconds: comparison.deltaSeconds, percentage: comparison.percentage,
		canDescribeChange: comparison.state === "READY", rows,
	};
}

function aggregatePeriod(days: readonly WeeklyReviewDay[], groupingRoot: string, groupingDepth: 1 | 2): Map<string, PeriodGroup> {
	const groups = new Map<string, PeriodGroup>();
	for (const day of days) for (const item of day.documents) {
		const descriptor = describeGroup(item.path, groupingRoot, groupingDepth);
		const group = groups.get(descriptor.id) || { descriptor, seconds: 0, documents: new Map(), hasPositiveRecord: false };
		group.seconds += item.seconds;
		group.documents.set(item.path, (group.documents.get(item.path) || 0) + item.seconds);
		group.hasPositiveRecord ||= item.seconds > 0;
		groups.set(descriptor.id, group);
	}
	return groups;
}

function buildComparisonRow(
	key: string,
	current: Map<string, PeriodGroup>,
	previous: Map<string, PeriodGroup>,
	comparison: WeeklyReviewComparison,
): WeeklyReviewComparisonRow {
	const currentGroup = current.get(key);
	const previousGroup = previous.get(key);
	const descriptor = currentGroup?.descriptor || previousGroup!.descriptor;
	const fullyKnown = (days: readonly WeeklyReviewDay[]) => days.length > 0 && days.every(day => day.coverage === "TRACKED" && !day.future);
	return {
		id: descriptor.id, name: descriptor.name, ...(descriptor.path ? { path: descriptor.path } : {}), activity: descriptor.activity,
		currentSeconds: currentGroup?.seconds || 0, previousSeconds: previousGroup?.seconds || 0,
		deltaSeconds: comparison.state !== "READY" ? undefined : (currentGroup?.seconds || 0) - (previousGroup?.seconds || 0),
		currentKnown: Boolean(currentGroup?.hasPositiveRecord || fullyKnown(comparison.currentDays)),
		previousKnown: Boolean(previousGroup?.hasPositiveRecord || fullyKnown(comparison.previousDays)),
		currentDocuments: documentRowsFromMap(currentGroup?.documents), previousDocuments: documentRowsFromMap(previousGroup?.documents),
	};
}

function compareRows(left: WeeklyReviewComparisonRow, right: WeeklyReviewComparisonRow): number {
	if (left.deltaSeconds !== undefined && right.deltaSeconds !== undefined) return Math.abs(right.deltaSeconds) - Math.abs(left.deltaSeconds) || left.id.localeCompare(right.id);
	return Math.max(right.currentSeconds, right.previousSeconds) - Math.max(left.currentSeconds, left.previousSeconds) || left.id.localeCompare(right.id);
}

function describeGroup(rawPath: string, groupingRoot: string, groupingDepth: 1 | 2): GroupDescriptor {
	if (isYoloChatActivity(rawPath)) return { id: "activity:yolo", name: YOLO_CHAT_ACTIVITY_LABEL, path: YOLO_CHAT_ACTIVITY_PATH, activity: true };
	const path = normalizePath(rawPath);
	const parts = splitPath(path), directories = parts.slice(0, -1);
	if (groupingRoot && isPathInside(path, groupingRoot)) {
		const rootParts = splitPath(groupingRoot), relative = directories.slice(rootParts.length);
		if (!relative.length) return { id: `direct:${groupingRoot}`, name: DIRECT_NOTE_LABEL, path: groupingRoot, activity: false };
		const selected = relative.slice(0, groupingDepth), fullPath = [...rootParts, ...selected].join("/");
		return { id: `folder:${fullPath}`, name: selected.join("/"), path: fullPath, activity: false };
	}
	if (!directories.length) return { id: "direct:workspace", name: DIRECT_NOTE_LABEL, path: "", activity: false };
	const selected = directories.slice(0, groupingDepth), fullPath = selected.join("/");
	return { id: `folder:${fullPath}`, name: selected.join("/"), path: fullPath, activity: false };
}


function isPathInside(path: string, root: string): boolean {
	return path === root || path.startsWith(`${root}/`);
}

function splitPath(path: string): string[] {
	return path.split("/").filter(Boolean);
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
}

function cloneDocument(item: TimeDocumentStats): TimeDocumentStats {
	return { path: item.path, seconds: item.seconds };
}

function cloneDocumentRows(items: readonly TimeDocumentStats[]): TimeDocumentStats[] {
	return items.map(cloneDocument);
}

function documentRows(items: readonly TimeDocumentStats[]): TimeDocumentStats[] {
	return documentRowsFromMap(new Map(items.map(item => [item.path, item.seconds])));
}

function documentRowsFromMap(values?: Map<string, number>): TimeDocumentStats[] {
	return values ? [...values].map(([path, seconds]) => ({ path, seconds })).sort((a, b) => b.seconds - a.seconds || a.path.localeCompare(b.path)) : [];
}

function sumSeconds(items: readonly TimeDocumentStats[]): number {
	return items.reduce((sum, item) => sum + item.seconds, 0);
}
