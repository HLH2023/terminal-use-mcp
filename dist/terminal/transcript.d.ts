/**
 * Transcript 事件录制器。
 *
 * 该录制器只负责内存中的事件追加、裁剪和导出格式化；文件落盘由上层 artifact 模块处理。
 */
/** 事件类型 */
export type TranscriptEventType = "input" | "output" | "snapshot" | "resize" | "exit";
/** 单条事件记录 */
export type TranscriptEvent = {
    /** 单调递增序号 */
    seq: number;
    /** ISO 时间戳 */
    timestamp: string;
    /** 事件类型 */
    type: TranscriptEventType;
    /** 事件数据 (raw PTY output / input sent / screen content) */
    data: string;
};
/** 导出格式 */
export type TranscriptExportFormat = "text" | "jsonl" | "markdown";
/** transcript 录制器 */
export declare class TranscriptRecorder {
    private events;
    private nextSeq;
    private sessionId;
    private maxEvents;
    constructor(sessionId: string, maxEvents?: number);
    /** 记录 PTY 输出事件 */
    recordOutput(data: string): void;
    /** 记录输入事件 */
    recordInput(data: string): void;
    /** 记录 snapshot 事件 */
    recordSnapshot(screen: string): void;
    /** 记录 resize 事件 */
    recordResize(cols: number, rows: number): void;
    /** 记录退出事件 */
    recordExit(exitCode: number | null, signal?: string): void;
    /** 获取所有事件 (用于 terminal.events tool) */
    getEvents(limit?: number, sinceSeq?: number): {
        events: TranscriptEvent[];
        totalEvents: number;
        hasMore: boolean;
    };
    /** 导出 transcript */
    export(format: TranscriptExportFormat, options?: {
        redact?: boolean;
    }): string;
    /** 获取事件总数 */
    getEventCount(): number;
    /** 获取指定范围的事件 */
    getEventsRange(fromSeq: number, toSeq: number): TranscriptEvent[];
    /** 统一追加事件并执行 FIFO 裁剪，防止长会话占用无限内存。 */
    private appendEvent;
    /** 根据导出选项复制事件，避免修改内存中的原始 transcript。 */
    private prepareEventForExport;
    /** text 格式：普通事件单行，snapshot 使用独立段落便于阅读。 */
    private exportText;
    /** markdown 格式：保留 sessionId，事件逐条分节输出。 */
    private exportMarkdown;
}
