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
	assert.ok((await evaluate("app.vault.adapter.basePath.replace(/\\\\/g,'/')")).endsWith("/dist/time-acceptance/vault"));
	const fence = String.fromCharCode(96).repeat(3);
	const fixture = [
		"# 局部刷新验收",
		"",
		`${fence}contributionGraph`,
		"title: 字数局部刷新",
		"graphType: default",
		"dateRangeType: LATEST_DAYS",
		"dateRangeValue: 14",
		"dataSource:",
		"  type: EDIT_ACTIVITY",
		fence,
		"",
		`${fence}contributionGraph`,
		"title: 每日时长局部刷新",
		"graphType: default",
		"dateRangeType: LATEST_DAYS",
		"dateRangeValue: 14",
		"dataSource:",
		"  type: TIME_ACTIVITY",
		fence,
		"",
		`${fence}contributionGraph`,
		"title: 每小时局部刷新",
		"graphType: hourly",
		"dateRangeType: LATEST_DAYS",
		"dateRangeValue: 14",
		"dataSource:",
		"  type: TIME_ACTIVITY",
		fence,
		"",
	].join("\n");
	await evaluate(`(async()=>{const text=${JSON.stringify(fixture)};const f=app.vault.getAbstractFileByPath('局部刷新验收.md')||await app.vault.create('局部刷新验收.md',text);await app.vault.modify(f,text);await app.workspace.getLeaf(false).openFile(f,{state:{mode:'preview'}})})()`);
	await until("[...app.workspace.activeLeaf.view.containerEl.querySelectorAll('.contribution-graph')].filter(e=>e.getBoundingClientRect().width>0).length===3");
	await until("[...app.workspace.activeLeaf.view.containerEl.querySelectorAll('.charts.hourly-profile')].find(e=>e.getBoundingClientRect().width>0)?.querySelector('.cg-hour-bar')");
	const before = await evaluate(`(()=>{const graphs=[...app.workspace.activeLeaf.view.containerEl.querySelectorAll('.contribution-graph')].filter(e=>e.getBoundingClientRect().width>0);const hourly=[...app.workspace.activeLeaf.view.containerEl.querySelectorAll('.charts.hourly-profile')].find(e=>e.getBoundingClientRect().width>0);hourly.scrollIntoView({block:'center'});const cell=graphs[0].querySelector('.charts.default button.cell[data-date]:not(:disabled)');const hour=hourly.querySelector('.cg-hour-bar.is-tracked:not(:disabled)')||hourly.querySelector('.cg-hour-bar:not(:disabled)');cell.click();window.incrementalBefore={graphs,cell,hour,detail:graphs[0].querySelector('.activity-container'),cellDate:cell.dataset.date,date:hourly.dataset.selectedDate,key:hour.dataset.timeKey,height:hour.style.getPropertyValue('--hour-height')};return {count:graphs.length,cellDate:window.incrementalBefore.cellDate,date:window.incrementalBefore.date,key:window.incrementalBefore.key,height:window.incrementalBefore.height}})()`);
	assert.equal(before.count, 3);
	await evaluate(`(async()=>{const service=app.plugins.plugins['contribution-graph-local'].activityService;const data=JSON.parse(service.exportData());const date=${JSON.stringify(before.date)};const hour=Number(${JSON.stringify(before.key)}.split('T')[1]);const prefix=date+'T'+String(hour).padStart(2,'0')+'-';const key=Object.keys(data.timeActivity.buckets).find(item=>item.startsWith(prefix))||prefix+'+480';const bucket=data.timeActivity.buckets[key]||{date,hour,offsetMinutes:480,documents:{}};const document=Object.keys(bucket.documents)[0]||'阅读测试.md';bucket.documents[document]=(bucket.documents[document]||0)+60;data.timeActivity.buckets[key]=bucket;data.dailyStats[date]={addedChars:123,deletedChars:4,documents:{[document]:{addedChars:123,deletedChars:4}}};await service.importData(JSON.stringify(data))})()`);
	await new Promise(resolve => setTimeout(resolve, 500));
	const after = await evaluate(`(()=>{const graphs=[...app.workspace.activeLeaf.view.containerEl.querySelectorAll('.contribution-graph')].filter(e=>e.getBoundingClientRect().width>0);const hourly=[...app.workspace.activeLeaf.view.containerEl.querySelectorAll('.charts.hourly-profile')].find(e=>e.getBoundingClientRect().width>0);const cell=graphs[0].querySelector('.charts.default button.cell[data-date="${before.cellDate}"]');const hour=hourly.querySelector('.cg-hour-bar[data-time-key="${before.key}"]');return {graph0:graphs[0]===window.incrementalBefore.graphs[0],graph1:graphs[1]===window.incrementalBefore.graphs[1],graph2:graphs[2]===window.incrementalBefore.graphs[2],cell:cell===window.incrementalBefore.cell,hour:hour===window.incrementalBefore.hour,detail:graphs[0].querySelector('.activity-container')===window.incrementalBefore.detail,height:hour?.style.getPropertyValue('--hour-height'),metric:graphs[0].querySelector('.cg-metric-value')?.textContent}})()`);
	assert.equal(after.graph0, true, "字数图外壳保持原节点");
	assert.equal(after.graph1, true, "每日时长图外壳保持原节点");
	assert.equal(after.graph2, true, "每小时图外壳保持原节点");
	assert.equal(after.cell, true, "字数图受影响日期保留原节点");
	assert.equal(after.hour, true, "小时柱保留原节点");
	assert.equal(after.detail, true, "已打开详情保留原容器");
	assert.notEqual(after.height, before.height, "小时柱高随新数据局部更新");
	assert.match(after.metric, /[0-9<]/, "累计指标仍可见");
	console.log("局部刷新宿主验收通过：字数图、每日时长图和每小时图保留卡片及受影响节点，柱高与累计局部更新，详情容器保留。");
} finally { socket.close(); }
