import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

// 仅在项目内隔离库运行；不导入统计、不改采集配置。
const endpoint = process.env.OBSIDIAN_TEST_CDP || "http://127.0.0.1:9231";
const target = (await (await fetch(`${endpoint}/json/list`)).json()).find(t => t.type === "page" && t.url.startsWith("app://"));
assert.ok(target, "隔离验收宿主必须已启动");
const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map();
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
socket.onmessage = event => {
	const response = JSON.parse(event.data), task = pending.get(response.id);
	if (!task) return;
	pending.delete(response.id);
	response.error ? task.reject(response.error) : task.resolve(response.result);
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
	const id = ++sequence; pending.set(id, {resolve, reject}); socket.send(JSON.stringify({id, method, params}));
});
async function evaluate(expression) {
	const result = await call("Runtime.evaluate", {expression, returnByValue: true, awaitPromise: true, userGesture: true});
	assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description);
	return result.result.value;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function click(selector) {
	const point = await evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0);if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
	assert.ok(point, `必须存在控件 ${selector}`);
	await call("Input.dispatchMouseEvent", {type: "mousePressed", ...point, button: "left", clickCount: 1});
	await call("Input.dispatchMouseEvent", {type: "mouseReleased", ...point, button: "left", clickCount: 1});
	await wait(90);
}
async function key(key, code = key) {
	const virtualKey = {Enter:13, Escape:27, ArrowDown:40, ArrowUp:38, ArrowRight:39, ArrowLeft:37, Home:36, End:35}[key] || 0;
	await call("Input.dispatchKeyEvent", {type:"keyDown", key, code, windowsVirtualKeyCode:virtualKey, text:key === "Enter" ? "\r" : undefined});
	await call("Input.dispatchKeyEvent", {type:"keyUp", key, code, windowsVirtualKeyCode:virtualKey});
	await wait(70);
}

const modal="app.plugins.plugins['contribution-graph-local'].weeklyReviewModals.values().next().value";
const evidence={};let initialized=false;
function fixture(base,root){
 const rows=items=>Object.entries(items).filter(([path])=>!root||path.startsWith(root+'/')).map(([path,seconds])=>({path,seconds}));
 const shift=i=>{const d=new Date('2026-10-26T12:00:00');d.setDate(d.getDate()+i);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
 const days=Array.from({length:28},(_,i)=>{
  const date=shift(i),items=i%7<3?rows({'临床医学/内科/甲.md':(i%3+1)*1000,'临床医学/外科/乙.md':700,'activity://yolo-chat':300}):[];
  if(i===24)items.push(...rows({'activity://yolo-chat':50}));
  return {date,seconds:items.reduce((n,d)=>n+d.seconds,0),documents:items,coverage:i%7===3?'UNTRACKED':i>=23?'PARTIAL':'TRACKED',future:i>23,timezoneWarning:false,scopeSignatures:[]};
 });
 const current=days.slice(-7),hours=current.flatMap(day=>Array.from({length:24},(_,hour)=>({date:day.date,hour,
  seconds:hour===9?day.seconds:0,documents:hour===9?day.documents:[],coverage:day.date==='2026-11-16'&&hour===0?'TRACKED':day.coverage,
  future:day.future||(day.date==='2026-11-18'&&hour>12),timezoneWarning:false})));
 const documents=current.flatMap(day=>day.documents),totalSeconds=current.reduce((sum,day)=>sum+day.seconds,0);
 return {...base,root,today:'2026-11-18',weekStart:'2026-11-16',weekEnd:'2026-11-22',isCurrentWeek:true,days:current,documents,totalSeconds,recordedDays:current.filter(d=>d.seconds>0).length,
  folderPaths:['临床医学','临床医学/内科','临床医学/外科'],timeline:{fromDate:days[0].date,toDate:days[27].date,days,hours}};
}
async function choose(key,value){
 await evaluate(`(()=>{const e=${modal}.rootEl.querySelector('[data-timeline-control="${key}"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);await wait(50);
}
async function clickHeat(x,y){
 const point=await evaluate(`(()=>{const c=${modal}.timelineCharts;c.heat.host.scrollIntoView({block:'center'});const r=c.heat.host.getBoundingClientRect(),p=c.heatmap.convertToPixel({seriesIndex:0},[${x},${y}]);return {x:r.left+p[0],y:r.top+p[1]}})()`);
 await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
 await call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});await wait(90);
}
try{
 assert.ok((await evaluate("app.vault.adapter.basePath.replaceAll('\\\\','/')")).endsWith('/dist/time-acceptance/vault'),'仅限隔离库');
 await evaluate(`(()=>{const p=app.plugins.plugins['contribution-graph-local'];window.__timelineQA={query:p.activityService.getWeeklyReview,settings:JSON.stringify(p.activityService.getSettings()),font:document.body.style.getPropertyValue('--font-text'),dark:document.body.classList.contains('theme-dark'),light:document.body.classList.contains('theme-light'),reads:0};for(const m of p.weeklyReviewModals.values())m.close();app.setting.close();return true})()`);initialized=true;
 const actual=await evaluate(`(()=>{const s=app.plugins.plugins['contribution-graph-local'].activityService,a=s.getWeeklyReview({},true),b=s.getWeeklyReview({root:'验收'},true),old=s.getWeeklyReview();return {days:a.timeline.days.length,hours:a.timeline.hours.length,total:a.totalSeconds,hourTotal:a.timeline.hours.reduce((n,h)=>n+h.seconds,0),filtered:b.totalSeconds,filteredHourTotal:b.timeline.hours.reduce((n,h)=>n+h.seconds,0),defaultHasTimeline:!!old.timeline}})()`);
 assert.equal(actual.days,28);assert.equal(actual.hours,168);assert.ok(Math.abs(actual.total-actual.hourTotal)<1e-6);assert.ok(Math.abs(actual.filtered-actual.filteredHourTotal)<1e-6);assert.equal(actual.defaultHasTimeline,false);evidence.realService=actual;
 await evaluate(`(()=>{const s=app.plugins.plugins['contribution-graph-local'].activityService;s.getWeeklyReview=function(query={},timeline){window.__timelineQA.reads++;return (${fixture.toString()})(window.__timelineQA.query.call(this,query,timeline),query.root||'')};document.body.style.setProperty('--font-text','霞鹜文楷等宽');app.commands.executeCommandById('contribution-graph-local:weekly-review');return true})()`);
 assert.ok(await evaluate(`${modal}.rootEl.querySelector('.cg-weekly-sunburst svg')!==null`));
 const reads=await evaluate('window.__timelineQA.reads');
 await click('[data-review-action="panel-timeline"]');await wait(600);
 assert.equal(await evaluate('window.__timelineQA.reads'),reads,'切换视图不重新读取或结算');
 const first=await evaluate(`(()=>{const c=${modal}.timelineCharts,o=c.area.getOption();window.__timelineQA.component=c;return {svgs:c.el.querySelectorAll('svg').length,length:o.series[0].data.length,gap:o.series[0].data[3],future:o.series[0].data[24],connect:o.series[0].connectNulls,smooth:o.series[0].smooth,font:o.textStyle.fontFamily,animation:o.animationDuration,bins:c.bins.length,total:c.bins.reduce((s,h)=>s+h.seconds,0),weekly:${modal}.snapshot.totalSeconds}})()`);
 assert.equal(first.svgs,2);assert.equal(first.length,28);assert.equal(first.gap,null);assert.equal(first.future,50);assert.equal(first.connect,false);assert.equal(first.smooth,false);assert.ok(first.font.includes('霞鹜文楷'));assert.equal(first.animation,520);assert.equal(first.total,first.weekly);evidence.charts=first;
 const areaPoint=await evaluate(`(()=>{const c=${modal}.timelineCharts;c.trend.host.scrollIntoView({block:'center'});const r=c.trend.host.getBoundingClientRect(),p=c.area.convertToPixel({seriesIndex:0},[21,2000]);return {x:r.left+p[0],y:r.top+p[1]}})()`);
 await call('Input.dispatchMouseEvent',{type:'mousePressed',...areaPoint,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...areaPoint,button:'left',clickCount:1});await wait(70);
 assert.ok(await evaluate(`${modal}.chartSelection?.kind==='trend'&&${modal}.chartSelection.label.includes('2026-11-16')`));
 await choose('trend-mode','groups');
 assert.ok(await evaluate(`${modal}.timelineCharts.area.getOption().series.some(s=>s.name.includes('YOLO'))`));
 await choose('trend-group','activity:yolo');await choose('trend-date','2026-11-16');
 assert.ok(await evaluate(`${modal}.chartSelection.kind==='trend'&&${modal}.chartSelection.activity&&${modal}.rootEl.querySelectorAll('[data-review-path]').length===0`));
 await choose('trend-group','all');await choose('trend-date','2026-11-16');
 assert.ok(await evaluate(`${modal}.rootEl.querySelectorAll('[data-review-path]').length===2`));
 await call('Emulation.setDeviceMetricsOverride',{width:1200,height:850,deviceScaleFactor:1,mobile:false});await wait(120);
 await clickHeat(9,0);
 assert.ok(await evaluate(`${modal}.chartSelection.kind==='hour'&&${modal}.timelineCharts.hourSelect.value==='9'&&${modal}.chartSelection.documents.reduce((s,d)=>s+d.seconds,0)===2000`));
 await clickHeat(5,2);
 assert.ok(await evaluate(`${modal}.rootEl.querySelectorAll('[data-review-path]').length===0&&${modal}.timelineCharts.heat.detail.textContent.includes('暂无可确认记录')`));
 await clickHeat(0,0);
 assert.ok(await evaluate(`${modal}.timelineCharts.heat.detail.textContent.includes('0秒')`));
 await choose('heat-date','2026-11-22');await choose('heat-hour','22');
 assert.ok(await evaluate(`${modal}.timelineCharts.heat.detail.textContent.includes('未来时段')`));
 evidence.nativeSelectionsAndChartClicks=true;
 await choose('trend-mode','total');
 for(const [width,height,dark] of [[1200,850,true],[720,850,false],[320,760,false]]){
  await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.body.classList.toggle('theme-dark',${dark});document.body.classList.toggle('theme-light',${!dark})`);await wait(150);
  const layout=await evaluate(`(()=>{const m=${modal},c=m.timelineCharts;return {overflow:m.scrollEl.scrollWidth>m.scrollEl.clientWidth+1,step:c.step,bins:c.bins.length,total:c.bins.reduce((s,h)=>s+h.seconds,0),font:c.area.getOption().textStyle.fontFamily,same:c===window.__timelineQA.component}})()`);
  assert.ok(!layout.overflow,`${width}像素溢出`);assert.ok(layout.font.includes('霞鹜文楷'));assert.ok(layout.same);assert.equal(layout.total,first.weekly);
  assert.equal(layout.step,width===320?2:1);assert.equal(layout.bins,width===320?84:168);evidence['layout'+width]=layout;
  for(const [name,selector] of [['area','[data-timeline-control="trend-mode"]'],['heat','[data-timeline-control="heat-date"]']]){
   await evaluate(`${modal}.rootEl.querySelector('${selector}').scrollIntoView({block:'start'})`);await wait(600);
   const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`dist/weekly-timeline-${name}-${width}.png`,Buffer.from(shot.data,'base64'));
  }
 }
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await wait(80);
 assert.ok(await evaluate(`!${modal}.timelineCharts.area.getOption().animation&&!${modal}.timelineCharts.heatmap.getOption().animation`));
 await evaluate(`${modal}.rootEl.querySelector('[data-review-action="panel-timeline"]').focus()`);await key('ArrowLeft');
 assert.ok(await evaluate(`${modal}.panel==='analysis'&&!${modal}.chartSelection`));await key('ArrowRight');
 assert.ok(await evaluate(`${modal}.panel==='timeline'&&${modal}.timelineCharts===window.__timelineQA.component`));
 await call('Emulation.clearDeviceMetricsOverride');await wait(100);
 await click('[data-review-field="root"]');await click('[data-review-root="临床医学"]');
 assert.ok(await evaluate(`${modal}.snapshot.timeline.hours.flatMap(h=>h.documents).every(d=>d.path!=='activity://yolo-chat')&&${modal}.timelineCharts.groups.every(g=>!g.activity)`));
 await evaluate(`${modal}.close()`);
 assert.ok(await evaluate("window.__timelineQA.component.area.isDisposed()&&window.__timelineQA.component.heatmap.isDisposed()&&window.__timelineQA.component.disposed"));
 assert.ok(await evaluate("JSON.stringify(app.plugins.plugins['contribution-graph-local'].activityService.getSettings())===window.__timelineQA.settings"));
 evidence.keyboardFilterMotionAndDisposal=true;evidence.passed=true;
 await writeFile('dist/weekly-timeline-host-evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{
 await call('Emulation.clearDeviceMetricsOverride').catch(()=>{});await call('Emulation.setEmulatedMedia',{features:[]}).catch(()=>{});
 if(initialized)await evaluate(`(()=>{const p=app.plugins.plugins['contribution-graph-local'],q=window.__timelineQA;if(!q)return;p.activityService.getWeeklyReview=q.query;for(const m of p.weeklyReviewModals.values())m.close();document.body.classList.toggle('theme-dark',q.dark);document.body.classList.toggle('theme-light',q.light);if(q.font)document.body.style.setProperty('--font-text',q.font);else document.body.style.removeProperty('--font-text');delete window.__timelineQA;return true})()`).catch(e=>console.error('验收恢复失败',e));socket.close();
}
