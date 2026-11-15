import { ContributionCellData, ContributionGraphConfig } from "src/types";
import { toFormattedDate } from "../util/dateUtils";
import { formatDuration } from "../time/timeData";
import { BaseGraphRender } from "./graphRender";
import { getHourlyCellKey, getHourlySeconds, getHourlyState, getHourlyWeek,
	groupHourlyData, HourlyCellData, HourlyDataColumn, selectHourlyDate } from "./hourlyData";
import { resolveHourNavigation } from "./hourlyNavigation";
import { getHourlyCaption, getHourlyViewCells, HourlyViewState } from "./hourlyView";
import { mountDatePicker, updateDatePicker } from "../view/datePicker/DatePicker";
import { getGraphMetric } from "./graphPresentation";

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
	private readonly contexts = new WeakMap<HTMLElement, HourlyContext>();

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
		this.contexts.set(chart, context);
		this.renderChartContent(context);
		this.restoreSelectedActivity(config, state.view === "day" ? cells : [], context.activity);
	}

	/** 原位更新时长柱；只有视图或日期变化才重建图表内部控件。 */
	update(
		root: HTMLElement,
		config: ContributionGraphConfig,
		previous: Array<{key: string; signature: string; data: ContributionCellData}>
	): boolean {
		const chart = root.querySelector<HTMLElement>(".charts.hourly-profile");
		const main = root.querySelector<HTMLElement>(".contribution-graph .main");
		const activity = root.querySelector<HTMLElement>(".activity-container");
		if (!chart || !main || !activity) return false;
		const days = groupHourlyData(config.hourlyData || []);
		const date = selectHourlyDate(days, config.hourlyViewState?.date, toFormattedDate(new Date())) || "";
		const state: HourlyViewState = {view: config.hourlyViewState?.view === "week" ? "week" : "day", date};
		const previousKeys = new Set(previous.map(cell => cell.key));
		const nextKeys = new Set((config.hourlyData || []).map(cell => getHourlyCellKey(cell as HourlyCellData)));
		if (previousKeys.size !== nextKeys.size || previous.length !== nextKeys.size || [...previousKeys].some(key => !nextKeys.has(key))) return false;
		const viewChanged = chart.dataset.view !== state.view || chart.dataset.selectedDate !== state.date;
		const context = this.updateContext(chart, {root, main, chart, activity, config, days, state});
		if (viewChanged) {
			config.hourlyViewState = state;
			config.selectedActivityDate = undefined;
			activity.empty();
			const selected = root.ownerDocument.activeElement as HTMLElement | null;
			chart.dataset.view = state.view;
			chart.dataset.selectedDate = state.date;
			this.renderChartContent(context);
			this.patchHeader(main, config, state, days, activity);
			if (selected?.dataset.timeFocus) {
				root.querySelector<HTMLElement>(`[data-time-focus="${selected.dataset.timeFocus}"]:not(:disabled)`)?.focus({preventScroll: true});
			}
			return true;
		}
		return this.updateData(context, previous);
	}

	private updateData(context: HourlyContext, previous: Array<{key: string; signature: string; data: ContributionCellData}>): boolean {
		const {root, main, chart, activity, config, days, state} = context;
		const cells = getHourlyViewCells(days, state);
		const previousByKey = new Map(previous.map(cell => [cell.key, cell]));
		const ceiling = this.getViewCeiling(days, state);
		const previousCeiling = Number.parseFloat(chart.dataset.ceiling || "");
		const forceAll = Number.isFinite(previousCeiling) && previousCeiling !== ceiling;
		let cellsChanged = false;
		let keyboardStateChanged = false;
		for (const cell of cells) {
			const key = getHourlyCellKey(cell);
			const signature = JSON.stringify({data: cell, isToday: cell.date === toFormattedDate(new Date())});
			const previousCell = previousByKey.get(key);
			if (!forceAll && previousCell?.signature === signature) continue;
			cellsChanged = true;
			const previousDisabled = Boolean(previousCell?.data.future || (previousCell?.data as DisplayHour | undefined)?.missing);
			const nextDisabled = Boolean(cell.future || (cell as DisplayHour).missing);
			if (previousDisabled !== nextDisabled) keyboardStateChanged = true;
			this.patchHourlyCell(chart, cell, ceiling, config, activity);
		}
		const ceilingText = String(ceiling);
		const ceilingChanged = chart.dataset.ceiling !== ceilingText;
		if (ceilingChanged) {
			chart.dataset.ceiling = ceilingText;
			this.patchHourAxes(chart, ceiling);
		}
		if (keyboardStateChanged && state.view === "day") {
			const bars = chart.querySelector<HTMLElement>(".cg-hour-bars");
			if (bars) this.setupDayKeyboard(bars);
		}
		if (cellsChanged || ceilingChanged) {
			this.patchCoverageKey(context);
			if (state.view === "day") {
				const day = days.find(item => item.date === state.date);
				const plot = chart.querySelector<HTMLElement>(".cg-time-plot");
				if (day && plot) this.patchDayEmptyState(plot, day);
			}
			this.patchHeader(main, config, state, days, activity);
		}
		return true;
	}

	private renderChartContent(context: HourlyContext): void {
		const ceilingText = String(this.getViewCeiling(context.days, context.state));
		if (context.chart.dataset.ceiling !== ceilingText) context.chart.dataset.ceiling = ceilingText;
		const toolbar = context.chart.querySelector<HTMLElement>(".cg-time-toolbar") || this.renderToolbar(context);
		this.patchToolbar(toolbar, context);
		let plot = context.chart.querySelector<HTMLElement>(".cg-time-plot");
		if (!plot) plot = createDiv({cls: "cg-time-plot", parent: context.chart});
		plot.empty();
		const plotContext = {...context, chart: plot};
		if (!context.days.length) {
			createDiv({cls: "cg-time-empty", parent: plot, text: "当前日期范围暂无时长数据"});
			return;
		}
		if (context.state.view === "day") this.renderDay(plotContext);
		else this.renderWeek(plotContext);
		this.renderCoverageKey(plotContext);
	}

	private updateContext(chart: HTMLElement, next: HourlyContext): HourlyContext {
		const current = this.contexts.get(chart);
		if (!current) {
			this.contexts.set(chart, next);
			return next;
		}
		Object.assign(current, next);
		return current;
	}

	private patchHeader(main: HTMLElement, config: ContributionGraphConfig, state: HourlyViewState, days: HourlyDataColumn[], activity: HTMLElement): void {
		const cells = getHourlyViewCells(days, state);
		this.patchContributionSummary(main, config, cells, activity, this.getHourlyMetric(config, state, cells));
	}

	private getHourlyMetric(config: ContributionGraphConfig, state: HourlyViewState, cells: ContributionCellData[]) {
		const metric = getGraphMetric(config, cells);
		metric.caption = getHourlyCaption(state);
		if (cells.length && !cells.some(cell => !cell.future && cell.trackingState !== "UNTRACKED" && cell.tracked !== false)) {
			metric.text = cells.every(cell => cell.future) ? "尚未到来" : "未采集";
			metric.parts = [{value: metric.text, unit: ""}];
		}
		return metric;
	}

	private getViewCeiling(days: HourlyDataColumn[], state: HourlyViewState): number {
		return getMinuteCeiling(getHourlyViewCells(days, state) as HourlyCellData[]);
	}

	private patchDayEmptyState(parent: HTMLElement, day: HourlyDataColumn): void {
		const empty = day.cells.every(cell => getHourlyState(cell) === "untracked" || cell.future);
		let node = parent.querySelector<HTMLElement>(".cg-time-empty");
		if (!empty) { node?.remove(); return; }
		const text = day.cells.every(cell => cell.future) ? "该日期尚未到来" : "该日尚未采集时长，缺失数据不代表零分钟";
		if (!node) node = createDiv({cls: "cg-time-empty", parent});
		if (node.textContent !== text) node.textContent = text;
	}

	private patchCoverageKey(context: HourlyContext): void {
		const cells = getHourlyViewCells(context.days, context.state) as HourlyCellData[];
		const states = new Set(cells.map(getHourlyState));
		const parent = context.chart.querySelector<HTMLElement>(".cg-time-plot") || context.chart;
		let key = parent.querySelector<HTMLElement>(".cg-time-key");
		if (!key) { key = createDiv({cls: "cg-time-key", parent}); createSpan({parent: key, text: "柱高表示分钟数"}); }
		for (const [state, label] of [["untracked", "未采集"], ["partial", "部分采集"], ["future", "未来时段"]] as const) {
			const node = key.querySelector(`.is-${state}`);
			if (!states.has(state)) node?.remove();
			else if (!node) createSpan({cls: `is-${state}`, parent: key, text: label});
		}
	}

	private patchHourlyCell(
		chart: HTMLElement,
		cell: HourlyCellData,
		ceiling: number,
		config: ContributionGraphConfig,
		activity: HTMLElement
	): void {
		const key = getHourlyCellKey(cell);
		const dayButton = chart.querySelector<HTMLButtonElement>(`.cg-hour-bar[data-time-key="${key}"]`);
		if (dayButton) this.patchHourButton(dayButton, cell, ceiling, config, activity);
		const weekMark = chart.querySelector<HTMLElement>(`.cg-week-hour[data-time-key="${key}"]`);
		if (weekMark) this.patchWeekMark(weekMark, cell, ceiling);
		const weekButton = chart.querySelector<HTMLButtonElement>(`.cg-week-day[data-date="${cell.date}"]`);
		if (weekButton) this.patchWeekTotal(weekButton, cell.date, chart);
	}

	private patchHourButton(
		button: HTMLButtonElement,
		cell: HourlyCellData,
		ceiling: number,
		config: ContributionGraphConfig,
		activity: HTMLElement
	): void {
		const selected = config.selectedActivityDate === getHourlyCellKey(cell) || button.classList.contains("is-selected");
		const cls = `cell cg-hour-bar is-${getHourlyState(cell)}${getHourlySeconds(cell) ? "" : " is-zero"}${selected && !cell.future ? " is-selected" : ""}`;
		if (button.className !== cls) button.className = cls;
		const disabled = Boolean(cell.future || (cell as DisplayHour).missing);
		if (button.disabled !== disabled) button.disabled = disabled;
		const height = `${getHourlySeconds(cell) / 60 / ceiling * 100}%`;
		if (button.style.getPropertyValue("--hour-height") !== height) button.style.setProperty("--hour-height", height);
		const label = getHourLabel(cell);
		if (button.ariaLabel !== label) button.ariaLabel = label;
		if (button.title !== label) button.title = label;
		this.bindCellClickEvent(button, cell, config, activity);
	}

	private patchWeekMark(mark: HTMLElement, cell: HourlyCellData, ceiling: number): void {
		const cls = `cg-week-hour is-${getHourlyState(cell)}${getHourlySeconds(cell) ? "" : " is-zero"}`;
		if (mark.className !== cls) mark.className = cls;
		const seconds = String(getHourlySeconds(cell));
		if (mark.dataset.seconds !== seconds) mark.dataset.seconds = seconds;
		const height = `${getHourlySeconds(cell) / 60 / ceiling * 100}%`;
		if (mark.style.getPropertyValue("--hour-height") !== height) mark.style.setProperty("--hour-height", height);
	}

	private patchWeekTotal(button: HTMLButtonElement, date: string, chart: HTMLElement): void {
		const marks = Array.from(chart.querySelectorAll<HTMLElement>(`.cg-week-hour[data-time-key^="${date}T"]`));
		const seconds = marks.reduce((sum, mark) => sum + Number(mark.dataset.seconds || 0), 0);
		const future = marks.length > 0 && marks.every(mark => mark.classList.contains("is-future"));
		const collected = marks.some(mark => !mark.classList.contains("is-future") && !mark.classList.contains("is-untracked"));
		if (button.disabled !== future) button.disabled = future;
		const total = button.querySelector<HTMLElement>(".cg-week-total");
		const text = future ? "未来" : collected ? formatDuration(seconds) : "未采集";
		if (total && total.textContent !== text) total.textContent = text;
		const label = `${date}，${future ? "未来日期" : collected ? formatDuration(seconds) : "尚未采集"}${future ? "" : "，查看单日时段"}`;
		if (button.ariaLabel !== label) button.ariaLabel = label;
	}

	private patchHourAxes(chart: HTMLElement, ceiling: number): void {
		const labels = Array.from(chart.querySelectorAll<HTMLElement>(".cg-hour-axis .cg-hour-gridline span"));
		if (labels.length >= 3) {
			const next = [`${ceiling} 分`, `${ceiling / 2}`, "0"];
			labels.forEach((label, index) => {
				if (label.textContent !== next[index]) label.textContent = next[index];
			});
		}
	}

	private renderUnknownTotal(main: HTMLElement, cells: ContributionCellData[]): void {
		if (!cells.length || cells.some(cell => !cell.future && cell.trackingState !== "UNTRACKED" && cell.tracked !== false)) return;
		const value = main.querySelector<HTMLElement>(".cg-metric-value");
		if (!value) return;
		const text = cells.every(cell => cell.future) ? "尚未到来" : "未采集";
		if (value.textContent === text && value.children.length === 1) return;
		value.replaceChildren();
		value.ariaLabel = text;
		createSpan({cls: "cg-metric-number", parent: value, text});
		value.dataset.metricSignature = JSON.stringify([{value: text, unit: ""}]);
	}

	private changeView(context: HourlyContext, state: HourlyViewState, focusKey: string): void {
		context.config.hourlyViewState = state;
		context.config.selectedActivityDate = undefined;
		context.config.onActivityClose?.();
		if (context.config.onHourlyViewChange) {
			context.config.onHourlyViewChange(state);
			return;
		}
		const previous = (context.config.hourlyData || []).map(data => ({key: getHourlyCellKey(data as HourlyCellData), signature: "", data}));
		if (!this.update(context.root, context.config, previous)) { context.root.empty(); this.render(context.root, context.config); }
		const target = Array.from(context.root.querySelectorAll<HTMLElement>("[data-time-focus]:not(:disabled)"))
			.find(element => element.dataset.timeFocus === focusKey) || context.root.querySelector<HTMLElement>('[data-time-focus="date"]');
		target?.focus({preventScroll: true});
	}

	private renderToolbar(context: HourlyContext): HTMLElement {
		const toolbar = createDiv({cls: "cg-time-toolbar", parent: context.chart});
		const tabs = createDiv({cls: "cg-time-tabs", parent: toolbar, attr: {role: "group", "aria-label": "学习时段视图"}});
		for (const [view, label] of [["day", "单日"], ["week", "一周"]] as const) {
			const button = createEl("button", {parent: tabs, text: label, attr: {type: "button", "aria-pressed": String(view === context.state.view)}});
			button.dataset.timeView = view;
			button.dataset.timeFocus = `view-${view}`;
			button.onclick = () => this.changeView(context, {...context.state, view}, `view-${view}`);
		}
		this.renderDateNavigation(context, toolbar);
		return toolbar;
	}

	private patchToolbar(toolbar: HTMLElement, context: HourlyContext): void {
		toolbar.querySelectorAll<HTMLButtonElement>("[data-time-view]").forEach(button => {
			const view = button.dataset.timeView;
			button.setAttribute("aria-pressed", String(view === context.state.view));
			button.onclick = () => this.changeView(context, {...context.state, view: view === "week" ? "week" : "day"}, `view-${view}`);
		});
		const index = context.days.findIndex(day => day.date === context.state.date);
		const step = context.state.view === "week" ? 7 : 1;
		const previous = toolbar.querySelector<HTMLButtonElement>('[data-time-focus="previous"]');
		if (previous) {
			previous.disabled = index <= 0;
			previous.setAttribute("aria-label", context.state.view === "week" ? "前一周" : "前一天");
			previous.title = previous.getAttribute("aria-label") || "";
			previous.onclick = () => this.changeView(context, {...context.state, date: context.days[Math.max(0, index - step)]?.date || context.state.date}, "previous");
		}
		const next = toolbar.querySelector<HTMLButtonElement>('[data-time-focus="next"]');
		if (next) {
			next.disabled = index < 0 || index >= context.days.length - 1;
			next.setAttribute("aria-label", context.state.view === "week" ? "后一周" : "后一天");
			next.title = next.getAttribute("aria-label") || "";
			next.onclick = () => this.changeView(context, {...context.state, date: context.days[Math.min(context.days.length - 1, index + step)]?.date || context.state.date}, "next");
		}
		const trigger = toolbar.querySelector<HTMLButtonElement>(".cg-date-trigger");
		if (trigger) trigger.disabled = !context.days.length;
		updateDatePicker(toolbar, {
			value: context.state.date,
			dates: context.days.map(day => day.date),
			onSelect: date => this.changeView(context, {...context.state, date}, "date"),
		});
	}

	private renderDateNavigation(context: HourlyContext, toolbar: HTMLElement): void {
		const nav = createDiv({cls: "cg-time-date-nav", parent: toolbar});
		const step = context.state.view === "week" ? 7 : 1;
		const index = context.days.findIndex(day => day.date === context.state.date);
		const previous = this.createDateButton(nav, "‹", context.state.view === "week" ? "前一周" : "前一天");
		previous.disabled = index <= 0;
		previous.dataset.timeFocus = "previous";
		previous.onclick = () => this.changeView(context, {...context.state, date: context.days[Math.max(0, index - step)].date}, "previous");
		mountDatePicker(nav, {value: context.state.date, dates: context.days.map(day => day.date),
			onSelect: date => this.changeView(context, {...context.state, date}, "date")});
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
		context.chart.dataset.ceiling = String(ceiling);
		this.renderMinuteAxis(plot, ceiling);
		const bars = createDiv({cls: "cg-hour-bars", parent: plot});
		for (let hour = 0; hour < 24; hour++) this.renderHour(context, bars, getDayHour(day, hour), ceiling);
		this.renderHourTicks(plot, "cg-hour-ticks");
		this.setupDayKeyboard(bars);
		this.patchDayEmptyState(context.chart, day);
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
	}

	private setupDayKeyboard(bars: HTMLElement): void {
		const all = Array.from(bars.querySelectorAll<HTMLButtonElement>("button"));
		const enabled = all.filter(button => !button.disabled);
		const focused = bars.ownerDocument.activeElement;
		const initial = enabled.find(button => button === focused) || enabled.find(button => button.classList.contains("is-selected")) || enabled.find(button => !button.classList.contains("is-zero")) || enabled[enabled.length - 1];
		all.forEach(button => { const tab = button === initial ? 0 : -1; if (button.tabIndex !== tab) button.tabIndex = tab; });
		bars.onkeydown = event => {
			const current = (event.target as HTMLElement).closest<HTMLButtonElement>("button.cg-hour-bar");
			if (!current) return;
			const buttons = Array.from(bars.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
			const hour = resolveHourNavigation(Number(current.dataset.hour), event.key, buttons.map(button => Number(button.dataset.hour)));
			const next = buttons.find(button => Number(button.dataset.hour) === hour);
			if (!next) return;
			event.preventDefault();
			all.forEach(button => button.tabIndex = button === next ? 0 : -1);
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
		context.chart.dataset.ceiling = String(ceiling);
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
			mark.dataset.timeKey = getHourlyCellKey(cell);
			mark.dataset.seconds = String(getHourlySeconds(cell));
			mark.style.setProperty("--hour-height", `${getHourlySeconds(cell) / 60 / ceiling * 100}%`);
			createSpan({cls: "cg-week-fill", parent: mark});
		}
		createSpan({cls: "cg-week-total", parent: button, text: collected ? formatDuration(total) : button.disabled ? "未来" : "未采集"});
		button.onclick = () => this.changeView(context, {view: "day", date: day.date}, "view-day");
	}

	private renderCoverageKey(context: HourlyContext): void { this.patchCoverageKey(context); }

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
