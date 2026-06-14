/**
 * external-agent-control MCP Prompt
 *
 * 控制外部 agent（如 Claude Code、Codex、OpenCode 等）的安全准则提示词。
 * 核心原则：只观察，不自动执行 agent 提出的操作请求。
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
/** 注册外部 agent 控制安全准则提示词 */
export declare function registerExternalAgentControlPrompt(server: McpServer): void;
