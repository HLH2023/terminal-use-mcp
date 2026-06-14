/** terminal.paste — 带大粘贴和 secret 防护的粘贴输入。 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "../logger.js";
import type { ProviderExecutor } from "./tool-helpers.js";
export declare function registerPasteTool(server: McpServer, executor: ProviderExecutor, logger: Logger): void;
