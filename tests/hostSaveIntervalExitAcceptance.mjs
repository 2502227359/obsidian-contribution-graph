import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = path.resolve(process.env.OBSIDIAN_TEST_PROFILE || path.join(repoRoot, "dist", "time-acceptance", "profile"));
const vault = path.resolve(process.env.OBSIDIAN_TEST_VAULT || path.join(repoRoot, "dist", "time-acceptance", "vault"));
const executable = process.env.OBSIDIAN_TEST_EXE || "C:/Program Files/Obsidian/Obsidian.exe";
const port = Number(process.env.OBSIDIAN_TEST_PORT || 9231);
const endpoint = process.env.OBSIDIAN_TEST_CDP || `http://127.0.0.1:${port}`;
const pluginId = "contribution-graph-local";
const statsRoot = "Template/数据/学习统计";
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const expectedProfile = path.resolve(repoRoot, "dist", "time-acceptance", "profile");
const expectedVault = path.resolve(repoRoot, "dist", "time-acceptance", "vault");
assert.equal(profile.toLowerCase(), expectedProfile.toLowerCase(), "隔离 profile 必须固定在项目 dist/time-acceptance/profile");
assert.equal(vault.toLowerCase(), expectedVault.toLowerCase(), "隔离 vault 必须固定在项目 dist/time-acceptance/vault");
assert.equal(port, 9231, "真实退出验收只允许使用隔离 CDP 端口9231");

async function listTargets() {
	try {
		const response = await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(1000) });
		return response.ok ? await response.json() : [];
	} catch {
		return null;
	}
}

async function waitForTarget(timeout = 60000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const targets = await listTargets();
		const target = targets?.find(item => item.type === "page" && item.url.startsWith("app://"));
		if (target) return target;
		await wait(250);
	}
	throw new Error(`等待隔离 Obsidian 页面超时：${endpoint}`);
}

async function waitForPortGone(timeout = 60000) {
	const deadline = Date.now() + timeout;
	let lastTargets = [];
	while (Date.now() < deadline) {
		const targets = await listTargets();
		if (targets === null) return;
		lastTargets = targets;
		await wait(250);
	}
	throw new Error(`隔离 Obsidian 已关闭窗口但 CDP 端口仍在响应：${JSON.stringify(lastTargets.map(item => item.url))}`);
}

function launchIsolated() {
	const child = spawn(executable, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`], {
		detached: true,
		stdio: "ignore",
		windowsHide: true,
	});
	child.unref();
}

async function ensureIsolatedTarget() {
	const existing = await listTargets();
	if (!existing || !existing.some(item => item.type === "page" && item.url.startsWith("app://"))) {
		launchIsolated();
	}
	const target = await waitForTarget();
	const client = await connect(target);
	await client.waitUntil("typeof app !== 'undefined' && Boolean(app.vault?.adapter?.basePath)", 60000);
	const actualVault = (await client.evaluate("app.vault.adapter.basePath.replace(/\\\\/g, '/')")).replace(/\\/g, "/");
	assert.equal(actualVault.toLowerCase(), vault.replace(/\\/g, "/").toLowerCase(), "仅允许操作项目内隔离 vault");
	await client.waitUntil(`Boolean(window.contributionGraphApi && app.workspace.layoutReady && app.plugins.plugins[${JSON.stringify(pluginId)}]?.timeObserver)`, 60000);
	return client;
}

async function connect(target) {
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.onopen = resolve;
		socket.onerror = reject;
	});
	let sequence = 0;
	const pending = new Map();
	socket.onmessage = event => {
		const message = JSON.parse(event.data);
		if (!message.id) return;
		const task = pending.get(message.id);
		if (!task) return;
		pending.delete(message.id);
		message.error ? task.reject(message.error) : task.resolve(message.result);
	};
	socket.onclose = () => {
		for (const task of pending.values()) task.reject(new Error("CDP 连接已关闭"));
		pending.clear();
	};
	const call = (method, params = {}) => new Promise((resolve, reject) => {
		if (socket.readyState !== WebSocket.OPEN) {
			reject(new Error("CDP 连接未打开"));
			return;
		}
		const id = ++sequence;
		pending.set(id, { resolve, reject });
		try { socket.send(JSON.stringify({ id, method, params })); }
		catch (error) { pending.delete(id); reject(error); }
	});
	const evaluate = async expression => {
		const result = await call("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
			userGesture: true,
		});
		assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description || result.exceptionDetails?.text);
		return result.result.value;
	};
	const waitUntil = async (expression, timeout = 20000) => {
		const deadline = Date.now() + timeout;
		let lastError;
		while (Date.now() < deadline) {
			try {
				if (await evaluate(expression)) return;
			} catch (error) {
				lastError = error;
			}
			await wait(150);
		}
		throw new Error(`宿主状态等待超时：${expression}${lastError ? `；${lastError}` : ""}`);
	};
	const fire = (method, params = {}) => {
		if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: ++sequence, method, params }));
	};
	return {
		socket,
		call,
		evaluate,
		waitUntil,
		fire,
		close: () => socket.close(),
	};
}

function canonicalFiles(files) {
	return [...files].sort((a, b) => a[0].localeCompare(b[0])).map(([name, data]) => [name, data]);
}

function sameFiles(left, right) {
	return JSON.stringify(canonicalFiles(left)) === JSON.stringify(canonicalFiles(right));
}

function createMetricsExpression(date) {
	return `(()=>{const s=app.plugins.plugins[${JSON.stringify(pluginId)}].activityService;const d=${JSON.stringify(date)};const e=s.getDailyEditStats({fromDate:d,toDate:d})[0];const h=s.getHourlyTimeStats({fromDate:d,toDate:d});return {added:e?.addedChars||0,deleted:e?.deletedChars||0,documents:e?.documents||[],seconds:h.reduce((n,x)=>n+x.seconds,0),status:s.getSaveStatus()}})()`;
}

async function readStatsFiles(client, root = statsRoot) {
	return client.evaluate(`(async()=>{const root=${JSON.stringify(root)};const files=[];for(const f of app.vault.getFiles().filter(file=>file.path===root||file.path.startsWith(root+'/'))){files.push([f.path,await app.vault.read(f)])}return files})()`);
}

async function snapshot(client) {
	return client.evaluate(`(async()=>{const p=app.plugins.plugins[${JSON.stringify(pluginId)}];const configPath=p.manifest.dir+'/data.json';let configFile=null;try{configFile=await app.vault.adapter.read(configPath)}catch{};const files=[];for(const f of app.vault.getFiles().filter(file=>file.path.startsWith(${JSON.stringify(statsRoot)}+'/'))){files.push([f.path,await app.vault.read(f)])}return {exportData:p.activityService.exportData(),settings:p.activityService.getSettings(),files,pluginData:await p.loadData(),configFile,previousPath:app.workspace.activeLeaf?.view?.file?.path||null,folder:p.activityService.getStatisticsFolder()}})()`);
}

async function prepareWindow(client) {
	// 退出用例专门保留未保存数据；后台强制保存由独立服务用例验证，不能提前替本用例保存。
	await client.evaluate("(()=>{const p=app.plugins.plugins['contribution-graph-local'];p.activityService.handleAppSuspend=async()=>{};p.timeObserver.stop();app.setting.close();document.querySelector('dialog[open]')?.close();const w=require('@electron/remote').getCurrentWindow();w.restore();w.show();w.focus()})()");
}

async function createEditableNote(client, notePath) {
	await client.evaluate(`(async()=>{const path=${JSON.stringify(notePath)};const parent=path.split('/').slice(0,-1).join('/');let current='';for(const part of parent?parent.split('/'):[]){current=current?current+'/'+part:part;if(!app.vault.getAbstractFileByPath(current))await app.vault.createFolder(current)}const old=app.vault.getAbstractFileByPath(path);if(old)await app.vault.delete(old);const file=await app.vault.create(path,'');await app.workspace.getLeaf(false).openFile(file,{state:{mode:'source'}})})()`);
	await client.waitUntil("Boolean([...app.workspace.activeLeaf?.view?.containerEl?.querySelectorAll('.cm-editor .cm-content')||[]].find(e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0))");
	await client.evaluate("(()=>{const e=[...app.workspace.activeLeaf.view.containerEl.querySelectorAll('.cm-editor .cm-content')].find(x=>x.getBoundingClientRect().width>0&&x.getBoundingClientRect().height>0);e.focus();e.scrollIntoView({block:'center'})})()");
}

async function typeTrustedText(client, text) {
	await client.call("Input.insertText", { text });
	await client.waitUntil(`(()=>{const e=[...app.workspace.activeLeaf?.view?.containerEl?.querySelectorAll('.cm-editor .cm-content')||[]].find(x=>x.getBoundingClientRect().width>0&&x.getBoundingClientRect().height>0);return e?.textContent===${JSON.stringify(text)}})()`);
}

async function installDelayedRecordWrites(client) {
	const result = await client.evaluate(`(()=>{const v=app.vault;const prefix=${JSON.stringify(statsRoot+'/记录/')};if(v.__cgExitAuditPatch)return v.__cgExitAuditPatch;const process=v.process.bind(v),create=v.create.bind(v),delay=()=>new Promise(resolve=>setTimeout(resolve,400));v.process=async(file,fn)=>{if(file?.path?.startsWith(prefix))await delay();return process(file,fn)};v.create=async(path,data)=>{if(typeof path==='string'&&path.startsWith(prefix))await delay();return create(path,data)};const fs=require('fs'),writeSync=fs.writeFileSync;fs.writeFileSync=function(file,...args){if(typeof file==='string'&&file.replaceAll(String.fromCharCode(92),'/').includes(prefix))(()=>{const until=Date.now()+400;while(Date.now()<until){}})();return writeSync.call(this,file,...args)};v.__cgExitAuditPatch={prefix,delayMs:400};return v.__cgExitAuditPatch})()`);
	assert.equal(result.delayMs, 400, "记录文件延迟补丁必须安装在隔离实例");
}

async function installQuitReceipt(client) {
	const receiptPath = path.join(repoRoot, "dist", "save-interval-quit-receipt.txt");
	fs.writeFileSync(receiptPath, "");
	await client.evaluate(`(()=>{const s=app.plugins.plugins[${JSON.stringify(pluginId)}].activityService;if(s.__cgExitAuditUnload)return false;const unload=s.unload.bind(s),receipt=${JSON.stringify(receiptPath)};s.__cgExitAuditUnload=true;s.unload=()=>{require('fs').appendFileSync(receipt,'START;');const promise=unload();require('fs').appendFileSync(receipt,s.finalSnapshotSavedSynchronously?'SYNC_SAVED;':'ASYNC_PENDING;');promise.then(()=>require('fs').appendFileSync(receipt,'RESOLVED;'),error=>require('fs').appendFileSync(receipt,'REJECTED:'+String(error)+';'));return promise};return true})()`);
}

async function closeAndRestart(client, mode, evidence, expected) {
	const started = Date.now();
	const expression = mode === "window.close()"
		? "require('@electron/remote').getCurrentWindow().close()"
		: "require('@electron/remote').app.quit()";
	client.fire("Runtime.evaluate", { expression, awaitPromise: false, returnByValue: false });
	await waitForPortGone();
	const receiptMessages = fs.readFileSync(path.join(repoRoot, "dist", "save-interval-quit-receipt.txt"), "utf8").split(";").filter(Boolean);
	client.close();
	assert.ok(receiptMessages.includes("START"), "quit 事件必须调用 activityService.unload()");
	assert.ok(receiptMessages.includes("SYNC_SAVED") || receiptMessages.includes("RESOLVED"), "关闭前必须完成同步检查点或异步退出任务");
	const elapsedMs = Date.now() - started;
	assert.ok(elapsedMs >= 350, `退出必须等待400ms记录写入，实际只等待 ${elapsedMs}ms`);
	const versions = new Map();
	for (const name of fs.readdirSync(path.join(vault, statsRoot, "记录")).filter(name => name.endsWith(".json"))) {
		const record = JSON.parse(fs.readFileSync(path.join(vault, statsRoot, "记录", name), "utf8"));
		if (record.kind !== "statistics") continue;
		if (!versions.has(record.id) || versions.get(record.id).revision < record.revision) versions.set(record.id, record);
	}
	const checkpointChars = [...versions.values()].reduce((sum, record) => sum + (record.data.dailyStats[expected.date]?.documents[expected.path]?.addedChars || 0), 0);
	const checkpointSeconds = [...versions.values()].reduce((sum, record) => sum + Object.values(record.data.timeActivity.buckets).reduce((n, bucket) => n + (bucket.documents[expected.path] || 0), 0), 0);
	assert.equal(checkpointChars, expected.chars, "进程退出后，最后未落账字数必须已在磁盘检查点中");
	assert.ok(Math.abs(checkpointSeconds - expected.seconds) <= 1e-6, `退出检查点秒数必须精确保留：${checkpointSeconds}，预期${expected.seconds}`);
	evidence.push({ mode, elapsedMs, portGone: true, receiptMessages, checkpointChars, checkpointSeconds });
	launchIsolated();
	const target = await waitForTarget();
	const next = await connect(target);
	await next.waitUntil("typeof app !== 'undefined' && Boolean(app.vault?.adapter?.basePath)", 60000);
	const actualVault = (await next.evaluate("app.vault.adapter.basePath.replace(/\\\\/g, '/')")).replace(/\\/g, "/");
	assert.equal(actualVault.toLowerCase(), vault.replace(/\\/g, "/").toLowerCase(), "重开后仍必须是隔离 vault");
	await next.waitUntil(`Boolean(window.contributionGraphApi && app.workspace.layoutReady && app.plugins.plugins[${JSON.stringify(pluginId)}]?.timeObserver)`, 60000);
	await prepareWindow(next);
	return next;
}

async function restoreIsolation(client, original, testPaths) {
	await client.evaluate(`(async()=>{const p=app.plugins.plugins[${JSON.stringify(pluginId)}];p.timeObserver?.stop();await p.activityService?.unload();await p.activityService.saveQueue.catch(()=>{});await p.activityService.statistics.queue.catch(()=>{});const root=${JSON.stringify(statsRoot)};const physical=async dir=>{const listing=await app.vault.adapter.list(dir);let paths=[...listing.files];for(const child of listing.folders)paths.push(...await physical(child));return paths};for(const path of await physical(root))await app.vault.adapter.remove(path);const ensure=async path=>{let current='';for(const part of path.split('/').slice(0,-1)){current=current?current+'/'+part:part;if(!await app.vault.adapter.exists(current))await app.vault.adapter.mkdir(current)}};for(const [path,data] of ${JSON.stringify(original.files)}){await ensure(path);await app.vault.adapter.write(path,data)}const configPath=p.manifest.dir+'/data.json';if(${JSON.stringify(original.configFile)}===null){if(await app.vault.adapter.exists(configPath))await app.vault.adapter.remove(configPath)}else await app.vault.adapter.write(configPath,${JSON.stringify(original.configFile)});for(const path of ${JSON.stringify(testPaths)}){if(await app.vault.adapter.exists(path))await app.vault.adapter.remove(path)}})()`);
}

function readPhysicalStatistics() {
	const result = [];
	const visit = folder => {
		for (const entry of fs.readdirSync(folder, {withFileTypes: true})) {
			const target = path.join(folder, entry.name);
			if (entry.isDirectory()) visit(target);
			else if (entry.isFile()) result.push([path.relative(vault, target).split(path.sep).join("/"), fs.readFileSync(target, "utf8")]);
		}
	};
	visit(path.join(vault, statsRoot));
	return result;
}

async function shutdownForCleanup(client) {
	if (!client) return;
	client.fire("Runtime.evaluate", { expression: "require('@electron/remote').app.quit()", awaitPromise: false, returnByValue: false });
	await wait(200);
	client.close();
	await waitForPortGone();
}

const evidence = {
	pass: false,
	profile,
	vault,
	executable,
	port,
	intervalSeconds: 300,
	backgroundSaveSuppressedForExitCase: true,
	closeEvents: [],
};
let client;
let original;
let testPaths = [];
let cleanupError;

try {
	client = await ensureIsolatedTarget();
	await prepareWindow(client);
	original = await snapshot(client);
	fs.writeFileSync(path.join(repoRoot, "dist", "save-interval-exit-original.json"), JSON.stringify(original));
	assert.equal(original.folder, statsRoot, "统计目录必须是普通目录 Template/数据/学习统计");
	const originalInterval = original.settings.saveIntervalSeconds;
	const date = await client.evaluate("(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`})()");
	await client.evaluate(`(async()=>{const s=app.plugins.plugins[${JSON.stringify(pluginId)}].activityService;await s.setTrackingEnabled(true);await s.setStrictUserInputOnly(true);await s.setExcludeMarkdownFormatting(true);await s.setTimeTrackingEnabled(true)})()`);
	await client.evaluate(`app.plugins.plugins[${JSON.stringify(pluginId)}].activityService.setSaveIntervalSeconds(300)`);
	await client.evaluate(`app.plugins.plugins[${JSON.stringify(pluginId)}].activityService.flush()`);
	await client.waitUntil(`app.plugins.plugins[${JSON.stringify(pluginId)}].activityService.getSettings().saveIntervalSeconds===300`, 30000);
	const beforeWorkFiles = await readStatsFiles(client);
	const base = await client.evaluate(createMetricsExpression(date));
	const trackedFolders = await client.evaluate(`app.plugins.plugins[${JSON.stringify(pluginId)}].activityService.getSettings().trackedFolders`);
	const id = crypto.randomUUID();
	const noteOne = `${trackedFolders.length ? `${trackedFolders[0]}/` : ""}退出保存验收-${id}-一.md`;
	const noteTwo = `${trackedFolders.length ? `${trackedFolders[0]}/` : ""}退出保存验收-${id}-二.md`;
	const graphNote = `${trackedFolders.length ? `${trackedFolders[0]}/` : ""}退出保存图表验收-${id}.md`;
	testPaths = [noteOne, noteTwo, graphNote];
	const textOne = `ExitSaveOne${id.replace(/-/g, "").slice(0, 12)}`;
	const textTwo = `ExitSaveTwo${id.replace(/-/g, "").slice(0, 12)}`;
	await createEditableNote(client, noteOne);
	const beforeSeconds = base.seconds;
	await client.evaluate(`app.plugins.plugins[${JSON.stringify(pluginId)}].activityService.recordTimeActivity(${JSON.stringify(noteOne)})`);
	await wait(16000);
	await client.evaluate(`app.plugins.plugins[${JSON.stringify(pluginId)}].activityService.checkpointTimeActivity()`);
	await client.evaluate(`app.plugins.plugins[${JSON.stringify(pluginId)}].activityService.pauseTimeActivity()`);
	const afterCheckpoint = await client.evaluate(createMetricsExpression(date));
	const timeAddedSeconds = afterCheckpoint.seconds - beforeSeconds;
	assert.ok(timeAddedSeconds >= 15, `真实计时至少应增加15秒，实际 ${timeAddedSeconds} 秒`);
	await typeTrustedText(client, textOne);
	const expectedFirstChars = base.added + textOne.length;
	const expectedFirstDocChars = (base.documents.find(item => item.path === noteOne)?.addedChars || 0) + textOne.length;
	const preCloseFiles = await readStatsFiles(client);
	assert.ok(sameFiles(beforeWorkFiles, preCloseFiles), "保存间隔未到期前不得写入普通统计记录文件");
	const preClose = await client.evaluate(createMetricsExpression(date));
	assert.equal(preClose.status, "有待保存数据", "退出前必须仍有未保存统计数据");
	await installQuitReceipt(client);
	await installDelayedRecordWrites(client);
	client = await closeAndRestart(client, "window.close()", evidence.closeEvents, {date, path: noteOne, chars: textOne.length, seconds: timeAddedSeconds});
	await client.waitUntil(`app.plugins.plugins[${JSON.stringify(pluginId)}].activityService.getSettings().saveIntervalSeconds===300`, 30000);
	const afterFirstReopen = await client.evaluate(createMetricsExpression(date));
	const firstDoc = afterFirstReopen.documents.find(item => item.path === noteOne);
	assert.equal(afterFirstReopen.added, expectedFirstChars, "窗口正常关闭重开后字数不得重复或丢失");
	assert.equal(firstDoc?.addedChars || 0, expectedFirstDocChars, "窗口正常关闭重开后同篇明细必须保留");
	assert.ok(afterFirstReopen.seconds + 1e-6 >= afterCheckpoint.seconds, "重开可新增启动活动，但不能丢失已精确核对的退出检查点时长");
	const beforeSecondFiles = await readStatsFiles(client);
	const secondBase = await client.evaluate(createMetricsExpression(date));
	await createEditableNote(client, noteTwo);
	await typeTrustedText(client, textTwo);
	const expectedFinalChars = secondBase.added + textTwo.length;
	const expectedSecondDocChars = (secondBase.documents.find(item => item.path === noteTwo)?.addedChars || 0) + textTwo.length;
	const secondPreCloseFiles = await readStatsFiles(client);
	assert.ok(sameFiles(beforeSecondFiles, secondPreCloseFiles), "第二轮未到保存间隔也不得写入普通统计记录文件");
	assert.equal((await client.evaluate(createMetricsExpression(date))).status, "有待保存数据", "app.quit 前必须仍有未保存字数");
	await installQuitReceipt(client);
	await installDelayedRecordWrites(client);
	client = await closeAndRestart(client, "app.quit()", evidence.closeEvents, {date, path: noteTwo, chars: textTwo.length, seconds: 0});
	await client.waitUntil(`app.plugins.plugins[${JSON.stringify(pluginId)}].activityService.getSettings().saveIntervalSeconds===300`, 30000);
	const finalStats = await client.evaluate(createMetricsExpression(date));
	const finalFirstDoc = finalStats.documents.find(item => item.path === noteOne);
	const finalSecondDoc = finalStats.documents.find(item => item.path === noteTwo);
	assert.equal(finalStats.added, expectedFinalChars, "两次真实退出重开后总字数必须合并且不重复");
	assert.equal(finalSecondDoc?.addedChars || 0, expectedSecondDocChars, "app.quit 后未到期字数同篇明细必须落盘");
	assert.equal(finalFirstDoc?.addedChars || 0, expectedFirstDocChars, "第一轮同篇明细必须保持单次统计");
	assert.ok(finalStats.seconds + 1e-6 >= afterCheckpoint.seconds, "两次重开后仍须保留退出检查点全部时长");
	const fences = "```";
	const fixture = [
		"# 退出保存图表验收", "",
		`${fences}contributionGraph`, "graphType: default", "dateRangeType: LATEST_DAYS", "dateRangeValue: 7", "dataSource:", "  type: EDIT_ACTIVITY", fences,
		"", `${fences}contributionGraph`, "graphType: hourly", "dateRangeType: LATEST_DAYS", "dateRangeValue: 7", "dataSource:", "  type: TIME_ACTIVITY", fences,
	].join("\n");
	await client.evaluate(`(async()=>{const path=${JSON.stringify(graphNote)},text=${JSON.stringify(fixture)};const f=await app.vault.create(path,text);await app.workspace.getLeaf(false).openFile(f,{state:{mode:'preview'}})})()`);
	await client.waitUntil(`([...app.workspace.activeLeaf.view.containerEl.querySelectorAll('.contribution-graph')].filter(e=>e.getBoundingClientRect().width>0).length===2)`);
	const graphs = await client.evaluate(`(()=>{const gs=[...app.workspace.activeLeaf.view.containerEl.querySelectorAll('.contribution-graph')].filter(e=>e.getBoundingClientRect().width>0);return {count:gs.length,hourBars:gs.filter(e=>e.querySelector('.charts.hourly-profile')).reduce((n,e)=>n+e.querySelectorAll('.cg-hour-bar').length,0),metrics:gs.every(e=>Boolean(e.querySelector('.cg-metric-value')))}})()`);
	assert.deepEqual(graphs, { count: 2, hourBars: 24, metrics: true }, "重开后字数图和时长图必须正常渲染");
	evidence.intervalPersisted = true;
	evidence.baseline = base;
	evidence.first = { expectedChars: expectedFirstChars, expectedDocumentChars: expectedFirstDocChars, checkpoint: afterCheckpoint, afterReopen: afterFirstReopen };
	evidence.second = { expectedChars: expectedFinalChars, expectedDocumentChars: expectedSecondDocChars, afterReopen: finalStats };
	evidence.graphs = graphs;
	evidence.originalIntervalSeconds = originalInterval;
	evidence.testNotes = testPaths;
	evidence.pass = true;
} catch (error) {
	evidence.error = String(error?.stack || error);
	throw error;
} finally {
	try {
		if (original) {
			let cleanupClient = client;
			if (!cleanupClient || cleanupClient.socket.readyState !== WebSocket.OPEN) cleanupClient = await ensureIsolatedTarget();
			await Promise.race([
				restoreIsolation(cleanupClient, original, testPaths),
				wait(30000).then(() => { throw new Error("恢复隔离验收快照超时"); }),
			]);
			await shutdownForCleanup(cleanupClient);
			assert.ok(sameFiles(readPhysicalStatistics(), original.files), "真实退出验收后应逐字恢复原普通统计目录");
			evidence.cleanupRestored = true;
		}
	} catch (error) {
		cleanupError = String(error?.stack || error);
		evidence.cleanupError = cleanupError;
		evidence.pass = false;
		process.exitCode = 1;
	}
	console.log(JSON.stringify(evidence, null, 2));
}
