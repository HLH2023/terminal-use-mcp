/** terminal.scroll — 滚动终端视图。 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "../logger.js";
import type { ProviderExecutor } from "./tool-helpers.js";
export declare function registerScrollTool(server: McpServer, executor: ProviderExecutor, logger: Logger): void;
