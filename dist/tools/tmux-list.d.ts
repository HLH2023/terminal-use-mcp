import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "../logger.js";
import type { SessionManager } from "../session-manager.js";
import type { SshHostProfile } from "../targets/target-types.js";
import { ProviderExecutor } from "./tool-helpers.js";
type TmuxToolRuntime = ProviderExecutor | SessionManager;
export declare function registerTmuxListTool(server: McpServer, runtime: TmuxToolRuntime, logger: Logger, hostsConfig?: ReadonlyMap<string, SshHostProfile>): void;
export {};
