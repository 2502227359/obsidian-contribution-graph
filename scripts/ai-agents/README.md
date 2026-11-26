# AI 编辑统计接入

这些文件只提供 Agent 的项目级接入适配，不修改 Codex、Pi、Antigravity 的用户配置，也不写入正式库。启用前先在 CMBK 设置中打开“统计 AI 编辑”。

共享写入工具是构建产物 `ai-note-write.cjs`。它接收一条 JSON：

```json
{"path":"临床医学/测试.md","beforeSha256":"...","content":"写入后的全文"}
```

启动参数必须包含 `--vault <CMBK 绝对路径>` 和 `--source <agent-id>`。工具负责校验路径、写入前哈希、AI 统计开关、字符差异和本地待处理队列。只有通过它写入的内容才会按来源计入统计。

## Codex

将 `codex-mcp.example.toml` 合并到项目的 `.codex/config.toml`。替换写入工具和笔记库的绝对路径。先调用 `read_note` 取得正文及版本摘要，再用摘要调用 `write_note`。

Codex 原生 `apply_patch`、Bash、PowerShell 或外部脚本不自动计数；它们没有一个可靠的、写入前且不重复执行的统一入口。需要计入统计的修改必须改用 MCP 写入工具。

## Pi

把 `pi-ai-statistics.ts` 放入项目的 `.pi/extensions/`。扩展注册 `contribution_graph_ai_read` 和 `contribution_graph_ai_edit`。写入必须使用先前读取时返回的版本摘要。

Pi 默认从项目的 `.obsidian/plugins/contribution-graph-local/ai-note-write.cjs` 启动写入工具，也可以设置下列环境变量。

```powershell
$env:CONTRIBUTION_GRAPH_VAULT_ROOT = 'C:\path\to\CMBK'
$env:CONTRIBUTION_GRAPH_AI_WRITER = 'C:\path\to\ai-note-write.cjs'
```

需要统计 AI 编辑时使用 `contribution_graph_ai_edit`，不要对同一笔记再调用原生 `edit`、`write`、Bash 或 PowerShell 写入。

## Antigravity

将配置合并到项目的 `.agents/mcp_config.json`，并替换笔记库与工具的绝对路径。分别验证终端和 T3 ACP 的工具发现。需要区分两者时，分别配置来源标识。绕过接入工具的原生写入不计入。

## 通用 MCP 模板

`mcp-config.example.json` 只保留 source 占位符，可用于其他支持 stdio MCP 的 Agent。每个 Agent 应使用稳定、可识别的 source 值，避免多个来源共用一个标识。

## 离线检查

```powershell
$env:CONTRIBUTION_GRAPH_VAULT_ROOT = 'C:\path\to\CMBK'
Get-Content request.json | node C:\path\to\ai-note-write.cjs --vault $env:CONTRIBUTION_GRAPH_VAULT_ROOT --source test-agent
```

先用测试库验证图表新增、删除、版本冲突和重复投递。历史 AI 编辑不会回填。开启「排除 Markdown 格式」时，当前版本仍可通过工具写入笔记，但跳过 AI 计数。
