import { App, Modal, Scope, TFile, TFolder } from "obsidian";
import { normalizeTrackedFolderPath } from "../activity/folderScope";
import { isYoloChatActivity, YOLO_CHAT_ACTIVITY_LABEL } from "../time/timeActivitySource";
import { formatDuration } from "../time/timeData";
import { getReviewWeekStart, getWeeklyReviewGoal, getWeeklyReviewGroups, shiftReviewDate } from "../time/weeklyReview";
import type {
	WeeklyReviewComparison,
	WeeklyReviewDay,
	WeeklyReviewGoalState,
	WeeklyReviewGroup,
	WeeklyReviewQuery,
	WeeklyReviewSnapshot,
} from "../time/weeklyReviewTypes";
import { mountDatePicker } from "./datePicker/DatePicker";

interface WeeklyReviewService {
	getWeeklyReview(query?: WeeklyReviewQuery): WeeklyReviewSnapshot;
	getSettings(): { trackedFolders: string[]; timeTrackingEnabled: boolean };
}

interface RequestedReviewState {
	date?: string;
	root?: string;
}

const COVERAGE_LABELS: Record<WeeklyReviewDay["coverage"], string> = {
	TRACKED: "已覆盖",
	PARTIAL: "部分采集",
	UNTRACKED: "未采集",
	UNKNOWN: "覆盖无法确认",
};

const GOAL_LABELS: Record<WeeklyReviewGoalState, string> = {
	MET: "已达标",
	MISSED: "未达标",
	UNKNOWN: "无法判定",
	IN_PROGRESS: "进行中",
	EXCLUDED: "不参与",
};

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

export class WeeklyReviewModal extends Modal {
	private readonly service: WeeklyReviewService;
	private readonly onClosedCallback: () => void;
	private readonly originalFocus: HTMLElement | null;
	private snapshot?: WeeklyReviewSnapshot;
	private selectedDate?: string;
	private selectedRoot = "";
	private depth: 1 | 2 = 1;
	private goalText = "60";
	private goalError = "";
	private selectedGroupKey?: string;
	private errorMessage = "";
	private failedRequest?: {query: WeeklyReviewQuery; state?: RequestedReviewState};
	private rootEl?: HTMLElement;
	private closed = false;

	constructor(app: App, service: WeeklyReviewService, onClosed: () => void) {
		super(app);
		this.service = service;
		this.onClosedCallback = onClosed;
		this.originalFocus = this.modalEl.ownerDocument.activeElement as HTMLElement | null;
		this.scope = new Scope(this.scope);
		this.scope.register([], "Escape", () => this.handleEscape());
	}

	onOpen(): void {
		this.modalEl.addClass("cg-weekly-review-modal");
		this.modalEl.setAttribute("aria-label", "按学科的周回顾");
		this.modalEl.setAttribute("tabindex", "-1");
		this.rootEl = this.contentEl.createDiv({ cls: "cg-weekly-review" });
		this.refreshSnapshot();
	}

	onClose(): void {
		if (this.closed) return;
		this.closed = true;
		this.closeDatePicker();
		this.contentEl.empty();
		if (this.originalFocus?.isConnected) this.originalFocus.focus({ preventScroll: true });
		this.rootEl = undefined;
		this.snapshot = undefined;
		this.failedRequest = undefined;
		this.onClosedCallback();
	}

	focus(): void {
		if (this.modalEl.isConnected) {
			this.modalEl.focus({ preventScroll: true });
			this.rootEl?.querySelector<HTMLElement>("button, select, input")?.focus({ preventScroll: true });
		}
	}

	private handleEscape(): false {
		const dialog = this.rootEl?.querySelector<HTMLDialogElement>(".cg-date-picker[open]");
		if (dialog) dialog.close();
		else this.close();
		return false;
	}

	private refreshSnapshot(query?: WeeklyReviewQuery, requestedState?: RequestedReviewState): void {
		if (this.closed) return;
		const request = query || this.getQuery();
		try {
			const next = this.service.getWeeklyReview(request);
			this.snapshot = next;
			this.errorMessage = "";
			this.failedRequest = undefined;
			if (requestedState && Object.prototype.hasOwnProperty.call(requestedState, "root")) {
				this.selectedRoot = normalizeTrackedFolderPath(requestedState.root || "");
			}
			if (requestedState && Object.prototype.hasOwnProperty.call(requestedState, "date")) {
				this.selectedDate = requestedState.date;
			}
			this.render();
		} catch (error) {
			this.failedRequest = {query: request, state: requestedState};
			this.errorMessage = `刷新失败：${error instanceof Error ? error.message : "无法读取周回顾"}`;
			this.render();
		}
	}

	private getQuery(): WeeklyReviewQuery {
		return {
			...(this.selectedDate ? { date: this.selectedDate } : {}),
			...(this.selectedRoot ? { root: this.selectedRoot } : {}),
		};
	}

	private render(): void {
		if (!this.rootEl) return;
		const scrollTop = this.rootEl.scrollTop;
		const focused = this.rootEl.contains(this.rootEl.ownerDocument.activeElement)
			? this.rootEl.ownerDocument.activeElement as HTMLElement : undefined;
		this.closeDatePicker();
		this.rootEl.empty();
		this.renderHeader();
		this.renderError();
		if (!this.snapshot) {
			this.renderEmptyError();
			return;
		}
		this.renderControls(this.snapshot);
		this.renderReport(this.snapshot);
		this.rootEl.scrollTop = scrollTop;
		this.restoreControlFocus(focused);
	}

	private restoreControlFocus(previous?: HTMLElement): void {
		if (!previous || !this.rootEl) return;
		const key = ["reviewGroupKey", "reviewPath", "reviewField", "reviewAction"].find(name => previous.dataset[name]);
		if (!key) return;
		const controls = this.rootEl.querySelectorAll<HTMLElement>("[data-review-action], [data-review-field]");
		Array.from(controls).find(control => control.dataset[key] === previous.dataset[key])?.focus({ preventScroll: true });
	}

	private renderHeader(): void {
		const header = this.rootEl!.createDiv({ cls: "cg-weekly-review-header" });
		const title = header.createDiv({ cls: "cg-weekly-review-heading" });
		title.createDiv({ cls: "cg-weekly-review-kicker", text: "每周回顾 · 学习投入" });
		title.createEl("h2", { text: "按学科的周回顾" });
		title.createDiv({ cls: "cg-weekly-review-subtitle", text: "只汇总已记录的活跃时长，不代表注意力或掌握程度" });
		const refresh = header.createEl("button", { cls: "cg-weekly-review-refresh", text: "刷新" });
		refresh.type = "button";
		refresh.dataset.reviewAction = "refresh";
		refresh.setAttribute("aria-label", "刷新周回顾快照");
		refresh.onclick = () => this.refreshSnapshot();
	}

	private renderError(): void {
		if (!this.errorMessage) return;
		const notice = this.rootEl!.createDiv({ cls: "cg-weekly-review-error", attr: { role: "alert" } });
		notice.createSpan({ text: this.snapshot ? `${this.errorMessage} 当前显示上一次成功快照。` : this.errorMessage });
		const retry = notice.createEl("button", { text: "重试" });
		retry.type = "button";
		retry.dataset.reviewAction = "retry";
		retry.onclick = () => this.refreshSnapshot(this.failedRequest?.query, this.failedRequest?.state);
	}

	private renderEmptyError(): void {
		const empty = this.rootEl!.createDiv({ cls: "cg-weekly-review-empty" });
		empty.createEl("h3", { text: "暂时无法生成周回顾" });
		empty.createDiv({ text: "请检查时长数据后重试；查询不会修改采集状态或设置。" });
	}

	private renderControls(snapshot: WeeklyReviewSnapshot): void {
		const controls = this.rootEl!.createDiv({ cls: "cg-weekly-review-controls" });
		this.renderWeekNavigation(controls, snapshot);
		this.renderRootSelect(controls, snapshot);
		this.renderDepthSelect(controls);
		this.renderGoalInput(controls);
	}

	private renderWeekNavigation(parent: HTMLElement, snapshot: WeeklyReviewSnapshot): void {
		const group = parent.createDiv({ cls: "cg-weekly-review-control-group cg-weekly-review-week-nav" });
		group.createDiv({ cls: "cg-weekly-review-control-label", text: "查看周" });
		const nav = group.createDiv({ cls: "cg-weekly-review-nav-buttons" });
		this.createControlButton(nav, "‹", "上一周", () => this.shiftWeek(-7), {disabled: this.isPreviousDisabled(snapshot), id: "previous-week"});
		const dateNav = nav.createDiv({ cls: "cg-weekly-review-date-picker" });
		const dateTrigger = mountDatePicker(dateNav, {
			value: snapshot.weekStart,
			dates: reviewCalendarDates(snapshot),
			onSelect: date => this.selectDate(date),
		});
		dateTrigger.dataset.reviewField = "date";
		this.createControlButton(nav, "本周", "回到本周", () => this.selectCurrentWeek(), {disabled: snapshot.isCurrentWeek, id: "current-week"});
		this.createControlButton(nav, "›", "下一周", () => this.shiftWeek(7), {disabled: snapshot.isCurrentWeek, id: "next-week"});
		group.createDiv({ cls: "cg-weekly-review-range", text: `${formatDate(snapshot.weekStart)} — ${formatDate(snapshot.weekEnd)}` });
		group.createDiv({ cls: "cg-weekly-review-generated", text: `快照 ${formatTimestamp(snapshot.generatedAt)}` });
	}

	private renderRootSelect(parent: HTMLElement, snapshot: WeeklyReviewSnapshot): void {
		const group = parent.createDiv({ cls: "cg-weekly-review-control-group" });
		group.createDiv({ cls: "cg-weekly-review-control-label", text: "统计范围" });
		const select = group.createEl("select", { cls: "cg-weekly-review-select" });
		select.dataset.reviewField = "root";
		select.setAttribute("aria-label", "选择统计根目录");
		this.createOption(select, "", "全部已有记录（按仓库根目录分组）");
		for (const path of this.getFolderPaths(snapshot)) {
			const exists = this.app.vault.getAbstractFileByPath(path) instanceof TFolder;
			this.createOption(select, path, `${path}${exists ? "" : "（目录已不存在）"}`);
		}
		select.value = this.selectedRoot;
		select.onchange = () => {
			const root = normalizeTrackedFolderPath(select.value);
			this.selectedGroupKey = undefined;
			this.refreshSnapshot(this.getQueryWithRoot(root), { root });
		};
		group.createDiv({ cls: "cg-weekly-review-control-hint", text: snapshot.root ? `当前：${snapshot.root}` : "未指定学科根目录" });
	}

	private renderDepthSelect(parent: HTMLElement): void {
		const group = parent.createDiv({ cls: "cg-weekly-review-control-group" });
		group.createDiv({ cls: "cg-weekly-review-control-label", text: "分组层级" });
		const select = group.createEl("select", { cls: "cg-weekly-review-select" });
		select.dataset.reviewField = "depth";
		select.setAttribute("aria-label", "选择学科分组层级");
		this.createOption(select, "1", "一级分组");
		this.createOption(select, "2", "二级分组");
		select.value = String(this.depth);
		select.onchange = () => {
			this.depth = select.value === "2" ? 2 : 1;
			this.selectedGroupKey = undefined;
			this.render();
		};
	}

	private renderGoalInput(parent: HTMLElement): void {
		const group = parent.createDiv({ cls: "cg-weekly-review-control-group cg-weekly-review-goal-control" });
		group.createDiv({ cls: "cg-weekly-review-control-label", text: "本次参考目标" });
		const line = group.createDiv({ cls: "cg-weekly-review-goal-line" });
		const input = line.createEl("input", { cls: "cg-weekly-review-goal-input" });
		input.dataset.reviewField = "goal";
		input.type = "text";
		input.inputMode = "numeric";
		input.value = this.goalText;
		input.placeholder = "分钟";
		input.setAttribute("aria-label", "本次参考目标分钟数");
		const error = group.createDiv({ cls: "cg-weekly-review-control-error", attr: { role: "status" } });
		error.textContent = this.goalError;
		const updateGoal = () => {
			this.goalText = input.value;
			this.goalError = validateGoalText(this.goalText);
			error.textContent = this.goalError;
			input.setAttribute("aria-invalid", String(Boolean(this.goalError)));
			this.refreshReport();
		};
		input.oninput = updateGoal;
		input.onchange = updateGoal;
		const clear = line.createEl("button", { cls: "cg-weekly-review-clear-goal", text: "清空" });
		clear.type = "button";
		clear.dataset.reviewAction = "clear-goal";
		clear.onclick = () => {
			this.goalText = "";
			this.goalError = "";
			this.render();
			this.rootEl?.querySelector<HTMLElement>('[data-review-field="goal"]')?.focus();
		};
		group.createDiv({ cls: "cg-weekly-review-control-hint", text: this.goalText ? "仅用于本次报告，不修改图表目标" : "未设置目标" });
	}

	private refreshReport(): void {
		if (!this.rootEl || !this.snapshot || this.closed) return;
		const scrollTop = this.rootEl.scrollTop;
		this.rootEl.querySelector(".cg-weekly-review-report")?.remove();
		this.renderReport(this.snapshot);
		this.rootEl.scrollTop = scrollTop;
	}

	private renderReport(snapshot: WeeklyReviewSnapshot): void {
		const report = this.rootEl!.createDiv({ cls: "cg-weekly-review-report" });
		this.renderOverview(report, snapshot);
		this.renderDailyTrend(report, snapshot);
		this.renderComparison(report, snapshot.comparison);
		this.renderGroups(report, snapshot);
		this.renderDocuments(report, snapshot);
		this.renderNotes(report, snapshot);
	}

	private renderOverview(parent: HTMLElement, snapshot: WeeklyReviewSnapshot): void {
		const section = this.createSection(parent, snapshot.isCurrentWeek ? "本周概览" : "所选周概览",
			snapshot.isCurrentWeek ? "截至快照生成时刻，包含今天已有记录" : "完整自然周的已记录时长");
		if (!snapshot.documents.length) section.createDiv({cls: "cg-weekly-review-empty-inline", text: this.service.getSettings().timeTrackingEnabled
			? "当前周范围暂无时长记录；未采集不代表零投入。" : "当前范围暂无时长记录。可在设置中开启时长统计，以积累后续记录。"});
		const cards = section.createDiv({ cls: "cg-weekly-review-summary-cards" });
		this.createSummaryCard(cards, "已记录时长", formatDuration(snapshot.totalSeconds), "按当前日期和目录范围汇总");
		this.createSummaryCard(cards, "有记录的天数", `${snapshot.recordedDays} 天`, "不把未采集日期补成零");
		const counts = this.getGoalCounts(snapshot);
		this.createSummaryCard(cards, "目标状态", this.formatGoalCounts(counts), this.getGoalHint());
		if (snapshot.warnings.length) this.renderWarningList(section, snapshot.warnings);
	}

	private renderDailyTrend(parent: HTMLElement, snapshot: WeeklyReviewSnapshot): void {
		const section = this.createSection(parent, "每日趋势", "周一至周日；共用同一时长坐标");
		const days = section.createDiv({ cls: "cg-weekly-review-days" });
		const maxSeconds = Math.max(1, ...snapshot.days.map(day => day.seconds));
		for (const day of snapshot.days) this.renderDay(days, day, snapshot, maxSeconds);
	}

	private renderDay(parent: HTMLElement, day: WeeklyReviewDay, snapshot: WeeklyReviewSnapshot, maxSeconds: number): void {
		const goal = getWeeklyReviewGoal(day, snapshot.today, this.getGoalMinutes());
		const row = parent.createDiv({ cls: "cg-weekly-review-day" });
		row.classList.toggle("is-future", day.future);
		row.classList.toggle("is-today", day.date === snapshot.today);
		const label = row.createDiv({ cls: "cg-weekly-review-day-label" });
		label.createEl("time", { cls: "cg-weekly-review-day-date", text: day.date.slice(5), attr: { datetime: day.date } });
		label.createSpan({ cls: "cg-weekly-review-day-weekday", text: `周${getWeekday(day.date)}` });
		if (day.date === snapshot.today) label.createSpan({ cls: "cg-weekly-review-day-today", text: "今天" });
		const graph = row.createDiv({ cls: "cg-weekly-review-day-graph" });
		const bar = graph.createDiv({ cls: "cg-weekly-review-day-bar" });
		bar.style.width = `${Math.max(0, Math.min(100, day.seconds / maxSeconds * 100))}%`;
		graph.createSpan({ cls: "cg-weekly-review-day-value", text: reviewDayValue(day) });
		const status = row.createDiv({ cls: "cg-weekly-review-day-status" });
		status.createSpan({ cls: `cg-weekly-review-coverage is-${day.coverage.toLowerCase()}`, text: day.future && !day.seconds ? "尚未到来" : COVERAGE_LABELS[day.coverage] });
		status.createSpan({ cls: `cg-weekly-review-goal is-${goal.toLowerCase()}`, text: this.getGoalLabel(goal) });
		if (day.future && day.seconds > 0) status.createSpan({ cls: "cg-weekly-review-day-note", text: "日期超前" });
		if (day.timezoneWarning) status.createSpan({ cls: "cg-weekly-review-day-note", text: "时区需确认" });
	}

	private renderComparison(parent: HTMLElement, comparison: WeeklyReviewComparison): void {
		const section = this.createSection(parent, this.snapshot?.isCurrentWeek ? "上周同期" : "历史周对上一完整周", this.getComparisonSubtitle(comparison));
		if (comparison.state === "NO_COMPLETED_DAYS") {
			section.createDiv({cls: "cg-weekly-review-empty-inline", text: this.getComparisonResult(comparison)});
			return;
		}
		const grid = section.createDiv({ cls: "cg-weekly-review-comparison" });
		this.createComparisonValue(grid, "本次区间", getComparisonRange(comparison.fromDate, comparison.toDate), comparison.currentSeconds, comparison.currentDays);
		this.createComparisonValue(grid, "对照区间", getComparisonRange(comparison.referenceFromDate, comparison.referenceToDate), comparison.previousSeconds, comparison.previousDays);
		const result = grid.createDiv({ cls: `cg-weekly-review-comparison-result is-${comparison.state.toLowerCase()}` });
		result.createDiv({ cls: "cg-weekly-review-comparison-result-label", text: this.getComparisonResult(comparison) });
		if (comparison.state === "READY" && comparison.deltaSeconds !== undefined) {
			const delta = formatSignedDuration(comparison.deltaSeconds);
			result.createDiv({ cls: "cg-weekly-review-comparison-delta", text: `${delta}${comparison.percentage === undefined ? "" : ` · ${formatPercentage(comparison.percentage, true)}`}` });
		}
	}

	private renderGroups(parent: HTMLElement, snapshot: WeeklyReviewSnapshot): void {
		const groups = getWeeklyReviewGroups(snapshot, this.depth).filter(group => group.seconds > 0);
		const section = this.createSection(parent, "学科分布", groups.length ? "点击一行，仅筛选下方重点笔记" : "本周暂无可分组的已记录时长");
		if (!groups.length) return;
		const list = section.createDiv({ cls: "cg-weekly-review-groups", attr: { role: "group", "aria-label": "学科与独立活动分布" } });
		for (const group of groups) this.renderGroup(list, group, snapshot.totalSeconds);
	}

	private renderGroup(parent: HTMLElement, group: WeeklyReviewGroup, totalSeconds: number): void {
		const selected = this.selectedGroupKey === group.key;
		const button = parent.createEl("button", { cls: "cg-weekly-review-group", attr: { type: "button", "aria-pressed": String(selected) } });
		button.dataset.reviewAction = "group";
		button.dataset.reviewGroupKey = group.key;
		button.classList.toggle("is-selected", selected);
		button.classList.toggle("is-activity", group.activity);
		button.onclick = () => {
			this.selectedGroupKey = selected ? undefined : group.key;
			this.render();
		};
		const heading = button.createDiv({ cls: "cg-weekly-review-group-heading" });
		heading.createSpan({ text: group.activity ? YOLO_CHAT_ACTIVITY_LABEL : group.label });
		if (group.activity) heading.createSpan({ cls: "cg-weekly-review-activity-badge", text: "独立活动" });
		const meta = button.createDiv({ cls: "cg-weekly-review-group-meta" });
		meta.createSpan({ text: formatDuration(group.seconds) });
		if (totalSeconds > 0) meta.createSpan({ text: `${formatPercentage(group.seconds / totalSeconds * 100)} · ${group.documents.length} 项` });
		const bar = button.createDiv({ cls: "cg-weekly-review-group-bar" });
		bar.createDiv({ cls: "cg-weekly-review-group-bar-fill" }).style.width = `${Math.min(100, group.seconds / Math.max(totalSeconds, 1) * 100)}%`;
	}

	private renderDocuments(parent: HTMLElement, snapshot: WeeklyReviewSnapshot): void {
		const selectedGroup = this.getSelectedGroup(snapshot);
		const documents = (selectedGroup?.documents || snapshot.documents)
			.filter(document => !isYoloChatActivity(document.path) && document.seconds > 0)
			.sort((left, right) => right.seconds - left.seconds || left.path.localeCompare(right.path))
			.slice(0, 10);
		const title = selectedGroup ? `重点笔记 · ${selectedGroup.label}` : "投入最多的十篇笔记";
		const section = this.createSection(parent, title, "按完整路径区分同名笔记；已删除文件仍保留统计");
		if (!documents.length) {
			section.createDiv({ cls: "cg-weekly-review-empty-inline", text: selectedGroup?.activity ? "YOLO 对话活动不对应笔记。" : "暂无可显示的笔记记录。" });
			return;
		}
		const list = section.createDiv({ cls: "cg-weekly-review-documents" });
		for (const document of documents) this.renderDocument(list, document.path, document.seconds);
	}

	private renderDocument(parent: HTMLElement, path: string, seconds: number): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		const row = parent.createDiv({ cls: "cg-weekly-review-document" });
		row.dataset.reviewAction = "open-document";
		row.dataset.reviewPath = path;
		const label = row.createDiv({ cls: "cg-weekly-review-document-label" });
		label.createDiv({ cls: "cg-weekly-review-document-name", text: getFileName(path) });
		label.createDiv({ cls: "cg-weekly-review-document-path", text: path });
		row.createDiv({ cls: "cg-weekly-review-document-duration", text: formatDuration(seconds) });
		if (file instanceof TFile) {
			row.classList.add("is-openable");
			row.tabIndex = 0;
			row.setAttribute("role", "button");
			row.setAttribute("aria-label", `打开笔记 ${path}`);
			row.onclick = event => this.openDocument(path, event);
			row.onkeydown = event => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					this.openDocument(path, event);
				}
			};
		} else {
			row.createSpan({ cls: "cg-weekly-review-document-missing", text: "文件已不存在" });
		}
	}

	private renderNotes(parent: HTMLElement, snapshot: WeeklyReviewSnapshot): void {
		const section = this.createSection(parent, "口径说明", "报告只解释已有快照，不补造未采集时长");
		const list = section.createDiv({ cls: "cg-weekly-review-notes" });
		const notes = [
			"时长按原记录日期汇总，覆盖按本机日界判断；多端同时发生的活动直接相加。",
			"本周主累计包含今天已有记录；同期比较只使用已结束日期，不把今天与上周整日比较。",
			this.goalError ? "当前目标输入无效，已隐藏目标判断。" : this.goalText ? `目标是本次参考值 ${this.goalText} 分钟，不代表任何历史图表目标。` : "当前未设置本次参考目标，隐藏目标判断。",
			"更改分组或目标只影响本次报告，点击刷新查看最新记录；不会自动写入笔记。",
		];
		for (const note of notes) list.createDiv({ text: note });
		if (snapshot.warnings.length) list.createDiv({ cls: "cg-weekly-review-note-muted", text: "异常提示已在相关区域列出。" });
	}

	private createSection(parent: HTMLElement, title: string, subtitle: string): HTMLElement {
		const section = parent.createDiv({ cls: "cg-weekly-review-section" });
		const heading = section.createDiv({ cls: "cg-weekly-review-section-heading" });
		heading.createEl("h3", { text: title });
		heading.createDiv({ cls: "cg-weekly-review-section-subtitle", text: subtitle });
		return section;
	}

	private createSummaryCard(parent: HTMLElement, label: string, value: string, hint: string): void {
		const card = parent.createDiv({ cls: "cg-weekly-review-summary-card" });
		card.createDiv({ cls: "cg-weekly-review-summary-label", text: label });
		card.createDiv({ cls: "cg-weekly-review-summary-value", text: value });
		card.createDiv({ cls: "cg-weekly-review-summary-hint", text: hint });
	}

	private renderWarningList(parent: HTMLElement, warnings: readonly string[]): void {
		const list = parent.createDiv({ cls: "cg-weekly-review-warnings", attr: { role: "status" } });
		for (const warning of warnings) list.createDiv({ text: warning });
	}

	private createComparisonValue(parent: HTMLElement, label: string, range: string, seconds: number, days: readonly WeeklyReviewDay[]): void {
		const value = parent.createDiv({ cls: "cg-weekly-review-comparison-value" });
		value.createDiv({ cls: "cg-weekly-review-comparison-label", text: label });
		value.createDiv({ cls: "cg-weekly-review-comparison-range", text: range });
		value.createDiv({ cls: "cg-weekly-review-comparison-seconds", text: `已记录 ${formatDuration(seconds)}` });
		value.createDiv({ cls: "cg-weekly-review-control-hint", text: `覆盖完整 ${days.filter(day => day.coverage === "TRACKED").length}/${days.length} 天，其余记录不完整或无法确认` });
	}

	private createControlButton(parent: HTMLElement, text: string, label: string, action: () => void, options: {disabled: boolean; id: string}): void {
		const button = parent.createEl("button", { cls: "cg-weekly-review-control-button", text, attr: { type: "button", "aria-label": label } });
		button.dataset.reviewAction = options.id;
		button.disabled = options.disabled;
		button.onclick = action;
	}

	private createOption(select: HTMLSelectElement, value: string, label: string): void {
		const option = select.createEl("option", { text: label });
		option.value = value;
	}

	private getFolderPaths(snapshot: WeeklyReviewSnapshot): string[] {
		const paths = new Set<string>();
		for (const file of this.app.vault.getAllLoadedFiles()) {
			if (file instanceof TFolder) paths.add(normalizeTrackedFolderPath(file.path));
		}
		for (const path of snapshot.folderPaths) paths.add(normalizeTrackedFolderPath(path));
		if (snapshot.root) paths.add(snapshot.root);
		paths.delete("");
		return [...paths].sort((left, right) => left.localeCompare(right));
	}

	private getSelectedGroup(snapshot: WeeklyReviewSnapshot): WeeklyReviewGroup | undefined {
		if (!this.selectedGroupKey) return undefined;
		return getWeeklyReviewGroups(snapshot, this.depth).find(group => group.key === this.selectedGroupKey);
	}

	private getGoalMinutes(): number | undefined {
		return this.goalError || !this.goalText ? undefined : Number(this.goalText);
	}

	private getGoalCounts(snapshot: WeeklyReviewSnapshot): Record<WeeklyReviewGoalState, number> {
		const result: Record<WeeklyReviewGoalState, number> = { MET: 0, MISSED: 0, UNKNOWN: 0, IN_PROGRESS: 0, EXCLUDED: 0 };
		if (!this.goalText || this.goalError) return result;
		for (const day of snapshot.days) result[getWeeklyReviewGoal(day, snapshot.today, this.getGoalMinutes())]++;
		return result;
	}

	private formatGoalCounts(counts: Record<WeeklyReviewGoalState, number>): string {
		if (this.goalError) return "目标无效";
		if (!this.goalText) return "未设置目标";
		return `达标 ${counts.MET} · 未达标 ${counts.MISSED} · 无法判定 ${counts.UNKNOWN} · 进行中 ${counts.IN_PROGRESS}`;
	}

	private getGoalHint(): string {
		if (this.goalError) return "输入无效，已隐藏目标判断";
		return this.goalText ? `按 ${this.goalText} 分钟目标` : "未设置本次参考目标";
	}

	private getGoalLabel(goal: WeeklyReviewGoalState): string {
		if (this.goalError) return "目标无效";
		return this.goalText ? GOAL_LABELS[goal] : "未设置目标";
	}

	private getComparisonSubtitle(comparison: WeeklyReviewComparison): string {
		return comparison.toDate ? "本周比较不含今天；历史周对上一完整周" : "本周尚无已结束日期可比较";
	}

	private getComparisonResult(comparison: WeeklyReviewComparison): string {
		switch (comparison.state) {
			case "READY": return comparison.previousSeconds > 0 ? "已记录时长可比较" : comparison.currentSeconds > 0 ? "上期已采集但无活动，本期新增已记录时长" : "已记录时长持平";
			case "NO_COMPLETED_DAYS": return "本周尚无已结束日期，明日起可比较";
			case "POLICY_CHANGED": return "比较口径可能不同，暂不计算变化率";
			default: return "记录不完整，暂不计算变化率";
		}
	}

	private isPreviousDisabled(snapshot: WeeklyReviewSnapshot): boolean {
		if (!snapshot.earliestDate) return false;
		return shiftReviewDate(snapshot.weekStart, -1) < snapshot.earliestDate;
	}

	private shiftWeek(days: number): void {
		if (!this.snapshot) return;
		const date = shiftReviewDate(this.snapshot.weekStart, days);
		this.selectedGroupKey = undefined;
		this.refreshSnapshot(this.getQueryWithDate(date), { date });
	}

	private selectDate(date: string): void {
		const weekStart = getReviewWeekStart(date);
		this.selectedGroupKey = undefined;
		this.refreshSnapshot(this.getQueryWithDate(weekStart), { date: weekStart });
	}

	private selectCurrentWeek(): void {
		this.selectedGroupKey = undefined;
		this.refreshSnapshot(this.getQueryWithDate(undefined), { date: undefined });
	}

	private openDocument(path: string, event: MouseEvent | KeyboardEvent): void {
		if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFile)) { this.render(); return; }
		const modifier = event.ctrlKey || event.metaKey;
		void this.app.workspace.openLinkText(path, "", modifier).then(() => {
			if (!modifier && !this.closed) this.close();
		}).catch(error => {
			if (this.closed) return;
			this.errorMessage = `打开失败：${error instanceof Error ? error.message : "无法打开笔记"}`;
			this.render();
		});
	}

	private closeDatePicker(): void {
		this.rootEl?.querySelector<HTMLDialogElement>(".cg-date-picker[open]")?.close();
	}

	private getQueryWithRoot(root: string): WeeklyReviewQuery {
		return {
			...(this.selectedDate ? { date: this.selectedDate } : {}),
			...(root ? { root } : {}),
		};
	}

	private getQueryWithDate(date: string | undefined): WeeklyReviewQuery {
		return {
			...(date ? { date } : {}),
			...(this.selectedRoot ? { root: this.selectedRoot } : {}),
		};
	}
}

function validateGoalText(value: string): string {
	if (!value) return "";
	const parsed = Number(value);
	return /^\d+$/.test(value) && Number.isSafeInteger(parsed) && parsed > 0 ? "" : "请输入正整数分钟";
}

function formatDate(date: string): string {
	return `${date}（周${getWeekday(date)}）`;
}

function getWeekday(date: string): string {
	const [year, month, day] = date.split("-").map(Number);
	return WEEKDAY_LABELS[new Date(year, month - 1, day).getDay()];
}

function formatTimestamp(timestamp: number): string {
	if (!Number.isFinite(timestamp)) return "时间未知";
	return new Date(timestamp).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function getComparisonRange(fromDate: string, toDate?: string): string {
	return toDate ? `${fromDate} — ${toDate}` : `${fromDate} 起`;
}

function formatSignedDuration(seconds: number): string {
	if (Math.abs(seconds) < 1) return "约等于 0 分钟";
	return `${seconds > 0 ? "增加" : "减少"} ${formatDuration(Math.abs(seconds))}`;
}

function formatPercentage(value: number, signed = false): string {
	if (!Number.isFinite(value)) return "变化率无法计算";
	const rounded = Math.round(value * 10) / 10 || 0;
	return `${signed && rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}

function reviewDayValue(day: WeeklyReviewDay): string {
	if (!day.seconds && day.future) return "尚未到来";
	if (!day.seconds && day.coverage === "UNTRACKED") return "未采集";
	return formatDuration(day.seconds);
}

function reviewCalendarDates(snapshot: WeeklyReviewSnapshot): string[] {
	const dates: string[] = [];
	for (let date = getReviewWeekStart(snapshot.earliestDate); date <= snapshot.today; date = shiftReviewDate(date, 1)) dates.push(date);
	return dates;
}

function getFileName(path: string): string {
	const name = path.split("/").pop() || path;
	return name.replace(/\.md$/i, "");
}
