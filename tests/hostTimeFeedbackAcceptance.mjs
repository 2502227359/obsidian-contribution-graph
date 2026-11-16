import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// 用法：node tests/hostTimeFeedbackAcceptance.mjs [quick|real]
// 只连接 9231；real 模式在快速交互后等待一次默认五分钟空闲。
const endpoint = "http://127.0.0.1:9231";
const mode = process.argv[2] || "quick";
assert.ok(mode === "quick" || mode === "real", "模式只能是 quick 或 real");
const pluginId = "contribution-graph-local";
const fixturePath = "计时反馈宿主验收.md";
const fixtureText = "# 计时反馈宿主验收\n\n此文件只用于独立验收。\n";
const evidencePath = fileURLToPath(
	new URL("../dist/time-acceptance/time-feedback-real-evidence.json", import.meta.url)
);

const targets = await (await fetch(`${endpoint}/json/list`)).json();
const target = targets.find((item) => item.type === "page" && item.url.startsWith("app://"));
assert.ok(target, "独立 Obsidian 验收实例必须运行在 9231 端口");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
socket.onmessage = (event) => {
	const response = JSON.parse(event.data);
	if (!response.id) return;
	const task = pending.get(response.id);
	pending.delete(response.id);
	response.error ? task.reject(response.error) : task.resolve(response.result);
};
const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
	const id = ++sequence;
	pending.set(id, { resolve, reject });
	socket.send(JSON.stringify({ id, method, params, sessionId }));
});

async function evaluate(expression) {
	const result = await call("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
		userGesture: true,
	});
	assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description);
	return result.result.value;
}

function sleep(milliseconds) {
	assert.ok(milliseconds <= 60_000, "单次等待不得超过 60 秒");
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function until(read, predicate, description, timeoutMs = 10_000, intervalMs = 250) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await read();
		if (predicate(value)) return value;
		await sleep(Math.min(intervalMs, Math.max(1, deadline - Date.now())));
	}
	assert.fail(`宿主状态等待超时：${description}`);
}

async function readSnapshot() {
	return evaluate(`(() => {
		const service = app.plugins.plugins[${JSON.stringify(pluginId)}]?.activityService;
		return service?.getTimeTrackingSnapshot?.() || null;
	})()`);
}

async function readSettings() {
	return evaluate(`app.plugins.plugins[${JSON.stringify(pluginId)}]?.activityService?.getSettings?.() || null`);
}

async function readControl() {
	return evaluate(`(() => {
		const element = document.querySelector("[data-cg-time-control]");
		if (!element) return null;
		const rect = element.getBoundingClientRect();
		return {
			x: rect.left + rect.width / 2,
			y: rect.top + rect.height / 2,
			visible: rect.width > 0 && rect.height > 0,
			text: element.textContent || "",
			aria: element.getAttribute("aria-label") || "",
			title: element.getAttribute("title") || "",
			role: element.getAttribute("role") || "",
			tabIndex: element.tabIndex,
		};
	})()`);
}

async function clickPoint(point, sessionId) {
	assert.ok(point && point.visible, "目标控件必须可见");
	await call("Input.dispatchMouseEvent", {
		type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1,
	}, sessionId);
	await call("Input.dispatchMouseEvent", {
		type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1,
	}, sessionId);
}

async function clickStatusControl() {
	await clickPoint(await readControl());
}

async function focusStatusControl() {
	await evaluate("document.querySelector('[data-cg-time-control]')?.focus()");
	assert.equal(
		await evaluate("document.activeElement?.matches?.('[data-cg-time-control]')"),
		true,
		"状态栏控件必须能够获得键盘焦点"
	);
}

async function pressKey(key, code, virtualKey) {
	await call("Input.dispatchKeyEvent", {
		type: "keyDown", key, code, windowsVirtualKeyCode: virtualKey,
	});
	await call("Input.dispatchKeyEvent", {
		type: "keyUp", key, code, windowsVirtualKeyCode: virtualKey,
	});
}

async function clickEditor() {
	const point = await evaluate(`(() => {
		const root = app.workspace.activeLeaf?.view?.containerEl || document;
		const element = [...root.querySelectorAll(".cm-content")].find((candidate) => {
			const rect = candidate.getBoundingClientRect();
			return rect.width > 0 && rect.height > 0;
		});
		if (!element) return null;
		const rect = element.getBoundingClientRect();
		return { x: rect.left + Math.min(120, rect.width / 2), y: rect.top + Math.min(40, rect.height / 2), visible: true };
	})()`);
	assert.ok(point, "验收笔记必须以源模式打开并显示编辑器");
	await clickPoint(point);
}

async function readTodayAddedCharacters() {
	return evaluate(`(() => {
		const service = app.plugins.plugins[${JSON.stringify(pluginId)}].activityService;
		const date = new Date();
		const today = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
		return service.getDailyEditStats({ fromDate: today, toDate: today })
			.reduce((total, row) => total + row.addedChars, 0);
	})()`);
}

async function typeTrustedZ() {
	await call("Input.dispatchKeyEvent", {
		type: "keyDown", key: "z", code: "KeyZ", windowsVirtualKeyCode: 90,
	});
	await call("Input.insertText", { text: "z" });
	await call("Input.dispatchKeyEvent", {
		type: "keyUp", key: "z", code: "KeyZ", windowsVirtualKeyCode: 90,
	});
}

async function closeOverlays() {
	await evaluate(`(() => {
		app.setting?.close?.();
		document.querySelectorAll(".prompt .modal-close-button").forEach((button) => button.click());
		document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
	})()`);
}

async function openFixture() {
	await closeOverlays();
	await evaluate(`(async () => {
		const file = app.vault.getAbstractFileByPath(${JSON.stringify(fixturePath)});
		await app.workspace.getLeaf(false).openFile(file, { state: { mode: "source" } });
	})()`);
}

async function ensureActive() {
	await openFixture();
	await clickEditor();
	return until(readSnapshot, (snapshot) => snapshot?.reason === "ACTIVE", "正文真实操作后进入计时中");
}

async function runHoverCheck() {
	const before = await readSnapshot();
	const control = await readControl();
	assert.ok(control?.visible, "状态栏时长控件必须可见");
	assert.ok(control.tabIndex >= 0, "状态栏时长控件必须可键盘进入");
	assert.equal(control.role, "button", "状态栏时长控件必须声明 button 语义");
	assert.ok(control.aria || control.title || control.text.trim(), "状态栏控件必须有可访问名称");
	await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: control.x, y: control.y });
	await sleep(1_500);
	const after = await readSnapshot();
	assert.equal(after.reason, before.reason, "悬浮不能改变计时原因");
	assert.equal(after.manualPaused, before.manualPaused, "悬浮不能改变临时暂停状态");
	assert.equal(after.path, before.path, "悬浮不能切换当前笔记");
	assert.deepEqual(after.lastDiscard || null, before.lastDiscard || null, "悬浮不能生成新的回撤说明");
	assert.ok(after.todaySeconds >= before.todaySeconds, "悬浮不能减少今日累计");
	assert.ok(after.todayPendingSeconds >= before.todayPendingSeconds, "悬浮不能减少本机暂计");
	assert.ok(after.remainingMs < before.remainingMs, "悬浮后的剩余时间必须随真实时间下降");
	assert.ok(before.remainingMs - after.remainingMs < 5_000, "悬浮不能把一次短等待伪造为新的心跳");
}

async function runStatusControlCheck() {
	await ensureActive();
	await runHoverCheck();
	await clickStatusControl();
	await until(readSnapshot, (snapshot) => snapshot?.manualPaused === true, "鼠标点击暂停本次时长");
	assert.equal((await readSnapshot()).reason, "MANUAL", "鼠标点击后的优先级必须是手动暂停");
	const beforeEdit = { time: await readSnapshot(), added: await readTodayAddedCharacters() };
	await clickEditor();
	await typeTrustedZ();
	await until(readTodayAddedCharacters, (added) => added >= beforeEdit.added + 1, "手动暂停期间仍采集字符");
	const afterEdit = await readSnapshot();
	assert.equal(afterEdit.manualPaused, true, "手动暂停期间正文输入不能恢复时长");
	assert.equal(afterEdit.todaySeconds, beforeEdit.time.todaySeconds, "手动暂停期间字符输入不能增加已确认时长");
	assert.equal(afterEdit.todayPendingSeconds, beforeEdit.time.todayPendingSeconds, "手动暂停期间字符输入不能增加本机暂计");

	await focusStatusControl();
	await pressKey("Enter", "Enter", 13);
	await until(readSnapshot, (snapshot) => snapshot?.manualPaused === false, "回车恢复本次时长");
	await focusStatusControl();
	await pressKey(" ", "Space", 32);
	await until(readSnapshot, (snapshot) => snapshot?.manualPaused === true, "空格暂停本次时长");
	await focusStatusControl();
	await pressKey(" ", "Space", 32);
	await until(readSnapshot, (snapshot) => snapshot?.manualPaused === false, "空格恢复本次时长");
}

async function command(commandId) {
	await evaluate(`app.commands.executeCommandById(${JSON.stringify(commandId)})`);
}

async function runCommandPaletteCheck() {
	await ensureActive();
	const commandIds = await evaluate(`Object.keys(app.commands.commands).filter((id) => id.startsWith(${JSON.stringify(`${pluginId}:`)}))`);
	assert.ok(commandIds.includes(`${pluginId}:pause-time-tracking`), "必须注册暂停命令");
	assert.ok(commandIds.includes(`${pluginId}:resume-time-tracking`), "必须注册恢复命令");

	await command("command-palette:open");
	await until(
		() => evaluate("Boolean(document.querySelector('.prompt'))"),
		Boolean,
		"命令面板打开",
	);
	await until(readSnapshot, (snapshot) => snapshot?.reason === "MODAL", "命令面板打开后显示弹窗暂停");
	await command(`${pluginId}:pause-time-tracking`);
	await until(readSnapshot, (snapshot) => snapshot?.manualPaused === true, "面板内执行暂停命令");
	await command(`${pluginId}:resume-time-tracking`);
	const restored = await until(readSnapshot, (snapshot) => snapshot?.manualPaused === false, "面板内执行恢复命令");
	assert.equal(restored.reason, "MODAL", "面板未关闭时恢复不得开始计时");
	assert.equal(await evaluate("Boolean(document.querySelector('.prompt'))"), true, "恢复命令不能抢先关闭面板");
	await pressKey("Escape", "Escape", 27);
	await until(() => evaluate("!document.querySelector('.prompt')"), Boolean, "命令面板关闭");
	await until(readSnapshot, (snapshot) => snapshot?.reason === "ACTIVE", "命令面板关闭后重新核对相同笔记");
}

async function readTimeSection() {
	return evaluate(`(() => {
		const tab = app.setting?.pluginTabs?.find((item) => item.id === ${JSON.stringify(pluginId)});
		const section = tab?.containerEl?.querySelector('.cg-settings-section[data-section="time"]');
		return section ? {
			text: section.textContent || "",
			separateDocument: section.ownerDocument !== document,
			buttons: [...section.querySelectorAll("button")].map((button) => ({
				text: button.textContent || "", disabled: button.disabled,
				rect: (() => { const r = button.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, visible: r.width > 0 && r.height > 0 }; })(),
			})),
		} : null;
	})()`);
}

async function runSettingsCheck() {
	await ensureActive();
	await command(`${pluginId}:pause-time-tracking`);
	await until(readSnapshot, (snapshot) => snapshot?.manualPaused === true, "设置页验收前暂停");
	await evaluate(`(() => { app.setting.open(); app.setting.openTabById(${JSON.stringify(pluginId)}); })()`);
	const section = await until(readTimeSection, Boolean, "时长设置区打开");
	assert.match(section.text, /手动暂停/, "设置页必须显示与服务相同的手动暂停状态");
	const resumeButton = section.buttons.find((button) => /恢复本次/.test(button.text));
	assert.ok(resumeButton, "设置页必须提供恢复本次按钮");
	let settingsSession;
	if (section.separateDocument) {
		const targets = await (await fetch(`${endpoint}/json/list`)).json();
		const settingsTarget = targets.find(item => item.type === "page" && /设置|Settings/i.test(item.title));
		assert.ok(settingsTarget, "设置独立窗口必须有可用的调试页面");
		settingsSession = (await call("Target.attachToTarget", { targetId: settingsTarget.id, flatten: true })).sessionId;
	}
	try { await clickPoint(resumeButton.rect, settingsSession); }
	finally { if (settingsSession) await call("Target.detachFromTarget", { sessionId: settingsSession }); }
	await until(readSnapshot, (snapshot) => snapshot?.manualPaused === false, "设置页恢复本次时长");
	const updated = await until(readTimeSection, (value) => value && /暂停本次/.test(value.buttons.map((button) => button.text).join(" ")), "设置页同步恢复按钮");
	assert.doesNotMatch(updated.text, /手动暂停/, "设置页恢复后不得残留手动暂停状态");
	await closeOverlays();
	await ensureActive();
}

async function runReloadCheck() {
	await ensureActive();
	await command(`${pluginId}:pause-time-tracking`);
	await until(readSnapshot, (snapshot) => snapshot?.manualPaused === true, "重载前暂停本次时长");
	await evaluate(`(async () => {
		await app.plugins.disablePlugin(${JSON.stringify(pluginId)});
		await app.plugins.enablePlugin(${JSON.stringify(pluginId)});
	})()`);
	await until(readSnapshot, (snapshot) => Boolean(snapshot), "插件重载完成", 15_000);
	const snapshot = await readSnapshot();
	assert.equal(snapshot.manualPaused, false, "插件重载必须清除临时暂停");
	assert.equal(snapshot.lastDiscard, undefined, "插件重载必须清除运行期回撤说明");
	await until(readControl, (control) => control?.visible === true, "重载后恢复状态栏控件");
	await ensureActive();
}

async function writeEvidence(data) {
	await writeFile(evidencePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function runRealIdleCheck() {
	await ensureActive();
	const settings = await readSettings();
	assert.equal(settings?.idleTimeoutMinutes, 5, "真实五分钟验收必须使用默认五分钟阈值");
	const startedAt = new Date().toISOString();
	const deadline = Date.now() + 6 * 60_000;
	const polls = [];
	await writeEvidence({ mode: "real", status: "running", startedAt, polls });
	while (true) {
		const snapshot = await readSnapshot();
		polls.push({
			at: new Date().toISOString(),
			reason: snapshot?.reason,
			manualPaused: snapshot?.manualPaused,
			todaySeconds: snapshot?.todaySeconds,
			todayPendingSeconds: snapshot?.todayPendingSeconds,
			remainingMs: snapshot?.remainingMs,
			lastDiscard: snapshot?.lastDiscard || null,
		});
		await writeEvidence({ mode: "real", status: "running", startedAt, polls });
		if (snapshot?.lastDiscard?.reason === "idle") {
			assert.equal(snapshot.reason, "IDLE", "真实空闲回撤后状态必须为 IDLE");
			assert.ok(snapshot.lastDiscard.recordedSeconds > 0, "真实空闲回撤必须包含已计入尾段");
			assert.ok(snapshot.lastDiscard.unrecordedSeconds >= 0, "真实空闲回撤必须报告未计入余量");
			await writeEvidence({ mode: "real", status: "passed", startedAt, finishedAt: new Date().toISOString(), polls });
			return;
		}
		if (Date.now() >= deadline) {
			assert.fail("真实五分钟空闲未在六分钟观察窗口内产生回撤；详见 time-feedback-real-evidence.json");
		}
		await sleep(15_000);
	}
}

async function captureOriginalState() {
	await closeOverlays();
	return evaluate(`(async () => {
		const plugin = app.plugins.plugins[${JSON.stringify(pluginId)}];
		plugin.timeObserver?.stop();
		const file = app.workspace.activeLeaf?.view?.file;
		const fixture = app.vault.getAbstractFileByPath(${JSON.stringify(fixturePath)});
		return {
			data: plugin.activityService.exportData(),
			commandPaletteEnabled: app.internalPlugins.plugins["command-palette"].enabled,
			activePath: file?.path || null,
			fixture: fixture ? { exists: true, content: await app.vault.read(fixture) } : { exists: false },
		};
	})()`);
}

async function prepareFixture() {
	await evaluate(`(async () => {
		const plugin = app.plugins.plugins[${JSON.stringify(pluginId)}];
		const service = plugin.activityService;
		if (!app.internalPlugins.plugins["command-palette"].enabled) await app.internalPlugins.plugins["command-palette"].enable();
		await service.importData(${JSON.stringify(originalState.data)});
		if (service.getSettings().trackedFolders.length) await service.setTrackedFolders([]);
		if (!service.getSettings().timeTrackingEnabled) await service.setTimeTrackingEnabled(true);
		if (!service.getSettings().trackingEnabled) await service.setTrackingEnabled(true);
		if (service.getSettings().idleTimeoutMinutes !== 5) throw new Error("独立验收库的默认空闲阈值不是五分钟");
		await service.resumeTimeTrackingForSession();
		const file = app.vault.getAbstractFileByPath(${JSON.stringify(fixturePath)}) || await app.vault.create(${JSON.stringify(fixturePath)}, ${JSON.stringify(fixtureText)});
		if (await app.vault.read(file) !== ${JSON.stringify(fixtureText)}) await app.vault.modify(file, ${JSON.stringify(fixtureText)});
		await app.workspace.getLeaf(false).openFile(file, { state: { mode: "source" } });
		plugin.timeObserver?.start();
	})()`);
}

async function restoreOriginalState() {
	await evaluate(`(async () => {
		const plugin = app.plugins.plugins[${JSON.stringify(pluginId)}];
		plugin.timeObserver?.stop();
		await plugin.activityService.importData(${JSON.stringify(originalState.data)});
		const file = app.vault.getAbstractFileByPath(${JSON.stringify(fixturePath)});
		const original = ${JSON.stringify(originalState.fixture)};
		if (original.exists) {
			if (file) await app.vault.modify(file, original.content);
			else await app.vault.create(${JSON.stringify(fixturePath)}, original.content);
		} else if (file) {
			await app.vault.delete(file);
		}
		if (${JSON.stringify(originalState.activePath)}) {
			const active = app.vault.getAbstractFileByPath(${JSON.stringify(originalState.activePath)});
			if (active) await app.workspace.getLeaf(false).openFile(active, { state: { mode: "preview" } });
		}
		plugin.timeObserver?.start();
		if (!${JSON.stringify(originalState.commandPaletteEnabled)}) await app.internalPlugins.plugins["command-palette"].disable();
	})()`);
}

let originalState;
try {
	assert.equal((await evaluate("app.vault.adapter.basePath.replace(/\\\\/g,'/')")).endsWith("/dist/time-acceptance/vault"), true, "只允许连接 dist/time-acceptance/vault");
	await evaluate(`(() => { const plugin = app.plugins.plugins[${JSON.stringify(pluginId)}]; if (!plugin) throw new Error("插件未加载"); if (plugin.manifest.version !== "0.21.0") throw new Error("宿主验收要求插件版本 0.21.0"); })()`);
	originalState = await captureOriginalState();
	await prepareFixture();
	await runStatusControlCheck();
	await runCommandPaletteCheck();
	await runSettingsCheck();
	await runReloadCheck();
	if (mode === "real") await runRealIdleCheck();
	console.log(mode === "real"
		? "计时反馈宿主验收通过：状态栏真实点击、回车和空格、悬浮纯查询、命令面板恢复边界、设置同步、重载清除临时暂停及真实五分钟空闲回撤。"
		: "计时反馈快速宿主验收通过：状态栏真实点击、回车和空格、悬浮纯查询、命令面板恢复边界、设置同步及重载清除临时暂停。");
} finally {
	try { if (originalState) await restoreOriginalState(); }
	finally { socket.close(); }
}
