/** terminal.find — 在当前屏幕或 scrollback 中查找文本/正则匹配。 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "../logger.js";
import type { ProviderExecutor } from "./tool-helpers.js";
export declare function registerFindTool(server: McpServer, executor: ProviderExecutor, logger: Logger): void;
