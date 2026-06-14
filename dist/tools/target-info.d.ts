/**
 * terminal.target_info — 查询单个 SSH target 的脱敏详情。
 *
 * 该工具用于让 agent 判断 profile 形态与安全边界，不提供任何凭据材料：
 * key-file 只返回“已配置/未配置”，passphraseEnv 只返回是否配置，env 只返回数量。
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "../logger.js";
import type { SshHostProfile } from "../targets/target-types.js";
export declare function registerTargetInfoTool(server: McpServer, hostsConfig: ReadonlyMap<string, SshHostProfile>, logger: Logger): void;
