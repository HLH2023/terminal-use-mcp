/** terminal.type — 向终端输入普通文本，不自动追加 Enter。 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "../logger.js";
import type { ProviderExecutor } from "./tool-helpers.js";
export declare function registerTypeTool(server: McpServer, executor: ProviderExecutor, logger: Logger): void;
