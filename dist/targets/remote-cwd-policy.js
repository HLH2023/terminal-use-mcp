/**
 * 远程 CWD 策略
 *
 * 远程 cwd 与本地 workspace cwd policy 完全分离；只依据 SSH profile 中的
 * remoteAllowedCwd / remoteDeniedCwd 判断。这里不访问远程文件系统。
 */
import { resolve } from "node:path";
import { RemoteCwdDeniedError } from "../terminal/errors.js";
/** 从 profile 创建已规范化的远程 cwd policy。 */
export function createRemoteCwdPolicy(profile) {
    return {
        allowedRoots: profile.remoteAllowedCwd.map(normalizeRemotePath),
        deniedRoots: (profile.remoteDeniedCwd ?? []).map(normalizeRemotePath),
        defaultCwd: profile.defaultCwd === undefined ? undefined : normalizeRemotePath(profile.defaultCwd),
    };
}
/** 判断 cwd 是否允许；cwd 未传时使用 policy.defaultCwd。 */
export function isRemoteCwdAllowed(policy, cwd) {
    const selected = selectCwd(policy, cwd);
    if (selected === undefined) {
        return { ok: false, reason: "Remote CWD is required when profile has no defaultCwd" };
    }
    const normalizedCwd = normalizeRemotePath(selected);
    const allowedRoots = policy.allowedRoots.map(normalizeRemotePath);
    const deniedRoots = policy.deniedRoots.map(normalizeRemotePath);
    if (allowedRoots.length === 0) {
        return { ok: false, reason: "Remote CWD policy has no allowed roots" };
    }
    const matchedAllowedRoot = allowedRoots.find((root) => isPathInsideRoot(normalizedCwd, root));
    if (matchedAllowedRoot === undefined) {
        return { ok: false, reason: `Remote CWD "${normalizedCwd}" is outside allowed roots` };
    }
    const matchedDeniedRoot = deniedRoots.find((root) => isPathInsideRoot(normalizedCwd, root));
    if (matchedDeniedRoot !== undefined) {
        return { ok: false, reason: `Remote CWD "${normalizedCwd}" is under denied root "${matchedDeniedRoot}"` };
    }
    return { ok: true };
}
/** 解析并返回最终 cwd；不允许时抛 REMOTE_CWD_DENIED。 */
export function resolveRemoteCwd(policy, cwd) {
    const selected = selectCwd(policy, cwd);
    const normalizedCwd = selected === undefined ? "" : normalizeRemotePath(selected);
    const result = isRemoteCwdAllowed(policy, cwd);
    if (!result.ok) {
        throw new RemoteCwdDeniedError(normalizedCwd || "<missing>", result.reason);
    }
    return normalizedCwd;
}
/** 语义化别名：用于调用方只关心是否允许并想要统一错误码时。 */
export function assertRemoteCwdAllowed(policy, cwd) {
    return resolveRemoteCwd(policy, cwd);
}
/** 使用 POSIX 风格绝对路径规范化，避免把相对路径锚定到本机 workspace。 */
export function normalizeRemotePath(value) {
    return resolve("/", value);
}
function selectCwd(policy, cwd) {
    if (cwd !== undefined && cwd.trim().length > 0)
        return cwd;
    return policy.defaultCwd;
}
function isPathInsideRoot(candidate, root) {
    const normalizedCandidate = normalizeRemotePath(candidate);
    const normalizedRoot = normalizeRemotePath(root);
    // 与现有本地 cwd policy 保持一致："/" 只拒绝根目录本身，避免吞掉更具体的 allow root。
    if (normalizedRoot === "/") {
        return normalizedCandidate === "/";
    }
    return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
}
