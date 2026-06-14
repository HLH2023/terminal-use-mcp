/**
 * @xterm/headless 适配器
 *
 * 该类只负责把 PTY 原始输出喂给 xterm parser，并从 xterm 的公开
 * buffer API 中读取当前屏幕状态。上层 NativePtyProvider 不应直接持有
 * xterm 的 line/cell 引用，避免终端异步更新后出现悬空状态。
 */
import type { Highlight, TerminalSnapshotMode } from "./terminal-snapshot.js";
type ScreenLine = {
    text: string;
    hasContent: boolean;
};
type ScreenReadResult = {
    lines: ScreenLine[];
    cursor: {
        x: number;
        y: number;
    };
    cols: number;
    rows: number;
    scrollbackLineCount: number;
    isAltBuffer: boolean;
    title: string | undefined;
};
export declare class XtermAdapter {
    /** @xterm/headless Terminal 实例 */
    private terminal;
    /** 脏标记: 自上次 snapshot 后是否有新数据写入 */
    private dirty;
    /** 最后写入数据的时间戳 */
    private lastWriteAt;
    /** 终端标题 (OSC 0/2) */
    private title;
    /** onWriteParsed 回调的 Promise resolve 队列 */
    private writeParsedResolvers;
    /** 事件订阅句柄，dispose 时统一释放。 */
    private readonly disposables;
    /** dispose 期间用于阻止异步 addon import 回来后继续加载到已销毁终端。 */
    private disposed;
    /** Unicode addon 句柄，dispose 时主动释放，避免 fire-and-forget 加载造成生命周期泄漏。 */
    private unicodeAddon;
    constructor(cols: number, rows: number, scrollback?: number);
    /** 写入 PTY 输出数据到 xterm */
    write(data: string | Uint8Array): Promise<void>;
    /** 等待 xterm 解析完所有待处理数据 */
    private waitForParse;
    /** 读取当前屏幕缓冲区；viewport 只取可视窗口，full 才取完整 scrollback。
     *  dispose 后调用将抛出 TerminalUseError，防止调用方误用已销毁的终端数据。 */
    readScreen(mode?: TerminalSnapshotMode): ScreenReadResult;
    /** 检测屏幕高亮区域；行号必须与 readScreen(mode) 返回的 screen 行号保持一致。
     *  dispose 后调用将抛出 TerminalUseError。 */
    detectHighlights(mode?: TerminalSnapshotMode): Highlight[];
    /** 调整终端尺寸 */
    resize(cols: number, rows: number): void;
    /** 检查自 lastSnapshotTime 后是否有新数据 */
    isDirty(): boolean;
    /** 获取最后写入时间戳 (ms) */
    getLastWriteAt(): number;
    /** 获取终端标题 */
    getTitle(): string | undefined;
    /** 重置脏标记 (snapshot 后调用) */
    markClean(): void;
    /** 销毁 Terminal 实例 */
    dispose(): void;
    /** 尝试加载 Unicode 11 宽度规则；失败时静默降级到 xterm 默认规则。 */
    private loadUnicode11Addon;
    private getScreenReadRange;
    private countScrollbackLines;
    /** 将 xterm cell 属性映射为工具层高亮类别。 */
    private detectCellHighlightKind;
    /** 结束当前连续高亮片段，并把文本快照写入结果数组。 */
    private flushHighlightSpan;
}
export {};
