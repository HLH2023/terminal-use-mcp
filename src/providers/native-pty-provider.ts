/**
 * NativePtyProvider
 *
 * 基于 node-pty + @xterm/headless 的本地终端 Provider。
 * 这里负责 PTY 生命周期、输入输出串联、屏幕快照、等待轮询和 transcript 导出；
 * 安全策略中的启动命令/cwd 校验由上层 SessionManager 负责，本层只在输入侧拒绝
 * 明显的 secret/超大 paste，避免把敏感内容写入交互式终端。
 */

import type {
  ExportOptions,
  FindResult,
  MouseClickInput,
  MouseScrollInput,
  ProviderCapabilities,
  ProviderName,
  ScrollDirection,
  StartInput,
  TerminalProvider,
  TerminalSession,
  TranscriptExport,
  WaitOptions,
  WaitStableOptions,
} from "./provider.js"
import type { Logger } from "../logger.js"
import { detectRiskSignals } from "../terminal/confirm-detection.js"
import {
  LargePasteRefusedError,
  ProcessExitedError,
  ProviderNotAvailableError,
  SecretDetectedError,
  SessionNotFoundError,
  SessionTimeoutError,
} from "../terminal/errors.js"
import { generateSessionId } from "../terminal/ids.js"
import type { ParsedKeyExpr } from "../terminal/keymap.js"
import { parsedKeyToAnsiSequence, parseKeyExpr } from "../terminal/keymap.js"
import {
  mouseClickToFullSgrSequence,
  mouseScrollToSgrSequence,
  validateMouseCoords,
} from "../terminal/mouse.js"
import type { MouseClickEvent, MouseScrollEvent } from "../terminal/mouse.js"
import { containsSecrets, getDetectedSecretTypes } from "../terminal/redact.js"
import { createSnapshot } from "../terminal/terminal-snapshot.js"
import type { Highlight, TerminalSnapshot, TerminalSnapshotMode } from "../terminal/terminal-snapshot.js"
import { TranscriptRecorder } from "../terminal/transcript.js"
import { calculatePollDelay, checkScreenStable, checkTextMatch, hashScreen } from "../terminal/wait.js"
import type { ScreenState } from "../terminal/wait.js"
import { XtermAdapter } from "../terminal/xterm-adapter.js"
import { safeCleanup } from "../terminal/safe-cleanup.js"

const DEFAULT_TTL_MS = 60 * 60 * 1000
const LINE_BY_LINE_PASTE_DELAY_MS = 10
const PASTE_SOFT_LIMIT = 2_000
const PASTE_HARD_LIMIT = 10_000

type NodePtyModule = typeof import("node-pty")

type MinimalPtyDisposable = {
  dispose(): void
}

type MinimalPtyExitEvent = {
  exitCode: number
  signal?: number
}

interface MinimalPty {
  onData(callback: (data: string) => void): MinimalPtyDisposable
  onExit(callback: (event: MinimalPtyExitEvent) => void): MinimalPtyDisposable
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

let nodePty: NodePtyModule | null = null
let nodePtyLoadAttempted = false

const NATIVE_PTY_CAPABILITIES: ProviderCapabilities = {
  provider: "native-pty",
  supportsStart: true,
  supportsAttach: false,
  supportsStableWait: true,
  supportsTextWait: true,
  supportsHighlights: true,
  supportsScrollback: true,
  supportsResize: true,
  supportsTranscriptExport: true,
  supportsExitCode: true,
  supportsTitle: true,
  supportsFullscreenDetection: true,
  supportsRename: false,
  supportsScroll: true,
  supportsFind: true,
  supportsMouseClick: true,
  supportsMouseScroll: true,
}

type NativePtySession = {
  sessionId: string
  providerSessionId: string
  command: string
  args: string[]
  cwd: string
  status: "starting" | "running" | "exited" | "killed" | "error"
  exitCode: number | null
  cols: number
  rows: number
  label?: string
  createdAt: string
  lastActivityAt: string
  ttlMs: number

  /** node-pty 进程；kill 后置空，防止后续写入悬空进程。 */
  pty: MinimalPty | null
  /** xterm/headless 解析器，负责把原始 PTY 输出转换为屏幕缓冲。 */
  xtermAdapter: XtermAdapter
  /** 内存 transcript，后续 artifact 层可再负责落盘。 */
  transcript: TranscriptRecorder
  /** 自上次 snapshot 后是否有新数据，用于 changed 判定的辅助信号。 */
  dirty: boolean
  /** 上次 snapshot 的屏幕 hash。 */
  lastSnapshotScreen: string
  /** 上次 snapshot 时间戳。 */
  lastSnapshotTime: number
}

export class NativePtyProvider implements TerminalProvider {
  readonly name: ProviderName = "native-pty"
  readonly capabilities: ProviderCapabilities = NATIVE_PTY_CAPABILITIES

  private sessions: Map<string, NativePtySession>
  private logger: Logger

  constructor(logger: Logger) {
    this.sessions = new Map()
    this.logger = logger
  }

  /**
   * node-pty 是 native addon，部分环境可能安装但运行时加载失败；
   * 可用性检查通过共享 loader 动态 import 并缓存结果，避免 server 启动阶段因顶层 import 崩溃。
   */
  async isAvailable(): Promise<boolean> {
    return (await loadNodePty()) !== null
  }

  async start(input: StartInput): Promise<TerminalSession> {
    const ptyModule = await loadNodePty()
    if (ptyModule === null) {
      throw new ProviderNotAvailableError(this.name, "node-pty not available")
    }

    const sessionId = generateSessionId()
    const providerSessionId = `native_${sessionId}`
    const createdAt = new Date().toISOString()
    const xtermAdapter = new XtermAdapter(input.cols, input.rows)
    const transcript = new TranscriptRecorder(sessionId)

    let pty: MinimalPty
    try {
      pty = ptyModule.spawn(input.command, input.args.length > 0 ? input.args : [], {
        name: "xterm-256color",
        cols: input.cols,
        rows: input.rows,
        cwd: input.cwd,
        env: { ...process.env, ...input.env },
      })
    } catch (error) {
      // spawn 失败时 session 尚未登记，但 XtermAdapter 已创建；必须立即释放，避免泄漏 addon/事件句柄。
      xtermAdapter.dispose()
      throw error
    }

    const session: NativePtySession = {
      sessionId,
      providerSessionId,
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      status: "starting",
      exitCode: null,
      cols: input.cols,
      rows: input.rows,
      label: input.label,
      createdAt,
      lastActivityAt: createdAt,
      ttlMs: input.ttlMs ?? DEFAULT_TTL_MS,
      pty,
      xtermAdapter,
      transcript,
      dirty: false,
      lastSnapshotScreen: "",
      lastSnapshotTime: 0,
    }

    pty.onData((data) => {
      try {
        xtermAdapter.write(data)
        session.dirty = true
        session.lastActivityAt = new Date().toISOString()
        session.transcript.recordOutput(data)
      } catch (error) {
        session.status = "error"
        this.logger.error("native-pty output parse failed", { sessionId, error: this.stringifyUnknownError(error) })
      }
    })

    pty.onExit(({ exitCode, signal }) => {
      session.status = session.status === "killed" ? "killed" : "exited"
      session.exitCode = exitCode
      session.pty = null
      session.lastActivityAt = new Date().toISOString()
      session.transcript.recordExit(exitCode, signal === undefined ? undefined : signal.toString())
      this.logger.info("native-pty process exited", { sessionId, exitCode, signal })
    })

    session.status = "running"
    // Map key 使用 providerSessionId (如 "native_xxx")，确保 snapshot/kill 等通过 providerSessionId 查找时 key 一致
    this.sessions.set(providerSessionId, session)
    this.logger.info("native-pty session started", {
      sessionId,
      command: input.command,
      cwd: input.cwd,
      cols: input.cols,
      rows: input.rows,
    })

    return this.toTerminalSession(session)
  }

  async snapshot(sessionId: string, mode: TerminalSnapshotMode = "viewport"): Promise<TerminalSnapshot> {
    const session = this.getSession(sessionId)
    const screen = session.xtermAdapter.readScreen(mode)
    const highlights: Highlight[] = session.xtermAdapter.detectHighlights(mode)
    const screenText = screen.lines.map((line) => line.text).join("\n")
    const screenHash = hashScreen(screenText)
    const changed = session.dirty || session.lastSnapshotScreen !== screenHash
    const riskSignals = detectRiskSignals(screenText)

    const snapshot = createSnapshot({
      sessionId: session.sessionId,
      screen: screenText,
      cursor: screen.cursor,
      cols: screen.cols,
      rows: screen.rows,
      scrollbackLineCount: screen.scrollbackLineCount,
      status: session.status,
      changed,
      exitCode: session.exitCode,
      title: screen.title,
      isFullscreen: screen.isAltBuffer,
      highlights,
      riskSignals,
    })

    session.lastSnapshotScreen = screenHash
    session.lastSnapshotTime = Date.now()
    session.dirty = false
    session.lastActivityAt = snapshot.timestamp
    session.xtermAdapter.markClean()
    session.transcript.recordSnapshot(snapshot.screen)

    return snapshot
  }

  async waitForText(sessionId: string, text: string, options: WaitOptions): Promise<TerminalSnapshot> {
    const startedAt = Date.now()
    const timeoutMs = options.timeoutMs

    while (true) {
      const session = this.getSession(sessionId)
      const snapshot = await this.snapshot(sessionId)
      const match = checkTextMatch(snapshot.screen, { ...options, text })

      if (match.matched) {
        return snapshot
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new SessionTimeoutError(sessionId, timeoutMs, `等待文本超时: ${text}`)
      }

      await delay(calculatePollDelay({ idleMs: Math.max(20, Math.floor(timeoutMs / 10)), timeoutMs }))

      // 进程已退出且目标文本仍未出现时，继续到超时会浪费调用方时间；直接报进程退出。
      if (session.status === "exited" || session.status === "killed" || session.status === "error") {
        throw new ProcessExitedError(sessionId, session.exitCode)
      }
    }
  }

  async waitStable(sessionId: string, options: WaitStableOptions): Promise<TerminalSnapshot> {
    const startedAt = Date.now()
    const snapshotOnTimeout = options.snapshotOnTimeout ?? true
    let previousState: ScreenState | null = null

    while (true) {
      const session = this.getSession(sessionId)
      const snapshot = await this.snapshot(sessionId)
      const now = Date.now()
      const currentState: ScreenState = {
        screen: snapshot.screen,
        screenHash: hashScreen(snapshot.screen),
        lastWriteAt: session.xtermAdapter.getLastWriteAt(),
        now,
      }
      const stable = checkScreenStable(currentState, previousState, options)

      if (stable.stable) {
        return snapshot
      }

      if (now - startedAt > options.timeoutMs) {
        if (snapshotOnTimeout) {
          // 连续刷新型 TUI 可能无法满足稳定判定；返回当前观察值比让 agent 空等到错误更有用。
          this.logger.debug("native-pty waitStable timeout; returning current snapshot", {
            sessionId,
            timeoutMs: options.timeoutMs,
          })
          return { ...snapshot, timedOut: true }
        }

        // 严格模式保留旧行为，供测试或必须确认稳定的调用方使用。
        throw new SessionTimeoutError(sessionId, options.timeoutMs, "等待屏幕稳定超时")
      }

      previousState = currentState
      await delay(calculatePollDelay(options))
    }
  }

  async type(sessionId: string, text: string): Promise<void> {
    const session = this.getWritableSession(sessionId)
    session.pty.write(text)
    session.transcript.recordInput(text)
    session.lastActivityAt = new Date().toISOString()
  }

  async press(sessionId: string, keyExpr: string, parsed: ParsedKeyExpr): Promise<void> {
    const sequence = parsedKeyToAnsiSequence(parsed)
    const session = this.getWritableSession(sessionId)
    session.pty.write(sequence)
    session.transcript.recordInput(`<${keyExpr}>`)
    session.lastActivityAt = new Date().toISOString()
  }

  async paste(sessionId: string, text: string, mode?: "bracketed" | "line-by-line" | "raw"): Promise<void> {
    this.assertPasteSafe(text)
    const session = this.getWritableSession(sessionId)
    const effectiveMode = mode ?? "bracketed"

    if (effectiveMode === "bracketed") {
      const payload = `\x1b[200~${text}\x1b[201~`
      session.pty.write(payload)
      session.transcript.recordInput("<paste:bracketed>")
      session.lastActivityAt = new Date().toISOString()
      return
    }

    if (effectiveMode === "line-by-line") {
      const lines = text.split(/\r?\n/)
      for (const line of lines) {
        session.pty.write(`${line}\r`)
        await delay(LINE_BY_LINE_PASTE_DELAY_MS)
      }
      session.transcript.recordInput("<paste:line-by-line>")
      session.lastActivityAt = new Date().toISOString()
      return
    }

    session.pty.write(text)
    session.transcript.recordInput("<paste:raw>")
    session.lastActivityAt = new Date().toISOString()
  }

  async find(sessionId: string, pattern: string, regex?: boolean, includeScrollback?: boolean): Promise<FindResult[]> {
    // find 的既有契约是在 active buffer 全量文本中搜索；snapshot 默认改为 viewport 后，
    // 这里必须显式使用 full，避免 find 退化为仅搜索当前可见行。
    const snapshot = await this.snapshot(sessionId, "full")
    // XtermAdapter 当前公开的是 active buffer 文本；active buffer 在常规缓冲下已包含可读范围。
    // includeScrollback 暂按 best-effort 处理，不越过 adapter 私有字段访问 xterm 实例。
    const lines = snapshot.screen.split("\n")
    const results: FindResult[] = []

    if (regex === true) {
      const expression = new RegExp(pattern, "g")
      for (let row = 0; row < lines.length; row += 1) {
        for (const match of lines[row].matchAll(expression)) {
          results.push({ row, col: match.index, line: lines[row], match: match[0] })
        }
      }
      return results
    }

    for (let row = 0; row < lines.length; row += 1) {
      let col = lines[row].indexOf(pattern)
      while (col !== -1) {
        results.push({ row, col, line: lines[row], match: pattern })
        col = lines[row].indexOf(pattern, col + Math.max(pattern.length, 1))
      }
    }

    if (includeScrollback === true) {
      this.logger.debug("native-pty find includeScrollback handled as best-effort active-buffer search", { sessionId })
    }

    return results
  }

  async scroll(sessionId: string, direction: ScrollDirection, lines: number): Promise<void> {
    const keyExpr = direction === "up" ? "pageup" : "pagedown"
    const parsed = parseKeyExpr(keyExpr)
    const count = Math.max(0, Math.floor(lines))

    for (let index = 0; index < count; index += 1) {
      await this.press(sessionId, keyExpr, parsed)
    }
  }

  async mouseClick(sessionId: string, input: MouseClickInput): Promise<void> {
    const session = this.getWritableSession(sessionId)
    validateMouseCoords(input.col, input.row, session.cols, session.rows)

    const event: Omit<MouseClickEvent, "action"> = {
      col: input.col,
      row: input.row,
      button: input.button,
      shift: input.shift,
      alt: input.alt,
      ctrl: input.ctrl,
    }
    const sequence = mouseClickToFullSgrSequence(event)
    session.pty.write(sequence)
    session.transcript.recordInput(`<mouse:click:${input.button}@${input.col},${input.row}>`)
    session.lastActivityAt = new Date().toISOString()
  }

  async mouseScroll(sessionId: string, input: MouseScrollInput): Promise<void> {
    const session = this.getWritableSession(sessionId)
    validateMouseCoords(input.col, input.row, session.cols, session.rows)

    const event: MouseScrollEvent = {
      col: input.col,
      row: input.row,
      direction: input.direction,
      shift: input.shift,
      alt: input.alt,
      ctrl: input.ctrl,
    }
    const sequence = mouseScrollToSgrSequence(event)
    session.pty.write(sequence)
    session.transcript.recordInput(`<mouse:scroll:${input.direction}@${input.col},${input.row}>`)
    session.lastActivityAt = new Date().toISOString()
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    const session = this.getSession(sessionId)
    const pty = session.pty

    if (pty === null) {
      throw new ProcessExitedError(sessionId, session.exitCode)
    }

    pty.resize(cols, rows)
    session.xtermAdapter.resize(cols, rows)
    session.cols = cols
    session.rows = rows
    session.dirty = true
    session.lastActivityAt = new Date().toISOString()
    session.transcript.recordResize(cols, rows)
  }

  async kill(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)

    await safeCleanup([
      {
        name: "pty.kill",
        fn: () => {
          if (session.pty !== null) {
            if (process.platform === "win32") {
              session.pty.kill()
            } else {
              session.pty.kill("SIGTERM")
            }
            session.pty = null
          }
        },
      },
      {
        name: "markKilled+recordExit",
        fn: () => {
          session.status = "killed"
          session.lastActivityAt = new Date().toISOString()
          session.transcript.recordExit(session.exitCode, "killed")
        },
      },
      {
        name: "xtermAdapter.dispose",
        fn: () => session.xtermAdapter.dispose(),
      },
      {
        name: "sessions.delete",
        fn: () => {
          this.sessions.delete(session.providerSessionId)
        },
      },
    ], this.logger)

    this.logger.info("native-pty session killed", { sessionId })
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  listActiveSessionIds(): string[] {
    return Array.from(this.sessions.keys())
  }

  async exportTranscript(sessionId: string, options: ExportOptions): Promise<TranscriptExport> {
    const session = this.getSession(sessionId)
    const content = session.transcript.export(options.format, { redact: options.redact })

    return {
      format: options.format,
      content,
      snapshotCount: this.countSnapshotEvents(session),
      eventCount: session.transcript.getEventCount(),
      redacted: options.redact,
    }
  }

  private getSession(sessionId: string): NativePtySession {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new SessionNotFoundError(sessionId)
    }
    return session
  }

  private getWritableSession(sessionId: string): NativePtySession & { pty: MinimalPty } {
    const session = this.getSession(sessionId)
    if (session.pty === null || session.status === "exited" || session.status === "killed" || session.status === "error") {
      throw new ProcessExitedError(sessionId, session.exitCode)
    }
    return session as NativePtySession & { pty: MinimalPty }
  }

  private toTerminalSession(session: NativePtySession): TerminalSession {
    return {
      sessionId: session.sessionId,
      providerName: this.name,
      providerSessionId: session.providerSessionId,
      command: session.command,
      args: session.args,
      cwd: session.cwd,
      label: session.label,
      status: session.status,
      exitCode: session.exitCode,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      ttlMs: session.ttlMs,
      capabilities: this.capabilities,
    }
  }

  private assertPasteSafe(text: string): void {
    if (text.length > PASTE_HARD_LIMIT) {
      throw new LargePasteRefusedError(text.length, PASTE_HARD_LIMIT, true)
    }
    if (text.length > PASTE_SOFT_LIMIT) {
      throw new LargePasteRefusedError(text.length, PASTE_SOFT_LIMIT)
    }
    if (containsSecrets(text)) {
      throw new SecretDetectedError(getDetectedSecretTypes(text))
    }
  }

  private countSnapshotEvents(session: NativePtySession): number {
    return session.transcript.getEvents(session.transcript.getEventCount()).events
      .filter((event) => event.type === "snapshot").length
  }

  private stringifyUnknownError(error: unknown): string {
    if (error instanceof Error) {
      return error.message
    }
    return String(error)
  }
}

async function loadNodePty(): Promise<NodePtyModule | null> {
  if (nodePty !== null) {
    return nodePty
  }
  if (nodePtyLoadAttempted) {
    return null
  }

  nodePtyLoadAttempted = true
  try {
    nodePty = await import("node-pty")
    return nodePty
  } catch {
    return null
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
