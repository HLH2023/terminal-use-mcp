import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { Logger } from "../logger.js"
import type { SessionManager } from "../session-manager.js"
import type { SshHostProfile, TerminalTarget } from "../targets/target-types.js"
import {
  errorToToolResult,
  ProviderExecutor,
  textContent,
  type TmuxKillExecutionResult,
  type TmuxKillPreviewResult,
  type TmuxToolTargetSummary,
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

type TmuxKillOutput = TmuxKillExecutionResult & {
  ok: true
}

type TmuxKillPreviewOutput = TmuxKillPreviewResult & {
  ok: true
  requiresConfirm: true
}

type TmuxToolRuntime = ProviderExecutor | SessionManager

export function registerTmuxKillTool(
  server: McpServer,
  runtime: TmuxToolRuntime,
  logger: Logger,
  hostsConfig?: ReadonlyMap<string, SshHostProfile>,
): void {
  const executor = toProviderExecutor(runtime, hostsConfig)
  server.registerTool(
    "terminal.tmux_kill",
    {
      description: "Kill any tmux session by tmux session name. Requires two calls: first without confirm to preview, then with confirm=true to execute.",
      inputSchema: {
        name: z.string().min(1).describe("tmux session name, not MCP sessionId"),
        confirm: z.boolean().optional().describe("Set to true to confirm the kill. First call without confirm returns a preview; second call with confirm=true executes the kill."),
        target: terminalTargetSchema.optional().describe("SSH target. Omit to kill a local tmux session"),
        profile: z.string().optional().describe("SSH profile name shorthand for target"),
      },
    },
    async (input) => {
      try {
        if (input.confirm !== true) {
          return await handlePreview(executor, input, logger)
        }
        return await handleConfirmedKill(executor, input, logger)
      } catch (err) {
        return errorToToolResult(err)
      }
    },
  )
}

async function handlePreview(
  executor: ProviderExecutor,
  input: { name: string; target?: TerminalTarget; profile?: string },
  logger: Logger,
) {
  const preview = await executor.executeTmuxKillPreview(input.name, {
    target: input.target as TerminalTarget | undefined,
    profile: input.profile,
  })

  if (!preview.exists) {
    return {
      content: [textContent(`tmux session "${preview.name}" not found on ${formatTargetSummary(preview.target)}. No action taken.`)],
      structuredContent: { ok: true, ...preview, requiresConfirm: true } satisfies TmuxKillPreviewOutput,
    }
  }

  const details = formatPreviewDetails(preview)
  logger.info("terminal.tmux_kill preview", {
    name: preview.name,
    target: formatTargetSummary(preview.target),
    exists: preview.exists,
    isManaged: preview.isManaged,
  })

  return {
    content: [textContent(details)],
    structuredContent: { ok: true, ...preview, requiresConfirm: true } satisfies TmuxKillPreviewOutput,
  }
}

async function handleConfirmedKill(
  executor: ProviderExecutor,
  input: { name: string; target?: TerminalTarget; profile?: string },
  logger: Logger,
) {
  const result = await executor.executeTmuxKill(input.name, {
    target: input.target as TerminalTarget | undefined,
    profile: input.profile,
  })
  const output: TmuxKillOutput = { ok: true, ...result }

  logger.warn("terminal.tmux_kill completed", {
    name: result.name,
    target: formatTargetSummary(result.target),
    isManaged: result.isManaged,
    cleanedSessionIds: result.cleanedSessionIds,
  })
  return {
    content: [textContent(`Killed tmux session "${result.name}" on ${formatTargetSummary(result.target)}. ${formatManagedCleanup(result.cleanedSessionIds)}`)],
    structuredContent: output,
  }
}

function toProviderExecutor(
  runtime: TmuxToolRuntime,
  hostsConfig: ReadonlyMap<string, SshHostProfile> | undefined,
): ProviderExecutor {
  if (runtime instanceof ProviderExecutor) return runtime
  return new ProviderExecutor(runtime, runtime.getProviders(), hostsConfig)
}

function formatTargetSummary(target: TmuxToolTargetSummary): string {
  return target.kind === "local" ? "local" : `ssh:${target.profile}`
}

function formatPreviewDetails(preview: TmuxKillPreviewResult): string {
  const lines: string[] = [
    `⚠️  即将 kill tmux session "${preview.name}"`,
  ]
  lines.push(`- 目标: ${formatTargetSummary(preview.target)}`)
  if (preview.created) lines.push(`- 创建时间: ${preview.created}`)
  if (preview.windows !== null) lines.push(`- 窗口数: ${preview.windows}`)
  lines.push(`- MCP 管理: ${preview.isManaged ? "是" : "否"}`)
  if (preview.isManaged) {
    lines.push(`- 关联 MCP session: ${preview.managedSessionIds.join(", ")}`)
  }
  lines.push("")
  lines.push("此操作不可逆，session 中运行的进程将被终止。")
  lines.push("如确认，请再次调用并设置 confirm=true。")
  return lines.join("\n")
}

function formatManagedCleanup(cleanedSessionIds: string[]): string {
  if (cleanedSessionIds.length === 0) return "No MCP-managed session record was associated."
  return `Cleaned MCP-managed session record(s): ${cleanedSessionIds.join(", ")}.`
}
