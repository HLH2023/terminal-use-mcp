/**
 * MCP tool 层通用辅助。
 *
 * 约束说明：SessionManager 当前只暴露 session 生命周期 API，provider map 是私有字段。
 * 为了不修改既有 SessionManager，本文件提供 ProviderExecutor：由后续 mcp-server.ts
 * 显式传入同一批 provider 实例，tool 层只通过 ManagedSession.queue 串行执行 provider 操作。
 */

import { execFile } from "node:child_process"

import type { SessionManager, ManagedSession } from "../session-manager.js"
import type {
  FindResult,
  MouseClickInput,
  MouseScrollInput,
  ProviderCapabilities,
  ProviderName,
  ScrollDirection,
  TerminalProvider,
  WaitOptions,
  WaitStableOptions,
} from "../providers/provider.js"
import type { SshHostProfile, TerminalTarget } from "../targets/target-types.js"
import type { ResolvedSshTarget } from "../targets/ssh-profile-loader.js"
import { execSshTmux } from "../providers/ssh-tmux-provider.js"
import { loadHostsConfig } from "../targets/ssh-host-config.js"
import { resolveSshTarget } from "../targets/ssh-profile-loader.js"
import type { TerminalSnapshot, TerminalSnapshotMode } from "../terminal/terminal-snapshot.js"
import { parseKeyExpr, type ParsedKeyExpr } from "../terminal/keymap.js"
import type { TranscriptEvent } from "../terminal/transcript.js"
import {
  DependencyMissingError,
  InternalError,
  ProcessExitedError,
  ProviderCapabilityUnsupportedError,
  ProviderNotAvailableError,
  RemoteTmuxNotAvailableError,
  SessionNotFoundError,
  TerminalUseError,
  type ErrorEnvelope,
} from "../terminal/errors.js"

const TMUX_TOOL_EXEC_TIMEOUT_MS = 10_000
const TMUX_TOOL_MAX_BUFFER_BYTES = 8 * 1024 * 1024
const TMUX_LIST_SEPARATOR = "\t"
const TMUX_LIST_FORMAT = [
  "#{session_name}",
  "#{session_created}",
  "#{window_width}",
  "#{window_height}",
  "#{session_windows}",
].join(TMUX_LIST_SEPARATOR)

export type TextToolContent = { type: "text"; text: string }

export type ToolSuccessResult<T extends object> = {
  content: TextToolContent[]
  structuredContent: T
}

export type ToolErrorResult = {
  content: TextToolContent[]
  structuredContent: ErrorEnvelope
  isError: true
}

/**
 * LLM 可能从 provider 名称推导前缀并拼接到 sessionId 前，
 * 因此不对外暴露 providerSessionId，防止 LLM 学习到前缀映射模式。
 * 只保留 sessionId（MCP 层面唯一标识）和 provider（纯信息字段）。
 */
export type PublicSessionInfo = {
  sessionId: string
  provider: string
  command: string
  args: string[]
  cwd: string
  label?: string
  status: ManagedSession["status"]
  exitCode?: number | null
  title?: string
  cols?: number
  rows?: number
  capabilities: ManagedSession["capabilities"]
  createdAt: string
  lastActivityAt: string
  ttlMs: number
  metadata?: ManagedSession["metadata"]
}

/** 统一构造 MCP text content，供所有 tool 注册文件复用。 */
export function textContent(text: string): TextToolContent {
  return { type: "text", text }
}

/** 将内部 ManagedSession 转成可 JSON 序列化的公开 session 信息。 */
export function sessionToPublicInfo(session: ManagedSession): PublicSessionInfo {
  return {
    sessionId: session.sessionId,
    provider: session.providerName,
    command: session.command,
    args: session.args,
    cwd: session.cwd,
    label: session.label,
    status: session.status,
    exitCode: session.exitCode,
    title: session.lastSnapshot?.title,
    cols: session.lastSnapshot?.cols,
    rows: session.lastSnapshot?.rows,
    capabilities: session.capabilities,
    createdAt: session.createdAt.toISOString(),
    lastActivityAt: session.lastActivityAt.toISOString(),
    ttlMs: session.ttlMs,
    metadata: session.metadata,
  }
}

/** 将成功结构化数据同时写入 structuredContent 和人类可读 content。 */
export function okToolResult<T extends object>(summary: string, structuredContent: T): ToolSuccessResult<T> {
  return {
    content: [textContent(summary)],
    structuredContent,
  }
}

/**
 * 统一错误转换：TerminalUseError 保留稳定 code；未知错误归一为 INTERNAL_ERROR。
 * content 只放摘要，机器可读错误以 structuredContent 为事实源。
 */
export function errorToToolResult(err: unknown): ToolErrorResult {
  const envelope = err instanceof TerminalUseError
    ? err.toEnvelope()
    : new InternalError("Unexpected terminal tool error", formatUnknownError(err)).toEnvelope()

  return {
    content: [textContent(`${envelope.error.code}: ${envelope.error.message}`)],
    structuredContent: envelope,
    isError: true,
  }
}

export type ProviderExecutorProviders = ReadonlyMap<string, TerminalProvider>

export type TmuxToolTargetInput = {
  target?: TerminalTarget
  profile?: string
}

export type TmuxToolTargetSummary =
  | { kind: "local" }
  | { kind: "ssh"; profile: string }

export type TmuxSessionInfo = {
  name: string
  created: string
  cols: number
  rows: number
  isManaged: boolean
  windows: number
}

export type TmuxKillPreviewResult = {
  name: string
  target: TmuxToolTargetSummary
  exists: boolean
  available: boolean
  reason: string | null
  isManaged: boolean
  managedSessionIds: string[]
  windows: number | null
  created: string | null
}

export type TmuxKillExecutionResult = {
  name: string
  target: TmuxToolTargetSummary
  isManaged: boolean
  cleanedSessionIds: string[]
  warning: string
}

type ResolvedTmuxToolTarget =
  | { kind: "local" }
  | { kind: "ssh"; target: ResolvedSshTarget }

type TmuxListEntry = {
  name: string
  created: string
  cols: number
  rows: number
  windows: number
}

type TmuxCommandResult = {
  stdout: string
  stderr: string
  exitCode: number | null
}

/**
 * ProviderExecutor 是 MCP tools 与 provider 的窄接口。
 *
 * - 不读取 SessionManager 私有字段。
 * - 所有实际 provider IO 都进入 session.queue。
 * - 使用 providerSessionId 调用 provider，避免 MCP sessionId 与 provider 内部 id 混淆。
 */
export class ProviderExecutor {
  constructor(
    private readonly sm: SessionManager,
    private readonly providers: ProviderExecutorProviders,
    private readonly hostsConfig?: ReadonlyMap<string, SshHostProfile>,
  ) {}

  async executeTmuxList(input: TmuxToolTargetInput = {}): Promise<TmuxSessionInfo[]> {
    const target = await this.resolveTmuxToolTarget(input)
    const providerName: ProviderName = target.kind === "local" ? "tmux" : "ssh-tmux"
    const entries = target.kind === "local"
      ? await this.listLocalTmuxSessions()
      : await this.listRemoteTmuxSessions(target.target)
    const managedNames = new Set(
      this.sm.listSessions()
        .filter((session) => session.providerName === providerName)
        .map((session) => session.providerSessionId),
    )

    return entries.map((entry) => ({
      name: entry.name,
      created: entry.created,
      cols: entry.cols,
      rows: entry.rows,
      isManaged: managedNames.has(entry.name),
      windows: entry.windows,
    }))
  }

  /** 预览 tmux_kill 目标 session 信息，不执行 kill。用于二次确认流程。 */
  async executeTmuxKillPreview(name: string, input: TmuxToolTargetInput = {}): Promise<TmuxKillPreviewResult> {
    const tmuxName = name.trim()
    if (tmuxName.length === 0) {
      throw new TerminalUseError({
        code: "INTERNAL_ERROR",
        message: "terminal.tmux_kill requires a non-empty tmux session name",
        retryable: false,
      })
    }

    const target = await this.resolveTmuxToolTarget(input)
    const providerName: ProviderName = target.kind === "local" ? "tmux" : "ssh-tmux"

    let exists = false
    let available = true
    let reason: string | null = null
    let windows: number | null = null
    let created: string | null = null
    try {
      const sessions = await this.executeTmuxList(input)
      const found = sessions.find((s) => s.name === tmuxName)
      if (found) {
        exists = true
        windows = found.windows
        created = found.created
      }
    } catch (error) {
      available = false
      reason = formatUnknownError(error)
    }

    const managedSessions = this.sm.listSessions().filter((session) => {
      return session.providerName === providerName && session.providerSessionId === tmuxName
    })

    return {
      name: tmuxName,
      target: this.summarizeTmuxTarget(target),
      exists,
      available,
      reason,
      isManaged: managedSessions.length > 0,
      managedSessionIds: managedSessions.map((s) => s.sessionId),
      windows,
      created,
    }
  }

  async executeTmuxKill(name: string, input: TmuxToolTargetInput = {}): Promise<TmuxKillExecutionResult> {
    const tmuxName = name.trim()
    if (tmuxName.length === 0) {
      throw new TerminalUseError({
        code: "INTERNAL_ERROR",
        message: "terminal.tmux_kill requires a non-empty tmux session name",
        retryable: false,
      })
    }

    const target = await this.resolveTmuxToolTarget(input)
    const providerName: ProviderName = target.kind === "local" ? "tmux" : "ssh-tmux"

    if (target.kind === "local") {
      await this.killLocalTmuxSession(tmuxName)
    } else {
      await this.killRemoteTmuxSession(target.target, tmuxName)
    }

    const managedSessions = this.sm.listSessions().filter((session) => {
      return session.providerName === providerName && session.providerSessionId === tmuxName
    })
    const cleanedSessionIds: string[] = []

    for (const session of managedSessions) {
      try {
        await this.sm.kill(session.sessionId)
        cleanedSessionIds.push(session.sessionId)
      } catch (err) {
        if (!(err instanceof SessionNotFoundError)) {
          throw err
        }
      }
    }

    return {
      name: tmuxName,
      target: this.summarizeTmuxTarget(target),
      isManaged: cleanedSessionIds.length > 0,
      cleanedSessionIds,
      warning: "DANGEROUS_OPERATION_COMPLETED: tmux session was killed by name; running processes inside it were terminated.",
    }
  }

  async executeSnapshot(sessionId: string, mode: TerminalSnapshotMode = "viewport"): Promise<TerminalSnapshot> {
    const session = this.sm.getSession(sessionId)
    const provider = this.getProvider(session.providerName)
    return session.queue.enqueue(async () => {
      const snapshot = await provider.snapshot(session.providerSessionId, mode)
      this.recordSnapshot(session, snapshot)
      return snapshot
    })
  }

  async executeWaitForText(sessionId: string, text: string, options: WaitOptions): Promise<TerminalSnapshot> {
    const session = this.sm.getSession(sessionId)
    const provider = this.getProvider(session.providerName)
    this.assertCapability(provider, "supportsTextWait", "wait_for_text")
    return session.queue.enqueue(async () => {
      const snapshot = await provider.waitForText(session.providerSessionId, text, options)
      this.recordSnapshot(session, snapshot)
      return snapshot
    })
  }

  async executeWaitStable(sessionId: string, options: WaitStableOptions): Promise<TerminalSnapshot> {
    const session = this.sm.getSession(sessionId)
    const provider = this.getProvider(session.providerName)
    this.assertCapability(provider, "supportsStableWait", "wait_stable")
    return session.queue.enqueue(async () => {
      const snapshot = await provider.waitStable(session.providerSessionId, options)
      this.recordSnapshot(session, snapshot)
      return snapshot
    })
  }

  async executeFind(
    sessionId: string,
    pattern: string,
    regex: boolean | undefined,
    includeScrollback: boolean | undefined,
  ): Promise<FindResult[]> {
    const session = this.sm.getSession(sessionId)
    const provider = this.getProvider(session.providerName)
    this.assertCapability(provider, "supportsFind", "find")
    if (provider.find === undefined) {
      throw new ProviderCapabilityUnsupportedError(provider.name, "find")
    }
    return session.queue.enqueue(async () => {
      const matches = await provider.find?.(session.providerSessionId, pattern, regex, includeScrollback)
      this.sm.touchSession(session.sessionId)
      return matches ?? []
    })
  }

  async executeScroll(sessionId: string, direction: ScrollDirection, lines: number): Promise<void> {
    const session = this.sm.getSession(sessionId)
    const provider = this.getProvider(session.providerName)
    this.assertCapability(provider, "supportsScroll", "scroll")
    if (provider.scroll === undefined) {
      throw new ProviderCapabilityUnsupportedError(provider.name, "scroll")
    }
    await session.queue.enqueue(async () => {
      await provider.scroll?.(session.providerSessionId, direction, lines)
      this.sm.touchSession(session.sessionId)
    })
  }

  async executeMouseClick(sessionId: string, input: MouseClickInput): Promise<void> {
    const session = this.getLiveInputSession(sessionId)
    const provider = this.getProvider(session.providerName)
    this.assertCapability(provider, "supportsMouseClick", "mouse_click")
    if (provider.mouseClick === undefined) {
      throw new ProviderCapabilityUnsupportedError(provider.name, "mouse_click")
    }
    await session.queue.enqueue(async () => {
      await provider.mouseClick!(session.providerSessionId, input)
      session.transcript.recordInput(`<mouse:click:${input.button}@${input.col},${input.row}>`)
      this.sm.touchSession(session.sessionId)
    })
  }

  async executeMouseScroll(sessionId: string, input: MouseScrollInput, lines: number): Promise<void> {
    const session = this.getLiveInputSession(sessionId)
    const provider = this.getProvider(session.providerName)
    this.assertCapability(provider, "supportsMouseScroll", "mouse_scroll")
    if (provider.mouseScroll === undefined) {
      throw new ProviderCapabilityUnsupportedError(provider.name, "mouse_scroll")
    }
    await session.queue.enqueue(async () => {
      for (let i = 0; i < lines; i++) {
        await provider.mouseScroll!(session.providerSessionId, input)
      }
      session.transcript.recordInput(`<mouse:scroll:${input.direction}x${lines}@${input.col},${input.row}>`)
      this.sm.touchSession(session.sessionId)
    })
  }

  async executeType(sessionId: string, text: string): Promise<void> {
    const session = this.getLiveInputSession(sessionId)
    const provider = this.getProvider(session.providerName)
    await session.queue.enqueue(async () => {
      await provider.type(session.providerSessionId, text)
      session.transcript.recordInput(text)
      this.sm.touchSession(session.sessionId)
    })
  }

  async executePress(sessionId: string, keyExpr: string, parsed: ParsedKeyExpr): Promise<void> {
    const session = this.getLiveInputSession(sessionId)
    const provider = this.getProvider(session.providerName)
    await session.queue.enqueue(async () => {
      await provider.press(session.providerSessionId, keyExpr, parsed)
      session.transcript.recordInput(`<${keyExpr}>`)
      this.sm.touchSession(session.sessionId)
    })
  }

  async executePaste(sessionId: string, text: string, mode: "bracketed" | "line-by-line" | "raw" | undefined): Promise<void> {
    const session = this.getLiveInputSession(sessionId)
    const provider = this.getProvider(session.providerName)
    await session.queue.enqueue(async () => {
      await provider.paste(session.providerSessionId, text, mode)
      session.transcript.recordInput(text)
      this.sm.touchSession(session.sessionId)
    })
  }

  /** 终端尺寸变更：检查 provider 能力后通过 queue 串行执行 resize。 */
  async executeResize(sessionId: string, cols: number, rows: number): Promise<void> {
    const session = this.sm.getSession(sessionId)
    const provider = this.getProvider(session.providerName)
    this.assertCapability(provider, "supportsResize", "resize")
    if (provider.resize === undefined) {
      throw new ProviderCapabilityUnsupportedError(provider.name, "resize")
    }
    await session.queue.enqueue(async () => {
      await provider.resize!(session.providerSessionId, cols, rows)
      session.transcript.recordResize(cols, rows)
      this.sm.touchSession(session.sessionId)
    })
  }

  /** 读取 session transcript 事件（增量拉取，seq 递增）。 */
  getEvents(sessionId: string, limit?: number, sinceSeq?: number): { events: TranscriptEvent[]; totalEvents: number; hasMore: boolean } {
    const session = this.sm.getSession(sessionId)
    return session.transcript.getEvents(limit, sinceSeq)
  }

  /**
   * 信号发送语义：
   * - SIGINT 等效 ctrl-c（通过 provider.press），保留 session
   * - SIGTERM/SIGKILL 调用 provider.kill 释放资源，session 从 map 移除
   */
  async executeSendSignal(sessionId: string, signal: "SIGINT" | "SIGTERM" | "SIGKILL"): Promise<void> {
    const session = this.sm.getSession(sessionId)
    const provider = this.getProvider(session.providerName)

    await session.queue.enqueue(async () => {
      if (signal === "SIGINT") {
        await provider.press(session.providerSessionId, "ctrl+c", parseKeyExpr("ctrl+c"))
        session.transcript.recordInput("<signal:SIGINT>")
        this.sm.touchSession(session.sessionId)
        return
      }
      /* SIGTERM / SIGKILL: 调用 provider.kill 释放资源 */
      await provider.kill(session.providerSessionId)
      session.status = "killed"
      session.exitCode = null
      session.transcript.recordExit(null, signal)
      this.sm.touchSession(session.sessionId)
    })

    /* SIGTERM/SIGKILL 后从 map 移除 session（SIGINT 仅中断不终止） */
    if (signal !== "SIGINT") {
      this.sm.removeSession(sessionId)
    }
  }

  private getProvider(name: string): TerminalProvider {
    const provider = this.providers.get(name)
    if (provider === undefined) {
      throw new ProviderNotAvailableError(name, "Provider for this session is not available in tool executor")
    }
    return provider
  }

  private async resolveTmuxToolTarget(input: TmuxToolTargetInput): Promise<ResolvedTmuxToolTarget> {
    const profile = input.profile?.trim()
    if (profile !== undefined && profile.length === 0) {
      throw new TerminalUseError({
        code: "INTERNAL_ERROR",
        message: "SSH profile shorthand must not be empty",
        retryable: false,
      })
    }
    if (profile !== undefined && input.target !== undefined) {
      throw new TerminalUseError({
        code: "INTERNAL_ERROR",
        message: "Use either profile or target for tmux tools, not both",
        retryable: false,
      })
    }

    const target: TerminalTarget | undefined = profile === undefined ? input.target : { kind: "ssh", profile }
    if (target === undefined || target.kind === "local") {
      return { kind: "local" }
    }

    const resolved = resolveSshTarget(target, await this.loadHostProfiles())
    if (resolved.kind !== "ssh") {
      throw new InternalError("Resolved tmux target is not SSH")
    }
    if (resolved.allowTmux === false) {
      throw new RemoteTmuxNotAvailableError(resolved.profile ?? resolved.name)
    }
    return { kind: "ssh", target: resolved }
  }

  private async loadHostProfiles(): Promise<ReadonlyMap<string, SshHostProfile>> {
    if (this.hostsConfig !== undefined) return this.hostsConfig
    return loadHostsConfig()
  }

  private summarizeTmuxTarget(target: ResolvedTmuxToolTarget): TmuxToolTargetSummary {
    if (target.kind === "local") return { kind: "local" }
    return { kind: "ssh", profile: target.target.profile ?? target.target.name }
  }

  private async assertProviderAvailable(providerName: "tmux" | "ssh-tmux"): Promise<void> {
    const provider = this.getProvider(providerName)
    if (!(await provider.isAvailable())) {
      throw new ProviderNotAvailableError(providerName, `Provider ${providerName} is registered but not currently available`)
    }
  }

  private async listLocalTmuxSessions(): Promise<TmuxListEntry[]> {
    await this.assertProviderAvailable("tmux")
    const result = await execLocalTmuxCommand(["list-sessions", "-F", TMUX_LIST_FORMAT])
    if (result.exitCode !== 0) {
      if (isTmuxSessionMissing(resultOutput(result))) return []
      throw createTmuxCommandError("tmux", "list-sessions", undefined, result)
    }
    return parseTmuxListSessionsOutput(result.stdout)
  }

  private async listRemoteTmuxSessions(target: ResolvedSshTarget): Promise<TmuxListEntry[]> {
    await this.assertProviderAvailable("ssh-tmux")
    const result = await execSshTmux(target, ["tmux", "list-sessions", "-F", TMUX_LIST_FORMAT], {
      timeoutMs: TMUX_TOOL_EXEC_TIMEOUT_MS,
    })
    if (result.exitCode !== 0) {
      if (isTmuxSessionMissing(resultOutput(result))) return []
      throw createTmuxCommandError("ssh-tmux", "list-sessions", target.profile ?? target.name, result)
    }
    return parseTmuxListSessionsOutput(result.stdout)
  }

  private async killLocalTmuxSession(name: string): Promise<void> {
    await this.assertProviderAvailable("tmux")
    const result = await execLocalTmuxCommand(["kill-session", "-t", name])
    if (result.exitCode !== 0) {
      throw createTmuxCommandError("tmux", "kill-session", name, result)
    }
  }

  private async killRemoteTmuxSession(target: ResolvedSshTarget, name: string): Promise<void> {
    await this.assertProviderAvailable("ssh-tmux")
    const result = await execSshTmux(target, ["tmux", "kill-session", "-t", name], {
      timeoutMs: TMUX_TOOL_EXEC_TIMEOUT_MS,
    })
    if (result.exitCode !== 0) {
      throw createTmuxCommandError("ssh-tmux", "kill-session", name, result)
    }
  }

  private getLiveInputSession(sessionId: string): ManagedSession {
    const session = this.sm.getSession(sessionId)
    if (session.status === "exited" || session.status === "killed" || session.status === "error") {
      throw new ProcessExitedError(session.sessionId, session.exitCode ?? null)
    }
    return session
  }

  private assertCapability(
    provider: TerminalProvider,
    capability: keyof ProviderCapabilities,
    action: string,
  ): void {
    if (provider.capabilities[capability] !== true) {
      throw new ProviderCapabilityUnsupportedError(provider.name, action)
    }
  }

  private recordSnapshot(session: ManagedSession, snapshot: TerminalSnapshot): void {
    session.lastSnapshot = snapshot
    session.status = snapshot.status
    session.exitCode = snapshot.exitCode
    session.transcript.recordSnapshot(snapshot.screen)
    this.sm.touchSession(session.sessionId)
  }
}

function formatUnknownError(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`
  }
  return String(err)
}

function execLocalTmuxCommand(args: readonly string[]): Promise<TmuxCommandResult> {
  const tmuxBin = process.env.TERMINAL_USE_TMUX_PATH ?? "tmux"
  return new Promise<TmuxCommandResult>((resolve, reject) => {
    execFile(tmuxBin, [...args], { timeout: TMUX_TOOL_EXEC_TIMEOUT_MS, maxBuffer: TMUX_TOOL_MAX_BUFFER_BYTES }, (error, stdout, stderr) => {
      const normalizedStdout = stdout ?? ""
      const normalizedStderr = stderr ?? ""

      if (error === null) {
        resolve({ stdout: normalizedStdout, stderr: normalizedStderr, exitCode: 0 })
        return
      }

      if (error.code === "ENOENT") {
        reject(new DependencyMissingError("tmux", "Install tmux 3.2+ or set TERMINAL_USE_TMUX_PATH to a tmux-compatible binary (e.g. psmux on Windows)"))
        return
      }

      resolve({
        stdout: normalizedStdout,
        stderr: normalizedStderr,
        exitCode: typeof error.code === "number" ? error.code : null,
      })
    })
  })
}

function parseTmuxListSessionsOutput(stdout: string): TmuxListEntry[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseTmuxListEntry)
}

function parseTmuxListEntry(line: string): TmuxListEntry {
  const [name = "", createdRaw = "", colsRaw = "80", rowsRaw = "24", windowsRaw = "1"] = line.split(TMUX_LIST_SEPARATOR)
  const createdSeconds = Number(createdRaw)
  return {
    name,
    created: Number.isFinite(createdSeconds) ? new Date(createdSeconds * 1000).toISOString() : new Date().toISOString(),
    cols: parsePositiveInteger(colsRaw, 80),
    rows: parsePositiveInteger(rowsRaw, 24),
    windows: parsePositiveInteger(windowsRaw, 1),
  }
}

function parsePositiveInteger(value: string, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return parsed
}

function createTmuxCommandError(
  provider: "tmux" | "ssh-tmux",
  action: string,
  sessionName: string | undefined,
  result: TmuxCommandResult,
): TerminalUseError {
  const output = resultOutput(result)
  if (isTmuxSessionMissing(output)) {
    return new SessionNotFoundError(sessionName ?? action)
  }
  if (isTmuxMissing(output)) {
    return provider === "ssh-tmux"
      ? new RemoteTmuxNotAvailableError(sessionName ?? "ssh-tmux")
      : new DependencyMissingError("tmux", "Install tmux 3.2+ or set TERMINAL_USE_TMUX_PATH to a tmux-compatible binary (e.g. psmux on Windows)")
  }
  return new InternalError(`${provider} ${action} failed`, {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  })
}

function resultOutput(result: TmuxCommandResult): string {
  return `${result.stderr}\n${result.stdout}`.trim()
}

function isTmuxSessionMissing(output: string): boolean {
  return /can't find session|no server running|no such session|session not found/i.test(output)
}

function isTmuxMissing(output: string): boolean {
  return /tmux: command not found|command not found: tmux|no such file or directory.*tmux|tmux not found/i.test(output)
}
