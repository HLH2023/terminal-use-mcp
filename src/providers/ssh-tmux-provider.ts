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
import type { Logger } from "../logger.js"
import type { SshHostProfile } from "../targets/target-types.js"
import type { ResolvedSshTarget } from "../targets/ssh-profile-loader.js"
import type { SystemSshCommandResult, SystemSshTransport } from "./system-ssh-transport.js"
import { XtermAdapter } from "../terminal/xterm-adapter.js"
import { safeCleanup } from "../terminal/safe-cleanup.js"
import { parsedKeyToTmuxKey } from "../terminal/keymap.js"
import {
  mouseClickToTmuxSequence,
  mouseScrollToTmuxSequence,
  validateMouseCoords,
} from "../terminal/mouse.js"
import type { MouseClickEvent, MouseScrollEvent } from "../terminal/mouse.js"
import { createSnapshot } from "../terminal/terminal-snapshot.js"
import { detectRiskSignals } from "../terminal/confirm-detection.js"
import { calculatePollDelay, checkScreenStable, checkTextMatch, hashScreen } from "../terminal/wait.js"
import type { ScreenState } from "../terminal/wait.js"
import { TranscriptRecorder } from "../terminal/transcript.js"
import { generateSessionId } from "../terminal/ids.js"
import { createRemoteCwdPolicy, assertRemoteCwdAllowed } from "../targets/remote-cwd-policy.js"
import { remoteCapabilityCache, type RemoteCapabilities, type RemoteCapabilityCache } from "../targets/remote-capability-cache.js"
import { expandUserPath, loadHostsConfig } from "../targets/ssh-host-config.js"
import { resolveSshTarget } from "../targets/ssh-profile-loader.js"
import {
  DependencyMissingError,
  ProcessExitedError,
  RemoteCommandDeniedError,
  RemoteTmuxNotAvailableError,
  SessionNotFoundError,
  SessionTimeoutError,
  TerminalUseError,
} from "../terminal/errors.js"
import { execRemote, execSshCommand, isSystemSshAvailable } from "./system-ssh-transport.js"

const SSH_TMUX_EXEC_TIMEOUT_MS = 10_000
const DEFAULT_TTL_MS = 60 * 60 * 1000
const LINE_PASTE_DELAY_MS = 5
const LIST_SEPARATOR = "\t"
const MAX_SAFE_SESSION_NAME_LENGTH = 80

const SSH_TMUX_CAPABILITIES: ProviderCapabilities = {
  provider: "ssh-tmux",
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

// ⚡ 架构要点：远程 tmux session 的 cell 级属性通过 capture-pane -e 获取 ANSI SGR 序列，
// 然后用 xterm-headless 解析回 cell buffer，实现 highlights / find / fullscreen 检测。
// 与 ssh-pty 的区别：ssh-pty 实时流式写入 xterm，ssh-tmux 是快照式全量解析。

export type ExecSshTmuxOptions = {
  timeoutMs?: number
}

export type SshTmuxCommandExecutor = (
  profile: ResolvedSshTarget,
  args: readonly string[],
  options?: ExecSshTmuxOptions,
) => Promise<SystemSshCommandResult>

export type SshTmuxProviderOptions = {
  hostsConfig?: ReadonlyMap<string, SshHostProfile>
  hostsConfigPath?: string
  commandExecutor?: SshTmuxCommandExecutor
  sshAvailabilityChecker?: () => Promise<boolean>
  capabilityCache?: RemoteCapabilityCache
}

type SshTmuxSession = {
  session: TerminalSession
  target: ResolvedSshTarget
  targetKey: string
  tmuxId: string
  tmuxPath: string
  rows: number
  cols: number
  xtermAdapter: XtermAdapter
  transcript: TranscriptRecorder
  lastScreenHash?: string
  lastWriteAt: number
  snapshotCount: number
}

export type SshTmuxListEntry = {
  name: string
  createdAt: string
  cols: number
  rows: number
}

/** 安全的 SSH 远程 tmux 命令执行入口；底层统一走系统 ssh + execFile 参数数组。 */
export async function execSshTmux(
  profile: ResolvedSshTarget,
  args: readonly string[],
  options?: ExecSshTmuxOptions,
): Promise<SystemSshCommandResult> {
  const keyFile = profile.auth.type === "key-file" ? expandUserPath(profile.auth.path) : undefined
  return execSshCommand(profile, args, {
    keyFile,
    connectTimeoutMs: profile.connectTimeoutMs,
    execTimeoutMs: options?.timeoutMs ?? SSH_TMUX_EXEC_TIMEOUT_MS,
  })
}

/** 生成远程 tmux session 名；rtumcp_ 前缀用于和本地 tumcp_ 区分。 */
export function createSshTmuxSessionName(): string {
  return `rtumcp_${randomBytes(4).toString("hex")}`
}

/** 把用户可见 label 收敛成 tmux target 安全字符集，避免冒号/空白/控制符污染 target 语义。 */
export function sanitizeTmuxSessionName(input: string): string {
  const normalized = input
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")

  if (normalized.length === 0) return createSshTmuxSessionName()
  const safeHead = /^[A-Za-z0-9]/.test(normalized) ? normalized : `s_${normalized}`
  return safeHead.slice(0, MAX_SAFE_SESSION_NAME_LENGTH)
}

/** 解析 tmux list-sessions 的制表符分隔输出，供 list() 和单元测试复用。 */
export function parseTmuxListSessionsOutput(stdout: string): SshTmuxListEntry[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseTmuxListEntry)
}

export class SshTmuxProvider implements TerminalProvider {
  readonly name: ProviderName = "ssh-tmux"
  readonly capabilities: ProviderCapabilities = SSH_TMUX_CAPABILITIES

  private readonly sessions: Map<string, SshTmuxSession>
  private readonly logger: Logger
  private readonly injectedHostsConfig?: ReadonlyMap<string, SshHostProfile>
  private readonly hostsConfigPath?: string
  private readonly commandExecutor: SshTmuxCommandExecutor
  private readonly sshAvailabilityChecker: () => Promise<boolean>
  private readonly capabilityCache: RemoteCapabilityCache
  private sshAvailable: boolean | undefined

  constructor(logger: Logger, options: SshTmuxProviderOptions = {}) {
    this.sessions = new Map()
    this.logger = logger
    this.injectedHostsConfig = options.hostsConfig
    this.hostsConfigPath = options.hostsConfigPath
    this.commandExecutor = options.commandExecutor ?? execSshTmux
    this.sshAvailabilityChecker = options.sshAvailabilityChecker ?? isSystemSshAvailable
    this.capabilityCache = options.capabilityCache ?? remoteCapabilityCache
    this.sshAvailable = undefined
  }

  async isAvailable(): Promise<boolean> {
    if (this.sshAvailable !== undefined) return this.sshAvailable
    this.sshAvailable = await this.sshAvailabilityChecker()
    return this.sshAvailable
  }

  async start(input: StartInput): Promise<TerminalSession> {
    await this.ensureSystemSshAvailable()

    const target = await this.resolveSshTmuxTarget(input)
    const caps = await this.discoverCapabilities(target)
    const tmuxPath = ensureRemoteTmuxUsable(this.name, target, caps)
    const remoteCwd = assertRemoteCwdAllowed(createRemoteCwdPolicy(target), input.cwd)
    const sessionId = generateSessionId()
    const tmuxId = createSshTmuxSessionName()
    const now = new Date().toISOString()
    const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS
    const mergedEnv = mergeRemoteEnv(target.env, input.env)
    const xtermAdapter = new XtermAdapter(input.cols, input.rows)
    const loginInteractiveCommand = buildLoginInteractiveShellCommand(input.command, input.args, caps)
    const envArgs = buildTmuxEnvironmentArgs(mergedEnv)

    let started = false
    try {
      await this.execRemoteTmux(target, tmuxPath, [
        "new-session",
        "-d",
        "-s",
        tmuxId,
        "-x",
        input.cols.toString(),
        "-y",
        input.rows.toString(),
        "-c",
        remoteCwd,
        ...envArgs,
        "--",
        loginInteractiveCommand,
      ], "start", sessionId)
      // 远程 tmux 默认可能未开启 mouse mode（与本地不同，无法假设用户配置），
      // 必须 session 级开启以确保 mouse_scroll/mouse_click 序列正确转发。
      await this.execRemoteTmux(target, tmuxPath, ["set-option", "-t", tmuxId, "mouse", "on"], "set-mouse-on", sessionId)
      started = true
    } finally {
      if (!started) {
        // 远程 start 任一步骤失败时 session 尚未登记；本地 adapter 必须同步释放。
        xtermAdapter.dispose()
      }
    }

    const session: TerminalSession = {
      sessionId,
      providerName: this.name,
      providerSessionId: tmuxId,
      command: input.command,
      args: input.args,
      cwd: remoteCwd,
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
      target,
      targetKey: targetKey(target),
      tmuxId,
      tmuxPath,
      rows: input.rows,
      cols: input.cols,
      xtermAdapter,
      transcript: new TranscriptRecorder(sessionId),
      lastWriteAt: Date.now(),
      snapshotCount: 0,
    })

    this.logger.info("ssh-tmux session started", {
      sessionId,
      tmuxId,
      profile: target.profile ?? target.name,
      tmuxPath,
    })
    return session
  }

  async attach(sessionIdOrName: string): Promise<TerminalSession> {
    await this.ensureSystemSshAvailable()

    const existing = this.findTrackedSession(sessionIdOrName)
    if (existing !== undefined) return existing.session

    const attachTarget = await this.resolveAttachTarget(sessionIdOrName)
    const caps = await this.discoverCapabilities(attachTarget.target)
    const tmuxPath = ensureRemoteTmuxUsable(this.name, attachTarget.target, caps)
    // 远程 attach 的 session 可能在非 mouse mode 下创建，确保开启。
    await this.execRemoteTmux(attachTarget.target, tmuxPath, ["set-option", "-t", attachTarget.tmuxId, "mouse", "on"], "set-mouse-on", sessionIdOrName)
    const dimensions = await this.readDimensionsForTarget(attachTarget.target, tmuxPath, attachTarget.tmuxId, sessionIdOrName)
    const title = await this.readTitleForTarget(attachTarget.target, tmuxPath, attachTarget.tmuxId, sessionIdOrName)
    const sessionId = generateSessionId()
    const now = new Date().toISOString()
    const cwd = attachTarget.target.defaultCwd ?? "/"
    const xtermAdapter = new XtermAdapter(dimensions.cols, dimensions.rows)

    const session: TerminalSession = {
      sessionId,
      providerName: this.name,
      providerSessionId: attachTarget.tmuxId,
      command: "ssh-tmux-attach",
      args: [attachTarget.target.profile ?? attachTarget.target.name, attachTarget.tmuxId],
      cwd,
      label: title,
      status: "running",
      exitCode: null,
      createdAt: now,
      lastActivityAt: now,
      ttlMs: DEFAULT_TTL_MS,
      capabilities: this.capabilities,
    }

    // Map key = tmuxId (providerSessionId)
    this.sessions.set(attachTarget.tmuxId, {
      session,
      target: attachTarget.target,
      targetKey: targetKey(attachTarget.target),
      tmuxId: attachTarget.tmuxId,
      tmuxPath,
      rows: dimensions.rows,
      cols: dimensions.cols,
      xtermAdapter,
      transcript: new TranscriptRecorder(sessionId),
      lastWriteAt: Date.now(),
      snapshotCount: 0,
    })

    this.logger.info("ssh-tmux session attached", {
      sessionId,
      tmuxId: attachTarget.tmuxId,
      profile: attachTarget.target.profile ?? attachTarget.target.name,
      tmuxPath,
    })
    return session
  }

  async snapshot(sessionId: string, mode?: TerminalSnapshotMode): Promise<TerminalSnapshot> {
    const tracked = this.getLiveSession(sessionId)
    const screenMode = mode ?? "viewport"
    // viewport 模式只取当前可见屏幕（不带 -S），full 模式取完整 scrollback。
    // 带了 -S 时 capture-pane 返回的行数超过终端行数，写入 xterm 后会滚出视口。
    const captureArgs: string[] = [
      "capture-pane",
      "-t",
      tracked.tmuxId,
      "-p",
      "-e",
    ]
    if (screenMode === "full") {
      captureArgs.push("-S", "-5000")
    }
    const captureResult = await this.execRemoteTmux(tracked.target, tracked.tmuxPath, captureArgs, "snapshot", sessionId)
    const captureOutput = captureResult.stdout
    // capture-pane 每次返回完整快照；重建 adapter 可避免重复写入导致 full buffer 累积旧快照。
    tracked.xtermAdapter.dispose()
    tracked.xtermAdapter = new XtermAdapter(tracked.cols, tracked.rows)
    // capture-pane -e 输出仅有 \n（Unix 换行），但 xterm-headless 把 \n 视为仅换行不回车（LF without CR），
    // 会导致内容错位。PTY 输出是 \r\n，这里必须补齐 \r。
    // 末尾换行会导致 xterm 滚屏，必须剥除。
    const trimmed = captureOutput.replace(/\r?\n+$/, "")
    const eolFixed = trimmed.replace(/(?<!\r)\n/g, "\r\n")
    await tracked.xtermAdapter.write(eolFixed)
    const screenResult = tracked.xtermAdapter.readScreen(screenMode)
    const paneHistoryLineCount = screenMode === "viewport"
      ? await this.readPaneHistoryLineCount(tracked, sessionId)
      : undefined
    const screen = screenResult.lines.map((line) => line.text).join("\n")
    const highlights: Highlight[] = tracked.xtermAdapter.detectHighlights(screenMode)
    const title = await this.readTitle(tracked, sessionId)
    const currentHash = hashScreen(screen)
    const changed = tracked.lastScreenHash === undefined ? true : tracked.lastScreenHash !== currentHash

    if (changed) {
      tracked.lastWriteAt = Date.now()
      tracked.lastScreenHash = currentHash
    }

    const snapshot = createSnapshot({
      sessionId: tracked.session.sessionId,
      screen,
      cursor: screenResult.cursor,
      cols: screenResult.cols,
      rows: screenResult.rows,
      scrollbackLineCount: paneHistoryLineCount ?? screenResult.scrollbackLineCount,
      status: tracked.session.status,
      changed,
      exitCode: tracked.session.exitCode ?? null,
      title,
      isFullscreen: screenResult.isAltBuffer,
      highlights,
      riskSignals: detectRiskSignals(screen),
    })

    tracked.snapshotCount += 1
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

    throw new SessionTimeoutError(sessionId, options.timeoutMs, `等待远程文本超时: ${text}`)
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
      const currentState: ScreenState = {
        screen: snapshot.screen,
        screenHash: hashScreen(snapshot.screen),
        lastWriteAt: tracked.lastWriteAt,
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
      lastSnapshot === null ? "等待远程稳定超时，且未取得快照" : "等待远程屏幕稳定超时",
    )
  }

  async type(sessionId: string, text: string): Promise<void> {
    const tracked = this.getLiveSession(sessionId)
    await this.execRemoteTmux(tracked.target, tracked.tmuxPath, ["send-keys", "-t", tracked.tmuxId, "-l", text], "type", sessionId)
    tracked.transcript.recordInput(text)
    this.touch(tracked)
  }

  async press(sessionId: string, keyExpr: string, parsed: ParsedKeyExpr): Promise<void> {
    const tracked = this.getLiveSession(sessionId)
    const tmuxKey = parsedKeyToTmuxKey(parsed)
    await this.execRemoteTmux(tracked.target, tracked.tmuxPath, ["send-keys", "-t", tracked.tmuxId, tmuxKey], "press", sessionId)
    tracked.transcript.recordInput(`[key:${keyExpr}]`)
    this.touch(tracked)
  }

  async paste(sessionId: string, text: string, mode?: "bracketed" | "line-by-line" | "raw"): Promise<void> {
    const tracked = this.getLiveSession(sessionId)
    const effectiveMode = mode ?? "line-by-line"

    if (effectiveMode === "raw") {
      await this.execRemoteTmux(tracked.target, tracked.tmuxPath, ["send-keys", "-t", tracked.tmuxId, "-l", text], "paste", sessionId)
      tracked.transcript.recordInput(text)
      this.touch(tracked)
      return
    }

    const lines = text.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (line.length > 0) {
        await this.execRemoteTmux(tracked.target, tracked.tmuxPath, ["send-keys", "-t", tracked.tmuxId, "-l", line], "paste", sessionId)
      }
      if (index < lines.length - 1) {
        await this.execRemoteTmux(tracked.target, tracked.tmuxPath, ["send-keys", "-t", tracked.tmuxId, "Enter"], "paste-enter", sessionId)
        await this.delay(LINE_PASTE_DELAY_MS)
      }
    }

    tracked.transcript.recordInput(text)
    this.touch(tracked)
  }

  async find(sessionId: string, pattern: string, regex?: boolean, includeScrollback?: boolean): Promise<FindResult[]> {
    const session = this.getLiveSession(sessionId)
    const snapshot = await this.snapshot(session.tmuxId)
    const lines = snapshot.screen.split("\n")
    const results: FindResult[] = []
    const re = regex ? new RegExp(pattern, "gu") : undefined

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
      } else if (line.includes(pattern)) {
        const col = line.indexOf(pattern)
        results.push({ row, col, line, match: pattern })
      }
    }

    if (includeScrollback === true) {
      this.logger.debug("ssh-tmux find includeScrollback handled by current captured screen", { sessionId })
    }

    return results
  }

  async scroll(sessionId: string, direction: ScrollDirection, lines: number): Promise<void> {
    const tracked = this.getLiveSession(sessionId)
    const key = direction === "up" ? "Up" : "Down"
    await this.execRemoteTmux(tracked.target, tracked.tmuxPath, ["send-keys", "-t", tracked.tmuxId, "-N", Math.max(1, lines).toString(), key], "scroll", sessionId)
    this.touch(tracked)
  }

  async mouseClick(sessionId: string, input: MouseClickInput): Promise<void> {
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
    // send-keys -l 逐字面发送原始序列; tmux 会把序列转发到 pane 内 TUI
    await this.execRemoteTmux(tracked.target, tracked.tmuxPath, ["send-keys", "-t", tracked.tmuxId, "-l", sequence], "mouse-click", sessionId)
    tracked.transcript.recordInput(`<mouse:click:${input.button}@${input.col},${input.row}>`)
    this.touch(tracked)
  }

  async mouseScroll(sessionId: string, input: MouseScrollInput): Promise<void> {
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
    await this.execRemoteTmux(tracked.target, tracked.tmuxPath, ["send-keys", "-t", tracked.tmuxId, "-l", sequence], "mouse-scroll", sessionId)
    tracked.transcript.recordInput(`<mouse:scroll:${input.direction}@${input.col},${input.row}>`)
    this.touch(tracked)
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    const tracked = this.getLiveSession(sessionId)
    await this.execRemoteTmux(tracked.target, tracked.tmuxPath, ["resize-window", "-t", tracked.tmuxId, "-x", cols.toString(), "-y", rows.toString()], "resize", sessionId)
    tracked.xtermAdapter.resize(cols, rows)
    tracked.cols = cols
    tracked.rows = rows
    tracked.transcript.recordResize(cols, rows)
    this.touch(tracked)
  }

  async rename(sessionId: string, label: string): Promise<void> {
    const tracked = this.getLiveSession(sessionId)
    const safeLabel = sanitizeTmuxSessionName(label)
    await this.execRemoteTmux(tracked.target, tracked.tmuxPath, ["rename-session", "-t", tracked.tmuxId, safeLabel], "rename", sessionId)
    // Map key 也需要随 tmuxId 更新
    this.sessions.delete(tracked.tmuxId)
    tracked.tmuxId = safeLabel
    tracked.session.providerSessionId = safeLabel
    tracked.session.label = safeLabel
    this.sessions.set(safeLabel, tracked)
    this.touch(tracked)
  }

  async kill(sessionId: string): Promise<void> {
    const tracked = this.assertSessionExists(sessionId)

    await safeCleanup([
      {
        name: "remote.kill-session",
        fn: async () => {
          await this.execRemoteTmux(tracked.target, tracked.tmuxPath, ["kill-session", "-t", tracked.tmuxId], "kill", sessionId)
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

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  listActiveSessionIds(): string[] {
    return Array.from(this.sessions.keys())
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

  async list(): Promise<TerminalSession[]> {
    await this.ensureSystemSshAvailable()
    const trackedSessions = Array.from(this.sessions.values()).map((tracked) => tracked.session)
    const targetEntries = this.uniqueTrackedTargets()
    const externalSessions: TerminalSession[] = []

    for (const entry of targetEntries) {
      try {
        const remoteEntries = await this.listTmuxSessionsForTarget(entry.target, entry.tmuxPath)
        const trackedTmuxIds = new Set(
          Array.from(this.sessions.values())
            .filter((tracked) => tracked.targetKey === entry.key)
            .map((tracked) => tracked.tmuxId),
        )
        externalSessions.push(...remoteEntries
          .filter((remoteEntry) => !trackedTmuxIds.has(remoteEntry.name))
          .map((remoteEntry) => this.createExternalListSession(entry.target, remoteEntry)))
      } catch (error) {
        this.logger.warn("ssh-tmux list-sessions failed for tracked target", {
          profile: entry.target.profile ?? entry.target.name,
          error: this.errorMessage(error),
        })
      }
    }

    return [...trackedSessions, ...externalSessions]
  }

  private async resolveSshTmuxTarget(input: StartInput): Promise<ResolvedSshTarget> {
    const target = input.target ?? { kind: "local" }
    const hostsConfig = await this.loadHostProfiles()
    const resolved = resolveSshTarget(target, hostsConfig)
    if (resolved.kind !== "ssh") {
      throw new RemoteCommandDeniedError(input.command, "ssh-tmux only supports target.kind=ssh")
    }
    if (resolved.allowTmux === false) {
      throw new RemoteTmuxNotAvailableError(resolved.profile ?? resolved.name)
    }
    return resolved
  }

  private async resolveAttachTarget(sessionIdOrName: string): Promise<{ target: ResolvedSshTarget; tmuxId: string }> {
    const parsed = parseAttachTarget(sessionIdOrName)
    if (parsed === undefined) {
      throw new RemoteCommandDeniedError("ssh-tmux attach", "Use profile:tmuxSessionName or ssh-tmux://profile/tmuxSessionName")
    }

    const hostsConfig = await this.loadHostProfiles()
    const resolved = resolveSshTarget({ kind: "ssh", profile: parsed.profile }, hostsConfig)
    if (resolved.kind !== "ssh") {
      throw new RemoteCommandDeniedError("ssh-tmux attach", "Resolved attach target is not SSH")
    }
    if (resolved.allowTmux === false) {
      throw new RemoteTmuxNotAvailableError(resolved.profile ?? resolved.name)
    }
    return { target: resolved, tmuxId: parsed.tmuxId }
  }

  private async loadHostProfiles(): Promise<ReadonlyMap<string, SshHostProfile>> {
    if (this.injectedHostsConfig !== undefined) return this.injectedHostsConfig
    return loadHostsConfig(this.hostsConfigPath)
  }

  private async ensureSystemSshAvailable(): Promise<void> {
    const available = await this.isAvailable()
    if (!available) {
      throw new DependencyMissingError("ssh", "Install OpenSSH client and ensure ssh is available on PATH")
    }
  }

  private async discoverCapabilities(target: ResolvedSshTarget): Promise<RemoteCapabilities> {
    const profileName = target.profile ?? target.name
    const capabilities = await this.capabilityCache.probeViaTransport(createCapabilityTransport(target), profileName)
    this.logger.info("Remote capabilities", { profile: profileName, caps: capabilities })
    return capabilities
  }

  private async execRemoteTmux(
    target: ResolvedSshTarget,
    tmuxPath: string,
    args: readonly string[],
    action: string,
    sessionId?: string,
  ): Promise<SystemSshCommandResult> {
    const result = await this.commandExecutor(target, [tmuxPath, ...args], { timeoutMs: SSH_TMUX_EXEC_TIMEOUT_MS })
    if (result.exitCode === 0) return result
    throw this.toRemoteTmuxError(target, result, action, sessionId)
  }

  private toRemoteTmuxError(
    target: ResolvedSshTarget,
    result: SystemSshCommandResult,
    action: string,
    sessionId?: string,
  ): TerminalUseError {
    const output = `${result.stderr}\n${result.stdout}`.trim()
    if (isRemoteTmuxMissing(output)) {
      return new RemoteTmuxNotAvailableError(target.profile ?? target.name)
    }
    if (isRemoteSessionMissing(output)) {
      return new SessionNotFoundError(sessionId ?? `${target.profile ?? target.name}:${action}`)
    }
    return new TerminalUseError({
      code: "INTERNAL_ERROR",
      message: `Remote tmux command failed during ${action}`,
      provider: this.name,
      sessionId,
      retryable: false,
      details: { exitCode: result.exitCode, stderr: result.stderr, stdout: result.stdout },
    })
  }

  private assertSessionExists(sessionId: string): SshTmuxSession {
    const tracked = this.sessions.get(sessionId)
    if (tracked === undefined) throw new SessionNotFoundError(sessionId)
    return tracked
  }

  private getLiveSession(sessionId: string): SshTmuxSession {
    const tracked = this.assertSessionExists(sessionId)
    if (tracked.session.status === "exited" || tracked.session.status === "killed") {
      throw new ProcessExitedError(sessionId, tracked.session.exitCode ?? null)
    }
    return tracked
  }

  private findTrackedSession(sessionIdOrName: string): SshTmuxSession | undefined {
    const bySessionId = this.sessions.get(sessionIdOrName)
    if (bySessionId !== undefined) return bySessionId
    return Array.from(this.sessions.values()).find((tracked) => tracked.tmuxId === sessionIdOrName)
  }

  private touch(tracked: SshTmuxSession): void {
    tracked.session.lastActivityAt = new Date().toISOString()
  }

  private async readTitle(tracked: SshTmuxSession, sessionId: string): Promise<string> {
    const titleResult = await this.execRemoteTmux(tracked.target, tracked.tmuxPath, ["display-message", "-t", tracked.tmuxId, "-p", "#{session_name}"], "title", sessionId)
    return titleResult.stdout.trim()
  }

  private async readPaneHistoryLineCount(tracked: SshTmuxSession, sessionId: string): Promise<number | undefined> {
    const result = await this.execRemoteTmux(tracked.target, tracked.tmuxPath, ["display-message", "-t", tracked.tmuxId, "-p", "#{history_size}"], "history-size", sessionId)
    return parsePositiveInteger(result.stdout.trim())
  }

  private async readDimensionsForTarget(target: ResolvedSshTarget, tmuxPath: string, tmuxId: string, sessionId: string): Promise<{ cols: number; rows: number }> {
    const result = await this.execRemoteTmux(target, tmuxPath, ["display-message", "-t", tmuxId, "-p", "#{window_width} #{window_height}"], "dimensions", sessionId)
    return parseDimensions(result.stdout)
  }

  private async readTitleForTarget(target: ResolvedSshTarget, tmuxPath: string, tmuxId: string, sessionId: string): Promise<string> {
    const titleResult = await this.execRemoteTmux(target, tmuxPath, ["display-message", "-t", tmuxId, "-p", "#{session_name}"], "title", sessionId)
    return titleResult.stdout.trim()
  }

  private async listTmuxSessionsForTarget(target: ResolvedSshTarget, tmuxPath: string): Promise<SshTmuxListEntry[]> {
    const format = ["#{session_name}", "#{session_created}", "#{window_width}", "#{window_height}"].join(LIST_SEPARATOR)
    const result = await this.commandExecutor(target, [tmuxPath, "list-sessions", "-F", format], { timeoutMs: SSH_TMUX_EXEC_TIMEOUT_MS })
    if (result.exitCode !== 0) {
      const output = `${result.stderr}\n${result.stdout}`.trim()
      if (isRemoteSessionMissing(output)) return []
      throw this.toRemoteTmuxError(target, result, "list")
    }
    return parseTmuxListSessionsOutput(result.stdout)
  }

  private uniqueTrackedTargets(): Array<{ key: string; target: ResolvedSshTarget; tmuxPath: string }> {
    const result = new Map<string, { target: ResolvedSshTarget; tmuxPath: string }>()
    for (const tracked of this.sessions.values()) {
      if (!result.has(tracked.targetKey)) result.set(tracked.targetKey, { target: tracked.target, tmuxPath: tracked.tmuxPath })
    }
    return Array.from(result.entries()).map(([key, value]) => ({ key, target: value.target, tmuxPath: value.tmuxPath }))
  }

  private createExternalListSession(target: ResolvedSshTarget, entry: SshTmuxListEntry): TerminalSession {
    const key = targetKey(target)
    return {
      sessionId: `external:ssh-tmux:${key}:${entry.name}`,
      providerName: this.name,
      providerSessionId: entry.name,
      command: "ssh-tmux-external",
      args: [key, entry.name],
      cwd: target.defaultCwd ?? "/",
      label: `${key}:${entry.name}`,
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

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}

function parseDimensions(stdout: string): { cols: number; rows: number } {
  const parts = stdout.trim().split(" ")
  const cols = Number(parts[0] ?? 80)
  const rows = Number(parts[1] ?? 24)
  return {
    cols: Number.isFinite(cols) ? cols : 80,
    rows: Number.isFinite(rows) ? rows : 24,
  }
}

function parsePositiveInteger(value: string): number | undefined {
  if (!/^\d+$/u.test(value)) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function buildLoginInteractiveShellCommand(command: string, args: string[], capabilities: Pick<RemoteCapabilities, "os" | "shell">): string {
  if (isWindowsRemoteOs(capabilities.os)) {
    return `${quoteWindowsPath(capabilities.shell)} /c ${windowsCmdQuote([command, ...args].map(windowsCmdQuote).join(" "))}`
  }
  return `exec ${shellQuote(capabilities.shell)} -l -ic ${shellQuote(buildShellExecCommand(command, args))}`
}

function quoteWindowsPath(path: string): string {
  return path.includes(" ") ? `"${path}"` : path
}

function buildShellExecCommand(command: string, args: string[]): string {
  return `exec ${[command, ...args].map(shellQuote).join(" ")}`
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`
}

function parseTmuxListEntry(line: string): SshTmuxListEntry {
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

function mergeRemoteEnv(profileEnv: Record<string, string> | undefined, inputEnv: Record<string, string> | undefined): Record<string, string> | undefined {
  if (profileEnv === undefined && inputEnv === undefined) return undefined
  return { ...(profileEnv ?? {}), ...(inputEnv ?? {}) }
}

function buildTmuxEnvironmentArgs(env: Record<string, string> | undefined): string[] {
  if (env === undefined) return []
  return Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`])
}

function targetKey(target: ResolvedSshTarget): string {
  return target.profile ?? target.name
}

function createCapabilityTransport(target: ResolvedSshTarget): SystemSshTransport {
  const keyFile = target.auth.type === "key-file" ? expandUserPath(target.auth.path) : undefined
  return {
    execRemote: async (command, timeoutMs) => {
      const result = await execRemote(target, command, {
        keyFile,
        connectTimeoutMs: target.connectTimeoutMs,
        execTimeoutMs: timeoutMs ?? SSH_TMUX_EXEC_TIMEOUT_MS,
      })
      return { stdout: result.stdout, stderr: result.stderr }
    },
  }
}

function ensureRemoteTmuxUsable(provider: ProviderName, target: ResolvedSshTarget, capabilities: RemoteCapabilities): string {
  const profileName = target.profile ?? target.name
  if (capabilities.tmuxPath === null) {
    throw new TerminalUseError({
      code: "REMOTE_TMUX_NOT_AVAILABLE",
      message: `tmux is not installed on remote host ${profileName}`,
      provider,
      retryable: false,
      hint: "Install tmux on the remote host or use ssh-pty",
      details: { profile: profileName, capabilities },
    })
  }
  if (capabilities.tmuxVersion === null || !isSupportedTmuxVersion(capabilities.tmuxVersion)) {
    throw new TerminalUseError({
      code: "REMOTE_TMUX_NOT_AVAILABLE",
      message: `Remote tmux version ${capabilities.tmuxVersion ?? "unknown"} on ${profileName} is not supported; require parseable tmux >= 3.2`,
      provider,
      retryable: false,
      hint: "Upgrade tmux on the remote host to 3.2 or newer and ensure tmux -V returns a parseable version",
      details: { profile: profileName, required: "3.2", actual: capabilities.tmuxVersion, capabilities },
    })
  }
  return capabilities.tmuxPath
}

function isSupportedTmuxVersion(version: string): boolean {
  const parsed = /^tmux\s+(\d+)\.(\d+)/u.exec(version)
  if (parsed === null) return false
  const major = Number(parsed[1])
  const minor = Number(parsed[2])
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return false
  return major > 3 || (major === 3 && minor >= 2)
}

function isWindowsRemoteOs(os: string): boolean {
  return /^(Windows|Windows_NT)/iu.test(os) || /(?:MINGW|MSYS|CYGWIN)/iu.test(os)
}

function windowsCmdQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./\\-]+$/u.test(value)) return value
  return `"${value.replace(/["^&|<>%]/gu, (char) => `^${char}`)}"`
}

function parseAttachTarget(value: string): { profile: string; tmuxId: string } | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined

  if (trimmed.startsWith("ssh-tmux://")) {
    const rest = trimmed.slice("ssh-tmux://".length)
    const slashIndex = rest.indexOf("/")
    if (slashIndex <= 0 || slashIndex === rest.length - 1) return undefined
    return { profile: rest.slice(0, slashIndex), tmuxId: rest.slice(slashIndex + 1) }
  }

  const colonIndex = trimmed.indexOf(":")
  if (colonIndex <= 0 || colonIndex === trimmed.length - 1) return undefined
  return { profile: trimmed.slice(0, colonIndex), tmuxId: trimmed.slice(colonIndex + 1) }
}

function isRemoteTmuxMissing(output: string): boolean {
  return /tmux: command not found|command not found: tmux|no such file or directory.*tmux|tmux not found/i.test(output)
}

function isRemoteSessionMissing(output: string): boolean {
  return /can't find session|no server running|no such session|session not found/i.test(output)
}
