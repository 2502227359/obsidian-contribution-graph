import { App, Modal, Notice, Scope, TFile } from "obsidian";
import type { EditActivityService } from "../activity/EditActivityService";
import { getActivityDateRange } from "../activity/dateRange";
import type { ActivityDateRangeConfig } from "../activity/dateRange";
import { ContributionGraphConfig } from "../types";
import type { ActivityTimelineViewOptions, ActivityTimelineViewState } from "../time/activityTimelineTypes";
import { normalizeTrackedFolders } from "../activity/folderScope";
import { queryTimeGraph } from "../time/timeGraphData";
import type { YamlGraphConfig } from "../processor/types";
import { HourlyGraphRender } from "../render/hourlyGraphRender";
import { ActivityTimelineView } from "./ActivityTimelineView";
import { toFormattedDate } from "../util/dateUtils";

const modals = new Map<Document, ActivityTimelineModal>();
export interface TimelineHourlySummary { el:HTMLElement; dispose():void; }

export function createActivityTimelineOptions(app:App,service:EditActivityService,config:ContributionGraphConfig,owner:Document=typeof activeDocument==="undefined"?document:activeDocument):ActivityTimelineViewOptions {
 const from=calendarDate(config.fromDate),to=calendarDate(config.toDate);
 const original=config as ContributionGraphConfig&ActivityDateRangeConfig;
 const rangeConfig:ActivityDateRangeConfig=original.dateRangeType
  ?{dateRangeType:original.dateRangeType,dateRangeValue:original.dateRangeValue,days:config.days,fromDate:from,toDate:to}
  :from&&to?{dateRangeType:"FIXED_DATE_RANGE",fromDate:from,toDate:to}:{days:config.days||30};
 const readRange=()=>{const value=getActivityDateRange(rangeConfig);return {fromDate:value.fromDate!,toDate:value.toDate!};};
 const range=readRange();
 const folders=normalizeTrackedFolders(config.activityFolders||[]);
 const options:ActivityTimelineViewOptions={
  service,title:config.title||"学习时间轴",fromDate:range.fromDate!,toDate:range.toDate!,folders,depth:config.timelineDepth||1,
  ...(rangeConfig.dateRangeType!=="FIXED_DATE_RANGE"?{getDateRange:readRange}:{}),
  groupingRoot:folders.length===1?folders[0]:folders.length>1?"":undefined,
  fileExists:path=>app.vault.getAbstractFileByPath(path) instanceof TFile,
  onOpenDocument:(path,event)=>{void openTimelineDocument(app,path,event);},
 };
 options.onExpand=state=>openActivityTimelineModal(app,options,state,owner);
 options.onHourly=(date,selectedFolders)=>openActivityTimelineModal(app,{...options,date,folders:selectedFolders},undefined,owner).showHourly(date,selectedFolders);
 return options;
}

function calendarDate(value:Date|string|undefined):string|undefined {
 return value instanceof Date?toFormattedDate(value):value?.slice(0,10);
}

async function openTimelineDocument(app:App,path:string,event:MouseEvent|KeyboardEvent):Promise<boolean> {
 if(!(app.vault.getAbstractFileByPath(path) instanceof TFile)){new Notice("文件已不存在");return false;}
 try{const modifier=event.ctrlKey||event.metaKey;await app.workspace.openLinkText(path,"",modifier);return !modifier;}
 catch(error){new Notice(`打开笔记失败：${String(error)}`);return false;}
}

export function openActivityTimelineModal(app:App,options:ActivityTimelineViewOptions,state?:ActivityTimelineViewState,owner:Document=typeof activeDocument==="undefined"?document:activeDocument):ActivityTimelineModal {
 const existing=modals.get(owner);
 if(existing){existing.replace(options,state);existing.focus();return existing;}
 const modal=new ActivityTimelineModal(app,options,()=>modals.delete(owner),state);
 modals.set(owner,modal);modal.open();return modal;
}

export function closeActivityTimelineModals(owner?:Document|Window):void {
 for(const [document,modal] of modals)if(!owner||document===owner||document.defaultView===owner)modal.close();
}

export function renderTimelineHourlySummary(container:HTMLElement,options:{app:App;service:EditActivityService;date:string;folders:readonly string[];onBack:()=>void}):TimelineHourlySummary {
 const el=container.createDiv({cls:"cg-activity-timeline-summary",attr:{"data-cg-time-control":"activity-timeline"}});
 const back=el.createEl("button",{text:"‹ 返回时间轴",attr:{type:"button"}});
 back.onclick=options.onBack;
 const target=el.createDiv();
 const config=new ContributionGraphConfig();
 Object.assign(config,{title:"小时汇总",graphType:"hourly",timeTracking:true,data:[],fromDate:options.date,toDate:options.date,
  activityFolders:[...options.folders],hourlyViewState:{date:options.date,view:"day"},showCellRuleIndicators:false});
 const query={graphType:"hourly",dateRangeType:"FIXED_DATE_RANGE",fromDate:options.date,toDate:options.date,dataSource:{type:"TIME_ACTIVITY",folders:[...options.folders]}} as YamlGraphConfig;
 config.hourlyData=queryTimeGraph(query,options.service,options.app,{dates:[options.date],historical:true}).hourlyData;
 new HourlyGraphRender().render(target,config);
 back.focus({preventScroll:true});
 return {el,dispose:()=>{el.querySelector<HTMLDialogElement>("dialog[open]")?.close();el.remove();}};
}

class ActivityTimelineModal extends Modal {
 private view?:ActivityTimelineView;
 private summary?:TimelineHourlySummary;
 private mount?:HTMLElement;
 private initialState?:ActivityTimelineViewState;
 private originalFocus:HTMLElement|null;
 private closed=false;

 constructor(app:App,private options:ActivityTimelineViewOptions,private readonly onClosed:()=>void,state?:ActivityTimelineViewState){
  super(app);this.initialState=state;
  this.originalFocus=this.modalEl.ownerDocument.activeElement as HTMLElement|null;
  this.scope=new Scope(this.scope);
  this.scope.register([],"Escape",()=>{if(this.summary)this.leaveHourly();else if(!this.view?.handleEscape())this.close();return false;});
 }

 onOpen():void {
  this.modalEl.addClass("cg-activity-timeline-modal");
  this.modalEl.setAttribute("aria-label","学习时间轴");
  this.mount=this.contentEl.createDiv({cls:"cg-activity-timeline-mount"});
  this.mountView();this.focus();
 }

 replace(options:ActivityTimelineViewOptions,state?:ActivityTimelineViewState):void {
  this.options=options;this.initialState=state;this.summary?.dispose();this.summary=undefined;
  this.view?.dispose();this.mount?.empty();this.mountView();
 }

 private mountView():void {
  if(!this.mount)return;
  this.view=new ActivityTimelineView(this.mount,{...this.options,initialState:this.initialState,onExpand:undefined,
   onHourly:(date,folders)=>this.showHourly(date,folders),
   onOpenDocument:(path,event)=>{void openTimelineDocument(this.app,path,event).then(close=>{if(close)this.close();});}});
 }

 showHourly(date:string,folders:readonly string[]):void {
  if(!this.mount||!this.view)return;
  this.summary?.dispose();this.view.el.hidden=true;
  this.summary=renderTimelineHourlySummary(this.mount,{app:this.app,service:this.options.service as EditActivityService,date,folders,onBack:()=>this.leaveHourly()});
 }

 private leaveHourly():void {
  this.summary?.dispose();this.summary=undefined;
  if(this.view){this.view.el.hidden=false;this.view.refresh();this.view.focus();}
 }

 focus():void {this.view?.focus();}

 onClose():void {
  if(this.closed)return;this.closed=true;
  this.summary?.dispose();this.view?.dispose();this.contentEl.empty();this.onClosed();
  if(this.originalFocus?.isConnected)this.originalFocus.focus({preventScroll:true});
 }
}
