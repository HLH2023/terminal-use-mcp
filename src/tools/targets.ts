/**
 * terminal.targets — 列出本地与 SSH profile target。
 *
 * 输出只包含连接所需的非敏感摘要；不会暴露 key-file 路径、passphrase、
 * token、password 或任何 env 值。
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import type { Logger } from "../logger.js"
import type { SshHostProfile } from "../targets/target-types.js"
import { errorToToolResult, textContent } from "./tool-helpers.js"

type LocalTargetSummary = {
  kind: "local"
  name: "local"
}

type SshTargetSummary = {
  kind: "ssh"
  profile: string
  host: string
  port: number
  username: string
  authType: "agent" | "key-file"
  knownHostPolicy: "strict"
  defaultCwd?: string
  allowTmux: boolean
}

type TargetsOutput = {
  ok: true
  targets: Array<LocalTargetSummary | SshTargetSummary>
}

export function registerTargetsTool(
  server: McpServer,
  hostsConfig: ReadonlyMap<string, SshHostProfile>,
  logger: Logger,
): void {
  server.registerTool(
    "terminal.targets",
    {
      description: "List available terminal targets (local + configured SSH profiles)",
      inputSchema: {},
    },
    async () => {
      try {
        const output: TargetsOutput = {
          ok: true,
          targets: buildTargetSummaries(hostsConfig),
        }
        logger.debug("terminal.targets completed", { sshProfiles: hostsConfig.size })
        return {
          content: [textContent(`Available targets: ${output.targets.length}`)],
          structuredContent: output,
        }
      } catch (err) {
        return errorToToolResult(err)
      }
    },
  )
}

function buildTargetSummaries(hostsConfig: ReadonlyMap<string, SshHostProfile>): Array<LocalTargetSummary | SshTargetSummary> {
  const local: LocalTargetSummary = { kind: "local", name: "local" }
  const sshTargets = [...hostsConfig.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([profileName, profile]): SshTargetSummary => ({
      kind: "ssh",
      profile: profile.name || profileName,
      host: profile.host,
      port: profile.port,
      username: profile.username,
      authType: profile.auth.type,
      knownHostPolicy: "strict",
      defaultCwd: profile.defaultCwd,
      allowTmux: profile.allowTmux ?? false,
    }))

  return [local, ...sshTargets]
}
