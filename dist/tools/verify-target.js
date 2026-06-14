/**
 * terminal.verify_target — SSH target 就绪度校验。
 *
 * 本工具明确不建立 SSH 连接，也不执行远端探测命令；只校验本地可证明的
 * 前置条件：profile 存在、host key 信任来源可用、认证材料可访问。真实连接、
 * 远端 shell/tmux/defaultCwd 探测由 SSH provider 补齐。
 */
import { z } from "zod";
import { TerminalUseError } from "../terminal/errors.js";
import { verifyPinnedFingerprint } from "../targets/host-fingerprint.js";
import { verifyHostKey } from "../targets/known-hosts.js";
import { resolveSshAuth } from "../targets/ssh-auth.js";
import { getSshProfile } from "../targets/ssh-profile-loader.js";
import { errorToToolResult, textContent } from "./tool-helpers.js";
const DEFAULT_KNOWN_HOSTS_PATH = "~/.ssh/known_hosts";
export function registerVerifyTargetTool(server, sm, hostsConfig, logger) {
    server.registerTool("terminal.verify_target", {
        description: "Verify SSH target profile readiness without opening an SSH connection",
        inputSchema: {
            profile: z.string().describe("SSH profile 名称"),
        },
    }, async (input) => {
        void sm;
        try {
            const profile = getRequiredProfile(hostsConfig, input.profile);
            const hostFingerprint = await verifyConfiguredHostKey(profile);
            const auth = await resolveConfiguredAuth(profile);
            const output = {
                ok: true,
                profile: profile.name,
                hostFingerprint,
                authType: auth.type,
                remote: buildBestEffortRemoteReadiness(profile),
            };
            logger.info("terminal.verify_target completed", { profile: profile.name, authType: auth.type });
            return {
                content: [textContent(`SSH target ${profile.name} readiness verified (local preflight only)`)],
                structuredContent: output,
            };
        }
        catch (err) {
            return errorToToolResult(err);
        }
    });
}
function getRequiredProfile(hostsConfig, profileName) {
    const profile = getSshProfile(hostsConfig, profileName);
    if (profile === undefined) {
        throw createSshToolError("SSH_PROFILE_NOT_FOUND", `SSH profile not found: ${profileName}`, `Configure profile ${profileName} in hosts.json before using terminal.verify_target`);
    }
    return profile;
}
async function verifyConfiguredHostKey(profile) {
    if (profile.pinnedHostFingerprint !== undefined) {
        const pinnedResult = verifyPinnedFingerprint(profile.pinnedHostFingerprint, profile.pinnedHostFingerprint);
        if (!pinnedResult.ok) {
            throw createSshToolError("SSH_HOST_KEY_UNKNOWN", `Pinned host fingerprint for profile ${profile.name} is invalid: ${pinnedResult.detail}`, "Use SHA256:<base64> or MD5:<hex-pairs> fingerprint format");
        }
        return pinnedResult.matches ? pinnedResult.fingerprint : profile.pinnedHostFingerprint;
    }
    const knownHostsPath = profile.knownHosts ?? DEFAULT_KNOWN_HOSTS_PATH;
    const knownHostResult = await verifyHostKey(profile.host, profile.port, knownHostsPath);
    if (knownHostResult.ok) {
        return knownHostResult.fingerprint;
    }
    throw knownHostResultToError(profile, knownHostResult);
}
async function resolveConfiguredAuth(profile) {
    try {
        return await resolveSshAuth(profile.auth);
    }
    catch (err) {
        throw createSshToolError("SSH_AUTH_FAILED", `SSH auth preflight failed for profile ${profile.name}: ${formatUnknownError(err)}`, "Use ssh-agent with SSH_AUTH_SOCK or configure a readable key-file path", formatUnknownError(err));
    }
}
function knownHostResultToError(profile, result) {
    if (result.reason === "key_mismatch") {
        return createSshToolError("SSH_HOST_KEY_MISMATCH", `Known host key mismatch for ${profile.name}: ${result.detail}`, "Inspect known_hosts and verify the host key out-of-band before connecting", result);
    }
    return createSshToolError("SSH_HOST_KEY_UNKNOWN", `Host key cannot be verified for ${profile.name}: ${result.detail}`, "Add the host to known_hosts or configure pinnedHostFingerprint; never disable host key checking", result);
}
function buildBestEffortRemoteReadiness(profile) {
    return {
        shell: "unknown",
        tmuxAvailable: profile.allowTmux ?? false,
        defaultCwdExists: profile.defaultCwd !== undefined,
    };
}
function createSshToolError(code, message, hint, details) {
    return new TerminalUseError({ code: code, message, retryable: false, hint, details });
}
function formatUnknownError(err) {
    if (err instanceof Error) {
        return `${err.name}: ${err.message}`;
    }
    return String(err);
}
