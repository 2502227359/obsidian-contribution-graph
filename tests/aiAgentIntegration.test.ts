import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("AI Agent integration assets", () => {
	it("uses registered Pi read, patch, and edit tools instead of post-write native hooks", () => {
		const source = readFileSync("scripts/ai-agents/pi-ai-statistics.ts", "utf8");
		expect(source).toContain("registerTool");
		expect(source).toContain("contribution_graph_ai_read");
		expect(source).toContain("contribution_graph_ai_patch");
		expect(source).toContain("contribution_graph_ai_edit");
		expect(source).toContain("beforeSha256");
		expect(source).not.toContain("tool_execution_end");
	});

	it("keeps the shared MCP examples parseable", () => {
		for (const file of ["mcp-config.example.json", "antigravity-mcp.example.json"]) {
			expect(() => JSON.parse(readFileSync(`scripts/ai-agents/${file}`, "utf8"))).not.toThrow();
		}
	});

	it("keeps Codex and Antigravity on the shared writer", () => {
		const codex = readFileSync("scripts/ai-agents/codex-mcp.example.toml", "utf8");
		expect(codex).toContain("[mcp_servers.contribution_graph_ai_write]");
		expect(codex).toContain("--mcp");
		expect(codex).toContain("ai-note-write.cjs");
		for (const file of ["antigravity-mcp.example.json"]) {
			const config = JSON.parse(readFileSync(`scripts/ai-agents/${file}`, "utf8")) as {
				mcpServers: Record<string, { args: string[] }>;
			};
			const args = config.mcpServers["contribution-graph-ai-write"].args;
			expect(args).toContain("--mcp");
			expect(args).toContain("--vault");
			expect(args).toContain("--source");
			expect(args.join(" ")).toContain("ai-note-write.cjs");
		}
	});
});
