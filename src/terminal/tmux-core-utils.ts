/**
 * TmuxCore 纯算法工具函数
 *
 * 从 TmuxCore 提取的无副作用函数，便于独立测试。
 * 这些函数不依赖 session 状态，仅处理输入数据并返回结果。
 */

import type { TmuxCommandAst } from "./tmux-command-parser.js"
import type { PaneGeometry } from "../providers/tmux-core.js"

/**
 * 裁剪 screen text 到目标 pane 区域。
 *
 * @param screenText - 完整 screen 文本（换行符分隔）
 * @param geometry - pane geometry（位置和尺寸）
 * @param totalCols - screen 总列数
 * @returns 裁剪后的 screen 文本
 */
export function cropToPane(screenText: string, geometry: PaneGeometry, totalCols: number): string {
  const lines = screenText.split("\n")
  const croppedLines: string[] = []

  for (let row = geometry.top; row < geometry.top + geometry.height && row < lines.length; row += 1) {
    const line = lines[row]
    if (line === undefined) continue
    const startCol = Math.min(geometry.left, line.length)
    const endCol = Math.min(geometry.left + geometry.width, line.length)
    croppedLines.push(line.slice(startCol, endCol))
  }

  if (totalCols !== geometry.width) {
    return croppedLines.map((line) => line.padEnd(geometry.width)).join("\n")
  }

  return croppedLines.join("\n")
}

/**
 * 从 tmux 命令 AST 提取 target 字符串。
 *
 * 按 id → name → paneId → session:window → String() 优先级提取。
 *
 * @param ast - tmux 命令 AST
 * @returns target 字符串或 null
 */
export function formatTmuxTargetFromAst(ast: TmuxCommandAst): string | null {
  if (!("target" in ast) || ast.target === undefined) return null
  const target = ast.target
  if (typeof target === "object" && target !== null) {
    if ("id" in target) return target.id
    if ("name" in target) return target.name
    if ("paneId" in target) return target.paneId
    if ("session" in target && "window" in target) {
      return `${(target as { session: string; window: string }).session}:${(target as { session: string; window: string }).window}`
    }
  }
  return String(target)
}

/**
 * 解析 tmux list-panes 输出的一行 pane geometry。
 *
 * 格式：`paneId:left:top:width:height:active`
 * 可选引号包裹：`"paneId:left:top:width:height:active"`
 *
 * @param line - tmux format 输出的一行
 * @returns PaneGeometry 或 null（格式错误时）
 */
export function parsePaneGeometryLine(line: string): PaneGeometry | null {
  const stripped = stripTmuxFormatQuotes(line)
  const parts = stripped.split(":")
  if (parts.length < 6) return null

  return {
    paneId: parts[0] ?? "",
    left: parseIntegerField(parts[1]),
    top: parseIntegerField(parts[2]),
    width: parseIntegerField(parts[3]),
    height: parseIntegerField(parts[4]),
    active: (parts[5] ?? "0") === "1",
  }
}

function stripTmuxFormatQuotes(line: string): string {
  const trimmed = line.trim()
  if (trimmed.length >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseIntegerField(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "0", 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * 污染检测 heuristic 纯逻辑。
 *
 * 三条检测规则：
 * 1. 单行重复字符比例异常高（ratio > 0.6 且 count > 20）
 * 2. XtermAdapter 维度与 pane geometry 不一致（差异 > 2）
 * 3. 非打印控制字符残留（count > 5）
 *
 * @param screenText - 完整 screen 文本
 * @param cols - adapter 报告的列数
 * @param rows - adapter 报告的行数
 * @param activeGeometry - 当前 active pane 的 geometry（可能为 null）
 * @returns 检测到的污染类型列表（空 = 无污染）
 */
export type PollutionType = "high-repeat-ratio" | "dimension-mismatch" | "control-char-residual"

export function detectPollutionHeuristics(
  screenText: string,
  cols: number,
  rows: number,
  activeGeometry: PaneGeometry | null,
): PollutionType[] {
  const detected: PollutionType[] = []
  const lines = screenText.split("\n")

  // 检测 1: 单行重复字符比例异常高
  for (const line of lines) {
    if (line.length < 10) continue
    const charCounts = new Map<string, number>()
    for (const ch of line) {
      if (ch === " ") continue
      charCounts.set(ch, (charCounts.get(ch) ?? 0) + 1)
    }
    const maxCount = Math.max(...charCounts.values())
    const ratio = maxCount / line.length
    if (ratio > 0.6 && maxCount > 20) {
      detected.push("high-repeat-ratio")
      break
    }
  }

  // 检测 2: 维度不一致
  if (activeGeometry !== null) {
    if (Math.abs(activeGeometry.width - cols) > 2 || Math.abs(activeGeometry.height - rows) > 2) {
      detected.push("dimension-mismatch")
    }
  }

  // 检测 3: 非打印控制字符残留
  const controlResidual = screenText.match(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g)
  if (controlResidual !== null && controlResidual.length > 5) {
    detected.push("control-char-residual")
  }

  return detected
}
