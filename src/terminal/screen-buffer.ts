/**
 * 终端屏幕缓冲区抽象
 *
 * 该文件只描述“屏幕快照后的纯数据结构”，避免上层代码直接依赖
 * @xterm/headless 的 buffer / line / cell API。后续 xterm-adapter 负责把
 * xterm 内部对象转换为这里的 ScreenBuffer。
 */

/** 屏幕缓冲区行数据 */
export type ScreenLine = {
  /** 行文本内容 (已 trim trailing spaces) */
  text: string
  /** 此行是否有任何非空内容 */
  hasContent: boolean
}

/** 屏幕缓冲区快照 */
export type ScreenBuffer = {
  sessionId: string
  /** 屏幕行数据 (0-indexed, 从顶部开始) */
  lines: ScreenLine[]
  /** 光标位置 */
  cursor: { x: number; y: number }
  /** 终端列数 */
  cols: number
  /** 终端行数 */
  rows: number
  /** 是否处于 alternate buffer (fullscreen) */
  isAltBuffer: boolean
  /** 终端标题 (OSC 0/2) */
  title?: string
  /** 截取时的时间戳 */
  timestamp: string
}

/** 行高亮信息 */
export type LineHighlight = {
  row: number
  colStart: number
  colEnd: number
  text: string
  kind: "inverse" | "selection" | "active" | "unknown"
}

/**
 * 从 ScreenBuffer 提取纯文本屏幕。
 *
 * 规则：逐行读取 `text` 并以换行连接，但去掉尾部的空行，避免快照字符串
 * 因终端 viewport 底部填充而产生无意义的尾随换行。
 */
export function screenBufferToString(buffer: ScreenBuffer): string {
  let lastTextRow = -1

  for (let row = buffer.lines.length - 1; row >= 0; row -= 1) {
    if (buffer.lines[row]?.text.length !== 0) {
      lastTextRow = row
      break
    }
  }

  if (lastTextRow === -1) {
    return ""
  }

  return buffer.lines.slice(0, lastTextRow + 1).map((line) => line.text).join("\n")
}

/**
 * 从 ScreenBuffer 检测有内容行的范围。
 *
 * 若屏幕完全为空，返回 `-1` 表示未找到内容行；调用方可据此区分“空屏幕”
 * 与“内容从第 0 行开始”。
 */
export function getContentRange(buffer: ScreenBuffer): { firstRow: number; lastRow: number } {
  let firstRow = -1
  let lastRow = -1

  for (let row = 0; row < buffer.lines.length; row += 1) {
    if (buffer.lines[row]?.hasContent === true) {
      firstRow = row
      break
    }
  }

  for (let row = buffer.lines.length - 1; row >= 0; row -= 1) {
    if (buffer.lines[row]?.hasContent === true) {
      lastRow = row
      break
    }
  }

  return { firstRow, lastRow }
}

/**
 * 创建空 ScreenBuffer。
 *
 * 用于 session 刚创建、provider 尚未产生输出或失败兜底路径。所有行都显式
 * 标记为空，光标固定在左上角。
 */
export function createEmptyScreenBuffer(sessionId: string, cols: number, rows: number): ScreenBuffer {
  return {
    sessionId,
    lines: Array.from({ length: rows }, () => ({ text: "", hasContent: false })),
    cursor: { x: 0, y: 0 },
    cols,
    rows,
    isAltBuffer: false,
    timestamp: new Date().toISOString(),
  }
}

/**
 * 判断屏幕是否像 fullscreen TUI。
 *
 * 优先信任 alternate buffer；若无法获得 alt buffer 信号，则使用启发式：当前
 * viewport 大部分行都有内容，且光标不在首行。该判断只作为 best-effort，不应
 * 被用于安全决策。
 */
export function isFullscreenHeuristic(buffer: ScreenBuffer): boolean {
  if (buffer.isAltBuffer) {
    return true
  }

  const contentLineCount = buffer.lines.filter((line) => line.hasContent).length
  return contentLineCount > buffer.rows * 0.8 && buffer.cursor.y > 0
}
