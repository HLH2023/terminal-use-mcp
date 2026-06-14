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
/** 解析后的按键表达式 */
export interface ParsedKeyExpr {
    /** 修饰键列表 (已排序: ctrl, alt, shift) */
    modifiers: string[];
    /** 基础按键名 */
    key: string;
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
export declare function parseKeyExpr(expr: string): ParsedKeyExpr;
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
export declare function parsedKeyToAnsiSequence(parsed: ParsedKeyExpr): string;
/**
 * 将按键表达式转为 ANSI escape sequence (便捷入口)
 *
 * @throws InvalidKeyExprError 无法解析时
 */
export declare function keyExprToAnsiSequence(expr: string): string;
/**
 * 将解析后的按键表达式转为 tmux send-keys 参数
 *
 * tmux 支持修饰键前缀: C- (ctrl), M- (alt/meta), S- (shift)
 * 例: "C-c" = ctrl+c, "M-Enter" = alt+enter, "S-Tab" = shift+tab
 */
export declare function parsedKeyToTmuxKey(parsed: ParsedKeyExpr): string;
/** 便捷入口: 按键字符串 → tmux 键名 */
export declare function keyExprToTmuxKey(expr: string): string;
/**
 * 将解析后的按键表达式转为 tui-use CLI press 参数
 *
 * tui-use 格式: "ctrl+c", "alt+enter", "shift+tab" 等
 * 与输入表达式格式基本相同, 只是连字符 → 加号
 */
export declare function parsedKeyToTuiUseKey(parsed: ParsedKeyExpr): string;
/** 便捷入口: 按键字符串 → tui-use 键名 */
export declare function keyExprToTuiUseKey(expr: string): string;
/**
 * 旧类型别名 — 保持向后兼容
 *
 * @deprecated 新代码应使用 string 格式的按键表达式, 如 "ctrl+a", "f1", "alt+enter"
 */
export type TerminalKey = "enter" | "tab" | "escape" | "backspace" | "delete" | "ctrl-c" | "ctrl-d" | "ctrl-l" | "ctrl-a" | "ctrl-b" | "ctrl-e" | "ctrl-f" | "ctrl-g" | "ctrl-h" | "ctrl-i" | "ctrl-j" | "ctrl-k" | "ctrl-m" | "ctrl-n" | "ctrl-o" | "ctrl-p" | "ctrl-q" | "ctrl-r" | "ctrl-s" | "ctrl-t" | "ctrl-u" | "ctrl-v" | "ctrl-w" | "ctrl-x" | "ctrl-y" | "ctrl-z" | "up" | "down" | "left" | "right" | "home" | "end" | "pageup" | "pagedown" | "space" | "insert" | "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8" | "f9" | "f10" | "f11" | "f12" | "alt+enter" | "alt+tab" | "alt+up" | "alt+down" | "alt+left" | "alt+right" | "shift+tab" | "shift+up" | "shift+down" | "shift+left" | "shift+right" | "ctrl+f1" | "ctrl+f2" | "ctrl+f3" | "ctrl+f4" | "ctrl+f5" | "ctrl+f6" | "ctrl+f7" | "ctrl+f8" | "ctrl+f9" | "ctrl+f10" | "ctrl+f11" | "ctrl+f12";
/**
 * 旧 SUPPORTED_KEYS — 保持向后兼容, 扩展到包含 ctrl+a~z, F1~F12, 常见修饰组合
 *
 * @deprecated 新代码应使用 keyExprToAnsiSequence() / parseKeyExpr() 直接解析任意表达式
 */
export declare const SUPPORTED_KEYS: TerminalKey[];
/**
 * 校验按键表达式是否有效
 *
 * 现在基于 parseKeyExpr() 解析, 不再依赖白名单。
 * 旧白名单校验仍可用于快速判断已知按键。
 */
export declare function isValidKey(key: string): key is TerminalKey;
/**
 * 按键 → ANSI escape sequence
 *
 * @deprecated 新代码应使用 keyExprToAnsiSequence() 或 parsedKeyToAnsiSequence()
 */
export declare function keyToAnsiSequence(key: TerminalKey): string;
/**
 * 按键 → tmux send-keys 名称
 *
 * @deprecated 新代码应使用 keyExprToTmuxKey() 或 parsedKeyToTmuxKey()
 */
export declare function keyToTmuxKey(key: TerminalKey): string;
/**
 * 按键 → tui-use CLI press 参数
 *
 * @deprecated 新代码应使用 keyExprToTuiUseKey() 或 parsedKeyToTuiUseKey()
 */
export declare function keyToTuiUseKey(key: TerminalKey): string;
/** 按键表达式解析错误 */
export declare class InvalidKeyExprError extends Error {
    readonly rawExpr: string;
    readonly reason: string;
    constructor(rawExpr: string, reason: string);
}
