/**
 * 终端高亮检测工具
 *
 * xterm-adapter 会负责遍历 @xterm/headless 的 cell，并把 cell 属性转换为
 * CellAttributes；本文件只保留纯函数，便于后续复用和单元测试。
 */
import type { LineHighlight } from "./screen-buffer.js";
import type { Highlight } from "./terminal-snapshot.js";
/** 单个 cell 的属性信息 (由 xterm-adapter 提供) */
export type CellAttributes = {
    row: number;
    col: number;
    char: string;
    isInverse: boolean;
    isBold: boolean;
    isUnderline: boolean;
    fg: number | undefined;
    bg: number | undefined;
};
/** 连续高亮段 (merge 后的结果) */
export type HighlightSpan = LineHighlight & {
    kind: Highlight["kind"];
};
/**
 * 从 cell 属性数组中检测高亮段。
 *
 * 输入通常来自按 row/col 遍历的 xterm cell；这里仍会复制并排序，保证调用方
 * 偶尔传入乱序 cells 时也能得到稳定结果。
 */
export declare function detectHighlights(cells: CellAttributes[]): HighlightSpan[];
/**
 * 合并相邻同类型高亮为连续段。
 *
 * `colEnd` 使用闭区间语义，因此下一段的 `colStart` 等于上一段 `colEnd + 1`
 * 时视为连续。
 */
export declare function mergeHighlightSpans(spans: HighlightSpan[]): HighlightSpan[];
/**
 * 判断 cell 是否为高亮。
 *
 * 当前实现的 best-effort 规则：inverse 一定算高亮；bold 且
 * 前景色不是默认色时，视为 active 高亮。selection 等更复杂信号留给后续
 * xterm-adapter 在构造 CellAttributes 时扩展。
 */
export declare function isCellHighlighted(cell: CellAttributes): boolean;
/** 判断高亮类型。 */
export declare function classifyHighlightKind(cell: CellAttributes): Highlight["kind"];
