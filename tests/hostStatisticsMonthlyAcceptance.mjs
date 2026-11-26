import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// 该脚本只连接两个预先启动的隔离 Obsidian 实例。它不会连接正式 CMBK，也不会删除旧版统计。
const actualSync = process.argv.includes("--fast-note-sync");
const testRoot = actualSync ? "monthly-fns-acceptance" : "monthly-acceptance";
const endpointA = actualSync ? "http://127.0.0.1:9253" : "http://127.0.0.1:9251";
const endpointB = actualSync ? "http://127.0.0.1:9254" : "http://127.0.0.1:9252";
const statisticsRoot = "Template/数据/学习统计";
const clock = new Date();
const month = `${clock.getFullYear()}-${String(clock.getMonth() + 1).padStart(2, "0")}`;
const date = `${month}-15`;

class CdpClient {
	constructor(endpoint, device) {
		this.endpoint = endpoint;
		this.vaultPath = fileURLToPath(new URL(`../dist/${testRoot}/vault-${device}`, import.meta.url));
		this.sequence = 0;
		this.pending = new Map();
	}

	async connect() {
		const targets = await (await fetch(`${this.endpoint}/json/list`)).json();
		const target = targets.find(item => item.type === "page" && item.url.startsWith("app://"));
		assert.ok(target, `找不到隔离 Obsidian 页面：${this.endpoint}`);
		this.socket = new WebSocket(target.webSocketDebuggerUrl);
		await new Promise((resolve, reject) => { this.socket.onopen = resolve; this.socket.onerror = reject; });
		this.socket.onmessage = event => {
			const message = JSON.parse(event.data);
			if (!message.id) return;
			const task = this.pending.get(message.id);
			if (!task) return;
			this.pending.delete(message.id);
			message.error ? task.reject(message.error) : task.resolve(message.result);
		};
		await this.until("typeof app !== 'undefined' && Boolean(app.vault?.adapter?.basePath)", "隔离仓库没有加载完成");
		const vaultPath = await this.evaluate("app.vault.adapter.basePath.replace(/\\\\/g, '/')");
		assert.equal(vaultPath.toLowerCase(), this.vaultPath.replaceAll("\\", "/").toLowerCase(), "CDP 必须指向本项目的隔离库");
		await this.evaluate("window.contributionGraphApi || app.plugins.enablePlugin('contribution-graph-local')");
		await this.until("Boolean(window.contributionGraphApi)", "请在隔离库启用测试插件");
	}

	call(method, params = {}) {
		return new Promise((resolve, reject) => {
			const id = ++this.sequence;
			this.pending.set(id, { resolve, reject });
			this.socket.send(JSON.stringify({ id, method, params }));
		});
	}

	async evaluate(expression) {
		const result = await this.call("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
			userGesture: true,
		});
		assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description || result.exceptionDetails?.text);
		return result.result.value;
	}

	async wait(ms = 350) {
		await new Promise(resolve => setTimeout(resolve, ms));
	}

	async until(expression, message) {
		for (let attempt = 0; attempt < 240; attempt++) {
			if (await this.evaluate(expression)) return;
			await this.wait(100);
		}
		assert.fail(message || `等待隔离仓库状态超时：${expression}`);
	}

	async close() {
		this.socket?.close();
	}
}

function statisticsFixture(chars, seconds) {
	const start = Date.parse(`${date}T10:00:00+08:00`) + chars * 1000;
	const end = start + seconds * 1000;
	return {
		dailyStats: {
			[date]: {
				addedChars: chars,
				deletedChars: 0,
				documents: { "月度同步验收.md": { addedChars: chars, deletedChars: 0 } },
			},
		},
		timeActivity: {
			buckets: {
				[`${date}T10-+480`]: {
					date,
					hour: 10,
					offsetMinutes: 480,
					documents: { "月度同步验收.md": seconds },
				},
			},
			periods: [{ start, end, folders: [] }],
			policyChanges: [],
			timeline: {
				formatVersion: 1,
				segments: seconds ? [{
					id: `monthly-segment-${chars}`,
					continuityId: `monthly-continuity-${chars}`,
					recordingPeriodId: `monthly-period-${chars}`,
					path: "月度同步验收.md",
					bucketKey: `${date}T10-+480`,
					start,
					end,
					seconds,
				}] : [],
				recordingPeriods: seconds ? [{
					id: `monthly-period-${chars}`,
					start,
					end,
					folders: [],
				}] : [],
			},
		},
		trackingPeriods: [{ startDate: date, endDate: date }],
		collectionScopePeriods: [{ startDate: date, endDate: date, folders: ["月度验收"], files: ["月度同步验收.md"] }],
		countingPolicyPeriods: [{ startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-12-31T23:59:59.999Z", policy: { excludeWhitespace: true, excludeMarkdownFormatting: false, strictUserInputOnly: true, countPastedText: true } }],
	};
}

async function readFiles(client, root = statisticsRoot) {
	return client.evaluate(`(async()=>{
		const root=${JSON.stringify(root)}, result={};
		for(const file of app.vault.getFiles().filter(item=>item.path===root||item.path.startsWith(root+'/'))){
			if(file.extension==='json') result[file.path]=await app.vault.read(file);
		}
		return result;
	})()`);
}

async function writeFile(client, filePath, data) {
	return client.evaluate(`(async()=>{
		const path=${JSON.stringify(filePath)}, text=${JSON.stringify(data)};
		let parent='';
		for(const part of path.split('/').slice(0,-1)){
			parent=parent?parent+'/'+part:part;
			if(!app.vault.getAbstractFileByPath(parent)) await app.vault.createFolder(parent);
		}
		const file=app.vault.getAbstractFileByPath(path);
		if(file) await app.vault.modify(file,text);
		else await app.vault.create(path,text);
	})()`);
}

async function deleteAllStatistics(client) {
	await client.evaluate(`(async()=>{
		const root=${JSON.stringify(statisticsRoot)};
		for(const file of [...app.vault.getFiles()].filter(item=>item.path===root||item.path.startsWith(root+'/')).reverse()) await app.vault.delete(file);
	})()`);
}

async function restoreFiles(client, files) {
	await client.evaluate(`(async()=>{
		await app.plugins.plugins['contribution-graph-local']?.activityService.unload();
		await app.plugins.disablePlugin('contribution-graph-local');
	})()`);
	await deleteAllStatistics(client);
	for (const [filePath, data] of Object.entries(files.stats)) await writeFile(client, filePath, data);
	await client.evaluate(`(()=>{
		const key=${JSON.stringify(sequenceKey(client))}, previous=${JSON.stringify(files.sequences)};
		if(previous===null) localStorage.removeItem(key);
		else localStorage.setItem(key,previous);
	})()`);
}

function sequenceKey(client) {
	return `contribution-graph-local:statistics-sequences:${client.vaultPath}:${statisticsRoot}`;
}

async function archiveTestState(client) {
	return { stats: await readFiles(client), sequences: await client.evaluate(`localStorage.getItem(${JSON.stringify(sequenceKey(client))})`) };
}

async function snapshot(client) {
	return client.evaluate(`(()=>{
		const service=app.plugins.plugins['contribution-graph-local'].activityService;
		const edit=service.getDailyEditStats({fromDate:${JSON.stringify(date)},toDate:${JSON.stringify(date)}}).find(item=>item.date===${JSON.stringify(date)});
		const seconds=service.getHourlyTimeStats({fromDate:${JSON.stringify(date)},toDate:${JSON.stringify(date)}}).reduce((sum,item)=>sum+item.seconds,0);
		return {added:edit?.addedChars||0,document:edit?.documents?.find(item=>item.path==='月度同步验收.md')?.addedChars||0,seconds};
	})()`);
}

async function snapshotDate(client, targetDate) {
	return client.evaluate(`(()=>{
		const service=app.plugins.plugins['contribution-graph-local'].activityService;
		const edit=service.getDailyEditStats({fromDate:${JSON.stringify(targetDate)},toDate:${JSON.stringify(targetDate)}}).find(item=>item.date===${JSON.stringify(targetDate)});
		return {added:edit?.addedChars||0,document:edit?.documents?.find(item=>item.path==='历史归档验收.md')?.addedChars||0};
	})()`);
}

async function repositoryData(client) {
	return client.evaluate(`(async()=>{
		const service=app.plugins.plugins['contribution-graph-local'].activityService;
		const reader=new service.statistics.constructor(service.statisticsFiles,value=>service.validateStatistics(value));
		await reader.initialize();
		return reader.read(service.createEmptyStore());
	})()`);
}

function canonicalize(value) {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.keys(value).sort().map(key => [
			key, canonicalize(key === "segments" ? [...value[key]].sort((a, b) => a.id.localeCompare(b.id)) : value[key]),
		]));
	}
	return value;
}

async function saveFixture(client, chars, seconds) {
	return client.evaluate(`(async()=>{
		const p=app.plugins.plugins['contribution-graph-local'];
		p.timeObserver.stop();
		const data=${JSON.stringify(statisticsFixture(chars, seconds))};
		Object.assign(p.activityService.store,data);
		await p.activityService.statistics.save(p.activityService.store);
		await p.activityService.statistics.refresh();
		return true;
	})()`);
}

async function restartProcess(client, device) {
	const profile = fileURLToPath(new URL(`../dist/${testRoot}/profile-${device}`, import.meta.url));
	const expected = profile.replaceAll("\\", "/").toLowerCase();
	const actual = await client.evaluate("require('@electron/remote').app.getPath('userData')");
	assert.equal(actual.replaceAll("\\", "/").toLowerCase(), expected);
	await client.evaluate("setTimeout(() => require('@electron/remote').app.quit(), 25); true");
	await client.close();
	const port = new URL(client.endpoint).port;
	for (let attempt = 0; attempt < 80; attempt++) {
		try { await fetch(`${client.endpoint}/json/list`, { signal: AbortSignal.timeout(400) }); }
		catch {
			const child = spawn(process.env.OBSIDIAN_TEST_EXE || "C:/Program Files/Obsidian/Obsidian.exe",
				[`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`],
				{ detached: true, stdio: "ignore", windowsHide: true });
			child.unref();
			for (let ready = 0; ready < 80; ready++) {
				try { await client.connect(); break; } catch { await client.close(); await client.wait(200); }
			}
			await client.until("Boolean(window.contributionGraphApi)", "Obsidian 重启后插件没有恢复");
			return;
		}
		await client.wait(100);
	}
	assert.fail("隔离 Obsidian 未退出");
}

function parseMonthlyFiles(files) {
	const result = [];
	for (const [path, text] of Object.entries(files)) {
		if (!path.includes("/月度/") || !path.endsWith(`/${month}-0.json`) && !path.endsWith(`/${month}-1.json`)) continue;
		const envelope = JSON.parse(text);
		assert.equal(envelope.formatVersion, 2, `${path} 必须使用月度格式`);
		assert.equal(envelope.kind, "monthly", `${path} 必须是 monthly envelope`);
		assert.ok(Number.isSafeInteger(envelope.sequence) && envelope.sequence >= 1, `${path} 缺少有效 sequence`);
		assert.ok(Array.isArray(envelope.records) && envelope.records.length > 0, `${path} 缺少 records`);
		result.push({ path, envelope });
	}
	return result;
}

async function enableSync(client) {
	await client.evaluate(`(async()=>{
		const config=JSON.parse(await app.vault.adapter.read('.obsidian/plugins/fast-note-sync/data.json'));
		if (new URL(config.api).origin!=='http://127.0.0.1:19270') throw Error('同步端必须是回环测试服务');
		await app.plugins.loadManifests();
		await app.plugins.enablePluginAndSave('fast-note-sync');
	})()`);
	await waitForSync(client);
}

async function waitForSync(client) {
	await client.until("app.plugins.plugins['fast-note-sync']?.websocket?.isAuth", "Fast Note Sync 未通过回环服务鉴权");
}

async function verifyFileConvergence(a, b) {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (attempt === 25) {
			for (const client of [a, b]) await client.evaluate("app.commands.executeCommandById('fast-note-sync:start-full-sync')");
		}
		const [left, right] = await Promise.all([readFiles(a), readFiles(b)]);
		if (JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))) return attempt >= 25;
		await a.wait(200);
	}
	assert.fail("Fast Note Sync 双端文件内容未收敛");
}

async function deliverFixtures(a, b, monthlyA, monthlyB, archives) {
	for (const [client, files] of [[b, monthlyA], [a, monthlyB]]) {
		for (const item of [...files].sort((left, right) => right.envelope.sequence - left.envelope.sequence)) {
			await writeFile(client, item.path, JSON.stringify(item.envelope));
		}
		for (const item of [...files].sort((left, right) => left.envelope.sequence - right.envelope.sequence)) {
			await writeFile(client, item.path, JSON.stringify(item.envelope));
		}
	}
	for (const [path, content] of archives) await writeFile(b, path, content);
}

function countMatches(expected) {
	return `(()=>{const s=app.plugins.plugins['contribution-graph-local'].activityService;const e=s.getDailyEditStats({fromDate:${JSON.stringify(date)},toDate:${JSON.stringify(date)}})[0];return (e?.addedChars||0)===${expected}})()`;
}

async function compareRepositories(a, b) {
	const [left, right] = await Promise.all([repositoryData(a), repositoryData(b)]);
	const summary = canonicalize(left);
	assert.deepEqual(summary, canonicalize(right), "完整统计在两端必须相等");
	assert.equal(left.timeActivity.timeline.segments.length, 2, "两端有效时间轴片段必须保留");
	assert.ok(left.collectionScopePeriods.some(period => period.files?.includes("月度同步验收.md")));
	return summary;
}

const a = new CdpClient(endpointA, "a");
const b = new CdpClient(endpointB, "b");
let originalA;
let originalB;
const rescans = [];
try {
	await Promise.all([a.connect(), b.connect()]);
	if (actualSync) {
		for (const client of [a, b]) {
			assert.equal(await client.evaluate("Boolean(app.plugins.plugins['fast-note-sync'])"), false, "真实同步验收须从断开的隔离设备开始");
			const initial = await readFiles(client);
			const frames = parseMonthlyFiles(initial);
			assert.equal(frames.length, Object.keys(initial).length, "真实同步验收须使用未导入历史的仓库");
			assert.ok(frames.every(file => file.envelope.records.every(record =>
				Object.keys(record.data.dailyStats).length === 0 && Object.keys(record.data.timeActivity.buckets).length === 0
			)), "真实同步验收须从空统计开始");
		}
	} else {
		originalA = await archiveTestState(a);
		originalB = await archiveTestState(b);
	}
	await Promise.all([
		a.evaluate("app.plugins.plugins['contribution-graph-local'].timeObserver.stop()"),
		b.evaluate("app.plugins.plugins['contribution-graph-local'].timeObserver.stop()"),
	]);

	const beforeA = await snapshot(a);
	const beforeB = await snapshot(b);
	await Promise.all([saveFixture(a, 111, 101), saveFixture(b, 222, 202)]);
	const legacyId = crypto.randomUUID();
	const legacyData = statisticsFixture(777, 0);
	delete legacyData.dailyStats[date];
	legacyData.dailyStats["2026-01-01"] = {
		addedChars: 777,
		deletedChars: 0,
		documents: { "历史归档验收.md": { addedChars: 777, deletedChars: 0 } },
	};
	await writeFile(a, `${statisticsRoot}/记录/${legacyId}-r1.json`, JSON.stringify({
		formatVersion: 1,
		kind: "statistics",
		id: legacyId,
		revision: 1,
		updatedAt: Date.parse("2026-01-01T08:00:00+08:00"),
		generation: "initial",
		data: legacyData,
	}));
	const archivedCount = await a.evaluate("app.plugins.plugins['contribution-graph-local'].activityService.archiveLegacyStatistics()");
	assert.equal(archivedCount, 1, "隔离库应归档一条旧版统计");
	const archiveFilesA = await readFiles(a);
	const archivePathsA = Object.keys(archiveFilesA).filter(path => path.startsWith(`${statisticsRoot}/归档/`));
	assert.equal(archivePathsA.length, 1, "历史归档应生成一个内容摘要文件");
	const archiveEnvelope = JSON.parse(archiveFilesA[archivePathsA[0]]);
	assert.deepEqual({ formatVersion: archiveEnvelope.formatVersion, kind: archiveEnvelope.kind }, { formatVersion: 2, kind: "archive" }, "历史归档 envelope 格式错误");
	assert.equal(archiveEnvelope.records.length, 1, "历史归档应保留原始记录");
	await Promise.all([saveFixture(a, 333, 303), saveFixture(b, 444, 404)]);
	const filesA = await readFiles(a);
	const filesB = await readFiles(b);
	const monthlyA = parseMonthlyFiles(filesA);
	const monthlyB = parseMonthlyFiles(filesB);
	assert.ok(monthlyA.length >= 2, "设备 A 必须在当前月份形成 0/1 双文件");
	assert.ok(monthlyB.length >= 2, "设备 B 必须在当前月份形成 0/1 双文件");
	const deviceA = new Set(monthlyA.map(item => item.path.split("/")[4])).size;
	const deviceB = new Set(monthlyB.map(item => item.path.split("/")[4])).size;
	assert.equal(deviceA, 1, "设备 A 的月度文件必须归属于一个稳定安装 UUID");
	assert.equal(deviceB, 1, "设备 B 的月度文件必须归属于一个稳定安装 UUID");
	assert.notEqual(monthlyA[0].path.split("/")[4], monthlyB[0].path.split("/")[4], "两个隔离安装必须使用不同安装 UUID");

	if (actualSync) {
		await enableSync(a);
		await enableSync(b);
	} else {
		await deliverFixtures(a, b, monthlyA, monthlyB, archivePathsA.map(path => [path, archiveFilesA[path]]));
	}
	await Promise.all([a, b].map(client => client.until(countMatches(beforeA.added + beforeB.added + 777), "记录未在重连后到齐")));
	await b.until(`app.vault.adapter.exists(${JSON.stringify(archivePathsA[0])})`, "历史归档未到达设备 B");
	if (actualSync) rescans.push(await verifyFileConvergence(a, b));
	let merged = await snapshot(b);
	assert.equal(merged.added, beforeA.added + beforeB.added + 333 + 444, "重连后字数必须按两个设备的最高记录合并");
	assert.equal(merged.document, beforeA.document + beforeB.document + 333 + 444, "重连后笔记明细必须保持一致");
	assert.equal(merged.seconds, beforeA.seconds + beforeB.seconds + 303 + 404, "重连后时长必须按两个设备的最高记录合并");
	const archivedMerged = await snapshotDate(b, "2026-01-01");
	assert.deepEqual(archivedMerged, { added: 777, document: 777 }, "重连后历史归档必须保留原始统计");
	let complete = await compareRepositories(a, b);
	if (actualSync) {
		await a.evaluate("app.plugins.disablePlugin('fast-note-sync')");
		await saveFixture(a, 555, 505);
		assert.deepEqual(await snapshot(b), merged, "离线改动必须留在写入端");
		await enableSync(a);
		await b.until(countMatches(beforeA.added + beforeB.added + 999), "重新连接后未收到固定路径的新版本");
		rescans.push(await verifyFileConvergence(a, b));
		merged = await snapshot(b);
		assert.equal(merged.seconds, beforeA.seconds + beforeB.seconds + 909);
		complete = await compareRepositories(a, b);
	}
	await Promise.all([restartProcess(a, "a"), restartProcess(b, "b")]);
	if (actualSync) {
		await Promise.all([a, b].map(waitForSync));
		rescans.push(await verifyFileConvergence(a, b));
	}
	const afterRestart = await snapshot(b);
	assert.deepEqual(afterRestart, merged, "设备 B 重启后统计必须与重连完成时一致");
	assert.deepEqual(await snapshotDate(b, "2026-01-01"), archivedMerged, "设备 B 重启后历史归档必须一致");
	assert.deepEqual(await snapshot(a), merged, "设备 A 重启后统计必须与重连完成时一致");
	assert.deepEqual(await compareRepositories(a, b), complete, "重启后完整统计必须保持一致");
	const archive = Object.keys(await readFiles(b)).filter(path => path.startsWith(`${statisticsRoot}/归档/`));
	assert.ok(archive.every(path => path.endsWith(".json")), "历史归档文件必须位于归档目录并使用 JSON");
	console.log(JSON.stringify({
		pass: true,
		mode: actualSync ? "两端真实 Obsidian + 本机 Fast Note Sync" : "两端真实 Obsidian，文件到达顺序由脚本模拟",
		month,
		beforeA,
		beforeB,
		merged,
		afterRestart,
		rescans,
		monthlyFilesA: monthlyA.map(item => item.path),
		monthlyFilesB: monthlyB.map(item => item.path),
		archiveFiles: archive,
	}));
} finally {
	const restore = await Promise.allSettled([
		originalA ? restoreFiles(a, originalA) : Promise.resolve(),
		originalB ? restoreFiles(b, originalB) : Promise.resolve(),
	]);
	await Promise.allSettled([a.close(), b.close()]);
	for (const result of restore) if (result.status === "rejected") throw result.reason;
}
