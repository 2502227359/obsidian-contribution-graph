import type { WeeklyReviewChanges, WeeklyReviewChangeGroup, WeeklyReviewChangeDocument, WeeklyReviewObservation, WeeklyReviewInsightAction } from "../time/weeklyReviewInsights";
import { detailDuration } from "./weeklyReviewChartStyle";

export function renderWeeklyObservations(parent:HTMLElement,items:readonly WeeklyReviewObservation[],onAction:(action:WeeklyReviewInsightAction)=>void):void {
	if(!items.length)return;
	const section=parent.createEl("section",{cls:"cg-review-observations",attr:{"aria-label":"本周观察"}});
	section.createEl("h3",{text:"本周观察"});
	for(const item of items){
		const button=section.createEl("button",{text:item.text,attr:{type:"button"}});button.dataset.reviewObservation=item.kind;
		button.onclick=()=>onAction(item.action);
	}
}

export function renderWeeklyChangeGroups(parent:HTMLElement,changes:WeeklyReviewChanges,render:(target:HTMLElement,group:WeeklyReviewChangeGroup)=>void):void {
	const section=parent.createDiv({cls:"cg-review-changes"});
	section.createEl("h4",{text:"变化分解"});
	if(!changes.canDescribeChange){
		section.createDiv({cls:"cg-review-change-hint",text:changes.state==="NO_COMPLETED_DAYS"?"本周尚无已结束日期":changes.state==="POLICY_CHANGED"?"采集口径有变化，仅并列已有记录":"记录不完整，仅并列已有记录"});
		renderChangeSet(section,changes.groups.slice().sort((a,b)=>Math.max(b.currentSeconds,b.previousSeconds)-Math.max(a.currentSeconds,a.previousSeconds)),render);
		return;
	}
	const delta=changes.deltaSeconds||0;
	section.createDiv({cls:"cg-review-change-total",text:`同期合计 ${signedDuration(delta)} · ${changes.groups.length} 个分组`});
	const columns=section.createDiv({cls:"cg-review-change-columns"});
	for(const [label,groups] of [["增加最多",changes.increases],["减少最多",changes.decreases]] as const){
		const column=columns.createDiv();column.createEl("h5",{text:label});
		if(groups.length)renderChangeSet(column,groups,render);else column.createDiv({cls:"cg-review-change-hint",text:"无此类变化"});
	}
	const unchanged=changes.groups.filter(group=>group.deltaSeconds===0);
	if(unchanged.length){const details=section.createEl("details");details.createEl("summary",{text:`无变化 ${unchanged.length} 组`});for(const group of unchanged)render(details,group);}
}

function renderChangeSet(parent:HTMLElement,groups:readonly WeeklyReviewChangeGroup[],render:(target:HTMLElement,group:WeeklyReviewChangeGroup)=>void):void {
	for(const group of groups.slice(0,3))render(parent,group);
	if(groups.length<=3)return;
	const details=parent.createEl("details");details.createEl("summary",{text:`其余 ${groups.length-3} 组`});
	for(const group of groups.slice(3))render(details,group);
}

export function renderWeeklyDocumentChanges(parent:HTMLElement,group:WeeklyReviewChangeGroup,select:(note:WeeklyReviewChangeDocument,period:"current"|"previous")=>void):void {
	if(group.activity)return;
	const section=parent.createDiv({cls:"cg-review-note-changes"});
	section.createEl("h4",{text:group.deltaSeconds===undefined?"两期笔记记录":"变化最大的笔记"});
	const render=(target:HTMLElement,note:WeeklyReviewChangeDocument)=>{
		const row=target.createDiv({cls:"cg-review-note-change"});row.createDiv({text:note.path,cls:"cg-review-change-path"});
		for(const period of ["current","previous"] as const){
			const known=period==="current"?note.currentKnown:note.previousKnown,seconds=period==="current"?note.currentSeconds:note.previousSeconds;
			const button=row.createEl("button",{text:`${period==="current"?"本期":"上期"} ${known?detailDuration(seconds):"记录不明"}`,attr:{type:"button"}});
			button.dataset.reviewChangeNote=note.path;button.dataset.reviewChangePeriod=period;button.disabled=!known;button.onclick=()=>select(note,period);
		}
		if(note.deltaSeconds!==undefined)row.createEl("small",{text:signedDuration(note.deltaSeconds)});
	};
	for(const note of group.documents.slice(0,5))render(section,note);
	if(group.documents.length>5){const details=section.createEl("details");details.createEl("summary",{text:`其余 ${group.documents.length-5} 篇`});for(const note of group.documents.slice(5))render(details,note);}
}

function signedDuration(seconds:number):string {return seconds===0?"无变化":`${seconds>0?"+":"−"}${detailDuration(Math.abs(seconds))}`;}
