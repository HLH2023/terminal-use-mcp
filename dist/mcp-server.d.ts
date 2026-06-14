/**
 * MCP Server 工厂 — 创建 McpServer 实例并注册全部 29 tools + resources + prompts。
 *
 * 由 index.ts 调用 createMcpServer(sm, config, hostsConfig, logger)，
 * 返回已就绪的 McpServer 实例，只需连接 StdioServerTransport 即可启动。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionManager } from "./session-manager.js";
import type { TerminalUseConfig } from "./config.js";
import type { Logger } from "./logger.js";
import type { SshHostProfile } from "./targets/target-types.js";
/**
 * 创建并配置完整的 MCP Server 实例。
 *
 * @param sm      已完成 provider 注册的 SessionManager
 * @param config  终端配置（主要取 artifactDir）
 * @param hostsConfig SSH hosts.json 加载后的安全 profile Map
 * @param logger  stderr 日志
 */
export declare function createMcpServer(sm: SessionManager, config: TerminalUseConfig, hostsConfig: Map<string, SshHostProfile>, logger: Logger): McpServer;
