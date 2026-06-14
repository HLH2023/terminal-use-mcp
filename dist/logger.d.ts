/**
 * 结构化日志 — 仅输出到 stderr
 *
 * stdout 由 MCP 协议独占，任何日志不得写入 stdout。
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
export interface Logger {
    debug(msg: string, data?: Record<string, unknown>): void;
    info(msg: string, data?: Record<string, unknown>): void;
    warn(msg: string, data?: Record<string, unknown>): void;
    error(msg: string, data?: Record<string, unknown>): void;
    setLevel(level: LogLevel): void;
}
export declare function createLogger(initialLevel?: LogLevel): Logger;
export declare const logger: Logger;
