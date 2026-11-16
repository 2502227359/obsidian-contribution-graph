import { describe, expect, it } from "vitest";
import { createEmptyTimeActivity } from "../src/time/timeData";
import { buildWeeklyReview } from "../src/time/weeklyReview";
import { buildWeeklyReviewTimeline, buildWeeklyTrendGroups, groupWeeklyReviewHours } from "../src/time/weeklyReviewTimeline";

const stamp=(date:string,hour=0)=>new Date(`${date}T${String(hour).padStart(2,"0")}:00:00`).getTime();
const now=stamp("2026-11-18",12)+30*60000;
function data(){const d=createEmptyTimeActivity();d.periods=[{start:stamp("2026-10-20"),end:now,folders:["医"]}];return d;}
function put(d:ReturnType<typeof data>,date:string,hour:number,documents:Record<string,number>,offset=-new Date(stamp(date,hour)).getTimezoneOffset()){
 d.buckets[`${date}/${hour}/${offset}`]={date,hour,offsetMinutes:offset,documents};
}

describe("周回顾趋势与时段的只读派生",()=>{
 it("最近四个自然周共28天，所选周与原快照一致，不修改原统计",()=>{
  const d=data();put(d,"2026-10-26",9,{"医/内/甲.md":30});put(d,"2026-11-16",10,{"医/内/甲.md":90});
  const before=JSON.stringify(d),weekly=buildWeeklyReview(d,{},now),timeline=buildWeeklyReviewTimeline(d,weekly,now);
  expect(timeline.fromDate).toBe("2026-10-26");expect(timeline.toDate).toBe("2026-11-22");expect(timeline.days).toHaveLength(28);
  expect(timeline.days.slice(-7)).toEqual(weekly.days);expect(JSON.stringify(d)).toBe(before);
 });
 it("168小时与周累计守恒，全部含YOLO而目录筛选排除它",()=>{
  const d=data();put(d,"2026-11-16",9,{"医/内/甲.md":10.25,"activity://yolo-chat":30});put(d,"2026-11-18",12,{"医/外/乙.md":15});
  for(const root of ["","医"]){const weekly=buildWeeklyReview(d,{root},now),timeline=buildWeeklyReviewTimeline(d,weekly,now);
   expect(timeline.hours).toHaveLength(168);expect(timeline.hours.reduce((sum,h)=>sum+h.seconds,0)).toBe(weekly.totalSeconds);
   if(root)expect(timeline.hours.flatMap(h=>h.documents).some(doc=>doc.path==="activity://yolo-chat")).toBe(false);
  }
 });
 it("已覆盖零、未采集、当前小时和未来小时有不同状态，不把未知补零",()=>{
  const d=data();d.periods=[{start:stamp("2026-11-16",9),end:stamp("2026-11-16",10),folders:["医"]}];
  const t=buildWeeklyReviewTimeline(d,buildWeeklyReview(d,{},now),now),bins=groupWeeklyReviewHours(t.hours,1);
  expect(bins.find(h=>h.date==="2026-11-16"&&h.startHour===9)).toMatchObject({seconds:0,known:true,coverage:"TRACKED"});
  expect(bins.find(h=>h.date==="2026-11-16"&&h.startHour===8)).toMatchObject({known:false,coverage:"UNTRACKED",future:false});
  expect(bins.find(h=>h.date==="2026-11-18"&&h.startHour===13)).toMatchObject({known:false,future:true});
  const current=groupWeeklyReviewHours(buildWeeklyReviewTimeline(data(),buildWeeklyReview(data(),{},now),now).hours,1).find(h=>h.date==="2026-11-18"&&h.startHour===12);
  expect(current).toMatchObject({known:false,coverage:"PARTIAL",future:false});
 });
 it("两小时合并为84格，保留多端超一小时值与同名笔记精度",()=>{
  const d=data();put(d,"2026-11-16",8,{"医/内/甲.md":3700.125});put(d,"2026-11-16",9,{"医/内/甲.md":3900.25,"activity://yolo-chat":20});
  const t=buildWeeklyReviewTimeline(d,buildWeeklyReview(d,{},now),now),bins=groupWeeklyReviewHours(t.hours,2);
  expect(bins).toHaveLength(84);expect(bins.reduce((sum,h)=>sum+h.seconds,0)).toBe(7620.375);
  expect(bins.find(h=>h.date==="2026-11-16"&&h.startHour===8)).toMatchObject({endHour:10,seconds:7620.375});
  expect(bins.find(h=>h.startHour===8&&h.date==="2026-11-16")?.documents).toContainEqual({path:"医/内/甲.md",seconds:7600.375});
 });
 it("时区异常保守降级，但保留已有正时长；超前记录也不被截断",()=>{
  const d=data();put(d,"2026-11-16",8,{"医/甲.md":40},0);put(d,"2026-11-20",8,{"医/甲.md":50});
  const t=buildWeeklyReviewTimeline(d,buildWeeklyReview(d,{},now),now),bins=groupWeeklyReviewHours(t.hours,1);
  expect(bins.find(h=>h.date==="2026-11-16"&&h.startHour===8)).toMatchObject({seconds:40,timezoneWarning:true,coverage:"UNKNOWN",known:true});
  expect(bins.find(h=>h.date==="2026-11-20"&&h.startHour===8)).toMatchObject({seconds:50,future:true,coverage:"UNKNOWN",known:true});
 });
 it("趋势分组、YOLO及可追溯的其余分组合计守恒，缺口保留null",()=>{
  const d=data();d.periods=[];put(d,"2026-11-16",9,{"医/内/甲.md":1,"医/外/甲.md":2,"医/妇/甲.md":3,"医/儿/甲.md":4,"医/五官/甲.md":5,"医/皮肤/甲.md":6,"activity://yolo-chat":7});
  const t=buildWeeklyReviewTimeline(d,buildWeeklyReview(d,{},now),now),groups=buildWeeklyTrendGroups(t,{groupingRoot:"医",depth:1},5);
  expect(groups.length).toBeLessThanOrEqual(5);expect(groups.some(g=>g.activity)).toBe(true);expect(groups.find(g=>g.id==="trend:other")?.members.length).toBeGreaterThan(1);
  const index=t.days.findIndex(day=>day.date==="2026-11-16"),missing=t.days.findIndex(day=>day.date==="2026-11-15");
  expect(groups.reduce((sum,g)=>sum+(g.points[index].seconds||0),0)).toBe(28);
  expect(groups.every(g=>g.points[missing].seconds===null)).toBe(true);
  expect(groups.flatMap(g=>g.points[index].documents).reduce((sum,doc)=>sum+doc.seconds,0)).toBe(28);
 });
});
