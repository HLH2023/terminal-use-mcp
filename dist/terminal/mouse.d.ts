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
export { InvalidMouseCoordsError } from "./errors.js";
/** 鼠标按钮 */
export type MouseButton = "left" | "right" | "middle";
/** 鼠标滚轮方向 */
export type MouseScrollDirection = "up" | "down";
/** 鼠标点击动作 (按下/释放) */
export type MouseAction = "press" | "release";
/** 鼠标点击事件参数 */
export type MouseClickEvent = {
    /** 1-based 列号 (x) */
    col: number;
    /** 1-based 行号 (y) */
    row: number;
    button: MouseButton;
    action: MouseAction;
    /** 修饰键: shift/alt/ctrl */
    shift?: boolean;
    alt?: boolean;
    ctrl?: boolean;
};
/** 鼠标滚轮事件参数 */
export type MouseScrollEvent = {
    /** 1-based 列号 (x), 通常是光标所在列或 1 */
    col: number;
    /** 1-based 行号 (y), 通常是光标所在行或 1 */
    row: number;
    direction: MouseScrollDirection;
    /** 修饰键 */
    shift?: boolean;
    alt?: boolean;
    ctrl?: boolean;
};
/**
 * 生成 SGR-1006 鼠标点击序列
 *
 * 格式: ESC [ < Cb ; Cx ; Cy M (按下) / ESC [ < Cb ; Cx ; Cy m (释放)
 *
 * @see https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-Mouse-Tracking
 */
export declare function mouseClickToSgrSequence(event: MouseClickEvent): string;
/**
 * 生成 SGR-1006 鼠标滚轮序列
 *
 * 滚轮事件只有按下 (M), 没有释放 (m)
 */
export declare function mouseScrollToSgrSequence(event: MouseScrollEvent): string;
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
export declare function mouseClickToX10Sequence(event: MouseClickEvent): string;
export declare function mouseScrollToX10Sequence(event: MouseScrollEvent): string;
/**
 * 生成完整的鼠标点击序列 (按下 + 释放)
 *
 * 大多数 TUI 框架期望 press + release 配对；
 * 单独发送 press 会导致拖动检测误判等问题。
 * 此函数同时生成 press 和 release 两个 SGR 序列。
 */
export declare function mouseClickToFullSgrSequence(event: Omit<MouseClickEvent, "action">): string;
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
export declare function mouseClickToTmuxSequence(event: Omit<MouseClickEvent, "action">): string;
export declare function mouseScrollToTmuxSequence(event: MouseScrollEvent): string;
/**
 * 鼠标事件能力边界
 *
 * Provider 若无法直接注入 SGR-1006 鼠标序列，应在 tool/provider 层
 * 直接返回 CAPABILITY_UNSUPPORTED，避免伪造半可用行为。
 */
/** 校验列/行坐标, 确保 1-based 且在合理范围内 */
export declare function validateMouseCoords(col: number, row: number, maxCols: number, maxRows: number): void;
