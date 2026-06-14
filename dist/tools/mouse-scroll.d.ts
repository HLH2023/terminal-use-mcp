/** terminal.mouse_scroll — 在终端指定位置注入鼠标滚轮事件 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "../logger.js";
import type { ProviderExecutor } from "./tool-helpers.js";
export declare function registerMouseScrollTool(server: McpServer, executor: ProviderExecutor, logger: Logger): void;
