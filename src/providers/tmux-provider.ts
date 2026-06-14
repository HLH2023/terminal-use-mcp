import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
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
import type { ParsedKeyExpr } from "../terminal/keymap.js"
import type { Highlight, TerminalSnapshot, TerminalSnapshotMode } from "../terminal/terminal-snapshot.js"
import type { MouseClickEvent, MouseScrollEvent } from "../terminal/mouse.js"
import type { Logger } from "../logger.js"
import { parsedKeyToTmuxKey } from "../terminal/keymap.js"
import { createSnapshot } from "../terminal/terminal-snapshot.js"
import { detectRiskSignals } from "../terminal/confirm-detection.js"
import { calculatePollDelay, checkScreenStable, checkTextMatch, hashScreen } from "../terminal/wait.js"
import type { ScreenState } from "../terminal/wait.js"
import { TranscriptRecorder } from "../terminal/transcript.js"
import { generateSessionId } from "../terminal/ids.js"
import { mouseClickToTmuxSequence, mouseScrollToTmuxSequence, validateMouseCoords } from "../terminal/mouse.js"
import { XtermAdapter } from "../terminal/xterm-adapter.js"
import { safeCleanup } from "../terminal/safe-cleanup.js"
import {
  DependencyMissingError,
  ProcessExitedError,
  SessionNotFoundError,
  SessionTimeoutError,
} from "../terminal/errors.js"

const TMUX_EXEC_TIMEOUT_MS = 5_000
const DEFAULT_TTL_MS = 60 * 60 * 1000
const LINE_PASTE_DELAY_MS = 5
const LIST_SEPARATOR = "\t"

function getTmuxBin(): string {
  return process.env.TERMINAL_USE_TMUX_PATH ?? "tmux"
}

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

type ExecTmuxResult = {
  stdout: string
  stderr: string
}

type TmuxSession = {
  session: TerminalSession
  tmuxId: string
  rows: number
  cols: number
  xtermAdapter: XtermAdapter
  transcript: TranscriptRecorder
  lastScreenHash?: string
  lastWriteAt: number
  snapshotCount: number
}

type TmuxListEntry = {
  name: string
  createdAt: string
  cols: number
  rows: number
}

export class TmuxProvider implements TerminalProvider {
  readonly name: ProviderName = "tmux"
  readonly capabilities: ProviderCapabilities = TMUX_CAPABILITIES

  private sessions: Map<string, TmuxSession>
  private logger: Logger
  private tmuxAvailable: boolean | undefined

  constructor(logger: Logger) {
    this.sessions = new Map()
    this.logger = logger
    this.tmuxAvailable = undefined
  }

  async isAvailable(): Promise<boolean> {
    if (this.tmuxAvailable !== undefined) return this.tmuxAvailable

    try {
      const result = await this.execTmux(["-V"])
      const version = parseTmuxVersion(result.stdout)
      this.tmuxAvailable = version !== undefined && isSupportedTmuxVersion(version)
      return this.tmuxAvailable
    } catch {
      this.tmuxAvailable = false
      return false
    }
  }

  async start(input: StartInput): Promise<TerminalSession> {
    await this.ensureTmuxAvailable()

    const sessionId = generateSessionId()
    const tmuxId = this.createTmuxSessionName()
    const now = new Date().toISOString()
    const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS
    const xtermAdapter = new XtermAdapter(input.cols, input.rows)
    const envArgs = buildTmuxEnvironmentArgs(input.env)

    let started = false
    try {
      await this.execTmux([
        "new-session",
        "-d",
        "-s",
        tmuxId,
        "-x",
        input.cols.toString(),
        "-y",
        input.rows.toString(),
        "-c",
        input.cwd,
        ...envArgs,
        "--",
        input.command,
        ...input.args,
      ])
      // 为 MCP 管理的 session 启用鼠标模式，确保 mouse_scroll/mouse_click
      // SGR-1006 序列能被 tmux 正确转发给子进程（包括 alternate-buffer TUI 程序）。
      // 仅对当前 session window 生效，不修改全局 tmux 配置。
      await this.execTmux(["set-option", "-t", tmuxId, "mouse", "on"])
      started = true
    } finally {
      if (!started) {
        // start 失败时不会进入 sessions map；这里释放提前创建的 adapter，避免 addon/事件句柄泄漏。
        xtermAdapter.dispose()
      }
    }

    const session: TerminalSession = {
      sessionId,
      providerName: this.name,
      providerSessionId: tmuxId,
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      label: input.label,
      status: "running",
      exitCode: null,
      createdAt: now,
      lastActivityAt: now,
      ttlMs,
      capabilities: this.capabilities,
    }

    // Map key = tmuxId (providerSessionId)，与 snapshot/kill 等查询参数一致
    this.sessions.set(tmuxId, {
      session,
      tmuxId,
      rows: input.rows,
      cols: input.cols,
      xtermAdapter,
      transcript: new TranscriptRecorder(sessionId),
      lastWriteAt: Date.now(),
      snapshotCount: 0,
    })

    this.logger.info("tmux session started", { sessionId, tmuxId })
    return session
  }

  async attach(sessionIdOrName: string): Promise<TerminalSession> {
    await this.ensureTmuxAvailable()

    const existing = this.findTrackedSession(sessionIdOrName)
    if (existing !== undefined) return existing.session

    const tmuxId = sessionIdOrName
    const dimensions = await this.readDimensions(tmuxId)
    const title = await this.readTitle(tmuxId)
    const sessionId = generateSessionId()

    // attach 的 session 可能由非 MCP 工具创建（默认 mouse off），
    // 确保鼠标模式开启以支持 SGR-1006 序列转发。
    await this.execTmux(["set-option", "-t", tmuxId, "mouse", "on"])
    const now = new Date().toISOString()
    const xtermAdapter = new XtermAdapter(dimensions.cols, dimensions.rows)

    const session: TerminalSession = {
      sessionId,
      providerName: this.name,
      providerSessionId: tmuxId,
      command: "tmux-attach",
      args: [tmuxId],
      cwd: process.cwd(),
      label: title,
      status: "running",
      exitCode: null,
      createdAt: now,
      lastActivityAt: now,
      ttlMs: DEFAULT_TTL_MS,
      capabilities: this.capabilities,
    }

    // Map key = tmuxId (providerSessionId)
    this.sessions.set(tmuxId, {
      session,
      tmuxId,
      rows: dimensions.rows,
      cols: dimensions.cols,
      xtermAdapter,
      transcript: new TranscriptRecorder(sessionId),
      lastWriteAt: Date.now(),
      snapshotCount: 0,
    })

    this.logger.info("tmux session attached", { sessionId, tmuxId })
    return session
  }

  // ⚡ 架构要点：tmux server 存储 cell 级属性（grid_cell.attr/fg/bg），
  // 但 capture-pane 默认 (-p) 只输出纯文本。加上 -e 参数后，
  // tmux 会输出完整 ANSI SGR 序列（如 [1m[31m = bold+red），
  // 该序列可被 xterm-headless 解析回 cell buffer，
  // 从而实现 highlights / find / fullscreen 检测。
  //
  // 与 native-pty 的区别：native-pty 实时流式写入 xterm（增量更新 + 脏标记），
  // 而 tmux provider 是快照式 — 每次 snapshot 全量解析。
  // 这意味着 tmux provider 的 snapshot 比 native-pty 稍慢（多一次 ANSI 写入），
  // 但功能上等价。
  async snapshot(sessionId: string, mode?: TerminalSnapshotMode): Promise<TerminalSnapshot> {
    const tracked = this.getLiveSession(sessionId)
    const snapshotMode = mode ?? "viewport"
    // viewport 模式只取当前可见屏幕（不带 -S），full 模式取完整 scrollback。
    // 带了 -S 时 capture-pane 返回的行数超过终端行数，写入 xterm 后会滚出视口。
    const captureArgs: string[] = [
      "capture-pane",
      "-t",
      tracked.tmuxId,
      "-p",
      "-e",
    ]
    if (snapshotMode === "full") {
      captureArgs.push("-S", "-5000")
    }
    const captureResult = await this.execTmux(captureArgs)

    // capture-pane 每次返回一份完整快照；重建 adapter 可避免重复写入导致 full buffer 累积旧快照。
    tracked.xtermAdapter.dispose()
    tracked.xtermAdapter = new XtermAdapter(tracked.cols, tracked.rows)
    // capture-pane -e 输出仅有 \n（Unix 换行），但 xterm-headless 把 \n 视为仅换行不回车（LF without CR），
    // 会导致内容错位。PTY 输出是 \r\n，这里必须补齐 \r。
    // 末尾换行会导致 xterm 滚屏，必须剥除。
    const trimmed = captureResult.stdout.replace(/\r?\n+$/, "")
    const eolFixed = trimmed.replace(/(?<!\r)\n/g, "\r\n")
    await tracked.xtermAdapter.write(eolFixed)

    const screenState = tracked.xtermAdapter.readScreen(snapshotMode)
    const paneHistoryLineCount = snapshotMode === "viewport"
      ? await this.readPaneHistoryLineCount(tracked.tmuxId)
      : undefined
    const highlights: Highlight[] = tracked.xtermAdapter.detectHighlights(snapshotMode)
    const screen = screenState.lines.map((line) => line.text).join("\n")
    const title = screenState.title ?? await this.readTitle(tracked.tmuxId)
    const isFullscreen = tracked.xtermAdapter.readScreen().isAltBuffer
    const currentHash = hashScreen(screen)
    const changed = tracked.lastScreenHash === undefined ? true : tracked.lastScreenHash !== currentHash

    if (changed) {
      tracked.lastWriteAt = tracked.xtermAdapter.getLastWriteAt() || Date.now()
      tracked.lastScreenHash = currentHash
    }

    const snapshot = createSnapshot({
      sessionId: tracked.session.sessionId,
      screen,
      cursor: screenState.cursor,
      cols: screenState.cols,
      rows: screenState.rows,
      // tmux viewport capture 不包含历史行，重建 xterm 后无法从 buffer 反推出真实 scrollback；
      // 因此 viewport 模式优先使用 tmux pane 自身的 history_size。
      scrollbackLineCount: paneHistoryLineCount ?? screenState.scrollbackLineCount,
      status: tracked.session.status,
      changed,
      exitCode: tracked.session.exitCode ?? null,
      title,
      isFullscreen,
      highlights,
      riskSignals: detectRiskSignals(screen),
    })

    tracked.snapshotCount += 1
    tracked.xtermAdapter.markClean()
    tracked.transcript.recordSnapshot(screen)
    this.touch(tracked)
    return snapshot
  }

  async waitForText(sessionId: string, text: string, options: WaitOptions): Promise<TerminalSnapshot> {
    const startedAt = Date.now()
    const pollDelay = calculatePollDelay({ idleMs: 500 })

    while (Date.now() - startedAt <= options.timeoutMs) {
      const snapshot = await this.snapshot(sessionId)
      const match = checkTextMatch(snapshot.screen, {
        text,
        regex: options.regex,
        timeoutMs: options.timeoutMs,
        caseSensitive: options.caseSensitive,
      })

      if (match.matched) return snapshot
      await this.delay(pollDelay)
    }

    throw new SessionTimeoutError(sessionId, options.timeoutMs, `等待文本超时: ${text}`)
  }

  async waitStable(sessionId: string, options: WaitStableOptions): Promise<TerminalSnapshot> {
    const startedAt = Date.now()
    const pollDelay = calculatePollDelay({ idleMs: options.idleMs, timeoutMs: options.timeoutMs })
    let previousState: ScreenState | null = null
    let lastSnapshot: TerminalSnapshot | null = null

    while (Date.now() - startedAt <= options.timeoutMs) {
      const tracked = this.getLiveSession(sessionId)
      const snapshot = await this.snapshot(sessionId)
      const now = Date.now()
      const xtermLastWriteAt = tracked.xtermAdapter.getLastWriteAt()
      const currentState: ScreenState = {
        screen: snapshot.screen,
        screenHash: hashScreen(snapshot.screen),
        // tmux provider 每次 snapshot 都会把 ANSI 快照写入 xterm；仅在内容变化时采用 xterm 写入时间，
        // 未变化时回退 tracked.lastWriteAt，避免轮询自身写入导致 waitStable 永远不稳定。
        lastWriteAt: snapshot.changed === true && xtermLastWriteAt > 0 ? xtermLastWriteAt : tracked.lastWriteAt,
        now,
      }
      const stable = checkScreenStable(currentState, previousState, {
        idleMs: options.idleMs,
        timeoutMs: options.timeoutMs,
      })

      if (stable.stable) return snapshot

      previousState = currentState
      lastSnapshot = snapshot
      await this.delay(pollDelay)
    }

    throw new SessionTimeoutError(
      sessionId,
      options.timeoutMs,
      lastSnapshot === null ? "等待稳定超时，且未取得快照" : "等待屏幕稳定超时",
    )
  }

  async type(sessionId: string, text: string): Promise<void> {
    const tracked = this.getLiveSession(sessionId)
    await this.execTmux(["send-keys", "-t", tracked.tmuxId, "-l", text])
    tracked.transcript.recordInput(text)
    this.touch(tracked)
  }

  async press(sessionId: string, keyExpr: string, parsed: ParsedKeyExpr): Promise<void> {
    const tracked = this.getLiveSession(sessionId)
    const tmuxKey = parsedKeyToTmuxKey(parsed)
    await this.execTmux(["send-keys", "-t", tracked.tmuxId, tmuxKey])
    tracked.transcript.recordInput(`[key:${keyExpr}]`)
    this.touch(tracked)
  }

  async paste(sessionId: string, text: string, mode?: "bracketed" | "line-by-line" | "raw"): Promise<void> {
    const tracked = this.getLiveSession(sessionId)
    const effectiveMode = mode ?? "line-by-line"

    if (effectiveMode === "raw") {
      await this.execTmux(["send-keys", "-t", tracked.tmuxId, "-l", text])
      tracked.transcript.recordInput(text)
      this.touch(tracked)
      return
    }

    const lines = text.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (line.length > 0) {
        await this.execTmux(["send-keys", "-t", tracked.tmuxId, "-l", line])
      }
      if (index < lines.length - 1) {
        await this.execTmux(["send-keys", "-t", tracked.tmuxId, "Enter"])
        await this.delay(LINE_PASTE_DELAY_MS)
      }
    }

    tracked.transcript.recordInput(text)
    this.touch(tracked)
  }

  async find(sessionId: string, pattern: string, regex?: boolean, includeScrollback?: boolean): Promise<FindResult[]> {
    this.getLiveSession(sessionId)
    const snapshot = await this.snapshot(sessionId, includeScrollback === true ? "full" : "viewport")
    const lines = snapshot.screen.split("\n")
    const results: FindResult[] = []
    const re = regex === true ? new RegExp(pattern, "gu") : undefined

    for (let row = 0; row < lines.length; row += 1) {
      const line = lines[row]

      if (regex === true && re !== undefined) {
        let match: RegExpExecArray | null
        while ((match = re.exec(line)) !== null) {
          results.push({ row, col: match.index, line, match: match[0] })
          if (match[0].length === 0) {
            re.lastIndex += 1
          }
        }
        re.lastIndex = 0
        continue
      }

      if (line.includes(pattern)) {
        const col = line.indexOf(pattern)
        results.push({ row, col, line, match: pattern })
      }
    }

    return results
  }

  async scroll(sessionId: string, direction: ScrollDirection, lines: number): Promise<void> {
    const tracked = this.getLiveSession(sessionId)
    const key = direction === "up" ? "Up" : "Down"
    await this.execTmux(["send-keys", "-t", tracked.tmuxId, "-N", Math.max(1, lines).toString(), key])
    this.touch(tracked)
  }

  async mouseClick(sessionId: string, input: MouseClickInput): Promise<void> {
    await this.ensureTmuxAvailable()
    const tracked = this.getLiveSession(sessionId)
    validateMouseCoords(input.col, input.row, tracked.cols, tracked.rows)

    const event: Omit<MouseClickEvent, "action"> = {
      col: input.col,
      row: input.row,
      button: input.button,
      shift: input.shift,
      alt: input.alt,
      ctrl: input.ctrl,
    }
    const sequence = mouseClickToTmuxSequence(event)
    await this.execTmux(["send-keys", "-t", tracked.tmuxId, "-l", sequence])
    tracked.transcript.recordInput(`<mouse:click:${input.button}@${input.col},${input.row}>`)
    this.touch(tracked)
  }

  async mouseScroll(sessionId: string, input: MouseScrollInput): Promise<void> {
    await this.ensureTmuxAvailable()
    const tracked = this.getLiveSession(sessionId)
    validateMouseCoords(input.col, input.row, tracked.cols, tracked.rows)

    const event: MouseScrollEvent = {
      col: input.col,
      row: input.row,
      direction: input.direction,
      shift: input.shift,
      alt: input.alt,
      ctrl: input.ctrl,
    }
    const sequence = mouseScrollToTmuxSequence(event)
    await this.execTmux(["send-keys", "-t", tracked.tmuxId, "-l", sequence])
    tracked.transcript.recordInput(`<mouse:scroll:${input.direction}@${input.col},${input.row}>`)
    this.touch(tracked)
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    const tracked = this.getLiveSession(sessionId)
    await this.execTmux(["resize-window", "-t", tracked.tmuxId, "-x", cols.toString(), "-y", rows.toString()])
    tracked.xtermAdapter.resize(cols, rows)
    tracked.cols = cols
    tracked.rows = rows
    tracked.transcript.recordResize(cols, rows)
    this.touch(tracked)
  }

  async rename(sessionId: string, label: string): Promise<void> {
    const tracked = this.getLiveSession(sessionId)
    const oldTmuxId = tracked.tmuxId
    await this.execTmux(["rename-session", "-t", oldTmuxId, label])
    // Map key 也需要随 tmuxId 更新
    this.sessions.delete(oldTmuxId)
    tracked.tmuxId = label
    tracked.session.providerSessionId = label
    tracked.session.label = label
    this.sessions.set(label, tracked)
    this.touch(tracked)
  }

  async kill(sessionId: string): Promise<void> {
    const tracked = this.assertSessionExists(sessionId)

    await safeCleanup([
      {
        name: "tmux.kill-session",
        fn: async () => {
          await this.execTmux(["kill-session", "-t", tracked.tmuxId])
        },
      },
      {
        name: "markKilled+recordExit",
        fn: () => {
          tracked.session.status = "killed"
          tracked.session.exitCode = null
          tracked.transcript.recordExit(null, "killed")
        },
      },
      {
        name: "xtermAdapter.dispose",
        fn: () => tracked.xtermAdapter.dispose(),
      },
      {
        name: "sessions.delete",
        fn: () => {
          this.sessions.delete(tracked.tmuxId)
        },
      },
    ], this.logger)
  }

  async exportTranscript(sessionId: string, options: ExportOptions): Promise<TranscriptExport> {
    const tracked = this.assertSessionExists(sessionId)
    const content = tracked.transcript.export(options.format, { redact: options.redact })

    return {
      format: options.format,
      content,
      snapshotCount: tracked.snapshotCount,
      eventCount: tracked.transcript.getEventCount(),
      redacted: options.redact,
    }
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  listActiveSessionIds(): string[] {
    return Array.from(this.sessions.keys())
  }

  async list(): Promise<TerminalSession[]> {
    await this.ensureTmuxAvailable()
    const trackedSessions = Array.from(this.sessions.values()).map((tracked) => tracked.session)
    const trackedTmuxIds = new Set(trackedSessions.map((session) => session.providerSessionId))
    const entries = await this.listTmuxSessions()
    const externalSessions = entries
      .filter((entry) => !trackedTmuxIds.has(entry.name))
      .map((entry) => this.createExternalListSession(entry))

    return [...trackedSessions, ...externalSessions]
  }

  private async execTmux(args: string[]): Promise<ExecTmuxResult> {
    return new Promise((resolve, reject) => {
      execFile(getTmuxBin(), args, { timeout: TMUX_EXEC_TIMEOUT_MS }, (error, stdout, stderr) => {
        if (error) {
          reject(error)
          return
        }

        resolve({ stdout: stdout ?? "", stderr: stderr ?? "" })
      })
    })
  }

  private async ensureTmuxAvailable(): Promise<void> {
    const available = await this.isAvailable()
    if (!available) {
      throw new DependencyMissingError("tmux", "Install tmux 3.2+ or set TERMINAL_USE_TMUX_PATH to a tmux-compatible binary (e.g. psmux on Windows)")
    }
  }

  private createTmuxSessionName(): string {
    return `tumcp_${randomBytes(4).toString("hex")}`
  }

  private assertSessionExists(sessionId: string): TmuxSession {
    const tracked = this.sessions.get(sessionId)
    if (tracked === undefined) throw new SessionNotFoundError(sessionId)
    return tracked
  }

  private getLiveSession(sessionId: string): TmuxSession {
    const tracked = this.assertSessionExists(sessionId)
    if (tracked.session.status === "exited" || tracked.session.status === "killed") {
      throw new ProcessExitedError(sessionId, tracked.session.exitCode ?? null)
    }
    return tracked
  }

  private findTrackedSession(sessionIdOrName: string): TmuxSession | undefined {
    const bySessionId = this.sessions.get(sessionIdOrName)
    if (bySessionId !== undefined) return bySessionId
    return Array.from(this.sessions.values()).find((tracked) => tracked.tmuxId === sessionIdOrName)
  }

  private touch(tracked: TmuxSession): void {
    tracked.session.lastActivityAt = new Date().toISOString()
  }

  private async readTitle(tmuxId: string): Promise<string> {
    const titleResult = await this.execTmux(["display-message", "-t", tmuxId, "-p", "#{session_name}"])
    return titleResult.stdout.trim()
  }

  private async readPaneHistoryLineCount(tmuxId: string): Promise<number | undefined> {
    const result = await this.execTmux(["display-message", "-t", tmuxId, "-p", "#{history_size}"])
    return parsePositiveInteger(result.stdout.trim())
  }

  private async readDimensions(tmuxId: string): Promise<{ cols: number; rows: number }> {
    const result = await this.execTmux(["display-message", "-t", tmuxId, "-p", "#{window_width} #{window_height}"])
    const parts = result.stdout.trim().split(" ")
    const cols = Number(parts[0] ?? 80)
    const rows = Number(parts[1] ?? 24)
    return {
      cols: Number.isFinite(cols) ? cols : 80,
      rows: Number.isFinite(rows) ? rows : 24,
    }
  }

  private async listTmuxSessions(): Promise<TmuxListEntry[]> {
    const format = ["#{session_name}", "#{session_created}", "#{window_width}", "#{window_height}"].join(LIST_SEPARATOR)

    try {
      const result = await this.execTmux(["list-sessions", "-F", format])
      return result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => this.parseListEntry(line))
    } catch {
      // tmux 无 session 时 list-sessions 返回非零；对 list 调用而言这是空列表。
      return []
    }
  }

  private parseListEntry(line: string): TmuxListEntry {
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

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms)
    })
  }

}

function parsePositiveInteger(value: string): number | undefined {
  if (!/^\d+$/u.test(value)) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function buildTmuxEnvironmentArgs(env?: Record<string, string>): string[] {
  if (env === undefined) return []
  return Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`])
}

type TmuxVersion = {
  major: number
  minor: number
}

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
