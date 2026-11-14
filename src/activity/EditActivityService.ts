import {
	ChangeSet,
	EditorState,
	Extension,
	Text,
	Transaction,
} from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { editorInfoField, Notice, Plugin } from "obsidian";
import { Locals } from "src/i18/messages";
import { MAX_GOAL_HEAT_LEVELS } from "src/constants";
import {
	CollectionScopePeriod,
	DailyEditStats,
	SavedGraphTheme,
	TrackingPeriod,
} from "src/types";
import {
	countChangedCharacters,
	isCountedUserEvent,
} from "./changeCounter";
import {
	isFileInTrackedFolders,
	migrateTrackedFolderPaths,
	normalizeTrackedFolders,
} from "./folderScope";
import {
	CountingPolicy,
	countingPoliciesEqual,
	DEFAULT_EDIT_ACTIVITY_SETTINGS,
	EditActivitySettings,
	EditActivityStore,
	EMPTY_EDIT_ACTIVITY_STORE,
	getCountingPolicy,
	migrateDocumentPaths,
	toDailyEditStats,
} from "./types";
import {
	classifyTrustedInputEvent,
	intentMatchesUserEvent,
	TrustedInputIntent,
} from "./trustedInput";
import { TimeTracker } from "../time/timeTracker";
import { addTimeSpan, createEmptyTimeActivity, getTimeTrackingState, normalizeTimeActivity, queryTimeStats, renameTimePaths } from "../time/timeData";
import { TimeSpan, TimeStatsQuery } from "../time/types";

interface CompositionState {
	startDocument: Text;
	startState: EditorState;
	endState: EditorState;
	changes: ChangeSet;
	filePath: string;
	cursorOffset: number;
	date: string;
}

interface PendingLineEdit {
	startDocument: Text;
	startState: EditorState;
	endState: EditorState;
	changes: ChangeSet;
	filePath: string;
	cursorOffset: number;
	lineNumber: number;
	date: string;
}

interface PendingInputIntent {
	intent: TrustedInputIntent;
}

export interface DailyEditStatsQuery {
	fromDate?: string;
	toDate?: string;
	folders?: string[];
}

export interface EditActivityChangeEvent {
	type: "STATS" | "SETTINGS" | "COVERAGE" | "TEMPORAL" | "IMPORT" | "TIME_STATS";
	date?: string;
	filePath?: string;
}

const SAVE_DEBOUNCE_MS = 2000;
const SAVE_RETRY_MS = 5000;
const MAX_SAVE_RETRIES = 3;
const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
const AUTOMATIC_BACKUP_PREFIX = "data.backup-";

export class EditActivityBackupError extends Error {
	constructor(message: string, readonly cause?: unknown) {
		super(message);
		this.name = "EditActivityBackupError";
	}
}

export class EditActivityService {
	private store: EditActivityStore = this.createEmptyStore();
	private listeners = new Set<(event: EditActivityChangeEvent) => void>();
	private saveTimer: number | null = null;
	private midnightTimer: number | null = null;
	private saveQueue: Promise<void> = Promise.resolve();
	private dirty = false;
	private mutationVersion = 0;
	private saveRetryCount = 0;
	private saveFailureNotified = false;
	private unloading = false;
	private cachedDailyStats = new Map<string, DailyEditStats>();
	private lastKnownDate = "";
	private lastKnownTimezoneOffset = 0;
	private compositions = new WeakMap<EditorView, CompositionState>();
	private compositionViews = new Set<EditorView>();
	private pendingLineEdits = new WeakMap<EditorView, PendingLineEdit>();
	private pendingLineViews = new Set<EditorView>();
	private processedTransactions = new WeakSet<Transaction>();
	private pendingInputIntents = new WeakMap<EditorView, PendingInputIntent>();
	private trustedCompositions = new WeakSet<EditorView>();
	private backupSequence = 0;
	private readonly now: () => Date;
	private readonly timeTracker: TimeTracker;
	private lastTimePath?: string;

	constructor(
		private readonly plugin: Plugin,
		now: () => Date = () => new Date(),
		monotonic: () => number = () => performance.now()
	) {
		this.now = now;
		this.timeTracker = new TimeTracker(span => this.recordTimeSpan(span), {
			wall: () => this.now().getTime(), monotonic,
		});
	}

	async initialize(): Promise<void> {
		let raw: unknown;
		let recoveredFromCorruption = false;
		try {
			raw = await this.plugin.loadData();
			this.store =
				raw === null || raw === undefined
					? this.createEmptyStore()
					: this.normalizeStore(raw, true);
		} catch (error) {
			console.error("Invalid edit activity data", error);
			const backupPath = await this.backupCorruptData(raw);
			this.store = raw
				? this.normalizeStore(raw, false)
				: this.createEmptyStore();
			recoveredFromCorruption = true;
			new Notice(
				Locals.get().settings_corrupt_data_recovered.replace(
					"{path}",
					backupPath || "data.json"
				)
			);
		}
		const schemaVersion = (raw as { schemaVersion?: unknown } | null)
			?.schemaVersion;
		let migrated =
			recoveredFromCorruption ||
			(raw !== null &&
				raw !== undefined &&
				schemaVersion !== EMPTY_EDIT_ACTIVITY_STORE.schemaVersion);
		if (this.store.settings.trackingEnabled) {
			migrated = this.ensureOpenTrackingPeriod() || migrated;
			migrated = this.ensureOpenCollectionScopePeriod() || migrated;
			migrated = this.ensureOpenCountingPolicyPeriod() || migrated;
		}
		if (migrated) {
			this.markDirty();
			this.scheduleSave();
		}
		this.captureTemporalState();
		this.timeTracker.setIdleTimeout(this.store.settings.idleTimeoutMinutes);
		if (this.store.settings.timeTrackingEnabled) this.openTimeCoverage();
		this.scheduleMidnightRefresh();
	}

	recordTimeActivity(path: string): void {
		this.lastTimePath = path;
		if (!this.store.settings.timeTrackingEnabled || !isFileInTrackedFolders(path, this.store.settings.trackedFolders)) {
			this.timeTracker.pause();
			return;
		}
		this.timeTracker.activity(path);
	}

	checkpointTimeActivity(): void {
		this.timeTracker.checkpoint();
		if (this.store.settings.timeTrackingEnabled) void this.flush();
	}

	pauseTimeActivity(): void {
		this.timeTracker.pause();
		this.lastTimePath = undefined;
	}

	getTimeTrackingStatus(): string {
		if (!this.store.settings.timeTrackingEnabled) return "时长统计：未启用";
		if (this.lastTimePath && !isFileInTrackedFolders(this.lastTimePath, this.store.settings.trackedFolders)) return "时长统计：笔记不在范围内";
		return this.timeTracker.getStatus() === "ACTIVE" ? "时长统计：计时中" : "时长统计：空闲暂停";
	}

	async setTimeTrackingEnabled(enabled: boolean): Promise<void> {
		if (enabled === this.store.settings.timeTrackingEnabled) return;
		this.pauseTimeActivity();
		this.closeTimeCoverage();
		this.store.settings.timeTrackingEnabled = enabled;
		if (enabled) this.openTimeCoverage();
		this.markDirty();
		this.emitChange({ type: "TIME_STATS" });
		await this.flush();
	}

	async setIdleTimeoutMinutes(minutes: number): Promise<void> {
		if (!Number.isSafeInteger(minutes) || minutes <= 0 || minutes > 10080) throw new Error("空闲阈值必须为 1—10080 的整数分钟");
		if (minutes === this.store.settings.idleTimeoutMinutes) return;
		this.timeTracker.setIdleTimeout(minutes);
		this.store.settings.idleTimeoutMinutes = minutes;
		this.store.timeActivity.policyChanges.push({ at: this.now().getTime(), idleTimeoutMinutes: minutes });
		this.markDirty();
		this.emitChange({ type: "TIME_STATS" });
		await this.flush();
	}

	getDailyTimeStats(query: TimeStatsQuery = {}) {
		return queryTimeStats(this.store.timeActivity, query, this.now().getTime(), false);
	}

	getHourlyTimeStats(query: TimeStatsQuery = {}) {
		return queryTimeStats(this.store.timeActivity, query, this.now().getTime(), true);
	}

	getTimeCellInfo(start: number, end: number, folders: string[] = []) {
		const now = this.now().getTime();
		return { trackingState: getTimeTrackingState(this.store.timeActivity, start, end, folders, now), future: start > now };
	}

	private recordTimeSpan(span: TimeSpan): void {
		addTimeSpan(this.store.timeActivity, span);
		this.markDirty();
		this.emitChange({ type: "TIME_STATS", filePath: span.path });
		this.scheduleSave();
	}

	private openTimeCoverage(): void {
		const periods = this.store.timeActivity.periods;
		if (periods.length && periods[periods.length - 1].end === undefined) return;
		periods.push({ start: this.now().getTime(), folders: [...this.store.settings.trackedFolders] });
		this.markDirty();
		this.scheduleSave();
	}

	private closeTimeCoverage(): void {
		const periods = this.store.timeActivity.periods;
		const last = periods[periods.length - 1];
		if (last && last.end === undefined) last.end = Math.max(last.start, this.now().getTime());
	}

	private resetTimeTrackingAfterReplacement(): void {
		this.timeTracker.setIdleTimeout(this.store.settings.idleTimeoutMinutes);
		this.closeTimeCoverage();
		if (this.store.settings.timeTrackingEnabled) this.openTimeCoverage();
	}

	createEditorExtension(): Extension {
		const service = this;
		const trustedInputObserver = ViewPlugin.define((view) => {
			const eventTypes = [
				"beforeinput",
				"paste",
				"cut",
				"drop",
				"keydown",
				"compositionstart",
				"compositionend",
				"blur",
			] as const;
			const listener: EventListener = (event) =>
				service.handleTrustedDomEvent(view, event);
			for (const eventType of eventTypes) {
				view.contentDOM.addEventListener(eventType, listener, true);
			}
			return {
				destroy() {
					for (const eventType of eventTypes) {
						view.contentDOM.removeEventListener(
							eventType,
							listener,
							true
						);
					}
					service.flushPendingEdits(view);
					service.clearTrustedInputState(view);
				},
			};
		});
		return [
			trustedInputObserver,
			EditorView.updateListener.of((update) =>
				this.handleEditorUpdate(update)
			),
		];
	}

	getSettings(): EditActivitySettings {
		return {
			...this.store.settings,
			trackedFolders: [...this.store.settings.trackedFolders],
		};
	}

	getGraphThemes(): SavedGraphTheme[] {
		return this.store.graphThemes.map((theme) => ({
			...theme,
			colors: [...theme.colors],
		}));
	}

	async saveGraphTheme(theme: SavedGraphTheme): Promise<SavedGraphTheme> {
		const normalized = this.normalizeSavedGraphTheme(theme);
		if (!normalized) {
			throw new Error("Invalid graph theme");
		}
		const duplicate = this.store.graphThemes.findIndex(
			(candidate) =>
				candidate.id === normalized.id ||
				candidate.name.toLocaleLowerCase() ===
					normalized.name.toLocaleLowerCase()
		);
		if (duplicate >= 0) {
			this.store.graphThemes[duplicate] = normalized;
		} else {
			if (this.store.graphThemes.length >= 30) {
				throw new Error("Graph theme limit reached");
			}
			this.store.graphThemes.push(normalized);
		}
		this.markDirty();
		await this.flush();
		return { ...normalized, colors: [...normalized.colors] };
	}

	async deleteGraphTheme(id: string): Promise<void> {
		const next = this.store.graphThemes.filter((theme) => theme.id !== id);
		if (next.length === this.store.graphThemes.length) {
			return;
		}
		this.store.graphThemes = next;
		this.markDirty();
		await this.flush();
	}

	getTrackingPeriods(): TrackingPeriod[] {
		return this.store.trackingPeriods.map((period) => ({ ...period }));
	}

	getCollectionScopePeriods(): CollectionScopePeriod[] {
		return this.store.collectionScopePeriods.map((period) => ({
			...period,
			folders: [...period.folders],
		}));
	}

	getDailyEditStats(query: DailyEditStatsQuery = {}): DailyEditStats[] {
		return Object.keys(this.store.dailyStats)
			.filter((date) => {
				if (query.fromDate && date < query.fromDate) {
					return false;
				}
				if (query.toDate && date > query.toDate) {
					return false;
				}
				return true;
			})
			.sort((a, b) => a.localeCompare(b))
			.map((date) => this.getCachedDailyEditStats(date))
			.map((stats) => this.filterStatsByFolders(stats, query.folders));
	}

	subscribe(listener: (event: EditActivityChangeEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	handlePathRename(
		oldPath: string,
		newPath: string,
		isFolder: boolean
	): void {
		this.pauseTimeActivity();
		const timeChanged = renameTimePaths(this.store.timeActivity, oldPath, newPath, isFolder);
		this.flushAllPendingEdits();
		const changedDates = migrateDocumentPaths(
			this.store.dailyStats,
			oldPath,
			newPath,
			isFolder
		);
		let trackedFoldersChanged = false;
		let scopeFoldersChanged = false;
		if (isFolder) {
			const trackedFolders = migrateTrackedFolderPaths(
				this.store.settings.trackedFolders,
				oldPath,
				newPath
			);
			trackedFoldersChanged =
				trackedFolders.join("\n") !==
				this.store.settings.trackedFolders.join("\n");
			if (trackedFoldersChanged) {
				this.store.settings.trackedFolders = trackedFolders;
			}
			for (const period of this.store.collectionScopePeriods) {
				const migratedFolders = migrateTrackedFolderPaths(
					period.folders,
					oldPath,
					newPath
				);
				if (
					migratedFolders.join("\n") !==
					period.folders.join("\n")
				) {
					period.folders = migratedFolders;
					scopeFoldersChanged = true;
				}
			}
		}
		if (
			changedDates.length === 0 &&
			!trackedFoldersChanged &&
			!scopeFoldersChanged && !timeChanged
		) {
			return;
		}
		for (const date of changedDates) {
			this.invalidateStatsCache(date);
		}
		this.markDirty();
		this.emitChange({ type: "IMPORT" });
		this.scheduleSave();
	}

	async setTrackingEnabled(enabled: boolean): Promise<void> {
		if (this.store.settings.trackingEnabled === enabled) {
			return;
		}

		this.flushAllPendingEdits();
		this.store.settings.trackingEnabled = enabled;
		this.resetTrustedInputState();
		if (enabled) {
			this.ensureOpenTrackingPeriod();
			this.ensureOpenCollectionScopePeriod();
			this.ensureOpenCountingPolicyPeriod();
		} else {
			this.closeOpenTrackingPeriod();
			this.closeOpenCollectionScopePeriod();
			this.closeOpenCountingPolicyPeriod();
		}
		this.markDirty();
		this.emitChange({ type: "COVERAGE" });
		await this.flush();
	}

	async setExcludeWhitespace(excludeWhitespace: boolean): Promise<void> {
		if (this.store.settings.excludeWhitespace === excludeWhitespace) {
			return;
		}
		this.beginCountingPolicyChange();
		this.store.settings.excludeWhitespace = excludeWhitespace;
		this.finishCountingPolicyChange();
		this.resetTrustedInputState();
		this.markDirty();
		this.emitChange({ type: "SETTINGS" });
		await this.flush();
	}

	async setExcludeMarkdownFormatting(
		excludeMarkdownFormatting: boolean
	): Promise<void> {
		if (
			this.store.settings.excludeMarkdownFormatting ===
			excludeMarkdownFormatting
		) {
			return;
		}
		this.beginCountingPolicyChange();
		this.store.settings.excludeMarkdownFormatting =
			excludeMarkdownFormatting;
		this.finishCountingPolicyChange();
		this.resetTrustedInputState();
		this.markDirty();
		this.emitChange({ type: "SETTINGS" });
		await this.flush();
	}

	async setStrictUserInputOnly(strictUserInputOnly: boolean): Promise<void> {
		if (
			this.store.settings.strictUserInputOnly === strictUserInputOnly
		) {
			return;
		}
		this.beginCountingPolicyChange();
		this.store.settings.strictUserInputOnly = strictUserInputOnly;
		this.finishCountingPolicyChange();
		this.resetTrustedInputState();
		this.markDirty();
		this.emitChange({ type: "SETTINGS" });
		await this.flush();
	}

	async setCountPastedText(countPastedText: boolean): Promise<void> {
		if (this.store.settings.countPastedText === countPastedText) {
			return;
		}
		this.beginCountingPolicyChange();
		this.store.settings.countPastedText = countPastedText;
		this.finishCountingPolicyChange();
		this.resetTrustedInputState();
		this.markDirty();
		this.emitChange({ type: "SETTINGS" });
		await this.flush();
	}

	async setTrackedFolders(trackedFolders: string[]): Promise<void> {
		const normalized = normalizeTrackedFolders(trackedFolders);
		if (
			normalized.length === this.store.settings.trackedFolders.length &&
			normalized.every(
				(folder, index) =>
					folder === this.store.settings.trackedFolders[index]
			)
		) {
			return;
		}
		this.pauseTimeActivity();
		this.closeTimeCoverage();
		this.flushAllPendingEdits();
		this.store.settings.trackedFolders = normalized;
		if (this.store.settings.timeTrackingEnabled) this.openTimeCoverage();
		this.resetTrustedInputState();
		if (this.store.settings.trackingEnabled) {
			this.closeOpenCollectionScopePeriod();
			this.ensureOpenCollectionScopePeriod();
		}
		this.markDirty();
		this.emitChange({ type: "COVERAGE" });
		await this.flush();
	}

	exportData(): string {
		this.checkpointTimeActivity();
		return JSON.stringify(this.store, null, 2);
	}

	async importData(serialized: string): Promise<void> {
		if (new TextEncoder().encode(serialized).byteLength > MAX_IMPORT_BYTES) {
			throw new Error("统计数据导入超过 100 MB");
		}
		this.flushAllPendingEdits();
		const parsed = JSON.parse(serialized);
		const importedStore = this.normalizeStore(parsed, true);
		this.pauseTimeActivity();
		await this.createAutomaticBackup("import");
		this.store = importedStore;
		this.resetTimeTrackingAfterReplacement();
		this.resetTrustedInputState();
		if (this.store.settings.trackingEnabled) {
			this.ensureOpenTrackingPeriod();
			this.ensureOpenCollectionScopePeriod();
			this.ensureOpenCountingPolicyPeriod();
		}
		this.invalidateStatsCache();
		this.markDirty();
		this.emitChange({ type: "IMPORT" });
		await this.flush();
	}

	async clearData(): Promise<void> {
		this.pauseTimeActivity();
		this.flushAllPendingEdits();
		await this.createAutomaticBackup("clear");
		this.store.timeActivity = createEmptyTimeActivity();
		this.resetTimeTrackingAfterReplacement();
		const trackingEnabled = this.store.settings.trackingEnabled;
		this.store.dailyStats = Object.create(null);
		this.store.trackingPeriods = trackingEnabled
			? [{ startDate: this.today() }]
			: [];
		this.store.collectionScopePeriods = trackingEnabled
			? [
					{
						startDate: this.today(),
						folders: [
							...this.store.settings.trackedFolders,
						],
					},
			  ]
			: [];
		this.store.countingPolicyPeriods = trackingEnabled
			? [
					{
						startedAt: this.now().toISOString(),
						policy: getCountingPolicy(this.store.settings),
					},
			  ]
			: [];
		this.invalidateStatsCache();
		this.markDirty();
		this.emitChange({ type: "IMPORT" });
		await this.flush();
	}

	async getLatestBackupPath(): Promise<string | undefined> {
		const pluginDir = this.plugin.manifest.dir;
		if (!pluginDir) {
			return undefined;
		}
		try {
			const listing = await this.plugin.app.vault.adapter.list(pluginDir);
			return listing.files
				.filter((path) => {
					const name = path.split("/").pop() || "";
					return (
						name.startsWith(AUTOMATIC_BACKUP_PREFIX) &&
						name.endsWith(".json")
					);
				})
				.sort((a, b) => b.localeCompare(a))[0];
		} catch (error) {
			throw new EditActivityBackupError(
				"Failed to list edit activity backups",
				error
			);
		}
	}

	async restoreLatestBackup(): Promise<string | undefined> {
		this.pauseTimeActivity();
		this.flushAllPendingEdits();
		const backupPath = await this.getLatestBackupPath();
		if (!backupPath) {
			return undefined;
		}

		let restoredStore: EditActivityStore;
		try {
			const serialized = await this.plugin.app.vault.adapter.read(
				backupPath
			);
			restoredStore = this.normalizeStore(
				JSON.parse(serialized),
				true
			);
		} catch (error) {
			throw new EditActivityBackupError(
				"Failed to read edit activity backup",
				error
			);
		}

		await this.createAutomaticBackup("restore");
		this.store = restoredStore;
		this.resetTimeTrackingAfterReplacement();
		this.resetTrustedInputState();
		if (this.store.settings.trackingEnabled) {
			this.ensureOpenTrackingPeriod();
			this.ensureOpenCollectionScopePeriod();
			this.ensureOpenCountingPolicyPeriod();
		}
		this.invalidateStatsCache();
		this.markDirty();
		this.emitChange({ type: "IMPORT" });
		await this.flush();
		return backupPath;
	}

	handleAppResume(): void {
		this.scheduleMidnightRefresh();
		if (this.captureTemporalState()) {
			this.emitChange({ type: "TEMPORAL" });
		}
		void this.flush();
	}

	handleAppSuspend(): void {
		this.pauseTimeActivity();
		this.flushAllPendingEdits();
		void this.flush();
	}

	async flush(): Promise<void> {
		this.timeTracker.checkpoint();
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}

		if (!this.dirty) {
			await this.saveQueue.catch(() => undefined);
			return;
		}

		const snapshot = JSON.parse(JSON.stringify(this.store));
		const snapshotVersion = this.mutationVersion;
		this.dirty = false;
		const write = this.saveQueue
			.catch(() => undefined)
			.then(() => this.plugin.saveData(snapshot));
		this.saveQueue = write;
		try {
			await write;
			this.saveRetryCount = 0;
			this.saveFailureNotified = false;
		} catch (error) {
			if (this.mutationVersion === snapshotVersion) {
				this.dirty = true;
			}
			console.error("Failed to save edit activity data", error);
			if (!this.saveFailureNotified) {
				this.saveFailureNotified = true;
				new Notice(Locals.get().settings_save_failed);
			}
			if (
				!this.unloading &&
				this.saveRetryCount < MAX_SAVE_RETRIES
			) {
				this.saveRetryCount++;
				this.scheduleSave(SAVE_RETRY_MS);
			}
		}
	}

	async unload(): Promise<void> {
		this.unloading = true;
		this.pauseTimeActivity();
		this.closeTimeCoverage();
		if (this.store.settings.timeTrackingEnabled) this.markDirty();
		if (this.midnightTimer !== null) {
			window.clearTimeout(this.midnightTimer);
			this.midnightTimer = null;
		}
		this.flushAllPendingEdits();
		this.resetTrustedInputState();
		await this.flush();
		this.listeners.clear();
	}

	private handleEditorUpdate(update: ViewUpdate): void {
		if (!this.store.settings.trackingEnabled) {
			return;
		}
		if (!update.docChanged) {
			if (update.selectionSet) {
				this.flushLineEditIfCursorMoved(update.view, update.state);
			}
			return;
		}
		if (!update.view.hasFocus) {
			this.flushPendingEdits(update.view);
			return;
		}

		for (const transaction of update.transactions) {
			if (
				!transaction.docChanged ||
				this.processedTransactions.has(transaction)
			) {
				continue;
			}
			this.processedTransactions.add(transaction);

			const event = transaction.annotation(Transaction.userEvent) || "";
			const filePath = this.getMarkdownFilePath(transaction);
			if (
				!filePath ||
				!isFileInTrackedFolders(
					filePath,
					this.store.settings.trackedFolders
				)
			) {
				this.flushPendingEdits(update.view);
				this.clearTrustedInputState(update.view);
				continue;
			}
			const shouldCount = this.shouldCountTransaction(
				update.view,
				transaction,
				event
			);
			if (event.startsWith("input.type.compose")) {
				if (shouldCount) {
					this.accumulateComposition(
						update.view,
						transaction,
						filePath
					);
				} else {
					this.compositions.delete(update.view);
					this.compositionViews.delete(update.view);
					this.flushLineEdit(update.view);
				}
				continue;
			}

			this.flushComposition(update.view);
			if (shouldCount) {
				this.queueOrRecordChanges(
					update.view,
					transaction.startState,
					transaction.state,
					transaction.changes,
					filePath,
					transaction.newSelection.main.head
				);
			} else {
				this.flushLineEdit(update.view);
			}
		}

		if (!update.view.composing) {
			this.flushComposition(update.view);
		}
	}

	private handleTrustedDomEvent(view: EditorView, event: Event): void {
		if (
			!this.store.settings.trackingEnabled ||
			!event.isTrusted
		) {
			return;
		}
		if (event.type === "blur") {
			this.flushPendingEdits(view);
			this.clearTrustedInputState(view);
			return;
		}
		if (event.type === "compositionstart") {
			if (!this.store.settings.strictUserInputOnly) {
				return;
			}
			this.trustedCompositions.add(view);
			this.pendingInputIntents.delete(view);
			return;
		}
		if (event.type === "compositionend") {
			if (!this.store.settings.strictUserInputOnly) {
				return;
			}
			window.setTimeout(() => this.trustedCompositions.delete(view), 0);
			return;
		}
		const intent = classifyTrustedInputEvent(
			event as Event & {
				inputType?: string;
				key?: string;
				ctrlKey?: boolean;
				metaKey?: boolean;
				altKey?: boolean;
			}
		);
		if (!intent) {
			return;
		}
		if (
			!this.store.settings.strictUserInputOnly &&
			(this.store.settings.countPastedText || intent !== "PASTE")
		) {
			return;
		}
		const pending = {
			intent,
		};
		this.pendingInputIntents.set(view, pending);
		window.setTimeout(() => {
			if (this.pendingInputIntents.get(view) === pending) {
				this.pendingInputIntents.delete(view);
			}
		}, 0);
	}

	private shouldCountTransaction(
		view: EditorView,
		transaction: Transaction,
		userEvent: string
	): boolean {
		if (
			transaction.annotation(Transaction.remote) === true ||
			!isCountedUserEvent(userEvent)
		) {
			return false;
		}

		const pending = this.pendingInputIntents.get(view);
		if (
			!this.store.settings.countPastedText &&
			(userEvent === "input.paste" ||
				userEvent.startsWith("input.paste.") ||
				pending?.intent === "PASTE")
		) {
			if (pending?.intent === "PASTE") {
				this.pendingInputIntents.delete(view);
			}
			return false;
		}
		if (!this.store.settings.strictUserInputOnly) {
			return true;
		}

		if (pending && intentMatchesUserEvent(pending.intent, userEvent)) {
			this.pendingInputIntents.delete(view);
			return true;
		}
		return (
			userEvent.startsWith("input.type.compose") &&
			this.trustedCompositions.has(view)
		);
	}

	private clearTrustedInputState(view: EditorView): void {
		this.pendingInputIntents.delete(view);
		this.trustedCompositions.delete(view);
		this.compositions.delete(view);
		this.compositionViews.delete(view);
	}

	private resetTrustedInputState(): void {
		this.pendingInputIntents = new WeakMap<EditorView, PendingInputIntent>();
		this.trustedCompositions = new WeakSet<EditorView>();
		this.compositions = new WeakMap<EditorView, CompositionState>();
		this.compositionViews.clear();
	}

	private accumulateComposition(
		view: EditorView,
		transaction: Transaction,
		filePath: string
	): void {
		let existing = this.compositions.get(view);
		const date = this.today();
		if (
			existing &&
			(existing.filePath !== filePath || existing.date !== date)
		) {
			this.flushComposition(view);
			existing = undefined;
		}
		if (!existing) {
			this.compositions.set(view, {
				startDocument: transaction.startState.doc,
				startState: transaction.startState,
				endState: transaction.state,
				changes: transaction.changes,
				filePath,
				cursorOffset: transaction.newSelection.main.head,
				date,
			});
			this.compositionViews.add(view);
			return;
		}

		existing.changes = existing.changes.compose(transaction.changes);
		existing.endState = transaction.state;
		existing.cursorOffset = transaction.newSelection.main.head;
	}

	private flushComposition(view: EditorView): void {
		const composition = this.compositions.get(view);
		if (!composition) {
			return;
		}
		this.compositions.delete(view);
		this.compositionViews.delete(view);
		this.queueOrRecordChanges(
			view,
			composition.startState,
			composition.endState,
			composition.changes,
			composition.filePath,
			composition.cursorOffset,
			composition.date
		);
	}

	private queueOrRecordChanges(
		view: EditorView,
		startState: EditorState,
		endState: EditorState,
		changes: ChangeSet,
		filePath: string,
		cursorOffset: number,
		date = this.today()
	): void {
		if (!this.store.settings.excludeMarkdownFormatting) {
			this.recordChanges(
				startState.doc,
				changes,
				filePath,
				cursorOffset,
				startState,
				endState,
				date
			);
			return;
		}

		let pending = this.pendingLineEdits.get(view);
		const startLineNumber = startState.doc.lineAt(
			startState.selection.main.head
		).number;
		if (
			pending &&
			(pending.filePath !== filePath ||
				pending.endState !== startState ||
				pending.date !== date ||
				pending.lineNumber !== startLineNumber)
		) {
			this.flushLineEdit(view);
			pending = undefined;
		}

		if (pending) {
			pending.changes = pending.changes.compose(changes);
			pending.endState = endState;
			pending.cursorOffset = cursorOffset;
			pending.lineNumber = endState.doc.lineAt(cursorOffset).number;
		} else {
			this.pendingLineEdits.set(view, {
				startDocument: startState.doc,
				startState,
				endState,
				changes,
				filePath,
				cursorOffset,
				lineNumber: endState.doc.lineAt(cursorOffset).number,
				date,
			});
			this.pendingLineViews.add(view);
		}

		if (this.changesLineStructure(startState.doc, changes)) {
			this.flushLineEdit(view);
		}
	}

	private changesLineStructure(document: Text, changes: ChangeSet): boolean {
		let changesLines = false;
		changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
			if (
				document.sliceString(fromA, toA).includes("\n") ||
				inserted.toString().includes("\n")
			) {
				changesLines = true;
			}
		});
		return changesLines;
	}

	private flushLineEditIfCursorMoved(
		view: EditorView,
		state: EditorState
	): void {
		const pending = this.pendingLineEdits.get(view);
		if (
			pending &&
			state.doc.lineAt(state.selection.main.head).number !==
				pending.lineNumber
		) {
			this.flushLineEdit(view);
		}
	}

	private flushLineEdit(view: EditorView): void {
		const pending = this.pendingLineEdits.get(view);
		if (!pending) {
			return;
		}
		this.pendingLineEdits.delete(view);
		this.pendingLineViews.delete(view);
		this.recordChanges(
			pending.startDocument,
			pending.changes,
			pending.filePath,
			pending.cursorOffset,
			pending.startState,
			pending.endState,
			pending.date
		);
	}

	private flushPendingEdits(view: EditorView): void {
		this.flushComposition(view);
		this.flushLineEdit(view);
	}

	private flushAllPendingEdits(): void {
		for (const view of [...this.compositionViews]) {
			this.flushComposition(view);
		}
		for (const view of [...this.pendingLineViews]) {
			this.flushLineEdit(view);
		}
	}

	private recordChanges(
		startDocument: Text,
		changes: ChangeSet,
		filePath: string,
		cursorOffset: number,
		startState?: EditorState,
		endState?: EditorState,
		date = this.today()
	): void {
		const options = {
			excludeWhitespace: this.store.settings.excludeWhitespace,
			excludeMarkdownFormatting:
				this.store.settings.excludeMarkdownFormatting,
		};
		const { addedChars, deletedChars } = countChangedCharacters(
			startDocument,
			changes,
			options,
			startState && endState ? { startState, endState } : undefined
		);

		if (addedChars === 0 && deletedChars === 0) {
			return;
		}

		const current = this.store.dailyStats[date] || {
			addedChars: 0,
			deletedChars: 0,
			documents: Object.create(null),
		};
		current.addedChars += addedChars;
		current.deletedChars += deletedChars;
		const document = current.documents[filePath] || {
			addedChars: 0,
			deletedChars: 0,
		};
		document.addedChars += addedChars;
		document.deletedChars += deletedChars;
		const finalDocument = changes.apply(startDocument);
		const safeCursorOffset = Math.max(
			0,
			Math.min(cursorOffset, finalDocument.length)
		);
		const line = finalDocument.lineAt(safeCursorOffset);
		document.lastEditPosition = {
			line: line.number - 1,
			column: safeCursorOffset - line.from,
		};
		current.documents[filePath] = document;
		this.store.dailyStats[date] = current;
		this.invalidateStatsCache(date);
		this.markDirty();
		this.emitChange({ type: "STATS", date, filePath });
		this.scheduleSave();
	}

	private scheduleSave(delay = SAVE_DEBOUNCE_MS): void {
		if (this.unloading) {
			return;
		}
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
		}
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.flush();
		}, delay);
	}

	private scheduleMidnightRefresh(): void {
		if (this.midnightTimer !== null) {
			window.clearTimeout(this.midnightTimer);
		}

		const now = this.now();
		const nextMidnight = new Date(now);
		nextMidnight.setHours(24, 0, 0, 50);
		const delay = Math.max(50, nextMidnight.getTime() - now.getTime());
		this.midnightTimer = window.setTimeout(() => {
			this.midnightTimer = null;
			this.captureTemporalState();
			this.emitChange({ type: "TEMPORAL" });
			this.scheduleMidnightRefresh();
		}, delay);
	}

	private emitChange(event: EditActivityChangeEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch (error) {
				console.error("Failed to refresh contribution graph", error);
			}
		}
	}

	private ensureOpenTrackingPeriod(): boolean {
		const last =
			this.store.trackingPeriods[this.store.trackingPeriods.length - 1];
		if (!last || last.endDate) {
			this.store.trackingPeriods.push({ startDate: this.today() });
			return true;
		}
		return false;
	}

	private closeOpenTrackingPeriod(): void {
		const last =
			this.store.trackingPeriods[this.store.trackingPeriods.length - 1];
		if (last && !last.endDate) {
			last.endDate = this.today();
		}
	}

	private ensureOpenCollectionScopePeriod(): boolean {
		const last =
			this.store.collectionScopePeriods[
				this.store.collectionScopePeriods.length - 1
			];
		const folders = this.store.settings.trackedFolders;
		if (
			!last ||
			last.endDate ||
			last.folders.join("\n") !== folders.join("\n")
		) {
			if (
				last &&
				!last.endDate &&
				last.folders.join("\n") !== folders.join("\n")
			) {
				last.endDate = this.today();
			}
			this.store.collectionScopePeriods.push({
				startDate: this.today(),
				folders: [...folders],
			});
			return true;
		}
		return false;
	}

	private closeOpenCollectionScopePeriod(): void {
		const last =
			this.store.collectionScopePeriods[
				this.store.collectionScopePeriods.length - 1
			];
		if (last && !last.endDate) {
			last.endDate = this.today();
		}
	}

	private beginCountingPolicyChange(): void {
		this.flushAllPendingEdits();
		if (this.store.settings.trackingEnabled) {
			this.closeOpenCountingPolicyPeriod();
		}
	}

	private finishCountingPolicyChange(): void {
		if (this.store.settings.trackingEnabled) {
			this.ensureOpenCountingPolicyPeriod();
		}
		this.invalidateStatsCache(this.today());
	}

	private ensureOpenCountingPolicyPeriod(): boolean {
		const policy = getCountingPolicy(this.store.settings);
		const last =
			this.store.countingPolicyPeriods[
				this.store.countingPolicyPeriods.length - 1
			];
		if (last && !last.endedAt && countingPoliciesEqual(last.policy, policy)) {
			return false;
		}
		if (last && !last.endedAt) {
			last.endedAt = this.now().toISOString();
		}
		this.store.countingPolicyPeriods.push({
			startedAt: this.now().toISOString(),
			policy,
		});
		return true;
	}

	private closeOpenCountingPolicyPeriod(): void {
		const last =
			this.store.countingPolicyPeriods[
				this.store.countingPolicyPeriods.length - 1
			];
		if (last && !last.endedAt) {
			last.endedAt = this.now().toISOString();
		}
	}

	private today(): string {
		const date = this.now();
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const day = String(date.getDate()).padStart(2, "0");
		return `${year}-${month}-${day}`;
	}

	private captureTemporalState(): boolean {
		const now = this.now();
		const date = this.formatLocalDate(now);
		const timezoneOffset = now.getTimezoneOffset();
		const changed =
			this.lastKnownDate !== "" &&
			(date !== this.lastKnownDate ||
				timezoneOffset !== this.lastKnownTimezoneOffset);
		this.lastKnownDate = date;
		this.lastKnownTimezoneOffset = timezoneOffset;
		return changed;
	}

	private formatLocalDate(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const day = String(date.getDate()).padStart(2, "0");
		return `${year}-${month}-${day}`;
	}

	private getCachedDailyEditStats(date: string): DailyEditStats {
		let stats = this.cachedDailyStats.get(date);
		if (!stats) {
			const converted = toDailyEditStats(
				date,
				this.store.dailyStats[date]
			);
			converted.countingPolicyChanged =
				this.hasMultipleCountingPolicies(date);
			stats = this.freezeDailyEditStats(
				converted
			);
			this.cachedDailyStats.set(date, stats);
		}
		return stats;
	}

	private filterStatsByFolders(
		stats: DailyEditStats,
		folders?: string[]
	): DailyEditStats {
		const normalizedFolders = normalizeTrackedFolders(folders || []);
		if (normalizedFolders.length === 0) {
			return stats;
		}
		const documents = stats.documents.filter((document) =>
			isFileInTrackedFolders(document.path, normalizedFolders)
		);
		const addedChars = documents.reduce(
			(sum, document) => sum + document.addedChars,
			0
		);
		const deletedChars = documents.reduce(
			(sum, document) => sum + document.deletedChars,
			0
		);
		return this.freezeDailyEditStats({
			date: stats.date,
			addedChars,
			deletedChars,
			changedChars: addedChars + deletedChars,
			documents: [...documents],
			unattributedAddedChars: stats.unattributedAddedChars,
			unattributedDeletedChars: stats.unattributedDeletedChars,
			countingPolicyChanged: stats.countingPolicyChanged,
		});
	}

	private hasMultipleCountingPolicies(date: string): boolean {
		const [year, month, day] = date.split("-").map(Number);
		const dayStart = new Date(year, month - 1, day).getTime();
		const nextDay = new Date(year, month - 1, day + 1).getTime();
		const policies = new Set<string>();
		for (const period of this.store.countingPolicyPeriods) {
			const startedAt = Date.parse(period.startedAt);
			const endedAt = period.endedAt
				? Date.parse(period.endedAt)
				: Number.POSITIVE_INFINITY;
			if (startedAt < nextDay && endedAt > dayStart) {
				policies.add(JSON.stringify(period.policy));
			}
		}
		return policies.size > 1;
	}

	private freezeDailyEditStats(stats: DailyEditStats): DailyEditStats {
		for (const document of stats.documents) {
			if (document.lastEditPosition) {
				Object.freeze(document.lastEditPosition);
			}
			Object.freeze(document);
		}
		Object.freeze(stats.documents);
		return Object.freeze(stats);
	}

	private invalidateStatsCache(date?: string): void {
		if (date) {
			this.cachedDailyStats.delete(date);
		} else {
			this.cachedDailyStats.clear();
		}
	}

	private markDirty(): void {
		this.dirty = true;
		this.mutationVersion++;
	}

	private getMarkdownFilePath(transaction: Transaction): string | undefined {
		const file = transaction.startState.field(editorInfoField, false)?.file;
		if (!file || file.extension.toLowerCase() !== "md") {
			return undefined;
		}
		return file.path;
	}

	private createEmptyStore(): EditActivityStore {
		return {
			schemaVersion: EMPTY_EDIT_ACTIVITY_STORE.schemaVersion,
			timeActivity: createEmptyTimeActivity(),
			settings: {
				...DEFAULT_EDIT_ACTIVITY_SETTINGS,
				trackedFolders: [],
			},
			graphThemes: [],
			trackingPeriods: [],
			collectionScopePeriods: [],
			countingPolicyPeriods: [],
			dailyStats: Object.create(null),
		};
	}

	private normalizeStore(raw: unknown, strict = false): EditActivityStore {
		if (!raw || typeof raw !== "object") {
			if (strict) {
				throw new Error("Invalid edit activity data");
			}
			return this.createEmptyStore();
		}

		const candidate = raw as Partial<EditActivityStore>;
		const schemaVersion = (raw as { schemaVersion?: unknown })
			.schemaVersion;
		const numericSchemaVersion =
			typeof schemaVersion === "number" ? schemaVersion : 0;
		if (
			strict &&
			(!Number.isSafeInteger(numericSchemaVersion) ||
				numericSchemaVersion < 1 ||
				numericSchemaVersion > 11)
		) {
			throw new Error("Unsupported edit activity data version");
		}

		if (
			strict &&
			(!candidate.dailyStats ||
				typeof candidate.dailyStats !== "object" ||
				Array.isArray(candidate.dailyStats))
		) {
			throw new Error("Invalid daily edit statistics");
		}

		const dailyStats: EditActivityStore["dailyStats"] =
			Object.create(null);
		const rawDailyStats =
			candidate.dailyStats &&
			typeof candidate.dailyStats === "object" &&
			!Array.isArray(candidate.dailyStats)
				? candidate.dailyStats
				: {};
		for (const [date, value] of Object.entries(rawDailyStats)) {
			const item = value as {
				addedChars?: unknown;
				deletedChars?: unknown;
				documents?: unknown;
			};
			if (
				this.isValidDate(date) &&
				this.isValidCount(item.addedChars) &&
				this.isValidCount(item.deletedChars)
			) {
				const documents: EditActivityStore["dailyStats"][string]["documents"] =
					Object.create(null);
				let documentAddedChars = 0;
				let documentDeletedChars = 0;
				if (
					item.documents &&
					typeof item.documents === "object" &&
					!Array.isArray(item.documents)
				) {
					for (const [path, documentValue] of Object.entries(
						item.documents
					)) {
						const document = documentValue as {
							addedChars?: unknown;
							deletedChars?: unknown;
							lastEditPosition?: unknown;
						};
						if (
							path.length > 0 &&
							!path.includes("\u0000") &&
							this.isValidCount(document.addedChars) &&
							this.isValidCount(document.deletedChars)
						) {
							const lastEditPosition =
								this.normalizeEditPosition(
									document.lastEditPosition
								);
							if (
								strict &&
								document.lastEditPosition !== undefined &&
								!lastEditPosition
							) {
								throw new Error(
									`Invalid last edit position for ${date}: ${path}`
								);
							}
							documents[path] = {
								addedChars: document.addedChars,
								deletedChars: document.deletedChars,
								lastEditPosition,
							};
							documentAddedChars += document.addedChars;
							documentDeletedChars += document.deletedChars;
						} else if (strict) {
							throw new Error(
								`Invalid document edit statistics for ${date}: ${path}`
							);
						}
					}
				} else if (strict && numericSchemaVersion >= 2) {
					throw new Error(
						`Invalid document edit statistics for ${date}`
					);
				}

				if (
					documentAddedChars > item.addedChars ||
					documentDeletedChars > item.deletedChars
				) {
					if (strict) {
						throw new Error(
							`Document totals exceed daily statistics for ${date}`
						);
					}
					continue;
				}

				dailyStats[date] = {
					addedChars: item.addedChars,
					deletedChars: item.deletedChars,
					documents,
				};
			} else if (strict) {
				throw new Error(`Invalid daily edit statistics for ${date}`);
			}
		}

		if (strict && !Array.isArray(candidate.trackingPeriods)) {
			throw new Error("Invalid tracking periods");
		}
		const trackingPeriods: TrackingPeriod[] = [];
		for (const period of Array.isArray(candidate.trackingPeriods)
			? candidate.trackingPeriods
			: []) {
			if (
				period &&
				this.isValidDate(period.startDate) &&
				(!period.endDate ||
					(this.isValidDate(period.endDate) &&
						period.startDate <= period.endDate))
			) {
				trackingPeriods.push({ ...period });
			} else if (strict) {
				throw new Error("Invalid tracking period");
			}
		}

		if (
			strict &&
			(!candidate.settings ||
				typeof candidate.settings.trackingEnabled !== "boolean" ||
				typeof candidate.settings.excludeWhitespace !== "boolean")
		) {
			throw new Error("Invalid edit activity settings");
		}
		const rawTrackedFolders = candidate.settings?.trackedFolders;
		if (
			strict &&
			numericSchemaVersion >= 4 &&
			(!Array.isArray(rawTrackedFolders) ||
				rawTrackedFolders.some(
					(folder) => typeof folder !== "string"
				))
		) {
			throw new Error("Invalid tracked folders");
		}
		const trackedFolders = normalizeTrackedFolders(
			Array.isArray(rawTrackedFolders)
				? rawTrackedFolders.filter(
						(folder): folder is string =>
							typeof folder === "string"
				  )
				: []
		);
		if (
			strict &&
			numericSchemaVersion >= 6 &&
			typeof candidate.settings?.strictUserInputOnly !== "boolean"
		) {
			throw new Error("Invalid strict input setting");
		}
		if (
			strict &&
			numericSchemaVersion >= 7 &&
			typeof candidate.settings?.countPastedText !== "boolean"
		) {
			throw new Error("Invalid paste input setting");
		}
		if (
			strict &&
			numericSchemaVersion >= 8 &&
			typeof candidate.settings?.excludeMarkdownFormatting !==
				"boolean"
		) {
			throw new Error("Invalid Markdown formatting setting");
		}
		if (
			strict &&
			numericSchemaVersion >= 5 &&
			!Array.isArray(candidate.collectionScopePeriods)
		) {
			throw new Error("Invalid collection scope periods");
		}
		const collectionScopePeriods: CollectionScopePeriod[] = [];
		if (
			numericSchemaVersion >= 5 &&
			Array.isArray(candidate.collectionScopePeriods)
		) {
			for (const period of candidate.collectionScopePeriods) {
				if (
					period &&
					this.isValidDate(period.startDate) &&
					(!period.endDate ||
						(this.isValidDate(period.endDate) &&
							period.startDate <= period.endDate)) &&
					Array.isArray(period.folders) &&
					period.folders.every(
						(folder) => typeof folder === "string"
					)
				) {
					collectionScopePeriods.push({
						startDate: period.startDate,
						...(period.endDate
							? { endDate: period.endDate }
							: {}),
						folders: normalizeTrackedFolders(period.folders),
					});
				} else if (strict) {
					throw new Error("Invalid collection scope period");
				}
			}
		} else {
			const migratedFolders =
				schemaVersion === 4 ? trackedFolders : [];
			for (const period of trackingPeriods) {
				collectionScopePeriods.push({
					...period,
					folders: [...migratedFolders],
				});
			}
		}

		if (
			strict &&
			numericSchemaVersion >= 9 &&
			!Array.isArray(candidate.countingPolicyPeriods)
		) {
			throw new Error("Invalid counting policy periods");
		}
		const countingPolicyPeriods: EditActivityStore["countingPolicyPeriods"] = [];
		if (
			numericSchemaVersion >= 9 &&
			Array.isArray(candidate.countingPolicyPeriods)
		) {
			for (const period of candidate.countingPolicyPeriods) {
				const policy = this.normalizeCountingPolicy(period?.policy);
				if (
					period &&
					this.isValidTimestamp(period.startedAt) &&
					(!period.endedAt ||
						(this.isValidTimestamp(period.endedAt) &&
							Date.parse(period.startedAt) <=
								Date.parse(period.endedAt))) &&
					policy
				) {
					countingPolicyPeriods.push({
						startedAt: period.startedAt,
						...(period.endedAt
							? { endedAt: period.endedAt }
							: {}),
						policy,
					});
				} else if (strict) {
					throw new Error("Invalid counting policy period");
				}
			}
		}

		if (
			strict &&
			numericSchemaVersion >= 10 &&
			(!Array.isArray(candidate.graphThemes) ||
				candidate.graphThemes.length > 30)
		) {
			throw new Error("Invalid graph themes");
		}
		const graphThemes: SavedGraphTheme[] = [];
		const rawGraphThemes = Array.isArray(candidate.graphThemes)
			? candidate.graphThemes.slice(0, 30)
			: [];
		for (const value of rawGraphThemes) {
			const theme = this.normalizeSavedGraphTheme(value);
			if (theme) {
				const duplicate = graphThemes.some(
					(existing) =>
						existing.id === theme.id ||
						existing.name.toLocaleLowerCase() ===
							theme.name.toLocaleLowerCase()
				);
				if (!duplicate) {
					graphThemes.push(theme);
				} else if (strict) {
					throw new Error("Duplicate graph theme");
				}
			} else if (strict) {
				throw new Error("Invalid graph theme");
			}
		}

		if (strict && numericSchemaVersion >= 11 && (
			typeof candidate.settings?.timeTrackingEnabled !== "boolean" ||
			!Number.isSafeInteger(candidate.settings?.idleTimeoutMinutes) ||
			(candidate.settings?.idleTimeoutMinutes || 0) <= 0 ||
			(candidate.settings?.idleTimeoutMinutes || 0) > 10080
		)) throw new Error("时长统计设置无效");
		return {
			schemaVersion: 11,
			timeActivity: normalizeTimeActivity(candidate.timeActivity, strict && numericSchemaVersion >= 11),
			settings: {
				timeTrackingEnabled: candidate.settings?.timeTrackingEnabled === true,
				idleTimeoutMinutes: Number.isSafeInteger(candidate.settings?.idleTimeoutMinutes) && candidate.settings!.idleTimeoutMinutes > 0 && candidate.settings!.idleTimeoutMinutes <= 10080 ? candidate.settings!.idleTimeoutMinutes : 5,
				trackingEnabled:
					candidate.settings?.trackingEnabled === true,
				excludeWhitespace:
					candidate.settings?.excludeWhitespace !== false,
				excludeMarkdownFormatting:
					candidate.settings?.excludeMarkdownFormatting === true,
				trackedFolders,
				strictUserInputOnly:
					candidate.settings?.strictUserInputOnly !== false,
				countPastedText:
					candidate.settings?.countPastedText !== false,
			},
			graphThemes,
			trackingPeriods,
			collectionScopePeriods,
			countingPolicyPeriods,
			dailyStats,
		};
	}

	private normalizeSavedGraphTheme(value: unknown): SavedGraphTheme | undefined {
		if (!value || typeof value !== "object") {
			return undefined;
		}
		const theme = value as Partial<SavedGraphTheme>;
		const densities = ["COMPACT", "BALANCED", "TOUCH", "CUSTOM"];
		const validOptionalPixel = (pixel: unknown) =>
			pixel === undefined ||
			(typeof pixel === "number" &&
				Number.isFinite(pixel) &&
				pixel >= 4 &&
				pixel <= 64);
		const validOptionalColor = (color: unknown) =>
			color === undefined ||
			(typeof color === "string" &&
				/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(color));
		if (
			typeof theme.id !== "string" ||
			theme.id.trim().length === 0 ||
			theme.id.length > 100 ||
			theme.id.includes("\u0000") ||
			typeof theme.name !== "string" ||
			theme.name.trim().length === 0 ||
			theme.name.trim().length > 64 ||
			!Array.isArray(theme.colors) ||
			theme.colors.length < 1 ||
			theme.colors.length > MAX_GOAL_HEAT_LEVELS ||
			!theme.colors.every(
				(color) =>
					typeof color === "string" &&
					/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(color)
			) ||
			!densities.includes(theme.density || "") ||
			!validOptionalPixel(theme.cellWidth) ||
			!validOptionalPixel(theme.cellHeight) ||
			typeof theme.cellGap !== "number" ||
			!Number.isSafeInteger(theme.cellGap) ||
			theme.cellGap < 0 ||
			theme.cellGap > 8 ||
			(theme.cellShape !== undefined &&
				(typeof theme.cellShape !== "string" ||
					!['', "0%", "50%"].includes(theme.cellShape))) ||
			!validOptionalColor(theme.emptyCellColor) ||
			!validOptionalColor(theme.backgroundColor) ||
			typeof theme.highlightToday !== "boolean" ||
			typeof theme.highlightWeekends !== "boolean" ||
			typeof theme.enableShadow !== "boolean"
		) {
			return undefined;
		}
		return {
			id: theme.id.trim(),
			name: theme.name.trim(),
			colors: [...theme.colors],
			density: theme.density!,
			...(theme.cellWidth !== undefined
				? { cellWidth: theme.cellWidth }
				: {}),
			...(theme.cellHeight !== undefined
				? { cellHeight: theme.cellHeight }
				: {}),
			cellGap: theme.cellGap,
			...(theme.cellShape !== undefined
				? { cellShape: theme.cellShape }
				: {}),
			...(theme.emptyCellColor
				? { emptyCellColor: theme.emptyCellColor }
				: {}),
			highlightToday: theme.highlightToday,
			highlightWeekends: theme.highlightWeekends,
			...(theme.backgroundColor
				? { backgroundColor: theme.backgroundColor }
				: {}),
			enableShadow: theme.enableShadow,
		};
	}

	private normalizeCountingPolicy(value: unknown): CountingPolicy | undefined {
		if (!value || typeof value !== "object") {
			return undefined;
		}
		const policy = value as Partial<CountingPolicy>;
		if (
			typeof policy.excludeWhitespace !== "boolean" ||
			typeof policy.excludeMarkdownFormatting !== "boolean" ||
			typeof policy.strictUserInputOnly !== "boolean" ||
			typeof policy.countPastedText !== "boolean"
		) {
			return undefined;
		}
		return {
			excludeWhitespace: policy.excludeWhitespace,
			excludeMarkdownFormatting: policy.excludeMarkdownFormatting,
			strictUserInputOnly: policy.strictUserInputOnly,
			countPastedText: policy.countPastedText,
		};
	}

	private isValidTimestamp(value: unknown): value is string {
		return typeof value === "string" && Number.isFinite(Date.parse(value));
	}

	private normalizeEditPosition(value: unknown):
		| { line: number; column: number }
		| undefined {
		if (!value || typeof value !== "object") {
			return undefined;
		}
		const position = value as {
			line?: unknown;
			column?: unknown;
		};
		if (
			typeof position.line !== "number" ||
			typeof position.column !== "number" ||
			!Number.isSafeInteger(position.line) ||
			!Number.isSafeInteger(position.column) ||
			position.line < 0 ||
			position.column < 0
		) {
			return undefined;
		}
		return {
			line: position.line,
			column: position.column,
		};
	}

	private isValidCount(value: unknown): value is number {
		return (
			typeof value === "number" &&
			Number.isSafeInteger(value) &&
			value >= 0
		);
	}

	private isValidDate(value: unknown): value is string {
		if (typeof value !== "string") {
			return false;
		}
		const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
		if (!match) {
			return false;
		}
		const year = Number(match[1]);
		const month = Number(match[2]);
		const day = Number(match[3]);
		const date = new Date(year, month - 1, day);
		return (
			date.getFullYear() === year &&
			date.getMonth() === month - 1 &&
			date.getDate() === day
		);
	}

	private async backupCorruptData(
		raw: unknown
	): Promise<string | undefined> {
		const pluginDir = this.plugin.manifest.dir;
		if (!pluginDir) {
			return undefined;
		}
		try {
			const serialized =
				raw !== undefined
					? JSON.stringify(raw, null, 2)
					: await this.plugin.app.vault.adapter.read(
							`${pluginDir}/data.json`
					  );
			const timestamp = new Date()
				.toISOString()
				.replace(/[:.]/g, "-");
			const backupPath = `${pluginDir}/data.corrupt-${timestamp}.json`;
			await this.plugin.app.vault.adapter.write(
				backupPath,
				serialized
			);
			return backupPath;
		} catch (error) {
			console.error("Failed to back up corrupt edit activity data", error);
			return undefined;
		}
	}

	private async createAutomaticBackup(
		reason: "import" | "clear" | "restore"
	): Promise<string> {
		const pluginDir = this.plugin.manifest.dir;
		if (!pluginDir) {
			throw new EditActivityBackupError(
				"Plugin directory is unavailable"
			);
		}
		const timestamp = this.now()
			.toISOString()
			.replace(/[:.]/g, "-");
		const sequence = String(this.backupSequence++).padStart(4, "0");
		const backupPath = `${pluginDir}/${AUTOMATIC_BACKUP_PREFIX}${timestamp}-${sequence}-${reason}.json`;
		try {
			await this.plugin.app.vault.adapter.write(
				backupPath,
				JSON.stringify(this.store, null, 2)
			);
			return backupPath;
		} catch (error) {
			console.error("Failed to back up edit activity data", error);
			throw new EditActivityBackupError(
				"Failed to back up edit activity data",
				error
			);
		}
	}
}
