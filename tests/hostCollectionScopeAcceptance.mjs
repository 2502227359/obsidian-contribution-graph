import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

// 仅连接隔离验收库，不向正式库写入样例或变更采集范围。
const endpoint = "http://127.0.0.1:9231";
const targets = await (await fetch(endpoint + "/json/list")).json();
const target = targets.find(item => item.type === "page" && item.url.startsWith("app://"));
assert.ok(target, "隔离 Obsidian 实例未启动");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
socket.onmessage = event => {
	const response = JSON.parse(event.data), task = pending.get(response.id);
	if (!task) return;
	pending.delete(response.id);
	response.error ? task.reject(response.error) : task.resolve(response.result);
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
	const id = ++sequence;
	pending.set(id, { resolve, reject });
	socket.send(JSON.stringify({ id, method, params }));
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(expression) {
	const result = await call("Runtime.evaluate", {
		expression: "window.__scopePromise=Promise.resolve(eval(" + JSON.stringify(expression) + "))",
		returnByValue: true, awaitPromise: true, userGesture: true,
	});
	assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description);
	return result.result.value;
}
async function until(expression, expected, description) {
	for (let attempt = 0; attempt < 40; attempt++) {
		if (await evaluate(expression) === expected) return;
		await wait(100);
	}
	assert.fail(description);
}
const plugin = "app.plugins.plugins['contribution-graph-local']";
const service = plugin + ".activityService", qa = "window.__collectionScopeQA";
const settingsDocument = "app.setting.activeTab.containerEl.ownerDocument";
const evidence = {};
let initialized = false;
try {
	assert.ok((await evaluate("app.vault.adapter.basePath.replaceAll('\\\\','/')")).endsWith("/dist/time-acceptance/vault"));
	initialized = true;
	await evaluate(`(async()=>{
		const p=${plugin},s=p.activityService,tag='采集范围验收-'+Date.now();
		window.__collectionScopeQA={settings:s.getSettings(),tag,root:tag+'.md',other:tag+'未选.md',
			clinical:'临床医学/'+tag+'.md',font:document.body.style.getPropertyValue('--font-text'),
			interfaceFont:document.body.style.getPropertyValue('--font-interface'),
			shouldUsePopout:app.setting.shouldUsePopout};
		p.timeObserver.stop();s.pauseTimeActivity();app.setting.close();
		activeWindow=window;activeDocument=document;app.setting.shouldUsePopout=()=>false;
		if(!app.vault.getAbstractFileByPath('临床医学'))await app.vault.createFolder('临床医学');
		for(const path of [${qa}.root,${qa}.other,${qa}.clinical])await app.vault.create(path,'隔离范围验收');
		await s.setTrackedFolders(['临床医学']);await s.setTrackedFiles([]);
		await s.setTimeTrackingEnabled(true);await s.resumeTimeTrackingForSession();
		document.body.style.setProperty('--font-text','霞鹜文楷');
		document.body.style.setProperty('--font-interface','霞鹜文楷');
		app.setting.open();app.setting.openTabById('contribution-graph-local');return true;
	})()`);
	await until(`!!${settingsDocument}.querySelector('.cg-settings-section[data-section=scope]')`, true, "未打开采集范围设置");
	assert.equal(await evaluate(`(()=>{const section=${settingsDocument}.querySelector('.cg-settings-section[data-section=scope]');
		const button=[...section.querySelectorAll('button')].find(e=>e.textContent==='选择笔记');button?.click();return !!button})()`), true);
	await until(`!!${settingsDocument}.querySelector('.prompt-input')`, true, "指定笔记选择器未打开");
	await evaluate(`(()=>{const input=${settingsDocument}.querySelector('.prompt-input');input.value=${qa}.tag;
		input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
	await until(`Array.from(${settingsDocument}.querySelectorAll('.suggestion-item')).some(e=>e.textContent===${qa}.root)`, true, "根目录笔记不在搜索结果");
	await evaluate(`(()=>{[...${settingsDocument}.querySelectorAll('.suggestion-item')].find(e=>e.textContent===${qa}.root).click();return true})()`);
	await until(`${service}.getSettings().trackedFiles.includes(${qa}.root)`, true, "选择笔记没有写入采集范围");
	assert.deepEqual(await evaluate(`${service}.getSettings().trackedFolders`), ["临床医学"]);
	evidence.rootNotePicker = true;
	assert.equal(await evaluate(`(()=>{const d=${settingsDocument};return d.defaultView.getComputedStyle(d.querySelector('.cg-settings-section[data-section=scope]')).fontFamily.includes('霞鹜文楷')})()`), true);
	evidence.font = true;
	await evaluate("app.setting.close();true");
	for (const [path, reason] of [[`${qa}.root`, "ACTIVE"], [`${qa}.clinical`, "ACTIVE"], [`${qa}.other`, "OUT_OF_SCOPE"], ["'Homepage.md'", "OUT_OF_SCOPE"], ["'activity://yolo-chat'", "ACTIVE"]]) {
		assert.equal(await evaluate(`(()=>{const s=${service};s.recordTimeActivity(${path});const reason=s.getTimeTrackingSnapshot().reason;s.pauseTimeActivity();return reason})()`), reason);
	}
	evidence.unionAdmission = true;
	await evaluate(`(async()=>{${service}.recordTimeActivity(${qa}.root);await new Promise(r=>setTimeout(r,250));${service}.pauseTimeActivity();await ${service}.flush();return true})()`);
	assert.equal(await evaluate(`${service}.getDailyTimeStats().flatMap(day=>day.documents).some(row=>row.path===${qa}.root&&row.seconds>0)`), true);
	assert.equal(await evaluate(`${service}.getActivityTimelineDay({date:new Date().toLocaleDateString('sv-SE')}).blocks.some(block=>block.path===${qa}.root)`), true);
	evidence.rootNoteRecorded = true;
	await evaluate(`(async()=>{await app.plugins.disablePlugin('contribution-graph-local');await app.plugins.loadManifests();await app.plugins.enablePlugin('contribution-graph-local');${plugin}.timeObserver.stop();return true})()`);
	assert.equal(await evaluate(`${service}.getSettings().trackedFiles.includes(${qa}.root)`), true);
	assert.deepEqual(await evaluate(`${service}.getSettings().trackedFolders`), ["临床医学"]);
	evidence.persistedAfterReload = true;
	await evaluate(`(()=>{app.setting.open();app.setting.openTabById('contribution-graph-local');return true})()`);
	await until(`!!${settingsDocument}.querySelector('.contribution-graph-tracked-file-item')`, true, "重载后指定笔记未显示");
	await evaluate(`(()=>{const item=[...${settingsDocument}.querySelectorAll('.contribution-graph-tracked-file-item')].find(e=>e.textContent.includes(${qa}.root));item.querySelector('.clickable-icon').click();return true})()`);
	await until(`${service}.getSettings().trackedFiles.length`, 0, "移除指定笔记没有保存");
	assert.deepEqual(await evaluate(`${service}.getSettings().trackedFolders`), ["临床医学"]);
	assert.equal(await evaluate(`${service}.getDailyTimeStats().flatMap(day=>day.documents).some(row=>row.path===${qa}.root&&row.seconds>0)`), true);
	evidence.removalKeepsHistory = true;
	evidence.passed = true;
	await writeFile("dist/collection-scope-host-evidence.json", JSON.stringify(evidence, null, 2));
	console.log(JSON.stringify(evidence));
} finally {
	if (initialized) await evaluate(`(async()=>{app.setting.close();const q=${qa},s=${service};if(!q)return;
		s.pauseTimeActivity();await s.setTrackedFolders(q.settings.trackedFolders);await s.setTrackedFiles(q.settings.trackedFiles||[]);
		await s.setTimeTrackingEnabled(q.settings.timeTrackingEnabled);
		for(const path of [q.root,q.other,q.clinical]){const file=app.vault.getAbstractFileByPath(path);if(file)await app.vault.delete(file);}
		if(q.font)document.body.style.setProperty('--font-text',q.font);else document.body.style.removeProperty('--font-text');
		if(q.interfaceFont)document.body.style.setProperty('--font-interface',q.interfaceFont);else document.body.style.removeProperty('--font-interface');
		app.setting.shouldUsePopout=q.shouldUsePopout;
		${plugin}.timeObserver.start();delete window.__collectionScopeQA;return true})()`).catch(error => console.error("隔离验收清理失败", error));
	await call("Runtime.evaluate", { expression: "delete window.__scopePromise" }).catch(() => {});
	socket.close();
}
