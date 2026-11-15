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
 await evaluate(`(()=>{app.setting.close();app.plugins.plugins['contribution-graph-local'].timeObserver.stop();window.detailRoot=document.createElement('div');window.detailRoot.style.cssText='position:fixed;inset:40px 0 0 auto;width:600px;overflow:auto;background:var(--background-primary);z-index:1000';document.body.append(window.detailRoot);window.detailItems=n=>Array.from({length:n},(_,i)=>({label:'验收/笔记'+String(i).padStart(2,'0')+'.md',value:1,open:()=>{window.clickedDetail=i}}));window.detailConfig={title:'详情增量验收',graphType:'default',fromDate:'2026-11-14',toDate:'2026-11-15',startOfWeek:1,cellStyle:{minWidth:'14px',minHeight:'14px'},cellStyleRules:[{min:1,max:100000,color:'#123456'}],titleStyle:{},mainContainerStyle:{},showCellRuleIndicators:true,valueUnit:'字符',trackingPeriods:[{startDate:'2026-11-01'}],collectionScopePeriods:[{startDate:'2026-11-01',folders:[]}],appearance:{density:'BALANCED',cellGap:3,highlightToday:true,highlightWeekends:true},selectedActivityDate:'2026-11-15',data:[{date:'2026-11-15',value:0,editStats:{date:'2026-11-15',addedChars:0,deletedChars:0,changedChars:0,documents:[]},items:[]}]};window.renderContributionGraph(window.detailRoot,window.detailConfig);window.detailContainer=window.detailRoot.querySelector('.activity-container');window.patchDetail=items=>{window.detailConfig.data=[{date:'2026-11-15',value:items.length,editStats:{date:'2026-11-15',addedChars:items.length,deletedChars:0,changedChars:items.length,documents:[]},items}];window.renderContributionGraph(window.detailRoot,window.detailConfig)};window.patchDetail(window.detailItems(15))})()`);
 assert.equal(await evaluate("window.detailRoot.querySelectorAll('.activity-item').length"),10,'空明细增加数据后创建前十行');
 await evaluate("window.detailRoot.querySelector('.activity-load-more').click()");
 assert.equal(await evaluate("window.detailRoot.querySelectorAll('.activity-item').length"),15,'加载更多后展示十五行');
 await evaluate(`(()=>{window.keptDetailRow=window.detailRoot.querySelector('.activity-item');window.keptDetailLabel=window.keptDetailRow.querySelector('.label');window.keptDetailLabel.focus();window.detailList=window.detailRoot.querySelector('.activity-list');window.detailList.scrollTop=50;window.keptScroll=window.detailList.scrollTop;window.patchDetail(window.detailItems(15).reverse())})()`);
 assert.equal(await evaluate("window.keptDetailRow===window.detailRoot.querySelector('[data-activity-key=\"验收/笔记00.md\"]')&&document.activeElement===window.keptDetailLabel"),true,'重新排序按路径保留原行和焦点');
 assert.equal(await evaluate('window.detailList.scrollTop'),await evaluate('window.keptScroll'),'更新保留滚动位置');
 assert.equal(await evaluate("window.detailRoot.querySelectorAll('.activity-item').length"),15,'刷新保留已加载数量');
 await evaluate("window.patchDetail([...window.detailItems(15).reverse(),...window.detailItems(25).slice(15)]);window.detailRoot.querySelector('.activity-load-more').click()");
 assert.equal(await evaluate("window.detailRoot.querySelectorAll('.activity-item').length"),25,'加载更多读取更新后的列表');
 await evaluate("window.patchDetail(window.detailItems(25).filter(x=>x.label!=='验收/笔记05.md'))");
 assert.equal(await evaluate("window.detailRoot.querySelector('[data-activity-key=\"验收/笔记05.md\"]')===null"),true,'删除的笔记行被移除');
 await evaluate(`(()=>{const items=window.detailItems(2);delete items[0].open;window.patchDetail(items)})()`);
 assert.equal(await evaluate("window.detailRoot.querySelector('[data-activity-key=\"验收/笔记00.md\"] .label').tagName"),'SPAN','不可打开的笔记不残留链接');
 await evaluate("window.patchDetail(window.detailItems(2));window.detailRoot.querySelector('[data-activity-key=\"验收/笔记00.md\"] .label').click()");
 assert.equal(await evaluate('window.clickedDetail'),0,'重新可打开的笔记使用最新点击回调');
 await evaluate("window.detailConfig.data=[{date:'2026-11-15',value:0,items:[]}];window.renderContributionGraph(window.detailRoot,window.detailConfig)");
 assert.equal(await evaluate("window.detailRoot.querySelector('.activity-stat.changed .activity-stat-value').textContent"),'0','清空缺省统计后显示零');
 assert.equal(await evaluate("window.detailRoot.querySelectorAll('.activity-item').length"),0);
 for (const type of ['default','month-track','calendar']) {
  const result=await evaluate(`(()=>{const a=document.createElement('div'),b=document.createElement('div');window.detailRoot.append(a,b);const c={...window.detailConfig,graphType:${JSON.stringify(type)},selectedActivityDate:undefined,data:[{date:'2026-11-15',value:3}]};window.renderContributionGraph(a,c);const zero={...c,data:[{date:'2026-11-15',value:0}]};window.renderContributionGraph(a,zero);window.renderContributionGraph(b,zero);const read=x=>{const n=x.querySelector('[data-date="2026-11-15"]');return [n.classList.contains('empty'),n.style.backgroundColor,n.ariaLabel]};const result=[read(a),read(b)];a.remove();b.remove();return result})()`);
  assert.deepEqual(result[0],result[1],type+' 零值局部结果与完整渲染相同');
 }
 await evaluate("window.detailConfig.trackingPeriods=[];window.detailConfig.collectionScopePeriods=[];window.renderContributionGraph(window.detailRoot,window.detailConfig)");
 assert.equal(await evaluate("window.detailRoot.querySelector('.activity-stats')===null"),true,'未采集状态不保留旧统计数字');
 await evaluate("window.detailConfig.trackingPeriods=[{startDate:'2026-11-01'}];window.detailConfig.collectionScopePeriods=[{startDate:'2026-11-01',folders:[]}];window.patchDetail(window.detailItems(3));window.detailConfig.data[0].editStats.countingPolicyChanged=true;window.renderContributionGraph(window.detailRoot,window.detailConfig)");
 assert.equal(await evaluate("window.detailRoot.querySelector('.activity-stat.changed .activity-stat-value').textContent"),'3','恢复采集补齐统计区域');
 assert.ok(await evaluate("window.detailRoot.querySelector('.activity-warnings').textContent.includes('统计口径')&&!window.detailRoot.querySelector('.activity-warnings').textContent.includes('空闲')"),'新增字数规则警告使用字数文案');
 console.log('详情及零值宿主验收通过：空列表增长、路径节点复用、排序/焦点/滚动、已加载数量与最新加载更多、链接类型、清空归零、三种日图零值、采集及规则状态转换。');
} finally {await evaluate("window.detailRoot?.remove();app.plugins.plugins['contribution-graph-local'].timeObserver.start()").catch(()=>undefined);socket.close();}
