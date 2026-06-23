import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { TerminalUseConfig } from "../config.js"
import type { TmuxCore, TmuxCommandResult } from "../providers/tmux-core.js"
import type { ProviderName, TerminalProvider } from "../providers/provider.js"
import type { SessionManager } from "../session-manager.js"
import type { AuditLogger } from "../audit-log.js"
import { auditAllow, auditDeny, auditError } from "../audit-log.js"
import { isCommandSafeArgv } from "../terminal/command-safety.js"
import { TmuxCommandParseError, ProviderCapabilityUnsupportedError, ProviderNotAvailableError } from "../terminal/errors.js"
import type { TmuxCommandAst } from "../terminal/tmux-command-parser.js"
import { parseTmuxCommand } from "../terminal/tmux-command-parser.js"
import { authorizeAndCompile, type AuthorizationContext } from "../terminal/tmux-command-switch.js"
import { formatTmuxTargetFromAst } from "../terminal/tmux-core-utils.js"
import { errorToToolResult, okToolResult, type ToolErrorResult, type ToolSuccessResult } from "./tool-helpers.js"

type TmuxCommandToolInput = {
  sessionId: string
  command: string
  target?: string
  dryRun?: boolean
}

type TmuxCommandToolOutput = TmuxCommandResult & {
  dryRun: boolean
  target?: string
}

type TmuxCoreAccessor = {
  readonly core?: TmuxCore
  getCore?: () => TmuxCore
}

type TmuxCommandToolResult = ToolSuccessResult<TmuxCommandToolOutput> | ToolErrorResult

const TMUX_COMMAND_ALLOWED_KINDS = new Set([
  "list", "attach", "new", "kill", "rename", "select",
  "resize", "copy-mode", "copy-scroll", "send-keys", "paste", "show-info",
])

export function registerTmuxCommandTool(
  server: McpServer,
  sm: SessionManager,
  config: TerminalUseConfig,
  auditLogger: AuditLogger,
): void {
  server.registerTool(
    "terminal.tmux_command",
    {
      description: "执行受控的 tmux 管理命令。后端解析、鉴权、编译后通过 tmux -C control channel 执行。支持：list tree/sessions/windows/panes、attach session/window/pane、new session/window/split-pane、kill session/window/pane、rename session/window/pane、select window/pane、resize pane、copy-mode/scroll-copy、show-info。",
      inputSchema: {
        sessionId: z.string().describe("terminal-use-mcp 会话 ID"),
        command: z.string().min(1).describe("tmux 管理命令字符串，如 'list tree'、'attach pane %3'、'kill pane %3'、'new window editor'、'split pane %3 horizontal'"),
        target: z.string().optional().describe("可选 target，如 '%3'、'@2'、'session-name'"),
        dryRun: z.boolean().optional().describe("仅解析和鉴权，不执行"),
      },
    },
    async (input): Promise<TmuxCommandToolResult> => {
      const sessionId = input.sessionId
      try {
        const output = await executeTmuxCommand(sm, config, input)
        const auditInput = {
          tmuxCommandKind: output.parsedKind,
          tmuxCommandDryRun: output.dryRun,
          tmuxCommandTarget: output.tmuxCommandTarget,
          tmuxCommandDestructive: output.tmuxCommandDestructive,
          compiledCommand: output.compiledCommand,
        }
        if (output.decision === "deny") {
          auditLogger.log(auditDeny("terminal.tmux_command", output.errorMessage ?? "authorization denied", { sessionId, input: auditInput }))
        } else {
          auditLogger.log(auditAllow("terminal.tmux_command", { sessionId, input: auditInput }))
        }
        return okToolResult(formatSummary(output), output)
      } catch (err) {
        auditLogger.log(auditError("terminal.tmux_command", err instanceof Error ? err.message : String(err), { sessionId }))
        return errorToToolResult(err)
      }
    },
  )
}

async function executeTmuxCommand(
  sm: SessionManager,
  config: TerminalUseConfig,
  input: TmuxCommandToolInput,
): Promise<TmuxCommandToolOutput> {
  const session = sm.getSession(input.sessionId)
  assertTmuxManagedProvider(session.providerName)

  const provider = getSessionProvider(sm, session.providerName)
  const core = getTmuxCore(provider)
  const command = formatCommand(input.command, input.target)

  return session.queue.enqueue(async () => {
    const result = input.dryRun === true
      ? dryRunTmuxCommand(core, command, session.providerSessionId, config)
      : await core.tmuxCommand(command, session.providerSessionId, config)

    sm.touchSession(session.sessionId)

    return {
      ...result,
      dryRun: input.dryRun === true,
      target: input.target,
    }
  })
}

function getSessionProvider(sm: SessionManager, providerName: ProviderName): TerminalProvider {
  const provider = sm.getProviders().get(providerName)
  if (provider === undefined) {
    throw new ProviderNotAvailableError(providerName, "Provider for this session is not registered")
  }
  return provider
}

function assertTmuxManagedProvider(providerName: ProviderName): void {
  if (providerName !== "tmux" && providerName !== "ssh-tmux") {
    throw new ProviderCapabilityUnsupportedError(providerName, "tmux_command")
  }
}

function getTmuxCore(provider: TerminalProvider): TmuxCore {
  const accessor = provider as unknown as TmuxCoreAccessor
  if (typeof accessor.getCore === "function") return accessor.getCore()
  if (accessor.core !== undefined) return accessor.core
  throw new ProviderCapabilityUnsupportedError(provider.name, "tmux_command")
}

function formatCommand(command: string, target: string | undefined): string {
  const trimmedCommand = command.trim()
  const trimmedTarget = target?.trim()
  if (trimmedTarget === undefined || trimmedTarget.length === 0 || trimmedCommand.includes(trimmedTarget)) {
    return trimmedCommand
  }
  return `${trimmedCommand} ${trimmedTarget}`
}

function dryRunTmuxCommand(
  core: TmuxCore,
  command: string,
  providerSessionId: string,
  config: TerminalUseConfig,
): TmuxCommandResult {
  const session = core.getSession(providerSessionId)
  const parseResult = parseTmuxCommand(command)
  if (!parseResult.ok) {
    throw new TmuxCommandParseError(parseResult.error, {
      sessionId: providerSessionId,
      details: { input: command, hint: parseResult.hint },
    })
  }

  const authContext: AuthorizationContext = {
    isDestructiveAllowed: false,
    currentSession: session.tmuxId,
    knownSessions: new Set(core.listSessions().map((s) => s.tmuxId)),
    commandSafety: (checkedCommand: string, args: string[]): boolean => {
      const result = isCommandSafeArgv(checkedCommand, args, config.allowedCommands, config.deniedCommands, config.riskyCommandMode)
      return result.ok
    },
    allowedCommandKinds: TMUX_COMMAND_ALLOWED_KINDS,
  }

  const authResult = authorizeAndCompile(parseResult.ast, authContext)
  const astTarget = formatTmuxTargetFromAst(parseResult.ast) ?? undefined

  if (!authResult.allowed) {
    return {
      ok: false,
      command,
      parsedKind: parseResult.ast.kind,
      decision: "deny",
      errorMessage: authResult.reason,
      needsTreeRefresh: false,
      needsReattach: false,
      tmuxCommandTarget: astTarget,
    }
  }

  const compiledCmd = authResult.compiled.args.join(" ")
  return {
    ok: true,
    command,
    parsedKind: parseResult.ast.kind,
    decision: "allow",
    needsTreeRefresh: authResult.compiled.needsTreeRefresh,
    needsReattach: authResult.compiled.needsReattach,
    tmuxCommandTarget: astTarget,
    tmuxCommandDestructive: authResult.compiled.destructive,
    compiledCommand: compiledCmd.length > 200 ? `${compiledCmd.slice(0, 197)}...` : compiledCmd,
  }
}

function formatSummary(output: TmuxCommandToolOutput): string {
  const mode = output.dryRun ? "dry-run" : "executed"
  const kind = output.parsedKind ?? "unknown"
  if (output.ok) return `tmux command ${mode}: ${kind}`
  return `tmux command ${mode} failed: ${output.errorMessage ?? "unknown error"}`
}
