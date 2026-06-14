/**
 * terminal.target_info — 查询单个 SSH target 的脱敏详情。
 *
 * 该工具用于让 agent 判断 profile 形态与安全边界，不提供任何凭据材料：
 * key-file 只返回“已配置/未配置”，passphraseEnv 只返回是否配置，env 只返回数量。
 */
import { z } from "zod";
import { TerminalUseError } from "../terminal/errors.js";
import { getSshProfile } from "../targets/ssh-profile-loader.js";
import { errorToToolResult, textContent } from "./tool-helpers.js";
export function registerTargetInfoTool(server, hostsConfig, logger) {
    server.registerTool("terminal.target_info", {
        description: "Get redacted SSH target details",
        inputSchema: {
            profile: z.string().describe("SSH profile 名称"),
        },
    }, async (input) => {
        try {
            const profile = getRequiredProfile(hostsConfig, input.profile);
            const output = { ok: true, target: redactProfile(profile) };
            logger.debug("terminal.target_info completed", { profile: input.profile });
            return {
                content: [textContent(`SSH target ${input.profile} info (redacted)`)],
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
        throw createSshToolError("SSH_PROFILE_NOT_FOUND", `SSH profile not found: ${profileName}`, `Configure profile ${profileName} in hosts.json before using terminal.target_info`);
    }
    return profile;
}
function redactProfile(profile) {
    return {
        kind: "ssh",
        profile: profile.name,
        host: profile.host,
        port: profile.port,
        username: profile.username,
        auth: redactAuth(profile),
        knownHostPolicy: "strict",
        hostKey: {
            knownHostsConfigured: profile.knownHosts !== undefined,
            knownHostsPath: profile.knownHosts === undefined ? undefined : "<redacted:known-hosts-path>",
            pinnedFingerprintConfigured: profile.pinnedHostFingerprint !== undefined,
        },
        cwdPolicy: {
            defaultCwd: profile.defaultCwd,
            allowedRoots: [...profile.remoteAllowedCwd],
            deniedRoots: [...(profile.remoteDeniedCwd ?? [])],
        },
        allowTmux: profile.allowTmux ?? false,
        connectTimeoutMs: profile.connectTimeoutMs,
        keepaliveIntervalMs: profile.keepaliveIntervalMs,
        envConfigured: profile.env !== undefined,
        envKeyCount: Object.keys(profile.env ?? {}).length,
    };
}
function redactAuth(profile) {
    if (profile.auth.type === "agent") {
        return { type: "agent", socketConfigured: profile.auth.socket !== undefined };
    }
    return {
        type: "key-file",
        keyFileConfigured: profile.auth.path.trim().length > 0,
        keyFilePath: "<redacted:key-file-path>",
        passphraseEnvConfigured: profile.auth.passphraseEnv !== undefined,
    };
}
function createSshToolError(code, message, hint) {
    return new TerminalUseError({ code: code, message, retryable: false, hint });
}
