/**
 * ssh-keyscan 预验证：为 ssh-tmux provider 提供 pinnedHostFingerprint 等价校验。
 *
 * ssh-pty provider 通过 ssh2 的 hostVerifier 在握手阶段直接比对 fingerprint；
 * ssh-tmux provider 使用系统 ssh 命令，没有对等的内建机制。
 * 本模块在 SSH 连接前调用 ssh-keyscan 获取远端 host key，
 * 计算其 fingerprint 与 profile.pinnedHostFingerprint 比对，
 * 匹配则生成临时 known_hosts 供后续 SSH 连接使用。
 *
 * 安全边界：
 * - 只使用 execFile("ssh-keyscan", args)，不使用 exec/shell 拼接。
 * - 只使用 execFile("ssh-keygen", args) 计算 fingerprint。
 * - 临时 known_hosts 文件权限 0600，session 结束时清理。
 * - 验证失败 fail-closed：抛 SshHostKeyMismatchError。
 */
import type { ResolvedSshTarget } from "./ssh-profile-loader.js";
export type KeyscanVerifySuccess = {
    verified: true;
    /** 临时 known_hosts 文件路径；供 SSH 连接使用，session 结束时需清理。 */
    tempKnownHostsPath: string;
    /** 匹配到的 fingerprint（用于日志/metadata）。 */
    matchedFingerprint: string;
};
export type KeyscanVerifyFailure = {
    verified: false;
    error: string;
};
export type KeyscanVerifyResult = KeyscanVerifySuccess | KeyscanVerifyFailure;
/**
 * 通过 ssh-keyscan 预验证 pinnedHostFingerprint。
 *
 * 流程：
 * 1. ssh-keyscan -p <port> -T <timeout> -t <keyTypes> <host>
 * 2. 解析输出提取 host key 行
 * 3. 将 key 行写入临时 known_hosts 文件（0600）
 * 4. 用 ssh-keygen -lf <tempFile> 逐行计算 fingerprint
 * 5. 与 profile.pinnedHostFingerprint 比对
 * 6. 匹配 → 返回 tempKnownHostsPath 供连接使用
 * 7. 不匹配 → 清理临时文件，返回失败
 */
export declare function verifyPinnedFingerprintViaKeyscan(profile: ResolvedSshTarget): Promise<KeyscanVerifyResult>;
/**
 * 便捷入口：验证 fingerprint 并在失败时直接抛错。
 * 成功时返回临时 known_hosts 路径。
 */
export declare function verifyPinnedFingerprintOrThrow(profile: ResolvedSshTarget): Promise<{
    tempKnownHostsPath: string;
    matchedFingerprint: string;
}>;
/** 清理临时 known_hosts 文件；传入 undefined 时为 no-op。 */
export declare function cleanupTempKnownHosts(path: string | undefined): void;
