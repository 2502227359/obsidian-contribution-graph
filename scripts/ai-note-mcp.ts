import { createInterface } from "node:readline";
import { AiNoteError } from "../src/activity/aiEditProtocol";

type JsonObject = Record<string, unknown>;

const tools = [
	{
		name: "read_note",
		description: "读取已配置笔记库内的 Markdown 文件、行切片及全文 SHA-256 版本摘要，并返回该路径是否可写、是否计入统计以及是否正在 Obsidian 编辑器中活跃编辑。任何写入或局部补丁前都必须先调用此工具。",
		annotations: { readOnlyHint: true, openWorldHint: false },
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "笔记库内的 Markdown 相对路径（使用正斜杠，例如 临床医学/内科学.md）" },
				startLine: { type: "integer", minimum: 1, description: "可选：1-based 起始行号，仅返回指定切片，但 beforeSha256 仍为全文摘要" },
				endLine: { type: "integer", minimum: 1, description: "可选：1-based 结束行号（含）" },
			},
			required: ["path"],
			additionalProperties: false,
		},
	},
	{
		name: "patch_note",
		description: "【推荐默认修改工具】对已存在的 Markdown 笔记执行精确局部补丁，避免整篇覆写漏掉 YAML、图片嵌入或块引用 ID。会自动保留原换行符、写前备份并上报确认的字符变更；返回结果区分 noteStatus（正文状态）与 statisticsStatus（统计状态）。",
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "笔记库内的 Markdown 相对路径" },
				beforeSha256: { type: "string", description: "上一笔 read_note 返回的全文 SHA-256 摘要" },
				edits: {
					type: "array",
					minItems: 1,
					description: "按顺序执行的精确替换列表；默认每条 oldText 必须在当前笔记中唯一匹配",
					items: {
						type: "object",
						properties: {
							oldText: { type: "string", description: "要替换的原始文本片段（需包含足够上下文确保唯一匹配）" },
							newText: { type: "string", description: "替换后的新文本片段" },
							replaceAll: { type: "boolean", description: "可选：为 true 时替换所有匹配项，默认 false 强制唯一匹配" },
						},
						required: ["oldText", "newText"],
						additionalProperties: false,
					},
				},
				preserveEol: { type: "boolean", description: "可选：是否保留原文件换行符（CRLF/LF），默认 true" },
				confirmDestructive: { type: "boolean", description: "可选：仅在确认需要大幅删减正文或删除 Frontmatter 时传 true" },
			},
			required: ["path", "beforeSha256", "edits"],
			additionalProperties: false,
		},
	},
	{
		name: "write_note",
		description: "新建 Markdown 笔记（mode: \"create\"）或显式整篇替换（mode: \"replace\"）。局部修改请优先使用 patch_note。会自动校验版本摘要、结构完整性护栏（Frontmatter/嵌入/块 ID/大幅删减）、保存写前快照并区分返回 noteStatus 与 statisticsStatus。",
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "笔记库内的 Markdown 相对路径" },
				content: { type: "string", description: "完整的 Markdown 笔记正文" },
				beforeSha256: { type: "string", description: "上一笔 read_note 返回的全文 SHA-256 摘要（新建时为 read_note 对不存在路径返回的空串摘要）" },
				mode: { type: "string", enum: ["create", "replace"], description: "可选：create 强制要求文件不存在；replace 强制要求文件已存在" },
				preserveEol: { type: "boolean", description: "可选：是否保留原文件换行符（CRLF/LF），默认 true" },
				confirmDestructive: { type: "boolean", description: "可选：确认大幅删减或删除 Frontmatter/图片嵌入/块 ID 时传 true" },
			},
			required: ["path", "content", "beforeSha256"],
			additionalProperties: false,
		},
	},
	{
		name: "list_note_backups",
		description: "查看最近保存在本机 Spool（库外）的 AI 写入前备份快照列表，可用于排查或回滚误改。",
		annotations: { readOnlyHint: true, openWorldHint: false },
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "可选：仅列出指定笔记路径的备份" },
				limit: { type: "integer", minimum: 1, maximum: 200, description: "可选：返回条数上限，默认 20" },
			},
			additionalProperties: false,
		},
	},
	{
		name: "restore_note_backup",
		description: "将指定笔记回滚到某次 AI 写入前的备份快照。回滚前会先为当前版本再存一份快照，并校验 beforeSha256。",
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
		inputSchema: {
			type: "object",
			properties: {
				backupId: { type: "string", description: "list_note_backups 或写入结果返回的 backupId" },
				beforeSha256: { type: "string", description: "当前目标笔记通过 read_note 得到的 SHA-256 摘要" },
			},
			required: ["backupId", "beforeSha256"],
			additionalProperties: false,
		},
	},
];

export async function serveAiNotes(call: (name: string, args: unknown) => Promise<unknown>): Promise<void> {
	for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
		if (!line.trim()) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON 解析失败" } })}\n`);
			continue;
		}
		const response = await respond(parsed, call);
		if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
	}
}

export async function respond(input: unknown, call: (name: string, args: unknown) => Promise<unknown>): Promise<JsonObject | undefined> {
	const request = input as JsonObject | null;
	if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
		return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "请求格式无效" } };
	}
	if (request.id === undefined) return undefined;
	const base = { jsonrpc: "2.0", id: request.id };
	const params = request.params as JsonObject | undefined;
	switch (request.method) {
		case "initialize": {
			const versions = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
			const requested = params?.protocolVersion;
			const protocolVersion = typeof requested === "string" && versions.includes(requested) ? requested : versions[0];
			return { ...base, result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "obsidian-ai-notes", version: "2.0.0" } } };
		}
		case "ping": return { ...base, result: {} };
		case "tools/list": return { ...base, result: { tools } };
		case "tools/call": return { ...base, result: await callTool(params, call) };
		default: return { ...base, error: { code: -32601, message: "不支持的请求方法" } };
	}
}

async function callTool(params: JsonObject | undefined, call: (name: string, args: unknown) => Promise<unknown>): Promise<JsonObject> {
	try {
		if (typeof params?.name !== "string") throw new AiNoteError("INVALID_REQUEST", "需要指定工具名称");
		const value = await call(params.name, params.arguments);
		const isDomainFailure = !!value && typeof value === "object" && (value as { ok?: unknown }).ok === false;
		return {
			...(isDomainFailure ? { isError: true } : {}),
			content: [{ type: "text", text: JSON.stringify(value) }],
		};
	} catch (error) {
		const payload = error instanceof AiNoteError
			? error.toJSON()
			: {
				ok: false,
				errorCode: "IO_ERROR",
				message: error instanceof Error ? error.message : String(error),
				noteModified: false,
				retrySafe: false,
			};
		return { isError: true, content: [{ type: "text", text: JSON.stringify(payload) }] };
	}
}
