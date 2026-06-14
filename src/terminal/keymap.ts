/**
 * 按键映射 — 支持任意按键组合的解析与编码
 *
 * 设计思路:
 *  - 用 parseKeyExpr() 解析任意按键表达式, 不依赖白名单校验
 *  - 支持格式: "ctrl+a" / "ctrl+shift+a" / "alt+enter" / "shift+tab" / "f1" / "ctrl+f1"
 *  - 保留向后兼容: "ctrl-c" / "up" / "enter" 等旧连字符格式继续工作
 *  - 修饰键用 SGR 编码 (CSI … modifier) 保证 xterm-256mode 兼容
 *
 * 参考来源:
 *  - tui-use (https://github.com/onesuper/tui-use, MIT License) 的 KEY_MAP 参考实现
 *    按键命名约定 (arrow_up / page_up 等) 和 CLI press 参数格式系参考 tui-use 设计;
 *    本文件为独立实现, 非代码复制。
 *  - xterm.js 的 C0/C1/SGR 编码规范 (https://invisible-island.net/xterm/ctlseqs/ctlseqs.html)
 *  - tmux send-keys 的按键名映射
 */

// ============================================================
// 1. 基础按键 → ANSI escape sequence (C0 / CSI / SS3)
// ============================================================

/** ctrl+a ~ ctrl+z → C0 控制字符 */
const CTRL_KEY_MAP: Record<string, string> = {
  a: "\x01", b: "\x02", c: "\x03", d: "\x04",
  e: "\x05", f: "\x06", g: "\x07", h: "\x08",
  i: "\x09", j: "\x0a", k: "\x0b", l: "\x0c",
  m: "\x0d", n: "\x0e", o: "\x0f", p: "\x10",
  q: "\x11", r: "\x12", s: "\x13", t: "\x14",
  u: "\x15", v: "\x16", w: "\x17", x: "\x18",
  y: "\x19", z: "\x1a",
  // 特殊: [ \ ] ^ _ 对应 ESC 序列, 不是标准可打印字母, 保守处理
  "[": "\x1b", "\\": "\x1c", "]": "\x1d", "^": "\x1e", "_": "\x1f",
}

/** 功能键 → CSI/SS3 序列 */
const FN_KEY_MAP: Record<string, string> = {
  f1: "\x1bOP", f2: "\x1bOQ", f3: "\x1bOR", f4: "\x1bOS",
  f5: "\x1b[15~", f6: "\x1b[17~", f7: "\x1b[18~", f8: "\x1b[19~",
  f9: "\x1b[20~", f10: "\x1b[21~",
  f11: "\x1b[23~", f12: "\x1b[24~",
}

/** 命名按键 (无修饰) → ANSI 序列 */
const NAMED_KEY_MAP: Record<string, string> = {
  enter: "\r",
  tab: "\t",
  escape: "\x1b",
  backspace: "\x7f",
  delete: "\x1b[3~",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  home: "\x1b[H",
  end: "\x1b[F",
  pageup: "\x1b[5~",
  pagedown: "\x1b[6~",
  space: " ",
  insert: "\x1b[2~",
}

/**
 * C0 控制码类命名按键 → 修饰键场景下的 CSI 等效序列
 *
 * enter/tab/escape/backspace 的基础序列是 C0 控制码 (如 \r, \t)，
 * 没有 CSI 结构，无法套 SGR 修饰符。
 * 修饰键场景下需要用 CSI 等效编码，如 enter → ESC [ 13 ~。
 */
const C0_TO_CSI_EQUIV: Record<string, string> = {
  enter: "\x1b[13~",
  tab: "\x1b[9~",
  escape: "\x1b[27~",
  backspace: "\x1b[127~",
  space: "\x1b[32~",
}

// ============================================================
// 2. 修饰键 SSG 编码 (xterm SGR 修饰符方案)
// ============================================================

/**
 * SGR 修饰符值 — 用于 CSI <params> ; <modifier> ~ 或 CSI <params> ; <modifier> A-D 等序列
 *
 * 修饰符位: Shift=1, Alt=2, Ctrl=4
 * 组合值: shift=1, alt=2, shift+alt=3, ctrl=4, shift+ctrl=5, alt+ctrl=6, shift+alt+ctrl=7
 *
 * 注意: ctrl+字母 的基础序列是 C0 控制码 (非 CSI), 加 shift/alt 修饰时
 * 需要用不同编码方式。此处保守处理: ctrl+字母 只输出 C0 控制码 (无修饰),
 * 因为大多数 TUI 程序不支持 ctrl+shift+字母。
 */
const MODIFIER_MAP: Record<string, number> = {
  shift: 1,
  alt: 2,
  ctrl: 4,
}

/** 计算 SGR 修饰符值 */
function computeModifier(modifiers: string[]): number {
  let value = 0
  for (const mod of modifiers) {
    const bit = MODIFIER_MAP[mod]
    if (bit !== undefined) value += bit
  }
  return value + 1 // SGR 修饰符是 1-based (1=none, 2=shift, ...)
}

// ============================================================
// 3. 修饰键 + 命名/功能键 → 带修饰的 CSI 序列
// ============================================================

/**
 * 对命名/功能键应用修饰键, 生成 SGR 编码
 *
 * 格式: ESC [ <params> ; <modifier> <final>
 * 例: shift+tab → ESC [ 1 ; 2 Z
 *     alt+up    → ESC [ 1 ; 3 A
 *     ctrl+f1   → ESC O 5 P (SS3 for F1-F4, CSI for F5+)
 */
function applyModifierToSequence(baseSeq: string, modifier: number): string {
  // 命名键 (up/down/left/right/home/end/insert/delete/pageup/pagedown) → CSI ~ 或 CSI letter
  // 功能键 F1-F4 → SS3 (ESC O P/Q/R/S)
  // 功能键 F5+   → CSI ~

  // F1-F4: ESC O P/Q/R/S → 修饰版本: ESC O <modifier> P/Q/R/S
  const ss3Match = baseSeq.match(/^\x1bO([PQRS])$/)
  if (ss3Match) {
    // SS3 修饰键编码: ESC O <modifier_digit> <final>
    return `\x1bO${modifier}${ss3Match[1]}`
  }

  // CSI 序列: ESC [ <params> ~ 或 ESC [ <letter>
  const csiMatch = baseSeq.match(/^\x1b\[([0-9]*)(~?)([A-Za-z])?$/)
  if (csiMatch) {
    const params = csiMatch[1]
    const tildeOrLetter = csiMatch[2] || csiMatch[3]

    if (tildeOrLetter === "~") {
      // ESC [ <n> ~ → ESC [ <n> ; <modifier> ~
      return `\x1b[${params};${modifier}~`
    }
    if (tildeOrLetter && tildeOrLetter !== "~") {
      // ESC [ <letter> → ESC [ 1 ; <modifier> <letter>
      return `\x1b[1;${modifier}${tildeOrLetter}`
    }
  }

  // 无法安全添加修饰键, 返回原始序列 (保守降级)
  return baseSeq
}

// ============================================================
// 4. 按键表达式解析
// ============================================================

/** 解析后的按键表达式 */
export interface ParsedKeyExpr {
  /** 修饰键列表 (已排序: ctrl, alt, shift) */
  modifiers: string[]
  /** 基础按键名 */
  key: string
}

/**
 * 解析按键表达式
 *
 * 支持格式:
 *  - "ctrl+a"          → { modifiers: ["ctrl"], key: "a" }
 *  - "ctrl+shift+f"     → { modifiers: ["ctrl", "shift"], key: "f" }
 *  - "alt+enter"        → { modifiers: ["alt"], key: "enter" }
 *  - "shift+tab"        → { modifiers: ["shift"], key: "tab" }
 *  - "f1"               → { modifiers: [], key: "f1" }
 *  - "ctrl+f1"          → { modifiers: ["ctrl"], key: "f1" }
 *  - "enter"            → { modifiers: [], key: "enter" }
 *  - "ctrl-c"           → { modifiers: ["ctrl"], key: "c" } (向后兼容旧连字符格式)
 *  - "a"                → { modifiers: [], key: "a" } (单字符)
 *
 * @throws InvalidKeyExprError 无法解析时
 */
export function parseKeyExpr(expr: string): ParsedKeyExpr {
  const normalized = expr.trim().toLowerCase()

  // 空表达式
  if (normalized.length === 0) {
    throw new InvalidKeyExprError(expr, "empty key expression")
  }

  // 用 + 或 - 分割修饰键部分 (向后兼容: "ctrl-c" = "ctrl+c")
  // 先统一把 "-" 替换为 "+" (只限修饰键前缀中的连字符)
  const plusSplit = normalized.split("+")

  if (plusSplit.length > 1) {
    // 有明确的 + 分隔修饰键
    const modifiers = plusSplit.slice(0, -1).map(m => m.trim())
    const key = plusSplit[plusSplit.length - 1].trim()
    return validateAndNormalize(expr, modifiers, key)
  }

  // 无 + 号: 检查旧连字符格式 "ctrl-c", "ctrl-d" 等
  const legacyMatch = normalized.match(/^(ctrl|alt|shift)-(.+)$/)
  if (legacyMatch) {
    return validateAndNormalize(expr, [legacyMatch[1]], legacyMatch[2])
  }

  // 无修饰键: 纯按键名
  return validateAndNormalize(expr, [], normalized)
}

/** 修饰键优先级排序: ctrl → alt → shift */
const MODIFIER_ORDER = ["ctrl", "alt", "shift"]

function validateAndNormalize(rawExpr: string, rawModifiers: string[], rawKey: string): ParsedKeyExpr {
  // 校验修饰键名称
  const validModifiers: string[] = []
  for (const mod of rawModifiers) {
    if (!MODIFIER_ORDER.includes(mod)) {
      throw new InvalidKeyExprError(rawExpr, `unknown modifier: "${mod}"`)
    }
    if (validModifiers.includes(mod)) {
      throw new InvalidKeyExprError(rawExpr, `duplicate modifier: "${mod}"`)
    }
    validModifiers.push(mod)
  }

  // 标准排序: ctrl, alt, shift
  validModifiers.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b))

  const key = rawKey

  // 校验基础按键名
  if (key.length === 0) {
    throw new InvalidKeyExprError(rawExpr, "missing key part after modifier")
  }

  // 单个字母 a-z
  if (/^[a-z]$/.test(key)) {
    return { modifiers: validModifiers, key }
  }

  // 命名按键
  if (NAMED_KEY_MAP[key] !== undefined) {
    return { modifiers: validModifiers, key }
  }

  // 功能键 f1-f12
  if (/^f([1-9]|1[0-2])$/.test(key)) {
    return { modifiers: validModifiers, key }
  }

  throw new InvalidKeyExprError(rawExpr, `unknown key: "${key}"`)
}

// ============================================================
// 5. 解析结果 → ANSI escape sequence
// ============================================================

/**
 * 将解析后的按键表达式转为 ANSI escape sequence
 *
 * 逻辑:
 *  1. ctrl + 单字母      → C0 控制码 (无修饰键附加, 保守设计)
 *  2. alt + 单字母       → ESC + 字符 (meta 键标准编码)
 *  3. 无修饰 + 命名/功能键 → 直接查表
 *  4. 修饰键 + 命名/功能键 → SGR 修饰编码
 *  5. 无修饰 + 单字母     → 原样字符
 */
export function parsedKeyToAnsiSequence(parsed: ParsedKeyExpr): string {
  const { modifiers, key } = parsed
  const hasCtrl = modifiers.includes("ctrl")
  const hasAlt = modifiers.includes("alt")
  const hasShift = modifiers.includes("shift")

  // --- ctrl + 单字母 → C0 控制码 ---
  if (hasCtrl && /^[a-z]$/.test(key) && !hasAlt && !hasShift) {
    return CTRL_KEY_MAP[key] ?? `\x01` // fallback 保守
  }

  // --- alt + 单字母 (无 ctrl/shift) → ESC + 字符 ---
  if (hasAlt && /^[a-z]$/.test(key) && !hasCtrl && !hasShift) {
    return `\x1b${key}`
  }

  // --- ctrl+alt + 单字母 → ESC + C0 (meta+ctrl, 少见但 Ink 支持) ---
  if (hasCtrl && hasAlt && /^[a-z]$/.test(key) && !hasShift) {
    const c0 = CTRL_KEY_MAP[key] ?? `\x01`
    return `\x1b${c0}`
  }

  // --- 单字母无修饰 → 原字符 ---
  if (modifiers.length === 0 && /^[a-z]$/.test(key)) {
    return key
  }

  // --- shift + 单字母 → 大写字母 ---
  if (hasShift && !hasCtrl && !hasAlt && /^[a-z]$/.test(key)) {
    return key.toUpperCase()
  }

  // --- 无修饰 + 命名/功能键 → 直接查表 ---
  if (modifiers.length === 0) {
    if (NAMED_KEY_MAP[key] !== undefined) return NAMED_KEY_MAP[key]
    if (FN_KEY_MAP[key] !== undefined) return FN_KEY_MAP[key]
  }

  // 修饰键 + 命名/功能键 → SGR 修饰编码
  const baseSeq = NAMED_KEY_MAP[key] ?? FN_KEY_MAP[key]
  if (baseSeq !== undefined && modifiers.length > 0) {
    const csiEquiv = C0_TO_CSI_EQUIV[key]
    const effectiveBaseSeq = csiEquiv ?? baseSeq
    if (hasAlt || hasShift) {
      const modValue = computeModifier(modifiers)
      return applyModifierToSequence(effectiveBaseSeq, modValue)
    }
    if (hasCtrl) {
      const modValue = computeModifier(modifiers)
      return applyModifierToSequence(effectiveBaseSeq, modValue)
    }
    return baseSeq
  }

  // 兜底: 不应该到这里
  throw new InvalidKeyExprError(
    `modifiers=${modifiers.join("+")} + key=${key}`,
    "unable to encode key expression",
  )
}

// ============================================================
// 6. 便捷函数 — 从字符串直接到 ANSI 序列
// ============================================================

/**
 * 将按键表达式转为 ANSI escape sequence (便捷入口)
 *
 * @throws InvalidKeyExprError 无法解析时
 */
export function keyExprToAnsiSequence(expr: string): string {
  return parsedKeyToAnsiSequence(parseKeyExpr(expr))
}

// ============================================================
// 7. 解析结果 → tmux send-keys 名称
// ============================================================

/** 命名按键 → tmux 键名 */
const TMUX_NAMED_MAP: Record<string, string> = {
  enter: "Enter",
  tab: "Tab",
  escape: "Escape",
  backspace: "BSpace",
  delete: "Delete",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  space: "Space",
  insert: "Insert",
}

/** 功能键 → tmux 键名 */
const TMUX_FN_MAP: Record<string, string> = {
  f1: "F1", f2: "F2", f3: "F3", f4: "F4",
  f5: "F5", f6: "F6", f7: "F7", f8: "F8",
  f9: "F9", f10: "F10", f11: "F11", f12: "F12",
}

/**
 * 将解析后的按键表达式转为 tmux send-keys 参数
 *
 * tmux 支持修饰键前缀: C- (ctrl), M- (alt/meta), S- (shift)
 * 例: "C-c" = ctrl+c, "M-Enter" = alt+enter, "S-Tab" = shift+tab
 */
export function parsedKeyToTmuxKey(parsed: ParsedKeyExpr): string {
  const { modifiers, key } = parsed

  // 构建修饰键前缀
  let prefix = ""
  if (modifiers.includes("ctrl")) prefix += "C-"
  if (modifiers.includes("alt")) prefix += "M-"
  if (modifiers.includes("shift")) prefix += "S-"

  // 单字母
  if (/^[a-z]$/.test(key)) {
    return `${prefix}${key}`
  }

  // 命名按键
  if (TMUX_NAMED_MAP[key] !== undefined) {
    return `${prefix}${TMUX_NAMED_MAP[key]}`
  }

  // 功能键
  if (TMUX_FN_MAP[key] !== undefined) {
    return `${prefix}${TMUX_FN_MAP[key]}`
  }

  // 不应到达
  throw new InvalidKeyExprError(
    `modifiers=${modifiers.join("+")} + key=${key}`,
    "unable to map to tmux key name",
  )
}

/** 便捷入口: 按键字符串 → tmux 键名 */
export function keyExprToTmuxKey(expr: string): string {
  return parsedKeyToTmuxKey(parseKeyExpr(expr))
}

// ============================================================
// 8. 解析结果 → tui-use CLI press 参数
// 按键命名遵循 tui-use (https://github.com/onesuper/tui-use, MIT License) 约定。
// ============================================================

/** 命名按键 → tui-use 键名 (命名约定源自 tui-use) */
const TUI_USE_NAMED_MAP: Record<string, string> = {
  enter: "enter",
  tab: "tab",
  escape: "escape",
  backspace: "backspace",
  delete: "delete",
  up: "arrow_up",
  down: "arrow_down",
  left: "arrow_left",
  right: "arrow_right",
  home: "home",
  end: "end",
  pageup: "page_up",
  pagedown: "page_down",
  space: "space",
  insert: "insert",
}

/** 功能键 → tui-use 键名 */
const TUI_USE_FN_MAP: Record<string, string> = {
  f1: "f1", f2: "f2", f3: "f3", f4: "f4",
  f5: "f5", f6: "f6", f7: "f7", f8: "f8",
  f9: "f9", f10: "f10", f11: "f11", f12: "f12",
}

/**
 * 将解析后的按键表达式转为 tui-use CLI press 参数
 *
 * tui-use 格式: "ctrl+c", "alt+enter", "shift+tab" 等
 * 与输入表达式格式基本相同, 只是连字符 → 加号
 */
export function parsedKeyToTuiUseKey(parsed: ParsedKeyExpr): string {
  const { modifiers, key } = parsed

  // 单字母
  if (/^[a-z]$/.test(key)) {
    if (modifiers.length > 0) {
      return `${modifiers.join("+")}+${key}`
    }
    return key
  }

  // 命名按键
  if (TUI_USE_NAMED_MAP[key] !== undefined) {
    const tuiKey = TUI_USE_NAMED_MAP[key]
    if (modifiers.length > 0) {
      return `${modifiers.join("+")}+${tuiKey}`
    }
    return tuiKey
  }

  // 功能键
  if (TUI_USE_FN_MAP[key] !== undefined) {
    const tuiKey = TUI_USE_FN_MAP[key]
    if (modifiers.length > 0) {
      return `${modifiers.join("+")}+${tuiKey}`
    }
    return tuiKey
  }

  throw new InvalidKeyExprError(
    `modifiers=${modifiers.join("+")} + key=${key}`,
    "unable to map to tui-use key name",
  )
}

/** 便捷入口: 按键字符串 → tui-use 键名 */
export function keyExprToTuiUseKey(expr: string): string {
  return parsedKeyToTuiUseKey(parseKeyExpr(expr))
}

// ============================================================
// 9. 向后兼容: 旧 TerminalKey 类型 + isValidKey
// ============================================================

/**
 * 旧类型别名 — 保持向后兼容
 *
 * @deprecated 新代码应使用 string 格式的按键表达式, 如 "ctrl+a", "f1", "alt+enter"
 */
export type TerminalKey =
  | "enter" | "tab" | "escape" | "backspace" | "delete"
  | "ctrl-c" | "ctrl-d" | "ctrl-l"
  | "ctrl-a" | "ctrl-b" | "ctrl-e" | "ctrl-f" | "ctrl-g" | "ctrl-h"
  | "ctrl-i" | "ctrl-j" | "ctrl-k" | "ctrl-m" | "ctrl-n" | "ctrl-o"
  | "ctrl-p" | "ctrl-q" | "ctrl-r" | "ctrl-s" | "ctrl-t" | "ctrl-u"
  | "ctrl-v" | "ctrl-w" | "ctrl-x" | "ctrl-y" | "ctrl-z"
  | "up" | "down" | "left" | "right"
  | "home" | "end" | "pageup" | "pagedown" | "space" | "insert"
  | "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8"
  | "f9" | "f10" | "f11" | "f12"
  | "alt+enter" | "alt+tab" | "alt+up" | "alt+down" | "alt+left" | "alt+right"
  | "shift+tab" | "shift+up" | "shift+down" | "shift+left" | "shift+right"
  | "ctrl+f1" | "ctrl+f2" | "ctrl+f3" | "ctrl+f4" | "ctrl+f5" | "ctrl+f6"
  | "ctrl+f7" | "ctrl+f8" | "ctrl+f9" | "ctrl+f10" | "ctrl+f11" | "ctrl+f12"

/**
 * 旧 SUPPORTED_KEYS — 保持向后兼容, 扩展到包含 ctrl+a~z, F1~F12, 常见修饰组合
 *
 * @deprecated 新代码应使用 keyExprToAnsiSequence() / parseKeyExpr() 直接解析任意表达式
 */
export const SUPPORTED_KEYS: TerminalKey[] = [
  // 基础按键
  "enter", "tab", "escape", "backspace", "delete",
  // ctrl+字母 (全部 26 个)
  "ctrl-a", "ctrl-b", "ctrl-c", "ctrl-d",
  "ctrl-e", "ctrl-f", "ctrl-g", "ctrl-h",
  "ctrl-i", "ctrl-j", "ctrl-k", "ctrl-l",
  "ctrl-m", "ctrl-n", "ctrl-o", "ctrl-p",
  "ctrl-q", "ctrl-r", "ctrl-s", "ctrl-t",
  "ctrl-u", "ctrl-v", "ctrl-w", "ctrl-x",
  "ctrl-y", "ctrl-z",
  // 方向/导航
  "up", "down", "left", "right",
  "home", "end", "pageup", "pagedown", "insert",
  "space",
  // 功能键
  "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12",
  // 常见修饰组合
  "alt+enter", "alt+tab",
  "alt+up", "alt+down", "alt+left", "alt+right",
  "shift+tab",
  "shift+up", "shift+down", "shift+left", "shift+right",
  "ctrl+f1", "ctrl+f2", "ctrl+f3", "ctrl+f4", "ctrl+f5", "ctrl+f6",
  "ctrl+f7", "ctrl+f8", "ctrl+f9", "ctrl+f10", "ctrl+f11", "ctrl+f12",
] as const

/**
 * 校验按键表达式是否有效
 *
 * 现在基于 parseKeyExpr() 解析, 不再依赖白名单。
 * 旧白名单校验仍可用于快速判断已知按键。
 */
export function isValidKey(key: string): key is TerminalKey {
  // 先尝试解析 (支持任意组合)
  try {
    parseKeyExpr(key)
    return true
  } catch {
    return false
  }
}

// ============================================================
// 10. 旧映射函数 — 保持向后兼容, 内部切换到新解析器
// ============================================================

/**
 * 按键 → ANSI escape sequence
 *
 * @deprecated 新代码应使用 keyExprToAnsiSequence() 或 parsedKeyToAnsiSequence()
 */
export function keyToAnsiSequence(key: TerminalKey): string {
  return keyExprToAnsiSequence(key)
}

/**
 * 按键 → tmux send-keys 名称
 *
 * @deprecated 新代码应使用 keyExprToTmuxKey() 或 parsedKeyToTmuxKey()
 */
export function keyToTmuxKey(key: TerminalKey): string {
  return keyExprToTmuxKey(key)
}

/**
 * 按键 → tui-use CLI press 参数
 *
 * @deprecated 新代码应使用 keyExprToTuiUseKey() 或 parsedKeyToTuiUseKey()
 */
export function keyToTuiUseKey(key: TerminalKey): string {
  return keyExprToTuiUseKey(key)
}

// ============================================================
// 11. 错误类型
// ============================================================

/** 按键表达式解析错误 */
export class InvalidKeyExprError extends Error {
  readonly rawExpr: string
  readonly reason: string

  constructor(rawExpr: string, reason: string) {
    super(`Invalid key expression: "${rawExpr}" — ${reason}`)
    this.name = "InvalidKeyExprError"
    this.rawExpr = rawExpr
    this.reason = reason
  }
}
