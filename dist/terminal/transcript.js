/**
 * Transcript 事件录制器。
 *
 * 该录制器只负责内存中的事件追加、裁剪和导出格式化；文件落盘由上层 artifact 模块处理。
 */
import { redactSecrets } from "./redact.js";
const DEFAULT_MAX_EVENTS = 10_000;
const DEFAULT_GET_EVENTS_LIMIT = 50;
const MAX_GET_EVENTS_LIMIT = 500;
/** transcript 录制器 */
export class TranscriptRecorder {
    events;
    nextSeq;
    sessionId;
    maxEvents;
    constructor(sessionId, maxEvents) {
        this.events = [];
        this.nextSeq = 1;
        this.sessionId = sessionId;
        this.maxEvents = maxEvents ?? DEFAULT_MAX_EVENTS;
    }
    /** 记录 PTY 输出事件 */
    recordOutput(data) {
        this.appendEvent("output", data);
    }
    /** 记录输入事件 */
    recordInput(data) {
        this.appendEvent("input", data);
    }
    /** 记录 snapshot 事件 */
    recordSnapshot(screen) {
        this.appendEvent("snapshot", screen);
    }
    /** 记录 resize 事件 */
    recordResize(cols, rows) {
        this.appendEvent("resize", `${cols}x${rows}`);
    }
    /** 记录退出事件 */
    recordExit(exitCode, signal) {
        const exitCodeText = exitCode === null ? "null" : exitCode.toString();
        const signalText = signal === undefined ? "" : ` signal=${signal}`;
        this.appendEvent("exit", `exitCode=${exitCodeText}${signalText}`);
    }
    /** 获取所有事件 (用于 terminal.events tool) */
    getEvents(limit, sinceSeq) {
        const effectiveLimit = Math.max(0, Math.min(limit ?? DEFAULT_GET_EVENTS_LIMIT, MAX_GET_EVENTS_LIMIT));
        const filteredEvents = sinceSeq === undefined
            ? this.events
            : this.events.filter((event) => event.seq > sinceSeq);
        // 返回最近 N 条事件，按 seq 递增排列 (最早的在前)
        const events = effectiveLimit === 0 ? [] : filteredEvents.slice(-effectiveLimit);
        return {
            events,
            totalEvents: this.events.length,
            hasMore: filteredEvents.length > events.length,
        };
    }
    /** 导出 transcript */
    export(format, options) {
        const events = this.events.map((event) => this.prepareEventForExport(event, options?.redact === true));
        if (format === "jsonl") {
            return events.map((event) => JSON.stringify(event)).join("\n");
        }
        if (format === "markdown") {
            return this.exportMarkdown(events);
        }
        return this.exportText(events);
    }
    /** 获取事件总数 */
    getEventCount() {
        return this.events.length;
    }
    /** 获取指定范围的事件 */
    getEventsRange(fromSeq, toSeq) {
        return this.events.filter((event) => event.seq >= fromSeq && event.seq <= toSeq);
    }
    /** 统一追加事件并执行 FIFO 裁剪，防止长会话占用无限内存。 */
    appendEvent(type, data) {
        const event = {
            seq: this.nextSeq,
            timestamp: new Date().toISOString(),
            type,
            data,
        };
        this.nextSeq += 1;
        this.events.push(event);
        if (this.events.length > this.maxEvents) {
            this.events.shift();
        }
    }
    /** 根据导出选项复制事件，避免修改内存中的原始 transcript。 */
    prepareEventForExport(event, redact) {
        return {
            ...event,
            data: redact ? redactSecrets(event.data) : event.data,
        };
    }
    /** text 格式：普通事件单行，snapshot 使用独立段落便于阅读。 */
    exportText(events) {
        return events.map((event) => {
            if (event.type === "snapshot") {
                return `[${event.timestamp}] [snapshot]\n${event.data}`;
            }
            return `[${event.timestamp}] [${event.type}] ${event.data}`;
        }).join("\n");
    }
    /** markdown 格式：保留 sessionId，事件逐条分节输出。 */
    exportMarkdown(events) {
        const lines = [
            "## Session Transcript",
            "",
            `Session ID: ${this.sessionId}`,
            "",
            "### Events",
            "",
        ];
        for (const event of events) {
            lines.push(`#### #${event.seq} ${event.type}`);
            lines.push("");
            lines.push(`- Time: ${event.timestamp}`);
            lines.push("");
            lines.push("```text");
            lines.push(event.data);
            lines.push("```");
            lines.push("");
        }
        return lines.join("\n");
    }
}
