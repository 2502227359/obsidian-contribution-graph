import assert from "node:assert/strict";

// 只在独立验收仓库写入样例，拒绝连接正式笔记库。
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
	const result = await call("Runtime.evaluate", {expression, awaitPromise: true, returnByValue: true});
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

const wait = () => evaluate('new Promise(resolve=>setTimeout(resolve,300))');
const graphs = "[...app.workspace.activeLeaf.view.containerEl.querySelectorAll('.contribution-graph')].filter(g=>g.getBoundingClientRect().width>0)";
try {
 assert.ok((await evaluate("app.vault.adapter.basePath.replace(/\\\\/g,'/')")).endsWith('/dist/time-acceptance/vault'));
 await evaluate(`(()=>{const w=require('@electron/remote').getCurrentWindow();w.restore();w.show();app.setting.close();document.querySelector('dialog[open]')?.close();app.plugins.plugins['contribution-graph-local'].timeObserver.stop()})()`);
 const date = await evaluate(`(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})()`);
 const fixture = ['EDIT_ACTIVITY','TIME_ACTIVITY','TIME_ACTIVITY'].map((type,i)=>'```contributionGraph\ntitle: 局部验收'+i+'\ngraphType: '+(i===2?'hourly':'default')+'\ndateRangeType: LATEST_DAYS\ndateRangeValue: 7\ndataSource:\n  type: '+type+'\n  folders:\n    - 局部验收\n```').join('\n\n');
 await evaluate(`(async()=>{const p=app.plugins.plugins['contribution-graph-local'];const s=p.activityService;const d=JSON.parse(s.exportData());d.settings.trackedFolders=[];d.settings.timeTrackingEnabled=true;d.settings.trackingEnabled=true;d.dailyStats={};d.trackingPeriods=[{startDate:${JSON.stringify(date)}}];d.collectionScopePeriods=[{startDate:${JSON.stringify(date)},folders:[]}];d.timeActivity={buckets:{},periods:[{start:new Date().setHours(0,0,0,0),folders:[]}],policyChanges:[]};await s.importData(JSON.stringify(d));if(!app.vault.getAbstractFileByPath('局部验收'))await app.vault.createFolder('局部验收');const text=${JSON.stringify(fixture)};const f=app.vault.getAbstractFileByPath('刷新链路验收.md')||await app.vault.create('刷新链路验收.md',text);await app.vault.modify(f,text);await app.workspace.getLeaf(false).openFile(f,{state:{mode:'preview'}})})()`);
 await until(`(${graphs}).length===3`);
 await wait();
 await evaluate(`(()=>{const v=app.workspace.activeLeaf.view.containerEl;const z=v.querySelector('.markdown-preview-sizer');z.style.maxWidth='none';z.style.display='grid';z.style.gridTemplateColumns='repeat(3,minmax(0,1fr))';for(const b of z.querySelectorAll('.el-pre')){b.style.minWidth='0';b.style.alignSelf='start'}v.querySelector('.markdown-preview-view').scrollTop=0;const s=app.plugins.plugins['contribution-graph-local'].activityService;window.incrementalQueries=[];window.incrementalOriginal={};for(const k of ['getDailyEditStats','getDailyTimeStats','getHourlyTimeStats']){window.incrementalOriginal[k]=s[k];s[k]=function(q){window.incrementalQueries.push({method:k,query:q});return window.incrementalOriginal[k].call(this,q)}}window.incrementalNodes=(${graphs}).map(g=>({g,metric:g.querySelector('.cg-metric-value'),cell:g.querySelector('.charts button.cell[data-date="${date}"]'),toolbar:g.querySelector('.cg-time-toolbar')}))})()`);
 await wait();
 await evaluate("window.incrementalQueries=[];app.plugins.plugins['contribution-graph-local'].activityService.recordTimeActivity('其他/无关.md')");
 await evaluate('new Promise(resolve=>setTimeout(resolve,30))');
 await evaluate("app.plugins.plugins['contribution-graph-local'].activityService.pauseTimeActivity()");
 await wait();
 assert.equal(await evaluate('window.incrementalQueries.length'),0,'无关文件夹事件零查询');
 await evaluate("app.plugins.plugins['contribution-graph-local'].activityService.recordTimeActivity('局部验收/甲.md')");
 await evaluate('new Promise(resolve=>setTimeout(resolve,40))');
 await evaluate("app.plugins.plugins['contribution-graph-local'].activityService.pauseTimeActivity()");
 await wait();
 const calls = await evaluate('window.incrementalQueries');
 assert.equal(calls.filter(c=>c.method==='getDailyEditStats').length,0,'时长变化不查询字数');
 assert.equal(calls.filter(c=>c.method==='getDailyTimeStats').length,1,'每日时长一批只查询一次');
 assert.equal(calls.filter(c=>c.method==='getHourlyTimeStats').length,1,'单日时段一批只查询一次');
 assert.ok(calls.every(c=>c.query.fromDate===date && c.query.toDate===date),'仅重算变化日期');
 assert.equal(await evaluate(`window.incrementalNodes.every((n,i)=>n.g===(${graphs})[i]&&n.metric===n.g.querySelector('.cg-metric-value')&&(!n.toolbar||n.toolbar===n.g.querySelector('.cg-time-toolbar')))`),true,'普通统计保留图表、指标和工具栏节点');
 await evaluate(`(()=>{window.incrementalMutations=[];window.incrementalMutationObserver=new MutationObserver(r=>window.incrementalMutations.push(...r));window.incrementalMutationObserver.observe(app.workspace.activeLeaf.view.containerEl,{attributes:true,childList:true,subtree:true,characterData:true});})()`);
 await evaluate("app.plugins.plugins['contribution-graph-local'].activityService.recordTimeActivity('其他/无关.md')");
 await evaluate('new Promise(resolve=>setTimeout(resolve,30))');
 await evaluate("app.plugins.plugins['contribution-graph-local'].activityService.pauseTimeActivity()");
 await wait();
 assert.equal(await evaluate("window.incrementalMutations.filter(r=>r.target.closest?.('.contribution-graph')).length"),0,'无关事件零图表DOM写入');
 await evaluate("window.incrementalMutationObserver.disconnect()");
 const hourly = `(${graphs})[2].querySelector('.charts.hourly-profile')`;
 await evaluate(`(${hourly}).querySelector('[data-time-focus=previous]').click()`);
 await wait();
 const previous = await evaluate(`(${hourly}).dataset.selectedDate`);
 assert.ok(previous<date);
 await evaluate("window.incrementalQueries=[];app.plugins.plugins['contribution-graph-local'].activityService.recordTimeActivity('局部验收/甲.md')");
 await evaluate('new Promise(resolve=>setTimeout(resolve,30))');
 await evaluate("app.plugins.plugins['contribution-graph-local'].activityService.pauseTimeActivity()");
 await wait();
 assert.equal((await evaluate('window.incrementalQueries')).filter(c=>c.method==='getHourlyTimeStats').length,0,'历史单日不查询今天');
 await evaluate(`(${hourly}).querySelector('[data-time-focus=next]').click()`);
 await wait();
 assert.equal(await evaluate(`(${hourly}).dataset.selectedDate`),date);
 await evaluate(`(async()=>{const s=app.plugins.plugins['contribution-graph-local'].activityService;const d=JSON.parse(s.exportData());d.dailyStats[${JSON.stringify(date)}]={addedChars:120,deletedChars:5,documents:{'局部验收/甲.md':{addedChars:120,deletedChars:5}}};await s.importData(JSON.stringify(d))})()`);
 await wait();
 assert.equal(await evaluate(`(${graphs})[0]===window.incrementalNodes[0].g`),true,'导入保留字数图外壳');
 assert.ok((await evaluate(`(${graphs})[0].querySelector('.cg-metric-value').textContent`)).includes('125'),'字数累计使用导入后的真实结果');
 await evaluate(`(${graphs})[0].querySelector('button.cell[data-date="${date}"]').click()`);
 assert.equal(await evaluate(`(${graphs})[0].querySelector('.activity-stat.changed .activity-stat-value').textContent`),'125','点击读取最新字数明细');
 await evaluate("(async()=>{const s=app.plugins.plugins['contribution-graph-local'].activityService;for(const [k,v]of Object.entries(window.incrementalOriginal))s[k]=v;await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('阅读测试.md'),{state:{mode:'preview'}})})()");
 await wait();
 console.log('刷新链路宿主验收通过：无关事件零查询及DOM写入、时长与字数隔离、只查变化日期、普通更新保留节点、历史单日跳过今天、切回补最新、导入及最新字数明细。');
} finally {
 await evaluate("(()=>{window.incrementalMutationObserver?.disconnect();const p=app.plugins.plugins['contribution-graph-local'];if(window.incrementalOriginal)for(const[k,v]of Object.entries(window.incrementalOriginal))p.activityService[k]=v;for(const leaf of app.workspace.getLeavesOfType('markdown'))for(const z of leaf.view.containerEl.querySelectorAll('.markdown-preview-sizer'))for(const k of ['max-width','display','grid-template-columns'])z.style.removeProperty(k);p.timeObserver.start()})()").catch(()=>undefined);
 socket.close();
}
