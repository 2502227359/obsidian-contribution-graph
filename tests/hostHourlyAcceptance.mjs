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
const chart = "[...app.workspace.activeLeaf.view.containerEl.querySelectorAll('.charts.hourly-profile')].find(e=>e.getBoundingClientRect().width>0)";
async function selectDate(date) {
	await evaluate(`(()=>{const c=(${chart});c.querySelector('.cg-date-trigger').click();const d=c.querySelector('.cg-date-picker');const date=${JSON.stringify(date)};for(let i=0;i<14;i++){const day=d.querySelector('button[data-date="'+date+'"]:not(:disabled)');if(day){day.click();return true}const direction=d.dataset.month>date.slice(0,7)?'previous':'next';d.querySelector('.cg-date-month-'+direction).click()}throw Error('日期未出现在可选日历内')})()`);
	await until(`(${chart})?.dataset.selectedDate===${JSON.stringify(date)}`);
}
async function selectView(view) {
	await evaluate(`(${chart}).querySelector('[data-time-view=${view}]').click()`);
	await until(`(${chart})?.dataset.view===${JSON.stringify(view)}`);
}

try {
	assert.ok((await evaluate("app.vault.adapter.basePath.replace(/\\\\/g,'/')")).endsWith("/dist/time-acceptance/vault"));
	const dates = await evaluate(`(()=>{const now=new Date();const at=delta=>{const d=new Date(now.getFullYear(),now.getMonth(),now.getDate()+delta);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};return {today:at(0),older:at(-2),previous:at(-1),unknown:at(-3),first:at(-6),future:at(1)}})()`);
	const fixture = '# 学习时段验收\n\n' + ['default', 'hourly'].map(type => '```contributionGraph\ntitle: ' + (type === 'hourly' ? '学习时段' : '每日活跃时长') + '\ngraphType: ' + type + '\ndateRangeType: FIXED_DATE_RANGE\nfromDate: ' + dates.first + '\ntoDate: ' + dates.future + '\ndataSource:\n  type: TIME_ACTIVITY\n```\n').join('\n');
	await evaluate(`(async()=>{
		app.setting.close(); document.querySelector('.modal-header-button')?.click();
		// 展示验收隔离真实采集，避免弹窗关闭结算测试页阅读时间。
		app.plugins.plugins['contribution-graph-local'].timeObserver.stop();
		const service=app.plugins.plugins['contribution-graph-local'].activityService;
		const data=JSON.parse(service.exportData());
		const now=new Date(),at=(delta,hour=0,minute=0)=>new Date(now.getFullYear(),now.getMonth(),now.getDate()+delta,hour,minute);
		data.timeActivity={buckets:{},periods:[{start:at(-2).getTime(),end:at(-1).getTime(),folders:[]},{start:at(-1,20,15).getTime(),end:at(-1,21).getTime(),folders:[]}],policyChanges:[]};
		for(const [delta,hour,seconds] of [[-2,9,1800],[-2,10,900],[-2,11,15],[-1,20,2700]]){
			const d=at(delta,hour),offsetMinutes=-d.getTimezoneOffset();const date=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
			data.timeActivity.buckets[date+'T'+String(hour).padStart(2,'0')+'-'+(offsetMinutes>=0?'+':'-')+Math.abs(offsetMinutes)]={date,hour,offsetMinutes,documents:{'阅读测试.md':seconds}};
		}
		await service.importData(JSON.stringify(data));
		const text=${JSON.stringify(fixture)};
		const file=app.vault.getAbstractFileByPath('小时视图验收.md');
		if(file) await app.vault.modify(file,text); else await app.vault.create('小时视图验收.md',text);
		await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('小时视图验收.md'),{state:{mode:'preview'}});
	})()`);
	await until(`Boolean(${chart})`);
	assert.equal(await evaluate(`(${chart}).dataset.view`), "day", "首次打开默认单日柱状图");
	assert.equal(await evaluate(`(${chart}).dataset.selectedDate`), dates.today, "默认选今天");
	const before = await evaluate("JSON.stringify(JSON.parse(app.plugins.plugins['contribution-graph-local'].activityService.exportData()).timeActivity.buckets)");
	await selectDate(dates.older);
	const day = await evaluate(`(()=>{const c=(${chart});return {bars:c.querySelectorAll('.cg-hour-bar').length,metric:c.closest('.main').querySelector('.cg-metric-value').ariaLabel,caption:c.closest('.main').querySelector('.cg-metric-caption').textContent,height9:c.querySelector('[data-hour="9"] .cg-hour-fill').getBoundingClientRect().height,height10:c.querySelector('[data-hour="10"] .cg-hour-fill').getBoundingClientRect().height,zeros:c.querySelectorAll('.cg-hour-bar.is-tracked.is-zero').length}})()`);
	assert.equal(day.bars, 24); assert.equal(day.metric, "45 分钟"); assert.equal(day.caption, "当日活跃时长");
	assert.ok(day.height9 > 50 && Math.abs(day.height9 / day.height10 - 2) < 0.03, "柱高按真实分钟同比例绘制");
	assert.ok(day.zeros > 0, "完整采集零分钟保留独立状态");
	const tickPosition = await evaluate(`(()=>{const c=(${chart}),plot=c.querySelector('.cg-hour-bars').getBoundingClientRect(),tick=c.querySelector('.cg-hour-ticks span:nth-child(2)').getBoundingClientRect();return (tick.left+tick.width/2-plot.left)/plot.width})()`);
	assert.ok(Math.abs(tickPosition - 0.25) < 0.02, "06:00刻度必须在24小时轴的四分之一处");
	await evaluate(`(${chart}).querySelector('[data-hour="9"]').click()`);
	assert.match(await evaluate(`(${chart}).closest('.main').querySelector('.cg-detail-heading').textContent`), /09:00—10:00/);
	assert.equal(await evaluate(`(${chart}).closest('.main').querySelector('.cg-document-value').textContent`), "30 分钟");
	const keyboard = await evaluate(`(()=>{const c=(${chart}),b=c.querySelector('[data-hour="10"]');b.focus();b.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));return {hour:document.activeElement.dataset.hour,stops:c.querySelectorAll('.cg-hour-bar[tabindex="0"]').length}})()`);
	assert.deepEqual(keyboard, {hour:"9", stops:1});
	await evaluate(`(()=>{window.hourlyOldChart=(${chart});return app.plugins.plugins['contribution-graph-local'].activityService.setIdleTimeoutMinutes(7)})()`);
	await until(`!window.hourlyOldChart.isConnected && (${chart})?.dataset.view==='day'`);
	assert.equal(await evaluate("document.activeElement.dataset.hour"), "9", "刷新保留小时焦点");
	assert.match(await evaluate(`(${chart}).closest('.main').querySelector('.cg-detail-heading').textContent`), /09:00—10:00/, "刷新保留小时详情");
	await selectDate(dates.today); await selectView("week");
	const week = await evaluate(`(()=>{const c=(${chart});return {rows:c.querySelectorAll('.cg-week-day').length,marks:c.querySelectorAll('.cg-week-hour').length,metric:c.closest('.main').querySelector('.cg-metric-value').ariaLabel}})()`);
	assert.deepEqual(week, {rows:7, marks:168, metric:"1 小时 30 分钟"});
	assert.equal(await evaluate(`(()=>{const c=(${chart});return [...c.querySelectorAll('.cg-week-day')].every(row=>{const box=row.getBoundingClientRect();return [...row.querySelectorAll('.cg-week-fill')].every(fill=>fill.getBoundingClientRect().bottom<=box.bottom+1)})})()`), true, "周行不能裁切小时柱");
	await evaluate(`(()=>{window.hourlyOldChart=(${chart});const b=window.hourlyOldChart.querySelector('[data-time-view=week]');b.focus();return app.plugins.plugins['contribution-graph-local'].activityService.setIdleTimeoutMinutes(6)})()`);
	await until(`!window.hourlyOldChart.isConnected && (${chart})?.dataset.view==='week'`);
	assert.equal(await evaluate("document.activeElement.dataset.timeFocus"), "view-week", "统计刷新保留控件焦点");
	assert.equal(await evaluate(`(${chart}).dataset.selectedDate`), dates.today);
	await evaluate(`(${chart}).querySelector('.cg-week-day[data-date="${dates.older}"]').click()`);
	assert.equal(await evaluate(`(${chart}).dataset.view`), "day", "点击周行下钻单日");
	assert.equal(await evaluate(`(${chart}).dataset.selectedDate`), dates.older);
	await selectDate(dates.previous);
	assert.equal(await evaluate(`(${chart}).querySelector('[data-hour="20"]').classList.contains('is-partial')`), true);
	await selectDate(dates.unknown);
	assert.equal(await evaluate(`(${chart}).closest('.main').querySelector('.cg-metric-value').ariaLabel`), "未采集");
	assert.ok(await evaluate(`(()=>{const b=(${chart}).querySelector('.is-untracked');return getComputedStyle(b,'::after').content!=='none'})()`));
	await selectDate(dates.future);
	assert.equal(await evaluate(`(${chart}).querySelectorAll('.cg-hour-bar:disabled').length`), 24);
	assert.equal(await evaluate(`(${chart}).closest('.main').querySelector('.cg-metric-value').ariaLabel`), "尚未到来");
	await selectDate(dates.older);
	const narrow = await evaluate(`(()=>{const v=app.workspace.activeLeaf.view.containerEl;v.style.width='320px';v.style.maxWidth='320px';const c=(${chart});const result={chartFits:c.scrollWidth<=c.clientWidth+1,bars:Math.min(...[...c.querySelectorAll('.cg-hour-bar')].map(b=>b.getBoundingClientRect().width))>0,toolbarFits:c.querySelector('.cg-time-toolbar').scrollWidth<=c.clientWidth};v.style.removeProperty('width');v.style.removeProperty('max-width');return result})()`);
	assert.deepEqual(narrow, {chartFits:true,bars:true,toolbarFits:true}, "320像素窗格仍能操作日期并读到24柱");
	assert.equal(await evaluate("JSON.stringify(JSON.parse(app.plugins.plugins['contribution-graph-local'].activityService.exportData()).timeActivity.buckets)"), before, "展示交互不改变原始时长桶");
	await evaluate("app.plugins.plugins['contribution-graph-local'].activityService.setIdleTimeoutMinutes(5)");
	await evaluate(`(async()=>{
		const path='小时时段保存验收.md',text=${JSON.stringify(fixture)};
		const file=app.vault.getAbstractFileByPath(path);if(file)await app.vault.modify(file,text);else await app.vault.create(path,text);
		await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath(path),{state:{mode:'preview'}});
	})()`);
	await until("[...app.workspace.activeLeaf.view.containerEl.querySelectorAll('.contribution-graph-codeblock-edit-button')].filter(e=>e.getBoundingClientRect().width>0).length===2");
	await evaluate("[...app.workspace.activeLeaf.view.containerEl.querySelectorAll('.contribution-graph-codeblock-edit-button')].filter(e=>e.getBoundingClientRect().width>0)[1].click()");
	await until("Boolean(document.querySelector('.cg-editor-preview .charts.hourly-profile'))");
	const editor = await evaluate("(()=>{const m=document.querySelector('.contribution-graph-editor-modal');return {ranges:m.querySelectorAll('.cg-editor-appearance-panel input[type=range]').length,color:m.querySelector('.cg-editor-advanced-panel').textContent.includes('柱体颜色'),bars:m.querySelectorAll('.cg-editor-preview .cg-hour-bar').length}})()");
	assert.deepEqual(editor, {ranges:0,color:true,bars:24}, "小时编辑器提供真实生效的控件和新图预览");
	await evaluate("[...document.querySelectorAll('.cg-editor-footer button')].find(e=>e.textContent==='保存').click()");
	await until("!document.querySelector('.contribution-graph-editor-modal')");
	const saved = await evaluate("app.vault.read(app.vault.getAbstractFileByPath('小时时段保存验收.md'))");
	assert.ok(saved.includes('graphType: hourly') && !saved.includes('hourlyViewState:'), "保存图类型但不把临时视图状态写入配置");
	console.log("小时视图宿主验收通过：默认单日、24柱比例与零值、日期切换、7天168小时、一周下钻、原始明细、缺失/部分/未来、键盘、刷新状态与焦点、320像素布局、统计数据保留。");
} finally { await evaluate("app.plugins.plugins['contribution-graph-local'].timeObserver.start()"); socket.close(); }
