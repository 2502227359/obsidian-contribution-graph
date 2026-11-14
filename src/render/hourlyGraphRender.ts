import { ContributionCellData, ContributionGraphConfig } from "src/types";
import { toFormattedDate } from "../util/dateUtils";
import { formatDuration } from "../time/timeData";
import { BaseGraphRender } from "./graphRender";
import { getHourlyCellKey, getHourlySeconds, getHourlyState, getHourlyWeek,
	groupHourlyData, HourlyCellData, HourlyDataColumn, selectHourlyDate } from "./hourlyData";
import { resolveHourNavigation } from "./hourlyNavigation";
import { getHourlyCaption, getHourlyViewCells, HourlyViewState } from "./hourlyView";

interface HourlyContext {
	root: HTMLElement;
	main: HTMLElement;
	chart: HTMLElement;
	activity: HTMLElement;
	config: ContributionGraphConfig;
	days: HourlyDataColumn[];
	state: HourlyViewState;
}

type DisplayHour = HourlyCellData & { missing?: boolean };

export class HourlyGraphRender extends BaseGraphRender {
	graphType(): string { return "hourly"; }

	render(root: HTMLElement, config: ContributionGraphConfig): void {
		const days = groupHourlyData(config.hourlyData || []);
		const date = selectHourlyDate(days, config.hourlyViewState?.date, toFormattedDate(new Date())) || "";
		const state: HourlyViewState = {view: config.hourlyViewState?.view === "week" ? "week" : "day", date};
		config.hourlyViewState = state;
		const main = this.createMainEl(this.createGraphEl(root), config);
		const cells = getHourlyViewCells(days, state);
		this.renderHeader({...config, showCellRuleIndicators: false}, main, cells);
		main.querySelector(".graph-legend")?.remove();
		const caption = main.querySelector(".cg-metric-caption");
		if (caption) caption.textContent = getHourlyCaption(state);
		this.renderUnknownTotal(main, cells);
		const chart = createDiv({cls: "charts hourly-profile", parent: main});
		chart.dataset.view = state.view;
		chart.dataset.selectedDate = date;
		chart.classList.toggle("has-no-data", !days.length);
		chart.style.setProperty("--cg-chart-color", config.cellStyleRules?.slice(-1)[0]?.color || "var(--cg-blue)");
		const context: HourlyContext = {root, main, chart, activity: this.renderActivityContainer(config, main), config, days, state};
		this.renderToolbar(context);
		if (!days.length) { createDiv({cls: "cg-time-empty", parent: chart, text: "当前日期范围暂无时长数据"}); return; }
		if (state.view === "day") this.renderDay(context);
		else this.renderWeek(context);
		this.renderCoverageKey(context);
		this.restoreSelectedActivity(config, state.view === "day" ? cells : [], context.activity);
	}

	private renderUnknownTotal(main: HTMLElement, cells: ContributionCellData[]): void {
		if (!cells.length || cells.some(cell => !cell.future && cell.trackingState !== "UNTRACKED" && cell.tracked !== false)) return;
		const value = main.querySelector<HTMLElement>(".cg-metric-value");
		if (!value) return;
		const text = cells.every(cell => cell.future) ? "尚未到来" : "未采集";
		value.empty();
		value.ariaLabel = text;
		createSpan({cls: "cg-metric-number", parent: value, text});
	}

	private changeView(context: HourlyContext, state: HourlyViewState, focusKey: string): void {
		context.config.hourlyViewState = state;
		context.config.selectedActivityDate = undefined;
		context.config.onActivityClose?.();
		context.root.empty();
		this.render(context.root, context.config);
		const target = Array.from(context.root.querySelectorAll<HTMLElement>("[data-time-focus]:not(:disabled)"))
			.find(element => element.dataset.timeFocus === focusKey) || context.root.querySelector<HTMLElement>('[data-time-focus="date"]');
		target?.focus({preventScroll: true});
	}

	private renderToolbar(context: HourlyContext): void {
		const toolbar = createDiv({cls: "cg-time-toolbar", parent: context.chart});
		const tabs = createDiv({cls: "cg-time-tabs", parent: toolbar, attr: {role: "group", "aria-label": "学习时段视图"}});
		for (const [view, label] of [["day", "单日"], ["week", "一周"]] as const) {
			const button = createEl("button", {parent: tabs, text: label, attr: {type: "button", "aria-pressed": String(view === context.state.view)}});
			button.dataset.timeView = view;
			button.dataset.timeFocus = `view-${view}`;
			button.onclick = () => this.changeView(context, {...context.state, view}, `view-${view}`);
		}
		this.renderDateNavigation(context, toolbar);
	}

	private renderDateNavigation(context: HourlyContext, toolbar: HTMLElement): void {
		const nav = createDiv({cls: "cg-time-date-nav", parent: toolbar});
		const step = context.state.view === "week" ? 7 : 1;
		const index = context.days.findIndex(day => day.date === context.state.date);
		const previous = this.createDateButton(nav, "‹", context.state.view === "week" ? "前一周" : "前一天");
		previous.disabled = index <= 0;
		previous.dataset.timeFocus = "previous";
		previous.onclick = () => this.changeView(context, {...context.state, date: context.days[Math.max(0, index - step)].date}, "previous");
		const input = createEl("input", {parent: nav, attr: {type: "date", "aria-label": "选择日期"}});
		input.dataset.timeFocus = "date";
		input.value = context.state.date;
		input.min = context.days[0]?.date || "";
		input.max = context.days[context.days.length - 1]?.date || "";
		input.disabled = !context.days.length;
		input.onchange = () => {
			if (context.days.some(day => day.date === input.value)) this.changeView(context, {...context.state, date: input.value}, "date");
			else input.value = context.state.date;
		};
		const next = this.createDateButton(nav, "›", context.state.view === "week" ? "后一周" : "后一天");
		next.dataset.timeFocus = "next";
		next.disabled = index < 0 || index >= context.days.length - 1;
		next.onclick = () => this.changeView(context, {...context.state, date: context.days[Math.min(context.days.length - 1, index + step)].date}, "next");
	}

	private createDateButton(parent: HTMLElement, text: string, label: string): HTMLButtonElement {
		return createEl("button", {parent, text, attr: {type: "button", "aria-label": label, title: label}});
	}

	private renderDay(context: HourlyContext): void {
		const day = context.days.find(item => item.date === context.state.date)!;
		createDiv({cls: "cg-time-period-label", parent: context.chart, text: `${day.date} · 每小时活跃分钟数`});
		const plot = createDiv({cls: "cg-hour-chart", parent: context.chart, attr: {role: "group", "aria-label": `${day.date} 每小时学习时长`}});
		const ceiling = getMinuteCeiling(day.cells);
		this.renderMinuteAxis(plot, ceiling);
		const bars = createDiv({cls: "cg-hour-bars", parent: plot});
		for (let hour = 0; hour < 24; hour++) this.renderHour(context, bars, getDayHour(day, hour), ceiling);
		this.renderHourTicks(plot, "cg-hour-ticks");
		this.setupDayKeyboard(bars);
		if (day.cells.every(cell => getHourlyState(cell) === "untracked" || cell.future)) {
			createDiv({cls: "cg-time-empty", parent: context.chart, text: day.cells.every(cell => cell.future) ? "该日期尚未到来" : "该日尚未采集时长，缺失数据不代表零分钟"});
		}
	}

	private renderMinuteAxis(parent: HTMLElement, ceiling: number): void {
		const axis = createDiv({cls: "cg-hour-axis", parent, attr: {"aria-hidden": "true"}});
		for (const [value, top] of [[ceiling, 0], [ceiling / 2, 50], [0, 100]]) {
			const line = createDiv({cls: "cg-hour-gridline", parent: axis});
			line.style.top = `${top}%`;
			createSpan({parent: line, text: `${value}${top === 0 ? " 分" : ""}`});
		}
	}

	private renderHour(context: HourlyContext, bars: HTMLElement, cell: DisplayHour, ceiling: number): void {
		const button = createEl("button", {cls: `cell cg-hour-bar is-${getHourlyState(cell)}`, parent: bars, attr: {type: "button"}});
		if (!getHourlySeconds(cell)) button.addClass("is-zero");
		button.dataset.date = cell.date;
		button.dataset.hour = String(cell.hour);
		button.dataset.timeKey = getHourlyCellKey(cell);
		button.dataset.timeFocus = `hour-${cell.hour}`;
		button.style.setProperty("--hour-height", `${getHourlySeconds(cell) / 60 / ceiling * 100}%`);
		createSpan({cls: "cg-hour-fill", parent: button});
		button.ariaLabel = getHourLabel(cell);
		button.title = getHourLabel(cell);
		this.bindCellClickEvent(button, cell, context.config, context.activity);
		if (cell.missing) button.disabled = true;
		button.addEventListener("click", () => {context.config.selectedActivityDate = getHourlyCellKey(cell);});
	}

	private setupDayKeyboard(bars: HTMLElement): void {
		const buttons = Array.from(bars.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
		const initial = buttons.find(button => button.classList.contains("is-selected")) || buttons.find(button => !button.classList.contains("is-zero")) || buttons[buttons.length - 1];
		buttons.forEach(button => button.tabIndex = button === initial ? 0 : -1);
		bars.onkeydown = event => {
			const current = (event.target as HTMLElement).closest<HTMLButtonElement>("button.cg-hour-bar");
			if (!current) return;
			const hour = resolveHourNavigation(Number(current.dataset.hour), event.key, buttons.map(button => Number(button.dataset.hour)));
			const next = buttons.find(button => Number(button.dataset.hour) === hour);
			if (!next) return;
			event.preventDefault();
			buttons.forEach(button => button.tabIndex = button === next ? 0 : -1);
			next.focus({preventScroll: true});
		};
	}

	private renderHourTicks(parent: HTMLElement, cls: string): void {
		const ticks = createDiv({cls, parent, attr: {"aria-hidden": "true"}});
		for (const hour of [0, 6, 12, 18, 24]) createSpan({parent: ticks, text: `${String(hour).padStart(2, "0")}:00`});
	}

	private renderWeek(context: HourlyContext): void {
		const days = getHourlyWeek(context.days, context.state.date);
		const range = `${days[0]?.date} — ${context.state.date}`;
		createDiv({cls: "cg-time-period-label", parent: context.chart, text: `${range}${days.length < 7 ? ` · 当前范围 ${days.length} 天` : ""}`});
		const week = createDiv({cls: "cg-week-chart", parent: context.chart});
		this.renderHourTicks(week, "cg-week-axis");
		const rows = createDiv({cls: "cg-week-rows", parent: week, attr: {role: "group", "aria-label": "一周学习节奏，选择一天查看小时明细"}});
		const ceiling = getMinuteCeiling(days.flatMap(day => day.cells));
		for (const day of days) this.renderWeekDay(context, rows, day, ceiling);
	}

	private renderWeekDay(context: HourlyContext, rows: HTMLElement, day: HourlyDataColumn, ceiling: number): void {
		const total = day.cells.reduce((sum, cell) => sum + getHourlySeconds(cell), 0);
		const collected = day.cells.some(cell => !cell.future && getHourlyState(cell) !== "untracked");
		const future = day.cells.every(cell => cell.future);
		const button = createEl("button", {cls: "cg-week-day", parent: rows, attr: {type: "button", "aria-label": `${day.date}，${future ? "未来日期" : collected ? formatDuration(total) : "尚未采集"}${future ? "" : "，查看单日时段"}`}});
		button.dataset.date = day.date;
		button.dataset.timeFocus = `week-${day.date}`;
		button.disabled = future;
		button.classList.toggle("is-selected", day.date === context.state.date);
		const label = createSpan({cls: "cg-week-label", parent: button});
		createSpan({parent: label, text: formatWeekday(day.date)});
		createEl("small", {parent: label, text: day.date.slice(5)});
		const profile = createSpan({cls: "cg-week-profile", parent: button, attr: {"aria-hidden": "true"}});
		for (let hour = 0; hour < 24; hour++) {
			const cell = getDayHour(day, hour);
			const mark = createSpan({cls: `cg-week-hour is-${getHourlyState(cell)}${getHourlySeconds(cell) ? "" : " is-zero"}`, parent: profile});
			mark.style.setProperty("--hour-height", `${getHourlySeconds(cell) / 60 / ceiling * 100}%`);
			createSpan({cls: "cg-week-fill", parent: mark});
		}
		createSpan({cls: "cg-week-total", parent: button, text: collected ? formatDuration(total) : button.disabled ? "未来" : "未采集"});
		button.onclick = () => this.changeView(context, {view: "day", date: day.date}, "view-day");
	}

	private renderCoverageKey(context: HourlyContext): void {
		const visible = context.state.view === "week" ? getHourlyWeek(context.days, context.state.date) : context.days.filter(day => day.date === context.state.date);
		const complete = visible.flatMap(day => Array.from({length: 24}, (_, hour) => getDayHour(day, hour)));
		const key = createDiv({cls: "cg-time-key", parent: context.chart});
		createSpan({parent: key, text: "柱高表示分钟数"});
		for (const [state, label] of [["untracked", "未采集"], ["partial", "部分采集"], ["future", "未来时段"]] as const) {
			if (complete.some(cell => getHourlyState(cell) === state)) createSpan({cls: `is-${state}`, parent: key, text: label});
		}
	}
}

function getDayHour(day: HourlyDataColumn, hour: number): DisplayHour {
	const date = new Date(`${day.date}T12:00:00`);
	return day.cells.find(cell => cell.hour === hour) || {date: day.date, hour, value: 0, tracked: false, trackingState: "UNTRACKED", items: [], missing: true,
		year: date.getFullYear(), month: date.getMonth(), monthDate: date.getDate(), weekDay: date.getDay()};
}

function getMinuteCeiling(cells: HourlyCellData[]): number {
	return Math.max(60, Math.ceil(Math.max(0, ...cells.map(getHourlySeconds)) / 3600) * 60);
}

function formatWeekday(date: string): string {
	const day = new Date(`${date}T12:00:00`).getDay();
	return `周${"日一二三四五六"[day]}`;
}

function getHourLabel(cell: HourlyCellData): string {
	const state = getHourlyState(cell);
	const label = state === "future" ? "未来时段" : state === "untracked" ? "未采集" : `${formatDuration(getHourlySeconds(cell))}${state === "partial" ? "，部分采集" : ""}`;
	return `${cell.date} ${String(cell.hour).padStart(2, "0")}:00—${String(cell.hour + 1).padStart(2, "0")}:00，${label}`;
}
