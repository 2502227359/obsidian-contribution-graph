import { App, Modal, Scope, TFile, TFolder } from "obsidian";
import { normalizeTrackedFolderPath, normalizeTrackedFolders } from "../activity/folderScope";
import { isYoloChatActivity } from "../time/timeActivitySource";
import { formatDuration } from "../time/timeData";
import { getReviewWeekStart, getWeeklyReviewGoal, shiftReviewDate } from "../time/weeklyReview";
import type {
	WeeklyReviewDay,
	WeeklyReviewGoalState,
	WeeklyReviewQuery,
	WeeklyReviewSnapshot,
} from "../time/weeklyReviewTypes";
import { mountDatePicker } from "./datePicker/DatePicker";
import { WeeklyReviewCharts, WeeklyReviewChartSelection } from "./weeklyReviewCharts";
import { WeeklyReviewTimelineCharts } from "./weeklyReviewTimelineCharts";
import { WeeklyReviewRankingChart } from "./weeklyReviewRankingChart";
import { buildWeeklyReviewInsights } from "../time/weeklyReviewInsights";
import type { WeeklyReviewInsights, WeeklyReviewInsightAction, WeeklyReviewChangeDocument, WeeklyReviewChangeGroup } from "../time/weeklyReviewInsights";
import { renderWeeklyObservations, renderWeeklyDocumentChanges, renderWeeklyDocumentAmounts } from "./weeklyReviewInsightDetails";
import type { TimeDocumentStats } from "../time/types";
import { ContributionGraphConfig } from "../types";
import type { ActivityTimelineService } from "../time/activityTimelineTypes";
import type { EditActivityService } from "../activity/EditActivityService";
import { ActivityTimelineView } from "./ActivityTimelineView";
import { createActivityTimelineOptions, renderTimelineHourlySummary } from "./ActivityTimelineModal";
import type { TimelineHourlySummary } from "./ActivityTimelineModal";

interface WeeklyReviewService {
	getActivityTimelineDay?:ActivityTimelineService["getActivityTimelineDay"];
	subscribe?:ActivityTimelineService["subscribe"];
	getWeeklyReview(query?: WeeklyReviewQuery, includeTimeline?: boolean): WeeklyReviewSnapshot;
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
	private charts?: WeeklyReviewCharts;
	private timelineCharts?: WeeklyReviewTimelineCharts;
	private rankingChart?: WeeklyReviewRankingChart;
	private insights?: WeeklyReviewInsights;
	private comparisonView: "comparison" | "ranking" = "comparison";
	private panel: "analysis" | "timeline" = "analysis";
	private chartSelection?: WeeklyReviewChartSelection;
	private comparisonPeriod: "current" | "previous" = "current";
	private comparisonNotePath?: string;
	private dailyOpen = false;
	private errorMessage = "";
	private failedRequest?: {query: WeeklyReviewQuery; state?: RequestedReviewState};
	private rootEl?: HTMLElement;
	private closed = false;
	private scrollEl?: HTMLElement;
	private selectedDay?: string;
	private optionsOpen = false;
	private notesOpen = false;
	private warningsOpen = false;
	private rootPickerOpen = false;
	private activityView?:ActivityTimelineView;
	private activityHost?:HTMLElement;
	private activitySummary?:TimelineHourlySummary;
	private activityReturnFocus?:HTMLElement;
	private activityReturnScroll=0;

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
		this.modalEl.setAttribute("aria-label", "周回顾");
		this.modalEl.setAttribute("tabindex", "-1");
		this.rootEl = this.contentEl.createDiv({ cls: "cg-weekly-review" });
		this.rootEl.onclick = event => {
			if (!this.rootEl?.contains(event.target as Node)) return;
			for (const details of Array.from(this.rootEl.querySelectorAll<HTMLDetailsElement>(".cg-weekly-review-root-picker[open], .cg-weekly-review-options[open]"))) {
				if (!details.contains(event.target as Node)) details.open = false;
			}
		};
		this.refreshSnapshot();
	}

	onClose(): void {
		if (this.closed) return;
		this.closed = true;
		this.activitySummary?.dispose();this.activityView?.dispose();this.activityHost?.remove();
		this.closeDatePicker();
		this.charts?.dispose();
		this.charts = undefined;
		this.timelineCharts?.dispose();
		this.timelineCharts = undefined;
		this.rankingChart?.dispose();
		this.rankingChart = undefined;
		this.insights = undefined;
		this.chartSelection = undefined;
		this.contentEl.empty();
		if (this.originalFocus?.isConnected) this.originalFocus.focus({ preventScroll: true });
		this.rootEl = undefined;
		this.scrollEl = undefined;
		this.snapshot = undefined;
		this.failedRequest = undefined;
		this.onClosedCallback();
	}

	focus(): void {
		if(this.activityHost){this.activityHost.querySelector<HTMLElement>("button")?.focus({preventScroll:true});return;}
		if (this.modalEl.isConnected) {
			this.modalEl.focus({ preventScroll: true });
			this.rootEl?.querySelector<HTMLElement>("button, select, input")?.focus({ preventScroll: true });
		}
	}

	private handleEscape(): false {
		if(this.activityHost){
			if(this.activitySummary)this.leaveActivityHours();
			else if(!this.activityView?.handleEscape())this.leaveActivityTimeline();
			return false;
		}
		const dialog = this.rootEl?.querySelector<HTMLDialogElement>(".cg-date-picker[open]");
		const directory = this.rootEl?.querySelector<HTMLDetailsElement>(".cg-weekly-review-root-picker[open], .cg-weekly-review-options[open]");
		if (dialog) dialog.close();
		else if (directory) { directory.open = false; directory.querySelector<HTMLElement>("summary")?.focus(); }
		else this.close();
		return false;
	}

	private refreshSnapshot(query?: WeeklyReviewQuery, requestedState?: RequestedReviewState): void {
		if (this.closed) return;
		const request = query || this.getQuery();
		try {
			const next = this.service.getWeeklyReview(request, true);
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
		const scrollTop = this.scrollEl?.scrollTop || 0;
		const focused = this.rootEl.contains(this.rootEl.ownerDocument.activeElement)
			? this.rootEl.ownerDocument.activeElement as HTMLElement : undefined;
		this.closeDatePicker();
		this.charts?.el.remove();
		this.timelineCharts?.el.remove();
		this.rootEl.empty();
		this.renderHeader();
		this.renderError();
		if (!this.snapshot) { this.renderEmptyError(); return; }
		this.scrollEl = this.rootEl.createDiv({ cls: "cg-weekly-review-scroll" });
		this.renderControls(this.snapshot);
		this.renderReport(this.snapshot);
		this.scrollEl.scrollTop = scrollTop;
		this.restoreControlFocus(focused);
	}

	private restoreControlFocus(previous?: HTMLElement): void {
		if (!previous || !this.rootEl) return;
		if(previous.dataset.reviewChangeNote){
			const exact=Array.from(this.rootEl.querySelectorAll<HTMLElement>("[data-review-change-note]")).find(e=>e.dataset.reviewChangeNote===previous.dataset.reviewChangeNote&&e.dataset.reviewChangePeriod===previous.dataset.reviewChangePeriod);
			(exact||this.rootEl.querySelector<HTMLElement>(`[data-review-action="comparison-${previous.dataset.reviewChangePeriod}"]`))?.focus({preventScroll:true});return;
		}
		const key = ["reviewGroupKey", "reviewPath", "reviewDay", "reviewField", "reviewAction"].find(name => previous.dataset[name]);
		if (!key) return;
		const controls = this.rootEl.querySelectorAll<HTMLElement>("[data-review-action], [data-review-field], [data-review-day]");
		Array.from(controls).find(control => control.dataset[key] === previous.dataset[key])?.focus({ preventScroll: true });
	}

	private renderHeader(): void {
		const header = this.rootEl!.createDiv({ cls: "cg-weekly-review-header" });
		header.createEl("h2", { text: "周回顾" });
		const actions = header.createDiv({ cls: "cg-weekly-review-header-actions" });
		if (this.snapshot) actions.createSpan({ cls: "cg-weekly-review-generated", text: `更新于 ${formatTimestamp(this.snapshot.generatedAt)}` });
		const refresh = actions.createEl("button", { cls: "cg-weekly-review-refresh", text: "刷新", attr: {type: "button", "aria-label": "刷新周回顾"} });
		refresh.dataset.reviewAction = "refresh";
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
		const controls = this.scrollEl!.createDiv({ cls: "cg-weekly-review-controls" });
		this.renderWeekNavigation(controls, snapshot);
		const toolbar = controls.createDiv({ cls: "cg-weekly-review-filterbar" });
		this.renderRootSelect(toolbar, snapshot);
		this.renderDepthSelect(toolbar);
		const options = toolbar.createEl("details", { cls: "cg-weekly-review-options" });
		options.open = this.optionsOpen;
		options.ontoggle = () => { this.optionsOpen = options.open; };
		const summary = options.createEl("summary", { text: "显示选项" });
		summary.dataset.reviewAction = "options";
		const fields = options.createDiv({ cls: "cg-weekly-review-option-fields" });
		this.renderGoalInput(fields);
	}

	private renderWeekNavigation(parent: HTMLElement, snapshot: WeeklyReviewSnapshot): void {
		const nav = parent.createDiv({ cls: "cg-weekly-review-week-nav" });
		this.createControlButton(nav, "‹", "上一周", () => this.shiftWeek(-7), {disabled: this.isPreviousDisabled(snapshot), id: "previous-week"});
		const dateNav = nav.createDiv({ cls: "cg-weekly-review-date-picker" });
		const dateTrigger = mountDatePicker(dateNav, {
			value: snapshot.weekStart, dates: reviewCalendarDates(snapshot), onSelect: date => this.selectDate(date),
		});
		dateTrigger.dataset.reviewField = "date";
		dateTrigger.setAttribute("aria-label", `选择周，当前 ${snapshot.weekStart} 至 ${snapshot.weekEnd}`);
		dateTrigger.querySelector(".cg-date-trigger-value")!.textContent = `${snapshot.weekStart.slice(5).replace("-", "月")}日 — ${snapshot.weekEnd.slice(5).replace("-", "月")}日`;
		this.createControlButton(nav, "›", "下一周", () => this.shiftWeek(7), {disabled: snapshot.isCurrentWeek, id: "next-week"});
		if (!snapshot.isCurrentWeek) this.createControlButton(nav, "回到本周", "回到本周", () => this.selectCurrentWeek(), {disabled: false, id: "current-week"});
		nav.createSpan({ cls: "cg-weekly-review-year", text: snapshot.weekStart.slice(0, 4) + "年" });
	}

	private renderRootSelect(parent: HTMLElement, snapshot: WeeklyReviewSnapshot): void {
		const picker = parent.createEl("details", { cls: "cg-weekly-review-root-picker" });
		picker.open = this.rootPickerOpen;
		picker.ontoggle = () => { this.rootPickerOpen = picker.open; };
		const summary = picker.createEl("summary", { text: this.selectedRoot || "全部记录" });
		summary.dataset.reviewField = "root";
		summary.setAttribute("aria-label", `统计范围：${this.selectedRoot || "全部记录"}`);
		const panel = picker.createDiv({ cls: "cg-weekly-review-root-panel" });
		const search = panel.createEl("input", { type: "search", placeholder: "搜索目录", attr: {"aria-label": "搜索统计目录"} });
		search.dataset.reviewField = "root-search";
		const results = panel.createDiv({ cls: "cg-weekly-review-root-results", attr: {role: "group", "aria-label": "统计目录"} });
		const preferred = this.service.getSettings().trackedFolders;
		const paths = this.getFolderPaths(snapshot).sort((a, b) => Number(preferred.includes(b)) - Number(preferred.includes(a)) || a.localeCompare(b));
		const update = () => this.renderRootResults(results, paths, search.value);
		search.oninput = update;
		search.onkeydown = event => { if (event.key === "ArrowDown") { event.preventDefault(); results.querySelector<HTMLButtonElement>("button")?.focus(); } };
		results.onkeydown = event => this.navigateRootResults(event, results, search);
		update();
	}

	private renderRootResults(parent: HTMLElement, paths: string[], keyword: string): void {
		parent.empty();
		const matched = paths.filter(path => path.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase()));
		for (const path of ["", ...matched]) {
			const exists = !path || this.app.vault.getAbstractFileByPath(path) instanceof TFolder;
			const button = parent.createEl("button", { text: path ? `${path}${exists ? "" : "（已不存在）"}` : "全部记录", attr: {type: "button", "aria-pressed": String(path === this.selectedRoot)} });
			button.title = path || "笔记与 YOLO 的全部已有时长";
			button.dataset.reviewRoot = path;
			button.onclick = () => {
				this.rootPickerOpen = false;
				this.resetAnalysisSelection();
				this.refreshSnapshot(this.getQueryWithRoot(path), { root: path });
				this.rootEl?.querySelector<HTMLElement>('[data-review-field="root"]')?.focus();
			};
		}
		if (!matched.length && keyword.trim()) parent.createDiv({ cls: "cg-weekly-review-empty-inline", text: "没有匹配的目录" });
	}

	private navigateRootResults(event: KeyboardEvent, results: HTMLElement, search: HTMLInputElement): void {
		const buttons = Array.from(results.querySelectorAll<HTMLButtonElement>("button"));
		const index = buttons.indexOf(event.target as HTMLButtonElement);
		if (event.key === "ArrowUp" && index === 0) { event.preventDefault(); search.focus(); return; }
		const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
		if (next >= 0 && next < buttons.length) { event.preventDefault(); buttons[next].focus(); }
	}

	private renderDepthSelect(parent: HTMLElement): void {
		const group = parent.createDiv({ cls: "cg-weekly-review-control-group" });
		group.createDiv({ cls: "cg-weekly-review-control-label", text: "分组" });
		const select = group.createEl("select", { cls: "cg-weekly-review-select" });
		select.dataset.reviewField = "depth";
		select.setAttribute("aria-label", "选择学科分组层级");
		this.createOption(select, "1", "一级目录");
		this.createOption(select, "2", "二级目录");
		select.title=`按${this.getGroupingOptions(this.snapshot!).groupingRoot||"仓库根目录"}下的目录层级展示`;
		select.value = String(this.depth);
		select.onchange = () => {
			this.depth = select.value === "2" ? 2 : 1;
			this.resetAnalysisSelection();
			this.render();
		};
	}

	private renderGoalInput(parent: HTMLElement): void {
		const group = parent.createDiv({ cls: "cg-weekly-review-control-group cg-weekly-review-goal-control" });
		group.createDiv({ cls: "cg-weekly-review-control-label", text: "每日参考目标" });
		const line = group.createDiv({ cls: "cg-weekly-review-goal-line" });
		const input = line.createEl("input", { cls: "cg-weekly-review-goal-input" });
		input.dataset.reviewField = "goal";
		input.type = "text";
		input.inputMode = "numeric";
		input.value = this.goalText;
		input.placeholder = "未设置";
		input.setAttribute("aria-label", "本次参考目标分钟数");
		input.setAttribute("aria-invalid", String(Boolean(this.goalError)));
		line.createSpan({ cls: "cg-weekly-review-control-hint", text: "分钟 / 天" });
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

	}

	private refreshReport(): void {
		if (!this.rootEl || !this.snapshot || this.closed) return;
		const scrollTop = this.scrollEl?.scrollTop || 0;
		this.charts?.el.remove();
		this.timelineCharts?.el.remove();
		this.scrollEl?.querySelector(".cg-weekly-review-report")?.remove();
		this.renderReport(this.snapshot);
		if (this.scrollEl) this.scrollEl.scrollTop = scrollTop;
	}

	private renderReport(snapshot: WeeklyReviewSnapshot): void {
		const report = this.scrollEl!.createDiv({ cls: "cg-weekly-review-report" });
		const options = this.getGroupingOptions(snapshot);
		this.insights = buildWeeklyReviewInsights(snapshot,options);
		this.renderOverview(report, snapshot);
		const observations=this.insights.observations.filter(item=>item.kind!=="comparison"||this.insights!.changes.canDescribeChange).slice(0,2);
		renderWeeklyObservations(report,observations,action=>this.revealObservation(action));
		this.renderChartTabs(report);
		if (this.panel === "analysis") {
			if (!this.charts) this.charts = new WeeklyReviewCharts(report.ownerDocument, selection => this.selectAnalysis(selection));
			report.appendChild(this.charts.el);
			this.charts.update(snapshot, options,this.insights);
			this.renderComparisonView();
		} else {
			if (!this.timelineCharts) this.timelineCharts = new WeeklyReviewTimelineCharts(report.ownerDocument, selection => this.selectAnalysis(selection));
			report.appendChild(this.timelineCharts.el);
			this.timelineCharts.update(snapshot, options);
		}
		const panel = this.panel === "analysis" ? this.charts!.el : this.timelineCharts!.el;
		panel.id="cg-weekly-review-chart-panel";
		panel.setAttribute("role","tabpanel");
		panel.setAttribute("aria-label",this.panel === "analysis" ? "投入分析" : "趋势与时段");
		this.renderDocuments(report, snapshot);
		const daily = report.createEl("details", { cls: "cg-weekly-review-daily-details" });
		daily.open = this.dailyOpen;
		daily.ontoggle = () => { this.dailyOpen = daily.open; };
		const summary = daily.createEl("summary", { text: "每日记录与参考目标" });
		summary.dataset.reviewAction = "daily-details";
		this.renderDailyTrend(daily, snapshot);
		this.renderNotes(report, snapshot);
	}

	private getGroupingOptions(snapshot:WeeklyReviewSnapshot):{groupingRoot:string;depth:1|2} {
		const roots=normalizeTrackedFolders(this.service.getSettings().trackedFolders);
		return {groupingRoot:snapshot.root||(roots.length===1?roots[0]:""),depth:this.depth};
	}

	private renderComparisonView(): void {
		const section=this.charts!.el.querySelector<HTMLElement>(".cg-weekly-comparison")!.closest<HTMLElement>(".cg-weekly-analysis-section")!;
		section.querySelector(".cg-review-comparison-modes")?.remove();
		const controls=section.ownerDocument.createElement("div");controls.className="cg-review-comparison-modes";controls.setAttribute("role","group");controls.setAttribute("aria-label","比较视图");section.prepend(controls);
		for(const [mode,label] of [["comparison","同期对比"],["ranking","四周排名"]] as const){
			const button=controls.createEl("button",{text:label,attr:{type:"button","aria-pressed":String(this.comparisonView===mode)}});button.dataset.reviewAction=`compare-view-${mode}`;
			button.onclick=()=>{this.resetAnalysisSelection();this.comparisonView=mode;this.refreshReport();this.rootEl?.querySelector<HTMLElement>(`[data-review-action="compare-view-${mode}"]`)?.focus({preventScroll:true});};
		}
		for(const element of Array.from(section.querySelectorAll<HTMLElement>(":scope > .cg-weekly-analysis-heading, :scope > .cg-weekly-analysis-body")))element.hidden=this.comparisonView==="ranking";
		if(this.comparisonView==="ranking"){
			if(!this.rankingChart)this.rankingChart=new WeeklyReviewRankingChart(section.ownerDocument,selection=>this.selectAnalysis(selection));
			section.appendChild(this.rankingChart.el);this.rankingChart.el.hidden=false;this.rankingChart.update(this.insights!.ranking);
		}else if(this.rankingChart)this.rankingChart.el.hidden=true;
	}

	private revealObservation(action:WeeklyReviewInsightAction):void {
		this.resetAnalysisSelection();this.panel=action.kind==="hour"?"timeline":"analysis";this.comparisonView="comparison";this.refreshReport();
		let target:HTMLElement|undefined;
		if(action.kind==="hour"){
			const [start,end]=action.id.split("-").map(Number);this.timelineCharts?.revealHours(start,end);
			target=this.timelineCharts?.el.querySelector<HTMLElement>('[data-timeline-control="heat-date"]')?.closest<HTMLElement>(".cg-timeline-section")||undefined;
		}else{
			if(action.kind==="structure")this.charts?.revealStructure(action.id);else this.charts?.revealComparison(action.id,action.period);
			target=this.charts?.el.querySelector<HTMLElement>(action.kind==="structure"?".cg-weekly-sunburst":".cg-weekly-comparison")?.closest<HTMLElement>(".cg-weekly-analysis-section")||undefined;
		}
		target?.scrollIntoView({block:"start"});target?.querySelector<HTMLElement>("select, button:not(:disabled)")?.focus({preventScroll:true});
	}

	private renderChartTabs(parent: HTMLElement): void {
		const tabs = parent.createDiv({cls:"cg-weekly-review-tabs",attr:{role:"tablist","aria-label":"分析视图"}});
		for (const [id, label] of [["analysis","投入分析"],["timeline","趋势与时段"]] as const) {
			const button = tabs.createEl("button",{text:label,attr:{type:"button",role:"tab","aria-selected":String(this.panel===id),tabindex:this.panel===id?"0":"-1"}});
			button.dataset.reviewAction=`panel-${id}`;
			button.setAttribute("aria-controls","cg-weekly-review-chart-panel");
			button.onclick=()=>{this.resetAnalysisSelection();this.panel=id;this.refreshReport();this.rootEl?.querySelector<HTMLElement>(`[data-review-action="panel-${id}"]`)?.focus({preventScroll:true});};
			button.onkeydown=event=>{
				if (!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
				event.preventDefault();
				const next=event.key==="Home"?"analysis":event.key==="End"?"timeline":id==="analysis"?"timeline":"analysis";
				tabs.querySelector<HTMLButtonElement>(`[data-review-action="panel-${next}"]`)?.click();
			};
		}
	}

	private selectAnalysis(selection: WeeklyReviewChartSelection | undefined): void {
		this.chartSelection = selection;
		this.comparisonNotePath=undefined;
		this.comparisonPeriod = selection?.period || "current";
		this.refreshDocuments();
	}

	private resetAnalysisSelection(): void {
		this.chartSelection = undefined;
		this.comparisonNotePath=undefined;
		this.comparisonPeriod = "current";
		this.charts?.clearSelection();
		this.timelineCharts?.clearSelection();
		this.rankingChart?.clearSelection();
	}

	private refreshDocuments(): void {
		const previous = this.scrollEl?.querySelector<HTMLElement>(".cg-weekly-review-documents-section");
		if (!previous || !this.snapshot) return;
		const focused = previous.ownerDocument.activeElement as HTMLElement | null;
		const container = previous.ownerDocument.createElement("div");
		this.renderDocuments(container, this.snapshot);
		previous.replaceWith(container.firstElementChild!);
		if (focused) this.restoreControlFocus(focused);
	}

	private renderOverview(parent: HTMLElement, snapshot: WeeklyReviewSnapshot): void {
		const section = parent.createDiv({ cls: "cg-weekly-review-overview" });
		section.createDiv({ cls: "cg-weekly-review-summary-label", text: snapshot.isCurrentWeek ? "本周已记录" : "本周已记录 · 历史周" });
		const main=section.createDiv({cls:"cg-weekly-review-summary-main"});
		main.createDiv({ cls: "cg-weekly-review-summary-value", text: formatDuration(snapshot.totalSeconds) });
		main.createDiv({ cls: "cg-weekly-review-summary-hint", text: `有记录 ${snapshot.recordedDays} 天 · ${snapshot.root || "笔记与 YOLO"}` });
		if (!snapshot.documents.length) section.createDiv({ cls: "cg-weekly-review-empty-inline", text: this.service.getSettings().timeTrackingEnabled ? "本周暂无记录" : "暂无记录，可在设置中开启时长统计" });
		if (snapshot.warnings.length) this.renderWarningList(section, snapshot.warnings);
	}

	private renderDailyTrend(parent: HTMLElement, snapshot: WeeklyReviewSnapshot): void {
		const section = this.createSection(parent, "每日时长", "");
		const maxSeconds = Math.max(60, Math.ceil(Math.max(...snapshot.days.map(day => day.seconds)) / 60) * 60);
		const plot = section.createDiv({ cls: "cg-weekly-review-plot" });
		const axis = plot.createDiv({ cls: "cg-weekly-review-axis", attr: {"aria-hidden": "true"} });
		axis.createSpan({ text: `${Math.ceil(maxSeconds / 60)}分` });
		axis.createSpan({ text: "0" });
		const days = plot.createDiv({ cls: "cg-weekly-review-days", attr: {role: "group", "aria-label": "周一至周日已记录时长"} });
		const selected = snapshot.days.find(day => day.date === this.selectedDay) || snapshot.days.find(day => day.date === snapshot.today) || snapshot.days[0];
		for (const day of snapshot.days) this.renderDay(days, day, snapshot, maxSeconds, day === selected);
		this.renderDayDetail(section, selected, snapshot);
	}

	private renderDay(parent: HTMLElement, day: WeeklyReviewDay, snapshot: WeeklyReviewSnapshot, maxSeconds: number, selected: boolean): void {
		const goal = getWeeklyReviewGoal(day, snapshot.today, this.getGoalMinutes());
		const value = reviewDayValue(day);
		const status = day.future && !day.seconds ? "尚未到来" : COVERAGE_LABELS[day.coverage];
		const button = parent.createEl("button", { cls: "cg-weekly-review-day", attr: {type: "button", "aria-pressed": String(selected), "aria-label": `${formatDate(day.date)}，${value}，${status}，${this.getGoalLabel(goal)}`} });
		button.dataset.reviewDay = day.date;
		button.classList.toggle("is-future", day.future);
		button.classList.toggle("is-today", day.date === snapshot.today);
		button.classList.toggle("is-selected", selected);
		button.classList.toggle("is-untracked", !day.seconds && day.coverage === "UNTRACKED" && !day.future);
		const graph = button.createDiv({ cls: "cg-weekly-review-day-graph", attr: {"aria-hidden": "true"} });
		graph.createSpan({ cls: "cg-weekly-review-day-value", text: reviewDayBarLabel(day) });
		const bar = graph.createDiv({ cls: "cg-weekly-review-day-bar" });
		bar.style.height = `${Math.max(0, Math.min(100, day.seconds / maxSeconds * 100))}%`;
		button.createSpan({ cls: "cg-weekly-review-day-weekday", text: day.date === snapshot.today ? "今天" : `周${getWeekday(day.date)}` });
		button.createEl("time", { cls: "cg-weekly-review-day-date", text: day.date.slice(5).replace("-", "/"), attr: {datetime: day.date} });
		button.onclick = () => { this.selectedDay = day.date; this.render(); };
		button.onkeydown = event => this.navigateDays(event, parent);
	}

	private navigateDays(event: KeyboardEvent, parent: HTMLElement): void {
		const buttons = Array.from(parent.querySelectorAll<HTMLButtonElement>(".cg-weekly-review-day"));
		const index = buttons.indexOf(event.currentTarget as HTMLButtonElement);
		const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
		if (next >= 0 && next < buttons.length) { event.preventDefault(); buttons[next].focus(); }
	}

	private renderDayDetail(parent: HTMLElement, day: WeeklyReviewDay, snapshot: WeeklyReviewSnapshot): void {
		const detail = parent.createDiv({ cls: "cg-weekly-review-day-detail", attr: {"aria-live": "polite"} });
		detail.createSpan({ text: formatDate(day.date) });
		detail.createEl("strong", { text: reviewDayValue(day) });
		if (!day.future || day.seconds > 0) {
			detail.createSpan({ text: COVERAGE_LABELS[day.coverage] });
			if (this.getGoalMinutes()) detail.createSpan({ text: this.getGoalLabel(getWeeklyReviewGoal(day, snapshot.today, this.getGoalMinutes())) });
		}
		if (day.future && day.seconds > 0) detail.createSpan({ cls: "cg-weekly-review-alert", text: "日期超前" });
		if (day.timezoneWarning) detail.createSpan({ cls: "cg-weekly-review-alert", text: "时区需确认" });
		if(this.service.getActivityTimelineDay&&this.service.subscribe&&(!day.future||day.seconds>0)){
			const button=detail.createEl("button",{text:"查看当天时间轴",attr:{type:"button"}});
			button.dataset.reviewAction="open-activity-timeline";button.onclick=()=>this.openActivityTimeline(day.date,button);
		}
	}

	private openActivityTimeline(date:string,trigger:HTMLElement):void {
		if(!this.snapshot||!this.rootEl)return;
		this.activityReturnFocus=trigger;this.activityReturnScroll=this.scrollEl?.scrollTop||0;
		this.activitySummary?.dispose();this.activityView?.dispose();this.activityHost?.remove();
		this.rootEl.hidden=true;
		const host=this.contentEl.createDiv({cls:"cg-weekly-activity-host",attr:{"data-cg-time-control":"activity-timeline"}});
		this.activityHost=host;
		const back=host.createEl("button",{text:"‹ 返回周回顾",cls:"cg-weekly-activity-back",attr:{type:"button"}});
		back.dataset.reviewAction="back-from-activity-timeline";back.onclick=()=>this.leaveActivityTimeline();
		const config=new ContributionGraphConfig();
		Object.assign(config,{title:"学习时间轴",fromDate:this.snapshot.weekStart,toDate:this.snapshot.weekEnd,activityFolders:this.selectedRoot?[this.selectedRoot]:[],timelineDepth:this.depth});
		const options=createActivityTimelineOptions(this.app,this.service as EditActivityService,config,host.ownerDocument);
		this.activityView=new ActivityTimelineView(host,{...options,date,groupingRoot:this.getGroupingOptions(this.snapshot).groupingRoot,onExpand:undefined,
			onHourly:(day,folders)=>this.openActivityHours(day,folders),onOpenDocument:(path,event)=>this.openDocument(path,event)});
		this.modalEl.setAttribute("aria-label","周回顾 · 学习时间轴");back.focus({preventScroll:true});
	}

	private leaveActivityTimeline():void {
		this.activitySummary?.dispose();this.activitySummary=undefined;
		this.activityView?.dispose();this.activityView=undefined;
		this.activityHost?.remove();this.activityHost=undefined;
		if(this.rootEl)this.rootEl.hidden=false;
		if(this.scrollEl)this.scrollEl.scrollTop=this.activityReturnScroll;
		this.modalEl.setAttribute("aria-label","周回顾");
		if(this.activityReturnFocus?.isConnected)this.activityReturnFocus.focus({preventScroll:true});
	}

	private openActivityHours(date:string,folders:readonly string[]):void {
		if(!this.activityHost||!this.activityView)return;
		this.activitySummary?.dispose();this.activityView.el.hidden=true;
		this.activitySummary=renderTimelineHourlySummary(this.activityHost,{app:this.app,service:this.service as EditActivityService,date,folders,onBack:()=>this.leaveActivityHours()});
	}

	private leaveActivityHours():void {
		this.activitySummary?.dispose();this.activitySummary=undefined;
		if(this.activityView){this.activityView.el.hidden=false;this.activityView.refresh();this.activityView.focus();}
	}


	private renderDocuments(parent: HTMLElement, snapshot: WeeklyReviewSnapshot): void {
		const selection = this.chartSelection;
		const source: readonly TimeDocumentStats[] = selection?.kind === "comparison" && this.comparisonPeriod === "previous"
			? selection.previousDocuments || [] : selection?.documents || snapshot.documents;
		const documents = source.filter(document => !isYoloChatActivity(document.path) && document.seconds > 0)
			.slice().sort((left, right) => right.seconds - left.seconds || left.path.localeCompare(right.path)).slice(0, 10);
		const comparing=selection?.kind==="comparison";
		const section = this.createSection(parent, comparing?this.comparisonNotePath?"笔记详情":"笔记变化":"重点笔记", comparing?"同一分组 · 两期已记录量":"时长 · 占当前选择");
		section.addClass("cg-weekly-review-documents-section");
		if (selection) this.renderSelectionLabel(section, selection);
		if (comparing) {
			const group=this.insights?.changes.groups.find(group=>group.id===selection.id);
			if(group&&!group.activity){
				if(this.comparisonNotePath)this.renderComparisonNoteDetail(section,group,selection);
				else renderWeeklyDocumentChanges(section,group,(note,period)=>this.selectComparisonNote(note,period));
				return;
			}
		}
		if (!documents.length) {
			section.createDiv({ cls: "cg-weekly-review-empty-inline", text: selection?.activity ? "YOLO 对话活动不对应笔记。" : "当前选择未见可显示的笔记记录。" });
			return;
		}
		const denominator = source.reduce((sum, document) => sum + document.seconds, 0);
		const list = section.createDiv({ cls: "cg-weekly-review-documents" });
		for (const document of documents) this.renderDocument(list, document.path, document.seconds, denominator);
	}

	private renderSelectionLabel(parent: HTMLElement, selection: WeeklyReviewChartSelection): void {
		const start=selection.kind==="comparison"&&this.comparisonPeriod==="previous"?selection.previousFromDate:selection.fromDate;
		const end=selection.kind==="comparison"&&this.comparisonPeriod==="previous"?selection.previousToDate:selection.toDate;
		const selected=selection.kind==="comparison"&&this.comparisonNotePath?`${selection.label} · ${getFileName(this.comparisonNotePath)}`:selection.label;
		const label=start?`${start}${end&&end!==start?`—${end}`:""} · ${selected}`:selected;
		const clear = parent.createEl("button", { cls: "cg-weekly-review-clear-filter", text: `${label} ×`, attr: {type: "button", "aria-label": "清除笔记筛选"} });
		clear.dataset.reviewAction = "clear-group";
		clear.onclick = () => {
			this.resetAnalysisSelection();
			const active = this.panel === "analysis" ? this.charts?.el : this.timelineCharts?.el;
			active?.querySelector<HTMLElement>("button, select")?.focus({preventScroll: true});
		};
	}

	private selectComparisonNote(note:WeeklyReviewChangeDocument,period:"current"|"previous"):void {
		const selection=this.chartSelection;if(selection?.kind!=="comparison")return;
		this.comparisonNotePath=note.path;
		this.comparisonPeriod=period;this.refreshDocuments();
	}

	private renderComparisonNoteDetail(parent:HTMLElement,group:WeeklyReviewChangeGroup,selection:WeeklyReviewChartSelection):void {
		const note=group.documents.find(note=>note.path===this.comparisonNotePath);if(!note)return;
		const back=parent.createEl("button",{text:"‹ 返回分组",cls:"cg-review-note-back",attr:{type:"button"}});back.dataset.reviewAction="back-to-group";
		back.onclick=()=>{
			this.comparisonNotePath=undefined;this.refreshDocuments();
			const buttons=Array.from(this.rootEl!.querySelectorAll<HTMLButtonElement>("[data-review-change-note]")).filter(e=>e.dataset.reviewChangeNote===note.path&&!e.disabled);
			const target=buttons.find(e=>e.dataset.reviewChangePeriod===this.comparisonPeriod)||buttons[0];
			const details=target?.closest("details");if(details)details.open=true;
			target?.focus({preventScroll:true});
		};
		this.renderComparisonPeriods(parent,selection);
		this.renderDocument(parent,note.path,0,0,false);
		const amounts=parent.createDiv({cls:"cg-review-note-amounts"});renderWeeklyDocumentAmounts(amounts,note);
	}

	private renderComparisonPeriods(parent: HTMLElement, selection: WeeklyReviewChartSelection): void {
		const controls = parent.createDiv({ cls: "cg-weekly-review-note-periods", attr: {role: "group", "aria-label": "笔记所属对照区间"} });
		for (const period of ["current", "previous"] as const) {
			const start = period === "current" ? selection.fromDate : selection.previousFromDate;
			const end = period === "current" ? selection.toDate : selection.previousToDate;
			const label = `${period === "current" ? "本期" : "上期"} ${start?.slice(5) || "—"}—${end?.slice(5) || "—"}`;
			const button = controls.createEl("button", { text: label, attr: {type: "button", "aria-pressed": String(this.comparisonPeriod === period)} });
			button.dataset.reviewAction = `comparison-${period}`;
			button.onclick = () => { this.comparisonPeriod = period; this.refreshDocuments(); };
		}
	}

	private renderDocument(parent: HTMLElement, path: string, seconds: number, denominator: number, showDuration=true): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		const row = parent.createDiv({ cls: "cg-weekly-review-document" });
		row.dataset.reviewAction = "open-document";
		row.dataset.reviewPath = path;
		const label = row.createDiv({ cls: "cg-weekly-review-document-label" });
		label.createDiv({ cls: "cg-weekly-review-document-name", text: getFileName(path) });
		label.createDiv({ cls: "cg-weekly-review-document-path", text: path, attr: {title: path} });
		if(showDuration){
			const value = row.createDiv({ cls: "cg-weekly-review-document-duration" });
			value.createDiv({ text: formatDuration(seconds) });
			if (denominator > 0) value.createDiv({ cls: "cg-weekly-review-document-share", text: formatPercentage(seconds / denominator * 100) });
		}
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
		const section = parent.createEl("details", { cls: "cg-weekly-review-notes" });
		section.open = this.notesOpen;
		section.ontoggle = () => { this.notesOpen = section.open; };
		const summary = section.createEl("summary", { text: "统计说明" });
		summary.dataset.reviewAction = "notes";
		const notes = [
			"只汇总已记录的活跃时长，不代表注意力或掌握程度。缺失记录不等于零投入。",
			"时长按原记录日期汇总，覆盖按本机日界判断；多端同时活动直接相加。",
			"本周累计包含今天，同期比较仅使用已结束日期；历史周比较上一完整周。",
			this.goalError ? "目标输入无效，已隐藏目标判断。" : this.goalText ? `本次每日参考目标 ${this.goalText} 分钟，不还原历史目标。` : "未设置参考目标。",
			"分组和目标仅本次有效，不修改全局采集范围；点击刷新获取最新记录。",
		];
		for (const note of notes) section.createEl("p", { text: note });
	}

	private createSection(parent: HTMLElement, title: string, subtitle: string): HTMLElement {
		const section = parent.createDiv({ cls: "cg-weekly-review-section" });
		const heading = section.createDiv({ cls: "cg-weekly-review-section-heading" });
		heading.createEl("h3", { text: title });
		if (subtitle) heading.createDiv({ cls: "cg-weekly-review-section-subtitle", text: subtitle });
		return section;
	}



	private renderWarningList(parent: HTMLElement, warnings: readonly string[]): void {
		const severe = warnings.filter(warning => warning.includes("日期超前") || warning.includes("时区"));
		for (const warning of severe) parent.createDiv({ cls: "cg-weekly-review-alert", text: warning });
		const remaining = warnings.filter(warning => !severe.includes(warning));
		if (!remaining.length) return;
		const details = parent.createEl("details", { cls: "cg-weekly-review-warnings" });
		details.open = this.warningsOpen;
		details.ontoggle = () => { this.warningsOpen = details.open; };
		const summary = details.createEl("summary", { text: warnings.some(w => w.includes("缺失")) ? "部分日期记录不完整 · 查看原因" : "记录范围 · 查看说明" });
		summary.dataset.reviewAction = "warnings";
		for (const warning of remaining) details.createEl("p", { text: warning });
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


	private getGoalMinutes(): number | undefined {
		return this.goalError || !this.goalText ? undefined : Number(this.goalText);
	}







	private getGoalLabel(goal: WeeklyReviewGoalState): string {
		if (this.goalError) return "目标无效";
		return this.goalText ? GOAL_LABELS[goal] : "未设置目标";
	}




	private isPreviousDisabled(snapshot: WeeklyReviewSnapshot): boolean {
		if (!snapshot.earliestDate) return false;
		return shiftReviewDate(snapshot.weekStart, -1) < snapshot.earliestDate;
	}

	private shiftWeek(days: number): void {
		if (!this.snapshot) return;
		const date = shiftReviewDate(this.snapshot.weekStart, days);
		this.resetAnalysisSelection();
		this.refreshSnapshot(this.getQueryWithDate(date), { date });
	}

	private selectDate(date: string): void {
		const weekStart = getReviewWeekStart(date);
		this.resetAnalysisSelection();
		this.refreshSnapshot(this.getQueryWithDate(weekStart), { date: weekStart });
	}

	private selectCurrentWeek(): void {
		this.resetAnalysisSelection();
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

function formatPercentage(value: number, signed = false): string {
	if (!Number.isFinite(value)) return "变化率无法计算";
	const rounded = Math.round(value * 10) / 10 || 0;
	return `${signed && rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}

function reviewDayBarLabel(day: WeeklyReviewDay): string {
	if (day.seconds) return compactDuration(day.seconds);
	if (day.future) return "—";
	return {TRACKED: "0", UNTRACKED: "未采集", UNKNOWN: "待确认", PARTIAL: "部分"}[day.coverage];
}

function compactDuration(seconds: number): string {
	if (seconds < 60) return "<1分";
	const minutes = Math.floor(seconds / 60);
	return minutes < 100 ? `${minutes}分` : `${(seconds / 3600).toFixed(1)}时`;
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
