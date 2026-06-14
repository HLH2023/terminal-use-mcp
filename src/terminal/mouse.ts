/**
 * 鼠标事件编码 — ANSI SGR / X10 / tmux 格式
 *
 * 设计思路:
 *   - 统一的鼠标事件类型 (click / scroll)，抽象掉底层编码差异
 *   - 三种编码输出:
 *     1. ANSI SGR-1006 模式 (modern, xterm/vte/iterm2 通用)
 *     2. ANSI X10 模式 (legacy, 兼容旧终端)
 *     3. tmux 内部鼠标事件序列
 *   - 坐标系: 终端列/行 从 (1,1) 开始 (左上角)
 *
 * 参考来源:
 *   - XTerm Control Sequences (XTerm.js 源码 ctlseqs.c)
 *   - tmux input.c 鼠标序列解析/编码
 *   - https://invisible-island.net/ncurses/terminfo.ti.html (mouse protocol)
 *
 * 注意:
 *   - 大多数现代 TUI 程序 (Bubble Tea, Ink, curses) 在鼠标使能后
 *     会发送 SET_ANY_EVENT_MOUSE (\x1b[?1003h) 或 SET_BUTTON_EVENT_MOUSE (\x1b[?1002h)
 *   - 我们的 MCP tool 不会收到终端的 enable 序列 —— 我们直接注入
 *     鼠标事件序列到 PTY，子进程自行决定是否处理
 *   - 子进程必须先启用了鼠标模式 (通过 TERM=xterm-256color + SGR 扩展)
 *     才会解释这些序列；如果子进程未启鼠标，序列会被当作普通文本忽略
 */

import { InvalidMouseCoordsError } from "./errors.js"

export { InvalidMouseCoordsError } from "./errors.js"

// ============================================================
// 1. 鼠标按钮 / 动作 类型定义
// ============================================================

/** 鼠标按钮 */
export type MouseButton = "left" | "right" | "middle"

/** 鼠标滚轮方向 */
export type MouseScrollDirection = "up" | "down"

/** 鼠标点击动作 (按下/释放) */
export type MouseAction = "press" | "release"

/** 鼠标点击事件参数 */
export type MouseClickEvent = {
  /** 1-based 列号 (x) */
  col: number
  /** 1-based 行号 (y) */
  row: number
  button: MouseButton
  action: MouseAction
  /** 修饰键: shift/alt/ctrl */
  shift?: boolean
  alt?: boolean
  ctrl?: boolean
}

/** 鼠标滚轮事件参数 */
export type MouseScrollEvent = {
  /** 1-based 列号 (x), 通常是光标所在列或 1 */
  col: number
  /** 1-based 行号 (y), 通常是光标所在行或 1 */
  row: number
  direction: MouseScrollDirection
  /** 修饰键 */
  shift?: boolean
  alt?: boolean
  ctrl?: boolean
}

// ============================================================
// 2. SGR-1006 编码 (推荐, 现代终端标准)
// ============================================================

/**
 * SGR 鼠标按钮码
 *
 * SGR 模式下 Cb (button code):
 *   0 = 左键按下    1 = 中键按下    2 = 右键按下
 *   3 = 所有键释放 (无按钮)
 *   4 = 滚轮上     5 = 滚轮下
 *   32 = 拖动标志 (OR 到按钮码)
 *   修饰键: shift=4, alt=8, ctrl=16 (OR 到按钮码)
 *
 * 注意: 拖动 = press + move, 我们目前不实现拖动 (agent 不太需要)，
 * 只实现 click (press + release) 和 scroll
 */
const SGR_BUTTON_CODE: Record<MouseButton, number> = {
  left: 0,
  middle: 1,
  right: 2,
}

const SGR_SCROLL_CODE: Record<MouseScrollDirection, number> = {
  up: 64,
  down: 65,
}

/**
 * 计算 SGR 修饰键掩码
 * shift=4, alt=8, ctrl=16 — 直接到按钮码上
 */
function computeSgrModifierMask(event: { shift?: boolean; alt?: boolean; ctrl?: boolean }): number {
  let mask = 0
  if (event.shift) mask |= 4
  if (event.alt) mask |= 8
  if (event.ctrl) mask |= 16
  return mask
}

/**
 * 生成 SGR-1006 鼠标点击序列
 *
 * 格式: ESC [ < Cb ; Cx ; Cy M (按下) / ESC [ < Cb ; Cx ; Cy m (释放)
 *
 * @see https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-Mouse-Tracking
 */
export function mouseClickToSgrSequence(event: MouseClickEvent): string {
  assertMouseCoordsAtLeastOne(event.col, event.row)
  const cb = SGR_BUTTON_CODE[event.button] + computeSgrModifierMask(event)
  const cx = event.col
  const cy = event.row
  // M = 按下, m = 释放
  const final = event.action === "press" ? "M" : "m"
  return `\x1b[<${cb};${cx};${cy}${final}`
}

/**
 * 生成 SGR-1006 鼠标滚轮序列
 *
 * 滚轮事件只有按下 (M), 没有释放 (m)
 */
export function mouseScrollToSgrSequence(event: MouseScrollEvent): string {
  assertMouseCoordsAtLeastOne(event.col, event.row)
  const cb = SGR_SCROLL_CODE[event.direction] + computeSgrModifierMask(event)
  const cx = event.col
  const cy = event.row
  return `\x1b[<${cb};${cx};${cy}M`
}

// ============================================================
// 3. X10 编码 (legacy 兼容, 1-based 但 Cb/Cx/Cy 用单字节)
// ============================================================

/**
 * X10 协议鼠标序列
 *
 * 格式: ESC [ M Cb Cx Cy (各参数是单字节, 值 = 实际值 + 32)
 * - Cb: 按钮码 (与 SGR 相同 + 32)
 * - Cx: 列号 + 32
 * - Cy: 行号 + 32
 * - 限制: 坐标最大 227 (255 - 32), 超出截断
 *
 * 滚轮: button 4 (up) / 5 (down)
 */
export function mouseClickToX10Sequence(event: MouseClickEvent): string {
  assertMouseCoordsAtLeastOne(event.col, event.row)
  assertMouseCoordsWithinX10Limit(event.col, event.row)
  const cb = SGR_BUTTON_CODE[event.button] + computeSgrModifierMask(event) + 32
  const cx = event.col + 32
  const cy = event.row + 32
  return `\x1b[M${String.fromCharCode(cb)}${String.fromCharCode(cx)}${String.fromCharCode(cy)}`
}

export function mouseScrollToX10Sequence(event: MouseScrollEvent): string {
  assertMouseCoordsAtLeastOne(event.col, event.row)
  assertMouseCoordsWithinX10Limit(event.col, event.row)
  // X10 滚轮: Cb = 32 + SGR_BUTTON_CODE (64 for up, 65 for down)
  // X10 协议的 button 字段中, 滚轮的值与 SGR 一致: 64 (up) / 65 (down)
  // 但加上 32 偏移: 64+32=96 ("`") for up, 65+32=97 ("a") for down
  const cb = SGR_SCROLL_CODE[event.direction] + computeSgrModifierMask(event) + 32
  const cx = event.col + 32
  const cy = event.row + 32
  return `\x1b[M${String.fromCharCode(cb)}${String.fromCharCode(cx)}${String.fromCharCode(cy)}`
}

// ============================================================
// 4. 完整 click 序列生成 (press + release 配对)
// ============================================================

/**
 * 生成完整的鼠标点击序列 (按下 + 释放)
 *
 * 大多数 TUI 框架期望 press + release 配对；
 * 单独发送 press 会导致拖动检测误判等问题。
 * 此函数同时生成 press 和 release 两个 SGR 序列。
 */
export function mouseClickToFullSgrSequence(event: Omit<MouseClickEvent, "action">): string {
  const pressSeq = mouseClickToSgrSequence({ ...event, action: "press" })
  const releaseSeq = mouseClickToSgrSequence({ ...event, action: "release" })
  return pressSeq + releaseSeq
}

// ============================================================
// 5. tmux 鼠标序列编码
// ============================================================

/**
 * tmux 内部鼠标序列格式
 *
 * tmux 转发的鼠标事件与 SGR-1006 格式相同，
 * 但 tmux 自己需要通过 `\x1b[M` (X10) 或 SGR 接收。
 *
 * 关键: tmux 默认开启了鼠标，会拦截鼠标序列。
 * 发送到 tmux client 的 PTY 时，tmux 作为 PTY 的前端，
 * 用 `tmux send-keys -l` 传递原始字符串不行 (tmux 会解析按键名)。
 *
 * 策略: 对于 tmux provider，直接把 SGR 序列写到 tmux session 的 PTY 输入，
 * tmux 会按照当前 mouse mode 处理。多数 tmux 下的 TUI 程序需要
 * tmux set -g mouse on 才能接收鼠标事件。
 *
 * 如果 tmux mouse mode 开启了，tmux 会自己处理鼠标选择/滚动；
 * 要让子进程接收，我们写 SGR 序列到 PTY 即可 (tmux 会转发)。
 */
export function mouseClickToTmuxSequence(event: Omit<MouseClickEvent, "action">): string {
  // tmux 内部使用 SGR-1006 格式转发，同 ANSI SGR
  return mouseClickToFullSgrSequence(event)
}

export function mouseScrollToTmuxSequence(event: MouseScrollEvent): string {
  return mouseScrollToSgrSequence(event)
}

// ============================================================
// 6. Provider 鼠标能力边界
// ============================================================

/**
 * 鼠标事件能力边界
 *
 * Provider 若无法直接注入 SGR-1006 鼠标序列，应在 tool/provider 层
 * 直接返回 CAPABILITY_UNSUPPORTED，避免伪造半可用行为。
 */

// ============================================================
// 7. 坐标校验
// ============================================================

/** 校验列/行坐标, 确保 1-based 且在合理范围内 */
export function validateMouseCoords(col: number, row: number, maxCols: number, maxRows: number): void {
  if (col < 1 || row < 1) {
    throw new InvalidMouseCoordsError(col, row, "坐标必须 >= 1 (1-based)")
  }
  if (col > maxCols || row > maxRows) {
    throw new InvalidMouseCoordsError(col, row, `坐标超出终端范围 (${maxCols}x${maxRows})`)
  }
}

function assertMouseCoordsAtLeastOne(col: number, row: number): void {
  if (col < 1 || row < 1) {
    throw new InvalidMouseCoordsError(col, row, "坐标必须 >= 1 (1-based)")
  }
}

function assertMouseCoordsWithinX10Limit(col: number, row: number): void {
  if (col > 227 || row > 227) {
    throw new InvalidMouseCoordsError(col, row, "X10 坐标必须 <= 227")
  }
}
