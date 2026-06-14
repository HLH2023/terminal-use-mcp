/**
 * terminal://sessions/{sessionId}/transcript MCP Resource
 *
 * 返回指定 session 的 transcript 文本（自动脱敏）。
 * URI 模板: terminal://sessions/<sessionId>/transcript
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionManager } from "../session-manager.js";
/** 注册 terminal://sessions/{sessionId}/transcript 资源模板，返回脱敏 transcript */
export declare function registerTranscriptResource(server: McpServer, sm: SessionManager): void;
