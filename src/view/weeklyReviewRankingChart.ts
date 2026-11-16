import * as echarts from "echarts/core";
import { LineChart, ScatterChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { EChartsCoreOption, EChartsType } from "echarts/core";
import type { WeeklyReviewRankPoint, WeeklyReviewRanking, WeeklyReviewRankingGroup, WeeklyReviewRankingWindow } from "../time/weeklyReviewInsights";
import type { WeeklyReviewChartSelection } from "./weeklyReviewCharts";
import { colorFor, detailDuration, labelReviewChart } from "./weeklyReviewChartStyle";

echarts.use([LineChart, ScatterChart, GridComponent, TooltipComponent, SVGRenderer]);

interface Theme { text: string; muted: string; border: string; background: string; font: string; }
interface PointRef { series: WeeklyReviewRankingGroup; point: WeeklyReviewRankPoint; window: WeeklyReviewRankingWindow; index: number; }

export class WeeklyReviewRankingChart {
	readonly el: HTMLElement;
	private readonly owner: Document;
	private readonly win: Window & typeof globalThis;
	private readonly host: HTMLElement;
	private readonly detail: HTMLElement;
	private readonly groupSelect: HTMLSelectElement;
	private readonly windowSelect: HTMLSelectElement;
	private readonly legend: HTMLElement;
	private readonly motion: MediaQueryList;
	private readonly resizeObserver: ResizeObserver;
	private readonly themeObserver: MutationObserver;
	private readonly motionChanged = () => this.paint();
	private chart?: EChartsType;
	private model?: WeeklyReviewRanking;
	private groupId = "all";
	private windowIndex = 0;
	private frame?: number;
	private disposed = false;

	constructor(owner: Document, private readonly onSelect: (value: WeeklyReviewChartSelection | undefined) => void) {
		this.owner = owner;
		this.win = owner.defaultView as Window & typeof globalThis;
		this.el = owner.createElement("section"); this.el.className = "cg-review-ranking";
		const heading = this.el.appendChild(owner.createElement("div")); heading.className = "cg-review-ranking-heading";
		const title=heading.appendChild(owner.createElement("h3"));title.textContent = "四周排名";
		heading.appendChild(owner.createElement("span")).textContent = "相同周进度 · 空心点需核对";
		const controls = this.el.appendChild(owner.createElement("div")); controls.className = "cg-review-ranking-controls";
		this.groupSelect = this.createSelect(controls, "排名分组", "group", () => this.changeGroup());
		this.windowSelect = this.createSelect(controls, "排名区间", "window", () => this.changeWindow());
		this.legend = this.el.appendChild(owner.createElement("div")); this.legend.className = "cg-review-ranking-legend";
		this.host = this.el.appendChild(owner.createElement("div")); this.host.className = "cg-review-ranking-chart";
		labelReviewChart(this.host,title);
		this.detail = this.el.appendChild(owner.createElement("div")); this.detail.className = "cg-review-ranking-detail"; this.detail.setAttribute("aria-live", "polite");
		this.motion = this.win.matchMedia("(prefers-reduced-motion: reduce)"); this.motion.addEventListener("change", this.motionChanged);
		this.resizeObserver = new this.win.ResizeObserver(() => this.scheduleResize()); this.resizeObserver.observe(this.host);
		this.themeObserver = new this.win.MutationObserver(() => this.paint());
		for (const target of [owner.documentElement, owner.body]) this.themeObserver.observe(target, {attributes:true, attributeFilter:["class", "style"]});
	}

	update(model: WeeklyReviewRanking): void {
		if (this.disposed) return;
		this.model = model;
		this.fillControls();
		this.paint();
		this.emitSelection(this.pointRef(this.groupId,this.windowIndex));
	}

	selectPoint(groupId: string, windowIndex: number): void {
		if (!this.model) return;
		this.groupId = this.model.groups.some(series => series.id === groupId) ? groupId : "all";
		this.windowIndex = Math.max(0, Math.min(windowIndex, this.model.windows.length - 1));
		this.groupSelect.value = this.groupId; this.windowSelect.value = String(this.windowIndex);
		this.paint(); this.emitSelection(this.pointRef(groupId, this.windowIndex));
	}

	clearSelection(): void {this.groupId="all";if(this.model){this.fillControls();this.paint();}this.onSelect(undefined);}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true; this.resizeObserver.disconnect(); this.themeObserver.disconnect(); this.motion.removeEventListener("change", this.motionChanged);
		if (this.frame !== undefined) this.win.cancelAnimationFrame(this.frame);
		this.chart?.dispose(); this.chart = undefined; this.model = undefined; this.el.remove();
	}

	private createSelect(parent: HTMLElement, label: string, key: string, change: () => void): HTMLSelectElement {
		const select = parent.appendChild(this.owner.createElement("select")); select.setAttribute("aria-label", label); select.dataset.rankingControl = key; select.onchange = change; return select;
	}

	private fillControls(): void {
		const model = this.model!;
		this.fill(this.groupSelect, [["all", "全部分组"], ...model.groups.map(series => [series.id, series.name] as [string, string])]);
		this.fill(this.windowSelect, model.windows.map((window, index) => [String(index), periodLabel(window.fromDate, window.toDate)]));
		if (!model.groups.some(series => series.id === this.groupId)) this.groupId = "all";
		this.windowIndex = Math.min(this.windowIndex, Math.max(0, model.windows.length - 1));
		this.groupSelect.value = this.groupId; this.windowSelect.value = String(this.windowIndex);
		this.legend.replaceChildren();
		for (const series of model.groups) {
			const button = this.legend.appendChild(this.owner.createElement("button")); button.type = "button"; button.textContent = series.name; button.dataset.rankingGroup = series.id; button.style.setProperty("--ranking-color", colorFor(series.id));
			button.setAttribute("aria-pressed", String(this.groupId === series.id)); button.onclick = () => this.selectPoint(series.id, this.windowIndex);
		}
	}

	private fill(select: HTMLSelectElement, values: readonly (readonly [string, string])[]): void {
		const previous = select.value; select.replaceChildren();
		for (const [value, label] of values) { const option = select.appendChild(this.owner.createElement("option")); option.value = value; option.textContent = label; }
		if (values.some(([value]) => value === previous)) select.value = previous;
	}

	private paint(): void {
		if (this.disposed || !this.model || !this.el.isConnected) return;
		const model = this.model;
		for(const button of Array.from(this.legend.querySelectorAll<HTMLElement>("[data-ranking-group]")))button.setAttribute("aria-pressed",String(button.dataset.rankingGroup===this.groupId));
		if (!model.windows.length || !model.groups.length) { this.host.hidden = true;this.chart?.clear();this.detail.textContent = model.windows.length?"本周尚无可排名的已结束日期记录":"暂无排名数据，请刷新"; return; }
		this.host.hidden = false;
		if (!this.chart) { this.chart = echarts.init(this.host, undefined, {renderer:"svg"}); this.chart.on("click", event => this.handleChartClick(event)); }
		this.chart.setOption(this.option(), true); this.describe(this.pointRef(this.groupId, this.windowIndex));
	}

	private option(): EChartsCoreOption {
		const model = this.model!; const theme = this.theme(); const groups = this.groupId === "all" ? model.groups : model.groups.filter(series => series.id === this.groupId);
		const maxRank = Math.max(1, ...model.groups.map(series => series.points.reduce((max, point) => Math.max(max, point.rank || 0), 0)));
		const line: object[] = [], dots: object[] = [];
		for (const series of groups) { for (const run of comparableRuns(series, model.windows)) line.push(this.lineSeries(series, run)); dots.push(this.dotSeries(series, model.windows)); }
		return {animation:!this.motion.matches, animationDuration:520, animationDurationUpdate:300, animationEasing:"cubicOut", animationEasingUpdate:"cubicOut", backgroundColor:"transparent", textStyle:{fontFamily:theme.font,color:theme.text}, aria:{enabled:false},
			grid:{left:38,right:14,top:18,bottom:38}, xAxis:{type:"category",data:model.windows.map(window => periodLabel(window.fromDate, window.toDate)),axisTick:{show:false},axisLine:{lineStyle:{color:theme.border}},axisLabel:{color:theme.muted,interval:0,rotate:model.windows.length > 3 ? 18 : 0}},
			yAxis:{type:"value",inverse:true,min:1,max:Math.max(2,maxRank),interval:Math.max(1,Math.ceil(maxRank/6)),axisLabel:{color:theme.muted,formatter:(value:number) => `第${value}名`},splitLine:{lineStyle:{color:theme.border,type:"dashed"}}},
			tooltip:{confine:true,renderMode:"richText",backgroundColor:theme.background,borderColor:theme.border,textStyle:{fontFamily:theme.font},formatter:(params:unknown) => this.tooltip(params)},
			series:[...line, ...dots]};
	}

	private lineSeries(series: WeeklyReviewRankingGroup, run: number[]): object { return {type:"line",name:series.name,id:`${series.id}-${run[0]}`,data:run.map(index => ({value:[index, series.points[index].rank], groupId:series.id, windowIndex:index})),connectNulls:false,smooth:false,showSymbol:false,lineStyle:{width:2,color:colorFor(series.id),opacity:.84},silent:true}; }

	private dotSeries(series: WeeklyReviewRankingGroup, windows: readonly WeeklyReviewRankingWindow[]): object {
		return {type:"scatter",name:series.name,id:`dots-${series.id}`,data:series.points.map((point,index) => point.rank === null ? null : ({value:[index, point.rank],groupId:series.id,windowIndex:index,point,window:windows[index],itemStyle:!point.complete ? {color:this.theme().background,borderColor:colorFor(series.id),borderWidth:2} : {color:colorFor(series.id)}})),symbol:"circle",symbolSize:9,emphasis:{scale:1.35},z:3};
	}

	private tooltip(params: unknown): string {
		const item = (Array.isArray(params) ? params[0] : params) as {data?:{point?:WeeklyReviewRankPoint;window?:WeeklyReviewRankingWindow}} | undefined;
		const point = item?.data?.point, window = item?.data?.window;
		if (!point || !window) return "";
		return `${periodLabel(window.fromDate, window.toDate)}\n第${point.rank}名 · ${detailDuration(point.seconds)}${window.previousState === "POLICY_CHANGED" ? " · 采集口径变化" : !point.complete ? " · 记录不完整" : ""}`;
	}

	private handleChartClick(event: {componentType?:string;data?:unknown}): void {
		const data = event.data as {groupId?:string;windowIndex?:number} | null;
		if (event.componentType !== "series" || !data?.groupId || data.windowIndex === undefined) return;
		this.selectPoint(data.groupId, data.windowIndex);
	}

	private changeGroup(): void { this.groupId = this.groupSelect.value; this.paint(); this.emitSelection(this.pointRef(this.groupId, this.windowIndex)); }
	private changeWindow(): void { this.windowIndex = Number(this.windowSelect.value) || 0; this.paint(); this.emitSelection(this.pointRef(this.groupId, this.windowIndex)); }

	private pointRef(groupId: string, index: number): PointRef | undefined {
		if (!this.model || groupId === "all") return undefined;
		const series = this.model.groups.find(item => item.id === groupId), window = this.model.windows[index];
		if (!series || !window) return undefined;
		const point = series.points[index]; return point ? {series,point,window,index} : undefined;
	}

	private emitSelection(ref: PointRef | undefined): void {
		if (!ref) { this.onSelect(undefined); return; }
		this.onSelect({kind:"ranking",id:`${ref.series.id}/${ref.index}`,label:ref.series.name,activity:ref.series.activity,documents:ref.point.documents,fromDate:ref.window.fromDate,toDate:ref.window.toDate});
	}

	private describe(ref: PointRef | undefined): void {
		if (!ref) { this.detail.textContent = "选择分组查看排名明细"; return; }
		const point = ref.point; const rank = point.rank === null ? point.status==="CONFIRMED_ZERO"?"无已记录投入":"暂无可确认排名" : `第${point.rank}名`;
		this.detail.textContent = `${periodLabel(ref.window.fromDate, ref.window.toDate)} · ${ref.series.name}　${rank}　${point.known?detailDuration(point.seconds):"暂无可确认记录"}${ref.window.previousState === "POLICY_CHANGED" ? "　采集口径变化" : !point.complete ? "　记录不完整" : ""}`;
	}

	private scheduleResize(): void {
		if (this.disposed || this.frame !== undefined) return;
		this.frame = this.win.requestAnimationFrame(() => { this.frame = undefined;if(this.el.isConnected&&this.host.clientWidth)this.chart?.resize(); });
	}

	private theme(): Theme { const style = this.win.getComputedStyle(this.el), value = (key:string, fallback:string) => style.getPropertyValue(key).trim() || fallback; return {text:value("--text-normal","#454b54"),muted:value("--text-muted","#858990"),border:value("--background-modifier-border","#dedede"),background:value("--background-primary","#fff"),font:style.fontFamily}; }
}

function comparableRuns(series: WeeklyReviewRankingGroup, windows: readonly WeeklyReviewRankingWindow[]): number[][] {
	const runs: number[][] = []; let current: number[] = [];
	for (let index = 0; index < series.points.length; index++) {
		const point = series.points[index];
		if(point.rank===null){if(current.length)runs.push(current);current=[];continue;}
		if(current.length&&(!point.connectPrevious||windows[index]?.previousState!=="READY")){runs.push(current);current=[];}
		current.push(index);
	}
	if (current.length) runs.push(current);
	return runs.filter(run=>run.length>1);
}

function periodLabel(fromDate: string, toDate?: string): string { return toDate ? `${fromDate.slice(5)}—${toDate.slice(5)}` : `${fromDate.slice(5)}起`; }
