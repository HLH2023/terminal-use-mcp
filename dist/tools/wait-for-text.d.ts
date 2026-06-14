/** terminal.wait_for_text — 等待屏幕出现指定文本或正则。 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "../logger.js";
import type { ProviderExecutor } from "./tool-helpers.js";
export declare function registerWaitForTextTool(server: McpServer, executor: ProviderExecutor, logger: Logger): void;
