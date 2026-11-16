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
const read = () => evaluate(`(()=>{const m=${modal};return {count:document.querySelectorAll('.cg-weekly-review-modal').length,root:m?.snapshot?.root,total:m?.snapshot?.totalSeconds,days:m?.rootEl.querySelectorAll('.cg-weekly-review-day').length,options:m?.rootEl.querySelector('.cg-weekly-review-options')?.open,error:m?.rootEl.querySelector('[role=alert]')?.textContent}})()`);
const evidence = {};
let initialized = false;
try {
	assert.ok((await evaluate("app.vault.adapter.basePath.replaceAll('\\\\','/')")).endsWith('/dist/time-acceptance/vault'), "禁止在正式库运行界面验收");
	await evaluate(`(()=>{const p=app.plugins.plugins['contribution-graph-local'];window.__reviewUI={query:p.activityService.getWeeklyReview,settings:JSON.stringify(p.activityService.getSettings()),dark:document.body.classList.contains('theme-dark'),light:document.body.classList.contains('theme-light'),font:document.body.style.getPropertyValue('--font-text')};for(const m of p.weeklyReviewModals.values())m.close();return true})()`);
	initialized = true;
	await evaluate("app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('验收.md'),{state:{mode:'preview'}})");
	await wait(600);
	assert.ok(await evaluate("document.querySelector('.cg-weekly-review-entry')!==null"), "时长图标题必须有周回顾入口");
	assert.ok(await evaluate("[...document.querySelectorAll('.side-dock-ribbon-action')].some(e=>(e.getAttribute('aria-label')||'').includes('周回顾'))"), "左侧功能区必须有周回顾入口");
	await click('.cg-weekly-review-entry');
	let first = await read(); assert.equal(first.count,1); assert.equal(first.root, ""); assert.equal(first.days,7); assert.equal(first.options,false);
	await evaluate("app.commands.executeCommandById('contribution-graph-local:weekly-review')"); assert.equal((await read()).count,1);
	await key('Escape');
	await click('.side-dock-ribbon-action[aria-label*="周回顾"]');
	first = await read(); assert.equal(first.count,1); assert.equal(first.root,'');
	evidence.defaultAndEntries = true;
	const layers = await evaluate(`(()=>{const m=${modal},s=getComputedStyle(m.contentEl);return {border:s.borderTopWidth,radius:s.borderRadius,shadow:s.boxShadow,days:[...m.rootEl.querySelectorAll('.cg-weekly-review-day')].every(e=>e.tagName==='BUTTON'&&e.ariaLabel.length>10),oldCards:m.rootEl.querySelectorAll('.cg-weekly-review-summary-card').length}})()`);
	assert.equal(layers.border,'0px'); assert.equal(layers.radius,'0px'); assert.equal(layers.shadow,'none'); assert.ok(layers.days); assert.equal(layers.oldCards,0);
	await evaluate(`(()=>{const m=${modal};window.__reviewUI.headerTop=m.rootEl.querySelector('header,.cg-weekly-review-header').getBoundingClientRect().top;m.scrollEl.scrollTop=200;return true})()`);
	assert.ok(await evaluate(`Math.abs(${modal}.rootEl.querySelector('.cg-weekly-review-header').getBoundingClientRect().top-window.__reviewUI.headerTop)<1`));
	await evaluate(`${modal}.scrollEl.scrollTop=0`);
	await click('[data-review-action="options"]'); assert.equal((await read()).options,true);
	await evaluate("document.querySelector('[data-review-field=goal]').focus();document.querySelector('[data-review-field=goal]').select()");
	await call('Input.insertText',{text:'-3'}); await wait(90);
	assert.ok(await evaluate("document.querySelector('[data-review-field=goal]').getAttribute('aria-invalid')==='true'&&document.querySelector('.cg-weekly-review-control-error').textContent.length>0"));
	await click('[data-review-action="clear-goal"]'); assert.equal((await read()).options,true);
	assert.ok(await evaluate("document.querySelector('[data-review-field=goal]').value===''") );
	await key('Escape'); assert.equal((await read()).count,1); assert.equal((await read()).options,false);
	await click('[data-review-field="root"]');
	const directory = await evaluate("document.querySelector('[data-review-root]:not([data-review-root=\"\"])')?.dataset.reviewRoot");
	assert.ok(directory,'隔离库必须有目录候选');
	await evaluate("document.querySelector('[data-review-field=root-search]').focus()");
	await call('Input.insertText',{text:directory}); await wait(70);
	assert.equal((await read()).root,'','输入搜索词不能改变范围');
	await key('ArrowDown'); await key('ArrowDown'); await key('Enter');
	assert.equal((await read()).root,directory);
	await click('[data-review-field="root"]'); await click('[data-review-root=""]'); assert.equal((await read()).root,''); assert.equal((await read()).total,first.total);
	await click('.cg-weekly-review-day'); await key('ArrowRight'); await key('Enter');
	assert.ok(await evaluate("document.querySelector('.cg-weekly-review-day[aria-pressed=true]')?.dataset.reviewDay===document.activeElement?.dataset.reviewDay"));
	const group = await evaluate("document.querySelector('[data-review-group-key]')?.dataset.reviewGroupKey");
	if(group){await click('[data-review-group-key]');assert.ok(await evaluate("document.querySelector('[data-review-action=clear-group]')!==null"));await click('[data-review-action=clear-group]');}
	evidence.filtersAndKeyboard = true;
	await evaluate("app.plugins.plugins['contribution-graph-local'].activityService.getWeeklyReview=()=>{throw Error('界面验收读取失败')}");
	await click('[data-review-action="refresh"]'); assert.ok((await read()).error.includes('上一次成功快照')); assert.equal((await read()).total,first.total);
	await evaluate("app.plugins.plugins['contribution-graph-local'].activityService.getWeeklyReview=window.__reviewUI.query");
	await click('[data-review-action="retry"]'); assert.ok(!(await read()).error);
	await click('[data-review-field="root"]'); await key('Escape'); assert.equal((await read()).count,1); assert.ok(await evaluate("!document.querySelector('.cg-weekly-review-root-picker').open"));
	await click('[data-review-field="date"]'); assert.ok(await evaluate("document.querySelector('.cg-weekly-review-modal .cg-date-picker').open")); await key('Escape'); assert.equal((await read()).count,1);
	await evaluate("app.plugins.plugins['contribution-graph-local'].activityService.getWeeklyReview=function(query){return {...window.__reviewUI.query.call(this,query),warnings:['存在时区偏移，覆盖无法确认。']}}");
	await click('[data-review-action="refresh"]');
	assert.ok(await evaluate("document.querySelector('.cg-weekly-review-alert')!==null&&document.querySelector('.cg-weekly-review-warnings')===null"));
	await evaluate("app.plugins.plugins['contribution-graph-local'].activityService.getWeeklyReview=window.__reviewUI.query");
	await click('[data-review-action="refresh"]');
	evidence.errorAndEscape = true;
	for(const [width,height,dark] of [[1200,800,true],[720,800,false],[320,760,false]]) {
		await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
		await evaluate(`(()=>{const m=${modal};const day=m.snapshot.days.find(d=>d.date===m.snapshot.today)||m.snapshot.days[0];m.selectedDay=day.date;m.render();m.scrollEl.scrollTop=0;m.modalEl.focus()})()`);
		await evaluate(`document.body.classList.toggle('theme-dark',${dark});document.body.classList.toggle('theme-light',${!dark});document.body.style.setProperty('--font-text','霞鹜文楷等宽')`); await wait(100);
		const layout=await evaluate(`(()=>{const m=${modal},r=m.rootEl,b=m.scrollEl,header=r.querySelector('.cg-weekly-review-header');return {width:r.clientWidth,overflow:r.scrollWidth>r.clientWidth+1||b.scrollWidth>b.clientWidth+1,font:getComputedStyle(r).fontFamily,trendBottom:r.querySelector('.cg-weekly-review-day-detail').getBoundingClientRect().bottom,bodyBottom:b.getBoundingClientRect().bottom,headerTop:header.getBoundingClientRect().top}})()`);
		assert.ok(!layout.overflow,`${width}px 不能横向溢出`);assert.ok(layout.font.includes('霞鹜文楷'));if(width===1200)assert.ok(layout.trendBottom<=layout.bodyBottom,'桌面首屏应显示完整趋势');
		evidence[`layout${width}`]=layout;
		const screenshot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`dist/weekly-review-ui-${width}.png`,Buffer.from(screenshot.data,'base64'));
	}
	await key('Escape'); assert.equal((await read()).count,0);
	assert.ok(await evaluate("JSON.stringify(app.plugins.plugins['contribution-graph-local'].activityService.getSettings())===window.__reviewUI.settings"));
	evidence.passed=true;
	await writeFile('dist/weekly-review-ui-evidence.json',JSON.stringify(evidence,null,2));
	console.log(JSON.stringify(evidence));
} finally {
	await call('Emulation.clearDeviceMetricsOverride').catch(()=>{});
	if(initialized)await evaluate(`(()=>{const p=app.plugins.plugins['contribution-graph-local'],q=window.__reviewUI;if(!q)return;p.activityService.getWeeklyReview=q.query;for(const m of p.weeklyReviewModals.values())m.close();document.body.classList.toggle('theme-dark',q.dark);document.body.classList.toggle('theme-light',q.light);if(q.font)document.body.style.setProperty('--font-text',q.font);else document.body.style.removeProperty('--font-text');delete window.__reviewUI;return true})()`).catch(error=>console.error('验收恢复失败',error));
	socket.close();
}
