/**
 * 终端高亮检测工具
 *
 * xterm-adapter 会负责遍历 @xterm/headless 的 cell，并把 cell 属性转换为
 * CellAttributes；本文件只保留纯函数，便于后续复用和单元测试。
 */

import type { LineHighlight } from "./screen-buffer.js"
import type { Highlight } from "./terminal-snapshot.js"

/** xterm 默认前景色索引。bold + 非默认前景色可作为 active 高亮的 best-effort 信号。 */
const DEFAULT_FOREGROUND_COLOR = 0

/** 单个 cell 的属性信息 (由 xterm-adapter 提供) */
export type CellAttributes = {
  row: number
  col: number
  char: string
  isInverse: boolean
  isBold: boolean
  isUnderline: boolean
  fg: number | undefined
  bg: number | undefined
}

/** 连续高亮段 (merge 后的结果) */
export type HighlightSpan = LineHighlight & {
  kind: Highlight["kind"]
}

/**
 * 从 cell 属性数组中检测高亮段。
 *
 * 输入通常来自按 row/col 遍历的 xterm cell；这里仍会复制并排序，保证调用方
 * 偶尔传入乱序 cells 时也能得到稳定结果。
 */
export function detectHighlights(cells: CellAttributes[]): HighlightSpan[] {
  const highlightedSpans = cells
    .filter(isCellHighlighted)
    .sort((left, right) => left.row - right.row || left.col - right.col)
    .map<HighlightSpan>((cell) => ({
      row: cell.row,
      colStart: cell.col,
      colEnd: cell.col,
      text: cell.char,
      kind: classifyHighlightKind(cell),
    }))

  return mergeHighlightSpans(highlightedSpans).filter((span) => span.text.trim().length > 0)
}

/**
 * 合并相邻同类型高亮为连续段。
 *
 * `colEnd` 使用闭区间语义，因此下一段的 `colStart` 等于上一段 `colEnd + 1`
 * 时视为连续。
 */
export function mergeHighlightSpans(spans: HighlightSpan[]): HighlightSpan[] {
  const sortedSpans = [...spans].sort((left, right) => left.row - right.row || left.colStart - right.colStart)
  const merged: HighlightSpan[] = []

  for (const span of sortedSpans) {
    const previous = merged.at(-1)

    if (previous !== undefined && previous.row === span.row && previous.colEnd + 1 === span.colStart && previous.kind === span.kind) {
      previous.colEnd = span.colEnd
      previous.text += span.text
      continue
    }

    // 复制对象，避免修改调用方传入的 span 引用。
    merged.push({ ...span })
  }

  return merged
}

/**
 * 判断 cell 是否为高亮。
 *
 * 当前只实现 Phase 2 要求的 best-effort 规则：inverse 一定算高亮；bold 且
 * 前景色不是默认色时，视为 active 高亮。selection 等更复杂信号留给后续
 * xterm-adapter 在构造 CellAttributes 时扩展。
 */
export function isCellHighlighted(cell: CellAttributes): boolean {
  if (cell.isInverse) {
    return true
  }

  return cell.isBold && cell.fg !== undefined && cell.fg !== DEFAULT_FOREGROUND_COLOR
}

/** 判断高亮类型。 */
export function classifyHighlightKind(cell: CellAttributes): Highlight["kind"] {
  if (cell.isInverse) {
    return "inverse"
  }

  if (cell.isBold && cell.fg !== undefined && cell.fg !== DEFAULT_FOREGROUND_COLOR) {
    return "active"
  }

  return "unknown"
}
