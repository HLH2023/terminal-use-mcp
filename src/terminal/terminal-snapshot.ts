/**
 * TerminalSnapshot 类型定义
 *
 * 所有 provider 返回的统一屏幕快照格式
 */

import type { RiskSignal } from "./confirm-detection.js"

export type TerminalSnapshotMode = "viewport" | "full"

export type Highlight = {
  row: number
  colStart: number
  colEnd: number
  text: string
  kind: "inverse" | "selection" | "active" | "unknown"
}

export type TerminalSnapshot = {
  /**
   * snapshot 输入模式，仅用于类型层表达调用意图。
   * createSnapshot 不会把该字段写入返回值，避免观察结果混入请求参数。
   */
  mode?: TerminalSnapshotMode
  sessionId: string
  screen: string
  cursor: { x: number; y: number }
  cols: number
  rows: number
  /**
   * 当前缓冲区中除可视窗口外的历史行数量。
   * agent 可据此判断是否需要再次以 mode="full" 拉取完整 scrollback。
   */
  scrollbackLineCount: number
  status: "starting" | "running" | "exited" | "killed" | "error"
  changed?: boolean
  exitCode?: number | null
  title?: string
  isFullscreen?: boolean
  highlights?: Highlight[]
  riskSignals?: RiskSignal[]
  /**
   * wait_stable 超时时的软失败标记。
   *
   * 终端输出持续刷新时（如 curses/Ink TUI 轮询渲染）可能永远无法满足“稳定”判定；
   * 此时返回当前可观察屏幕，并用该字段提示调用方：本快照可用，但未确认稳定。
   */
  timedOut?: boolean
  timestamp: string
  observationTrust: "untrusted"
}

type CreateSnapshotInput = Omit<
  TerminalSnapshot,
  "timestamp" | "observationTrust" | "mode" | "scrollbackLineCount"
> & {
  scrollbackLineCount?: number
}

/**
 * 创建 TerminalSnapshot 的工厂函数
 */
export function createSnapshot(partial: CreateSnapshotInput): TerminalSnapshot {
  return {
    ...partial,
    scrollbackLineCount: partial.scrollbackLineCount ?? 0,
    timestamp: new Date().toISOString(),
    observationTrust: "untrusted",
  }
}
