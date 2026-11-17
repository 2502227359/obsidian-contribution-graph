import * as echarts from "echarts/core";
import { CustomChart } from "echarts/charts";
import { DataZoomComponent, DataZoomSliderComponent, GridComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { EChartsCoreOption, EChartsType } from "echarts/core";
import type { CustomSeriesRenderItem } from "echarts";
import type { ActivityTimelineBlock, ActivityTimelineDay } from "../time/activityTimelineTypes";
import { colorFor, labelReviewChart } from "./weeklyReviewChartStyle";

echarts.use([CustomChart, DataZoomComponent, DataZoomSliderComponent, GridComponent, TooltipComponent, SVGRenderer]);

export interface ActivityTimelineChartRow {
	id: string;
	label: string;
	groupId: string;
	depth: 1 | 2;
	blockIds: readonly string[];
}

export interface ActivityTimelineChartState {
	window: readonly [number, number];
	selectedId?: string;
	highlightedPath?: string;
}

export interface ActivityTimelineChartCallbacks {
	onSelect(id: string): void;
	onWindowChange(window: [number, number]): void;
}

interface Theme { text: string; muted: string; border: string; background: string; font: string; }

const renderBlock: CustomSeriesRenderItem = (params, api) => {
	const row = Number(api.value(0));
	const start = Number(api.value(1));
	const end = Number(api.value(2));
	const first = api.coord([start, row]) as number[];
	const last = api.coord([end, row]) as number[];
	const size = (api.size ? api.size([0, 1]) : [0, 20]) as number[];
	const height = Math.max(10, Math.min(28, Math.abs(Number(size[1]) || 20) * .62));
	const shape = {x: first[0], y: first[1] - height / 2, width: Math.max(2, last[0] - first[0]), height};
	const clipped = echarts.graphic.clipRectByRect(shape, params.coordSys as unknown as {x: number; y: number; width: number; height: number});
	if (!clipped) return undefined;
	const rectangle={type:"rect" as const,shape:clipped,style:api.style()};
	if(clipped.width<65)return rectangle;
	return {type:"group",children:[rectangle,{type:"text",silent:true,style:{
		text:String(api.value(3)),x:clipped.x+6,y:clipped.y+height/2,width:clipped.width-12,
		fill:String(api.value(5)),fontFamily:String(api.value(4)),fontSize:12,verticalAlign:"middle",overflow:"truncate",
	}}]};
};

export class ActivityTimelineChart {
	readonly el: HTMLElement;
	private readonly owner: Document;
	private readonly win: Window & typeof globalThis;
	private readonly callbacks: ActivityTimelineChartCallbacks;
	private chart?: EChartsType;
	private motion: MediaQueryList;
	private disposed = false;
	private correctingZoom = false;

	constructor(host: HTMLElement, heading: HTMLElement, callbacks: ActivityTimelineChartCallbacks) {
		this.owner = host.ownerDocument;
		this.win = this.owner.defaultView as Window & typeof globalThis;
		this.el = host;
		this.callbacks = callbacks;
		labelReviewChart(host, heading);
		this.motion = this.win.matchMedia("(prefers-reduced-motion: reduce)");
	}

	render(day: ActivityTimelineDay, rows: readonly ActivityTimelineChartRow[], state: ActivityTimelineChartState): void {
		if (this.disposed) return;
		if (!rows.length || !day.blocks.length) {
			this.chart?.clear();
			return;
		}
		if (!this.chart) this.createChart();
		this.chart!.setOption(this.option(day.blocks, rows, state), true);
	}

	resize(): void { if (!this.disposed) this.chart?.resize(); }

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.chart?.dispose();
		this.chart = undefined;
	}

	private createChart(): void {
		this.chart = echarts.init(this.el, undefined, {renderer: "svg"});
		this.chart.on("click", event => this.handleClick(event));
		this.chart.on("datazoom", event => this.handleZoom(event));
	}

	private option(blocks: readonly ActivityTimelineBlock[], rows: readonly ActivityTimelineChartRow[], state: ActivityTimelineChartState): EChartsCoreOption {
		const theme = this.theme();
		const rowIndex = new Map(rows.flatMap((row, index) => row.blockIds.map(id => [id, index] as const)));
		const data = blocks.flatMap(block => this.blockData(block, rowIndex.get(block.id) ?? 0, state));
		return {
			animation: !this.motion.matches,
			animationDuration: 260,
			animationDurationUpdate: 180,
			animationEasing: "cubicOut",
			backgroundColor: "transparent",
			textStyle: {fontFamily: theme.font, color: theme.text},
			aria: {enabled: false},
			grid: {left: 12, right: 18, top: 18, bottom: 52, containLabel: true},
			xAxis: {type: "value", min: 0, max: 1440, interval:clockInterval(state.window,this.el.clientWidth),boundaryGap: false, axisLine: {lineStyle: {color: theme.border}}, axisTick: {show: false}, axisLabel: {color: theme.muted, fontFamily: theme.font, formatter: clockLabel,hideOverlap:true}, splitLine: {lineStyle: {color: theme.border, type: "dashed"}}},
			yAxis: {type: "category", inverse: true, data: rows.map(row => row.label), axisLine: {show: false}, axisTick: {show: false}, axisLabel: {color: theme.text, fontFamily: theme.font, width: this.el.clientWidth<500?90:150, overflow: "truncate"}, splitLine: {show: true, lineStyle: {color: theme.border, opacity: .45}}},
			dataZoom: [{type: "slider", xAxisIndex: 0, filterMode: "none", startValue: state.window[0], endValue: state.window[1], height: 22, bottom: 8, borderColor: theme.border, backgroundColor: "transparent", fillerColor: theme.border, handleStyle: {color: theme.text, opacity: .65}, moveHandleStyle: {color: theme.text, opacity: .35}, textStyle: {color: theme.muted, fontFamily: theme.font}}],
			tooltip: {trigger: "item", confine: true, renderMode: "richText", backgroundColor: theme.background, borderColor: theme.border, textStyle: {fontFamily: theme.font, color: theme.text}, formatter: (params: unknown) => this.tooltip(params, blocks)},
			series: [{id: "activity-timeline", type: "custom", coordinateSystem: "cartesian2d", renderItem: renderBlock, encode: {x: [1, 2], y: 0}, data}],
		};
	}

	private blockData(block: ActivityTimelineBlock, row: number, state: ActivityTimelineChartState): object {
		const color = colorFor(block.activity ? "activity:yolo" : block.groupId);
		const highlighted = !state.highlightedPath || state.highlightedPath === block.path;
		const selected = state.selectedId === block.id;
		const theme=this.theme();
		return {value: [row, block.startMinute, block.endMinute,blockLabel(block),theme.font,"#202b39"], blockId: block.id, itemStyle: {color, opacity: highlighted ? 1 : .18, borderColor: selected ? theme.text : color, borderWidth: selected ? 2 : 1, borderType: block.provisional ? "dashed" : "solid"}};
	}

	private tooltip(params: unknown, blocks: readonly ActivityTimelineBlock[]): string {
		const item = (Array.isArray(params) ? params[0] : params) as {data?: {blockId?: unknown}} | undefined;
		const id = typeof item?.data?.blockId === "string" ? item.data.blockId : "";
		const block = blocks.find(candidate => candidate.id === id);
		return block ? `${blockLabel(block)}\n${minuteLabel(block.startMinute)}–${minuteLabel(block.endMinute)} · ${durationLabel(block.seconds)}${block.provisional ? " · 含暂计尾段" : ""}` : "";
	}

	private handleClick(event: {componentType?: string; data?: unknown}): void {
		if (event.componentType !== "series") return;
		const id = (event.data as {blockId?: unknown} | undefined)?.blockId;
		if (typeof id === "string") this.callbacks.onSelect(id);
	}

	private handleZoom(event: unknown): void {
		const value = event as {startValue?: unknown; endValue?: unknown; start?: unknown; end?: unknown; batch?: Array<{startValue?: unknown; endValue?: unknown; start?: unknown; end?: unknown}>};
		const payload = value.batch?.[0] || value;
		if (Number.isFinite(Number(payload.startValue)) && Number.isFinite(Number(payload.endValue))) {
			this.emitWindow([Number(payload.startValue), Number(payload.endValue)]);
			return;
		}
		if (Number.isFinite(Number(payload.start)) && Number.isFinite(Number(payload.end))) {
			this.emitWindow([percentToMinute(Number(payload.start)), percentToMinute(Number(payload.end))]);
			return;
		}
		const option = this.chart?.getOption() as {dataZoom?: Array<{startValue?: unknown; endValue?: unknown}>} | undefined;
		const zoom = option?.dataZoom?.[0];
		if (zoom && Number.isFinite(Number(zoom.startValue)) && Number.isFinite(Number(zoom.endValue))) this.emitWindow([Number(zoom.startValue), Number(zoom.endValue)]);
	}

	private emitWindow(window: [number, number]): void {
		const normalized = normalizeWindow(window);
		if ((normalized[0] !== window[0] || normalized[1] !== window[1]) && !this.correctingZoom) {
			this.correctingZoom = true;
			this.chart?.dispatchAction({type: "dataZoom", startValue: normalized[0], endValue: normalized[1]});
			this.correctingZoom = false;
		}
		this.callbacks.onWindowChange(normalized);
	}

	private theme(): Theme {
		const style = this.win.getComputedStyle(this.el);
		const value = (key: string, fallback: string) => style.getPropertyValue(key).trim() || fallback;
		return {text: value("--text-normal", "#454b54"), muted: value("--text-muted", "#858990"), border: value("--background-modifier-border", "#dedede"), background: value("--background-primary", "#fff"), font: style.fontFamily || value("--font-text", "inherit")};
	}
}

function blockLabel(block: ActivityTimelineBlock): string { return block.activity ? "YOLO 对话活动" : noteName(block.path); }

function noteName(path: string): string { return (path.split("/").pop() || path).replace(/\.md$/i, "") || "未命名笔记"; }

function clockLabel(value: number): string {
		const minutes = Math.max(0, Math.min(1440, Math.round(Number(value))));
		if (minutes >= 1440) return "24:00";
		return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function minuteLabel(minutes: number): string { if (!Number.isFinite(minutes)) return "时间未知"; const total = Math.max(0, Math.round(minutes * 60)); if (total >= 86400) return "24:00:00"; return `${String(Math.floor(total / 3600)).padStart(2, "0")}:${String(Math.floor(total % 3600 / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; }

function percentToMinute(value: number): number { return Math.max(0, Math.min(1440, value / 100 * 1440)); }

function clockInterval(window:readonly[number,number],width:number):number {
	const slots=Math.max(2,Math.min(8,Math.floor((width-180)/80))),target=(window[1]-window[0])/slots;
	return [1,5,10,15,30,60,120,180,240,360,720].find(interval=>interval>=target)||720;
}

function normalizeWindow(window: readonly [number, number]): [number, number] {
	let start = Number.isFinite(window[0]) ? window[0] : 0;
	let end = Number.isFinite(window[1]) ? window[1] : 1440;
	if (end < start) [start, end] = [end, start];
	const width = Math.max(15, Math.min(1440, end - start));
	start = Math.max(0, Math.min(1440 - width, start));
	return [start, start + width];
}

function durationLabel(seconds: number): string {
		if (!Number.isFinite(seconds) || seconds <= 0) return "0秒";
		if (seconds < 1) return "少于1秒";
		const value = Math.floor(seconds);
		const hours = Math.floor(value / 3600);
		const minutes = Math.floor(value % 3600 / 60);
		const rest = value % 60;
		return [hours ? `${hours}小时` : "", minutes ? `${minutes}分` : "", rest ? `${rest}秒` : ""].filter(Boolean).join("") || "少于1分";
}
