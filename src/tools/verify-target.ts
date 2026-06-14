/**
 * terminal.verify_target — V2-2 SSH target 就绪度校验。
 *
 * V2-2 明确不建立 SSH 连接，也不执行远端探测命令；本工具只校验本地可证明的
 * 前置条件：profile 存在、host key 信任来源可用、认证材料可访问。真实连接、
 * 远端 shell/tmux/defaultCwd 探测由 V2-3/V2-4 provider 补齐。
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { Logger } from "../logger.js"
import type { SessionManager } from "../session-manager.js"
import { TerminalUseError, type TerminalUseErrorCode } from "../terminal/errors.js"
import { verifyPinnedFingerprint } from "../targets/host-fingerprint.js"
import { verifyHostKey, type KnownHostVerifyResult } from "../targets/known-hosts.js"
import { resolveSshAuth, type ResolvedSshAuth } from "../targets/ssh-auth.js"
import { getSshProfile } from "../targets/ssh-profile-loader.js"
import type { SshHostProfile } from "../targets/target-types.js"
import { errorToToolResult, textContent } from "./tool-helpers.js"

type VerifyTargetOutput = {
  ok: true
  profile: string
  hostFingerprint: string
  authType: "agent" | "key-file"
  remote: {
    shell: string
    tmuxAvailable: boolean
    defaultCwdExists: boolean
  }
}

type V2ToolErrorCode = "SSH_PROFILE_NOT_FOUND" | "SSH_HOST_KEY_MISMATCH" | "SSH_HOST_KEY_UNKNOWN" | "SSH_AUTH_FAILED"

const DEFAULT_KNOWN_HOSTS_PATH = "~/.ssh/known_hosts"

export function registerVerifyTargetTool(
  server: McpServer,
  sm: SessionManager,
  hostsConfig: Map<string, SshHostProfile>,
  logger: Logger,
): void {
  server.registerTool(
    "terminal.verify_target",
    {
      description: "Verify SSH target profile readiness without opening an SSH connection",
      inputSchema: {
        profile: z.string().describe("SSH profile 名称"),
      },
    },
    async (input) => {
      void sm
      try {
        const profile = getRequiredProfile(hostsConfig, input.profile)
        const hostFingerprint = await verifyConfiguredHostKey(profile)
        const auth = await resolveConfiguredAuth(profile)
        const output: VerifyTargetOutput = {
          ok: true,
          profile: profile.name,
          hostFingerprint,
          authType: auth.type,
          remote: buildBestEffortRemoteReadiness(profile),
        }
        logger.info("terminal.verify_target completed", { profile: profile.name, authType: auth.type })
        return {
          content: [textContent(`SSH target ${profile.name} readiness verified (local preflight only)`)],
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
      `Configure profile ${profileName} in hosts.json before using terminal.verify_target`,
    )
  }
  return profile
}

async function verifyConfiguredHostKey(profile: SshHostProfile): Promise<string> {
  if (profile.pinnedHostFingerprint !== undefined) {
    const pinnedResult = verifyPinnedFingerprint(profile.pinnedHostFingerprint, profile.pinnedHostFingerprint)
    if (!pinnedResult.ok) {
      throw createV2ToolError(
        "SSH_HOST_KEY_UNKNOWN",
        `Pinned host fingerprint for profile ${profile.name} is invalid: ${pinnedResult.detail}`,
        "Use SHA256:<base64> or MD5:<hex-pairs> fingerprint format",
      )
    }
    return pinnedResult.matches ? pinnedResult.fingerprint : profile.pinnedHostFingerprint
  }

  const knownHostsPath = profile.knownHosts ?? DEFAULT_KNOWN_HOSTS_PATH
  const knownHostResult = await verifyHostKey(profile.host, profile.port, knownHostsPath)
  if (knownHostResult.ok) {
    return knownHostResult.fingerprint
  }

  throw knownHostResultToError(profile, knownHostResult)
}

async function resolveConfiguredAuth(profile: SshHostProfile): Promise<ResolvedSshAuth> {
  try {
    return await resolveSshAuth(profile.auth)
  } catch (err) {
    throw createV2ToolError(
      "SSH_AUTH_FAILED",
      `SSH auth preflight failed for profile ${profile.name}: ${formatUnknownError(err)}`,
      "Use ssh-agent with SSH_AUTH_SOCK or configure a readable key-file path",
      formatUnknownError(err),
    )
  }
}

function knownHostResultToError(profile: SshHostProfile, result: Extract<KnownHostVerifyResult, { ok: false }>): TerminalUseError {
  if (result.reason === "key_mismatch") {
    return createV2ToolError(
      "SSH_HOST_KEY_MISMATCH",
      `Known host key mismatch for ${profile.name}: ${result.detail}`,
      "Inspect known_hosts and verify the host key out-of-band before connecting",
      result,
    )
  }

  return createV2ToolError(
    "SSH_HOST_KEY_UNKNOWN",
    `Host key cannot be verified for ${profile.name}: ${result.detail}`,
    "Add the host to known_hosts or configure pinnedHostFingerprint; never disable host key checking",
    result,
  )
}

function buildBestEffortRemoteReadiness(profile: SshHostProfile): VerifyTargetOutput["remote"] {
  return {
    shell: "unknown",
    tmuxAvailable: profile.allowTmux ?? false,
    defaultCwdExists: profile.defaultCwd !== undefined,
  }
}

function createV2ToolError(code: V2ToolErrorCode, message: string, hint: string, details?: unknown): TerminalUseError {
  return new TerminalUseError({ code: code as TerminalUseErrorCode, message, retryable: false, hint, details })
}

function formatUnknownError(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`
  }
  return String(err)
}
