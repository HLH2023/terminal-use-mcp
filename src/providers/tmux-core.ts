/**
 * TmuxCore — tmux 三通道架构共用核心
 *
 * 本地 TmuxProvider 和远程 SshTmuxProvider 委托给 TmuxCore，
 * 仅通过不同的 TmuxTransport 实现来区分本地/远程。
 *
 * 三通道架构：
 * - Render Channel: node-pty + tmux attach 的实时渲染流 → XtermAdapter
 * - Control Channel: tmux -C control mode 的命令执行和事件订阅
 * - CLI Fallback: execFile tmux 用于探测和兼容
 *
 * 核心原则：
 * - Render is passive: render channel 只负责产生屏幕渲染，不接受用户输入
 * - Control is authoritative: 所有输入和管理命令通过 control channel
 * - Agent commands are parsed: tmux_command 走 parse → authorize → compile → execute
 */

import { randomBytes } from "node:crypto"

import type { TmuxTransport, RenderChannelOpts, RenderSpawnResult } from "./tmux-transport.js"
import { TmuxControlChannel } from "./tmux-control-channel.js"
import type { TmuxControlNotification, TmuxControlResponse } from "./tmux-control-channel.js"
import type { Logger } from "../logger.js"
import type { ProviderName, StartInput, MouseClickInput, MouseScrollInput, ScrollDirection, WaitOptions, WaitStableOptions, ExportOptions, TranscriptExport, FindResult } from "./provider.js"
import { detectRiskSignals } from "../terminal/confirm-detection.js"
import {
  DependencyMissingError,
  LargePasteRefusedError,
  ProcessExitedError,
  ProviderNotAvailableError,
  SecretDetectedError,
  SessionNotFoundError,
  SessionTimeoutError,
  TmuxCommandDeniedError,
  TmuxCommandParseError,
  TmuxControlError,
  TmuxSessionDetachedError,
} from "../terminal/errors.js"
import { generateSessionId } from "../terminal/ids.js"
import type { ParsedKeyExpr } from "../terminal/keymap.js"
import { parsedKeyToTmuxKey } from "../terminal/keymap.js"
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
import { validateRegexSafety, createSafeRegex, isCommandSafeArgv } from "../terminal/command-safety.js"
import { XtermAdapter } from "../terminal/xterm-adapter.js"
import { safeCleanup } from "../terminal/safe-cleanup.js"
import { parseTmuxCommand } from "../terminal/tmux-command-parser.js"
import type { TmuxCommandParseResult } from "../terminal/tmux-command-parser.js"
import { authorizeAndCompile } from "../terminal/tmux-command-switch.js"
import type { AuthorizationResult, AuthorizationContext } from "../terminal/tmux-command-switch.js"
import type { TerminalUseConfig } from "../config.js"

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 60 * 60 * 1000
const LINE_BY_LINE_PASTE_DELAY_MS = 10
const PASTE_SOFT_LIMIT = 2_000
const PASTE_HARD_LIMIT = 10_000

/** tmux session name 前缀（标识 agent-owned session） */
const TMUX_SESSION_PREFIX = "tumcp_"

/** 输入后等待渲染收敛的默认超时（ms） */
const WAIT_RENDER_AFTER_INPUT_MS = 200

/** 初始渲染稳定等待超时（ms） */
const INITIAL_RENDER_STABLE_MS = 3_000

// ─── node-pty 类型 ────────────────────────────────────────────────────────────

type NodePtyModule = typeof import("node-pty")

type MinimalPtyDisposable = {
  dispose(): void
}

type MinimalPtyExitEvent = {
  exitCode: number
  signal?: number
}

/** node-pty 接口（从 native-pty-provider.ts 复用模式） */
interface MinimalPty {
  onData(callback: (data: string) => void): MinimalPtyDisposable
  onExit(callback: (event: MinimalPtyExitEvent) => void): MinimalPtyDisposable
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

// ─── 辅助类型 ─────────────────────────────────────────────────────────────────

/** 渲染阶段状态机 */
export type RenderPhase = "normal" | "reshaping" | "reattaching" | "recovering"

/** pane geometry（用于 pane view 投影裁剪） */
export type PaneGeometry = {
  paneId: string
  left: number
  top: number
  width: number
  height: number
  active: boolean
}

/** Snapshot 视图模式 */
export type TmuxSnapshotView = "pane" | "client"

/** tmux 命令执行结果 */
export type TmuxCommandResult = {
  ok: boolean
  /** 原始 DSL */
  command: string
  /** 解析后的 AST kind */
  parsedKind?: string
  /** 鉴权决策 */
  decision?: "allow" | "deny"
  /** 执行结果（如果 allowed） */
  executionResult?: TmuxControlResponse
  /** 错误信息（如果 denied 或 execution failed） */
  errorMessage?: string
  /** 需要 tree refresh */
  needsTreeRefresh: boolean
  /** 需要 reattach */
  needsReattach: boolean
}

// ─── TmuxCoreSession 类型 ─────────────────────────────────────────────────────

/**
 * TmuxCore 会话状态。
 *
 * 整合三通道的所有状态：
 * - render channel: node-pty 进程 + XtermAdapter
 * - control channel: TmuxControlChannel 实例
 * - session 元数据
 */
export type TmuxCoreSession = {
  /** MCP session 信息 */
  sessionInfo: {
    sessionId: string
    providerName: ProviderName
    providerSessionId: string
    command: string
    args: string[]
    cwd: string
    label?: string
    status: "starting" | "running" | "exited" | "killed" | "error"
    exitCode?: number | null
    createdAt: string
    lastActivityAt: string
    ttlMs: number
  }
  /** tmux session name（用于 control channel attach target） */
  tmuxId: string
  /** transport 实例 */
  transport: TmuxTransport
  // ─── 三通道 ───
  /** Render Channel: node-pty 进程 */
  renderPty: MinimalPty | null
  /** Control Channel: tmux -C 实例 */
  controlChannel: TmuxControlChannel | null
  // ─── 渲染状态 ───
  /** XtermAdapter 用于解析 render channel 输出 */
  xtermAdapter: XtermAdapter
  /** 渲染阶段状态 */
  renderPhase: RenderPhase
  /** 最后一次 render channel 数据写入时间 */
  lastRenderWriteAt: number
  /** dirty 标记（render channel 有新数据） */
  renderDirty: boolean
  // ─── 快照状态 ───
  /** 上一次 snapshot 的 screen hash */
  lastScreenHash?: string
  /** snapshot 计数 */
  snapshotCount: number
  // ─── 尺寸 ───
  rows: number
  cols: number
  // ─── transcript ───
  transcript: TranscriptRecorder
  /** pane geometry（从 control channel list-panes 获取） */
  paneGeometry: PaneGeometry | null
  /** 当前 attach target（如 "tumcp_abcdef" 或 "tumcp_abcdef:0.%0"） */
  attachTarget: string
}

// ─── TmuxCore 类 ──────────────────────────────────────────────────────────────

/**
 * Tmux 三通道共用核心。
 *
 * 本地 TmuxProvider 和远程 SshTmuxProvider 委托给 TmuxCore，
 * 仅通过不同的 TmuxTransport 实现来区分本地/远程。
 *
 * 核心原则：
 * - Render is passive: render channel 只负责产生屏幕渲染，不接受用户输入
 * - Control is authoritative: 所有输入和管理命令通过 control channel
 * - Agent commands are parsed: tmux_command 走 parse → authorize → compile → execute
 */
export class TmuxCore {
  private sessions: Map<string, TmuxCoreSession>
  private logger: Logger
  private nodePtyModule: NodePtyModule | null
  private disposables: Array<{ dispose(): void }>

  constructor(logger: Logger) {
    this.sessions = new Map()
    this.logger = logger
    this.nodePtyModule = null
    this.disposables = []
  }

  // ─── 生命周期 ─────────────────────────────────────────────────────────────

  /**
   * 启动 tmux session 并建立三通道。
   *
   * 流程：
   * 1. 通过 CLI fallback 创建 tmux session
   * 2. 启用鼠标模式
   * 3. 设置稳定尺寸策略
   * 4. 启动 control channel
   * 5. 订阅 control channel 事件
   * 6. 启动 render channel
   * 7. 连接 render onData → XtermAdapter
   * 8. 刷新 pane geometry
   *
   * @param input - 启动参数
   * @param transport - tmux transport（本地或远程）
   * @param providerName - provider 名称（用于 session 标识）
   * @returns 创建的 TmuxCoreSession
   */
  async start(input: StartInput, transport: TmuxTransport, providerName: ProviderName): Promise<TmuxCoreSession> {
    const ptyModule = this.ensureNodePty()

    const sessionId = generateSessionId()
    const tmuxId = this.createTmuxSessionName()
    const providerSessionId = `${providerName === "tmux" ? "tmux" : "stmux"}_${sessionId}`
    const createdAt = new Date().toISOString()
    const xtermAdapter = new XtermAdapter(input.cols, input.rows)
    const transcript = new TranscriptRecorder(sessionId)

    // Step 1: 通过 CLI fallback 创建 tmux session
    const newSessionArgs = [
      "new-session", "-d", "-s", tmuxId,
      "-x", String(input.cols), "-y", String(input.rows),
      "-c", input.cwd,
    ]
    if (input.command.length > 0) {
      newSessionArgs.push("--", input.command, ...input.args)
    }
    const createResult = await transport.execTmux(newSessionArgs)
    if (createResult.exitCode !== 0) {
      xtermAdapter.dispose()
      throw new TmuxControlError(
        `Failed to create tmux session: ${createResult.stderr}`,
        { details: { tmuxId, exitCode: createResult.exitCode, stderr: createResult.stderr } },
      )
    }

    // Step 2: 启用鼠标模式
    await transport.execTmux(["set-option", "-t", tmuxId, "mouse", "on"])

    // Step 3: 设置稳定尺寸策略（仅对 agent-owned session）
    await transport.execTmux(["set-option", "-t", tmuxId, "window-size", "manual"])

    // Step 4: 启动 control channel
    const controlChannel = new TmuxControlChannel()
    const controlSpawnArgs = transport.getControlSpawnArgs(tmuxId)
    await controlChannel.start(controlSpawnArgs)

    // Step 5: 订阅 control channel 事件（在 session 创建后绑定）

    // Step 6: 启动 render channel
    const renderOpts: RenderChannelOpts = {
      attachTarget: tmuxId,
      cols: input.cols,
      rows: input.rows,
    }
    const renderSpawnArgs = transport.getRenderSpawnArgs(renderOpts)
    const renderPty = this.spawnRenderPty(renderSpawnArgs, ptyModule)

    const session: TmuxCoreSession = {
      sessionInfo: {
        sessionId,
        providerName,
        providerSessionId,
        command: input.command,
        args: input.args,
        cwd: input.cwd,
        label: input.label,
        status: "starting",
        createdAt,
        lastActivityAt: createdAt,
        ttlMs: input.ttlMs ?? DEFAULT_TTL_MS,
      },
      tmuxId,
      transport,
      renderPty,
      controlChannel,
      xtermAdapter,
      renderPhase: "normal",
      lastRenderWriteAt: Date.now(),
      renderDirty: false,
      snapshotCount: 0,
      rows: input.rows,
      cols: input.cols,
      transcript,
      paneGeometry: null,
      attachTarget: tmuxId,
    }

    // Step 7: 连接 render channel onData → XtermAdapter
    const dataDisposable = renderPty.onData((data) => {
      this.handleRenderData(session, data)
    })
    const exitDisposable = renderPty.onExit((event) => {
      this.handleRenderExit(session, event.exitCode)
    })
    this.disposables.push(dataDisposable, exitDisposable)

    // Step 5 续: 订阅 control channel 事件
    const notificationHandler = (notification: TmuxControlNotification) => {
      this.handleControlNotification(session, notification)
    }
    controlChannel.onNotification(notificationHandler)

    // Step 8: 刷新 pane geometry
    await this.refreshPaneGeometry(session)

    session.sessionInfo.status = "running"
    this.sessions.set(providerSessionId, session)

    this.logger.info("tmux-core session started", {
      sessionId,
      tmuxId,
      command: input.command,
      cwd: input.cwd,
      cols: input.cols,
      rows: input.rows,
      transport: transport.description,
    })

    return session
  }

  /**
   * 附加到已有 tmux session 并建立三通道。
   *
   * 流程：
   * 1. 读取 dimensions 和 title（CLI fallback）
   * 2. 启用鼠标模式
   * 3. 启动 control channel
   * 4. 启动 render channel
   * 5. 连接 render onData → XtermAdapter
   * 6. 刷新 pane geometry
   *
   * @param sessionIdOrName - tmux session 名称或 ID
   * @param transport - tmux transport
   * @param providerName - provider 名称
   * @returns 附加的 TmuxCoreSession
   */
  async attach(sessionIdOrName: string, transport: TmuxTransport, providerName: ProviderName): Promise<TmuxCoreSession> {
    const ptyModule = this.ensureNodePty()

    const sessionId = generateSessionId()
    const providerSessionId = `${providerName === "tmux" ? "tmux" : "stmux"}_${sessionId}`
    const createdAt = new Date().toISOString()

    // Step 1: 读取 dimensions（CLI fallback）
    const widthResult = await transport.execTmux(["display-message", "-t", sessionIdOrName, "-p", "#{window_width}"])
    const heightResult = await transport.execTmux(["display-message", "-t", sessionIdOrName, "-p", "#{window_height}"])
    const cols = Number.parseInt(widthResult.stdout.trim(), 10) || 120
    const rows = Number.parseInt(heightResult.stdout.trim(), 10) || 30

    const xtermAdapter = new XtermAdapter(cols, rows)
    const transcript = new TranscriptRecorder(sessionId)

    // Step 2: 启用鼠标模式
    await transport.execTmux(["set-option", "-t", sessionIdOrName, "mouse", "on"])

    // Step 3: 启动 control channel
    const controlChannel = new TmuxControlChannel()
    const controlSpawnArgs = transport.getControlSpawnArgs(sessionIdOrName)
    await controlChannel.start(controlSpawnArgs)

    // Step 4: 启动 render channel
    const renderOpts: RenderChannelOpts = {
      attachTarget: sessionIdOrName,
      cols,
      rows,
    }
    const renderSpawnArgs = transport.getRenderSpawnArgs(renderOpts)
    const renderPty = this.spawnRenderPty(renderSpawnArgs, ptyModule)

    const session: TmuxCoreSession = {
      sessionInfo: {
        sessionId,
        providerName,
        providerSessionId,
        command: "tmux-attach",
        args: [sessionIdOrName],
        cwd: process.cwd(),
        status: "starting",
        createdAt,
        lastActivityAt: createdAt,
        ttlMs: DEFAULT_TTL_MS,
      },
      tmuxId: sessionIdOrName,
      transport,
      renderPty,
      controlChannel,
      xtermAdapter,
      renderPhase: "normal",
      lastRenderWriteAt: Date.now(),
      renderDirty: false,
      snapshotCount: 0,
      rows,
      cols,
      transcript,
      paneGeometry: null,
      attachTarget: sessionIdOrName,
    }

    // Step 5: 连接 render channel onData → XtermAdapter
    const dataDisposable = renderPty.onData((data) => {
      this.handleRenderData(session, data)
    })
    const exitDisposable = renderPty.onExit((event) => {
      this.handleRenderExit(session, event.exitCode)
    })
    this.disposables.push(dataDisposable, exitDisposable)

    // 订阅 control channel 事件
    const notificationHandler = (notification: TmuxControlNotification) => {
      this.handleControlNotification(session, notification)
    }
    controlChannel.onNotification(notificationHandler)

    // Step 6: 刷新 pane geometry
    await this.refreshPaneGeometry(session)

    session.sessionInfo.status = "running"
    this.sessions.set(providerSessionId, session)

    this.logger.info("tmux-core session attached", {
      sessionId,
      tmuxId: sessionIdOrName,
      cols,
      rows,
      transport: transport.description,
    })

    return session
  }

  // ─── 观测 ─────────────────────────────────────────────────────────────────

  /**
   * 获取屏幕快照。
   *
   * 从 render channel 的 XtermAdapter 读取（不再使用 capture-pane）。
   *
   * 默认使用 pane view（裁剪目标 pane 区域），
   * 仅当 view="client" 时返回完整 tmux client screen。
   *
   * @param sessionId - session ID
   * @param mode - snapshot 模式（viewport 或 full）
   * @param view - 视图模式（pane 或 client）
   * @returns TerminalSnapshot
   */
  async snapshot(sessionId: string, mode: TerminalSnapshotMode = "viewport", view: TmuxSnapshotView = "pane"): Promise<TerminalSnapshot> {
    const session = this.getLiveSession(sessionId)

    // 如果 renderPhase != normal，等待 stable（简化版）
    if (session.renderPhase !== "normal") {
      await this.waitForRenderPhaseNormal(session, INITIAL_RENDER_STABLE_MS)
    }

    const screen = session.xtermAdapter.readScreen(mode)
    const highlights: Highlight[] = session.xtermAdapter.detectHighlights(mode)
    const screenText = screen.lines.map((line) => line.text).join("\n")
    const screenHash = hashScreen(screenText)
    const changed = session.renderDirty || session.lastScreenHash !== screenHash

    // pane view 裁剪（后续 Phase 完善，当前返回完整 screen）
    const effectiveScreenText = view === "pane" && session.paneGeometry !== null
      ? this.cropToPane(screenText, session.paneGeometry, screen.cols)
      : screenText

    const riskSignals = detectRiskSignals(effectiveScreenText)

    const snapshotResult = createSnapshot({
      sessionId: session.sessionInfo.sessionId,
      screen: effectiveScreenText,
      cursor: screen.cursor,
      cols: screen.cols,
      rows: screen.rows,
      scrollbackLineCount: screen.scrollbackLineCount,
      status: session.sessionInfo.status,
      changed,
      exitCode: session.sessionInfo.exitCode,
      title: screen.title,
      isFullscreen: screen.isAltBuffer,
      highlights,
      riskSignals,
    })

    session.lastScreenHash = screenHash
    session.snapshotCount += 1
    session.renderDirty = false
    session.sessionInfo.lastActivityAt = snapshotResult.timestamp
    session.xtermAdapter.markClean()
    session.transcript.recordSnapshot(snapshotResult.screen)

    return snapshotResult
  }

  /**
   * 等待指定文本出现。
   *
   * 循环: snapshot() → checkTextMatch() → 如果找到 return; 否则 sleep pollDelay
   *
   * @param sessionId - session ID
   * @param text - 要匹配的文本
   * @param options - 等待选项
   * @returns 匹配时的 TerminalSnapshot
   */
  async waitForText(sessionId: string, text: string, options: WaitOptions): Promise<TerminalSnapshot> {
    const startedAt = Date.now()
    const timeoutMs = options.timeoutMs

    while (true) {
      const session = this.getLiveSession(sessionId)
      const snapshotResult = await this.snapshot(sessionId)
      const match = checkTextMatch(snapshotResult.screen, { ...options, text })

      if (match.matched) {
        return snapshotResult
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new SessionTimeoutError(sessionId, timeoutMs, `等待文本超时: ${text}`)
      }

      await delay(calculatePollDelay({ idleMs: Math.max(20, Math.floor(timeoutMs / 10)), timeoutMs }))

      if (session.sessionInfo.status === "exited" || session.sessionInfo.status === "killed" || session.sessionInfo.status === "error") {
        throw new ProcessExitedError(sessionId, session.sessionInfo.exitCode ?? null)
      }
    }
  }

  /**
   * 等待屏幕稳定。
   *
   * 基于 render channel 的 idle 判断（不依赖 capture-pane 轮询）。
   *
   * 算法：
   * 1. 如果 renderPhase != normal，先等待 stable
   * 2. 等待 render idle（lastRenderWriteAt + idleMs 之前的空闲）
   * 3. 连续两次 pane view hash 相同 → stable
   * 4. timeout → 触发 recovery 或返回 timeout snapshot
   *
   * @param sessionId - session ID
   * @param options - 等待选项
   * @returns 稳定时的 TerminalSnapshot
   */
  async waitStable(sessionId: string, options: WaitStableOptions): Promise<TerminalSnapshot> {
    const startedAt = Date.now()
    const snapshotOnTimeout = options.snapshotOnTimeout ?? true
    let previousState: ScreenState | null = null

    while (true) {
      const session = this.getLiveSession(sessionId)
      const snapshotResult = await this.snapshot(sessionId)
      const now = Date.now()
      const currentState: ScreenState = {
        screen: snapshotResult.screen,
        screenHash: hashScreen(snapshotResult.screen),
        lastWriteAt: session.xtermAdapter.getLastWriteAt(),
        now,
      }
      const stable = checkScreenStable(currentState, previousState, options)

      if (stable.stable) {
        return snapshotResult
      }

      if (now - startedAt > options.timeoutMs) {
        if (snapshotOnTimeout) {
          this.logger.debug("tmux-core waitStable timeout; returning current snapshot", {
            sessionId,
            timeoutMs: options.timeoutMs,
          })
          return { ...snapshotResult, timedOut: true }
        }
        throw new SessionTimeoutError(sessionId, options.timeoutMs, "等待屏幕稳定超时")
      }

      previousState = currentState
      await delay(calculatePollDelay(options))
    }
  }

  // ─── 输入 ─────────────────────────────────────────────────────────────────

  /**
   * 输入文本 — 走 Control Channel send-keys。
   *
   * @param sessionId - session ID
   * @param text - 要输入的文本
   */
  async type(sessionId: string, text: string): Promise<void> {
    const session = this.getLiveSession(sessionId)
    this.assertControlChannelConnected(session)

    await session.controlChannel!.execute(["send-keys", "-t", session.attachTarget, "-l", text])
    session.transcript.recordInput(text)
    session.sessionInfo.lastActivityAt = new Date().toISOString()
    await this.waitRenderAfterInput(session)
  }

  /**
   * 按键 — 走 Control Channel send-keys。
   *
   * @param sessionId - session ID
   * @param keyExpr - 按键表达式
   * @param parsed - 解析后的按键
   */
  async press(sessionId: string, keyExpr: string, parsed: ParsedKeyExpr): Promise<void> {
    const session = this.getLiveSession(sessionId)
    this.assertControlChannelConnected(session)

    const tmuxKey = parsedKeyToTmuxKey(parsed)
    await session.controlChannel!.execute(["send-keys", "-t", session.attachTarget, tmuxKey])
    session.transcript.recordInput(`<${keyExpr}>`)
    session.sessionInfo.lastActivityAt = new Date().toISOString()
    await this.waitRenderAfterInput(session)
  }

  /**
   * 粘贴文本 — 走 Control Channel send-keys。
   *
   * @param sessionId - session ID
   * @param text - 要粘贴的文本
   * @param mode - 粘贴模式
   */
  async paste(sessionId: string, text: string, mode?: "bracketed" | "line-by-line" | "raw"): Promise<void> {
    this.assertPasteSafe(text)
    const session = this.getLiveSession(sessionId)
    this.assertControlChannelConnected(session)

    const effectiveMode = mode ?? "bracketed"

    if (effectiveMode === "bracketed") {
      // tmux 支持 set-buffer + paste-buffer 实现 bracketed paste
      // 简化版：直接 send-keys -l 发送 bracketed 序列
      const payload = `\x1b[200~${text}\x1b[201~`
      await session.controlChannel!.execute(["send-keys", "-t", session.attachTarget, "-l", payload])
      session.transcript.recordInput("<paste:bracketed>")
      session.sessionInfo.lastActivityAt = new Date().toISOString()
      await this.waitRenderAfterInput(session)
      return
    }

    if (effectiveMode === "line-by-line") {
      const lines = text.split(/\r?\n/)
      for (const line of lines) {
        await session.controlChannel!.execute(["send-keys", "-t", session.attachTarget, "-l", `${line}\r`])
        await delay(LINE_BY_LINE_PASTE_DELAY_MS)
      }
      session.transcript.recordInput("<paste:line-by-line>")
      session.sessionInfo.lastActivityAt = new Date().toISOString()
      return
    }

    // raw
    await session.controlChannel!.execute(["send-keys", "-t", session.attachTarget, "-l", text])
    session.transcript.recordInput("<paste:raw>")
    session.sessionInfo.lastActivityAt = new Date().toISOString()
    await this.waitRenderAfterInput(session)
  }

  /**
   * 鼠标点击 — SGR sequence → control channel send-keys -l。
   *
   * @param sessionId - session ID
   * @param input - 鼠标点击参数
   */
  async mouseClick(sessionId: string, input: MouseClickInput): Promise<void> {
    const session = this.getLiveSession(sessionId)
    this.assertControlChannelConnected(session)
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
    await session.controlChannel!.execute(["send-keys", "-t", session.attachTarget, "-l", sequence])
    session.transcript.recordInput(`<mouse:click:${input.button}@${input.col},${input.row}>`)
    session.sessionInfo.lastActivityAt = new Date().toISOString()
    await this.waitRenderAfterInput(session)
  }

  /**
   * 鼠标滚轮 — SGR sequence → control channel send-keys -l。
   *
   * @param sessionId - session ID
   * @param input - 鼠标滚轮参数
   */
  async mouseScroll(sessionId: string, input: MouseScrollInput): Promise<void> {
    const session = this.getLiveSession(sessionId)
    this.assertControlChannelConnected(session)
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
    await session.controlChannel!.execute(["send-keys", "-t", session.attachTarget, "-l", sequence])
    session.transcript.recordInput(`<mouse:scroll:${input.direction}@${input.col},${input.row}>`)
    session.sessionInfo.lastActivityAt = new Date().toISOString()
    await this.waitRenderAfterInput(session)
  }

  // ─── 滚动 ─────────────────────────────────────────────────────────────────

  /**
   * 滚动 — 支持三种模式。
   *
   * program-key: send-keys PPage/NPage/Up/Down
   * program-mouse: SGR scroll sequence → send-keys -l
   * tmux-copy: copy-mode + send-keys -X scroll-up/scroll-down
   *
   * @param sessionId - session ID
   * @param direction - 滚动方向
   * @param lines - 滚动行数
   * @param scrollMode - 滚动模式
   */
  async scroll(sessionId: string, direction: ScrollDirection, lines: number, scrollMode: "program-key" | "program-mouse" | "tmux-copy" = "program-key"): Promise<void> {
    const session = this.getLiveSession(sessionId)
    this.assertControlChannelConnected(session)
    const count = Math.max(0, Math.floor(lines))

    if (scrollMode === "tmux-copy") {
      // 进入 copy-mode 并执行 scroll 命令
      for (let index = 0; index < count; index += 1) {
        const scrollCommand = direction === "up" ? "scroll-up" : "scroll-down"
        await session.controlChannel!.execute(["send-keys", "-t", session.attachTarget, "-X", scrollCommand])
      }
      session.transcript.recordInput(`<scroll:tmux-copy:${direction}:${lines}>`)
      session.sessionInfo.lastActivityAt = new Date().toISOString()
      return
    }

    if (scrollMode === "program-mouse") {
      // 通过 SGR 鼠标滚轮序列滚动
      for (let index = 0; index < count; index += 1) {
        const event: MouseScrollEvent = {
          col: 1,
          row: 1,
          direction,
        }
        const sequence = mouseScrollToSgrSequence(event)
        await session.controlChannel!.execute(["send-keys", "-t", session.attachTarget, "-l", sequence])
      }
      session.transcript.recordInput(`<scroll:program-mouse:${direction}:${lines}>`)
      session.sessionInfo.lastActivityAt = new Date().toISOString()
      return
    }

    // program-key: 发送 PageUp/PageDown 或 Up/Down
    const tmuxKey = lines === 1
      ? (direction === "up" ? "Up" : "Down")
      : (direction === "up" ? "PageUp" : "PageDown")
    const repeatCount = lines === 1 ? 1 : count

    for (let index = 0; index < repeatCount; index += 1) {
      await session.controlChannel!.execute(["send-keys", "-t", session.attachTarget, tmuxKey])
    }
    session.transcript.recordInput(`<scroll:program-key:${direction}:${lines}>`)
    session.sessionInfo.lastActivityAt = new Date().toISOString()
  }

  // ─── 管理命令 ─────────────────────────────────────────────────────────────

  /**
   * 执行 tmux 管理命令。
   *
   * 流程：parse → authorize → compile → control channel execute
   *
   * @param input - 命令 DSL 字符串
   * @param sessionId - 当前 session ID（用于鉴权上下文）
   * @param config - 配置（用于 command safety 函数）
   * @returns 命令执行结果
   */
  async tmuxCommand(input: string, sessionId: string, config: TerminalUseConfig): Promise<TmuxCommandResult> {
    const session = this.getLiveSession(sessionId)
    this.assertControlChannelConnected(session)

    // Step 1: 解析
    const parseResult: TmuxCommandParseResult = parseTmuxCommand(input)
    if (!parseResult.ok) {
      throw new TmuxCommandParseError(parseResult.error, {
        sessionId,
        details: { input, hint: parseResult.hint },
      })
    }

    const ast = parseResult.ast

    // Step 2: 鉴权 + 编译
    const authContext: AuthorizationContext = {
      isDestructiveAllowed: false, // 保守默认，后续可从 config 读取
      currentSession: session.tmuxId,
      knownSessions: new Set(this.getKnownTmuxSessions()),
      commandSafety: (command: string, args: string[]) => {
        const result = isCommandSafeArgv(command, args, config.allowedCommands, config.deniedCommands, config.riskyCommandMode)
        return result.ok
      },
      allowedCommandKinds: new Set([
        "list", "attach", "new", "kill", "rename", "select",
        "resize", "copy-mode", "copy-scroll", "send-keys", "paste", "show-info",
      ]),
    }

    const authResult: AuthorizationResult = authorizeAndCompile(ast, authContext)
    if (!authResult.allowed) {
      throw new TmuxCommandDeniedError(authResult.reason, {
        sessionId,
        details: { input, code: authResult.code },
      })
    }

    const compiled = authResult.compiled

    // Step 3: 执行
    const execResult = await session.controlChannel!.execute(compiled.args)

    return {
      ok: execResult.ok,
      command: input,
      parsedKind: ast.kind,
      decision: "allow",
      executionResult: execResult,
      errorMessage: execResult.ok ? undefined : execResult.errorMessage,
      needsTreeRefresh: compiled.needsTreeRefresh,
      needsReattach: compiled.needsReattach,
    }
  }

  // ─── 其他操作 ─────────────────────────────────────────────────────────────

  /**
   * 调整终端尺寸。
   *
   * 同步 renderPty 和 xtermAdapter 尺寸 + control channel refresh。
   *
   * @param sessionId - session ID
   * @param cols - 新列数
   * @param rows - 新行数
   */
  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    const session = this.getLiveSession(sessionId)

    if (session.renderPty !== null) {
      session.renderPty.resize(cols, rows)
    }
    session.xtermAdapter.resize(cols, rows)
    session.cols = cols
    session.rows = rows
    session.renderDirty = true
    session.sessionInfo.lastActivityAt = new Date().toISOString()
    session.transcript.recordResize(cols, rows)

    // 通过 CLI fallback 刷新 tmux session 尺寸
    await session.transport.execTmux(["resize-window", "-t", session.tmuxId, "-x", String(cols), "-y", String(rows)])
  }

  /**
   * 终止会话。
   *
   * 关闭 renderPty + controlChannel + 清理 session。
   *
   * @param sessionId - session ID
   */
  async kill(sessionId: string): Promise<void> {
    const session = this.getLiveSession(sessionId)

    await safeCleanup([
      {
        name: "renderPty.kill",
        fn: () => {
          if (session.renderPty !== null) {
            if (process.platform === "win32") {
              session.renderPty.kill()
            } else {
              session.renderPty.kill("SIGTERM")
            }
            session.renderPty = null
          }
        },
      },
      {
        name: "controlChannel.close",
        fn: () => {
          if (session.controlChannel !== null) {
            session.controlChannel.close()
            session.controlChannel = null
          }
        },
      },
      {
        name: "killTmuxSession",
        fn: async () => {
          try {
            await session.transport.execTmux(["kill-session", "-t", session.tmuxId])
          } catch {
            // tmux session 可能已被外部销毁
          }
        },
      },
      {
        name: "markKilled+recordExit",
        fn: () => {
          session.sessionInfo.status = "killed"
          session.sessionInfo.lastActivityAt = new Date().toISOString()
          session.transcript.recordExit(session.sessionInfo.exitCode ?? null, "killed")
        },
      },
      {
        name: "xtermAdapter.dispose",
        fn: () => session.xtermAdapter.dispose(),
      },
      {
        name: "sessions.delete",
        fn: () => {
          this.sessions.delete(session.sessionInfo.providerSessionId)
        },
      },
    ], this.logger)

    this.logger.info("tmux-core session killed", { sessionId })
  }

  /**
   * 重命名会话。
   *
   * 更新 session label + tmux session name（通过 control channel）。
   *
   * @param sessionId - session ID
   * @param label - 新标签
   */
  async rename(sessionId: string, label: string): Promise<void> {
    const session = this.getLiveSession(sessionId)
    this.assertControlChannelConnected(session)

    session.sessionInfo.label = label
    // 通过 control channel 重命名 tmux session
    await session.controlChannel!.execute(["rename-session", "-t", session.tmuxId, label])
    session.sessionInfo.lastActivityAt = new Date().toISOString()
  }

  /**
   * 搜索屏幕内容。
   *
   * @param sessionId - session ID
   * @param pattern - 搜索模式
   * @param regex - 是否使用正则
   * @param includeScrollback - 是否包含回滚
   * @returns 搜索结果列表
   */
  async find(sessionId: string, pattern: string, regex?: boolean, includeScrollback?: boolean): Promise<FindResult[]> {
    const snapshotResult = await this.snapshot(sessionId, "full")
    const lines = snapshotResult.screen.split("\n")
    const results: FindResult[] = []

    if (regex === true) {
      const validation = validateRegexSafety(pattern)
      if (!validation.ok) {
        throw new TmuxControlError(`Unsafe regex: ${validation.reason}`)
      }
      const expression = createSafeRegex(pattern, "g")
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
      this.logger.debug("tmux-core find includeScrollback handled as best-effort active-buffer search", { sessionId })
    }

    return results
  }

  /**
   * 导出 transcript。
   *
   * @param sessionId - session ID
   * @param options - 导出选项
   * @returns 导出结果
   */
  async exportTranscript(sessionId: string, options: ExportOptions): Promise<TranscriptExport> {
    const session = this.getLiveSession(sessionId)
    const content = session.transcript.export(options.format, { redact: options.redact })

    return {
      format: options.format,
      content,
      snapshotCount: this.countSnapshotEvents(session),
      eventCount: session.transcript.getEventCount(),
      redacted: options.redact,
    }
  }

  // ─── 查询 ─────────────────────────────────────────────────────────────────

  /**
   * 检查是否有指定 session。
   *
   * @param sessionId - session ID
   * @returns 是否存在
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /**
   * 列出所有活跃 session 的 providerSessionId。
   *
   * @returns providerSessionId 列表
   */
  listActiveSessionIds(): string[] {
    return Array.from(this.sessions.keys())
  }

  /**
   * 获取所有 managed sessions。
   *
   * @returns TmuxCoreSession 列表
   */
  listSessions(): TmuxCoreSession[] {
    return Array.from(this.sessions.values())
  }

  /**
   * 获取指定 session。
   *
   * @param sessionId - session ID
   * @returns TmuxCoreSession
   */
  getSession(sessionId: string): TmuxCoreSession {
    return this.getLiveSession(sessionId)
  }

  // ─── node-pty 懒加载 ─────────────────────────────────────────────────────

  /**
   * 确保 node-pty 已加载（懒加载）。
   *
   * node-pty 是 native addon，部分环境可能安装但运行时加载失败。
   * 使用 require() 同步加载以匹配 native-pty-provider.ts 的模式。
   *
   * @returns node-pty 模块
   * @throws DependencyMissingError 如果 node-pty 不可用
   */
  private ensureNodePty(): NodePtyModule {
    if (this.nodePtyModule !== null) return this.nodePtyModule
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- node-pty 是 C++ addon，必须 require
      this.nodePtyModule = require("node-pty") as NodePtyModule
      return this.nodePtyModule
    } catch {
      throw new DependencyMissingError("node-pty")
    }
  }

  // ─── 内部辅助方法 ─────────────────────────────────────────────────────────

  /**
   * 启动 render channel 并返回 MinimalPty。
   *
   * @param spawnResult - 来自 transport.getRenderSpawnArgs() 的结果
   * @param ptyModule - node-pty 模块
   * @returns MinimalPty 实例
   */
  private spawnRenderPty(spawnResult: RenderSpawnResult, ptyModule: NodePtyModule): MinimalPty {
    return ptyModule.spawn(spawnResult.command, spawnResult.args, {
      name: spawnResult.options.name,
      cols: spawnResult.options.cols,
      rows: spawnResult.options.rows,
      cwd: spawnResult.options.cwd,
      env: spawnResult.options.env !== undefined
        ? { ...process.env, ...spawnResult.options.env }
        : process.env,
    })
  }

  /**
   * 处理 render channel onData。
   *
   * 将数据写入 XtermAdapter 并标记 dirty。
   *
   * @param session - TmuxCoreSession
   * @param data - render channel 输出数据
   */
  private handleRenderData(session: TmuxCoreSession, data: string): void {
    try {
      session.xtermAdapter.write(data)
      session.renderDirty = true
      session.lastRenderWriteAt = Date.now()
      session.sessionInfo.lastActivityAt = new Date().toISOString()
      session.transcript.recordOutput(data)
    } catch (error) {
      session.sessionInfo.status = "error"
      this.logger.error("tmux-core render channel output parse failed", {
        sessionId: session.sessionInfo.sessionId,
        error: this.stringifyUnknownError(error),
      })
    }
  }

  /**
   * 处理 render channel onExit。
   *
   * @param session - TmuxCoreSession
   * @param exitCode - 退出码
   */
  private handleRenderExit(session: TmuxCoreSession, exitCode: number): void {
    session.sessionInfo.status = session.sessionInfo.status === "killed" ? "killed" : "exited"
    session.sessionInfo.exitCode = exitCode
    session.renderPty = null
    session.sessionInfo.lastActivityAt = new Date().toISOString()
    session.transcript.recordExit(exitCode)
    this.logger.info("tmux-core render channel process exited", {
      sessionId: session.sessionInfo.sessionId,
      exitCode,
    })
  }

  /**
   * 处理 control channel 通知。
   *
   * @param session - TmuxCoreSession
   * @param notification - 控制通道通知
   */
  private handleControlNotification(session: TmuxCoreSession, notification: TmuxControlNotification): void {
    switch (notification.type) {
      case "layout-change":
        // 布局变化，标记需要刷新 pane geometry
        this.logger.debug("tmux-core layout-change", {
          sessionId: session.sessionInfo.sessionId,
          windowId: notification.windowId,
        })
        break

      case "window-pane-changed":
        // 活动 pane 变化，需要刷新 pane geometry
        this.logger.debug("tmux-core window-pane-changed", {
          sessionId: session.sessionInfo.sessionId,
          windowId: notification.windowId,
          paneId: notification.paneId,
        })
        break

      case "client-detached":
        // 客户端被 detach
        this.logger.warn("tmux-core client-detached", {
          sessionId: session.sessionInfo.sessionId,
        })
        session.renderPhase = "recovering"
        break

      case "exit":
        // 控制通道退出
        this.logger.warn("tmux-core control channel exit", {
          sessionId: session.sessionInfo.sessionId,
          reason: notification.reason,
        })
        break

      default:
        // 其他通知暂不处理
        break
    }
  }

  /**
   * 刷新 pane geometry（通过 control channel list-panes）。
   *
   * @param session - TmuxCoreSession
   */
  private async refreshPaneGeometry(session: TmuxCoreSession): Promise<void> {
    if (session.controlChannel === null || !session.controlChannel.isConnected()) {
      return
    }

    try {
      const result = await session.controlChannel.execute(["list-panes", "-t", session.tmuxId, "-F", "#{pane_id}:#{pane_left}:#{pane_top}:#{pane_width}:#{pane_height}:#{pane_active}"])
      if (result.ok && result.output.length > 0) {
        // 取第一个 pane（后续 Phase 可扩展为多 pane）
        const firstLine = result.output[0]
        if (firstLine !== undefined) {
          const parts = firstLine.split(":")
          if (parts.length >= 6) {
            session.paneGeometry = {
              paneId: parts[0] ?? "",
              left: Number.parseInt(parts[1] ?? "0", 10),
              top: Number.parseInt(parts[2] ?? "0", 10),
              width: Number.parseInt(parts[3] ?? "0", 10),
              height: Number.parseInt(parts[4] ?? "0", 10),
              active: (parts[5] ?? "0") === "1",
            }
          }
        }
      }
    } catch (error) {
      this.logger.debug("tmux-core refreshPaneGeometry failed", {
        sessionId: session.sessionInfo.sessionId,
        error: this.stringifyUnknownError(error),
      })
    }
  }

  /**
   * 输入后等待渲染收敛。
   *
   * @param session - TmuxCoreSession
   */
  private async waitRenderAfterInput(session: TmuxCoreSession): Promise<void> {
    const deadline = Date.now() + WAIT_RENDER_AFTER_INPUT_MS
    while (Date.now() < deadline) {
      if (!session.renderDirty) {
        return
      }
      await delay(10)
    }
    // 超时不报错，只跳过等待
  }

  /**
   * 等待 renderPhase 回到 normal。
   *
   * @param session - TmuxCoreSession
   * @param timeoutMs - 超时时间
   */
  private async waitForRenderPhaseNormal(session: TmuxCoreSession, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (session.renderPhase !== "normal" && Date.now() < deadline) {
      await delay(50)
    }
    // 超时后强制恢复到 normal（防止永久卡住）
    if (session.renderPhase !== "normal") {
      this.logger.warn("tmux-core waitForRenderPhaseNormal timeout; forcing normal", {
        sessionId: session.sessionInfo.sessionId,
        renderPhase: session.renderPhase,
      })
      session.renderPhase = "normal"
    }
  }

  /**
   * 获取 live session 或抛 SessionNotFoundError。
   *
   * @param sessionId - session ID
   * @returns TmuxCoreSession
   * @throws SessionNotFoundError 如果 session 不存在
   */
  private getLiveSession(sessionId: string): TmuxCoreSession {
    const session = this.sessions.get(sessionId)
    if (session === undefined) {
      throw new SessionNotFoundError(sessionId)
    }
    return session
  }

  /**
   * 断言 control channel 已连接。
   *
   * @param session - TmuxCoreSession
   * @throws TmuxControlError 如果 control channel 未连接
   */
  private assertControlChannelConnected(session: TmuxCoreSession): void {
    if (session.controlChannel === null || !session.controlChannel.isConnected()) {
      throw new TmuxControlError(
        `Control channel not connected for session ${session.sessionInfo.sessionId}`,
        { sessionId: session.sessionInfo.sessionId },
      )
    }
  }

  /**
   * 创建 tmux session name（tumcp_ 前缀 + 随机 hex）。
   *
   * @returns tmux session name
   */
  private createTmuxSessionName(): string {
    return `${TMUX_SESSION_PREFIX}${randomBytes(8).toString("hex")}`
  }

  /**
   * 裁剪 screen text 到目标 pane 区域。
   *
   * @param screenText - 完整 screen 文本
   * @param geometry - pane geometry
   * @param totalCols - 总列数
   * @returns 裁剪后的 screen 文本
   */
  private cropToPane(screenText: string, geometry: PaneGeometry, totalCols: number): string {
    const lines = screenText.split("\n")
    const croppedLines: string[] = []

    for (let row = geometry.top; row < geometry.top + geometry.height && row < lines.length; row += 1) {
      const line = lines[row]
      if (line === undefined) continue
      // 裁剪列范围
      const startCol = Math.min(geometry.left, line.length)
      const endCol = Math.min(geometry.left + geometry.width, line.length)
      croppedLines.push(line.slice(startCol, endCol))
    }

    // 如果总列数不同，用空格填充到 geometry.width
    if (totalCols !== geometry.width) {
      return croppedLines.map((line) => line.padEnd(geometry.width)).join("\n")
    }

    return croppedLines.join("\n")
  }

  /**
   * 获取已知 tmux session 名称列表。
   *
   * @returns session 名称集合
   */
  private getKnownTmuxSessions(): string[] {
    return Array.from(this.sessions.values()).map((s) => s.tmuxId)
  }

  /**
   * 粘贴安全检查。
   *
   * @param text - 要粘贴的文本
   * @throws LargePasteRefusedError 如果超过限制
   * @throws SecretDetectedError 如果包含秘密
   */
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

  /**
   * 统计 snapshot 事件数。
   *
   * @param session - TmuxCoreSession
   * @returns snapshot 事件数
   */
  private countSnapshotEvents(session: TmuxCoreSession): number {
    return session.transcript.getEvents(session.transcript.getEventCount()).events
      .filter((event) => event.type === "snapshot").length
  }

  /**
   * 将未知错误转为字符串。
   *
   * @param error - 未知错误
   * @returns 错误消息字符串
   */
  private stringifyUnknownError(error: unknown): string {
    if (error instanceof Error) {
      return error.message
    }
    return String(error)
  }

  /**
   * 清理所有资源。
   *
   * 关闭所有 session 和 control channel，释放 node-pty 进程。
   */
  async dispose(): Promise<void> {
    // 清理所有 disposables
    for (const disposable of this.disposables) {
      try {
        disposable.dispose()
      } catch {
        // 忽略清理错误
      }
    }
    this.disposables = []

    // 关闭所有 session
    const sessionIds = Array.from(this.sessions.keys())
    for (const sessionId of sessionIds) {
      try {
        await this.kill(sessionId)
      } catch {
        // 忽略 kill 错误
      }
    }

    this.sessions.clear()
  }
}

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────

/**
 * 延迟指定毫秒数。
 *
 * @param ms - 延迟毫秒数
 * @returns Promise
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
