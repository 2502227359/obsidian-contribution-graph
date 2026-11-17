import * as echarts from "echarts/core";
import { CustomChart, ScatterChart, SunburstChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { EChartsType, EChartsCoreOption } from "echarts/core";
import type { CustomSeriesRenderItem } from "echarts";
import { buildWeeklyReviewAnalysis } from "../time/weeklyReviewAnalysis";
import type { WeeklyReviewAnalysis, WeeklyReviewAnalysisNode, WeeklyReviewComparisonRow } from "../time/weeklyReviewAnalysis";
import type { WeeklyReviewSnapshot } from "../time/weeklyReviewTypes";
import type { TimeDocumentStats } from "../time/types";
import { formatDuration } from "../time/timeData";
import { colorFor, detailDuration, labelReviewChart, timeAxisOptions } from "./weeklyReviewChartStyle";
import { activityColor } from "./activityColors";
import { buildWeeklyReviewInsights } from "../time/weeklyReviewInsights";
import type { WeeklyReviewInsights } from "../time/weeklyReviewInsights";
import { renderWeeklyChangeGroups } from "./weeklyReviewInsightDetails";

echarts.use([SunburstChart, ScatterChart, CustomChart, GridComponent, TooltipComponent, SVGRenderer]);

export interface WeeklyReviewChartSelection {
	kind: "structure" | "comparison" | "trend" | "hour" | "ranking";
	id: string;
	label: string;
	activity: boolean;
	documents: readonly TimeDocumentStats[];
	previousDocuments?: readonly TimeDocumentStats[];
	period?: "current" | "previous";
	fromDate?: string;
	toDate?: string;
	previousFromDate?: string;
	previousToDate?: string;
}
interface Theme { text: string; muted: string; border: string; background: string; font: string; }
interface Section { hint: HTMLElement; host: HTMLElement; list: HTMLElement; }

export class WeeklyReviewCharts {
	readonly el: HTMLElement;
	private readonly win: Window & typeof globalThis;
	private readonly structure: Section;
	private readonly comparison: Section;
	private readonly center: HTMLElement;
	private readonly back: HTMLButtonElement;
	private readonly root: HTMLButtonElement;
	private readonly motion: MediaQueryList;
	private readonly resizeObserver: ResizeObserver;
	private readonly themeObserver: MutationObserver;
	private readonly motionChanged = () => this.paint();
	private sunburst?: EChartsType;
	private points?: EChartsType;
	private analysis?: WeeklyReviewAnalysis;
	private insights?: WeeklyReviewInsights;
	private snapshot?: WeeklyReviewSnapshot;
	private options?: {groupingRoot: string; depth: 1 | 2};
	private readonly nodes = new Map<string, WeeklyReviewAnalysisNode>();
	private focusId = "root";
	private selection?: {kind: "structure" | "comparison"; id: string; period: "current" | "previous"};
	private frame?: number;
	private disposed = false;

	constructor(private readonly owner: Document, private readonly onSelect: (value: WeeklyReviewChartSelection | undefined) => void) {
		this.win = owner.defaultView as Window & typeof globalThis;
		this.el = owner.createElement("section");
		this.el.className = "cg-weekly-analysis";
		this.structure = this.createSection("投入结构", "选择学科查看笔记");
		this.structure.host.className = "cg-weekly-sunburst";
		this.center = this.structure.host.parentElement!.appendChild(owner.createElement("div"));
		this.center.className = "cg-analysis-center";
		this.back = owner.createElement("button");
		this.back.type = "button";
		this.back.className = "cg-analysis-back";
		this.back.textContent = "返回上层";
		this.back.dataset.analysisBack = "true";
		this.back.onclick = () => this.goBack();
		this.root = owner.createElement("button");
		this.root.type = "button";
		this.root.className = "cg-analysis-root";
		this.root.textContent = "返回全部";
		this.root.dataset.analysisRoot = "true";
		this.root.onclick = () => this.goRoot();
		this.structure.hint.parentElement!.append(this.back, this.root);
		this.comparison = this.createSection("同期对比", "同一日期范围的已记录时长");
		this.comparison.host.className = "cg-weekly-comparison";
		this.motion = this.win.matchMedia("(prefers-reduced-motion: reduce)");
		this.motion.addEventListener("change", this.motionChanged);
		this.resizeObserver = new this.win.ResizeObserver(() => this.scheduleResize());
		this.resizeObserver.observe(this.structure.host);
		this.resizeObserver.observe(this.comparison.host);
		this.themeObserver = new this.win.MutationObserver(() => this.paint());
		for (const target of [owner.documentElement, owner.body]) this.themeObserver.observe(target, {attributes:true, attributeFilter:["class","style"]});
	}

	update(snapshot: WeeklyReviewSnapshot, options: {groupingRoot: string; depth: 1 | 2}, insights?:WeeklyReviewInsights): void {
		if (this.disposed) return;
		if (snapshot === this.snapshot && options.groupingRoot === this.options?.groupingRoot && options.depth === this.options?.depth) { this.scheduleResize(); return; }
		const changedRange = snapshot.weekStart !== this.snapshot?.weekStart || snapshot.root !== this.snapshot?.root || options.depth !== this.options?.depth;
		this.snapshot = snapshot;
		this.options = options;
		this.analysis = buildWeeklyReviewAnalysis(snapshot, {groupingRoot: options.groupingRoot, groupingDepth: options.depth});
		this.insights = insights || buildWeeklyReviewInsights(snapshot,options);
		this.nodes.clear();
		indexNodes(this.analysis.tree, this.nodes);
		if (changedRange || !this.nodes.has(this.focusId)) this.focusId = "root";
		if (changedRange || !this.selectionExists()) this.selection = undefined;
		this.paint();
		this.emitSelection();
	}

	clearSelection(): void {
		if (!this.selection && this.focusId === "root") return;
		this.selection = undefined;
		this.focusId = "root";
		this.paint();
		this.onSelect(undefined);
	}

	revealStructure(id: string): void { this.selectNode(id); }
	revealComparison(id: string, period: "current" | "previous" = "current"): void { this.selectRow(id,period); }

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.resizeObserver.disconnect();
		this.themeObserver.disconnect();
		this.motion.removeEventListener("change", this.motionChanged);
		if (this.frame !== undefined) this.win.cancelAnimationFrame(this.frame);
		this.sunburst?.dispose();
		this.points?.dispose();
		this.el.remove();
		this.nodes.clear();
		this.analysis = undefined;
		this.insights = undefined;
		this.snapshot = undefined;
	}

	private createSection(title: string, description: string): Section {
		const section = this.owner.createElement("section"); section.className = "cg-weekly-analysis-section";
		const header = section.appendChild(this.owner.createElement("div")); header.className = "cg-weekly-analysis-heading";
		const heading=header.appendChild(this.owner.createElement("h3"));heading.textContent = title;
		const hint = header.appendChild(this.owner.createElement("span")); hint.className = "cg-weekly-analysis-hint"; hint.textContent = description;
		const body = section.appendChild(this.owner.createElement("div")); body.className = "cg-weekly-analysis-body";
		const wrap = body.appendChild(this.owner.createElement("div")); wrap.className = "cg-analysis-chart-wrap";
		const host = wrap.appendChild(this.owner.createElement("div")); labelReviewChart(host,heading);
		const list = body.appendChild(this.owner.createElement("div")); list.className = "cg-weekly-analysis-list";
		this.el.appendChild(section);
		return {hint,host,list};
	}

	private paint(): void {
		if (this.disposed || !this.analysis) return;
		this.paintStructure();
		this.paintComparison();
		this.scheduleResize();
	}

	private baseOption(): EChartsCoreOption {
		const theme = this.theme();
		return {animation:!this.motion.matches, animationDuration:520, animationDurationUpdate:300,
			animationEasing:"cubicOut", animationEasingUpdate:"cubicOut", backgroundColor:"transparent",
			textStyle:{fontFamily:theme.font,color:theme.text}, aria:{enabled:false},
			tooltip:{confine:true,renderMode:"richText",textStyle:{fontFamily:theme.font},formatter:(params:unknown)=>this.tooltipText(params)}};
	}

	private paintStructure(): void {
		const node = this.nodes.get(this.focusId)!;
		this.structure.host.hidden = !node.seconds;
		this.center.hidden = !node.seconds;
		this.back.hidden = this.focusId === "root";
		this.root.hidden = this.focusId === "root";
		this.structure.hint.textContent = breadcrumb(this.analysis!.tree, this.focusId);
		this.center.replaceChildren();
		const selected = this.selection?.kind === "structure" ? this.nodes.get(this.selection.id) : undefined;
		this.center.appendChild(this.owner.createElement("strong")).textContent = formatDuration((selected || node).seconds);
		this.center.appendChild(this.owner.createElement("span")).textContent = (selected || node).name;
		if (!node.seconds) { this.sunburst?.clear(); this.structure.list.textContent = "本周暂无已记录时长"; return; }
		if (!this.sunburst) {
			this.sunburst = echarts.init(this.structure.host,undefined,{renderer:"svg"});
			this.sunburst.on("click",event => { const id=clickedId(event); if(id) this.selectNode(id); });
		}
		const entries = node.children.filter(child=>child.seconds>0);
		this.sunburst.setOption({...this.baseOption(),series:[{id:"structure",type:"sunburst",nodeClick:false,
			data:(entries.length?entries:[node]).map(child=>sunburstData(child,3,node.seconds,this.darkTheme())),radius:["35%","94%"],sort:null,
			label:{fontFamily:this.theme().font,fontSize:11,color:this.theme().text,rotate:"tangential",minAngle:16,overflow:"truncate"},
			itemStyle:{borderColor:this.theme().background,borderWidth:2,borderRadius:4},emphasis:{focus:"ancestor"}}]}, {replaceMerge:["series"]});
		this.renderNodeList(node,entries);
	}

	private renderNodeList(parent: WeeklyReviewAnalysisNode, children: WeeklyReviewAnalysisNode[]): void {
		this.structure.list.replaceChildren();
		const entries = children.length ? children : [parent];
		for (const node of entries) {
			const button = this.owner.createElement("button"); button.type="button"; button.className="cg-analysis-node";
			button.dataset.analysisNode=node.id;
			button.setAttribute("aria-pressed",String(this.selection?.kind==="structure"&&this.selection.id===node.id));
			const name=button.appendChild(this.owner.createElement("span")); name.textContent=node.name+(node.children.length?" ›":"");
			name.title=node.path||node.name;
			const value=button.appendChild(this.owner.createElement("strong")); value.textContent=detailDuration(node.seconds);
			const share=button.appendChild(this.owner.createElement("small")); share.textContent=`${(node.seconds/parent.seconds*100).toFixed(1)}%`;
			button.style.setProperty("--analysis-color",activityColor(node.path || node.id,this.darkTheme()).fill);
			button.onclick=()=>this.selectNode(node.id);
			this.structure.list.appendChild(button);
		}
	}

	private selectNode(id: string): void {
		const node=this.nodes.get(id); if(!node)return;
		this.selection={kind:"structure",id,period:"current"};
		if(node.children.length)this.focusId=id;
		this.paintStructure();
		this.emitSelection();
		const target=Array.from(this.structure.list.querySelectorAll<HTMLButtonElement>("[data-analysis-node]")).find(e=>e.dataset.analysisNode===id);
		(target||this.back).focus({preventScroll:true});
	}

	private goBack(): void {
		if (this.focusId === "root") return;
		const parent=findParent(this.analysis!.tree,this.focusId);
		this.focusId=parent?.id||"root";
		this.selection=this.focusId==="root"?undefined:{kind:"structure",id:this.focusId,period:"current"};
		this.paintStructure();
		this.emitSelection();
		if(this.back.hidden)this.structure.list.querySelector<HTMLButtonElement>("button")?.focus({preventScroll:true});
	}

	private goRoot(): void {
		this.focusId="root";
		this.selection=undefined;
		this.paintStructure();
		this.emitSelection();
		this.structure.list.querySelector<HTMLButtonElement>("button")?.focus({preventScroll:true});
	}

	private paintComparison(): void {
		const comparison=this.analysis!.comparison;
		const rows=comparison.rows;
		this.comparison.hint.textContent=comparisonHint(this.analysis!);
		this.comparison.host.hidden=!rows.length;
		this.comparison.list.replaceChildren();
		if(!rows.length){this.points?.clear();return;}
		this.comparison.host.style.height=`${Math.max(220,rows.length*38+48)}px`;
		if(!this.points){
			this.points=echarts.init(this.comparison.host,undefined,{renderer:"svg"});
			this.points.on("click",event=>{const id=clickedId(event);if(id)this.selectRow(id,event.seriesName==="上期"?"previous":"current");});
		}
		this.points.setOption(this.comparisonOption(rows),{replaceMerge:["series"]});
		renderWeeklyChangeGroups(this.comparison.list,this.insights!.changes,(target,group)=>{
			const row=rows.find(item=>item.id===group.id);if(row)this.renderComparisonRow(row,target);
		});
	}

	private comparisonOption(rows: readonly WeeklyReviewComparisonRow[]): EChartsCoreOption {
		const t=this.theme();
		const maxSeconds=rows.reduce((max,row)=>Math.max(max,row.currentKnown?row.currentSeconds:0,row.previousKnown?row.previousSeconds:0),0);
		const axis=timeAxisOptions(maxSeconds);
		const data=(period:"current"|"previous")=>rows.flatMap((row,index)=>{
			const known=period==="current"?row.currentKnown:row.previousKnown;
			return known?[{id:row.id,value:[period==="current"?row.currentSeconds:row.previousSeconds,index],itemStyle:{color:colorFor(row.id)}}]:[];
		});
		return {...this.baseOption(),grid:{left:8,right:16,top:20,bottom:24,containLabel:true},
			xAxis:{type:"value",...axis,axisLabel:{...axis.axisLabel,color:t.muted,fontFamily:t.font},splitLine:{lineStyle:{color:t.border}}},
			yAxis:{type:"category",inverse:true,data:rows.map(r=>r.name),axisLabel:{color:t.text,fontFamily:t.font,width:92,overflow:"truncate"},axisLine:{show:false},axisTick:{show:false}},
			series:[{id:"connections",type:"custom",silent:true,renderItem:connector,
				data:rows.flatMap((r,i)=>r.currentKnown&&r.previousKnown?[{value:[r.currentSeconds,r.previousSeconds,i],itemStyle:{color:colorFor(r.id)}}]:[])},
				{id:"current",type:"scatter",name:"本期",symbol:"circle",symbolSize:12,data:data("current")},
				{id:"previous",type:"scatter",name:"上期",symbol:"emptyCircle",symbolSize:12,data:data("previous")} ]};
	}

	private renderComparisonRow(row: WeeklyReviewComparisonRow,parent:HTMLElement): void {
		const item=this.owner.createElement("div");item.className="cg-analysis-comparison-row";
		const name=item.appendChild(this.owner.createElement("span"));name.textContent=row.name;name.title=row.path||row.name;
		for(const period of ["current","previous"] as const){
			const known=period==="current"?row.currentKnown:row.previousKnown;
			const seconds=period==="current"?row.currentSeconds:row.previousSeconds;
			const button=item.appendChild(this.owner.createElement("button"));button.type="button";
			button.dataset.analysisComparison=row.id;button.dataset.analysisPeriod=period;button.disabled=!known;
			button.textContent=`${period==="current"?"● 本期":"○ 上期"} ${known?detailDuration(seconds):"记录不明"}`;
			button.setAttribute("aria-label",`${row.name}，${button.textContent}`);
			button.setAttribute("aria-pressed",String(this.selection?.kind==="comparison"&&this.selection.id===row.id&&this.selection.period===period));
			button.onclick=()=>this.selectRow(row.id,period);
		}
		if(row.deltaSeconds!==undefined)item.appendChild(this.owner.createElement("small")).textContent=`${row.deltaSeconds>0&&!row.previousSeconds?"本期新增记录":"差额"} ${row.deltaSeconds>=0?"+":"−"}${detailDuration(Math.abs(row.deltaSeconds))}`;
		parent.appendChild(item);
	}

	private selectRow(id:string,period:"current"|"previous"):void {
		const row=this.analysis?.comparison.rows.find(item=>item.id===id);
		if(!row||!(period==="current"?row.currentKnown:row.previousKnown))return;
		this.selection={kind:"comparison",id,period};this.paintComparison();this.emitSelection();
		Array.from(this.comparison.list.querySelectorAll<HTMLButtonElement>("[data-analysis-comparison]")).find(e=>e.dataset.analysisComparison===id&&e.dataset.analysisPeriod===period)?.focus({preventScroll:true});
	}

	private selectionExists(): boolean {
		if(!this.selection)return false;
		return this.selection.kind==="structure"?this.nodes.has(this.selection.id):Boolean(this.analysis?.comparison.rows.some(r=>r.id===this.selection!.id&&(this.selection!.period==="current"?r.currentKnown:r.previousKnown)));
	}

	private emitSelection(): void {
		if(!this.selection){this.onSelect(undefined);return;}
		const {id,kind,period}=this.selection;
		if(kind==="structure"){
			const node=this.nodes.get(id)!;
			this.onSelect({kind,id,label:node.name,activity:node.activity,documents:node.documents,fromDate:this.snapshot!.weekStart,toDate:this.snapshot!.weekEnd});return;
		}
		const row=this.analysis!.comparison.rows.find(r=>r.id===id)!;const c=this.analysis!.comparison;
		this.onSelect({kind,id,label:row.name,activity:row.activity,period,documents:row.currentDocuments,previousDocuments:row.previousDocuments,
			fromDate:c.fromDate,toDate:c.toDate,previousFromDate:c.referenceFromDate,previousToDate:c.referenceToDate});
	}

	private tooltipText(params: unknown): string {
		const event=(Array.isArray(params)?params[0]:params) as {data?:{id?:string;percentOf?:number};seriesName?:string};
		const id=event.data?.id;if(!id)return "";
		if(event.seriesName==="本期"||event.seriesName==="上期"){
			const row=this.analysis?.comparison.rows.find(item=>item.id===id);if(!row)return "";
			return `${row.name}\n${event.seriesName}：${detailDuration(event.seriesName==="本期"?row.currentSeconds:row.previousSeconds)}`;
		}
		const node=this.nodes.get(id);if(!node)return "";
		const total=event.data?.percentOf || this.nodes.get(this.focusId)?.seconds || node.seconds;
		const share=total ? `${(node.seconds/total*100).toFixed(1)}%` : "0.0%";
		return `${node.name}\n${detailDuration(node.seconds)} · 占当前目录 ${share}\n${node.path||node.name}`;
	}

	private scheduleResize(): void {
		if(this.disposed||this.frame!==undefined)return;
		this.frame=this.win.requestAnimationFrame(()=>{this.frame=undefined;if(!this.el.isConnected)return;this.sunburst?.resize();this.points?.resize();});
	}

	private theme(): Theme {
		const s=this.win.getComputedStyle(this.el);
		return {text:s.getPropertyValue("--text-normal").trim(),muted:s.getPropertyValue("--text-muted").trim(),border:s.getPropertyValue("--background-modifier-border").trim(),
			background:s.getPropertyValue("--background-primary").trim(),font:s.fontFamily};
	}

	private darkTheme(): boolean {
		return this.owner.documentElement.classList.contains("theme-dark") || this.owner.body.classList.contains("theme-dark");
	}
}

function indexNodes(node:WeeklyReviewAnalysisNode,index:Map<string,WeeklyReviewAnalysisNode>):void {index.set(node.id,node);for(const child of node.children)indexNodes(child,index);}
function findParent(root:WeeklyReviewAnalysisNode,id:string):WeeklyReviewAnalysisNode|undefined {for(const child of root.children){if(child.id===id)return root;const found=findParent(child,id);if(found)return found;}return undefined;}
function breadcrumb(root:WeeklyReviewAnalysisNode,id:string):string {
		if (id === "root") return "笔记与 YOLO · 点击分区下钻";
		const chain=findNodePath(root,id);
		return chain.length ? `本周投入 / ${chain.slice(1).map(node=>node.name).join(" / ")}` : "笔记与 YOLO · 点击分区下钻";
}
function findNodePath(root:WeeklyReviewAnalysisNode,id:string):WeeklyReviewAnalysisNode[] {
		if (root.id === id) return [root];
		for (const child of root.children) { const path=findNodePath(child,id); if (path.length) return [root,...path]; }
		return [];
}
function sunburstData(node:WeeklyReviewAnalysisNode,depth:number,percentOf:number,dark:boolean):Record<string,unknown> {
	const color=activityColor(node.path || node.id,dark);
	return {id:node.id,name:node.name,value:node.seconds,path:node.path,activity:node.activity,percentOf,
		label:{show:depth>0,color:color.text,formatter:node.activity?"YOLO":node.name.length>6?node.name.slice(0,5)+"…":node.name},itemStyle:{color:color.fill},
		children:depth>1?node.children.filter(c=>c.seconds>0).map(c=>sunburstData(c,depth-1,percentOf,dark)):undefined};
}

function comparisonHint(analysis:WeeklyReviewAnalysis):string {
	const c=analysis.comparison;
	if(c.state==="NO_COMPLETED_DAYS")return "本周尚无已结束日期可比较";
	const range=`${c.fromDate}—${c.toDate} / ${c.referenceFromDate}—${c.referenceToDate}`;
	return `${range} · ${c.state==="READY"?"同口径已记录量":c.state==="POLICY_CHANGED"?"采集口径有变化，仅展示已有记录":"记录不完整，仅展示已记录量"}`;
}
const connector:CustomSeriesRenderItem=(_params,api)=>{
	const first=api.coord([Number(api.value(0)),Number(api.value(2))]) as number[];
	const second=api.coord([Number(api.value(1)),Number(api.value(2))]) as number[];
	return {type:"line",shape:{x1:first[0],y1:first[1],x2:second[0],y2:second[1]},style:{stroke:api.visual("color") as string,lineWidth:2,opacity:.4}};
};

function clickedId(event: {data?:unknown}): string | undefined {
	const data = event.data as {id?:unknown} | undefined;
	return typeof data?.id === "string" ? data.id : undefined;
}
