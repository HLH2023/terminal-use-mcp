/**
 * 远程 CWD 策略
 *
 * 远程 cwd 与本地 workspace cwd policy 完全分离；只依据 SSH profile 中的
 * remoteAllowedCwd / remoteDeniedCwd 判断。这里不访问远程文件系统。
 */
import type { RemoteCwdPolicy, SshHostProfile } from "./target-types.js";
export type RemoteCwdSafetyResult = {
    ok: true;
} | {
    ok: false;
    reason: string;
};
/** 从 profile 创建已规范化的远程 cwd policy。 */
export declare function createRemoteCwdPolicy(profile: SshHostProfile): RemoteCwdPolicy;
/** 判断 cwd 是否允许；cwd 未传时使用 policy.defaultCwd。 */
export declare function isRemoteCwdAllowed(policy: RemoteCwdPolicy, cwd?: string): RemoteCwdSafetyResult;
/** 解析并返回最终 cwd；不允许时抛 REMOTE_CWD_DENIED。 */
export declare function resolveRemoteCwd(policy: RemoteCwdPolicy, cwd?: string): string;
/** 语义化别名：用于调用方只关心是否允许并想要统一错误码时。 */
export declare function assertRemoteCwdAllowed(policy: RemoteCwdPolicy, cwd?: string): string;
/** 使用 POSIX 风格绝对路径规范化，避免把相对路径锚定到本机 workspace。 */
export declare function normalizeRemotePath(value: string): string;
