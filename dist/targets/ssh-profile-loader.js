/**
 * SSH target/profile 解析
 *
 * 默认只允许通过 hosts.json profile 连接远程主机；inline host 需要显式环境变量开启。
 * 本模块只做配置解析和安全闸门，不建立 SSH 连接。
 */
import { InternalError, SshInlineTargetDeniedError, SshProfileNotFoundError } from "../terminal/errors.js";
import { isSshAuthRef } from "./target-types.js";
/** 环境变量闸门：默认拒绝 inline SSH target。 */
export function isInlineSshTargetAllowed(env = process.env) {
    return env.TERMINAL_USE_ALLOW_INLINE_SSH_TARGETS === "1";
}
/** 解析 local/ssh target；local 原样返回，ssh 返回完整 profile。 */
export function resolveSshTarget(target, hostsConfig) {
    if (target.kind === "local") {
        return { kind: "local" };
    }
    if (target.profile !== undefined && target.profile.trim().length > 0) {
        const profile = hostsConfig.get(target.profile);
        if (profile === undefined) {
            throw new SshProfileNotFoundError(target.profile);
        }
        return mergeProfileWithInlineOverrides(profile, target);
    }
    if (!isInlineSshTargetAllowed()) {
        throw new SshInlineTargetDeniedError();
    }
    return resolveInlineTarget(target);
}
/** 只读 SSH profile 查询入口（供 verify_target 等工具使用）。 */
export function getSshProfile(hostsConfig, profileName) {
    return hostsConfig.get(profileName);
}
function mergeProfileWithInlineOverrides(profile, target) {
    const auth = target.auth ?? profile.auth;
    const resolved = {
        ...cloneProfile(profile),
        kind: "ssh",
        profile: profile.name,
        host: target.host ?? profile.host,
        port: target.port ?? profile.port,
        username: target.username ?? profile.username,
        auth,
        knownHostPolicy: "strict",
    };
    validateResolvedSshTarget(resolved);
    return resolved;
}
function resolveInlineTarget(target) {
    const host = requireNonEmptyString(target.host, "Inline SSH target must include host");
    const username = requireNonEmptyString(target.username, "Inline SSH target must include username");
    const port = requirePort(target.port, "Inline SSH target must include port");
    const auth = requireAuth(target.auth, "Inline SSH target must include auth");
    const resolved = {
        kind: "ssh",
        name: `inline:${username}@${host}:${port}`,
        host,
        port,
        username,
        auth,
        knownHostPolicy: target.knownHostPolicy ?? "strict",
        // inline target 无 profile 级 cwd 策略，默认不给任何远程 cwd 放行。
        remoteAllowedCwd: [],
        allowTmux: false,
    };
    validateResolvedSshTarget(resolved);
    return resolved;
}
function validateResolvedSshTarget(target) {
    requireNonEmptyString(target.host, "Resolved SSH target is missing host");
    requirePort(target.port, "Resolved SSH target is missing port");
    requireNonEmptyString(target.username, "Resolved SSH target is missing username");
    requireAuth(target.auth, "Resolved SSH target is missing auth");
    if (target.knownHostPolicy !== "strict") {
        throw new InternalError("Resolved SSH target must use strict knownHostPolicy");
    }
}
function requireNonEmptyString(value, message) {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new InternalError(message);
    }
    return value.trim();
}
function requirePort(value, message) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
        throw new InternalError(message);
    }
    return value;
}
function requireAuth(value, message) {
    if (!isSshAuthRef(value)) {
        throw new InternalError(message);
    }
    return value;
}
function cloneAuth(auth) {
    return auth.type === "agent"
        ? { type: "agent", socket: auth.socket }
        : { type: "key-file", path: auth.path, passphraseEnv: auth.passphraseEnv };
}
function cloneProfile(profile) {
    return {
        ...profile,
        auth: cloneAuth(profile.auth),
        remoteAllowedCwd: [...profile.remoteAllowedCwd],
        remoteDeniedCwd: profile.remoteDeniedCwd === undefined ? undefined : [...profile.remoteDeniedCwd],
        env: profile.env === undefined ? undefined : { ...profile.env },
    };
}
