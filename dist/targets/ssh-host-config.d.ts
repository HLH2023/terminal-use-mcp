/**
 * SSH hosts 配置加载器
 *
 * 支持三种配置来源（按优先级）：
 * 1. 旧格式 hosts.json —— 一次性包含所有 SSH profile（向后兼容）
 * 2. 新格式 profiles/<name>.json —— 每个 host 一份增量 overlay
 * 3. OpenSSH ~/.ssh/config —— SSH 连接参数复用（通过 sshConfigHost 字段引用）
 *
 * 文件发现：
 * - 环境变量 TERMINAL_USE_HOSTS_CONFIG → 旧格式文件路径（最高优先覆盖）
 * - 环境变量 TERMINAL_USE_CONFIG_DIR → XDG 配置目录
 * - $XDG_CONFIG_HOME/terminal-use-mcp/ → 新格式配置根目录
 * - ~/.config/terminal-use-mcp/ → Linux 默认
 *
 * 安全原则：
 * - 禁止读取私钥内容、密码、token 或 .env 明文
 * - key-file 只保存路径，passphrase 只引用环境变量名
 * - 配置目录权限 0700，配置文件权限 0600
 */
import type { SshHostProfile } from "./target-types.js";
export { expandTildePath, expandUserPath } from "./ssh-host-config-helpers.js";
/** hosts.json 顶层结构，保留给外部模块共享。 */
export type SshHostsConfig = {
    hosts: Record<string, SshHostProfile>;
};
/** 测试和显式重新加载时使用：清空 singleton cache。 */
export declare function clearHostsConfigCache(): void;
/**
 * 当前配置路径：环境变量优先，否则使用 XDG 默认路径。
 *
 * TERMINAL_USE_HOSTS_CONFIG → 旧格式 paths.json 兼容
 * TERMINAL_USE_CONFIG_DIR → 新格式 XDG 配置目录
 * 默认 → $XDG_CONFIG_HOME/terminal-use-mcp/
 */
export declare function getHostsConfigPath(env?: NodeJS.ProcessEnv): string;
/**
 * 加载 SSH profiles（主入口）。
 *
 * 加载流程：
 * 1. 如果指定了旧格式 hosts.json 路径（TERMINAL_USE_HOSTS_CONFIG）→ 直接加载
 * 2. 否则尝试 XDG 配置目录：
 *    a. profiles/<name>.json → 新格式 overlay 文件
 *    b. hosts.json → 旧格式兼容文件（如果 profiles/ 目录为空）
 * 3. 对含 sshConfigHost 的 profile，从 OpenSSH config 解析连接参数
 * 4. 对所有路径值做 ~ 展开和 ${ENV_VAR} 展开
 */
export declare function loadHostsConfig(configPath?: string, env?: NodeJS.ProcessEnv): Promise<Map<string, SshHostProfile>>;
