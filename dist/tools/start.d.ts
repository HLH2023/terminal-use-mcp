import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "../logger.js";
import type { SessionManager } from "../session-manager.js";
import type { TerminalUseConfig } from "../config.js";
export declare function registerStartTool(server: McpServer, sm: SessionManager, logger: Logger, config: TerminalUseConfig): void;
