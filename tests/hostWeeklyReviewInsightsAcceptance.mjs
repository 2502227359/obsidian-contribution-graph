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
async function assertChartName(selector,name){
	const {root}=await call('DOM.getDocument');
	const {nodeId}=await call('DOM.querySelector',{nodeId:root.nodeId,selector});
	assert.ok(nodeId,selector);
	const {nodes}=await call('Accessibility.getPartialAXTree',{nodeId,fetchRelatives:false});
	assert.equal(nodes[0].name?.value,name,'图表保留简洁无障碍名称');
}
function fixture(base,root,mode){
	const stamp=index=>{const d=new Date('2026-10-26T12:00:00');d.setDate(d.getDate()+index);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
	const days=Array.from({length:28},(_,index)=>{
		const week=Math.floor(index/7),date=stamp(index),source=index%7===0?{'临床医学/内科/甲.md':(week+1)*600,'临床医学/外科/乙.md':(4-week)*300,'activity://yolo-chat':300}:index===23?{'临床医学/内科/甲.md':100}:{};
		const documents=Object.entries(source).filter(([path])=>!root||path.startsWith(root+'/')).map(([path,seconds])=>({path,seconds}));
		return {date,seconds:documents.reduce((s,d)=>s+d.seconds,0),documents,coverage:(mode==='missing'&&index>=21)||index===23?'PARTIAL':'TRACKED',future:index>23,timezoneWarning:false,scopeSignatures:['[]']};
	});
	const current=days.slice(-7),count=mode==='monday'?0:2,previous=days.slice(14,14+count),closed=current.slice(0,count);
	const state=mode==='monday'?'NO_COMPLETED_DAYS':mode==='missing'?'INCOMPLETE':mode==='policy'?'POLICY_CHANGED':'READY';
	const hours=current.flatMap(day=>Array.from({length:24},(_,hour)=>{const documents=day.documents.filter(d=>hour===(d.path.includes('/外科/')?9:18));return {date:day.date,hour,documents,seconds:documents.reduce((s,d)=>s+d.seconds,0),coverage:day.coverage,future:day.future,timezoneWarning:false};}));
	const sum=items=>items.reduce((s,d)=>s+d.seconds,0),currentSeconds=sum(closed),previousSeconds=sum(previous),totals=new Map();for(const day of current)for(const doc of day.documents)totals.set(doc.path,(totals.get(doc.path)||0)+doc.seconds);const documents=[...totals].map(([path,seconds])=>({path,seconds}));
	const windows=Array.from({length:4},(_,i)=>({fromDate:days[i*7].date,toDate:count?days[i*7+count-1].date:undefined,days:days.slice(i*7,i*7+count),previousState:i===3?state:'READY'}));
	return {...base,root,today:mode==='monday'?'2026-11-16':'2026-11-18',weekStart:'2026-11-16',weekEnd:'2026-11-22',isCurrentWeek:true,days:current,documents,totalSeconds:sum(current),recordedDays:current.filter(d=>d.seconds>0).length,
		folderPaths:['临床医学','临床医学/内科','临床医学/外科'],warnings:[],comparison:{fromDate:'2026-11-16',toDate:count?'2026-11-17':undefined,referenceFromDate:'2026-11-09',referenceToDate:count?'2026-11-10':undefined,currentDays:closed,previousDays:previous,currentSeconds,previousSeconds,state,deltaSeconds:state==='READY'?currentSeconds-previousSeconds:undefined},
		timeline:{fromDate:days[0].date,toDate:days[27].date,days,hours,windows}};
}

try{
	assert.ok((await evaluate("app.vault.adapter.basePath.replaceAll('\\\\','/')")).endsWith('/dist/time-acceptance/vault'),'仅限隔离库');
	await evaluate(`(()=>{const p=app.plugins.plugins['contribution-graph-local'];window.__insightsQA={query:p.activityService.getWeeklyReview,settings:JSON.stringify(p.activityService.getSettings()),font:document.body.style.getPropertyValue('--font-text'),dark:document.body.classList.contains('theme-dark'),light:document.body.classList.contains('theme-light'),reads:0,mode:'ready',base:p.activityService.getWeeklyReview({},true)};for(const m of p.weeklyReviewModals.values())m.close();app.setting.close();return true})()`);initialized=true;
	await evaluate(`(()=>{const s=app.plugins.plugins['contribution-graph-local'].activityService;s.getWeeklyReview=function(query={}){window.__insightsQA.reads++;return (${fixture.toString()})(window.__insightsQA.base,query.root||'',window.__insightsQA.mode)};document.body.style.setProperty('--font-text','霞鹜文楷等宽');app.commands.executeCommandById('contribution-graph-local:weekly-review');const m=app.plugins.plugins['contribution-graph-local'].weeklyReviewModals.values().next().value;m.service={getWeeklyReview:(...args)=>s.getWeeklyReview(...args),getSettings:()=>({...s.getSettings(),trackedFolders:['临床医学']})};m.refreshSnapshot();return true})()`);await wait(600);
	assert.equal(await evaluate(`${modal}.rootEl.querySelectorAll('[data-review-observation]').length`),2);
	assert.ok(await evaluate(`${modal}.rootEl.querySelector('[data-review-field="depth"]').closest('.cg-weekly-review-options')!==null`),'分组层级收纳到显示菜单且仍可用');
	await assertChartName('.cg-weekly-sunburst','投入结构');await assertChartName('.cg-weekly-comparison','同期对比');
	await call('Emulation.setDeviceMetricsOverride',{width:1200,height:850,deviceScaleFactor:1,mobile:false});
	await evaluate(`${modal}.scrollEl.scrollTop=0`);await wait(600);
	assert.ok(await evaluate(`(()=>{const m=${modal};return m.rootEl.querySelector('.cg-weekly-sunburst').getBoundingClientRect().bottom<=m.scrollEl.getBoundingClientRect().bottom+1})()`),'桌面首屏展示完整核心图');
	const beforeDepth=await evaluate(`({total:${modal}.snapshot.totalSeconds,reads:window.__insightsQA.reads})`);
	for(const depth of ['2','1'])await evaluate(`(()=>{const e=${modal}.rootEl.querySelector('[data-review-field="depth"]');e.value='${depth}';e.dispatchEvent(new Event('change'));return true})()`);
	assert.ok(await evaluate(`${modal}.snapshot.totalSeconds===${beforeDepth.total}&&window.__insightsQA.reads===${beforeDepth.reads}`),'分组切换不改累计或重读统计');
	await writeFile('dist/weekly-insights-overview-1200.png',Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
	const reads=await evaluate('window.__insightsQA.reads');
	await click('[data-review-observation="structure"]');
	assert.ok(await evaluate(`${modal}.chartSelection.kind==='structure'&&${modal}.chartSelection.label.includes('内科')&&${modal}.rootEl.querySelector('[data-review-action="clear-group"]').textContent.includes('2026-11-16')`));
	await click('[data-review-observation="comparison"]');
	assert.ok(await evaluate(`${modal}.chartSelection.kind==='comparison'&&${modal}.insights.changes.deltaSeconds===300`));
	assert.ok(await evaluate(`${modal}.rootEl.querySelector('.cg-review-note-changes').textContent.includes('变化最大的笔记')`));
	assert.equal(await evaluate(`${modal}.rootEl.querySelector('.cg-weekly-review-documents-section .cg-weekly-review-documents')!==null`),false,'比较分组不重复渲染普通笔记列表');
	await evaluate(`${modal}.rootEl.querySelector('.cg-weekly-comparison').scrollIntoView({block:'start'})`);await wait(600);
	await writeFile('dist/weekly-insights-changes-1200.png',Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
	await click('[data-review-change-note="临床医学/内科/甲.md"][data-review-change-period="previous"]');
	assert.ok(await evaluate(`${modal}.comparisonPeriod==='previous'&&${modal}.rootEl.querySelector('[data-review-note-amount="previous"]').textContent.includes('30')&&${modal}.rootEl.querySelector('[data-review-action="clear-group"]').textContent.includes('2026-11-09')`));
	assert.ok(await evaluate(`document.activeElement.dataset.reviewAction==='comparison-previous'&&!!${modal}.rootEl.querySelector('[data-review-action="back-to-group"]')`),'单篇下钻保留期别焦点并可返回');
	await click('[data-review-action="comparison-current"]');
	assert.ok(await evaluate(`${modal}.rootEl.querySelector('[data-review-note-amount="current"]').textContent.includes('40')`));
	await click('[data-review-action="back-to-group"]');
	assert.ok(await evaluate(`!${modal}.comparisonNotePath&&document.activeElement.dataset.reviewChangeNote==='临床医学/内科/甲.md'`));
	await evaluate(`(()=>{const m=${modal},g=m.insights.changes.groups.find(g=>g.id===m.chartSelection.id),note=g.documents[0];g.documents=Array.from({length:6},(_,i)=>({...note,path:'临床医学/内科/折叠笔记'+i+'.md',previousKnown:false}));m.refreshDocuments();return true})()`);
	await click('.cg-review-note-changes summary');
	await click('[data-review-change-note="临床医学/内科/折叠笔记5.md"][data-review-change-period="current"]');
	await click('[data-review-action="comparison-previous"]');
	await click('[data-review-action="back-to-group"]');
	assert.ok(await evaluate(`document.activeElement.dataset.reviewChangeNote==='临床医学/内科/折叠笔记5.md'&&document.activeElement.dataset.reviewChangePeriod==='current'&&document.activeElement.closest('details').open`),'返回折叠区笔记时展开列表，并避开不可用期别');
	await evaluate(`window.__insightsQA.mode='missing';${modal}.refreshSnapshot()`);
	assert.equal(await evaluate(`${modal}.rootEl.querySelector('[data-review-observation="comparison"]')!==null`),false,'限制提示留在比较区');
	await click('[data-review-observation="hour"]');
	assert.ok(await evaluate(`${modal}.panel==='timeline'&&${modal}.chartSelection.kind==='hour'&&${modal}.chartSelection.documents.reduce((s,d)=>s+d.seconds,0)===2800`));
	assert.ok(await evaluate(`${modal}.timelineCharts.heatmap.getOption().series[0].data.some(d=>d.itemStyle.opacity<1)`));
	assert.ok(await evaluate(`${modal}.timelineCharts.heatDateSelect.hidden&&${modal}.timelineCharts.hourSelect.hidden&&${modal}.rootEl.querySelector('[data-timeline-range]').textContent.includes('整周')`));
	await click('[data-timeline-control="exit-range"]');
	assert.ok(await evaluate(`!${modal}.timelineCharts.heatDateSelect.hidden&&!${modal}.timelineCharts.hourSelect.hidden&&document.activeElement.dataset.timelineControl==='heat-date'`));
	await click('[data-review-observation="hour"]');
	await assertChartName('.cg-weekly-timeline .cg-timeline-chart','四周趋势');
	await assertChartName('.cg-weekly-timeline .cg-timeline-section:nth-child(2) .cg-timeline-chart','一周时段');
	const hover=await evaluate(`(()=>{const c=${modal}.timelineCharts;c.heat.host.scrollIntoView({block:'center'});const r=c.heat.host.getBoundingClientRect(),p=c.heatmap.convertToPixel({seriesIndex:0},[18,0]);return {x:r.left+p[0],y:r.top+p[1]}})()`);
	await call('Input.dispatchMouseEvent',{type:'mouseMoved',...hover});await wait(800);
	assert.ok(await evaluate(`${modal}.timelineCharts.heat.host.textContent.includes('2026-11-16 18:00–19:00')`),'保留日期及小时明细提示');
	assert.equal(await evaluate(`document.querySelectorAll('.tooltip').length`),0,'图表悬浮不再出现第二层宿主提示');
	await writeFile('dist/weekly-review-simple-tooltip.png',Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
	await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});evidence.simpleTooltipAndAccessibleNames=true;
	await evaluate(`(()=>{const c=${modal}.timelineCharts;c.modeSelect.value='groups';c.modeSelect.dispatchEvent(new Event('change'));return true})()`);
	assert.ok(await evaluate(`(()=>{const c=${modal}.timelineCharts;return c.area.getOption().yAxis[0].max>=Math.max(...${modal}.snapshot.timeline.days.map(d=>d.seconds))})()`),'面积构成轴覆盖每日叠加总量');
	await evaluate(`(()=>{const c=${modal}.timelineCharts;c.groupSelect.value='activity:yolo';c.groupSelect.dispatchEvent(new Event('change'));c.trend.host.scrollIntoView({block:'center'});return true})()`);await wait(600);
	const area=await evaluate(`(()=>{const c=${modal}.timelineCharts,r=c.trend.host.getBoundingClientRect(),p=c.area.convertToPixel({seriesIndex:0},[21,300]);return {x:r.left+p[0],y:r.top+p[1]}})()`);
	await call('Input.dispatchMouseEvent',{type:'mousePressed',...area,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...area,button:'left',clickCount:1});await wait(80);
	assert.ok(await evaluate(`${modal}.chartSelection.kind==='trend'&&${modal}.chartSelection.activity&&${modal}.chartSelection.label.includes('2026-11-16')`));
	await click('[data-review-action="panel-analysis"]');
	assert.ok(await evaluate(`!${modal}.chartSelection&&!${modal}.timelineCharts.hourRangeSelection`));
	await evaluate(`window.__insightsQA.mode='ready';${modal}.refreshSnapshot()`);
	await click('[data-review-action="compare-view-ranking"]');await wait(600);
	const ranking=await evaluate(`(()=>{const m=${modal},c=m.rankingChart;window.__insightsQA.chart=c.chart;return {svg:c.el.querySelectorAll('svg').length,font:c.chart.getOption().textStyle.fontFamily,lines:c.chart.getOption().series.filter(s=>s.type==='line').length,windows:c.model.windows.map(w=>[w.fromDate,w.toDate]),animation:c.chart.getOption().animationDuration}})()`);
	assert.equal(ranking.svg,1);assert.ok(ranking.font.includes('霞鹜文楷'));assert.ok(ranking.lines>0);assert.equal(ranking.animation,520);evidence.ranking=ranking;
	await assertChartName('.cg-review-ranking-chart','四周排名');
	const point=await evaluate(`(()=>{const c=${modal}.rankingChart;c.host.scrollIntoView({block:'center'});const o=c.chart.getOption(),index=o.series.findIndex(s=>s.id==='dots-activity:yolo'),r=c.host.getBoundingClientRect(),p=c.chart.convertToPixel({seriesIndex:index},[3,c.model.groups.find(g=>g.activity).points[3].rank]);return {x:r.left+p[0],y:r.top+p[1]}})()`);
	await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});await wait(80);
	assert.ok(await evaluate(`${modal}.chartSelection?.kind==='ranking'&&${modal}.chartSelection.activity&&${modal}.rootEl.querySelectorAll('[data-review-path]').length===0`));
	assert.equal(await evaluate('window.__insightsQA.reads'),reads+2,'仅两次主动刷新读取，观察和图表切换不重读统计');
	evidence.observationsChangesAndLinks=true;
	for(const [width,height,dark] of [[1200,850,true],[720,850,false],[320,760,false]]){
		await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
		await evaluate(`document.body.classList.toggle('theme-dark',${dark});document.body.classList.toggle('theme-light',${!dark});${modal}.rankingChart.host.scrollIntoView({block:'center'})`);await wait(650);
		const layout=await evaluate(`(()=>{const m=${modal};return {overflow:m.scrollEl.scrollWidth>m.scrollEl.clientWidth+1,font:getComputedStyle(m.rankingChart.el).fontFamily,same:m.rankingChart.chart===window.__insightsQA.chart}})()`);
		assert.ok(!layout.overflow,`${width}px 横向溢出`);assert.ok(layout.font.includes('霞鹜文楷'));assert.ok(layout.same);evidence['layout'+width]=layout;
		const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`dist/weekly-insights-ranking-${width}.png`,Buffer.from(shot.data,'base64'));
		if(width===320){
			await click('[data-review-action="compare-view-comparison"]');await evaluate(`${modal}.charts.revealComparison('folder:临床医学/内科');${modal}.rootEl.querySelector('.cg-review-note-changes').scrollIntoView({block:'start'})`);await wait(600);
			assert.ok(await evaluate(`${modal}.scrollEl.scrollWidth<=${modal}.scrollEl.clientWidth+1`));
			await writeFile('dist/weekly-insights-changes-320.png',Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
			await click('[data-review-action="compare-view-ranking"]');
		}
	}
	await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await wait(80);
	assert.equal(await evaluate(`${modal}.rankingChart.chart.getOption().animation`),false);
	await evaluate(`window.__insightsQA.mode='missing';${modal}.refreshSnapshot()`);
	assert.ok(await evaluate(`${modal}.insights.changes.groups.every(g=>g.deltaSeconds===undefined)&&${modal}.rankingChart.chart.getOption().series.every(s=>s.type!=='line'||s.data.every(d=>d.value[0]<3))`));
	assert.ok(await evaluate(`${modal}.rankingChart.chart.getOption().series.filter(s=>s.type==='scatter').some(s=>s.data[3].itemStyle.borderWidth===2)`));
	await evaluate(`window.__insightsQA.mode='policy';${modal}.refreshSnapshot()`);
	assert.ok(await evaluate(`${modal}.insights.changes.state==='POLICY_CHANGED'&&${modal}.insights.ranking.groups.every(g=>!g.points[3].connectPrevious)`));
	await evaluate(`window.__insightsQA.mode='monday';${modal}.refreshSnapshot()`);
	assert.ok(await evaluate(`${modal}.insights.ranking.groups.length===0&&${modal}.rankingChart.host.hidden`));
	await evaluate(`window.__insightsQA.mode='ready';${modal}.refreshSnapshot()`);await call('Emulation.clearDeviceMetricsOverride');await wait(100);
	await click('[data-review-field="root"]');await click('[data-review-root="临床医学"]');
	assert.ok(await evaluate(`${modal}.insights.ranking.groups.every(g=>!g.activity)&&${modal}.snapshot.documents.every(d=>d.path!=='activity://yolo-chat')`));
	await evaluate(`window.__insightsQA.closed=${modal}.rankingChart.chart;${modal}.close()`);
	assert.ok(await evaluate("window.__insightsQA.closed.isDisposed()&&JSON.stringify(app.plugins.plugins['contribution-graph-local'].activityService.getSettings())===window.__insightsQA.settings"));
	evidence.qualityFilterMotionAndDisposal=true;evidence.passed=true;
	await writeFile('dist/weekly-insights-host-evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{
	await call('Emulation.clearDeviceMetricsOverride').catch(()=>{});await call('Emulation.setEmulatedMedia',{features:[]}).catch(()=>{});
	if(initialized)await evaluate(`(()=>{const p=app.plugins.plugins['contribution-graph-local'],q=window.__insightsQA;if(!q)return;p.activityService.getWeeklyReview=q.query;for(const m of p.weeklyReviewModals.values())m.close();document.body.classList.toggle('theme-dark',q.dark);document.body.classList.toggle('theme-light',q.light);if(q.font)document.body.style.setProperty('--font-text',q.font);else document.body.style.removeProperty('--font-text');delete window.__insightsQA;return true})()`).catch(e=>console.error('验收恢复失败',e));socket.close();
}
