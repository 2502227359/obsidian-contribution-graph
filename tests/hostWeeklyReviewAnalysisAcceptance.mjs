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

const modal = "app.plugins.plugins['contribution-graph-local'].weeklyReviewModals.values().next().value";
const evidence={}; let initialized=false;
function fixture(base,query,mode){
 const now={"临床医学/内科/心/样例.md":3600,"临床医学/外科/样例.md":1800,"临床医学/计划.md":300,"其他/内科/外部.md":120,"activity://yolo-chat":900};
 const old={"临床医学/内科/心/样例.md":1200,"临床医学/外科/样例.md":2100,"临床医学/旧科/旧.md":600,"activity://yolo-chat":300};
 const root=query.root||"";
 const rows=data=>Object.entries(data).filter(([path])=>!root||path.startsWith(root+"/")).map(([path,seconds])=>({path,seconds}));
 const documents=mode==='empty'?[]:rows(now),previous=mode==='empty'?[]:rows(old);
 const days=(start,items)=>Array.from({length:7},(_,i)=>({date:`2026-11-${String(start+i).padStart(2,'0')}`,seconds:i?0:items.reduce((n,d)=>n+d.seconds,0),documents:i?[]:items,coverage:mode==='missing'?'PARTIAL':'TRACKED',future:false,timezoneWarning:false,scopeSignatures:['[]']}));
 const currentDays=days(9,documents),previousDays=days(2,previous);
 const total=documents.reduce((n,d)=>n+d.seconds,0),previousTotal=previous.reduce((n,d)=>n+d.seconds,0);
 return {...base,generatedAt:Date.now(),today:'2026-11-16',weekStart:'2026-11-09',weekEnd:'2026-11-15',isCurrentWeek:false,root,documents,totalSeconds:total,recordedDays:documents.length?1:0,days:currentDays,warnings:[],folderPaths:['临床医学','临床医学/内科','临床医学/外科','其他'],comparison:{fromDate:'2026-11-09',toDate:'2026-11-15',referenceFromDate:'2026-11-02',referenceToDate:'2026-11-08',currentSeconds:total,previousSeconds:previousTotal,currentDays,previousDays,state:mode==='monday'||mode==='empty'?'NO_COMPLETED_DAYS':mode==='missing'?'INCOMPLETE':'READY',deltaSeconds:mode==='ready'?total-previousTotal:undefined,percentage:mode==='ready'&&previousTotal?(total-previousTotal)/previousTotal*100:undefined}};
}
try {
 assert.ok((await evaluate("app.vault.adapter.basePath.replaceAll('\\\\','/')")).endsWith('/dist/time-acceptance/vault'),'仅限隔离库');
 await evaluate(`(()=>{const p=app.plugins.plugins['contribution-graph-local'];window.__analysisQA={query:p.activityService.getWeeklyReview,settings:JSON.stringify(p.activityService.getSettings()),font:document.body.style.getPropertyValue('--font-text'),dark:document.body.classList.contains('theme-dark'),light:document.body.classList.contains('theme-light'),mode:'ready'};for(const m of p.weeklyReviewModals.values())m.close();return true})()`);initialized=true;
 await evaluate("app.setting.close()");
 await evaluate("app.commands.executeCommandById('contribution-graph-local:weekly-review')");
 assert.ok(await evaluate("document.querySelector('.cg-weekly-sunburst')!==null"),'第一阶段必须提供旭日图');
 await evaluate(`(()=>{const s=app.plugins.plugins['contribution-graph-local'].activityService;s.getWeeklyReview=function(query={}){return (${fixture.toString()})(window.__analysisQA.query.call(this,query),query,window.__analysisQA.mode)};${modal}.refreshSnapshot();${modal}.charts.update(${modal}.snapshot,{groupingRoot:"临床医学",depth:1});document.body.style.setProperty('--font-text','霞鹜文楷等宽');return true})()`);await wait(650);
 const first=await evaluate(`(()=>{const m=${modal};window.__analysisQA.chart=m.charts.sunburst;return {total:m.snapshot.totalSeconds,tree:m.charts.analysis.tree.seconds,svg:m.rootEl.querySelectorAll('.cg-weekly-sunburst svg').length,points:m.rootEl.querySelectorAll('.cg-weekly-comparison svg').length,animation:m.charts.sunburst.getOption().animationDuration,font:m.charts.sunburst.getOption().textStyle.fontFamily}})()`);
 assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-analysis-back]')).display"),'none');assert.equal(first.svg,1);assert.equal(first.points,1);assert.equal(first.total,first.tree);assert.ok(first.font.includes('霞鹜文楷'));assert.equal(first.animation,520);
 await click('[data-analysis-node="notes"]');await wait(330);
 assert.ok(await evaluate(`${modal}.charts.focusId==='notes'`));
 await click('[data-analysis-node="folder:临床医学/内科"]');await wait(330);
 assert.ok(await evaluate(`${modal}.rootEl.querySelectorAll('[data-review-path]').length===1`));
 assert.ok(await evaluate(`${modal}.rootEl.querySelector('[data-review-path]').dataset.reviewPath.includes('/内科/')`));
 await click('[data-analysis-back]');await click('[data-review-action="clear-group"]');
 await click('[data-analysis-node="activity:yolo"]');
 assert.ok(await evaluate(`${modal}.rootEl.querySelectorAll('[data-review-path]').length===0&&${modal}.rootEl.querySelector('.cg-weekly-review-documents-section').textContent.includes('YOLO')`));
 await click('[data-review-action="clear-group"]');
 await click('[data-analysis-comparison="folder:临床医学/内科"][data-analysis-period="previous"]');
 assert.ok(await evaluate(`${modal}.comparisonPeriod==='previous'&&${modal}.rootEl.querySelector('.cg-weekly-review-document-duration').textContent.includes('20')`));
 await click('[data-review-action="comparison-current"]');
 assert.ok(await evaluate(`${modal}.rootEl.querySelector('.cg-weekly-review-document-duration').textContent.includes('1 小时')`));
 await click('[data-review-action="clear-group"]');
 await click('[data-review-field="root"]');await click('[data-review-root="临床医学"]');
 assert.ok(await evaluate(`${modal}.snapshot.documents.every(d=>d.path!=='activity://yolo-chat')`));
 await click('[data-review-field="root"]');await click('[data-review-root=""]');
 assert.ok(await evaluate(`${modal}.charts.sunburst===window.__analysisQA.chart`));
 await evaluate(`${modal}.charts.selectRow("已移除的动画节点","current")`);
 evidence.structureComparisonAndLinks=true;
 await evaluate(`window.__analysisQA.mode='missing';${modal}.refreshSnapshot();${modal}.charts.update(${modal}.snapshot,{groupingRoot:"临床医学",depth:1})`);await wait(320);
 const missing=await evaluate(`(()=>{const c=${modal}.charts;const row=c.analysis.comparison.rows.find(r=>r.path==='临床医学/旧科');return {known:row.currentKnown,point:c.points.getOption().series.find(s=>s.id==='current').data.some(d=>d.id===row.id),growth:c.analysis.comparison.percentage}})()`);
 assert.equal(missing.known,false);assert.equal(missing.point,false);assert.equal(missing.growth,undefined);
 await evaluate(`window.__analysisQA.mode='monday';${modal}.refreshSnapshot();${modal}.charts.update(${modal}.snapshot,{groupingRoot:"临床医学",depth:1})`);
 assert.ok(await evaluate(`${modal}.charts.analysis.comparison.rows.length===0&&${modal}.rootEl.querySelector('.cg-weekly-comparison').hidden`));
 await evaluate(`window.__analysisQA.mode='empty';${modal}.refreshSnapshot();${modal}.charts.update(${modal}.snapshot,{groupingRoot:"临床医学",depth:1})`);
 assert.ok(await evaluate(`${modal}.rootEl.querySelector('.cg-weekly-sunburst').hidden`));
 await evaluate(`window.__analysisQA.mode='ready';${modal}.refreshSnapshot();${modal}.charts.update(${modal}.snapshot,{groupingRoot:"临床医学",depth:1})`);await wait(550);
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await wait(70);
 assert.equal(await evaluate(`${modal}.charts.sunburst.getOption().animation`),false);
 evidence.unknownEmptyAndMotion=true;
 for(const [width,height,dark] of [[1200,850,true],[720,850,false],[320,760,false]]){
  await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await evaluate(`(()=>{document.body.classList.toggle('theme-dark',${dark});document.body.classList.toggle('theme-light',${!dark});const m=${modal};m.scrollEl.scrollTop=0;m.modalEl.focus()})()`);await wait(120);
  const layout=await evaluate(`(()=>{const m=${modal};return {overflow:m.rootEl.scrollWidth>m.rootEl.clientWidth+1||m.scrollEl.scrollWidth>m.scrollEl.clientWidth+1,font:getComputedStyle(m.rootEl).fontFamily,svgs:m.rootEl.querySelectorAll('.cg-weekly-analysis svg').length}})()`);
  assert.ok(!layout.overflow,`${width}px 横向溢出`);assert.ok(layout.font.includes('霞鹜文楷'));evidence['layout'+width]=layout;
  const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`dist/weekly-analysis-${width}.png`,Buffer.from(shot.data,'base64'));
 }
 await evaluate(`window.__analysisQA.closedCharts=${modal}.charts;${modal}.close()`);
 assert.ok(await evaluate("window.__analysisQA.closedCharts.sunburst.isDisposed()&&window.__analysisQA.closedCharts.points.isDisposed()"));
 assert.ok(await evaluate("JSON.stringify(app.plugins.plugins['contribution-graph-local'].activityService.getSettings())===window.__analysisQA.settings"));
 evidence.disposalAndSettings=true;evidence.passed=true;
 await writeFile('dist/weekly-analysis-host-evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{
 await call('Emulation.clearDeviceMetricsOverride').catch(()=>{});await call('Emulation.setEmulatedMedia',{features:[]}).catch(()=>{});
 if(initialized)await evaluate(`(()=>{const p=app.plugins.plugins['contribution-graph-local'],q=window.__analysisQA;if(!q)return;p.activityService.getWeeklyReview=q.query;for(const m of p.weeklyReviewModals.values())m.close();document.body.classList.toggle('theme-dark',q.dark);document.body.classList.toggle('theme-light',q.light);if(q.font)document.body.style.setProperty('--font-text',q.font);else document.body.style.removeProperty('--font-text');delete window.__analysisQA;return true})()`).catch(e=>console.error('验收恢复失败',e));socket.close();
}
