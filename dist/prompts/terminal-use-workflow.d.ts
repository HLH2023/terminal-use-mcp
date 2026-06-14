/**
 * terminal-use-basic-workflow MCP Prompt
 *
 * 标准终端控制工作流提示词，引导 agent 遵循 observe-act 循环
 * 与安全规范来操作终端。
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
/** 注册标准终端控制工作流提示词 */
export declare function registerTerminalUseWorkflowPrompt(server: McpServer): void;
