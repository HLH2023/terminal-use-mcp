/**
 * 审计日志 — 记录 tool 调用的 allow/deny/error 决策。
 *
 * 写入 <artifactDir>/audit.ndjson，每行一条 JSON 记录。
 * 审计写入失败不影响主流程（best-effort）。
 *
 * 安全约束：
 * - 不写 secret values
 * - 不写 private key
 * - 不写 passphrase
 * - 不写 raw pasted content
 * - terminal.paste 只记录 length、mode、secretDetected
 * - terminal.type 默认只记录 length
 * - terminal.press 可以记录 keyExpr
 * - mouse 可以记录坐标和方向
 * - deny / error 必须进入 audit
 */

import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { logger } from "./logger.js"

/** 审计日志条目 */
export type AuditLogEntry = {
  /** ISO 8601 timestamp */
  timestamp: string
  /** MCP tool name */
  tool: string
  /** Decision: allow, deny, or error */
  decision: "allow" | "deny" | "error"
  /** Session ID (if applicable) */
  sessionId?: string
  /** Capability preset */
  capabilityPreset?: string
  /** Tool profile */
  toolProfile?: string
  /** Target info (local or SSH) */
  target?: {
    kind: "local" | "ssh"
    profile?: string
    host?: string
    port?: number
    username?: string
  }
  /** Command (for terminal.start) */
  command?: string
  /** CWD */
  cwd?: string
  /** Deny/error reason */
  reason?: string
  /** Input summary (redacted) */
  input?: AuditInputSummary
  /** All fields are redacted by policy */
  redacted: true
}

/** Redacted input summary — no raw content, only metadata */
export type AuditInputSummary = {
  /** For terminal.type: text length */
  textLength?: number
  /** For terminal.press: key expression */
  keyExpr?: string
  /** For terminal.paste: length, mode, secret detection */
  pasteLength?: number
  pasteMode?: string
  secretDetected?: boolean
  /** For mouse: coordinates and direction */
  mouseCol?: number
  mouseRow?: number
  mouseDirection?: string
  mouseButton?: string
  /** For tmux_command: parsed kind and dry-run flag */
  tmuxCommandKind?: string
  tmuxCommandDryRun?: boolean
  /** tmux 命令 target（如 %3, @2, session-name） */
  tmuxCommandTarget?: string
  /** tmux 命令是否破坏性（kill 等） */
  tmuxCommandDestructive?: boolean
  /** 编译后的 tmux 命令（如 "kill-pane -t %3"，已脱敏） */
  compiledCommand?: string
}

/** Audit logger interface */
export type AuditLogger = {
  /** Log an audit entry (best-effort, never throws) */
  log(entry: Omit<AuditLogEntry, "timestamp" | "redacted">): void
  /** Whether audit logging is enabled */
  readonly enabled: boolean
}

/** Create an audit logger that writes to audit.ndjson */
export function createAuditLogger(
  auditLogPath: string | undefined,
  capabilityPreset: string,
  toolProfile: string,
): AuditLogger {
  if (auditLogPath === undefined) {
    return { log: () => {}, enabled: false }
  }

  // Ensure directory exists
  try {
    mkdirSync(dirname(auditLogPath), { recursive: true })
  } catch {
    // best-effort
  }

  const cp = capabilityPreset
  const tp = toolProfile

  return {
    enabled: true,
    log(entry) {
      try {
        const fullEntry: AuditLogEntry = {
          ...entry,
          capabilityPreset: entry.capabilityPreset ?? cp,
          toolProfile: entry.toolProfile ?? tp,
          timestamp: new Date().toISOString(),
          redacted: true,
        }
        appendFileSync(auditLogPath, `${JSON.stringify(fullEntry)}\n`, "utf8")
      } catch (err) {
        // 审计写入失败不影响主流程
        logger.debug("audit log write failed", { error: err instanceof Error ? err.message : String(err) })
      }
    },
  }
}

/** Helper: create a minimal allow entry for a tool call */
export function auditAllow(
  tool: string,
  opts?: {
    sessionId?: string
    capabilityPreset?: string
    toolProfile?: string
    target?: AuditLogEntry["target"]
    command?: string
    cwd?: string
    input?: AuditInputSummary
  },
): Omit<AuditLogEntry, "timestamp" | "redacted"> {
  return { tool, decision: "allow", ...opts }
}

/** Helper: create a deny entry */
export function auditDeny(
  tool: string,
  reason: string,
  opts?: {
    sessionId?: string
    capabilityPreset?: string
    toolProfile?: string
    target?: AuditLogEntry["target"]
    command?: string
    cwd?: string
    input?: AuditInputSummary
  },
): Omit<AuditLogEntry, "timestamp" | "redacted"> {
  return { tool, decision: "deny", reason, ...opts }
}

/** Helper: create an error entry */
export function auditError(
  tool: string,
  reason: string,
  opts?: {
    sessionId?: string
    capabilityPreset?: string
    toolProfile?: string
    target?: AuditLogEntry["target"]
    command?: string
    cwd?: string
    input?: AuditInputSummary
  },
): Omit<AuditLogEntry, "timestamp" | "redacted"> {
  return { tool, decision: "error", reason, ...opts }
}

/** Create a no-op audit logger (用于测试) */
export function createNoopAuditLogger(): AuditLogger {
  return { log: () => {}, enabled: false }
}
