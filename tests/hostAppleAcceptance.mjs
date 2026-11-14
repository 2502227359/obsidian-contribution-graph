import assert from "node:assert/strict";

// 只连接独立验收实例，禁止在正式笔记仓库运行会改变界面的测试。
const endpoint = process.env.OBSIDIAN_TEST_CDP || "http://127.0.0.1:9231";
const targets = await (await fetch(`${endpoint}/json/list`)).json();
const target = targets.find(item => item.type === "page" && item.url.startsWith("app://"));
assert.ok(target, "独立 Obsidian 验收窗口必须已经启动");
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
const call = (method, params) => new Promise((resolve, reject) => {
	const id = ++sequence;
	pending.set(id, { resolve, reject });
	socket.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expression) {
	const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
	assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description);
	return result.result.value;
}

try {
	const vault = await evaluate("app.vault.adapter.basePath.replace(/\\\\/g,'/')");
	assert.ok(vault.endsWith("/dist/time-acceptance/vault"), "仅允许使用项目内的独立验收仓库");
	await evaluate("app.setting.close();document.querySelector('.modal-header-button')?.click();app.workspace.activeLeaf.view.containerEl.style.removeProperty('width');app.workspace.activeLeaf.view.containerEl.style.removeProperty('max-width')");
	await evaluate("app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('验收.md'),{state:{mode:'preview'}})");
	const graphs = await evaluate(`(() => {
		const root = app.workspace.activeLeaf.view.containerEl;
		return [...root.querySelectorAll('.contribution-graph')].filter(e => e.getBoundingClientRect().width > 0).map(e => ({
			hourly: Boolean(e.querySelector('.charts.hourly-profile')),
			caption: e.querySelector('.cg-metric-caption')?.textContent,
			value: e.querySelector('.cg-metric-value')?.getAttribute('aria-label'),
			context: e.querySelector('.graph-subtitle')?.textContent,
			graphLegend: Boolean(e.querySelector('.graph-legend')),
			footerAfterChart: Boolean(e.querySelector('.charts')?.nextElementSibling?.matches('.graph-legend')),
			timeKey: Boolean(e.querySelector('.cg-time-key')),
		}));
	})()`);
	assert.equal(graphs.length, 2, "展示页必须有每日图和小时图");
	const dailyGraph = graphs.find(graph => !graph.hourly);
	const hourlyGraph = graphs.find(graph => graph.hourly);
	assert.ok(dailyGraph && hourlyGraph, "展示页必须同时包含每日图和新版小时图");
	for (const graph of graphs) assert.ok(graph.value && graph.context);
	assert.equal(dailyGraph.caption, "所选范围累计时长");
	assert.equal(dailyGraph.graphLegend, true, "每日图必须保留旧规则图例");
	assert.equal(dailyGraph.footerAfterChart, true, "每日图规则图例必须位于图表之后");
	assert.equal(hourlyGraph.caption, "当日活跃时长", "单日小时图指标必须显示当日活跃时长");
	assert.equal(hourlyGraph.graphLegend, false, "小时图不应显示旧规则图例");
	assert.equal(hourlyGraph.timeKey, true, "小时图必须显示采集状态图例");
	const graphFontFollowsHost = await evaluate(`(() => {
		const root=[...app.workspace.activeLeaf.view.containerEl.querySelectorAll('.contribution-graph')].find(e=>e.getBoundingClientRect().width>0);
		root.style.setProperty('--font-text','"验收正文字体", serif');
		const follows=getComputedStyle(root).fontFamily.includes('验收正文字体');
		root.style.removeProperty('--font-text');return follows;
	})()`);
	assert.equal(graphFontFollowsHost, true, '图表必须跟随 Obsidian 正文字体');
	const detail = await evaluate(`(async () => {
		const root = app.workspace.activeLeaf.view.containerEl;
		const findChart = () => [...root.querySelectorAll('.charts.hourly-profile')].find(e => e.getBoundingClientRect().width > 0);
		let chart = findChart();
		const dateInput = chart?.querySelector('.cg-time-date-nav input[type="date"]');
		const selectedDate = window.contributionGraphApi.getHourlyTimeStats().filter(row=>row.seconds>0 && row.date>=dateInput.min && row.date<=dateInput.max).map(row=>row.date).sort().at(-1);
		if (dateInput) {
			dateInput.value = selectedDate;
			dateInput.dispatchEvent(new Event('change', {bubbles: true}));
			await new Promise(resolve => requestAnimationFrame(resolve));
		}
		chart = findChart();
		const bar = chart?.querySelector('.cg-hour-bar:not(.is-zero):not(.is-future):not(.is-untracked):not(:disabled)');
		if (bar) {
			bar.click();
			await new Promise(resolve => requestAnimationFrame(resolve));
		}
		const main = chart?.closest('.main');
		return {
			expectedDate: selectedDate,
			selectedDate: chart?.dataset.selectedDate,
			dateValue: chart?.querySelector('.cg-time-date-nav input[type="date"]')?.value,
			bar: Boolean(bar),
			heading: main?.querySelector('.cg-detail-heading')?.textContent,
			rows: main?.querySelectorAll('.cg-document-value').length || 0,
		};
	})()`);
	assert.ok(detail.expectedDate, "独立仓库必须存在非零时长样例");
	assert.equal(detail.selectedDate, detail.expectedDate, "小时图必须先切换到有数据的日期");
	assert.equal(detail.dateValue, detail.expectedDate);
	assert.equal(detail.bar, true, "必须能选择非零、非未来且已采集的小时柱");
	assert.ok(detail.heading && detail.rows > 0, "详情必须显示时段和笔记用时");
	const narrow = await evaluate(`(() => {
		const view = app.workspace.activeLeaf.view.containerEl;
		view.style.width = '360px'; view.style.maxWidth = '360px';
		const chart = [...view.querySelectorAll('.charts.hourly-profile')].find(e=>e.getBoundingClientRect().width>0);
		const main = chart.closest('.main');
		const detail = chart.closest('.main').querySelector('.activity-container');
		const summary = detail.querySelector('.activity-summary').getBoundingClientRect();
		const list = detail.querySelector('.activity-content').getBoundingClientRect();
		const result = {scrollable: chart.scrollWidth > chart.clientWidth + 1 || main.scrollWidth > main.clientWidth + 1,
			stacked: list.top >= summary.bottom, bars: chart.querySelectorAll('.cg-hour-bar').length};
		view.style.removeProperty('width'); view.style.removeProperty('max-width'); return result;
	})()`);
	assert.equal(narrow.scrollable, false, "360像素窄窗格中小时24柱不能横向溢出");
	assert.equal(narrow.stacked, true, "窄窗格中详情必须纵向排列");
	assert.equal(narrow.bars, 24, "单日图必须保留24个小时柱");
	const theme = await evaluate(`(() => {
		const original = document.body.className;
		const colors = ['theme-light','theme-dark'].map(theme=>{
			document.body.removeClass('theme-light','theme-dark');document.body.addClass(theme);
			return getComputedStyle(document.querySelector('.contribution-graph .main')).backgroundColor;
		}); document.body.className = original; return colors;
	})()`);
	assert.notEqual(theme[0], theme[1], "深浅色表面随宿主切换");
	await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
	assert.ok(Number.parseFloat(await evaluate("getComputedStyle(document.querySelector('.charts.hourly-profile .cg-hour-fill')).transitionDuration")) <= 0.00001, "减少动态效果时取消可感知的小时柱过渡");
	await call('Emulation.setEmulatedMedia', { features: [] });
	await evaluate("(async()=>{await app.workspace.activeLeaf.setViewState({type:'markdown',state:{file:'验收.md',mode:'source',source:false}});app.commands.executeCommandById('contribution-graph-local:create-graph');await new Promise(r=>setTimeout(r,350));})()");
	const editor = await evaluate(`(() => {
		const modal = document.querySelector('.contribution-graph-editor-modal');
		return { preview: Boolean(modal?.querySelector('.cg-editor-preview')), settings: Boolean(modal?.querySelector('.cg-editor-settings')),
			tabs: [...(modal?.querySelectorAll('[role="tab"]') || [])].map(e=>e.textContent),
			footer: [...(modal?.querySelectorAll('.cg-editor-footer button') || [])].map(e=>e.textContent) };
	})()`);
	assert.equal(editor.preview && editor.settings, true, "编辑器必须同时提供配置与预览");
	assert.ok(editor.tabs.includes("高级"), "低频选项必须归入高级页");
	assert.ok(editor.footer.includes("取消") && editor.footer.includes("保存"));
	assert.equal(await evaluate(`(() => {const m=document.querySelector('.contribution-graph-editor-modal');m.style.setProperty('--font-interface','"验收界面字体", serif');const result=getComputedStyle(m).fontFamily.includes('验收界面字体');m.style.removeProperty('--font-interface');return result})()`), true, '编辑器必须跟随 Obsidian 界面字体');
	const editorBehavior = await evaluate(`(async () => {
		const modal = document.querySelector('.contribution-graph-editor-modal');
		const tabs = [...modal.querySelectorAll('[role="tab"]')]; tabs[0].focus();
		tabs[0].dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));
		await new Promise(resolve=>requestAnimationFrame(resolve));
		const selected = tabs[2].getAttribute('aria-selected')==='true' && document.activeElement===tabs[2];
		const footer = modal.querySelector('.cg-editor-footer').getBoundingClientRect();
		const wideFooter = footer.bottom<=modal.getBoundingClientRect().bottom && footer.bottom<=innerHeight;
		modal.style.width='400px';
		const narrowFooter = modal.querySelector('.cg-editor-footer').getBoundingClientRect();
		const inside = narrowFooter.bottom<=modal.getBoundingClientRect().bottom && narrowFooter.bottom<=innerHeight;
		modal.style.removeProperty('width'); return {selected,wideFooter,inside};
	})()`);
	assert.deepEqual(editorBehavior, {selected:true,wideFooter:true,inside:true}, "键盘选中高级页，宽窄布局底栏均可见");
	await evaluate("[...document.querySelectorAll('.cg-editor-footer button')].find(e=>e.textContent==='取消').click()");
	await evaluate("(async()=>{app.setting.open();app.setting.openTabById('contribution-graph-local');await new Promise(r=>setTimeout(r,150));})()");
	const groups = await evaluate("[...app.setting.pluginTabs.find(t=>t.id==='contribution-graph-local').containerEl.querySelectorAll('.cg-settings-section')].map(e=>e.dataset.section)");
	assert.deepEqual(groups, ["time", "characters", "scope", "data"]);
	assert.equal(await evaluate(`(() => {const root=app.setting.pluginTabs.find(t=>t.id==='contribution-graph-local').containerEl;root.style.setProperty('--font-interface','"验收界面字体", serif');const result=root.ownerDocument.defaultView.getComputedStyle(root).fontFamily.includes('验收界面字体');root.style.removeProperty('--font-interface');return result})()`), true, '设置页必须跟随 Obsidian 界面字体');
	await evaluate("app.setting.close()");
	const configFixture = '# 保存验收前文\n\n```contributionGraph\ntitle: 原标题\ngraphType: default\ndateRangeType: LATEST_DAYS\ndateRangeValue: 7\ndataSource:\n  type: TIME_ACTIVITY\n  activityFolders: [临床医学]\ncellStyle:\n  minWidth: 13px\n  minHeight: 17px\nheatScale:\n  type: GOAL\n  goal: 73\n  levels:\n    - { minRatio: 0, color: "#123456" }\n    - { minRatio: 1, color: "#007aff" }\n```\n\n保存验收后文\n';
	await evaluate(`(async()=>{
		const path='界面配置保存验收.md', source=${JSON.stringify(configFixture)};
		const file=app.vault.getAbstractFileByPath(path);
		if(file) await app.vault.modify(file,source); else await app.vault.create(path,source);
		await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath(path),{state:{mode:'preview'}});
		await new Promise(r=>setTimeout(r,300));
		[...app.workspace.activeLeaf.view.containerEl.querySelectorAll('.contribution-graph-codeblock-edit-button')].find(e=>e.getBoundingClientRect().width>0).click();
		await new Promise(r=>setTimeout(r,200));
		const modal=document.querySelector('.contribution-graph-editor-modal'),input=modal.querySelector('input[type=text]');
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'保存后的标题');
		input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,50));
		const tabs=[...modal.querySelectorAll('[role=tab]')]; tabs[1].click();await new Promise(r=>requestAnimationFrame(r));tabs[2].click();await new Promise(r=>requestAnimationFrame(r));
		[...modal.querySelectorAll('.cg-editor-footer button')].find(e=>e.textContent==='保存').click();
		await new Promise(r=>setTimeout(r,300));
	})()`);
	const saved = await evaluate("app.vault.read(app.vault.getAbstractFileByPath('界面配置保存验收.md'))");
	for (const expected of ['title: 保存后的标题','goal: 73','minWidth: 13px','minHeight: 17px','#123456','#007aff','临床医学','保存验收后文']) {
		assert.ok(saved.includes(expected), `阅读模式保存必须持久化并保留配置：${expected}`);
	}
	assert.ok(saved.startsWith('# 保存验收前文\n\n```contributionGraph\n'));
	console.log("宿主验收通过：两种卡片、统计范围、详情、360像素窗格、深浅色、减少动态效果、编辑器键盘及底栏、设置四分组、阅读模式保存及配置保留。");
} finally {
	socket.close();
}
