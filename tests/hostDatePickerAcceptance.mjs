import assert from "node:assert/strict";

const targets = await (await fetch("http://127.0.0.1:9231/json/list")).json();
const target = targets.find(item => item.type === "page" && item.url.startsWith("app://"));
assert.ok(target, "独立验收实例必须运行");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {ws.onopen = resolve; ws.onerror = reject;});
let sequence = 0;
const pending = new Map();
ws.onmessage = event => {const r = JSON.parse(event.data); if (!r.id) return; const task = pending.get(r.id); pending.delete(r.id); r.error ? task.reject(r.error) : task.resolve(r.result);};
const call = (method, params) => new Promise((resolve, reject) => {const id = ++sequence; pending.set(id, {resolve, reject}); ws.send(JSON.stringify({id, method, params}));});
async function evaluate(expression) {
	const r = await call("Runtime.evaluate", {expression, awaitPromise: true, returnByValue: true, userGesture: true});
	assert.ok(!r.exceptionDetails, r.exceptionDetails?.exception?.description);
	return r.result.value;
}
async function until(expression) {
	for (let i = 0; i < 60; i++) {if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100));}
	assert.fail(`等待超时：${expression}`);
}
const chart = "[...app.workspace.activeLeaf.view.containerEl.querySelectorAll('.charts.hourly-profile')].find(e=>e.getBoundingClientRect().width>0)";
try {
	assert.ok((await evaluate("app.vault.adapter.basePath.replace(/\\\\/g,'/')")).endsWith('/dist/time-acceptance/vault'));
	await evaluate("app.setting.close();document.querySelector('.cg-date-picker[open]')?.close();document.querySelector('.modal-header-button')?.click();app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('小时视图验收.md'),{state:{mode:'preview'}})");
	const fixture = '```contributionGraph\ngraphType: hourly\ndateRangeType: FIXED_DATE_RANGE\nfromDate: 2026-09-01\ntoDate: 2026-12-31\ndataSource:\n  type: TIME_ACTIVITY\n```';
	await evaluate(`(async()=>{const text=${JSON.stringify(fixture)};const file=app.vault.getAbstractFileByPath('日期弹窗验收.md')||await app.vault.create('日期弹窗验收.md',text);await app.vault.modify(file,text);await app.workspace.getLeaf(false).openFile(file,{state:{mode:'preview'}})})()`);
	await until(`Boolean(${chart})`);
	assert.equal(await evaluate(`Boolean((${chart}).querySelector('.cg-date-trigger'))`), true, "日期入口必须打开插件自己的日历");
	assert.equal(await evaluate(`(${chart}).querySelectorAll('input[type=date]').length`), 0, "不保留原生日期弹窗入口");
	await evaluate(`(${chart}).querySelector('.cg-date-trigger').click()`);
	await until(`Boolean((${chart}).querySelector('.cg-date-picker[open]'))`);
	const font = await evaluate(`(()=>{const c=(${chart});c.style.setProperty('--font-text','"验收文楷字体", serif');const d=c.querySelector('.cg-date-picker');const result=[d,...d.querySelectorAll('button,h3,.cg-date-weekdays span')].every(e=>getComputedStyle(e).fontFamily.includes('验收文楷字体'));c.style.removeProperty('--font-text');return result})()`);
	assert.equal(font, true, "月份、星期、日期和按钮都必须跟随 Obsidian 字体");
	assert.equal(await evaluate(`(${chart}).querySelectorAll('.cg-date-day').length`), 42);
	const selected = await evaluate(`(${chart}).dataset.selectedDate`);
	await evaluate(`(()=>{const d=(${chart}).querySelector('.cg-date-picker');window.oldCalendar=d;window.oldMonth=d.dataset.month;const s=app.plugins.plugins['contribution-graph-local'].activityService;return s.setIdleTimeoutMinutes(s.getSettings().idleTimeoutMinutes===6?7:6)})()`);
	await evaluate('new Promise(resolve=>setTimeout(resolve,250))');
	assert.equal(await evaluate(`window.oldCalendar===(${chart}).querySelector('.cg-date-picker[open]')`),true,'统计刷新保留原日历节点');
	assert.equal(await evaluate(`(${chart}).querySelector('.cg-date-picker').dataset.month`), await evaluate('window.oldMonth'), "统计刷新保留打开的月份");
	assert.equal(await evaluate("document.activeElement.dataset.date"), selected, "统计刷新保留日历焦点");
	await evaluate(`(()=>{const d=(${chart}).querySelector('.cg-date-picker');d.querySelector('.cg-date-day[aria-selected=true]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));})()`);
	const previous = await evaluate("document.activeElement.dataset.date");
	assert.ok(previous < selected, "左方向键移动到前一日期");
	await evaluate(`window.originalDateTrigger=(${chart}).querySelector('.cg-date-trigger');document.activeElement.click()`);
	await until(`(${chart}).dataset.selectedDate===${JSON.stringify(previous)}`);
	assert.equal(await evaluate(`Boolean((${chart}).querySelector('.cg-date-picker[open]'))`), false);
	assert.equal(await evaluate("document.activeElement.dataset.timeFocus"), 'date', "选日后焦点返回日期入口");
	await evaluate(`(${chart}).querySelector('.cg-date-trigger').click()`);
	await until(`Boolean((${chart}).querySelector('.cg-date-picker[open]'))`);
	assert.equal(await evaluate(`(${chart}).querySelector('.cg-date-trigger')===window.originalDateTrigger`),true,'选日保留日期入口节点');
	assert.equal(await evaluate(`(${chart}).querySelector('.cg-date-day[aria-selected=true]').dataset.date`),previous,'保留的日历使用新选择日期');
	await call('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
	await call('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
	await until(`!(${chart}).querySelector('.cg-date-picker[open]')`);
	assert.equal(await evaluate("document.activeElement.dataset.timeFocus"), 'date');
	await evaluate(`(${chart}).querySelector('.cg-date-trigger').click();(${chart}).querySelector('.cg-date-month-previous').click()`);
	const browsed = await evaluate(`(${chart}).querySelector('.cg-date-picker').dataset.month`);
	await evaluate(`(${chart}).querySelector('.cg-date-close').click()`);
	await until(`!(${chart}).querySelector('.cg-date-picker[open]')`);
	await evaluate(`(${chart}).querySelector('.cg-date-trigger').click()`);
	assert.equal(await evaluate(`(${chart}).querySelector('.cg-date-picker').dataset.month`), browsed);
	assert.equal((await evaluate('document.activeElement.dataset.date'))?.slice(0,7), browsed, '重新打开浏览月份时焦点在可选日期');
	for (const theme of ['theme-light','theme-dark']) {
		await evaluate(`document.body.classList.remove('theme-light','theme-dark');document.body.classList.add(${JSON.stringify(theme)})`);
		await call('Emulation.setDeviceMetricsOverride',{width:320,height:640,deviceScaleFactor:1,mobile:false});
		assert.equal(await evaluate(`(()=>{const d=(${chart}).querySelector('.cg-date-picker');const r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&d.scrollWidth<=d.clientWidth})()`),true,'窄窗口日历完整可见');
	}
	await call('Emulation.clearDeviceMetricsOverride',{});
	await evaluate(`(${chart}).querySelector('.cg-date-today').click()`);
	await until(`!(${chart}).querySelector('.cg-date-picker[open]')`);
	assert.equal(await evaluate(`(${chart}).dataset.selectedDate`), await evaluate(`(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})()`));
	await evaluate("app.plugins.plugins['contribution-graph-local'].activityService.recordTimeActivity('阅读测试.md')");
	assert.equal(await evaluate("app.plugins.plugins['contribution-graph-local'].activityService.getTimeTrackingStatus()"),'时长：计时中');
	await evaluate(`(${chart}).querySelector('.cg-date-trigger').click()`);
	await until(`app.plugins.plugins['contribution-graph-local'].activityService.getTimeTrackingStatus()==='时长：弹窗暂停'`);
	await call('Input.dispatchMouseEvent',{type:'mousePressed',x:2,y:2,button:'left',clickCount:1});
	await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:2,y:2,button:'left',clickCount:1});
	await until(`!(${chart}).querySelector('.cg-date-picker[open]')`);
	await evaluate("app.plugins.plugins['contribution-graph-local'].activityService.setIdleTimeoutMinutes(5)");
	console.log('日期弹窗宿主验收通过：插件日历、全体字体跟随、42日格、刷新保留月份和焦点、键盘选日、Escape及外部点击关闭、月份重开焦点、深浅色窄窗、弹窗暂停计时及焦点返回。');
} finally {ws.close();}
