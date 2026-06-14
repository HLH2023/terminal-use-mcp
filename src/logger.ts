/**
 * 结构化日志 — 仅输出到 stderr
 *
 * stdout 由 MCP 协议独占，任何日志不得写入 stdout。
 */

export type LogLevel = "debug" | "info" | "warn" | "error"

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void
  info(msg: string, data?: Record<string, unknown>): void
  warn(msg: string, data?: Record<string, unknown>): void
  error(msg: string, data?: Record<string, unknown>): void
  setLevel(level: LogLevel): void
}

export function createLogger(initialLevel?: LogLevel): Logger {
  let currentLevel: LogLevel = initialLevel ?? (process.env.TERMINAL_USE_LOG_LEVEL as LogLevel) ?? "info"

  function write(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[currentLevel]) return
    const ts = new Date().toISOString()
    const prefix = `[${level.toUpperCase()}] ${ts}`
    const line = data ? `${prefix} ${msg} ${JSON.stringify(data)}` : `${prefix} ${msg}`
    process.stderr.write(line + "\n")
  }

  return {
    debug: (msg, data) => write("debug", msg, data),
    info: (msg, data) => write("info", msg, data),
    warn: (msg, data) => write("warn", msg, data),
    error: (msg, data) => write("error", msg, data),
    setLevel: (level) => { currentLevel = level },
  }
}

// 模块级 logger 供无需依赖注入的配置加载器使用；仍严格写 stderr，避免污染 MCP stdout。
export const logger = createLogger()
