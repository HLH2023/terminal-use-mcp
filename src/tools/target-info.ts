/**
 * terminal.target_info — 查询单个 SSH target 的脱敏详情。
 *
 * 该工具用于让 agent 判断 profile 形态与安全边界，不提供任何凭据材料：
 * key-file 只返回“已配置/未配置”，passphraseEnv 只返回是否配置，env 只返回数量。
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { Logger } from "../logger.js"
import { TerminalUseError, type TerminalUseErrorCode } from "../terminal/errors.js"
import { getSshProfile } from "../targets/ssh-profile-loader.js"
import type { SshHostProfile } from "../targets/target-types.js"
import { errorToToolResult, textContent } from "./tool-helpers.js"

type RedactedAuthInfo =
  | {
      type: "agent"
      socketConfigured: boolean
    }
  | {
      type: "key-file"
      keyFileConfigured: boolean
      keyFilePath: "<redacted:key-file-path>"
      passphraseEnvConfigured: boolean
    }

type TargetInfoOutput = {
  ok: true
  target: {
    kind: "ssh"
    profile: string
    host: string
    port: number
    username: string
    auth: RedactedAuthInfo
    knownHostPolicy: "strict"
    hostKey: {
      knownHostsConfigured: boolean
      knownHostsPath?: "<redacted:known-hosts-path>"
      pinnedFingerprintConfigured: boolean
    }
    cwdPolicy: {
      defaultCwd?: string
      allowedRoots: string[]
      deniedRoots: string[]
    }
    allowTmux: boolean
    connectTimeoutMs?: number
    keepaliveIntervalMs?: number
    envConfigured: boolean
    envKeyCount: number
  }
}

type V2ToolErrorCode = "SSH_PROFILE_NOT_FOUND"

export function registerTargetInfoTool(
  server: McpServer,
  hostsConfig: ReadonlyMap<string, SshHostProfile>,
  logger: Logger,
): void {
  server.registerTool(
    "terminal.target_info",
    {
      description: "Get redacted SSH target details",
      inputSchema: {
        profile: z.string().describe("SSH profile 名称"),
      },
    },
    async (input) => {
      try {
        const profile = getRequiredProfile(hostsConfig, input.profile)
        const output: TargetInfoOutput = { ok: true, target: redactProfile(profile) }
        logger.debug("terminal.target_info completed", { profile: input.profile })
        return {
          content: [textContent(`SSH target ${input.profile} info (redacted)`)],
          structuredContent: output,
        }
      } catch (err) {
        return errorToToolResult(err)
      }
    },
  )
}

function getRequiredProfile(hostsConfig: ReadonlyMap<string, SshHostProfile>, profileName: string): SshHostProfile {
  const profile = getSshProfile(hostsConfig, profileName)
  if (profile === undefined) {
    throw createV2ToolError(
      "SSH_PROFILE_NOT_FOUND",
      `SSH profile not found: ${profileName}`,
      `Configure profile ${profileName} in hosts.json before using terminal.target_info`,
    )
  }
  return profile
}

function redactProfile(profile: SshHostProfile): TargetInfoOutput["target"] {
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
  }
}

function redactAuth(profile: SshHostProfile): RedactedAuthInfo {
  if (profile.auth.type === "agent") {
    return { type: "agent", socketConfigured: profile.auth.socket !== undefined }
  }

  return {
    type: "key-file",
    keyFileConfigured: profile.auth.path.trim().length > 0,
    keyFilePath: "<redacted:key-file-path>",
    passphraseEnvConfigured: profile.auth.passphraseEnv !== undefined,
  }
}

function createV2ToolError(code: V2ToolErrorCode, message: string, hint: string): TerminalUseError {
  return new TerminalUseError({ code: code as TerminalUseErrorCode, message, retryable: false, hint })
}
