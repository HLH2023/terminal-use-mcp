/**
 * TmuxProvider — 本地 tmux TerminalProvider 接口适配层
 *
 * 薄壳委托模式：所有核心逻辑委托给 TmuxCore（三通道架构），
 * 本文件只做 TerminalProvider 接口适配 + 版本检测 + 外部 session 查询。
 *
 * Transport 使用 LocalTmuxTransport（本地 tmux 命令执行）。
 */

import type {
  ExportOptions,
  FindResult,
  MouseClickInput,
  MouseScrollInput,
  ProviderCapabilities,
  ProviderName,
  ScrollDirection,
  ScrollMode,
  StartInput,
  TerminalProvider,
  TerminalSession,
  TranscriptExport,
  WaitOptions,
  WaitStableOptions,
} from "./provider.js"
import type { ParsedKeyExpr } from "../terminal/keymap.js"
import type { TerminalSnapshot, TerminalSnapshotMode } from "../terminal/terminal-snapshot.js"
import type { Logger } from "../logger.js"
import { TmuxCore } from "./tmux-core.js"
import type { TmuxCoreSession } from "./tmux-core.js"
import { LocalTmuxTransport } from "./tmux-transport.js"
import { checkSecretEnvPolicy } from "../terminal/secret-env-policy.js"
import type { SecretEnvPolicy } from "../config.js"
import {
  DependencyMissingError,
  SecretEnvDeniedError,
} from "../terminal/errors.js"

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 60 * 60 * 1000
const LIST_SEPARATOR = "\t"

const TMUX_CAPABILITIES: ProviderCapabilities = {
  provider: "tmux",
  supportsStart: true,
  supportsAttach: true,
  supportsStableWait: true,
  supportsTextWait: true,
  supportsHighlights: true,
  supportsScrollback: true,
  supportsResize: true,
  supportsTranscriptExport: true,
  supportsExitCode: true,
  supportsTitle: true,
  supportsFullscreenDetection: true,
  supportsRename: true,
  supportsScroll: true,
  supportsFind: true,
  supportsMouseClick: true,
  supportsMouseScroll: true,
}

// ─── 版本检测 ─────────────────────────────────────────────────────────────────

type TmuxVersion = { major: number; minor: number }

function parseTmuxVersion(output: string): TmuxVersion | undefined {
  const versionMatch = output.match(/tmux\s+(\d+)\.(\d+)/u)
  if (versionMatch === null) return undefined

  const majorRaw = versionMatch[1]
  const minorRaw = versionMatch[2]
  if (majorRaw === undefined || minorRaw === undefined) return undefined

  return {
    major: Number.parseInt(majorRaw, 10),
    minor: Number.parseInt(minorRaw, 10),
  }
}

function isSupportedTmuxVersion(version: TmuxVersion): boolean {
  return version.major > 3 || (version.major === 3 && version.minor >= 2)
}

// ─── 外部 session 列表 ───────────────────────────────────────────────────────

type TmuxListEntry = {
  name: string
  createdAt: string
  cols: number
  rows: number
}

function parseListEntry(line: string): TmuxListEntry {
  const [name = "", createdRaw = "", colsRaw = "80", rowsRaw = "24"] = line.split(LIST_SEPARATOR)
  const createdSeconds = Number(createdRaw)
  const cols = Number(colsRaw)
  const rows = Number(rowsRaw)

  return {
    name,
    createdAt: Number.isFinite(createdSeconds) ? new Date(createdSeconds * 1000).toISOString() : new Date().toISOString(),
    cols: Number.isFinite(cols) ? cols : 80,
    rows: Number.isFinite(rows) ? rows : 24,
  }
}

// ─── Provider Options ─────────────────────────────────────────────────────────

export type TmuxProviderOptions = {
  /** 秘密环境变量策略；统一从 config 层传入，默认 "deny"。 */
  secretEnvPolicy?: SecretEnvPolicy
}

// ─── TmuxProvider ─────────────────────────────────────────────────────────────

export class TmuxProvider implements TerminalProvider {
  readonly name: ProviderName = "tmux"
  readonly capabilities: ProviderCapabilities = TMUX_CAPABILITIES

  private core: TmuxCore
  private logger: Logger
  private tmuxAvailable: boolean | undefined
  private readonly secretEnvPolicy: SecretEnvPolicy
  private readonly transport: LocalTmuxTransport

  constructor(logger: Logger, options?: TmuxProviderOptions) {
    this.core = new TmuxCore(logger)
    this.logger = logger
    this.tmuxAvailable = undefined
    this.secretEnvPolicy = options?.secretEnvPolicy ?? "deny"
    this.transport = new LocalTmuxTransport()
  }

  // ─── 可用性检测 ───────────────────────────────────────────────────────────

  async isAvailable(): Promise<boolean> {
    if (this.tmuxAvailable !== undefined) return this.tmuxAvailable

    try {
      const result = await this.transport.execTmux(["-V"])
      const version = parseTmuxVersion(result.stdout)
      this.tmuxAvailable = version !== undefined && isSupportedTmuxVersion(version)
      return this.tmuxAvailable
    } catch {
      this.tmuxAvailable = false
      return false
    }
  }

  // ─── 生命周期 ─────────────────────────────────────────────────────────────

  async start(input: StartInput): Promise<TerminalSession> {
    await this.ensureTmuxAvailable()

    if (input.env !== undefined && Object.keys(input.env).length > 0) {
      const secretCheck = checkSecretEnvPolicy(input.env, this.secretEnvPolicy)
      if (!secretCheck.allowed) {
        throw new SecretEnvDeniedError(secretCheck.deniedKeys)
      }
    }

    const coreSession = await this.core.start(input, this.transport, this.name)
    return this.coreSessionToTerminalSession(coreSession)
  }

  async attach(sessionIdOrName: string): Promise<TerminalSession> {
    await this.ensureTmuxAvailable()

    const existing = this.findTrackedSession(sessionIdOrName)
    if (existing !== undefined) return this.coreSessionToTerminalSession(existing)

    const coreSession = await this.core.attach(sessionIdOrName, this.transport, this.name)
    return this.coreSessionToTerminalSession(coreSession)
  }

  // ─── 观测 ─────────────────────────────────────────────────────────────────

  async snapshot(sessionId: string, mode?: TerminalSnapshotMode): Promise<TerminalSnapshot> {
    return this.core.snapshot(sessionId, mode)
  }

  async waitForText(sessionId: string, text: string, options: WaitOptions): Promise<TerminalSnapshot> {
    return this.core.waitForText(sessionId, text, options)
  }

  async waitStable(sessionId: string, options: WaitStableOptions): Promise<TerminalSnapshot> {
    return this.core.waitStable(sessionId, options)
  }

  // ─── 输入 ─────────────────────────────────────────────────────────────────

  async type(sessionId: string, text: string): Promise<void> {
    return this.core.type(sessionId, text)
  }

  async press(sessionId: string, keyExpr: string, parsed: ParsedKeyExpr): Promise<void> {
    return this.core.press(sessionId, keyExpr, parsed)
  }

  async paste(sessionId: string, text: string, mode?: "bracketed" | "line-by-line" | "raw"): Promise<void> {
    return this.core.paste(sessionId, text, mode)
  }

  // ─── 搜索与滚动 ───────────────────────────────────────────────────────────

  async find(sessionId: string, pattern: string, regex?: boolean, includeScrollback?: boolean): Promise<FindResult[]> {
    return this.core.find(sessionId, pattern, regex, includeScrollback)
  }

  async scroll(sessionId: string, direction: ScrollDirection, lines: number, mode?: ScrollMode): Promise<void> {
    return this.core.scroll(sessionId, direction, lines, mode ?? "program-key")
  }

  // ─── 鼠标 ─────────────────────────────────────────────────────────────────

  async mouseClick(sessionId: string, input: MouseClickInput): Promise<void> {
    return this.core.mouseClick(sessionId, input)
  }

  async mouseScroll(sessionId: string, input: MouseScrollInput): Promise<void> {
    return this.core.mouseScroll(sessionId, input)
  }

  // ─── 管理命令 ─────────────────────────────────────────────────────────────

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    return this.core.resize(sessionId, cols, rows)
  }

  async rename(sessionId: string, label: string): Promise<void> {
    return this.core.rename(sessionId, label)
  }

  async kill(sessionId: string): Promise<void> {
    return this.core.kill(sessionId)
  }

  async exportTranscript(sessionId: string, options: ExportOptions): Promise<TranscriptExport> {
    return this.core.exportTranscript(sessionId, options)
  }

  // ─── 查询 ─────────────────────────────────────────────────────────────────

  hasSession(sessionId: string): boolean {
    return this.core.hasSession(sessionId)
  }

  listActiveSessionIds(): string[] {
    return this.core.listActiveSessionIds()
  }

  async list(): Promise<TerminalSession[]> {
    await this.ensureTmuxAvailable()

    const trackedSessions = this.core.listSessions().map(s => this.coreSessionToTerminalSession(s))
    const trackedTmuxIds = new Set(trackedSessions.map(s => s.providerSessionId))

    const entries = await this.listTmuxSessions()
    const externalSessions = entries
      .filter(entry => !trackedTmuxIds.has(entry.name))
      .map(entry => this.createExternalListSession(entry))

    return [...trackedSessions, ...externalSessions]
  }

  // ─── 私有辅助 ─────────────────────────────────────────────────────────────

  private async ensureTmuxAvailable(): Promise<void> {
    const available = await this.isAvailable()
    if (!available) {
      throw new DependencyMissingError(
        "tmux",
        "Install tmux 3.2+ or set TERMINAL_USE_TMUX_PATH to a tmux-compatible binary (e.g. psmux on Windows)",
      )
    }
  }

  /** 将 TmuxCoreSession 转为 TerminalSession */
  private coreSessionToTerminalSession(coreSession: TmuxCoreSession): TerminalSession {
    const info = coreSession.sessionInfo
    return {
      sessionId: info.sessionId,
      providerName: info.providerName,
      providerSessionId: info.providerSessionId,
      command: info.command,
      args: info.args,
      cwd: info.cwd,
      label: info.label,
      status: info.status,
      exitCode: info.exitCode ?? null,
      createdAt: info.createdAt,
      lastActivityAt: info.lastActivityAt,
      ttlMs: info.ttlMs,
      capabilities: this.capabilities,
    }
  }

  /** 查找已 tracked 的 session（按 providerSessionId 或 tmuxId） */
  private findTrackedSession(sessionIdOrName: string): TmuxCoreSession | undefined {
    const allSessions = this.core.listSessions()
    const byProviderSessionId = allSessions.find(s => s.sessionInfo.providerSessionId === sessionIdOrName)
    if (byProviderSessionId !== undefined) return byProviderSessionId
    return allSessions.find(s => s.tmuxId === sessionIdOrName)
  }

  /** 列出所有 tmux sessions（CLI fallback，含外部非 tracked session） */
  private async listTmuxSessions(): Promise<TmuxListEntry[]> {
    const format = ["#{session_name}", "#{session_created}", "#{window_width}", "#{window_height}"].join(LIST_SEPARATOR)

    try {
      const result = await this.transport.execTmux(["list-sessions", "-F", format])
      // LocalTmuxTransport.execTmux 返回 { stdout, stderr, exitCode }，list-sessions 无 session 时 exitCode !== 0
      if (result.exitCode !== 0) return []
      return result.stdout
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => parseListEntry(line))
    } catch {
      return []
    }
  }

  /** 创建外部 tmux session 的 TerminalSession 表示 */
  private createExternalListSession(entry: TmuxListEntry): TerminalSession {
    return {
      sessionId: `external:${entry.name}`,
      providerName: this.name,
      providerSessionId: entry.name,
      command: "tmux-external",
      args: [entry.name],
      cwd: process.cwd(),
      label: entry.name,
      status: "running",
      exitCode: null,
      createdAt: entry.createdAt,
      lastActivityAt: new Date().toISOString(),
      ttlMs: DEFAULT_TTL_MS,
      capabilities: this.capabilities,
    }
  }
}
