/**
 * NativePtyProvider
 *
 * 基于 node-pty + @xterm/headless 的本地终端 Provider。
 * 这里负责 PTY 生命周期、输入输出串联、屏幕快照、等待轮询和 transcript 导出；
 * 安全策略中的启动命令/cwd 校验由上层 SessionManager 负责，本层只在输入侧拒绝
 * 明显的 secret/超大 paste，避免把敏感内容写入交互式终端。
 */
import type { ExportOptions, FindResult, MouseClickInput, MouseScrollInput, ProviderCapabilities, ProviderName, ScrollDirection, StartInput, TerminalProvider, TerminalSession, TranscriptExport, WaitOptions, WaitStableOptions } from "./provider.js";
import type { Logger } from "../logger.js";
import type { ParsedKeyExpr } from "../terminal/keymap.js";
import type { TerminalSnapshot, TerminalSnapshotMode } from "../terminal/terminal-snapshot.js";
export declare class NativePtyProvider implements TerminalProvider {
    readonly name: ProviderName;
    readonly capabilities: ProviderCapabilities;
    private sessions;
    private logger;
    constructor(logger: Logger);
    /**
     * node-pty 是 native addon，部分环境可能安装但运行时加载失败；
     * 可用性检查通过共享 loader 动态 import 并缓存结果，避免 server 启动阶段因顶层 import 崩溃。
     */
    isAvailable(): Promise<boolean>;
    start(input: StartInput): Promise<TerminalSession>;
    snapshot(sessionId: string, mode?: TerminalSnapshotMode): Promise<TerminalSnapshot>;
    waitForText(sessionId: string, text: string, options: WaitOptions): Promise<TerminalSnapshot>;
    waitStable(sessionId: string, options: WaitStableOptions): Promise<TerminalSnapshot>;
    type(sessionId: string, text: string): Promise<void>;
    press(sessionId: string, keyExpr: string, parsed: ParsedKeyExpr): Promise<void>;
    paste(sessionId: string, text: string, mode?: "bracketed" | "line-by-line" | "raw"): Promise<void>;
    find(sessionId: string, pattern: string, regex?: boolean, includeScrollback?: boolean): Promise<FindResult[]>;
    scroll(sessionId: string, direction: ScrollDirection, lines: number): Promise<void>;
    mouseClick(sessionId: string, input: MouseClickInput): Promise<void>;
    mouseScroll(sessionId: string, input: MouseScrollInput): Promise<void>;
    resize(sessionId: string, cols: number, rows: number): Promise<void>;
    kill(sessionId: string): Promise<void>;
    hasSession(sessionId: string): boolean;
    listActiveSessionIds(): string[];
    exportTranscript(sessionId: string, options: ExportOptions): Promise<TranscriptExport>;
    private getSession;
    private getWritableSession;
    private toTerminalSession;
    private assertPasteSafe;
    private countSnapshotEvents;
    private stringifyUnknownError;
}
