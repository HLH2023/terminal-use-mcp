/** terminal.snapshot — 捕获当前终端屏幕状态。 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "../logger.js";
import type { ProviderExecutor } from "./tool-helpers.js";
export declare function registerSnapshotTool(server: McpServer, executor: ProviderExecutor, logger: Logger): void;
