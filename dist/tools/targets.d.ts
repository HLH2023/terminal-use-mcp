/**
 * terminal.targets — 列出本地与 SSH profile target。
 *
 * 输出只包含连接所需的非敏感摘要；不会暴露 key-file 路径、passphrase、
 * token、password 或任何 env 值。
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "../logger.js";
import type { SshHostProfile } from "../targets/target-types.js";
export declare function registerTargetsTool(server: McpServer, hostsConfig: ReadonlyMap<string, SshHostProfile>, logger: Logger): void;
