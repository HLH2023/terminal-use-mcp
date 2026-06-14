/**
 * terminal.verify_target — SSH target 就绪度校验。
 *
 * 本工具明确不建立 SSH 连接，也不执行远端探测命令；只校验本地可证明的
 * 前置条件：profile 存在、host key 信任来源可用、认证材料可访问。真实连接、
 * 远端 shell/tmux/defaultCwd 探测由 SSH provider 补齐。
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "../logger.js";
import type { SessionManager } from "../session-manager.js";
import type { SshHostProfile } from "../targets/target-types.js";
export declare function registerVerifyTargetTool(server: McpServer, sm: SessionManager, hostsConfig: Map<string, SshHostProfile>, logger: Logger): void;
