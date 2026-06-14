/**
 * SSH 认证解析。
 *
 * 安全边界：
 * - 支持 ssh-agent 与 key-file 两种方式。
 * - 不支持 password。
 * - key-file 只检查路径可读，不读取私钥内容。
 * - passphrase 只检查环境变量是否存在，不读取变量值。
 *
 * SSH_AUTH_SOCK 发现链：
 * 1. auth.socket（profile 中显式指定，最高优先）
 * 2. SSH_AUTH_SOCK 环境变量（MCP 客户端传入）
 * 3. XDG_RUNTIME_DIR/ssh-agent.socket（systemd user service）
 * 4. XDG_RUNTIME_DIR/keyring/ssh（GNOME Keyring）
 * 5. 运行时扫描 ss -x --no-header（兜底，可选）
 */
import type { SshAuthRef } from "./target-types.js";
/** 已解析的 SSH 认证配置 */
export type ResolvedSshAuth = {
    type: "agent";
    socket: string;
} | {
    type: "key-file";
    path: string;
    passphraseAvailable: boolean;
};
/** 将 profile 中的认证引用解析为 provider 可用的具体配置。 */
export declare function resolveSshAuth(auth: SshAuthRef): Promise<ResolvedSshAuth>;
/**
 * 获取 ssh-agent socket — 增强发现链。
 *
 * 优先级（高→低）：
 * 1. SSH_AUTH_SOCK 环境变量（MCP 客户端传入）
 * 2. XDG_RUNTIME_DIR/ssh-agent.socket（systemd user service）
 * 3. XDG_RUNTIME_DIR/keyring/ssh（GNOME Keyring）
 * 4. 运行时扫描 ss -x --no-header（兜底）
 *
 * profile 中的 auth.socket 显式传参在 resolveSshAuth 中优先于本函数。
 * 本函数只处理"没有显式指定 socket"时的自动发现。
 */
export declare function getSshAgentSocket(): string | undefined;
/** 检查 key-file 是否存在且可读；不会读取私钥内容。 */
export declare function isKeyFileAccessible(keyPath: string): Promise<boolean>;
