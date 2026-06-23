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

import type { TmuxTransport, RenderChannelOpts, RenderSpawnResult, ControlSpawnResult } from "./tmux-transport.js"
import { hasInProcessControl } from "./tmux-transport.js"
import { TmuxControlChannel } from "./tmux-control-channel.js"
import type { TmuxControlChannelLike, TmuxControlNotification, TmuxControlResponse } from "./tmux-control-channel.js"
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
import type { TmuxCommandParseResult, TmuxTarget, TmuxAttachTarget, TmuxCommandAst } from "../terminal/tmux-command-parser.js"
import { authorizeAndCompile } from "../terminal/tmux-command-switch.js"
import type { AuthorizationResult, AuthorizationContext } from "../terminal/tmux-command-switch.js"
import { cropToPane, formatTmuxTargetFromAst, parsePaneGeometryLine, detectPollutionHeuristics, type PollutionType } from "../terminal/tmux-core-utils.js"
import type { TerminalUseConfig } from "../config.js"

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

/** 将 TmuxTarget 或 TmuxAttachTarget 格式化为字符串用于 audit */
function formatTmuxTarget(target: TmuxTarget | TmuxAttachTarget): string {
  if ("id" in target) return target.id
  if ("name" in target) return target.name
  if ("paneId" in target) return target.paneId
  // TmuxAttachTarget window: "session:window"
  if ("session" in target && "window" in target) return `${target.session}:${target.window}`
  return String(target)
}

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

/** reshape 阶段等待渲染与几何收敛的超时（ms） */
const RESHAPE_STABLE_TIMEOUT_MS = 5_000

/** reshape 阶段判定 render channel idle 的最小空闲时间（ms） */
const RESHAPE_RENDER_IDLE_MS = 200

/** reshape 阶段轮询间隔（ms） */
const RESHAPE_POLL_MS = 50

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
  /** tmux 命令 target（如 %3, @2, session-name） */
  tmuxCommandTarget?: string
  /** tmux 命令是否破坏性（kill 等） */
  tmuxCommandDestructive?: boolean
  /** 编译后的 tmux 命令（如 "kill-pane -t %3"，已脱敏） */
  compiledCommand?: string
}

/** tmux 树查询结果（sessions / windows / panes 的扁平完整视图） */
export type TmuxTreeResult = {
  sessions: Array<{ id: string; name: string; created: string }>
  windows: Array<{ id: string; sessionName: string; index: number; name: string; width: number; height: number }>
  panes: Array<{ id: string; sessionName: string; windowIndex: number; index: number; title: string; left: number; top: number; width: number; height: number; active: boolean }>
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
  controlChannel: TmuxControlChannelLike | null
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
  /** pane geometry 列表（从 control channel list-panes 获取） */
  paneGeometries: PaneGeometry[]
  /** 当前 attach target（如 "tumcp_abcdef" 或 "tumcp_abcdef:0.%0"） */
  attachTarget: string
  /** 上一次输入是否无视觉变化 */
  lastInputNoVisualChange?: boolean
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
    const useInProcessControl = hasInProcessControl(transport)
    const ptyModule = useInProcessControl ? null : await this.ensureNodePty()

    const sessionId = generateSessionId()
    const tmuxId = providerName === "ssh-tmux" ? this.createRemoteTmuxSessionName() : this.createTmuxSessionName()
    const providerSessionId = providerName === "ssh-tmux" ? tmuxId : `${providerName === "tmux" ? "tmux" : "stmux"}_${sessionId}`
    const createdAt = new Date().toISOString()
    const xtermAdapter = new XtermAdapter(input.cols, input.rows)
    const transcript = new TranscriptRecorder(sessionId)

    // Step 1: 通过 CLI fallback 创建 tmux session
    const newSessionArgs = [
      "new-session", "-d", "-s", tmuxId,
      "-x", String(input.cols), "-y", String(input.rows),
      "-c", input.cwd,
    ]
    // 传入环境变量（-e KEY=VALUE 必须在 -- 之前）
    if (input.env !== undefined) {
      for (const [key, value] of Object.entries(input.env)) {
        newSessionArgs.push("-e", `${key}=${value}`)
      }
    }
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

    // Step 3b: 设置 default-size 和关闭 aggressive-resize（仅 agent-owned session）
    await transport.execTmux(["set-option", "-t", tmuxId, "default-size", `${input.cols}x${input.rows}`])
    await transport.execTmux(["set-option", "-t", tmuxId, "aggressive-resize", "off"])

    // Step 4: 启动 render channel（必须在 control channel 之前！）
    // tmux 3.4+ 的 control mode client (-C) 不会被计为"真实 attached client"，
    // 如果 session 没有其他真实 client，tmux 会立即 detach 控制客户端并 %exit。
    // 先启动 render channel（node-pty + tmux attach）确保 session 有真实 client，
    // 再启动 control channel 才能稳定运行。
    const renderOpts: RenderChannelOpts = {
      attachTarget: tmuxId,
      cols: input.cols,
      rows: input.rows,
    }
    const renderPty = ptyModule === null ? null : this.spawnRenderPty(transport.getRenderSpawnArgs(renderOpts), ptyModule)

    // Step 5: 创建 session 对象（controlChannel 暂为 null）
    // 必须在绑定 render channel 事件回调之前创建 session，
    // 因为回调需要 session 引用来写入 xtermAdapter 等。
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
      controlChannel: null,
      xtermAdapter,
      renderPhase: "normal",
      lastRenderWriteAt: Date.now(),
      renderDirty: false,
      snapshotCount: 0,
      rows: input.rows,
      cols: input.cols,
      transcript,
      paneGeometries: [],
      attachTarget: tmuxId,
    }

    // Step 6: 立即绑定 render channel onData/onExit 回调
    // 关键时序：tmux attach 成功后会立即发出初始屏幕渲染数据（ANSI escape 序列）。
    // 如果在 controlChannel.start() 之后才绑定 onData，这些初始数据会在 await 期间
    // 被 node-pty emit 但没有监听器接收，导致 XtermAdapter 永远收不到初始屏幕内容，
    // 后续 snapshot() 返回空屏幕，tmux 因无"真实 client"而 %exit control channel。
    if (renderPty !== null) {
      const dataDisposable = renderPty.onData((data) => {
        if (session.renderPty !== renderPty) return
        this.handleRenderData(session, data)
      })
      const exitDisposable = renderPty.onExit((event) => {
        if (session.renderPty !== renderPty) return
        this.handleRenderExit(session, event.exitCode)
      })
      this.disposables.push(dataDisposable, exitDisposable)
    }

    // Step 7: 启动 control channel（此时 session 已有 render channel 作为真实 client）
    const controlChannel = this.createControlChannel(transport)
    const controlSpawnArgs = useInProcessControl ? this.emptyControlSpawnArgs() : transport.getControlSpawnArgs(tmuxId)
    await controlChannel.start(controlSpawnArgs)
    session.controlChannel = controlChannel

    // Step 8: 订阅 control channel 事件
    const notificationHandler = (notification: TmuxControlNotification) => {
      this.handleControlNotification(session, notification)
    }
    controlChannel.onNotification(notificationHandler)

    // Step 9: 刷新 pane geometry
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
    const useInProcessControl = hasInProcessControl(transport)
    const ptyModule = useInProcessControl ? null : await this.ensureNodePty()

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

    // Step 3: 启动 render channel（必须在 control channel 之前，同 start()）
    const renderOpts: RenderChannelOpts = {
      attachTarget: sessionIdOrName,
      cols,
      rows,
    }
    const renderPty = ptyModule === null ? null : this.spawnRenderPty(transport.getRenderSpawnArgs(renderOpts), ptyModule)

    // Step 4: 创建 session 对象（controlChannel 暂为 null）
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
      controlChannel: null,
      xtermAdapter,
      renderPhase: "normal",
      lastRenderWriteAt: Date.now(),
      renderDirty: false,
      snapshotCount: 0,
      rows,
      cols,
      transcript,
      paneGeometries: [],
      attachTarget: sessionIdOrName,
    }

    // Step 5: 立即绑定 render channel onData/onExit（同 start() 时序要求）
    if (renderPty !== null) {
      const dataDisposable = renderPty.onData((data) => {
        if (session.renderPty !== renderPty) return
        this.handleRenderData(session, data)
      })
      const exitDisposable = renderPty.onExit((event) => {
        if (session.renderPty !== renderPty) return
        this.handleRenderExit(session, event.exitCode)
      })
      this.disposables.push(dataDisposable, exitDisposable)
    }

    // Step 6: 启动 control channel
    const controlChannel = this.createControlChannel(transport)
    const controlSpawnArgs = useInProcessControl ? this.emptyControlSpawnArgs() : transport.getControlSpawnArgs(sessionIdOrName)
    await controlChannel.start(controlSpawnArgs)
    session.controlChannel = controlChannel

    // 订阅 control channel 事件
    const notificationHandler = (notification: TmuxControlNotification) => {
      this.handleControlNotification(session, notification)
    }
    controlChannel.onNotification(notificationHandler)

    // Step 7: 刷新 pane geometry
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
   * 渲染策略：
   * - 普通模式：从 render channel 的 XtermAdapter 读取
   * - Alt buffer（全屏 TUI）：用 capture-pane -p 纯文本作为主数据源，
   *   避免 render channel 增量数据丢失问题
   *
   * @param sessionId - session ID
   * @param mode - snapshot 模式（viewport 或 full）
   * @param view - 视图模式（pane 或 client）
   * @returns TerminalSnapshot
   */
  async snapshot(sessionId: string, mode: TerminalSnapshotMode = "viewport", view: TmuxSnapshotView = "pane"): Promise<TerminalSnapshot> {
    const session = this.getLiveSession(sessionId)

    if (session.renderPty === null && hasInProcessControl(session.transport)) {
      return this.snapshotViaExecTmux(session, mode)
    }

    // 记录 snapshot 入口时的渲染阶段，用于 renderStatus 字段
    const entryRenderPhase = session.renderPhase

    if (session.renderPhase === "reshaping") {
      const stabilized = await this.waitForReshapeStable(session, RESHAPE_STABLE_TIMEOUT_MS)
      if (stabilized) {
        session.renderPhase = "normal"
      } else {
        await this.recoverRenderChannel(session)
      }
    } else if (session.renderPhase !== "normal") {
      await this.waitForRenderPhaseNormal(session, INITIAL_RENDER_STABLE_MS)
    }

    const isAltBuffer = session.xtermAdapter.isAltBufferActive()

    // Alt buffer（全屏 TUI）下用 capture-pane 获取更可靠的内容
    if (isAltBuffer) {
      return this.snapshotViaCapturePane(session, mode, view, entryRenderPhase)
    }

    return this.snapshotViaRenderChannel(session, mode, view, entryRenderPhase)
  }

  /**
   * 通过 render channel XtermAdapter 获取快照（普通模式）。
   */
  private async snapshotViaRenderChannel(session: TmuxCoreSession, mode: TerminalSnapshotMode, view: TmuxSnapshotView, entryRenderPhase: RenderPhase): Promise<TerminalSnapshot> {
    const screen = session.xtermAdapter.readScreen(mode)
    const highlights: Highlight[] = session.xtermAdapter.detectHighlights(mode)
    const screenText = screen.lines.map((line) => line.text).join("\n")
    const screenHash = hashScreen(screenText)
    const changed = session.renderDirty || session.lastScreenHash !== screenHash

    const activeGeometry = this.getActivePaneGeometry(session)
    let effectiveScreenText: string
    if (view === "pane") {
      if (activeGeometry === null) {
        this.logger.warn("tmux-core pane geometry unavailable, falling back to client view", {
          sessionId: session.sessionInfo.sessionId,
        })
        effectiveScreenText = screenText
      } else {
        effectiveScreenText = cropToPane(screenText, activeGeometry, screen.cols)
      }
    } else {
      effectiveScreenText = screenText
    }

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
      renderStatus: entryRenderPhase,
    })

    session.lastScreenHash = screenHash
    session.snapshotCount += 1

    if (session.snapshotCount % 5 === 0 && this.detectRenderPollution(session).length > 0) {
      this.logger.warn("tmux-core render pollution detected; triggering recovery", {
        sessionId: session.sessionInfo.sessionId,
      })
      await this.recoverRenderChannel(session)
      return this.snapshot(session.sessionInfo.sessionId, mode, view)
    }

    session.renderDirty = false
    session.sessionInfo.lastActivityAt = snapshotResult.timestamp
    session.xtermAdapter.markClean()
    session.transcript.recordSnapshot(snapshotResult.screen)

    return snapshotResult
  }

  /**
   * 通过 capture-pane CLI 获取快照（alt buffer 模式）。
   *
   * 全屏 TUI（Ink 等）使用 alternate buffer，render channel 的增量数据
   * 可能因 ANSI 重绘序列导致 XtermAdapter 状态不一致。
   * capture-pane -p 从 tmux server 获取当前 pane 的纯文本内容，
   * 不经过 XtermAdapter 解析（避免 ANSI 序列与 PTY 流格式不兼容的问题）。
   */
  private async snapshotViaCapturePane(session: TmuxCoreSession, mode: TerminalSnapshotMode, view: TmuxSnapshotView, entryRenderPhase: RenderPhase): Promise<TerminalSnapshot> {
    // capture-pane -p（不带 -e）返回纯文本，不含 ANSI escape 序列。
    // 不用临时 XtermAdapter 解析 -e 输出，因为 tmux pane buffer 按行序列化后
    // 与 xterm 期望的 PTY 流格式不兼容（缺少光标定位序列，CJK 宽字符导致 cell 错位）。
    const captureResult = await session.transport.execTmux(["capture-pane", "-t", session.attachTarget, "-p"])
    if (captureResult.exitCode !== 0) {
      this.logger.warn("tmux-core capture-pane failed in alt-buffer mode; falling back to render channel", {
        sessionId: session.sessionInfo.sessionId,
        stderr: captureResult.stderr.substring(0, 200),
      })
      return this.snapshotViaRenderChannel(session, mode, view, entryRenderPhase)
    }

    const rawLines = captureResult.stdout.split("\n")
    // capture-pane 可能返回超过 rows 行（含 tmux history），只取末尾 rows 行作为 viewport
    const viewportLines = rawLines.length > session.rows
      ? rawLines.slice(rawLines.length - session.rows)
      : rawLines
    const trimmedLines = viewportLines.map((line: string) => line.trimEnd())
    const screenText = trimmedLines.join("\n")

    const cursorResult = await session.transport.execTmux(["display-message", "-t", session.attachTarget, "-p", "#{cursor_x} #{cursor_y}"])
    const cursorParts = cursorResult.stdout.trim().split(" ")
    const cursor = {
      x: cursorParts.length >= 1 ? parseInt(cursorParts[0], 10) || 0 : 0,
      y: cursorParts.length >= 2 ? parseInt(cursorParts[1], 10) || 0 : 0,
    }

    const titleResult = await session.transport.execTmux(["display-message", "-t", session.attachTarget, "-p", "#{session_name}"])
    const screenHash = hashScreen(screenText)
    const changed = session.renderDirty || session.lastScreenHash !== screenHash
    const riskSignals = detectRiskSignals(screenText)

    const activeGeometry = this.getActivePaneGeometry(session)
    let effectiveScreenText: string
    if (view === "pane") {
      effectiveScreenText = activeGeometry !== null
        ? cropToPane(screenText, activeGeometry, session.cols)
        : screenText
    } else {
      effectiveScreenText = screenText
    }

    const snapshotResult = createSnapshot({
      sessionId: session.sessionInfo.sessionId,
      screen: effectiveScreenText,
      cursor,
      cols: session.cols,
      rows: session.rows,
      scrollbackLineCount: 0,
      status: session.sessionInfo.status,
      changed,
      exitCode: session.sessionInfo.exitCode,
      title: titleResult.stdout.trim(),
      isFullscreen: true,
      highlights: [],
      riskSignals,
      renderStatus: entryRenderPhase,
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
    const isAltBuffer = this.getLiveSession(sessionId).xtermAdapter.isAltBufferActive()
    const stableOptions: WaitStableOptions = isAltBuffer
      ? { ...options, skipIdleCheck: true }
      : options
    let previousState: ScreenState | null = null

    while (true) {
      const session = this.getLiveSession(sessionId)
      if (session.renderPhase === "reshaping") {
        const remainingMs = Math.max(0, options.timeoutMs - (Date.now() - startedAt))
        const stabilized = await this.waitForReshapeStable(session, Math.min(remainingMs, RESHAPE_STABLE_TIMEOUT_MS))
        if (stabilized) {
          session.renderPhase = "normal"
        } else {
          await this.recoverRenderChannel(session)
        }
      }
      const snapshotResult = await this.snapshot(sessionId)
      const now = Date.now()
      const currentState: ScreenState = {
        screen: snapshotResult.screen,
        screenHash: hashScreen(snapshotResult.screen),
        lastWriteAt: session.xtermAdapter.getLastWriteAt(),
        now,
      }
      const stable = checkScreenStable(currentState, previousState, stableOptions)

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

    await this.sendLiteralText(session, text)
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
      const payload = `\x1b[200~${text}\x1b[201~`
      await this.sendLiteralText(session, payload)
      session.transcript.recordInput("<paste:bracketed>")
      session.sessionInfo.lastActivityAt = new Date().toISOString()
      await this.waitRenderAfterInput(session)
      return
    }

    if (effectiveMode === "line-by-line") {
      const lines = text.split(/\r?\n/)
      for (const line of lines) {
        if (line.length > 0) {
          await session.controlChannel!.execute(["send-keys", "-t", session.attachTarget, "-l", line])
        }
        await session.controlChannel!.execute(["send-keys", "-t", session.attachTarget, "Enter"])
        await delay(LINE_BY_LINE_PASTE_DELAY_MS)
      }
      session.transcript.recordInput("<paste:line-by-line>")
      session.sessionInfo.lastActivityAt = new Date().toISOString()
      return
    }

    // raw
    await this.sendLiteralText(session, text)
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

    const scrollMode = input.mode ?? "program-mouse"
    const count = input.direction === "up" ? -3 : 3

    if (scrollMode === "tmux-copy") {
      for (let index = 0; index < Math.abs(count); index += 1) {
        const scrollCommand = input.direction === "up" ? "scroll-up" : "scroll-down"
        await session.controlChannel!.execute(["send-keys", "-t", session.attachTarget, "-X", scrollCommand])
      }
    } else if (scrollMode === "program-key") {
      const tmuxKey = input.direction === "up" ? "PageUp" : "PageDown"
      for (let index = 0; index < Math.abs(count); index += 1) {
        await session.controlChannel!.execute(["send-keys", "-t", session.attachTarget, tmuxKey])
      }
    } else {
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
    }

    session.transcript.recordInput(`<mouse:scroll:${scrollMode}:${input.direction}@${input.col},${input.row}>`)
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

    // 提取 target 和编译命令用于 audit
    const astTarget = "target" in ast && ast.target !== undefined
      ? formatTmuxTarget(ast.target)
      : undefined
    const compiledCmd = compiled.args.join(" ")

    // Step 4: 如果需要 reattach（attach 命令），执行完整 reattach 流程
    if (compiled.needsReattach && ast.kind === "attach") {
      const newTarget = formatTmuxTargetFromAst(ast)
      if (newTarget !== null) {
        await this.reattachToTarget(session, newTarget)
      }
    }

    return {
      ok: execResult.ok,
      command: input,
      parsedKind: ast.kind,
      decision: "allow",
      executionResult: execResult,
      errorMessage: execResult.ok ? undefined : execResult.errorMessage,
      needsTreeRefresh: compiled.needsTreeRefresh,
      needsReattach: compiled.needsReattach,
      tmuxCommandTarget: astTarget,
      tmuxCommandDestructive: compiled.destructive,
      compiledCommand: compiledCmd.length > 200 ? `${compiledCmd.slice(0, 197)}...` : compiledCmd,
    }
  }

  /**
   * 重新 attach 到新 target（关闭旧 render → 启动新 render → 重置 adapter → 等待 stable）。
   *
   * @param session - 当前 session
   * @param newTarget - 新的 attach target（session name / window / pane）
   */
  private async reattachToTarget(session: TmuxCoreSession, newTarget: string): Promise<void> {
    this.logger.info("tmux-core reattaching to new target", {
      sessionId: session.sessionInfo.sessionId,
      oldTarget: session.attachTarget,
      newTarget,
    })

    // 更新 attach target
    session.attachTarget = newTarget

    // 执行与 recoverRenderChannel 相同的重新 attach 流程
    await this.recoverRenderChannel(session)
  }

  /**
   * 通过 control channel 查询完整 tmux 树。
   *
   * @param sessionId - 当前 session ID
   * @returns tmux sessions / windows / panes 扁平树
   */
  async listTree(sessionId: string): Promise<TmuxTreeResult> {
    const session = this.getLiveSession(sessionId)
    this.assertControlChannelConnected(session)

    const sessionsResult = await session.controlChannel!.execute(["list-sessions", "-F", "\"#{session_id}:#{session_name}:#{session_created}\""])
    const windowsResult = await session.controlChannel!.execute(["list-windows", "-a", "-F", "\"#{window_id}:#{session_name}:#{window_index}:#{window_name}:#{window_width}:#{window_height}\""])
    const panesResult = await session.controlChannel!.execute(["list-panes", "-a", "-F", "\"#{pane_id}:#{session_name}:#{window_index}:#{pane_index}:#{pane_title}:#{pane_left}:#{pane_top}:#{pane_width}:#{pane_height}:#{pane_active}\""])

    this.assertTmuxControlResponseOk(sessionsResult, "list-sessions", sessionId)
    this.assertTmuxControlResponseOk(windowsResult, "list-windows", sessionId)
    this.assertTmuxControlResponseOk(panesResult, "list-panes", sessionId)

    const sessions: TmuxTreeResult["sessions"] = []
    for (const line of sessionsResult.output) {
      const parsed = this.parseTmuxTreeSessionLine(line)
      if (parsed !== null) sessions.push(parsed)
    }

    const windows: TmuxTreeResult["windows"] = []
    for (const line of windowsResult.output) {
      const parsed = this.parseTmuxTreeWindowLine(line)
      if (parsed !== null) windows.push(parsed)
    }

    const panes: TmuxTreeResult["panes"] = []
    for (const line of panesResult.output) {
      const parsed = this.parseTmuxTreePaneLine(line)
      if (parsed !== null) panes.push(parsed)
    }

    return { sessions, windows, panes }
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

    // tmux resize-window 触发 layout-change 通知，但通知可能在 snapshot 调用之前未到达；
    // 主动标记 reshaping 确保 snapshot/waitStable 等待布局稳定。
    session.renderPhase = "reshaping"

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
   * node-pty 是 C++ addon，在 ESM/tsx/vitest 环境中 require() 可能失败，
   * 使用 await import() 动态加载更可靠（与 native-pty-provider.ts 保持一致）。
   *
   * @returns node-pty 模块
   * @throws DependencyMissingError 如果 node-pty 不可用
   */
  private async ensureNodePty(): Promise<NodePtyModule> {
    if (this.nodePtyModule !== null) return this.nodePtyModule
    try {
      this.nodePtyModule = await import("node-pty") as NodePtyModule
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
      const now = Date.now()
      const plainText = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim()
      if (plainText.includes("can't find session") || plainText.includes("error connecting to")) {
        this.logger.warn("tmux-core render channel error output", {
          sessionId: session.sessionInfo.sessionId,
          tmuxId: session.tmuxId,
          errorText: plainText.substring(0, 200),
        })
      }
      session.xtermAdapter.write(data)
      session.renderDirty = true
      session.lastRenderWriteAt = now
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
      tmuxId: session.tmuxId,
      renderDirty: session.renderDirty,
      snapshotCount: session.snapshotCount,
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
        session.renderPhase = "reshaping"
        this.refreshPaneGeometry(session).catch((error: unknown) => {
          this.logger.debug("tmux-core async refreshPaneGeometry after layout-change failed", {
            sessionId: session.sessionInfo.sessionId,
            error: this.stringifyUnknownError(error),
          })
        })
        this.logger.debug("tmux-core layout-change", {
          sessionId: session.sessionInfo.sessionId,
          windowId: notification.windowId,
        })
        break

      case "window-pane-changed":
        session.renderPhase = "reshaping"
        this.refreshPaneGeometry(session).catch((error: unknown) => {
          this.logger.debug("tmux-core async refreshPaneGeometry after window-pane-changed failed", {
            sessionId: session.sessionInfo.sessionId,
            error: this.stringifyUnknownError(error),
          })
        })
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
      const result = await session.controlChannel.execute(["list-panes", "-t", session.tmuxId, "-F", "\"#{pane_id}:#{pane_left}:#{pane_top}:#{pane_width}:#{pane_height}:#{pane_active}\""])
      if (result.ok) {
        const parsedGeometries: PaneGeometry[] = []
        for (const line of result.output) {
          const geometry = parsePaneGeometryLine(line)
          if (geometry !== null) parsedGeometries.push(geometry)
        }
        session.paneGeometries = parsedGeometries
      }
    } catch (error) {
      this.logger.debug("tmux-core refreshPaneGeometry failed", {
        sessionId: session.sessionInfo.sessionId,
        error: this.stringifyUnknownError(error),
      })
    }
  }

  /**
   * 通过 control channel send-keys -l 发送文本，自动处理换行符。
   *
   * tmux -C 协议用换行符(0x0A)分隔命令，send-keys -l 的参数中
   * 不能包含真实换行符。此方法将文本按 \n/\r 拆分：
   * - 非换行部分 → send-keys -l <segment>
   * - \n 或 \r   → send-keys Enter
   *
   * @param session - TmuxCoreSession
   * @param text - 要发送的文本（可包含换行符）
   */
  private async sendLiteralText(session: TmuxCoreSession, text: string): Promise<void> {
    const segments = text.split(/([\n\r])/)
    for (const segment of segments) {
      if (segment === "\n" || segment === "\r") {
        await session.controlChannel!.execute(["send-keys", "-t", session.attachTarget, "Enter"])
      } else if (segment.length > 0) {
        await session.controlChannel!.execute(["send-keys", "-t", session.attachTarget, "-l", segment])
      }
    }
  }

  /**
   * 输入后等待渲染收敛（完整算法）。
   *
   * 算法：
   * 1. 记录 beforeHash（pane view hash）
   * 2. 等待 renderDirty 变为 true 或短延迟（50ms）
   * 3. 如果 renderDirty → 等待 render idle（轮询 lastRenderWriteAt）
   * 4. 计算 afterHash
   * 5. 如果 beforeHash === afterHash → lastInputNoVisualChange = true
   *
   * @param session - TmuxCoreSession
   */
  private async waitRenderAfterInput(session: TmuxCoreSession): Promise<void> {
    // Step 1: 记录 beforeHash
    const beforeHash = this.computePaneHash(session)

    // Step 2: 等待 render channel 有数据或短延迟
    const shortDelayMs = 50
    const shortDeadline = Date.now() + shortDelayMs
    while (Date.now() < shortDeadline && !session.renderDirty) {
      await delay(10)
    }

    // Step 3: 如果 renderDirty，等待 render idle
    if (session.renderDirty) {
      const idleDeadline = Date.now() + WAIT_RENDER_AFTER_INPUT_MS
      while (Date.now() < idleDeadline) {
        const idleSince = Date.now() - session.lastRenderWriteAt
        if (idleSince > 30) {
          break
        }
        await delay(10)
      }
    }

    // Step 4: 计算 afterHash
    const afterHash = this.computePaneHash(session)

    // Step 5: 判断是否有视觉变化
    session.lastInputNoVisualChange = beforeHash === afterHash && beforeHash !== ""
  }

  /** 计算 pane view hash（用于输入前后对比） */
  private computePaneHash(session: TmuxCoreSession): string {
    const screen = session.xtermAdapter.readScreen("viewport")
    const screenText = screen.lines.map((line) => line.text).join("\n")
    const activeGeometry = this.getActivePaneGeometry(session)
    const paneText = activeGeometry !== null
      ? cropToPane(screenText, activeGeometry, screen.cols)
      : screenText
    return hashScreen(paneText)
  }

  private async waitForReshapeStable(session: TmuxCoreSession, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    let previousGeometryHash: string | null = null
    let previousPaneHash: string | null = null

    while (Date.now() < deadline) {
      const idleSince = Date.now() - session.lastRenderWriteAt
      if (idleSince > RESHAPE_RENDER_IDLE_MS) {
        await this.refreshPaneGeometry(session)
        const geometryHash = this.hashPaneGeometries(session.paneGeometries)
        const screen = session.xtermAdapter.readScreen("viewport")
        const screenText = screen.lines.map((line) => line.text).join("\n")
        const activeGeometry = this.getActivePaneGeometry(session)
        const paneText = activeGeometry !== null
          ? cropToPane(screenText, activeGeometry, screen.cols)
          : screenText
        const paneHash = hashScreen(paneText)

        if (geometryHash === previousGeometryHash && paneHash === previousPaneHash) {
          return true
        }

        previousGeometryHash = geometryHash
        previousPaneHash = paneHash
      }

      await delay(RESHAPE_POLL_MS)
    }

    return false
  }

  /**
   * 检测渲染污染 heuristic。
   *
   * 检测以下情况：
   * 1. 单行中重复字符比例异常高（如 "*****----////"）
   * 2. XtermAdapter 维度与 tmux tree geometry 不一致
   * 3. 非打印控制残留
   *
   * 注意：heuristic 只用于触发 recovery，不用于删除屏幕内容。
   *
   * @param session - TmuxCoreSession
   * @returns 是否检测到污染
   */
  private detectRenderPollution(session: TmuxCoreSession): PollutionType[] {
    const screen = session.xtermAdapter.readScreen("viewport")
    const screenText = screen.lines.map((line) => line.text).join("\n")
    const activeGeometry = this.getActivePaneGeometry(session)
    const detected = detectPollutionHeuristics(screenText, screen.cols, screen.rows, activeGeometry)
    for (const type of detected) {
      this.logger.debug("tmux-core pollution detected", {
        sessionId: session.sessionInfo.sessionId,
        type,
      })
    }
    return detected
  }

  private async recoverRenderChannel(session: TmuxCoreSession): Promise<void> {
    // 如果 session 已处于终态，不应再尝试恢复 render channel。
    // tmux session 已不存在，新 renderPty 会立即退出，导致竞态错误。
    if (session.sessionInfo.status === "exited" || session.sessionInfo.status === "killed" || session.sessionInfo.status === "error") {
      throw new TmuxControlError(
        `Cannot recover render channel: session is in terminal state '${session.sessionInfo.status}'`,
        { sessionId: session.sessionInfo.sessionId, details: { status: session.sessionInfo.status } },
      )
    }

    const recoveryStartedStatus = session.sessionInfo.status
    session.renderPhase = "reattaching"

    const previousRenderPty = session.renderPty
    session.renderPty = null
    if (previousRenderPty !== null) {
      try {
        if (process.platform === "win32") {
          previousRenderPty.kill()
        } else {
          previousRenderPty.kill("SIGTERM")
        }
      } catch (error) {
        this.logger.debug("tmux-core old render channel kill during recovery failed", {
          sessionId: session.sessionInfo.sessionId,
          error: this.stringifyUnknownError(error),
        })
      }
    }

    session.xtermAdapter.dispose()
    session.xtermAdapter = new XtermAdapter(session.cols, session.rows)
    session.renderDirty = false
    session.lastRenderWriteAt = Date.now()

    const ptyModule = await this.ensureNodePty()
    const renderOpts: RenderChannelOpts = {
      attachTarget: session.attachTarget,
      cols: session.cols,
      rows: session.rows,
    }
    const renderSpawnArgs = session.transport.getRenderSpawnArgs(renderOpts)
    const renderPty = this.spawnRenderPty(renderSpawnArgs, ptyModule)
    session.renderPty = renderPty

    const dataDisposable = renderPty.onData((data) => {
      if (session.renderPty !== renderPty) return
      this.handleRenderData(session, data)
    })
    const exitDisposable = renderPty.onExit((event) => {
      if (session.renderPty !== renderPty) return
      this.handleRenderExit(session, event.exitCode)
    })
    this.disposables.push(dataDisposable, exitDisposable)

    await this.waitRenderAfterInput(session)
    if (session.renderPty === null) {
      throw new TmuxControlError("Render channel exited during recovery", {
        sessionId: session.sessionInfo.sessionId,
      })
    }
    await this.refreshPaneGeometry(session)

    session.renderPhase = "normal"
    if (recoveryStartedStatus === "starting" || recoveryStartedStatus === "running") {
      session.sessionInfo.status = "running"
    }

    this.logger.info("tmux-core render recovery completed", {
      sessionId: session.sessionInfo.sessionId,
    })
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

  private createControlChannel(transport: TmuxTransport): TmuxControlChannelLike {
    return hasInProcessControl(transport) ? transport.createControlChannel() : new TmuxControlChannel()
  }

  private emptyControlSpawnArgs(): ControlSpawnResult {
    return { command: "", args: [] }
  }

  /**
   * 通过 capture-pane CLI 获取快照。
   *
   * 此路径仅在 renderPty 不可用且 transport 支持 in-process control channel 时启用
   * （如 attach 尚未 spawn renderPty 的过渡状态）。
   * 主流程通过 renderPty XtermAdapter 读取屏幕，不使用 capture-pane。
   */
  private async snapshotViaExecTmux(session: TmuxCoreSession, mode: TerminalSnapshotMode): Promise<TerminalSnapshot> {
    const captureResult = await session.transport.execTmux(["capture-pane", "-t", session.attachTarget, "-p", "-e"])
    if (captureResult.exitCode !== 0) {
      throw new TmuxControlError(
        `tmux capture-pane failed: ${captureResult.stderr}`,
        { sessionId: session.sessionInfo.sessionId, details: { exitCode: captureResult.exitCode, stderr: captureResult.stderr } },
      )
    }

    await session.xtermAdapter.write(captureResult.stdout)
    const screen = session.xtermAdapter.readScreen(mode)
    const highlights = session.xtermAdapter.detectHighlights(mode)
    const screenText = screen.lines.map((line) => line.text).join("\n")
    const historyResult = await session.transport.execTmux(["display-message", "-t", session.attachTarget, "-p", "#{history_size}"])
    const titleResult = await session.transport.execTmux(["display-message", "-t", session.attachTarget, "-p", "#{session_name}"])
    const scrollbackLineCount = Number.parseInt(historyResult.stdout.trim(), 10)
    const riskSignals = detectRiskSignals(screenText)
    const screenHash = hashScreen(screenText)
    const changed = session.renderDirty || session.lastScreenHash !== screenHash

    const snapshotResult = createSnapshot({
      sessionId: session.sessionInfo.sessionId,
      screen: screenText,
      cursor: screen.cursor,
      cols: screen.cols,
      rows: screen.rows,
      scrollbackLineCount: Number.isFinite(scrollbackLineCount) ? scrollbackLineCount : screen.scrollbackLineCount,
      status: session.sessionInfo.status,
      changed,
      exitCode: session.sessionInfo.exitCode,
      title: titleResult.stdout.trim() || screen.title,
      isFullscreen: screen.isAltBuffer,
      highlights,
      riskSignals,
      renderStatus: session.renderPhase,
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
   * 创建 tmux session name（tumcp_ 前缀 + 随机 hex）。
   *
   * @returns tmux session name
   */
  private createTmuxSessionName(): string {
    return `${TMUX_SESSION_PREFIX}${randomBytes(8).toString("hex")}`
  }

  private createRemoteTmuxSessionName(): string {
    return `rtumcp_${randomBytes(4).toString("hex")}`
  }

  private getActivePaneGeometry(session: TmuxCoreSession): PaneGeometry | null {
    return session.paneGeometries.find((geometry) => geometry.active) ?? session.paneGeometries[0] ?? null
  }

  private parseTmuxTreeSessionLine(line: string): TmuxTreeResult["sessions"][number] | null {
    const parts = this.stripTmuxFormatQuotes(line).split(":")
    if (parts.length < 3) return null

    return {
      id: parts[0] ?? "",
      name: parts.slice(1, -1).join(":"),
      created: parts[parts.length - 1] ?? "",
    }
  }

  private parseTmuxTreeWindowLine(line: string): TmuxTreeResult["windows"][number] | null {
    const parts = this.stripTmuxFormatQuotes(line).split(":")
    if (parts.length < 6) return null

    const width = parts[parts.length - 2]
    const height = parts[parts.length - 1]

    return {
      id: parts[0] ?? "",
      sessionName: parts[1] ?? "",
      index: this.parseIntegerField(parts[2]),
      name: parts.slice(3, -2).join(":"),
      width: this.parseIntegerField(width),
      height: this.parseIntegerField(height),
    }
  }

  private parseTmuxTreePaneLine(line: string): TmuxTreeResult["panes"][number] | null {
    const parts = this.stripTmuxFormatQuotes(line).split(":")
    if (parts.length < 10) return null

    const left = parts[parts.length - 5]
    const top = parts[parts.length - 4]
    const width = parts[parts.length - 3]
    const height = parts[parts.length - 2]
    const active = parts[parts.length - 1]

    return {
      id: parts[0] ?? "",
      sessionName: parts[1] ?? "",
      windowIndex: this.parseIntegerField(parts[2]),
      index: this.parseIntegerField(parts[3]),
      title: parts.slice(4, -5).join(":"),
      left: this.parseIntegerField(left),
      top: this.parseIntegerField(top),
      width: this.parseIntegerField(width),
      height: this.parseIntegerField(height),
      active: active === "1",
    }
  }

  private stripTmuxFormatQuotes(line: string): string {
    const trimmed = line.trim()
    if (trimmed.length >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
      return trimmed.slice(1, -1)
    }
    return trimmed
  }

  private parseIntegerField(value: string | undefined): number {
    const parsed = Number.parseInt(value ?? "0", 10)
    return Number.isNaN(parsed) ? 0 : parsed
  }

  private hashPaneGeometries(geometries: PaneGeometry[]): string {
    return geometries
      .map((geometry) => `${geometry.paneId}:${geometry.left}:${geometry.top}:${geometry.width}:${geometry.height}:${geometry.active ? "1" : "0"}`)
      .join("|")
  }

  private assertTmuxControlResponseOk(response: TmuxControlResponse, command: string, sessionId: string): void {
    if (response.ok) return

    throw new TmuxControlError(
      `tmux ${command} failed: ${response.errorMessage ?? `exit code ${response.exitCode}`}`,
      {
        sessionId,
        details: {
          command,
          exitCode: response.exitCode,
          errorMessage: response.errorMessage,
        },
      },
    )
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
