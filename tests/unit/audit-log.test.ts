import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  createAuditLogger,
  auditAllow,
  auditDeny,
  auditError,
  createNoopAuditLogger,
} from "../../src/audit-log.js"
import type { AuditLogEntry, AuditLogger } from "../../src/audit-log.js"

/** 创建临时目录用于审计日志测试 */
let tempDir: string | undefined

afterEach(() => {
  if (tempDir) {
    try { rmSync(tempDir, { recursive: true, force: true }) } catch { /* best-effort */ }
    tempDir = undefined
  }
})

function getTempDir(): string {
  if (!tempDir) {
    tempDir = mkdtempSync(join(tmpdir(), "audit-test-"))
  }
  return tempDir
}

describe("createAuditLogger", () => {
  it("undefined 路径返回 noop logger (enabled=false)", () => {
    const logger = createAuditLogger(undefined, "local", "full")
    expect(logger.enabled).toBe(false)
  })

  it("有效路径返回 logger (enabled=true)", () => {
    const auditPath = join(getTempDir(), "audit.ndjson")
    const logger = createAuditLogger(auditPath, "local", "full")
    expect(logger.enabled).toBe(true)
  })
})

describe("auditAllow", () => {
  it("创建正确的 allow entry 结构", () => {
    const entry = auditAllow("terminal.start", {
      sessionId: "sess-123",
      command: "vim",
      cwd: "/workspace",
    })
    expect(entry.tool).toBe("terminal.start")
    expect(entry.decision).toBe("allow")
    expect(entry.sessionId).toBe("sess-123")
    expect(entry.command).toBe("vim")
    expect(entry.cwd).toBe("/workspace")
  })

  it("无额外选项时只包含 tool + decision", () => {
    const entry = auditAllow("terminal.health")
    expect(entry.tool).toBe("terminal.health")
    expect(entry.decision).toBe("allow")
  })

  it("支持 input 摘要", () => {
    const entry = auditAllow("terminal.type", {
      input: { textLength: 42 },
    })
    expect(entry.input).toBeDefined()
    expect(entry.input?.textLength).toBe(42)
  })

  it("支持 target 信息", () => {
    const entry = auditAllow("terminal.start", {
      target: { kind: "ssh", host: "example.com", port: 22, username: "user" },
    })
    expect(entry.target).toBeDefined()
    expect(entry.target?.kind).toBe("ssh")
  })
})

describe("auditDeny", () => {
  it("创建包含 reason 的 deny entry", () => {
    const entry = auditDeny("terminal.start", "UNSAFE_COMMAND", {
      command: "sudo rm -rf /",
    })
    expect(entry.tool).toBe("terminal.start")
    expect(entry.decision).toBe("deny")
    expect(entry.reason).toBe("UNSAFE_COMMAND")
    expect(entry.command).toBe("sudo rm -rf /")
  })

  it("无额外选项时只包含 tool + decision + reason", () => {
    const entry = auditDeny("terminal.paste", "LARGE_PASTE_DENIED")
    expect(entry.tool).toBe("terminal.paste")
    expect(entry.decision).toBe("deny")
    expect(entry.reason).toBe("LARGE_PASTE_DENIED")
  })
})

describe("auditError", () => {
  it("创建包含 reason 的 error entry", () => {
    const entry = auditError("terminal.snapshot", "SESSION_NOT_FOUND", {
      sessionId: "sess-missing",
    })
    expect(entry.tool).toBe("terminal.snapshot")
    expect(entry.decision).toBe("error")
    expect(entry.reason).toBe("SESSION_NOT_FOUND")
    expect(entry.sessionId).toBe("sess-missing")
  })
})

describe("AuditLogger.log()", () => {
  it("写入 NDJSON 到文件", () => {
    const auditPath = join(getTempDir(), "audit.ndjson")
    const logger = createAuditLogger(auditPath, "local", "full")

    logger.log(auditAllow("terminal.start", { command: "vim" }))
    logger.log(auditDeny("terminal.kill", "SESSION_NOT_FOUND"))

    // 读取并解析 NDJSON
    const content = readFileSync(auditPath, "utf8")
    const lines = content.trim().split("\n")
    expect(lines).toHaveLength(2)

    const entry1 = JSON.parse(lines[0]!) as AuditLogEntry
    expect(entry1.tool).toBe("terminal.start")
    expect(entry1.decision).toBe("allow")
    expect(entry1.timestamp).toBeDefined()
    expect(entry1.redacted).toBe(true)

    const entry2 = JSON.parse(lines[1]!) as AuditLogEntry
    expect(entry2.tool).toBe("terminal.kill")
    expect(entry2.decision).toBe("deny")
    expect(entry2.reason).toBe("SESSION_NOT_FOUND")
  })

  it("写入的条目包含 timestamp 和 redacted=true", () => {
    const auditPath = join(getTempDir(), "audit.ndjson")
    const logger = createAuditLogger(auditPath, "local", "full")

    logger.log(auditAllow("terminal.health"))

    const content = readFileSync(auditPath, "utf8")
    const entry = JSON.parse(content.trim()) as AuditLogEntry

    // timestamp 是 ISO 8601 格式
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(entry.redacted).toBe(true)
  })

  it("无效路径不抛出异常（best-effort）", () => {
    // 使用一个不可能存在的路径（在 /dev/null 下创建目录）
    const invalidPath = "/dev/null/impossible/audit.ndjson"
    const logger = createAuditLogger(invalidPath, "local", "full")
    // 不应抛出异常
    expect(() => {
      logger.log(auditAllow("terminal.start"))
    }).not.toThrow()
  })

  it("noop logger 的 log 不抛出异常", () => {
    const logger = createAuditLogger(undefined, "local", "full")
    expect(() => {
      logger.log(auditAllow("terminal.start"))
    }).not.toThrow()
  })
})

describe("createNoopAuditLogger", () => {
  it("返回 enabled=false 的 noop logger", () => {
    const logger: AuditLogger = createNoopAuditLogger()
    expect(logger.enabled).toBe(false)
  })

  it("log 不抛出异常", () => {
    const logger: AuditLogger = createNoopAuditLogger()
    expect(() => {
      logger.log(auditAllow("terminal.start"))
    }).not.toThrow()
  })
})
