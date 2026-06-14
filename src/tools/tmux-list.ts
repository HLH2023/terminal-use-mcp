import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { Logger } from "../logger.js"
import type { SessionManager } from "../session-manager.js"
import type { SshHostProfile, TerminalTarget } from "../targets/target-types.js"
import {
  errorToToolResult,
  ProviderExecutor,
  textContent,
  type TmuxSessionInfo,
} from "./tool-helpers.js"

const sshAuthSchema = z.union([
  z.object({ type: z.literal("agent"), socket: z.string().optional() }),
  z.object({ type: z.literal("key-file"), path: z.string(), passphraseEnv: z.string().optional() }),
])

const terminalTargetSchema = z.union([
  z.object({ kind: z.literal("local") }),
  z.object({
    kind: z.literal("ssh"),
    profile: z.string().optional(),
    host: z.string().optional(),
    port: z.number().optional(),
    username: z.string().optional(),
    auth: sshAuthSchema.optional(),
    knownHostPolicy: z.literal("strict").optional(),
  }),
])

type TmuxListOutput = {
  ok: true
  sessions: TmuxSessionInfo[]
}

type TmuxToolRuntime = ProviderExecutor | SessionManager

export function registerTmuxListTool(
  server: McpServer,
  runtime: TmuxToolRuntime,
  logger: Logger,
  hostsConfig?: ReadonlyMap<string, SshHostProfile>,
): void {
  const executor = toProviderExecutor(runtime, hostsConfig)
  server.registerTool(
    "terminal.tmux_list",
    {
      description: "List all tmux sessions on local or configured SSH target",
      inputSchema: {
        target: terminalTargetSchema.optional().describe("SSH target. Omit to list local tmux sessions"),
        profile: z.string().optional().describe("SSH profile name shorthand for target"),
      },
    },
    async (input) => {
      try {
        const sessions = await executor.executeTmuxList({
          target: input.target as TerminalTarget | undefined,
          profile: input.profile,
        })
        const output: TmuxListOutput = { ok: true, sessions }
        logger.debug("terminal.tmux_list completed", {
          count: sessions.length,
          target: formatInputTarget(input.profile, input.target as TerminalTarget | undefined),
        })
        return {
          content: [textContent(`Found ${sessions.length} tmux session(s) on ${formatInputTarget(input.profile, input.target as TerminalTarget | undefined)}`)],
          structuredContent: output,
        }
      } catch (err) {
        return errorToToolResult(err)
      }
    },
  )
}

function toProviderExecutor(
  runtime: TmuxToolRuntime,
  hostsConfig: ReadonlyMap<string, SshHostProfile> | undefined,
): ProviderExecutor {
  if (runtime instanceof ProviderExecutor) return runtime
  return new ProviderExecutor(runtime, runtime.getProviders(), hostsConfig)
}

function formatInputTarget(profile: string | undefined, target: TerminalTarget | undefined): string {
  if (profile !== undefined) return `ssh:${profile}`
  if (target?.kind === "ssh") return `ssh:${target.profile ?? target.username ?? target.host ?? "inline"}`
  return "local"
}
