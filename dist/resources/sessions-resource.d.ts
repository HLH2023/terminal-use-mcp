/**
 * terminal://sessions MCP Resource
 *
 * 列出所有活跃终端 session 的 JSON 数组。
 * 供 MCP client 读取当前 session 列表快照，无需调用 tool。
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionManager } from "../session-manager.js";
/** 注册 terminal://sessions 资源，返回所有活跃 session 的 JSON 列表 */
export declare function registerSessionsResource(server: McpServer, sm: SessionManager): void;
