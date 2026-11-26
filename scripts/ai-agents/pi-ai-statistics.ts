import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { Type } from "@sinclair/typebox";

type NoteRequest = Record<string, unknown> & { path?: string };
type WriterAction = "read" | "patch" | "write";
const installedWriter = ".obsidian/plugins/contribution-graph-local/ai-note-write.cjs";

function noteRoot(cwd: string): string {
	if (process.env.CONTRIBUTION_GRAPH_VAULT_ROOT) return process.env.CONTRIBUTION_GRAPH_VAULT_ROOT;
	for (let root = resolve(cwd); dirname(root) !== root; root = dirname(root)) {
		if (existsSync(resolve(root, installedWriter))) return root;
	}
	return cwd;
}

function runWriter(vaultRoot: string, request: NoteRequest, action: WriterAction): Promise<string> {
	if (typeof request.path !== "string" || isAbsolute(request.path) || request.path.split(/[\\/]/).includes("..")) {
		throw new Error("AI 编辑路径必须是库内相对路径");
	}
	const notePath = request.path.replace(/\\/g, "/");
	const writer = process.env.CONTRIBUTION_GRAPH_AI_WRITER ||
		resolve(vaultRoot, installedWriter);
	return new Promise((resolvePromise, reject) => {
		const actionFlags = action === "read" ? ["--read"] : action === "patch" ? ["--patch"] : [];
		const args = [writer, "--vault", vaultRoot, "--source", "pi", ...actionFlags];
		const child = spawn(process.execPath, args, {
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (error) reject(error);
			else resolvePromise(stdout.trim());
		};
		const timer = setTimeout(() => {
			child.kill();
			finish(new Error("AI 统计写入工具超时"));
		}, 60000);
		child.stdout.on("data", chunk => { stdout += String(chunk); });
		child.stderr.on("data", chunk => { stderr += String(chunk); });
		child.once("error", error => finish(error));
		child.once("close", code => {
			if (code === 0) finish();
			else finish(new Error(stderr.trim() || `AI 统计写入工具退出码 ${code ?? "unknown"}`));
		});
		child.stdin.end(JSON.stringify({ ...request, path: notePath }));
	});
}

export default function contributionGraphPiExtension(pi: any): void {
	const result = (text: string) => ({ content: [{ type: "text", text }] });
	pi.registerTool({
		name: "contribution_graph_ai_read",
		label: "读取笔记版本",
		description: "读取库内 Markdown 笔记、行切片及全文版本摘要，并检查写入权限与活跃编辑器状态。",
		parameters: Type.Object({
			path: Type.String({ description: "库内的 Markdown 相对路径" }),
			startLine: Type.Optional(Type.Integer({ description: "可选：1-based 起始行号" })),
			endLine: Type.Optional(Type.Integer({ description: "可选：1-based 结束行号" })),
		}),
		async execute(_id: string, params: NoteRequest, _signal: AbortSignal, _update: unknown, ctx: { cwd: string }) {
			return result(await runWriter(noteRoot(ctx.cwd), params, "read"));
		},
	});
	pi.registerTool({
		name: "contribution_graph_ai_patch",
		label: "Contribution Graph AI patch",
		description: "优先用于局部修改已存在的 Markdown 笔记，通过精确匹配补丁避免整篇覆写，自动备份并记录 AI 编辑统计。",
		promptSnippet: "对已有 Markdown 笔记应用精确局部补丁并记录 AI 编辑统计",
		promptGuidelines: [
			"修改已有笔记的局部内容时，优先使用 contribution_graph_ai_read + contribution_graph_ai_patch，不要整篇重写。",
			"若返回 noteStatus 为 committed 且 retrySafe 为 false，不要重复写入同一变更。",
		],
		parameters: Type.Object({
			path: Type.String({ description: "vault 内的 Markdown 相对路径" }),
			beforeSha256: Type.String({ description: "读取笔记时返回的全文 SHA-256 摘要" }),
			edits: Type.Array(Type.Object({
				oldText: Type.String({ description: "需要替换的原始文本（需唯一匹配）" }),
				newText: Type.String({ description: "替换后的文本" }),
				replaceAll: Type.Optional(Type.Boolean({ description: "是否替换全部匹配，默认 false" })),
			})),
			preserveEol: Type.Optional(Type.Boolean({ description: "是否保留原换行符，默认 true" })),
			confirmDestructive: Type.Optional(Type.Boolean({ description: "是否确认大幅删减，默认 false" })),
		}),
		async execute(_id: string, params: NoteRequest, _signal: AbortSignal, _update: unknown, ctx: { cwd: string }) {
			return result(await runWriter(noteRoot(ctx.cwd), params, "patch"));
		},
	});
	pi.registerTool({
		name: "contribution_graph_ai_edit",
		label: "Contribution Graph AI edit",
		description: "新建 Markdown 笔记或显式整篇替换，并记录 AI 编辑统计。局部改动请优先使用 contribution_graph_ai_patch。",
		promptSnippet: "通过统计写入工具创建或整篇替换 Markdown 笔记",
		promptGuidelines: [
			"新建笔记请先调用 contribution_graph_ai_read，再用返回的空串摘要与 mode: \"create\" 调用 contribution_graph_ai_edit。",
			"不要对同一笔记再调用原生 edit、write、bash 或 powershell 写入。",
		],
		parameters: Type.Object({
			path: Type.String({ description: "vault 内的 Markdown 相对路径" }),
			content: Type.String({ description: "写入后的完整 Markdown 内容" }),
			beforeSha256: Type.String({ description: "读取笔记时返回的 SHA-256 版本摘要" }),
			mode: Type.Optional(Type.Union([Type.Literal("create"), Type.Literal("replace")])),
			preserveEol: Type.Optional(Type.Boolean()),
			confirmDestructive: Type.Optional(Type.Boolean()),
		}),
		async execute(_id: string, params: NoteRequest, _signal: AbortSignal, _update: unknown, ctx: { cwd: string }) {
			return result(await runWriter(noteRoot(ctx.cwd), params, "write"));
		},
	});
}
