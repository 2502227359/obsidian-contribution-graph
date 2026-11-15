import assert from "node:assert/strict";

// 只连接项目内的独立验收仓库，不触碰正式 CMBK。
const endpoint = process.env.OBSIDIAN_TEST_CDP || "http://127.0.0.1:9231";
const targets = await (await fetch(`${endpoint}/json/list`)).json();
const target = targets.find(item => item.type === "page" && item.url.startsWith("app://"));
assert.ok(target, "独立 Obsidian 验收实例必须已经启动");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
socket.onmessage = event => {
	const message = JSON.parse(event.data);
	if (!message.id) return;
	const task = pending.get(message.id);
	pending.delete(message.id);
	message.error ? task.reject(message.error) : task.resolve(message.result);
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
	const id = ++sequence;
	pending.set(id, { resolve, reject });
	socket.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expression) {
	const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
	assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description || result.exceptionDetails?.text);
	return result.result.value;
}
async function wait(ms = 350) { await evaluate(`new Promise(resolve => setTimeout(resolve, ${ms}))`); }
async function until(expression) {
	for (let attempt = 0; attempt < 80; attempt++) {
		if (await evaluate(expression)) return;
		await wait(100);
	}
	assert.fail(`宿主状态等待超时：${expression}`);
}
function assertSecondsEqual(actual, expected, message) {
	assert.ok(Math.abs(actual - expected) <= 1e-6, `${message}：期望 ${expected}，实际 ${actual}`);
}

const idA = crypto.randomUUID();
const idB = crypto.randomUUID();
const notePath = `普通目录统计同步验收-${idA}.md`;
const recordPaths = [`Template/数据/学习统计/记录/${idA}.json`, `Template/数据/学习统计/记录/${idB}.json`];
const statsPath = "Template/数据/学习统计";
const recordData = (date, chars, seconds) => ({
	dailyStats: { [date]: { addedChars: chars, deletedChars: 0, documents: { "同步验收/同一篇.md": { addedChars: chars, deletedChars: 0 } } } },
	timeActivity: {
		buckets: { [`${date}T10-+480`]: { date, hour: 10, offsetMinutes: 480, documents: { "同步验收/同一篇.md": seconds } } },
		periods: [], policyChanges: [],
	},
	trackingPeriods: [], collectionScopePeriods: [], countingPolicyPeriods: [],
});
const record = (id, revision, generation, date, chars, seconds) => JSON.stringify({
	formatVersion: 1, kind: "statistics", id, revision, updatedAt: 1700000000000 + revision,
	generation, data: recordData(date, chars, seconds),
}, null, 2);

let previousPath;
let fixtureCreated = false;
try {
	const vaultPath = await evaluate("app.vault.adapter.basePath.replace(/\\\\/g, '/')");
	assert.ok(vaultPath.endsWith("/dist/time-acceptance/vault"), "仅允许使用项目内独立验收仓库");
	previousPath = await evaluate("app.workspace.activeLeaf?.view?.file?.path || null");
	await evaluate("(() => { require('@electron/remote').getCurrentWindow().restore(); require('@electron/remote').getCurrentWindow().show(); app.setting.close(); document.querySelector('dialog[open]')?.close(); app.plugins.plugins['contribution-graph-local'].timeObserver.stop(); })()");
	await evaluate(`(async()=>{const root=${JSON.stringify(statsPath)};const files=[];for(const f of app.vault.getFiles().filter(f=>f.path.startsWith(root+'/'))){files.push([f.path,await app.vault.read(f)])}window.__cgStatsOriginal={export:app.plugins.plugins['contribution-graph-local'].activityService.exportData(),files};return true})()`);

	const date = await evaluate("(() => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })()");
	const originalSettings = await evaluate("app.plugins.plugins['contribution-graph-local'].activityService.getSettings()");
	if (!originalSettings.timeTrackingEnabled) await evaluate("app.plugins.plugins['contribution-graph-local'].activityService.setTimeTrackingEnabled(true)");
	const generation = await evaluate("app.plugins.plugins['contribution-graph-local'].activityService.statistics.generationId");
	const baseline = await evaluate(`(() => { const d=${JSON.stringify(date)}; const edit=window.contributionGraphApi.getDailyEditStats().find(x=>x.date===d); const rows=window.contributionGraphApi.getHourlyTimeStats({fromDate:d,toDate:d}); return {added:edit?.addedChars||0, document:edit?.documents?.find(x=>x.path==='同步验收/同一篇.md')?.addedChars||0, seconds:rows.reduce((n,x)=>n+x.seconds,0)}; })()`);

	const fixture = [
		"# 普通目录统计同步验收", "",
		"```contributionGraph", "title: 普通目录字数汇总验收", "graphType: default", "dateRangeType: LATEST_DAYS", "dateRangeValue: 7", "dataSource:", "  type: EDIT_ACTIVITY", "```", "",
		"```contributionGraph", "title: 普通目录每日时长汇总验收", "graphType: default", "dateRangeType: LATEST_DAYS", "dateRangeValue: 7", "dataSource:", "  type: TIME_ACTIVITY", "```", "",
		"```contributionGraph", "title: 普通目录时长汇总验收", "graphType: hourly", "dateRangeType: LATEST_DAYS", "dateRangeValue: 7", "dataSource:", "  type: TIME_ACTIVITY", "```", "",
	].join("\n");
	const note = await evaluate(`(async()=>{const p=${JSON.stringify(notePath)},t=${JSON.stringify(fixture)};let f=app.vault.getAbstractFileByPath(p);if(f)await app.vault.modify(f,t);else{f=await app.vault.create(p,t);window.__cgStatsFixtureCreated=true}await app.workspace.getLeaf(false).openFile(f,{state:{mode:'preview'}});return true})()`);
	assert.equal(note, true);
	fixtureCreated = await evaluate("Boolean(window.__cgStatsFixtureCreated)");
	await until("[...app.workspace.activeLeaf.view.containerEl.querySelectorAll('.contribution-graph')].filter(e=>e.getBoundingClientRect().width>0).length===3");
	await evaluate("window.__cgStatsGraphs=[...app.workspace.activeLeaf.view.containerEl.querySelectorAll('.contribution-graph')].filter(e=>e.getBoundingClientRect().width>0);window.__cgStatsNodes=window.__cgStatsGraphs.map(g=>({root:g,metric:g.querySelector('.cg-metric-value'),cell:g.querySelector('.cell'),toolbar:g.querySelector('.cg-time-toolbar')}))");
	const nodePresence = await evaluate("({metrics:window.__cgStatsNodes.every(n=>Boolean(n.metric)),wordCell:Boolean(window.__cgStatsNodes[0]?.cell),hourlyToolbar:Boolean(window.__cgStatsNodes[2]?.toolbar)})");
	assert.deepEqual(nodePresence, {metrics:true,wordCell:true,hourlyToolbar:true}, "三张图的指标、字数日格和小时工具栏必须已渲染");

	const lifecycle = await evaluate(`(() => { const p=app.plugins.plugins['contribution-graph-local']; const state={loads:0,unloads:0,saves:0,instance:p}; const patch={hadLoad:Object.hasOwn(p,'onload'),hadUnload:Object.hasOwn(p,'onunload'),hadSave:Object.hasOwn(p,'saveData'),load:p.onload,unload:p.onunload,save:p.saveData}; const load=p.onload?.bind(p),unload=p.onunload?.bind(p),save=p.saveData.bind(p); p.onload=async(...a)=>{state.loads++;return load?.(...a)};p.onunload=async(...a)=>{state.unloads++;return unload?.(...a)};p.saveData=async(...a)=>{state.saves++;return save(...a)};window.__cgStatsPatch=patch;window.__cgStatsLifecycle=state;return true})()`);
	assert.equal(lifecycle, true);

	const writeRecord = async (path, payload) => evaluate(`(async()=>{const p=${JSON.stringify(path)},t=${JSON.stringify(payload)};let f=app.vault.getAbstractFileByPath(p);if(f)await app.vault.modify(f,t);else{const parts=p.split('/');let dir='';for(const part of parts.slice(0,-1)){dir=dir?dir+'/'+part:part;if(!app.vault.getAbstractFileByPath(dir))await app.vault.createFolder(dir)}await app.vault.create(p,t)}return true})()`);
	await writeRecord(recordPaths[0], record(idA, 1, generation, date, 200, 1200));
	await writeRecord(recordPaths[1], record(idB, 1, generation, date, 300, 1800));
	await until(`(() => { const d=${JSON.stringify(date)}; const e=window.contributionGraphApi.getDailyEditStats().find(x=>x.date===d); const h=window.contributionGraphApi.getHourlyTimeStats({fromDate:d,toDate:d}); return (e?.addedChars||0)===${baseline.added+500} && Math.abs(h.reduce((n,x)=>n+x.seconds,0)-(${baseline.seconds+3000}))<=1e-6; })()`);

	const afterTwo = await evaluate(`(() => { const d=${JSON.stringify(date)}; const e=window.contributionGraphApi.getDailyEditStats().find(x=>x.date===d); const h=window.contributionGraphApi.getHourlyTimeStats({fromDate:d,toDate:d}); return {added:e?.addedChars||0,seconds:h.reduce((n,x)=>n+x.seconds,0)}; })()`);
	assert.equal(afterTwo.added, baseline.added + 500, "两份记录必须汇总增加500字");
	assertSecondsEqual(afterTwo.seconds, baseline.seconds + 3000, "两份记录必须汇总增加3000秒");

	await writeRecord(recordPaths[0], record(idA, 2, generation, date, 230, 1500));
	for (let i = 0; i < 100; i++) {
		await writeRecord(recordPaths[0], record(idA, i % 2 ? 1 : 2, generation, date, i % 2 ? 200 : 230, i % 2 ? 1200 : 1500));
	}
	await writeRecord(recordPaths[0], record(idA, 2, generation, date, 230, 1500));
	await until(`(() => { const d=${JSON.stringify(date)}; const e=window.contributionGraphApi.getDailyEditStats().find(x=>x.date===d); const h=window.contributionGraphApi.getHourlyTimeStats({fromDate:d,toDate:d}); return (e?.addedChars||0)===${baseline.added+530} && Math.abs(h.reduce((n,x)=>n+x.seconds,0)-(${baseline.seconds+3300}))<=1e-6; })()`);
	const finalStats = await evaluate(`(() => { const d=${JSON.stringify(date)}; const e=window.contributionGraphApi.getDailyEditStats().find(x=>x.date===d); const h=window.contributionGraphApi.getHourlyTimeStats({fromDate:d,toDate:d}); return {added:e?.addedChars||0,seconds:h.reduce((n,x)=>n+x.seconds,0),documents:e?.documents?.find(x=>x.path==='同步验收/同一篇.md')?.addedChars||0}; })()`);
	assert.equal(finalStats.added, baseline.added + 530, "同一记录只取最高 revision，字数不重复累计");
	assert.equal(finalStats.documents, baseline.document + 530, "同一篇笔记明细按记录去重后累加");
	assertSecondsEqual(finalStats.seconds, baseline.seconds + 3300, "同一记录只取最高 revision，时长不重复累计");
	const stable = await evaluate("(() => { const p=app.plugins.plugins['contribution-graph-local']; return {same:window.__cgStatsLifecycle.instance===p,loads:window.__cgStatsLifecycle.loads,unloads:window.__cgStatsLifecycle.unloads,saves:window.__cgStatsLifecycle.saves,graphs:[...app.workspace.activeLeaf.view.containerEl.querySelectorAll('.contribution-graph')].filter(e=>e.getBoundingClientRect().width>0).length}; })()");
	const nodesStable = await evaluate("(()=>{const gs=[...app.workspace.activeLeaf.view.containerEl.querySelectorAll('.contribution-graph')].filter(e=>e.getBoundingClientRect().width>0);return window.__cgStatsNodes.every((n,i)=>n.root===gs[i]&&n.metric===gs[i].querySelector('.cg-metric-value')&&(!n.cell||n.cell===gs[i].querySelector('.cell'))&&(!n.toolbar||n.toolbar===gs[i].querySelector('.cg-time-toolbar')))})()");
	assert.deepEqual(stable, {same:true,loads:0,unloads:0,saves:0,graphs:3}, "普通文件同步不能重载插件或写入 data.json");
	assert.equal(nodesStable, true, "同步刷新保留字数日格、每日图与小时工具栏节点");

	const livePath = await evaluate("(()=>{const folders=app.plugins.plugins['contribution-graph-local'].activityService.getSettings().trackedFolders;return folders.length?folders[0]+'/实时计时.md':'实时计时.md'})()");
	const liveBefore = await evaluate(`(()=>{const d=${JSON.stringify(date)};return window.contributionGraphApi.getHourlyTimeStats({fromDate:d,toDate:d}).reduce((n,x)=>n+x.seconds,0)})()`);
	await evaluate(`app.plugins.plugins['contribution-graph-local'].activityService.recordTimeActivity(${JSON.stringify(livePath)})`);
	await wait(16000);
	await evaluate("app.plugins.plugins['contribution-graph-local'].activityService.checkpointTimeActivity()");
	await wait(500);
	await evaluate("app.plugins.plugins['contribution-graph-local'].activityService.pauseTimeActivity()");
	const liveAfter = await evaluate(`(()=>{const d=${JSON.stringify(date)};return window.contributionGraphApi.getHourlyTimeStats({fromDate:d,toDate:d}).reduce((n,x)=>n+x.seconds,0)})()`);
	const liveAddedSeconds = liveAfter-liveBefore;
	assert.ok(liveAddedSeconds>=15, `真实计时应增加至少15秒，实际增加 ${liveAddedSeconds}`);
	const liveStable = await evaluate("(()=>{const p=app.plugins.plugins['contribution-graph-local'];return {same:window.__cgStatsLifecycle.instance===p,loads:window.__cgStatsLifecycle.loads,unloads:window.__cgStatsLifecycle.unloads,saves:window.__cgStatsLifecycle.saves}})()");
	assert.deepEqual(liveStable, {same:true,loads:0,unloads:0,saves:0}, "15秒时长心跳只写普通目录，不触发 data.json 或插件重载");
	console.log(JSON.stringify({pass:true,baseline,afterTwo,finalStats,stable,liveStable,liveAddedSeconds,folder:statsPath,records:recordPaths}));
} finally {
	await evaluate(`(async()=>{const p=app.plugins.plugins['contribution-graph-local'];const patch=window.__cgStatsPatch;if(patch){if(patch.hadLoad)p.onload=patch.load;else delete p.onload;if(patch.hadUnload)p.onunload=patch.unload;else delete p.onunload;if(patch.hadSave)p.saveData=patch.save;else delete p.saveData}p.timeObserver.stop();p.activityService.pauseTimeActivity();if(window.__cgStatsOriginal?.export)await p.activityService.importData(window.__cgStatsOriginal.export);for(const path of ${JSON.stringify(recordPaths)}){const f=app.vault.getAbstractFileByPath(path);if(f)await app.vault.delete(f)}for(const [path,data] of (window.__cgStatsOriginal?.files||[])){const f=app.vault.getAbstractFileByPath(path);if(f&&await app.vault.read(f)!==data)await app.vault.modify(f,data)}const n=app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});if(n)await app.vault.delete(n);p.timeObserver.start();if(${JSON.stringify(previousPath)}){const f=app.vault.getAbstractFileByPath(${JSON.stringify(previousPath)});if(f)await app.workspace.getLeaf(false).openFile(f,{state:{mode:'preview'}})}})()`).catch(() => undefined);
	await evaluate("delete window.__cgStatsLifecycle;delete window.__cgStatsGraphs;delete window.__cgStatsNodes;delete window.__cgStatsFixtureCreated;delete window.__cgStatsOriginal;delete window.__cgStatsPatch").catch(() => undefined);
	socket.close();
}
