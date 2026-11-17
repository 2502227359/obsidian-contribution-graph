import * as echarts from "echarts/core";
import { HeatmapChart, LineChart, ScatterChart } from "echarts/charts";
import { GridComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { EChartsCoreOption, EChartsType } from "echarts/core";
import { buildWeeklyTrendGroups, groupWeeklyReviewHours } from "../time/weeklyReviewTimeline";
import type { WeeklyReviewTimeBin, WeeklyTrendGroup } from "../time/weeklyReviewTimeline";
import type { WeeklyReviewDay, WeeklyReviewSnapshot } from "../time/weeklyReviewTypes";
import type { WeeklyReviewChartSelection } from "./weeklyReviewCharts";
import { colorFor, detailDuration, labelReviewChart, timeAxisOptions } from "./weeklyReviewChartStyle";

echarts.use([LineChart, HeatmapChart, ScatterChart, GridComponent, TooltipComponent, VisualMapComponent, SVGRenderer]);

interface ChartSection { host: HTMLElement; controls: HTMLElement; detail: HTMLElement; }
interface Theme { text:string; muted:string; border:string; background:string; font:string; }

export class WeeklyReviewTimelineCharts {
	readonly el: HTMLElement;
	private readonly win: Window & typeof globalThis;
	private readonly trend: ChartSection;
	private readonly heat: ChartSection;
	private readonly modeSelect: HTMLSelectElement;
	private readonly groupSelect: HTMLSelectElement;
	private readonly dateSelect: HTMLSelectElement;
	private readonly legend: HTMLElement;
	private readonly heatDateSelect: HTMLSelectElement;
	private readonly hourSelect: HTMLSelectElement;
	private readonly rangeLabel: HTMLElement;
	private readonly rangeExit: HTMLButtonElement;
	private readonly motion: MediaQueryList;
	private readonly resizeObserver: ResizeObserver;
	private readonly themeObserver: MutationObserver;
	private readonly motionChanged = () => this.paint();
	private area?: EChartsType;
	private heatmap?: EChartsType;
	private snapshot?: WeeklyReviewSnapshot;
	private options?: {groupingRoot:string;depth:1|2};
	private groups: WeeklyTrendGroup[] = [];
	private bins: WeeklyReviewTimeBin[] = [];
	private step: 1|2 = 1;
	private selection?: "trend"|"hour"|"range";
	private hourRangeSelection?: {start:number;end:number};
	private rangeControlsState?: {date:string;hour:string};
	private frame?: number;
	private disposed = false;

	constructor(private readonly owner:Document, private readonly onSelect:(value:WeeklyReviewChartSelection|undefined)=>void) {
		this.win = owner.defaultView as Window & typeof globalThis;
		this.el = owner.createElement("section"); this.el.className = "cg-weekly-timeline";
		this.trend = this.section("四周趋势", "每日已记录时长 · 缺失处留空");
		this.modeSelect = this.select(this.trend.controls,"趋势视图","trend-mode",()=>this.changeTrend());
		this.fill(this.modeSelect,[["total","总时长"],["groups","投入构成"]]);
		this.groupSelect = this.select(this.trend.controls,"趋势分组","trend-group",()=>this.changeTrend());
		this.dateSelect = this.select(this.trend.controls,"趋势日期","trend-date",()=>this.selectTrend());
		this.legend=owner.createElement("div");this.legend.className="cg-timeline-groups";this.trend.controls.after(this.legend);
		this.heat = this.section("一周时段", "颜色表示已记录时长");
		this.heatDateSelect = this.select(this.heat.controls,"时段日期","heat-date",()=>this.selectHour());
		this.hourSelect = this.select(this.heat.controls,"查看时段","heat-hour",()=>this.selectHour());
		const rangeControls=this.createRangeControls();
		this.rangeLabel=rangeControls.label;this.rangeExit=rangeControls.exit;
		this.motion = this.win.matchMedia("(prefers-reduced-motion: reduce)");
		this.motion.addEventListener("change",this.motionChanged);
		this.resizeObserver = new this.win.ResizeObserver(()=>this.scheduleResize());
		this.resizeObserver.observe(this.el);
		this.themeObserver = new this.win.MutationObserver(()=>this.paint());
		for(const target of [owner.documentElement,owner.body]) this.themeObserver.observe(target,{attributes:true,attributeFilter:["class","style"]});
	}

	update(snapshot:WeeklyReviewSnapshot,options:{groupingRoot:string;depth:1|2}):void {
		if(this.disposed) return;
		if(snapshot===this.snapshot&&options.groupingRoot===this.options?.groupingRoot&&options.depth===this.options?.depth){this.scheduleResize();return;}
		const changed = snapshot.weekStart!==this.snapshot?.weekStart||snapshot.root!==this.snapshot?.root||options.groupingRoot!==this.options?.groupingRoot||options.depth!==this.options?.depth;
		this.snapshot=snapshot; this.options=options;
		this.groups=snapshot.timeline?buildWeeklyTrendGroups(snapshot.timeline,options):[];
		this.legend.replaceChildren();
		for(const group of this.groups){const label=this.legend.appendChild(this.owner.createElement("span"));label.textContent=group.name;label.style.setProperty("--timeline-color",colorFor(group.id));}
		this.fill(this.groupSelect,[["all","全部分组"],...this.groups.map(group=>[group.id,group.name] as [string,string])]);
		this.fill(this.dateSelect,(snapshot.timeline?.days||[]).map(day=>[day.date,day.date]));
		this.fill(this.heatDateSelect,snapshot.days.map(day=>[day.date,day.date]));
		if(changed){this.selection=undefined;this.hourRangeSelection=undefined;this.rangeControlsState=undefined;this.setRangeControls(false);this.dateSelect.value=latestDate(snapshot.timeline?.days||[]);this.heatDateSelect.value=latestDate(snapshot.days);}
		this.updateBins(); this.paint();
		if(this.selection) this.emitSelection();
	}

	clearSelection():void {
		this.selection=undefined;this.hourRangeSelection=undefined;this.restoreRangeControls();
		if(this.el.isConnected&&this.snapshot?.timeline)this.paintHeatmap();
		this.describeHour();this.onSelect(undefined);
	}

	revealHours(start:number,end:number):void {
		if(!this.snapshot?.timeline)return;
		if(this.selection!=="range")this.rangeControlsState={date:this.heatDateSelect.value,hour:this.hourSelect.value};
		this.hourRangeSelection={start,end};this.selection="range";this.setRangeControls(true);
		this.paintHeatmap();this.describeHour();this.emitSelection();
	}

	dispose():void {
		if(this.disposed)return;
		this.disposed=true;this.resizeObserver.disconnect();this.themeObserver.disconnect();
		this.motion.removeEventListener("change",this.motionChanged);
		if(this.frame!==undefined)this.win.cancelAnimationFrame(this.frame);
		this.area?.dispose();this.heatmap?.dispose();this.el.remove();
		this.snapshot=undefined;this.groups=[];this.bins=[];this.rangeControlsState=undefined;
	}

	private section(title:string,hint:string):ChartSection {
		const section=this.el.appendChild(this.owner.createElement("section"));section.className="cg-timeline-section";
		const header=section.appendChild(this.owner.createElement("div"));header.className="cg-timeline-heading";
		const heading=header.appendChild(this.owner.createElement("h3"));heading.textContent=title;
		header.appendChild(this.owner.createElement("span")).textContent=hint;
		const controls=section.appendChild(this.owner.createElement("div"));controls.className="cg-timeline-controls";
		const host=section.appendChild(this.owner.createElement("div"));host.className="cg-timeline-chart";
		labelReviewChart(host,heading);
		const detail=section.appendChild(this.owner.createElement("div"));detail.className="cg-timeline-detail";detail.setAttribute("aria-live","polite");
		return {host,controls,detail};
	}

	private select(parent:HTMLElement,label:string,key:string,change:()=>void):HTMLSelectElement {
		const select=parent.appendChild(this.owner.createElement("select"));
		select.setAttribute("aria-label",label);select.dataset.timelineControl=key;select.onchange=change;
		return select;
	}

	private createRangeControls():{label:HTMLElement;exit:HTMLButtonElement} {
		const label=this.heat.controls.appendChild(this.owner.createElement("span"));
		label.className="cg-timeline-range";label.hidden=true;
		const exit=this.heat.controls.appendChild(this.owner.createElement("button"));
		exit.type="button";exit.className="cg-timeline-range-exit";exit.dataset.timelineControl="exit-range";
		exit.setAttribute("aria-label","退出整周时段选择");exit.textContent="退出整周";exit.hidden=true;
		exit.onclick=()=>this.exitRangeSelection();
		const legend=this.heat.controls.appendChild(this.owner.createElement("span"));legend.className="cg-timeline-key";
		legend.textContent="浅 → 深：零 → 多　— 未确认　· 未来";
		return {label,exit};
	}

	private fill(select:HTMLSelectElement,values:readonly (readonly [string,string])[]):void {
		const previous=select.value;select.replaceChildren();
		for(const [value,label] of values){const option=select.appendChild(this.owner.createElement("option"));option.value=value;option.textContent=label;}
		if(values.some(([value])=>value===previous))select.value=previous;
	}

	private paint():void {
		if(this.disposed||!this.snapshot||!this.el.isConnected)return;
		const available=!!this.snapshot.timeline;
		if(!available){this.selection=undefined;this.hourRangeSelection=undefined;this.rangeControlsState=undefined;this.setRangeControls(false);}
		for(const part of [this.trend,this.heat]){part.host.hidden=!available;part.controls.hidden=!available;}
		if(!available){this.trend.detail.textContent="暂无趋势与时段数据，请刷新";this.heat.detail.textContent="";return;}
		this.paintArea();this.paintHeatmap();this.describeTrend();this.describeHour();
	}

	private baseOption():EChartsCoreOption {
		const theme=this.theme();
		return {animation:!this.motion.matches,animationDuration:520,animationDurationUpdate:300,animationEasing:"cubicOut",animationEasingUpdate:"cubicOut",
			backgroundColor:"transparent",textStyle:{fontFamily:theme.font,color:theme.text},aria:{enabled:false},
			tooltip:{confine:true,renderMode:"richText",backgroundColor:theme.background,borderColor:theme.border,textStyle:{fontFamily:theme.font,color:theme.text}}};
	}

	private paintArea():void {
		const days=this.snapshot!.timeline!.days,theme=this.theme();
		this.groupSelect.hidden=this.modeSelect.value!=="groups";
		this.legend.hidden=this.modeSelect.value!=="groups";
		if(!this.area){
			this.area=echarts.init(this.trend.host,undefined,{renderer:"svg"});
			this.area.on("click",event=>{if(event.componentType!=="series")return;const index=event.dataIndex as number;
				if(this.modeSelect.value==="groups"&&this.groups.some(group=>group.id===event.seriesId)){this.groupSelect.value=String(event.seriesId);this.paintArea();}
				this.dateSelect.value=daysAt(this.snapshot,index);this.selectTrend();});
		}
		const series=this.areaSeries();
		const axis=timeAxisOptions(this.areaMaxSeconds());
		this.area.setOption({...this.baseOption(),grid:{left:12,right:16,top:18,bottom:28,containLabel:true},
			xAxis:{type:"category",boundaryGap:false,data:days.map(day=>day.date),axisTick:{show:false},axisLine:{lineStyle:{color:theme.border}},
				axisLabel:{color:theme.muted,interval:6,formatter:(date:string)=>date.slice(5).replace("-","/")}},
			yAxis:{...axis,type:"value",axisLabel:{...axis.axisLabel,color:theme.muted},splitLine:{lineStyle:{color:theme.border,opacity:.45,type:"dashed"}}},
			tooltip:{...this.baseOption().tooltip as object,trigger:"axis",formatter:(params:unknown)=>this.trendTooltip(params)},series},true);
	}

	private areaMaxSeconds():number {
		const selected=this.groupSelect.value,groups=this.modeSelect.value==="groups"?this.groups.filter(group=>selected==="all"||group.id===selected):[];
		if(!groups.length)return Math.max(1,...this.snapshot!.timeline!.days.map(day=>day.seconds));
		const values=this.snapshot!.timeline!.days.map((_,index)=>groups.reduce((sum,group)=>sum+(group.points[index]?.seconds||0),0));
		return Math.max(1,...values);
	}

	private areaSeries():object[] {
		const days=this.snapshot!.timeline!.days;
		const selected=this.groupSelect.value;
		const groups=this.modeSelect.value==="groups"?this.groups.filter(group=>selected==="all"||group.id===selected):[];
		const values=groups.length?groups.map(group=>({id:group.id,name:group.name,points:group.points.map(point=>point.seconds)})):
			[{id:"notes",name:"总时长",points:days.map(day=>day.seconds>0||(day.coverage==="TRACKED"&&!day.future&&!day.timezoneWarning)?day.seconds:null)}];
		return values.map(group=>({id:group.id,name:group.name,type:"line",stack:"recorded",smooth:false,connectNulls:false,
			showSymbol:true,symbol:"circle",symbolSize:5,emphasis:{focus:"series"},lineStyle:{width:2,color:colorFor(group.id)},itemStyle:{color:colorFor(group.id)},
			blur:{lineStyle:{opacity:.72},itemStyle:{opacity:.72},areaStyle:{opacity:.22}},
			areaStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:colorFor(group.id)},{offset:1,color:this.theme().background}]),opacity:.32},
			data:group.points}));
	}

	private trendTooltip(params:unknown):string {
		const list=Array.isArray(params)?params:[];
		const index=list[0]?.dataIndex;const day=this.snapshot?.timeline?.days[index];
		if(!day)return "";
		const lines=[`${day.date} · ${dayStatus(day)}`,`总计 ${observedDuration(day)}`];
		for(const item of list)if(item.seriesName!=="总时长"&&typeof item.value==="number")lines.push(`${item.seriesName}  ${detailDuration(item.value)}`);
		return lines.join("\n");
	}

	private updateBins():void {
		this.bins=groupWeeklyReviewHours(this.snapshot?.timeline?.hours||[],this.step);
		const previous=Number(this.hourSelect.value)||0;
		this.fill(this.hourSelect,Array.from({length:24/this.step},(_,index)=>{const hour=index*this.step;return [String(hour),hourRange(hour,hour+this.step)];}));
		this.hourSelect.value=String(Math.floor(previous/this.step)*this.step);
	}

	private paintHeatmap():void {
		const theme=this.theme(),days=this.snapshot!.days.map(day=>day.date),count=24/this.step;
		if(!this.heatmap){this.heatmap=echarts.init(this.heat.host,undefined,{renderer:"svg"});this.heatmap.on("click",event=>{
			const id=(event.data as {id?:string})?.id,bin=this.bins.find(item=>item.id===id);if(!bin)return;
			this.heatDateSelect.value=bin.date;this.hourSelect.value=String(bin.startHour);this.selectHour();});}
		const known=this.bins.filter(bin=>bin.known),unknown=this.bins.filter(bin=>!bin.known);
		const value=(bin:WeeklyReviewTimeBin)=>[bin.startHour/this.step,days.indexOf(bin.date),bin.seconds];
		const width=Math.max(8,(this.heat.host.clientWidth-60)/count-3),height=25;
		this.heatmap.setOption({...this.baseOption(),grid:{left:48,right:12,top:12,bottom:38},
			xAxis:{type:"category",data:Array.from({length:count},(_,i)=>String(i*this.step)),splitArea:{show:false},axisTick:{show:false},axisLine:{show:false},
				axisLabel:{color:theme.muted,interval:this.step===1?3:1,formatter:(value:string)=>`${value}时`}},
			yAxis:{type:"category",inverse:true,data:days,axisTick:{show:false},axisLine:{show:false},axisLabel:{color:theme.muted,formatter:(date:string)=>date.slice(5).replace("-","/")}},
			visualMap:{show:false,seriesIndex:[0],dimension:2,min:0,max:Math.max(1,...known.map(bin=>bin.seconds)),inRange:{color:[theme.border,"#c5d4ed","#849fc9","#546f9a"]}},
			tooltip:{...this.baseOption().tooltip as object,formatter:(event:unknown)=>{const id=(event as {data?:{id?:string}}).data?.id;const bin=this.bins.find(item=>item.id===id);return bin?this.binDescription(bin):"";}},
			series:[{type:"heatmap",data:known.map(bin=>({id:bin.id,value:value(bin),itemStyle:{opacity:this.binOpacity(bin)}})),itemStyle:{borderRadius:4,borderColor:theme.background,borderWidth:3},emphasis:{itemStyle:{borderColor:theme.text,borderWidth:2}}},
				{type:"scatter",symbol:"roundRect",symbolSize:[width,height],data:unknown.map(bin=>({id:bin.id,value:value(bin),
					itemStyle:{color:theme.background,borderColor:bin.future?theme.background:theme.border,borderWidth:1,opacity:this.binOpacity(bin)},label:{show:true,formatter:bin.future?"·":"—",color:theme.muted,fontFamily:theme.font,fontSize:11}}))}]},true);
	}

	private binOpacity(bin:WeeklyReviewTimeBin):number {return !this.hourRangeSelection||(bin.startHour>=this.hourRangeSelection.start&&bin.endHour<=this.hourRangeSelection.end)?1:.72;}

	private changeTrend():void {this.paintArea();this.selectTrend();}
	private selectTrend():void {this.leaveRange(true);this.selection="trend";this.paintHeatmap();this.describeTrend();this.describeHour();this.emitSelection();}
	private selectHour():void {this.leaveRange(false);this.selection="hour";this.paintHeatmap();this.describeHour();this.emitSelection();}

	private setRangeControls(active:boolean):void {
		const range=this.hourRangeSelection;
		this.heatDateSelect.hidden=active;this.hourSelect.hidden=active;this.rangeExit.hidden=!active;this.rangeExit.disabled=!active;this.rangeLabel.hidden=!active;
		if(active&&range){this.rangeLabel.dataset.timelineRange="week";this.rangeLabel.textContent=`整周 · ${hourRange(range.start,range.end)}`;}
		else {delete this.rangeLabel.dataset.timelineRange;this.rangeLabel.textContent="";}
	}

	private restoreRangeControls():void {
		const previous=this.rangeControlsState;
		if(previous){if(Array.from(this.heatDateSelect.options).some(option=>option.value===previous.date))this.heatDateSelect.value=previous.date;
			if(Array.from(this.hourSelect.options).some(option=>option.value===previous.hour))this.hourSelect.value=previous.hour;}
		this.rangeControlsState=undefined;this.setRangeControls(false);
	}

	private leaveRange(restore:boolean):void {
		if(this.selection!=="range"&&!this.hourRangeSelection)return;
		if(restore)this.restoreRangeControls();else {this.rangeControlsState=undefined;this.setRangeControls(false);}
		this.hourRangeSelection=undefined;
	}

	private exitRangeSelection():void {this.clearSelection();this.heatDateSelect.focus();}

	private describeTrend():void {
		const day=this.snapshot?.timeline?.days.find(item=>item.date===this.dateSelect.value);if(!day)return;
		const group=this.modeSelect.value==="groups"?this.groups.find(item=>item.id===this.groupSelect.value):undefined;
		const point=group?.points.find(item=>item.date===day.date);
		const amount=point?(point.seconds===null?"暂无可确认记录":detailDuration(point.seconds)):observedDuration(day);
		this.trend.detail.textContent=`${day.date} · ${group?.name||"全部记录"}　${amount}　${dayStatus(day)}`;
		if(group&&group.members.length>1)this.trend.detail.textContent+=`；包含：${group.members.map(member=>member.name).join("、")}`;
	}

	private describeHour():void {
		if(this.selection==="range"){const value=this.rangeSelection();if(value)this.heat.detail.textContent=`${value.label}　已记录 ${detailDuration(value.documents.reduce((sum,d)=>sum+d.seconds,0))}`;return;}
		const bin=this.selectedBin();if(bin)this.heat.detail.textContent=this.binDescription(bin).split("\n").join("　");
	}

	private binDescription(bin:WeeklyReviewTimeBin):string {
		const amount=bin.known?detailDuration(bin.seconds):bin.future?"未来时段":"暂无可确认记录",status=dayStatus(bin);
		return `${bin.date} ${hourRange(bin.startHour,bin.endHour)}\n${amount}${amount===status?"":` · ${status}`}`;
	}

	private selectedBin():WeeklyReviewTimeBin|undefined {return this.bins.find(bin=>bin.date===this.heatDateSelect.value&&bin.startHour===Number(this.hourSelect.value));}

	private emitSelection():void {
		if(this.selection==="range"){this.onSelect(this.rangeSelection());}
		else if(this.selection==="hour"){
			const bin=this.selectedBin();if(bin)this.onSelect({kind:"hour",id:bin.id,label:`${bin.date} ${hourRange(bin.startHour,bin.endHour)}`,activity:false,documents:bin.documents});
		}else if(this.selection==="trend"){
			const day=this.snapshot?.timeline?.days.find(item=>item.date===this.dateSelect.value);if(!day)return;
			const group=this.modeSelect.value==="groups"?this.groups.find(item=>item.id===this.groupSelect.value):undefined;
			this.onSelect({kind:"trend",id:`${day.date}/${group?.id||"all"}`,label:`${day.date} · ${group?.name||"全部记录"}`,activity:group?.activity||false,
				documents:group?.points.find(point=>point.date===day.date)?.documents||day.documents});
		}
	}

	private rangeSelection():WeeklyReviewChartSelection|undefined {
		const range=this.hourRangeSelection;if(!range||!this.snapshot)return;
		const values=new Map<string,number>();
		for(const bin of this.bins.filter(bin=>bin.startHour>=range.start&&bin.endHour<=range.end))for(const d of bin.documents)values.set(d.path,(values.get(d.path)||0)+d.seconds);
		return {kind:"hour",id:`range:${range.start}/${range.end}`,label:`${this.snapshot.weekStart}—${this.snapshot.weekEnd} · ${hourRange(range.start,range.end)}`,activity:false,
			documents:[...values].map(([path,seconds])=>({path,seconds}))};
	}

	private scheduleResize():void {
		if(this.disposed||this.frame!==undefined)return;
		this.frame=this.win.requestAnimationFrame(()=>{
			this.frame=undefined;if(!this.el.isConnected||this.el.clientWidth===0)return;
			const next=this.el.clientWidth<600?2:1,changed=next!==this.step;this.step=next;
			this.area?.resize();this.heatmap?.resize();
			if(this.snapshot?.timeline){this.updateBins();this.paintHeatmap();this.describeHour();if(changed&&this.selection==="hour")this.emitSelection();}
		});
	}

	private theme():Theme {
		const style=this.win.getComputedStyle(this.el),value=(key:string,fallback:string)=>style.getPropertyValue(key).trim()||fallback;
		return {text:value("--text-normal","#454b54"),muted:value("--text-muted","#858990"),border:value("--background-modifier-border","#dedede"),
			background:value("--background-primary","#fff"),font:style.fontFamily};
	}
}

function daysAt(snapshot:WeeklyReviewSnapshot|undefined,index:number):string {return snapshot?.timeline?.days[index]?.date||"";}
function latestDate(days:readonly WeeklyReviewDay[]):string {return [...days].reverse().find(day=>!day.future)?.date||days[0]?.date||"";}
function hourRange(start:number,end:number):string {return `${String(start).padStart(2,"0")}:00–${String(end).padStart(2,"0")}:00`;}
function dayStatus(day:{future:boolean;timezoneWarning:boolean;coverage:string;seconds:number}):string {
	if(day.timezoneWarning)return "时区覆盖无法确认";
	if(day.future)return day.seconds>0?"未来记录需核对":"未来时段";
	return ({TRACKED:"已覆盖",PARTIAL:"部分采集",UNTRACKED:"未采集",UNKNOWN:"覆盖无法确认"} as Record<string,string>)[day.coverage];
}
function observedDuration(day:WeeklyReviewDay):string {return day.seconds>0||(day.coverage==="TRACKED"&&!day.future&&!day.timezoneWarning)?detailDuration(day.seconds):"暂无可确认记录";}
