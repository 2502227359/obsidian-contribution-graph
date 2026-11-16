import { buildWeeklyReview, shiftReviewDate } from "./weeklyReview";
import { getTimeTrackingState, queryTimeStats } from "./timeData";
import { getWeeklyReviewPathGroup } from "./weeklyReviewAnalysis";
import type { StoredTimeActivity, TimeDocumentStats, TimeStats } from "./types";
import type { WeeklyReviewCoverage, WeeklyReviewDay, WeeklyReviewHour, WeeklyReviewSnapshot, WeeklyReviewTimeline } from "./weeklyReviewTypes";
import { parseDate } from "../util/dateUtils";

export interface WeeklyReviewTimeBin extends Omit<WeeklyReviewHour,"hour"> {
	id: string;
	startHour: number;
	endHour: number;
	known: boolean;
}
export interface WeeklyTrendPoint { date:string; seconds:number|null; documents:readonly TimeDocumentStats[]; }
export interface WeeklyTrendGroup {
	id:string;
	name:string;
	activity:boolean;
	members:readonly {id:string;name:string}[];
	points:readonly WeeklyTrendPoint[];
}
interface DayGroup {id:string;name:string;activity:boolean;seconds:number;documents:TimeDocumentStats[];}

/** 同一份统计、同一生成时间派生四周及小时数据，不结算或写入。 */
export function buildWeeklyReviewTimeline(data:StoredTimeActivity, weekly:WeeklyReviewSnapshot, now:number):WeeklyReviewTimeline {
	const fromDate=shiftReviewDate(weekly.weekStart,-21);
	const days=Array.from({length:4},(_,index)=>index===3?weekly.days:buildWeeklyReview(data,{date:shiftReviewDate(fromDate,index*7),root:weekly.root},now).days).flat();
	const rows=queryTimeStats(data,{fromDate:weekly.weekStart,toDate:weekly.weekEnd,folders:weekly.root?[weekly.root]:[]},now,true);
	const index=new Map(rows.map(row=>[`${row.date}/${row.hour}`,row]));
	const hours=weekly.days.flatMap(day=>Array.from({length:24},(_,hour)=>makeHour(data,day,hour,index.get(`${day.date}/${hour}`),{now,root:weekly.root})));
	return {fromDate,toDate:weekly.weekEnd,days,hours};
}

function makeHour(data:StoredTimeActivity,day:WeeklyReviewDay,hour:number,row:TimeStats|undefined,context:{now:number;root:string}):WeeklyReviewHour {
	const start=parseDate(day.date);start.setHours(hour);
	const end=parseDate(day.date);end.setHours(hour+1);
	const timezoneWarning=day.timezoneWarning||start.getHours()!==hour||start.getTimezoneOffset()!==end.getTimezoneOffset();
	const seconds=row?.seconds||0;
	const future=row?.future??start.getTime()>context.now;
	const coverage=row?.trackingState||getTimeTrackingState(data,start.getTime(),end.getTime(),context.root?[context.root]:[],context.now);
	return {date:day.date,hour,seconds,documents:(row?.documents||[]).map(document=>({...document})),future,timezoneWarning,
		coverage:timezoneWarning||(seconds>0&&future)?"UNKNOWN":coverage};
}

export function groupWeeklyReviewHours(hours:readonly WeeklyReviewHour[],step:1|2):WeeklyReviewTimeBin[] {
	const groups=new Map<string,WeeklyReviewHour[]>();
	for(const hour of hours){const key=`${hour.date}/${Math.floor(hour.hour/step)*step}`;const list=groups.get(key)||[];list.push(hour);groups.set(key,list);}
	return [...groups.values()].map(parts=>{
		const documents=mergeDocuments(parts.map(hour=>hour.documents));
		const coverage=combinedCoverage(parts.map(hour=>hour.coverage));
		const seconds=documents.reduce((sum,document)=>sum+document.seconds,0);
		const startHour=Math.floor(parts[0].hour/step)*step;
		return {id:`${parts[0].date}/${startHour}/${step}`,date:parts[0].date,startHour,endHour:startHour+step,seconds,documents,coverage,
			future:parts.every(hour=>hour.future),timezoneWarning:parts.some(hour=>hour.timezoneWarning),
			known:seconds>0||(coverage==="TRACKED"&&parts.every(hour=>!hour.future&&!hour.timezoneWarning))};
	});
}

function combinedCoverage(values:readonly WeeklyReviewCoverage[]):WeeklyReviewCoverage {
	if(values.includes("UNKNOWN"))return "UNKNOWN";
	if(values.every(value=>value==="TRACKED"))return "TRACKED";
	if(values.every(value=>value==="UNTRACKED"))return "UNTRACKED";
	return "PARTIAL";
}

export function buildWeeklyTrendGroups(timeline:WeeklyReviewTimeline,options:{groupingRoot:string;depth:1|2},limit=6):WeeklyTrendGroup[] {
	const days=timeline.days.map(day=>groupDay(day,options));
	const totals=new Map<string,DayGroup>();
	for(const day of days)for(const group of day.values()){
		const previous=totals.get(group.id);totals.set(group.id,{...group,seconds:group.seconds+(previous?.seconds||0),documents:[]});
	}
	const ordered=[...totals.values()].sort((a,b)=>b.seconds-a.seconds||a.id.localeCompare(b.id));
	const groups=chooseTrendGroups(ordered,limit);
	return groups.map(group=>({...group,points:timeline.days.map((day,index)=>trendPoint(day,days[index],group.members))}));
}

function groupDay(day:WeeklyReviewDay,options:{groupingRoot:string;depth:1|2}):Map<string,DayGroup> {
	const groups=new Map<string,DayGroup>();
	for(const document of day.documents){
		const descriptor=getWeeklyReviewPathGroup(document.path,options.groupingRoot,options.depth);
		const value=groups.get(descriptor.id)||{...descriptor,seconds:0,documents:[]};
		value.seconds+=document.seconds;value.documents.push({...document});groups.set(value.id,value);
	}
	return groups;
}

function chooseTrendGroups(ordered:DayGroup[],limit:number):Omit<WeeklyTrendGroup,"points">[] {
	const keep=ordered.length<=limit?ordered:ordered.filter(group=>!group.activity).slice(0,limit-1-(ordered.some(group=>group.activity)?1:0));
	if(ordered.length>limit){const activity=ordered.find(group=>group.activity);if(activity)keep.push(activity);}
	const groups=keep.map(group=>({id:group.id,name:group.name,activity:group.activity,members:[{id:group.id,name:group.name}]}));
	const other=ordered.filter(group=>!keep.includes(group));
	if(other.length)groups.push({id:"trend:other",name:`其他 ${other.length} 组`,activity:false,members:other.map(group=>({id:group.id,name:group.name}))});
	return groups;
}

function trendPoint(day:WeeklyReviewDay,groups:Map<string,DayGroup>,members:readonly {id:string}[]):WeeklyTrendPoint {
	const documents=mergeDocuments(members.map(member=>groups.get(member.id)?.documents||[]));
	const seconds=documents.reduce((sum,document)=>sum+document.seconds,0);
	return {date:day.date,seconds:seconds>0||(day.coverage==="TRACKED"&&!day.future&&!day.timezoneWarning)?seconds:null,documents};
}

function mergeDocuments(parts:readonly (readonly TimeDocumentStats[])[]):TimeDocumentStats[] {
	const values=new Map<string,number>();
	for(const part of parts)for(const document of part)values.set(document.path,(values.get(document.path)||0)+document.seconds);
	return [...values].map(([path,seconds])=>({path,seconds})).sort((a,b)=>b.seconds-a.seconds||a.path.localeCompare(b.path));
}
