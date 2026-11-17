import type { EditActivityChangeEvent } from "../activity/EditActivityService";
import { GraphRefreshScheduler } from "../processor/graphRefreshScheduler";
import type { ActivityTimelineBlock, ActivityTimelineDay, ActivityTimelineViewOptions, ActivityTimelineViewState } from "../time/activityTimelineTypes";
import { activityPalette, activitySwatch } from "./activityColors";
import { ActivityTimelineChart } from "./activityTimelineChart";
import type { ActivityTimelineChartRow } from "./activityTimelineChart";
import { ActivityTimelineDetails } from "./activityTimelineDetails";

interface TimelineRows { rows: ActivityTimelineChartRow[]; groups: TimelineGroup[]; }
interface TimelineGroup { id: string; name: string; expanded: boolean; }

export class ActivityTimelineView {
	private static readonly instances=new Set<ActivityTimelineView>();

	static disposeAll(owner?:Document|Window):void {
		for(const view of this.instances)if(!owner||view.owner===owner||view.win===owner)view.dispose();
	}

	readonly el: HTMLElement;
	private readonly owner: Document;
	private readonly win: Window & typeof globalThis;
	private readonly titleText: string;
	private options: ActivityTimelineViewOptions;
	private state: ActivityTimelineViewState;
	private day?: ActivityTimelineDay;
	private chart!: ActivityTimelineChart;
	private details!: ActivityTimelineDetails;
	private chartHost!: HTMLElement;
	private detailsHost!: HTMLElement;
	private segmentSelect!: HTMLSelectElement;
	private dateInput!: HTMLInputElement;
	private dateCaption!: HTMLElement;
	private status!: HTMLElement;
	private groupControls!: HTMLElement;
	private depthSelect!: HTMLSelectElement;
	private previousButton!: HTMLButtonElement;
	private nextButton!: HTMLButtonElement;
	private todayButton!: HTMLButtonElement;
	private fitButton!: HTMLButtonElement;
	private fullDayButton!: HTMLButtonElement;
	private zoomOutButton!: HTMLButtonElement;
	private zoomInButton!: HTMLButtonElement;
	private scheduler: GraphRefreshScheduler;
	private resizeObserver?: ResizeObserver;
	private themeObserver?: MutationObserver;
	private detachObserver?:MutationObserver;
	private everConnected=false;
	private readonly windowClosed=()=>this.dispose();
	private disposed = false;
	private needsFit = true;
	private selectionRemoved = false;

	constructor(container: HTMLElement, options: ActivityTimelineViewOptions) {
		this.owner = container.ownerDocument;
		this.win = this.owner.defaultView as Window & typeof globalThis;
		this.titleText = options.title?.trim() || "学习时间轴";
		this.el = this.owner.createElement("section");
		this.options = options;
		this.state = initialState(options);
		this.needsFit = !options.initialState?.window;
		this.el.classList.add("cg-activity-timeline");
		this.el.dataset.cgTimeControl = "activity-timeline";
		container.appendChild(this.el);
		this.build();
		this.scheduler = new GraphRefreshScheduler({container: this.el, refresh: events => this.refresh(events), accept: event => this.accepts(event), subscribe: listener => this.options.service.subscribe(listener), hourly: false});
		this.bindObservers();
		this.scheduler.start();
		this.refresh();
		ActivityTimelineView.instances.add(this);
	}

	getState(): ActivityTimelineViewState { return {...this.state, window: [...this.state.window] as [number, number], expanded: [...this.state.expanded]}; }

	update(options: ActivityTimelineViewOptions): void {
		if (this.disposed) return;
		const date = clampDate(options.date || this.state.date, options.fromDate, options.toDate);
		const contextChanged = date !== this.state.date || !sameFolders(options.folders, this.options.folders) || options.groupingRoot !== this.options.groupingRoot;
		this.options = options;
		const heading=this.el.querySelector("header h3");
		if(heading)heading.textContent=options.title?.trim()||"学习时间轴";
		this.dateInput.min = options.fromDate;
		this.dateInput.max = options.toDate;
		if (contextChanged) {
			this.state.date = date;
			this.state.selectedId = undefined;
			this.state.highlightedPath = undefined;
			this.needsFit = true;
		}
		if (options.depth && options.depth !== this.state.depth) this.state.depth = options.depth;
		this.refresh();
	}

	refresh(_events: EditActivityChangeEvent[] = []): void {
		if (this.disposed) return;
		this.refreshDateRange();
		this.followToday();
		const previousDate = this.day?.date;
		this.day = this.readDay();
		if (this.isUnrecordedFuture(this.day)) {
			this.state.date = clampDate(this.day.today, this.options.fromDate, this.options.toDate);
			this.state.followToday = true;
			this.state.selectedId = undefined;
			this.state.highlightedPath = undefined;
			this.needsFit = true;
			this.day = this.readDay();
		}
		if (this.state.selectedId && !this.day.blocks.some(block => block.id === this.state.selectedId)) {
			this.state.selectedId = undefined;
			this.state.highlightedPath = undefined;
			this.selectionRemoved = true;
		}
		if (this.needsFit || (previousDate !== undefined && previousDate !== this.day.date)) this.state.window = fitWindow(this.day.blocks);
		this.state.window = normalizeWindow(this.state.window);
		this.needsFit = false;
		this.paint();
	}

	private isUnrecordedFuture(day: ActivityTimelineDay): boolean { return day.date > day.today && day.precision === "EMPTY" && !day.recordedDates.includes(day.date); }

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		ActivityTimelineView.instances.delete(this);
		this.scheduler.stop();
		this.resizeObserver?.disconnect();
		this.themeObserver?.disconnect();
		this.detachObserver?.disconnect();
		this.win.removeEventListener("unload",this.windowClosed);
		this.chart?.dispose();
		this.details?.dispose();
		this.el.remove();
	}

	focus(): void { this.dateInput.focus({preventScroll: true}); }

	handleEscape(): boolean {
		const active = this.owner.activeElement;
		if (active && this.el.contains(active) && (active.tagName === "INPUT" || active.tagName === "SELECT")) {
			(active as HTMLElement).blur();
			return true;
		}
		if (!this.state.selectedId) return false;
		this.clearSelection();
		this.segmentSelect.focus({preventScroll: true});
		return true;
	}

	private build(): void {
		const header = this.owner.createElement("header");
		header.className = "cg-activity-timeline-header";
		const title = header.appendChild(this.owner.createElement("h3"));
		title.textContent = this.titleText;
		this.dateCaption = header.appendChild(this.owner.createElement("span"));
		this.dateCaption.className = "cg-activity-timeline-caption";
		this.el.appendChild(header);
		this.buildToolbar();
		this.buildChart();
		this.el.addEventListener("keydown", event => {
			if (event.key === "Escape" && this.handleEscape()) { event.preventDefault(); event.stopPropagation(); }
		});
	}

	private buildToolbar(): void {
		const toolbar = this.owner.createElement("div");
		toolbar.className = "cg-activity-timeline-toolbar";
		this.previousButton = this.addButton(toolbar, "‹", "上一天", "previous-date", () => this.shiftDate(-1));
		this.dateInput = toolbar.appendChild(this.owner.createElement("input"));
		this.dateInput.type = "date";
		this.dateInput.value = this.state.date;
		this.dateInput.min = this.options.fromDate;
		this.dateInput.max = this.options.toDate;
		this.dateInput.setAttribute("aria-label", "选择时间轴日期");
		this.dateInput.dataset.timelineControl = "date";
		this.dateInput.onchange = () => this.changeDate(this.dateInput.value);
		this.nextButton = this.addButton(toolbar, "›", "下一天", "next-date", () => this.shiftDate(1));
		this.todayButton = this.addButton(toolbar, "今天", "回到今天", "today", () => this.changeDate(todayDate()));
		this.fitButton = this.addButton(toolbar, "适配记录", "适配当日记录", "fit", () => this.fit());
		this.fullDayButton = this.addButton(toolbar, "全天", "显示全天", "full-day", () => this.setWindow([0, 1440]));
		this.zoomOutButton = this.addButton(toolbar, "−", "缩小时间窗口", "zoom-out", () => this.zoom(2));
		this.zoomInButton = this.addButton(toolbar, "+", "放大时间窗口", "zoom-in", () => this.zoom(.5));
		this.depthSelect = this.createSelect(toolbar, "轨道层级", "depth", () => this.changeDepth());
		this.depthSelect.append(this.createOption("一级学科", "1"), this.createOption("二级分组", "2"));
		this.depthSelect.value = String(this.state.depth);
		if (this.options.onExpand) this.addButton(toolbar, "放大查看", "放大查看时间轴", "expand", () => this.options.onExpand?.(this.getState()));
		this.el.appendChild(toolbar);
	}

	private buildChart(): void {
		this.status = this.owner.createElement("div");
		this.status.className = "cg-activity-timeline-status";
		this.el.appendChild(this.status);
		this.groupControls = this.owner.createElement("div");
		this.groupControls.className = "cg-activity-timeline-groups";
		this.el.appendChild(this.groupControls);
		const selectionBar = this.owner.createElement("div");
		selectionBar.className = "cg-activity-timeline-selection";
		this.segmentSelect = this.createSelect(selectionBar, "选择片段", "segment", () => this.selectBlock(this.segmentSelect.value));
		this.el.appendChild(selectionBar);
		const heading = this.owner.createElement("h4");
		heading.className = "cg-activity-timeline-chart-heading";
		heading.textContent = "当天轨迹";
		this.el.appendChild(heading);
		this.chartHost = this.owner.createElement("div");
		this.chartHost.className = "cg-activity-timeline-chart";
		this.el.appendChild(this.chartHost);
		this.chart = new ActivityTimelineChart(this.chartHost, heading, {onSelect: id => this.selectBlock(id), onWindowChange: window => this.updateWindow(window)});
		this.details = new ActivityTimelineDetails(this.owner);
		this.detailsHost = this.details.el;
		this.el.appendChild(this.detailsHost);
	}

	private bindObservers(): void {
		const ResizeObserverCtor = this.win.ResizeObserver;
		if (typeof ResizeObserverCtor === "function") {
			this.resizeObserver = new ResizeObserverCtor(() => this.chart.resize());
			this.resizeObserver.observe(this.el);
		}
		const MutationObserverCtor = this.win.MutationObserver;
		if (typeof MutationObserverCtor === "function") {
			this.themeObserver = new MutationObserverCtor(() => this.paint());
			for (const target of [this.owner.documentElement, this.owner.body]) this.themeObserver.observe(target, {attributes: true, attributeFilter: ["class", "style"]});
		}
		this.bindDetachObserver();
	}

	private bindDetachObserver():void {
		this.win.addEventListener("unload",this.windowClosed);
		if(this.options.hostOwnsLifecycle)return;
		this.everConnected=this.el.isConnected;
		this.detachObserver=new this.win.MutationObserver(()=>{
			if(this.el.isConnected)this.everConnected=true;
			else if(this.everConnected)this.dispose();
		});
		this.detachObserver.observe(this.owner.body,{childList:true,subtree:true});
	}

	private paint(): void {
		if (this.disposed || !this.day) return;
		const focus = this.captureFocus();
		const model = buildRows(this.day.blocks, this.state);
		this.dateInput.value = this.state.date;
		this.dateCaption.textContent = `${this.state.date} · 周${weekday(this.state.date)}`;
		this.previousButton.disabled = !canShift(this.state.date, -1, this.options.fromDate, this.options.toDate);
		this.nextButton.disabled = !canShift(this.state.date, 1, this.options.fromDate, this.options.toDate) || !this.canOpenDate(shiftDate(this.state.date, 1));
		this.todayButton.disabled = clampDate(todayDate(), this.options.fromDate, this.options.toDate) === this.state.date;
		this.fitButton.disabled = !this.day.blocks.length;
		this.fullDayButton.disabled = !this.day.blocks.length;
		this.zoomOutButton.disabled = !this.day.blocks.length;
		this.zoomInButton.disabled = !this.day.blocks.length;
		this.status.textContent = statusText(this.day) + (this.selectionRemoved ? " · 所选片段已随记录更新移除" : "");
		this.renderGroups(model.groups, this.day.blocks);
		this.renderSegmentSelect(this.day.blocks);
		this.chartHost.hidden = !this.day.blocks.length;
		this.chartHost.style.height = `${Math.max(220, model.rows.length * 42 + 78)}px`;
		this.chart.render(this.day, model.rows, this.state);
		this.details.render({day: this.day, blocks: sortedBlocks(this.day.blocks), selectedId: this.state.selectedId}, this.detailActions());
		this.restoreFocus(focus);
	}

	private captureFocus(): {action?: string; segment?: string; group?: string; control?: string} {
		const active = this.owner.activeElement as HTMLElement | null;
		return active && this.el.contains(active) ? {action: active.dataset.timelineAction, segment: active.dataset.timelineSegment, group: active.dataset.timelineGroup, control:active.dataset.timelineControl} : {};
	}

	private restoreFocus(focus: {action?: string; segment?: string; group?: string; control?: string}): void {
		if (!focus.action && !focus.segment && !focus.group && !focus.control) return;
		const target = Array.from(this.el.querySelectorAll<HTMLElement>("[data-timeline-action], [data-timeline-segment], [data-timeline-group], [data-timeline-control]"))
			.find(element => focus.action ? element.dataset.timelineAction === focus.action : focus.segment ? element.dataset.timelineSegment === focus.segment : focus.group ? element.dataset.timelineGroup === focus.group : element.dataset.timelineControl === focus.control);
		if (target && !(target as HTMLButtonElement).disabled) target.focus({preventScroll: true});
		else (this.segmentSelect.disabled ? this.dateInput : this.segmentSelect).focus({preventScroll: true});
	}

	private renderGroups(groups: readonly TimelineGroup[], blocks: readonly ActivityTimelineBlock[]): void {
		this.groupControls.replaceChildren();
		if (!groups.length) { this.groupControls.hidden = true; return; }
		this.groupControls.hidden = false;
		const label = this.owner.createElement("span");
		label.className = "cg-activity-timeline-groups-label";
		label.textContent = "按学科展开";
		this.groupControls.appendChild(label);
		const dark=this.isDarkTheme();
		for (const group of groups) {
			const button = this.owner.createElement("button");
			button.type = "button";
			button.textContent = `${group.expanded ? "⌄" : "›"} ${group.name}`;
			const marker = this.owner.createElement("span");
			marker.className = "cg-activity-timeline-group-swatch";
			marker.setAttribute("aria-hidden", "true");
			const palette=activityPalette(blocks.filter(block=>block.groupId===group.id).map(block=>block.path),dark);
			marker.classList.toggle("is-multicolor",palette.length>1);
			marker.style.setProperty("--cg-group-color",activitySwatch(palette));
			button.prepend(marker);
			button.dataset.timelineGroup = group.id;
			button.setAttribute("aria-pressed", String(group.expanded));
			button.onclick = () => this.toggleGroup(group.id);
			this.groupControls.appendChild(button);
		}
	}

	private isDarkTheme(): boolean {
		return this.owner.documentElement.classList.contains("theme-dark") || this.owner.body?.classList.contains("theme-dark") || false;
	}

	private renderSegmentSelect(blocks: readonly ActivityTimelineBlock[]): void {
		const selected = this.state.selectedId;
		this.segmentSelect.replaceChildren();
		const empty = this.owner.createElement("option");
		empty.value = "";
		empty.textContent = blocks.length ? "选择一个片段…" : "暂无可定位片段";
		this.segmentSelect.appendChild(empty);
		for (const block of sortedBlocks(blocks)) {
			const option = this.owner.createElement("option");
			option.value = block.id;
			option.textContent = `${blockTime(block)} · ${blockLabel(block)}`;
			this.segmentSelect.appendChild(option);
		}
		this.segmentSelect.value = selected && blocks.some(block => block.id === selected) ? selected : "";
		this.segmentSelect.disabled = !blocks.length;
	}

	private detailActions() {
		const actions = {onSelect: (id: string) => this.selectBlock(id), onClear: () => this.clearSelection(), onPrevious: () => this.selectAdjacent(-1), onNext: () => this.selectAdjacent(1), onOpen: (path: string, event: MouseEvent | KeyboardEvent) => this.options.onOpenDocument(path, event), fileExists: (path: string) => this.options.fileExists(path)};
		return this.options.onHourly ? {...actions, onHourly: () => this.options.onHourly!(this.state.date, this.options.folders || [])} : actions;
	}

	private readDay(): ActivityTimelineDay {
		try { return this.options.service.getActivityTimelineDay({date: this.state.date, folders: this.options.folders, groupingRoot: this.options.groupingRoot, depth: this.state.depth}); }
		catch (error) { return emptyDay(this.state.date, error instanceof Error ? error.message : "无法读取时间轴数据"); }
	}

	private accepts(event: EditActivityChangeEvent): boolean {
		if (["IMPORT", "COVERAGE", "TEMPORAL", "SETTINGS"].includes(event.type)) return true;
		if (event.type === "TIME_STATUS") return this.state.date === todayDate();
		if (event.type !== "TIME_STATS") return false;
		return !event.timeKeys?.length || event.timeKeys.some(key => key.date === this.state.date);
	}

	private followToday(): void {
		if (!this.state.followToday) return;
		const date = clampDate(todayDate(), this.options.fromDate, this.options.toDate);
		if (date === this.state.date) return;
		this.state.date = date;
		this.state.selectedId = undefined;
		this.state.highlightedPath = undefined;
		this.needsFit = true;
	}

	private refreshDateRange():void {
		const range=this.options.getDateRange?.();
		if(!range)return;
		this.options={...this.options,...range};
		this.dateInput.min=range.fromDate;
		this.dateInput.max=range.toDate;
		const date=clampDate(this.state.date,range.fromDate,range.toDate);
		if(date===this.state.date)return;
		this.state.date=date;
		this.state.selectedId=undefined;
		this.state.highlightedPath=undefined;
		this.needsFit=true;
	}

	private changeDate(date: string): void {
		const next = clampDate(date, this.options.fromDate, this.options.toDate);
		if (!next || next === this.state.date) return;
		if (!this.canOpenDate(next)) { this.dateInput.value=this.state.date; return; }
		this.state.date = next;
		this.selectionRemoved = false;
		this.state.followToday = next === clampDate(todayDate(), this.options.fromDate, this.options.toDate);
		this.state.selectedId = undefined;
		this.state.highlightedPath = undefined;
		this.needsFit = true;
		this.refresh();
	}

	private shiftDate(days: number): void { this.changeDate(shiftDate(this.state.date, days)); }

	private canOpenDate(date: string): boolean { return date <= (this.day?.today || todayDate()) || Boolean(this.day?.recordedDates.includes(date)); }

	private changeDepth(): void {
		this.state.depth = this.depthSelect.value === "2" ? 2 : 1;
		this.refresh();
	}

	private toggleGroup(id: string): void {
		this.state.expanded = this.state.expanded.includes(id) ? this.state.expanded.filter(value => value !== id) : [...this.state.expanded, id];
		this.paint();
	}

	private selectAdjacent(direction: -1 | 1): void {
		const blocks = sortedBlocks(this.day?.blocks || []);
		const index = blocks.findIndex(block => block.id === this.state.selectedId);
		const next = blocks[index + direction];
		if (next) this.selectBlock(next.id);
	}

	private selectBlock(id: string): void {
		if (!id) { this.clearSelection(); return; }
		const block = this.day?.blocks.find(candidate => candidate.id === id);
		if (!block) return;
		if (!this.state.expanded.includes(block.groupId)) this.state.expanded = [...this.state.expanded, block.groupId];
		this.state.selectedId = id;
		this.selectionRemoved = false;
		this.state.highlightedPath = block.path;
		this.state.window = revealWindow(this.state.window, block);
		this.paint();
	}

	private clearSelection(): void { this.state.selectedId = undefined; this.state.highlightedPath = undefined; this.selectionRemoved = false; this.paint(); }

	private fit(): void { if (this.day?.blocks.length) this.setWindow(fitWindow(this.day.blocks)); }

	private zoom(factor: number): void {
		const [start, end] = this.state.window;
		const center = (start + end) / 2;
		const width = Math.max(15, Math.min(1440, (end - start) * factor));
		this.setWindow([center - width / 2, center + width / 2]);
	}

	private setWindow(window: readonly [number, number]): void {
		this.state.window = normalizeWindow(window);
		this.paint();
	}

	private updateWindow(window: [number, number]): void { this.state.window = normalizeWindow(window); }

	private addButton(parent: HTMLElement, text: string, label: string, id: string, action: () => void): HTMLButtonElement {
		const button = this.owner.createElement("button");
		button.type = "button";
		button.textContent = text;
		button.setAttribute("aria-label", label);
		button.dataset.timelineControl = id;
		button.onclick = action;
		parent.appendChild(button);
		return button;
	}

	private createSelect(parent: HTMLElement, label: string, id: string, action: () => void): HTMLSelectElement {
		const select = this.owner.createElement("select");
		select.setAttribute("aria-label", label);
		select.dataset.timelineControl = id;
		select.onchange = action;
		parent.appendChild(select);
		return select;
	}

	private createOption(label: string, value: string): HTMLOptionElement {
		const option = this.owner.createElement("option");
		option.textContent = label;
		option.value = value;
		return option;
	}
}

function initialState(options: ActivityTimelineViewOptions): ActivityTimelineViewState {
	const date = clampDate(options.initialState?.date || options.date || todayDate(), options.fromDate, options.toDate);
	return {date, followToday: options.initialState?.followToday ?? date === clampDate(todayDate(), options.fromDate, options.toDate), window: options.initialState?.window ? normalizeWindow(options.initialState.window) : [0, 1440], depth: options.initialState?.depth || options.depth || 1, expanded: [...(options.initialState?.expanded || [])], selectedId: options.initialState?.selectedId, highlightedPath: options.initialState?.highlightedPath};
}

function buildRows(blocks: readonly ActivityTimelineBlock[], state: ActivityTimelineViewState): TimelineRows {
	const groups = [...new Map(blocks.map(block => [block.groupId, {id: block.groupId, name: block.groupName, expanded: state.expanded.includes(block.groupId)}])).values()].sort((left, right) => left.name.localeCompare(right.name));
	const rows: ActivityTimelineChartRow[] = [];
	for (const group of groups) {
		const groupBlocks = blocks.filter(block => block.groupId === group.id);
		if (group.expanded) {
			const byPath = new Map<string, ActivityTimelineBlock[]>();
			for (const block of groupBlocks) byPath.set(block.path, [...(byPath.get(block.path) || []), block]);
			for (const [path, items] of [...byPath].sort(([left], [right]) => left.localeCompare(right))) appendPacked(rows, items, {baseId:`${group.id}:${path}`,label:blockLabel(items[0]),groupId:group.id,depth:2});
		} else appendPacked(rows, groupBlocks, {baseId:group.id,label:group.name,groupId:group.id,depth:1});
	}
	return {rows, groups};
}

function appendPacked(rows: ActivityTimelineChartRow[], blocks: readonly ActivityTimelineBlock[], options:{baseId:string;label:string;groupId:string;depth:1|2}): void {
	const {baseId,label,groupId,depth}=options;
	const lanes: number[] = [];
	for (const block of [...blocks].sort(compareBlocks)) {
		let lane = lanes.findIndex(end => end <= block.startMinute);
		if (lane < 0) { lane = lanes.length; lanes.push(block.endMinute); } else lanes[lane] = block.endMinute;
		let row = rows.find(candidate => candidate.id === `${baseId}:${lane}`);
		if (!row) { row = {id: `${baseId}:${lane}`, label: lane ? `${label} · 并行${lane+1}` : label, groupId, depth, blockIds: []}; rows.push(row); }
		row.blockIds = [...row.blockIds, block.id];
	}
}

function compareBlocks(left: ActivityTimelineBlock, right: ActivityTimelineBlock): number { return left.startMinute - right.startMinute || left.endMinute - right.endMinute || left.start - right.start || left.end - right.end || left.id.localeCompare(right.id); }

function fitWindow(blocks: readonly ActivityTimelineBlock[]): [number, number] {
	if (!blocks.length) return [0, 1440];
	const start = Math.min(...blocks.map(block => block.startMinute));
	const end = Math.max(...blocks.map(block => block.endMinute));
	const width = Math.max(120, end - start + 30);
	const center = (start + end) / 2;
	return normalizeWindow([center - width / 2, center + width / 2]);
}

function revealWindow(window: readonly [number, number], block: ActivityTimelineBlock): [number, number] {
	const width = window[1] - window[0];
	if (block.startMinute >= window[0] && block.endMinute <= window[1]) return [window[0], window[1]];
	const center = (block.startMinute + block.endMinute) / 2;
	return normalizeWindow([center - width / 2, center + width / 2]);
}

function normalizeWindow(window: readonly [number, number]): [number, number] {
	let start = Number.isFinite(window[0]) ? window[0] : 0;
	let end = Number.isFinite(window[1]) ? window[1] : 1440;
	if (end < start) [start, end] = [end, start];
	const width = Math.max(15, Math.min(1440, end - start));
	start = Math.max(0, Math.min(1440 - width, start));
	return [start, start + width];
}

function shiftDate(date: string, days: number): string {
	const [year, month, day] = date.split("-").map(Number);
	const value = new Date(year, month - 1, day);
	value.setDate(value.getDate() + days);
	return dateFrom(value);
}

function todayDate(): string { return dateFrom(new Date()); }

function dateFrom(value: Date): string { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; }

function clampDate(date: string, from: string, to: string): string { return date < from ? from : date > to ? to : date || from; }

function canShift(date: string, days: number, from: string, to: string): boolean { const next = shiftDate(date, days); return next >= from && next <= to; }

function weekday(date: string): string { const [year, month, day] = date.split("-").map(Number); return ["日", "一", "二", "三", "四", "五", "六"][new Date(year, month - 1, day).getDay()]; }

function statusText(day: ActivityTimelineDay): string {
	const located = day.locatedSeconds > 0 ? `已定位 ${durationLabel(day.locatedSeconds)}` : "暂无可定位片段";
	const state = {EMPTY: "暂无记录", SUMMARY_ONLY: "只有小时汇总", MIXED: "片段与汇总", DETAILED: "片段明细", INCONSISTENT: "明细需核对"}[day.precision];
	return `${day.date} · ${state} · ${located}`;
}

function durationLabel(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return "0秒";
	if (seconds < 1) return "少于1秒";
	const value = Math.floor(seconds), hours = Math.floor(value / 3600), minutes = Math.floor(value % 3600 / 60), rest = value % 60;
	return [hours ? `${hours}小时` : "", minutes ? `${minutes}分` : "", rest ? `${rest}秒` : ""].filter(Boolean).join("") || "少于1分";
}

function blockLabel(block: ActivityTimelineBlock): string { return block.activity ? "YOLO 对话活动" : (block.path.split("/").pop() || block.path).replace(/\.md$/i, ""); }

function blockTime(block: ActivityTimelineBlock): string { return `${minuteLabel(block.startMinute)}–${minuteLabel(block.endMinute)}`; }

function minuteLabel(minutes: number): string { if (!Number.isFinite(minutes)) return "时间未知"; const total = Math.max(0, Math.round(minutes * 60)); if (total >= 86400) return "24:00:00"; return `${String(Math.floor(total / 3600)).padStart(2, "0")}:${String(Math.floor(total % 3600 / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; }

function sortedBlocks(blocks: readonly ActivityTimelineBlock[]): ActivityTimelineBlock[] { return [...blocks].sort(compareBlocks); }

function sameFolders(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean { const a = left || [], b = right || []; return a.length === b.length && a.every((value, index) => value === b[index]); }

function emptyDay(date: string, warning: string): ActivityTimelineDay { return {date, today: todayDate(), totalSeconds: 0, locatedSeconds: 0, unlocatedSeconds: 0, precision: "INCONSISTENT", blocks: [], warnings: [warning], recordedDates: []}; }
