import { isValidFormattedDate, toFormattedDate } from "../../util/dateUtils";
import { getCalendarDates, resolveCalendarKey, shiftCalendarMonth } from "./calendarDates";
import { setUiIcon } from "../icon/uiIcons";

interface DatePickerOptions {
	value: string;
	dates: readonly string[];
	onSelect: (date: string) => void;
}

interface CalendarSnapshot { month: string; focusedDate: string; }
const pickers = new WeakMap<HTMLButtonElement, DatePicker>();
let pickerSequence = 0;

export function mountDatePicker(parent: HTMLElement, options: DatePickerOptions): HTMLButtonElement {
	const picker = new DatePicker(parent, options);
	pickers.set(picker.trigger, picker);
	return picker.trigger;
}

/** 更新日期入口的数据与回调，保留已挂载的按钮和弹窗。 */
export function updateDatePicker(parent: HTMLElement, options: DatePickerOptions): void {
	const trigger = parent.querySelector<HTMLButtonElement>(".cg-date-trigger");
	if (trigger) pickers.get(trigger)?.update(options);
}

export function captureDatePicker(root: HTMLElement): CalendarSnapshot | undefined {
	const dialog = root.querySelector<HTMLDialogElement>(".cg-date-picker[open]");
	if (!dialog) return undefined;
	const focused = root.ownerDocument.activeElement as HTMLElement | null;
	return {month: dialog.dataset.month || "", focusedDate: focused?.dataset.date || dialog.dataset.focusedDate || ""};
}

export function restoreDatePicker(root: HTMLElement, snapshot?: CalendarSnapshot): void {
	const trigger = root.querySelector<HTMLButtonElement>(".cg-date-trigger");
	if (snapshot && trigger) pickers.get(trigger)?.open(snapshot);
}

class DatePicker {
	readonly trigger: HTMLButtonElement;
	private readonly dialog: HTMLDialogElement;
	private readonly grid: HTMLElement;
	private readonly label: HTMLElement;
	private readonly previous: HTMLButtonElement;
	private readonly next: HTMLButtonElement;
	private readonly dates: string[];
	private month: string;
	private focusedDate: string;

	constructor(parent: HTMLElement, private readonly options: DatePickerOptions) {
		this.dates = [...new Set(options.dates.filter(isValidFormattedDate))].sort();
		this.month = options.value.slice(0, 7);
		this.focusedDate = options.value;
		this.trigger = makeButton(parent, "", "cg-date-trigger", "选择日期");
		makeElement(this.trigger, "span", "cg-date-trigger-value", options.value || "选择日期");
		this.trigger.dataset.timeFocus = "date";
		this.trigger.disabled = !this.dates.length;
		this.trigger.setAttribute("aria-haspopup", "dialog");
		this.trigger.setAttribute("aria-expanded", "false");
		this.dialog = parent.ownerDocument.createElement("dialog");
		this.dialog.className = "cg-date-picker";
		this.dialog.id = `cg-date-picker-${++pickerSequence}`;
		this.dialog.setAttribute("aria-label", "选择学习日期");
		this.trigger.setAttribute("aria-controls", this.dialog.id);
		parent.appendChild(this.dialog);
		const header = makeElement(this.dialog, "div", "cg-date-header");
		this.previous = makeButton(header, "", "cg-date-month-previous", "上个月");
		setUiIcon(this.previous, "chevron-left", 15);
		this.label = makeElement(header, "h3", "cg-date-month-label");
		this.label.setAttribute("aria-live", "polite");
		this.next = makeButton(header, "", "cg-date-month-next", "下个月");
		setUiIcon(this.next, "chevron-right", 15);
		const weekdays = makeElement(this.dialog, "div", "cg-date-weekdays");
		weekdays.setAttribute("aria-hidden", "true");
		for (const day of "一二三四五六日") makeElement(weekdays, "span", "", day);
		this.grid = makeElement(this.dialog, "div", "cg-date-grid");
		this.grid.setAttribute("role", "grid");
		this.grid.setAttribute("aria-label", "日历，方向键移动，回车选择");
		this.createFooter();
		this.bindEvents();
	}

	open(snapshot?: CalendarSnapshot): void {
		if (this.trigger.disabled || !this.trigger.isConnected || this.dialog.open) return;
		const month = snapshot?.month;
		if (month && isValidFormattedDate(`${month}-01`) && month >= this.dates[0].slice(0, 7) && month <= this.dates[this.dates.length - 1].slice(0, 7)) this.month = month;
		this.focusedDate = snapshot?.focusedDate && this.dates.includes(snapshot.focusedDate) ? snapshot.focusedDate : this.options.value;
		if (!this.focusedDate.startsWith(this.month)) this.focusedDate = this.dates.find(date => date.startsWith(this.month)) || this.options.value;
		this.renderMonth();
		const initialDate = this.focusedDate;
		this.dialog.showModal();
		this.focusedDate = initialDate;
		this.dialog.dataset.focusedDate = initialDate;
		this.trigger.setAttribute("aria-expanded", "true");
		this.position();
		this.focusDay();
	}

	update(options: DatePickerOptions): void {
		const dateChanged = this.options.value !== options.value;
		Object.assign(this.options, options);
		const dates = [...new Set(options.dates.filter(isValidFormattedDate))].sort();
		if (dates.join() !== this.dates.join()) this.dates.splice(0, this.dates.length, ...dates);
		this.trigger.disabled = !this.dates.length;
		const value = this.trigger.querySelector(".cg-date-trigger-value");
		if (value && value.textContent !== options.value) value.textContent = options.value;
		if (!dateChanged) return;
		this.month = options.value.slice(0, 7);
		this.focusedDate = options.value;
		if (this.dialog.open) {
			this.renderMonth();
			this.focusDay();
		}
	}

	private createFooter(): void {
		const footer = makeElement(this.dialog, "div", "cg-date-footer");
		const today = toFormattedDate(new Date());
		const todayButton = makeButton(footer, "今天", "cg-date-today", "选择今天");
		todayButton.disabled = !this.dates.includes(today);
		todayButton.onclick = () => this.select(today);
		makeButton(footer, "关闭", "cg-date-close", "关闭日期选择").onclick = () => this.dialog.close();
	}

	private bindEvents(): void {
		this.trigger.onclick = () => this.open();
		this.previous.onclick = () => this.moveMonth(-1);
		this.next.onclick = () => this.moveMonth(1);
		this.grid.onkeydown = event => this.handleKey(event);
		this.dialog.onclose = () => {
			this.trigger.setAttribute("aria-expanded", "false");
			if (this.trigger.isConnected) this.trigger.focus({preventScroll: true});
		};
		this.dialog.onclick = event => {
			if (event.target !== this.dialog) return;
			const rect = this.dialog.getBoundingClientRect();
			if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this.dialog.close();
		};
	}

	private renderMonth(): void {
		this.dialog.dataset.month = this.month;
		this.dialog.dataset.focusedDate = this.focusedDate;
		this.label.textContent = `${Number(this.month.slice(0, 4))}年${Number(this.month.slice(5))}月`;
		this.previous.disabled = this.month <= this.dates[0].slice(0, 7);
		this.next.disabled = this.month >= this.dates[this.dates.length - 1].slice(0, 7);
		this.grid.replaceChildren();
		const dates = getCalendarDates(this.month);
		for (let week = 0; week < 6; week++) {
			const row = makeElement(this.grid, "div", "cg-date-week");
			row.setAttribute("role", "row");
			for (const date of dates.slice(week * 7, week * 7 + 7)) this.renderDay(row, date);
		}
	}

	private renderDay(row: HTMLElement, date: string): void {
		const button = makeButton(row, String(Number(date.slice(8))), "cg-date-day", date);
		button.dataset.date = date;
		button.dataset.timeFocus = `date-day-${date}`;
		button.setAttribute("role", "gridcell");
		button.disabled = !this.dates.includes(date);
		button.classList.toggle("is-outside-month", !date.startsWith(this.month));
		button.classList.toggle("is-selected", date === this.options.value);
		button.classList.toggle("is-today", date === toFormattedDate(new Date()));
		button.setAttribute("aria-selected", String(date === this.options.value));
		if (button.classList.contains("is-today")) button.setAttribute("aria-current", "date");
		button.tabIndex = date === this.focusedDate && !button.disabled ? 0 : -1;
		button.onfocus = () => {
			this.focusedDate = date;
			this.dialog.dataset.focusedDate = date;
			this.grid.querySelectorAll<HTMLButtonElement>("button").forEach(day => day.tabIndex = day === button ? 0 : -1);
		};
		button.onclick = () => this.select(date);
	}

	private handleKey(event: KeyboardEvent): void {
		const date = (event.target as HTMLElement).closest<HTMLButtonElement>(".cg-date-day")?.dataset.date;
		if (!date) return;
		const next = resolveCalendarKey(date, event.key, {dates: this.dates, shiftKey: event.shiftKey});
		if (!next) return;
		event.preventDefault();
		this.focusedDate = next;
		if (next.slice(0, 7) !== this.month) { this.month = next.slice(0, 7); this.renderMonth(); }
		this.focusDay();
	}

	private moveMonth(step: number): void {
		this.month = shiftCalendarMonth(`${this.month}-01`, step).slice(0, 7);
		const day = shiftCalendarMonth(this.focusedDate, step);
		this.focusedDate = this.dates.filter(date => date.startsWith(this.month)).find(date => date >= day) || this.dates.find(date => date.startsWith(this.month)) || this.options.value;
		this.renderMonth();
		if ((step < 0 ? this.previous : this.next).disabled) this.focusDay();
	}

	private focusDay(): void {
		this.grid.querySelector<HTMLButtonElement>(`button[data-date="${this.focusedDate}"]:not(:disabled)`)?.focus({preventScroll: true});
	}

	private select(date: string): void {
		if (!this.dates.includes(date)) return;
		this.dialog.close();
		this.options.onSelect(date);
	}

	private position(): void {
		const anchor = this.trigger.getBoundingClientRect();
		const rect = this.dialog.getBoundingClientRect();
		const height = this.dialog.ownerDocument.defaultView!.innerHeight;
		const top = anchor.bottom + rect.height + 8 <= height ? anchor.bottom + 6 : anchor.top - rect.height - 6;
		this.dialog.style.left = `clamp(12px, ${anchor.right - rect.width}px, calc(100vw - ${rect.width + 12}px))`;
		this.dialog.style.top = `clamp(12px, ${top}px, calc(100vh - ${rect.height + 12}px))`;
	}
}

function makeElement<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
	const element = parent.ownerDocument.createElement(tag);
	element.className = cls;
	if (text !== undefined) element.textContent = text;
	parent.appendChild(element);
	return element;
}

function makeButton(parent: HTMLElement, text: string, cls: string, label: string): HTMLButtonElement {
	const button = makeElement(parent, "button", cls, text);
	button.type = "button";
	button.setAttribute("aria-label", label);
	return button;
}
