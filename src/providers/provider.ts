/**
 * TerminalProvider 接口定义
 *
 * 所有终端后端必须实现此接口。
 * 参考 DEV-PLAN §2.2 Provider Capability Model。
 */

import type { MouseButton, MouseScrollDirection } from "../terminal/mouse.js"
import type { ParsedKeyExpr } from "../terminal/keymap.js"
import type { TerminalSnapshot, TerminalSnapshotMode } from "../terminal/terminal-snapshot.js"
import type { SshSessionMetadata, TerminalTarget } from "../targets/target-types.js"

// ============================================================
// Provider 类型
// ============================================================

export type ProviderName = "native-pty" | "tmux" | "ssh-pty" | "ssh-tmux"

export type ProviderCapabilities = {
  provider: ProviderName
  supportsStart: boolean
  supportsAttach: boolean
  supportsStableWait: boolean
  supportsTextWait: boolean
  supportsHighlights: boolean
  /**
   * 支持回滚/历史搜索。
   * true = 可搜索超出当前视口的历史内容；false = 只能搜索当前可见区 + 最近 capture 范围。
   *
   * 注意：ssh-pty 和 ssh-tmux 的 find() 对 includeScrollback 参数仅做 best-effort；
   * 实际搜索范围受限于当前 xterm buffer，不保证覆盖完整远程 scrollback。
   */
  supportsScrollback: boolean
  supportsResize: boolean
  supportsTranscriptExport: boolean
  supportsExitCode: boolean
  supportsTitle: boolean
  supportsFullscreenDetection: boolean
  supportsRename: boolean
  supportsScroll: boolean
  supportsFind: boolean
  /** 支持鼠标点击事件注入 (SGR-1006) */
  supportsMouseClick: boolean
  /** 支持鼠标滚轮事件注入 */
  supportsMouseScroll: boolean
}

// ============================================================
// IO 类型
// ============================================================

export type StartInput = {
  target?: TerminalTarget
  command: string
  args: string[]
  cwd: string
  cols: number
  rows: number
  env?: Record<string, string>
  label?: string
  ttlMs?: number
  transcript?: boolean
}

export type TerminalSession = {
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
  capabilities: ProviderCapabilities
  metadata?: SshSessionMetadata
}

export type WaitOptions = {
  text: string
  regex?: boolean
  timeoutMs: number
  caseSensitive?: boolean
}

export type WaitStableOptions = {
  idleMs: number
  timeoutMs: number
  /** 超时后默认返回当前快照；严格调用方可设为 false 保留 SESSION_TIMEOUT 抛错语义。 */
  snapshotOnTimeout?: boolean
}

export type ExportOptions = {
  redact: boolean
  format: "text" | "jsonl" | "markdown"
  includeSnapshots?: boolean
}

export type TranscriptExport = {
  format: string
  content: string
  path?: string
  snapshotCount: number
  eventCount: number
  redacted: boolean
}

export type FindResult = {
  row: number
  col: number
  line: string
  match: string
}

export type ScrollDirection = "up" | "down"

/** 滚动模式 */
export type ScrollMode = "program-key" | "program-mouse" | "tmux-copy"

/** 鼠标点击输入参数 (tool 层 → provider 层) */
export type MouseClickInput = {
  col: number
  row: number
  button: MouseButton
  shift?: boolean
  alt?: boolean
  ctrl?: boolean
}

/** 鼠标滚轮输入参数 (tool 层 → provider 层) */
export type MouseScrollInput = {
  col: number
  row: number
  direction: MouseScrollDirection
  mode?: ScrollMode
  shift?: boolean
  alt?: boolean
  ctrl?: boolean
}

// ============================================================
// Provider 接口
// ============================================================

export interface TerminalProvider {
  readonly name: ProviderName
  readonly capabilities: ProviderCapabilities

  start(input: StartInput): Promise<TerminalSession>
  attach?(sessionIdOrName: string): Promise<TerminalSession>
  snapshot(sessionId: string, mode?: TerminalSnapshotMode): Promise<TerminalSnapshot>
  waitForText(sessionId: string, text: string, options: WaitOptions): Promise<TerminalSnapshot>
  waitStable(sessionId: string, options: WaitStableOptions): Promise<TerminalSnapshot>
  type(sessionId: string, text: string): Promise<void>
  press(sessionId: string, keyExpr: string, parsed: ParsedKeyExpr): Promise<void>
  paste(sessionId: string, text: string, mode?: "bracketed" | "line-by-line" | "raw"): Promise<void>
  /**
   * 搜索终端屏幕内容。
   *
   * includeScrollback 语义：
   * - native-pty: 搜索完整 scrollback（实时 buffer）。
   * - tmux/ssh-tmux: 搜索 capture-pane 范围（viewport 或 full 含历史）。
   * - ssh-pty: 搜索实时 buffer（等同于 native-pty）。
   *
   * 不支持 scrollback 的 provider 会在 capabilities 中标记 supportsScrollback: false。
   */
  find?(sessionId: string, pattern: string, regex?: boolean, includeScrollback?: boolean): Promise<FindResult[]>
  scroll?(sessionId: string, direction: ScrollDirection, lines: number, mode?: ScrollMode): Promise<void>
  resize?(sessionId: string, cols: number, rows: number): Promise<void>
  rename?(sessionId: string, label: string): Promise<void>
  /** 注入鼠标点击事件 (SGR-1006 press + release) */
  mouseClick?(sessionId: string, input: MouseClickInput): Promise<void>
  /** 注入鼠标滚轮事件 (SGR-1006) */
  mouseScroll?(sessionId: string, input: MouseScrollInput): Promise<void>
  kill(sessionId: string): Promise<void>
  exportTranscript(sessionId: string, options: ExportOptions): Promise<TranscriptExport>
  list?(): Promise<TerminalSession[]>
  isAvailable(): Promise<boolean>
  /** 检查 provider 内部是否仍有指定 sessionId 的记录 */
  hasSession(sessionId: string): boolean
  /** 返回当前所有活跃 session 的 providerSessionId 列表 */
  listActiveSessionIds(): string[]
}
