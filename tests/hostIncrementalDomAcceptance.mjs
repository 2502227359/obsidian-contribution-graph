import assert from "node:assert/strict";

const endpoint = process.env.OBSIDIAN_TEST_CDP || "http://127.0.0.1:9231";
const targets = await (await fetch(`${endpoint}/json/list`)).json();
const target = targets.find(item => item.type === "page" && item.url.startsWith("app://"));
assert.ok(target, "独立 Obsidian 验收实例必须运行");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
socket.onmessage = event => {
	const response = JSON.parse(event.data);
	if (!response.id) return;
	const task = pending.get(response.id); pending.delete(response.id);
	response.error ? task.reject(response.error) : task.resolve(response.result);
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
	const id = ++sequence; pending.set(id, {resolve, reject}); socket.send(JSON.stringify({id, method, params}));
});
async function evaluate(expression) {
	const result = await call("Runtime.evaluate", {expression, awaitPromise: true, returnByValue: true, userGesture: true});
	assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description);
	return result.result.value;
}
async function until(expression) {
	for (let attempt = 0; attempt < 60; attempt++) {
		const result = await evaluate(expression);
		if (result) return result;
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	assert.fail(`宿主状态等待超时：${expression}`);
}

try {
 assert.ok((await evaluate("app.vault.adapter.basePath.replace(/\\\\/g,'/')")).endsWith('/dist/time-acceptance/vault'));
 await evaluate(`(()=>{document.querySelector('dialog[open]')?.close();app.setting.close();app.plugins.plugins['contribution-graph-local'].timeObserver.stop();document.getElementById('incremental-public-test')?.remove();const root=document.createElement('div');root.id='incremental-public-test';root.style.cssText='position:fixed;inset:40px 0 0 auto;width:700px;overflow:auto;background:var(--background-primary);z-index:1000';document.body.append(root);window.publicRoots=Array.from({length:3},()=>{const el=document.createElement('div');root.append(el);return el});window.publicConfig={title:'局部刷新公开入口验收',graphType:'default',fromDate:'2026-11-14',toDate:'2026-11-15',startOfWeek:1,cellStyle:{minWidth:'14px',minHeight:'14px'},cellStyleRules:[{min:0,max:100000,color:'#123456'}],titleStyle:{},mainContainerStyle:{},showCellRuleIndicators:true,valueUnit:'字符',trackingPeriods:[{startDate:'2026-11-01'}],collectionScopePeriods:[{startDate:'2026-11-01',folders:[]}],appearance:{density:'BALANCED',cellGap:3,highlightToday:true,highlightWeekends:true},data:[{date:'2026-11-14',value:2},{date:'2026-11-15',value:5,editStats:{date:'2026-11-15',addedChars:5,deletedChars:0,changedChars:5,documents:[]},items:[]}]};window.renderContributionGraph(window.publicRoots[0],window.publicConfig);window.publicConfig.onCellClick=cell=>{window.publicConfig.selectedActivityDate=cell.date};window.publicRoots[0].querySelector('button.cell[data-date="2026-11-15"]').click();window.publicNodes={root:window.publicRoots[0].firstElementChild,cell:window.publicRoots[0].querySelector('button.cell[data-date="2026-11-15"]'),metric:window.publicRoots[0].querySelector('.cg-metric-number'),summary:window.publicRoots[0].querySelector('.activity-summary')};window.renderContributionGraph(window.publicRoots[0],{...window.publicConfig,data:[{date:'2026-11-14',value:2},{date:'2026-11-15',value:9,editStats:{date:'2026-11-15',addedChars:9,deletedChars:0,changedChars:9,documents:[]},items:[]}]});})()`);
 assert.equal(await evaluate("window.publicNodes.root===window.publicRoots[0].firstElementChild&&window.publicNodes.cell===window.publicRoots[0].querySelector('button.cell[data-date=\"2026-11-15\"]')&&window.publicNodes.metric===window.publicRoots[0].querySelector('.cg-metric-number')&&window.publicNodes.summary===window.publicRoots[0].querySelector('.activity-summary')"),true,'公开入口只改数据时保留外壳、单元、数字与明细节点');
 await evaluate(`(()=>{const data=Array.from({length:7},(_,i)=>{const d=new Date(2026,10,9+i);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}).flatMap(date=>Array.from({length:24},(_,hour)=>({date,hour,value:hour===9?10:hour===10?5:0,year:2026,month:10,monthDate:Number(date.slice(8)),weekDay:new Date(date+'T12:00:00').getDay(),tracked:true,trackingState:'TRACKED',future:false,timeStats:{date,hour,seconds:hour===9?600:hour===10?300:0,documents:[],trackingState:'TRACKED',future:false},items:[]})));window.hourConfig={...window.publicConfig,title:'时段局部验收',graphType:'hourly',timeTracking:true,valueUnit:'分钟',fromDate:'2026-11-09',toDate:'2026-11-15',data:[],hourlyData:data,hourlyViewState:{view:'week',date:'2026-11-15'}};window.renderContributionGraph(window.publicRoots[1],window.hourConfig);window.hourMark=window.publicRoots[1].querySelector('.cg-week-hour[data-time-key="2026-11-15T10"]');window.oldHeight=window.hourMark.style.getPropertyValue('--hour-height');window.hourConfig.hourlyData=window.hourConfig.hourlyData.map(c=>c.date==='2026-11-15'&&c.hour===9?{...c,value:120,timeStats:{...c.timeStats,seconds:7200}}:c);window.renderContributionGraph(window.publicRoots[1],window.hourConfig)})()`);
 assert.equal(await evaluate("window.hourMark===window.publicRoots[1].querySelector('.cg-week-hour[data-time-key=\"2026-11-15T10\"]')"),true);
 assert.notEqual(await evaluate('window.hourMark.style.getPropertyValue("--hour-height")'),await evaluate('window.oldHeight'),'周视图轴上限变化同步缩放未变时段');
 await evaluate(`(()=>{window.unknownConfig={...window.hourConfig,hourlyViewState:{view:'day',date:'2026-11-15'},hourlyData:window.hourConfig.hourlyData.map(c=>({...c,value:0,tracked:false,trackingState:'UNTRACKED',timeStats:{...c.timeStats,seconds:0,trackingState:'UNTRACKED'}}))};window.renderContributionGraph(window.publicRoots[2],window.unknownConfig)})()`);
 assert.equal(await evaluate("window.publicRoots[2].querySelector('.cg-metric-value').textContent"),'未采集','未采集指标只显示一次');
 await evaluate(`(()=>{window.publicMutationRecords=[];window.publicMutationObserver=new MutationObserver(r=>window.publicMutationRecords.push(...r));window.publicMutationObserver.observe(window.publicRoots[1],{attributes:true,childList:true,characterData:true,subtree:true});window.renderContributionGraph(window.publicRoots[1],window.hourConfig)})()`);
 assert.equal(await evaluate('window.publicMutationRecords.length'),0,'相同数据重复刷新没有DOM写入');

 await evaluate(`(()=>{window.unknownConfig.hourlyData=window.unknownConfig.hourlyData.map(c=>({...c,tracked:true,trackingState:'TRACKED',timeStats:{...c.timeStats,trackingState:'TRACKED'}}));window.renderContributionGraph(window.publicRoots[2],window.unknownConfig)})()`);
 assert.equal(await evaluate("window.publicRoots[2].querySelector('.cg-metric-value').textContent"),'0分钟','未采集转已采集零值清除旧提示');
 assert.equal(await evaluate("window.publicRoots[2].querySelector('.cg-time-empty')===null&&window.publicRoots[2].querySelector('.cg-time-key .is-untracked')===null"),true,'已采集零值移除空态及未采集图例');
 await evaluate(`(()=>{window.unknownConfig.hourlyData=window.unknownConfig.hourlyData.map(c=>c.date==='2026-11-15'&&c.hour===10?{...c,future:true,timeStats:{...c.timeStats,future:true}}:c);window.renderContributionGraph(window.publicRoots[2],window.unknownConfig)})()`);
 assert.equal(await evaluate("Boolean(window.publicRoots[2].querySelector('.cg-time-key .is-future'))"),true,'出现未来时段新增状态图例');
 await evaluate(`(()=>{window.unknownConfig.hourlyData=window.unknownConfig.hourlyData.map(c=>({...c,future:false,timeStats:{...c.timeStats,future:false}}));window.renderContributionGraph(window.publicRoots[2],window.unknownConfig);const bar=window.publicRoots[2].querySelector('.cg-hour-bar[data-hour="9"]');bar.focus();bar.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))})()`);
 assert.equal(await evaluate('document.activeElement.dataset.hour'),'10','整点后方向键可到原来禁用的时段');
 assert.equal(await evaluate("window.publicRoots[2].querySelectorAll('.cg-hour-bar[tabindex=\"0\"]').length"),1,'只有一个小时柱进入Tab顺序');

 await evaluate(`(()=>{window.unknownConfig.selectedActivityDate='2026-11-15T9';for(const seconds of [1,2]){window.unknownConfig.hourlyData=window.unknownConfig.hourlyData.map(c=>c.date==='2026-11-15'&&c.hour===9?{...c,value:seconds/60,timeStats:{...c.timeStats,seconds,policyChanged:true}}:c);window.renderContributionGraph(window.publicRoots[2],window.unknownConfig)}})()`);
 assert.equal(await evaluate("window.publicRoots[2].querySelector('.activity-warnings').childElementCount"),0,'时长警告增量更新保持原段落排版');
 await evaluate(`(()=>{window.publicOriginalDate=Date;window.publicClockTime=new Date(2026,10,15,23,59,59).getTime();window.Date=class extends window.publicOriginalDate{constructor(...args){super(...(args.length?args:[window.publicClockTime]))}static now(){return window.publicClockTime}};window.midnightRoot=document.createElement('div');document.getElementById('incremental-public-test').append(window.midnightRoot);window.midnightConfig={...window.publicConfig,graphType:'calendar',selectedActivityDate:undefined,toDate:'2026-11-16',data:[{date:'2026-11-15',value:0},{date:'2026-11-16',value:0}]};window.renderContributionGraph(window.midnightRoot,window.midnightConfig);window.midnightOld=window.midnightRoot.querySelector('[data-date="2026-11-15"]');window.publicClockTime=new window.publicOriginalDate(2026,10,16,0,0,1).getTime();window.renderContributionGraph(window.midnightRoot,window.midnightConfig)})()`);
 assert.equal(await evaluate("!window.midnightOld.classList.contains('is-today')&&window.midnightRoot.querySelector('[data-date=\"2026-11-16\"]').classList.contains('is-today')"),true,'同一固定日历跨午夜迁移今日标记');
 await evaluate('window.Date=window.publicOriginalDate;delete window.publicOriginalDate');
 console.log('公开入口增量验收通过：数字与详情节点保留、周轴比例同步、未采集指标和相同数据零写入。');
} finally {await evaluate("if(window.publicOriginalDate){window.Date=window.publicOriginalDate;delete window.publicOriginalDate}window.publicMutationObserver?.disconnect();document.getElementById('incremental-public-test')?.remove();app.plugins.plugins['contribution-graph-local'].timeObserver.start()").catch(()=>undefined); socket.close();}
