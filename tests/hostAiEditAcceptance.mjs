import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/ai-edit-acceptance/", import.meta.url));
const pluginId = "contribution-graph-local";
const plugin = path.join(root, "..", pluginId);
const writer = path.join(plugin, "ai-note-write.cjs");
const executable = "C:/Program Files/Obsidian/Obsidian.exe";
const statisticsFolder = path.join("Template", "数据", "学习统计");
const note = "验收/编辑.md";
const testId = randomUUID();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function runAcceptance() {
	const remote = (await Promise.all([9257, 9258].map(connectIfOpen))).some(Boolean);
	assert.equal(remote, false, "隔离验收端口已使用");

	const a = createHost("a", 9257), b = createHost("b", 9258);
	try {
		await a.start();
		await b.start();
		await a.evaluate("service.setTrackedFolders(['验收']).then(() => service.setTrackingEnabled(true)).then(() => service.setCountPastedText(false)).then(() => service.setCountAiEdits(true))");
		await b.evaluate("service.setTrackingEnabled(true).then(() => service.setCountAiEdits(true))");
		await a.evaluate(`app.vault.create(${JSON.stringify(note)}, '旧版').then(() => true)`);
		await a.evaluate(`app.workspace.openLinkText(${JSON.stringify(note)}, '', false).then(() => true)`);
		await a.evaluate(`app.vault[Symbol.for('contribution-graph-local:record-ai-note-edit')]({
			id: crypto.randomUUID(), source: 'yolo', path: ${JSON.stringify(note)},
			before: '原版', after: '旧版', occurredAt: Date.now()
		})`);
		await a.until(expectedCount(1));

		// 验证通道 A（Obsidian 在线桥接）：受保护路径拦截、活跃脏编辑器拦截、vault.process 局部补丁与写前备份
		const protectedRun = runWriterRaw(a, {
			path: "AGENTS.md",
			content: "hack",
			beforeSha256: createHash("sha256").update("").digest("hex"),
		});
		assert.notEqual(protectedRun.status, 0);
		assert.equal(JSON.parse(protectedRun.stderr.trim()).errorCode, "PATH_PROTECTED");

		await a.evaluate(`(() => {
			const editor = app.workspace.activeEditor?.editor;
			if (!editor) throw new Error("未找到活跃编辑器");
			editor.setValue("未保存的人工输入");
			return true;
		})()`);
		const dirtyRun = runWriterRaw(a, {
			path: note,
			beforeSha256: createHash("sha256").update("旧版").digest("hex"),
			edits: [{ oldText: "旧版", newText: "冲突版" }],
		}, ["--patch"]);
		assert.notEqual(dirtyRun.status, 0);
		const dirtyError = JSON.parse(dirtyRun.stderr.trim());
		assert.equal(dirtyError.errorCode, "NOTE_ACTIVE_IN_EDITOR");
		assert.equal(dirtyError.noteModified, false);

		// 恢复编辑器为干净状态后再验证在线桥接补丁
		await a.evaluate(`(async () => {
			const file = app.vault.getAbstractFileByPath(${JSON.stringify(note)});
			const editor = app.workspace.activeEditor?.editor;
			editor?.setValue("旧版");
			await app.vault.modify(file, "旧版");
			return true;
		})()`);
		await a.until(`(() => {
			const editor = app.workspace.activeEditor?.editor;
			return editor && editor.getValue() === "旧版";
		})()`);
		// 等待超过最近 5 秒人工编辑保护窗口
		await wait(5200);
		const livePatchRun = runWriterRaw(a, {
			path: note,
			beforeSha256: createHash("sha256").update("旧版").digest("hex"),
			edits: [{ oldText: "旧版", newText: "桥版" }],
		}, ["--patch"]);
		assert.equal(livePatchRun.status, 0, livePatchRun.stderr || livePatchRun.stdout);
		const livePatch = JSON.parse(livePatchRun.stdout.trim());
		assert.equal(livePatch.channel, "obsidian-bridge");
		assert.equal(livePatch.noteStatus, "committed");
		assert.equal(livePatch.statisticsStatus, "recorded");
		assert.ok(livePatch.backupId);
		await a.until(expectedCount(2));

		await a.stop();
		runWriter(a, "桥版", "新版");
		await a.start();
		await a.until(expectedCount(3));

		replayFiles(a, b);
		await b.until(expectedCount(3));
		await b.stop();
		runWriter(b, "新版", "终版");
		await b.start();
		await b.until(expectedCount(4));
		replayFiles(b, a);
		await a.until(expectedCount(4));
		replayFiles(a, b);
		await b.until(expectedCount(4));
		console.log("双端隔离 Obsidian 通过：在线桥接（写保护/脏编辑器拦截/局部补丁/备份）、离线写入补录、统计文件双向重放无重复计数");
	} finally {
		await Promise.allSettled([a.stop(), b.stop()]);
	}
}

function expectedCount(count) {
	const expression = `counts(${JSON.stringify(note)})`;
	return `${expression}?.addedChars === ${count} && ${expression}?.deletedChars === ${count}`;
}

function runWriterRaw(host, request, extraArgs = []) {
	return spawnSync(process.execPath, [writer, "--vault", host.vault, "--source", "acceptance-agent", ...extraArgs], {
		input: JSON.stringify(request), encoding: "utf8", windowsHide: true,
	});
}

function runWriter(host, before, content) {
	const request = { path: note, content, beforeSha256: createHash("sha256").update(before).digest("hex") };
	const command = runWriterRaw(host, request);
	assert.equal(command.status, 0, command.stderr || command.stdout);
	assert.equal(fs.readFileSync(path.join(host.vault, note), "utf8"), content);
}

function replayFiles(sender, recipient) {
	fs.cpSync(path.join(sender.vault, statisticsFolder), path.join(recipient.vault, statisticsFolder), { recursive: true });
	fs.copyFileSync(path.join(sender.vault, note), path.join(recipient.vault, note));
}

async function connectIfOpen(port) {
	try {
		const result = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
		return await result.json();
	} catch {
		return undefined;
	}
}

function createHost(device, port) {
	const folder = path.join(root, testId, device);
	const profile = path.join(folder, "profile"), vault = path.join(folder, "vault");
	const pluginDir = path.join(vault, ".obsidian", "plugins", pluginId);
	const vaultId = randomUUID().replaceAll("-", "").slice(0, 16);
	fs.mkdirSync(profile, { recursive: true });
	fs.mkdirSync(pluginDir, { recursive: true });
	fs.mkdirSync(path.join(vault, "验收"), { recursive: true });
	for (const file of ["main.js", "manifest.json", "styles.css"]) fs.copyFileSync(path.join(plugin, file), path.join(pluginDir, file));
	fs.writeFileSync(path.join(profile, "obsidian.json"), JSON.stringify({ vaults: { [vaultId]: { path: vault, open: true } },
		updateDisabled: true, disableGpu: true, frame: "hidden" }));
	fs.writeFileSync(path.join(vault, ".obsidian", "community-plugins.json"), JSON.stringify([pluginId]));
	fs.writeFileSync(path.join(vault, ".obsidian", "core-plugins.json"), "{}");
	return new TestHost(profile, vault, port);
}

class TestHost {
	constructor(profile, vault, port) {
		this.profile = profile;
		this.vault = vault;
		this.port = port;
		this.sequence = 0;
	}

	async start() {
		this.child = spawn(executable, [`--user-data-dir=${this.profile}`, `--remote-debugging-port=${this.port}`], {
			stdio: "ignore", windowsHide: true,
		});
		try {
			await this.until(async () => {
				const targets = await connectIfOpen(this.port);
				const target = targets?.find(value => value.type === "page" && value.url.startsWith("app://"));
				if (!target) return false;
				this.socket = new WebSocket(target.webSocketDebuggerUrl);
				await new Promise((resolve, reject) => {
					this.socket.addEventListener("open", resolve, { once: true });
					this.socket.addEventListener("error", reject, { once: true });
				});
				return true;
			});
			await this.until("typeof app !== 'undefined' && !!app.vault?.adapter?.getBasePath?.() && typeof app.plugins?.loadPlugin === 'function'");
			assert.equal(path.resolve(await this.evaluate("app.vault.adapter.getBasePath()")).toLowerCase(), this.vault.toLowerCase());
			await this.until(`(() => {
				if (app.plugins.plugins["${pluginId}"]) return true;
				const button = Array.from(document.querySelectorAll('button')).find(button =>
					/信任仓库作者并启用插件|Trust author and enable plugins/i.test(button.textContent));
				if (button) { button.click(); return true; }
				return false;
			})()`);
			await this.until(`!!app.plugins.plugins["${pluginId}"]?.activityService?.getSettings`);
			await this.evaluate(`window.service = app.plugins.plugins["${pluginId}"].activityService;
				window.counts = path => service.getDailyEditStats().flatMap(day => day.documents).find(note => note.path === path); true`);
		} catch (error) {
			await this.stop();
			throw error;
		}
	}

	async stop() {
		if (!this.child || this.child.exitCode !== null) return;
		try { await this.evaluate("app.plugins.disablePlugin('contribution-graph-local')"); }
		catch {}
		this.socket?.close();
		this.child.kill();
		await this.until(async () => !(await connectIfOpen(this.port)));
	}

	async until(check) {
		for (let attempt = 0; attempt < 120; attempt++) {
			if (await (typeof check === "string" ? this.evaluate(check) : check())) return;
			await wait(250);
		}
		assert.fail(`隔离验收等待超时：${check}`);
	}

	evaluate(expression) {
		const id = ++this.sequence;
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.socket?.removeEventListener("message", listen);
				reject(new Error(`隔离 Obsidian 调用超时：${expression}`));
			}, 5000);
			const listen = event => {
				const message = JSON.parse(event.data);
				if (message.id !== id) return;
				clearTimeout(timeout);
				this.socket.removeEventListener("message", listen);
				if (message.result?.exceptionDetails || message.error) {
					const detail = message.result?.exceptionDetails?.exception?.description || message.error?.message;
					reject(new Error(`${detail}（${expression}）`));
					return;
				}
				resolve(message.result?.result?.value);
			};
			this.socket.addEventListener("message", listen);
			this.socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
		});
	}
}

await runAcceptance();
