import {
	ContributionCellData,
	ContributionGraphConfig,
} from "src/types";
import { formatDuration } from "../time/timeData";
import { BaseGraphRender } from "./graphRender";
import {
	chooseInitialHourlyPosition,
	HourlyNavigationPosition,
	resolveHourlyNavigation,
} from "./hourlyNavigation";

export interface HourlyCellData extends ContributionCellData {
	hour: number;
}

export interface HourlyDataColumn {
	date: string;
	cells: HourlyCellData[];
}

export function getHourlyCellKey(cell: Pick<HourlyCellData, "date" | "hour">): string {
	return `${cell.date}T${cell.hour}`;
}

export function groupHourlyData(
	data: ContributionCellData[] = []
): HourlyDataColumn[] {
	const columns = new Map<string, HourlyCellData[]>();
	for (const cell of data) {
		if (!isHourlyCell(cell)) {
			continue;
		}
		const cells = columns.get(cell.date) || [];
		cells.push(cell);
		columns.set(cell.date, cells);
	}
	return [...columns.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([date, cells]) => ({
			date,
			cells: [...cells].sort((left, right) => left.hour - right.hour),
		}));
}

function isHourlyCell(cell: ContributionCellData): cell is HourlyCellData {
	const hour = cell?.hour;
	return (
		typeof cell?.date === "string" &&
		/^\d{4}-\d{2}-\d{2}$/.test(cell.date) &&
		typeof hour === "number" &&
		Number.isInteger(hour) &&
		hour >= 0 &&
		hour <= 23
	);
}

function getCellSeconds(cell: HourlyCellData): number {
	return cell.timeStats?.seconds ?? Math.max(0, cell.value) * 60;
}

function getCellByPosition(
	columns: HourlyDataColumn[],
	position: HourlyNavigationPosition
): HourlyCellData | undefined {
	return columns[position.day]?.cells.find(
		(cell) => cell.hour === position.hour
	);
}

export class HourlyGraphRender extends BaseGraphRender {
	graphType(): string {
		return "hourly";
	}

	render(root: HTMLElement, graphConfig: ContributionGraphConfig): void {
		const data = graphConfig.hourlyData || [];
		const columns = groupHourlyData(data);
		const graphEl = this.createGraphEl(root);
		const main = this.createMainEl(graphEl, graphConfig);
		this.renderHeader(graphConfig, main, data);

		const charts = createDiv({
			cls: ["charts", "hourly"],
			parent: main,
		});
		const activityContainer = this.renderActivityContainer(graphConfig, main);
		this.renderHourAxis(charts, graphConfig);
		for (const [dayIndex, column] of columns.entries()) {
			this.renderDayColumn(
				charts,
				column,
				dayIndex,
				graphConfig,
				activityContainer
			);
		}
		this.restoreSelectedActivity(graphConfig, data, activityContainer);
		this.setupHourlyKeyboardNavigation(charts, columns);
	}

	private renderHourAxis(
		charts: HTMLElement,
		graphConfig: ContributionGraphConfig
	): void {
		const axis = createDiv({
			cls: ["hourly-axis", "column"],
			parent: charts,
		});
		createDiv({
			cls: ["hourly-axis-title", "hourly-date-label"],
			text: "时间",
			parent: axis,
		});
		for (let hour = 0; hour < 24; hour++) {
			const label = createDiv({
				cls: ["hourly-hour-label", "cell"],
				text: hour % 3 === 0 ? `${String(hour).padStart(2, "0")}:00` : "",
				parent: axis,
			});
			this.applyCellGlobalStylePartial(label, graphConfig, ["height", "minHeight", "maxHeight"]);
		}
	}

	private renderDayColumn(
		charts: HTMLElement,
		column: HourlyDataColumn,
		dayIndex: number,
		graphConfig: ContributionGraphConfig,
		activityContainer: HTMLElement
	): void {
		const dayColumn = createDiv({
			cls: ["hourly-day-column", "column"],
			parent: charts,
		});
		const dateLabel = createDiv({
			cls: ["hourly-date-label", "hourly-day-label"],
			text: dayIndex % 3 === 0 ? column.date.slice(5) : "",
			parent: dayColumn,
		});
		dateLabel.title = column.date;
		dateLabel.ariaLabel = column.date;

		const cellByHour = new Map(column.cells.map((cell) => [cell.hour, cell]));
		for (let hour = 0; hour < 24; hour++) {
			const cellData = cellByHour.get(hour);
			if (!cellData) {
				createDiv({
					cls: ["cell", "hourly-cell", "empty", "hourly-missing"],
					parent: dayColumn,
				});
				continue;
			}
			this.renderCell(
				dayColumn,
				cellData,
				dayIndex,
				graphConfig,
				activityContainer
			);
		}
	}

	private renderCell(
		parent: HTMLElement,
		cellData: HourlyCellData,
		dayIndex: number,
		graphConfig: ContributionGraphConfig,
		activityContainer: HTMLElement
	): void {
		const cell = document.createElement("button");
		cell.type = "button";
		cell.className = "cell hourly-cell";
		parent.appendChild(cell);
		cell.dataset.dayIndex = String(dayIndex);
		cell.dataset.hour = String(cellData.hour);
		cell.dataset.timeKey = getHourlyCellKey(cellData);
		this.applyCellGlobalStyle(cell, graphConfig);
		const cellRules = this.getCellRules(graphConfig);
		this.applyCellStyleRule(
			cell,
			cellData,
			cellRules,
			graphConfig,
			cellData.value > 0 ? () => cellRules[0] : undefined
		);
		this.bindCellAttribute(cell, cellData);
		cell.setAttribute("data-hour", String(cellData.hour));
		cell.setAttribute("data-time-key", getHourlyCellKey(cellData));
		this.bindCellClickEvent(cell, cellData, graphConfig, activityContainer);
		this.bindCellTips(cell, cellData);
		const hourLabel = `${cellData.date} ${String(cellData.hour).padStart(2, "0")}:00，${formatDuration(getCellSeconds(cellData))}`;
		cell.ariaLabel = cell.ariaLabel
			? `${cell.ariaLabel}；${hourLabel}`
			: hourLabel;
		cell.title = hourLabel;
	}

	private setupHourlyKeyboardNavigation(
		charts: HTMLElement,
		columns: HourlyDataColumn[]
	): void {
		const cells = Array.from(
			charts.querySelectorAll<HTMLButtonElement>("button.hourly-cell")
		);
		if (cells.length === 0) {
			return;
		}
		const initialPosition = chooseInitialHourlyPosition(
			cells.map((cell) => ({
				day: Number(cell.dataset.dayIndex),
				hour: Number(cell.dataset.hour),
				available: !cell.disabled,
				selected: cell.classList.contains("is-selected"),
			}))
		);
		const initial = initialPosition
			? cells.find(
					(cell) =>
						Number(cell.dataset.dayIndex) === initialPosition.day &&
						Number(cell.dataset.hour) === initialPosition.hour
			  )
			: undefined;
		cells.forEach((cell) => (cell.tabIndex = cell === initial ? 0 : -1));
		charts.addEventListener("keydown", (event: KeyboardEvent) =>
			this.handleHourlyKeydown(event, charts, columns, cells)
		);
	}

	private handleHourlyKeydown(
		event: KeyboardEvent,
		charts: HTMLElement,
		columns: HourlyDataColumn[],
		cells: HTMLButtonElement[]
	): void {
		const target = event.target;
		if (!(target instanceof HTMLButtonElement)) {
			return;
		}
		const current: HourlyNavigationPosition = {
			day: Number(target.dataset.dayIndex),
			hour: Number(target.dataset.hour),
		};
		const next = resolveHourlyNavigation(
			current,
			columns.length,
			event.key,
			(position) => {
				const candidate = getCellByPosition(columns, position);
				return Boolean(candidate && !candidate.future);
			}
		);
		if (!next) {
			return;
		}
		const nextCell = getCellByPosition(columns, next);
		if (!nextCell) {
			return;
		}
		const nextElement = charts.querySelector<HTMLButtonElement>(
			`button[data-time-key="${getHourlyCellKey(nextCell)}"]`
		);
		if (!nextElement || nextElement.disabled) {
			return;
		}
		event.preventDefault();
		cells.forEach((cell) => (cell.tabIndex = cell === nextElement ? 0 : -1));
		nextElement.focus();
	}
}
