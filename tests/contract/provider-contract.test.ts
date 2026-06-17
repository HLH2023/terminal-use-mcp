/**
 * Provider Contract Tests — 验证错误路径契约
 *
 * 使用 mock provider 测试 SessionManager + ProviderExecutor 的错误处理层，
 * 确保所有失败场景产生稳定的结构化 error envelope。
 * 不实际运行 tmux / native-pty。
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

import { loadConfig } from "../../src/config.js"
import { createLogger } from "../../src/logger.js"
import { SessionManager } from "../../src/session-manager.js"
import type { ManagedSession } from "../../src/session-manager.js"
import { ProviderExecutor } from "../../src/tools/tool-helpers.js"
import { createNoopAuditLogger } from "../../src/audit-log.js"
import type { TerminalProvider, ProviderName, StartInput, TerminalSession } from "../../src/providers/provider.js"
import type { TerminalSnapshot } from "../../src/terminal/terminal-snapshot.js"
import {
  SessionNotFoundError,
  ProviderNotAvailableError,
  ProviderCapabilityUnsupportedError,
  ProcessExitedError,
  InvalidCwdError,
  UnsafeCommandError,
  LargePasteRefusedError,
  SecretDetectedError,
  SessionTimeoutError,
  TerminalUseError,
} from "../../src/terminal/errors.js"
import { getDetectedSecretTypes, redactSecrets } from "../../src/terminal/redact.js"

// ── Mock 工厂 ──────────────────────────────────────────────

/** 创建一个 mock provider，可自定义 capabilities 和 isAvailable */
function createMockProvider(overrides: {
  name: ProviderName
  isAvailable?: boolean
  supportsFind?: boolean
  supportsStart?: boolean
  supportsAttach?: boolean
}): TerminalProvider {
  const name = overrides.name
  return {
    name,
    capabilities: {
      provider: name,
      supportsStart: overrides.supportsStart ?? true,
      supportsAttach: overrides.supportsAttach ?? false,
      supportsStableWait: true,
      supportsTextWait: true,
      supportsHighlights: false,
      supportsScrollback: false,
      supportsResize: true,
      supportsTranscriptExport: false,
      supportsExitCode: true,
      supportsTitle: false,
      supportsFullscreenDetection: false,
      supportsRename: true,
      supportsScroll: false,
      supportsFind: overrides.supportsFind ?? false,
      supportsMouseClick: false,
      supportsMouseScroll: false,
    },
    isAvailable: vi.fn(async () => overrides.isAvailable ?? true),
    start: vi.fn(async (input: StartInput): Promise<TerminalSession> => ({
      sessionId: "",
      providerName: name,
      providerSessionId: `mock-${name}`,
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      label: input.label,
      status: "running",
      exitCode: null,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      ttlMs: input.ttlMs ?? 3_600_000,
      capabilities: {
        provider: name,
        supportsStart: true,
        supportsAttach: false,
        supportsStableWait: true,
        supportsTextWait: true,
        supportsHighlights: false,
        supportsScrollback: false,
        supportsResize: true,
        supportsTranscriptExport: false,
        supportsExitCode: true,
        supportsTitle: false,
        supportsFullscreenDetection: false,
        supportsRename: true,
        supportsScroll: false,
        supportsFind: false,
        supportsMouseClick: false,
        supportsMouseScroll: false,
      },
    })),
    snapshot: vi.fn(async (): Promise<TerminalSnapshot> => ({
      sessionId: "mock",
      screen: "",
      cursor: { x: 0, y: 0 },
      cols: 120,
      rows: 30,
      scrollbackLineCount: 0,
      status: "running",
      exitCode: null,
      timestamp: new Date().toISOString(),
      observationTrust: "untrusted",
    })),
    waitForText: vi.fn(async (): Promise<TerminalSnapshot> => ({
      sessionId: "mock",
      screen: "",
      cursor: { x: 0, y: 0 },
      cols: 120,
      rows: 30,
      scrollbackLineCount: 0,
      status: "running",
      exitCode: null,
      timestamp: new Date().toISOString(),
      observationTrust: "untrusted",
    })),
    waitStable: vi.fn(async (): Promise<TerminalSnapshot> => ({
      sessionId: "mock",
      screen: "",
      cursor: { x: 0, y: 0 },
      cols: 120,
      rows: 30,
      scrollbackLineCount: 0,
      status: "running",
      exitCode: null,
      timestamp: new Date().toISOString(),
      observationTrust: "untrusted",
    })),
    type: vi.fn(async () => {}),
    press: vi.fn(async () => {}),
    paste: vi.fn(async () => {}),
    kill: vi.fn(async () => {}),
    exportTranscript: vi.fn(async () => ({
      format: "text",
      content: "",
      snapshotCount: 0,
      eventCount: 0,
      redacted: false,
    })),
    hasSession: vi.fn(() => true),
    listActiveSessionIds: vi.fn(() => []),
  } satisfies TerminalProvider
}

// ── 测试配置工厂 ────────────────────────────────────────────

/** 创建测试用 SessionManager (workspaceRoot 指向 /tmp) */
function createTestSessionManager(overrides?: Record<string, unknown>): {
  sm: SessionManager
  logger: ReturnType<typeof createLogger>
  config: ReturnType<typeof loadConfig>
} {
  const config = loadConfig({
    workspaceRoot: "/tmp",
    allowedCwdRoots: [],
    deniedCommands: [],
    riskyCommandMode: "deny",
    artifactDir: "/tmp/terminal-use-mcp-test-artifacts",
  })
  const logger = createLogger("error") // 最小化日志输出
  const sm = new SessionManager(config, logger, createNoopAuditLogger())
  return { sm, logger, config }
}

// ════════════════════════════════════════════════════════════
// 测试套件
// ════════════════════════════════════════════════════════════

describe("Provider Contract: Error Paths", () => {

  // ── 1. SessionNotFoundError ────────────────────────────────
  describe("Session not found", () => {
    it("getSession('nonexistent') 抛出 SessionNotFoundError with code SESSION_NOT_FOUND", () => {
      const { sm } = createTestSessionManager()
      expect(() => sm.getSession("nonexistent")).toThrow(SessionNotFoundError)
    })

    it("SessionNotFoundError 包含正确的 error code", () => {
      const { sm } = createTestSessionManager()
      try {
        sm.getSession("nonexistent")
      } catch (err) {
        expect(err).toBeInstanceOf(SessionNotFoundError)
        const tuErr = err as SessionNotFoundError
        expect(tuErr.code).toBe("SESSION_NOT_FOUND")
        expect(tuErr.sessionId).toBe("nonexistent")
        expect(tuErr.retryable).toBe(false)
      }
    })

    it("SessionNotFoundError.toEnvelope() 生成稳定的 error envelope", () => {
      const error = new SessionNotFoundError("test-id-123")
      const envelope = error.toEnvelope()
      expect(envelope.ok).toBe(false)
      expect(envelope.error.code).toBe("SESSION_NOT_FOUND")
      expect(envelope.error.message).toContain("test-id-123")
      expect(envelope.error.sessionId).toBe("test-id-123")
      expect(envelope.error.retryable).toBe(false)
    })
  })

  // ── 2. ProviderNotAvailableError ──────────────────────────
  describe("Provider not available", () => {
    it("注册但 isAvailable() 返回 false 的 provider 导致 start 抛 ProviderNotAvailableError", async () => {
      const { sm, config } = createTestSessionManager()
      const mockProvider = createMockProvider({
        name: "native-pty",
        isAvailable: false,
      })
      sm.registerProvider(mockProvider)

      await expect(sm.start({
        command: "echo",
        args: [],
        cwd: "/tmp",
        cols: 80,
        rows: 24,
        provider: "native-pty",
      })).rejects.toThrow(ProviderNotAvailableError)
    })

    it("ProviderNotAvailableError 包含 provider 名和正确 code", async () => {
      const { sm } = createTestSessionManager()
      const mockProvider = createMockProvider({
        name: "tmux",
        isAvailable: false,
      })
      sm.registerProvider(mockProvider)

      try {
        await sm.start({
          command: "echo",
          args: [],
          cwd: "/tmp",
          cols: 80,
          rows: 24,
          provider: "tmux",
        })
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderNotAvailableError)
        const tuErr = err as ProviderNotAvailableError
        expect(tuErr.code).toBe("PROVIDER_NOT_AVAILABLE")
        expect(tuErr.provider).toBe("tmux")
        expect(tuErr.retryable).toBe(false)
      }
    })

    it("未注册的 provider 导致 start 抛 ProviderNotAvailableError", async () => {
      const { sm } = createTestSessionManager()
      // 不注册任何 provider

      await expect(sm.start({
        command: "echo",
        args: [],
        cwd: "/tmp",
        cols: 80,
        rows: 24,
        provider: "tmux",
      })).rejects.toThrow(ProviderNotAvailableError)
    })
  })

  // ── 3. ProviderCapabilityUnsupportedError ────────────────
  describe("Unsupported capability", () => {
    it("executeFind 在 provider 不支持 find 时抛 ProviderCapabilityUnsupportedError", async () => {
      const { sm } = createTestSessionManager()
      const mockProvider = createMockProvider({
        name: "native-pty",
        supportsFind: false,
        isAvailable: true,
      })
      sm.registerProvider(mockProvider)

      // 先启动一个 session
      const session = await sm.start({
        command: "echo",
        args: [],
        cwd: "/tmp",
        cols: 80,
        rows: 24,
      })

      const providers = sm.getProviders()
      const executor = new ProviderExecutor(sm, providers)

      await expect(executor.executeFind(session.sessionId, "test", false, false))
        .rejects.toThrow(ProviderCapabilityUnsupportedError)
    })

    it("ProviderCapabilityUnsupportedError 包含 provider 名和能力名", async () => {
      const { sm } = createTestSessionManager()
      const mockProvider = createMockProvider({
        name: "native-pty",
        supportsFind: false,
        isAvailable: true,
      })
      sm.registerProvider(mockProvider)

      const session = await sm.start({
        command: "echo",
        args: [],
        cwd: "/tmp",
        cols: 80,
        rows: 24,
      })

      const providers = sm.getProviders()
      const executor = new ProviderExecutor(sm, providers)

      try {
        await executor.executeFind(session.sessionId, "test", false, false)
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderCapabilityUnsupportedError)
        const tuErr = err as ProviderCapabilityUnsupportedError
        expect(tuErr.code).toBe("PROVIDER_CAPABILITY_UNSUPPORTED")
        expect(tuErr.provider).toBe("native-pty")
      }
    })
  })

  // ── 4. ProcessExitedError ─────────────────────────────────
  describe("Process exited then type", () => {
    it("session.status='exited' 时 executeType 抛 ProcessExitedError", async () => {
      const { sm } = createTestSessionManager()
      const mockProvider = createMockProvider({
        name: "native-pty",
        isAvailable: true,
      })
      sm.registerProvider(mockProvider)

      const session = await sm.start({
        command: "echo",
        args: [],
        cwd: "/tmp",
        cols: 80,
        rows: 24,
      })

      // 模拟进程已退出
      const internalSession = sm.getSession(session.sessionId)
      internalSession.status = "exited"
      internalSession.exitCode = 0

      const providers = sm.getProviders()
      const executor = new ProviderExecutor(sm, providers)

      await expect(executor.executeType(session.sessionId, "hello"))
        .rejects.toThrow(ProcessExitedError)
    })

    it("ProcessExitedError 包含 exitCode", async () => {
      const { sm } = createTestSessionManager()
      const mockProvider = createMockProvider({
        name: "native-pty",
        isAvailable: true,
      })
      sm.registerProvider(mockProvider)

      const session = await sm.start({
        command: "echo",
        args: [],
        cwd: "/tmp",
        cols: 80,
        rows: 24,
      })

      const internalSession = sm.getSession(session.sessionId)
      internalSession.status = "exited"
      internalSession.exitCode = 137

      const providers = sm.getProviders()
      const executor = new ProviderExecutor(sm, providers)

      try {
        await executor.executeType(session.sessionId, "hello")
      } catch (err) {
        expect(err).toBeInstanceOf(ProcessExitedError)
        const tuErr = err as ProcessExitedError
        expect(tuErr.code).toBe("PROCESS_EXITED")
        expect(tuErr.details).toEqual({ exitCode: 137 })
        expect(tuErr.retryable).toBe(false)
      }
    })

    it("process/press 对 exited session 同样抛 ProcessExitedError", async () => {
      const { sm } = createTestSessionManager()
      const mockProvider = createMockProvider({
        name: "native-pty",
        isAvailable: true,
      })
      sm.registerProvider(mockProvider)

      const session = await sm.start({
        command: "echo",
        args: [],
        cwd: "/tmp",
        cols: 80,
        rows: 24,
      })

      const internalSession = sm.getSession(session.sessionId)
      internalSession.status = "exited"

      const providers = sm.getProviders()
      const executor = new ProviderExecutor(sm, providers)

      await expect(executor.executePress(session.sessionId, "enter"))
        .rejects.toThrow(ProcessExitedError)
    })
  })

  // ── 5. InvalidCwdError ────────────────────────────────────
  describe("Invalid cwd", () => {
    it("sm.start with cwd='/etc' 抛 InvalidCwdError", async () => {
      const { sm } = createTestSessionManager()
      const mockProvider = createMockProvider({
        name: "native-pty",
        isAvailable: true,
      })
      sm.registerProvider(mockProvider)

      await expect(sm.start({
        command: "echo",
        args: [],
        cwd: "/etc",
        cols: 80,
        rows: 24,
      })).rejects.toThrow(InvalidCwdError)
    })

    it("InvalidCwdError 包含 cwd 路径和正确 code", async () => {
      const { sm } = createTestSessionManager()

      try {
        await sm.start({
          command: "echo",
          args: [],
          cwd: "/etc",
          cols: 80,
          rows: 24,
        })
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidCwdError)
        const tuErr = err as InvalidCwdError
        expect(tuErr.code).toBe("INVALID_CWD")
        expect(tuErr.message).toContain("/etc")
        expect(tuErr.retryable).toBe(false)
      }
    })
  })

  // ── 6. UnsafeCommandError ─────────────────────────────────
  describe("Unsafe command", () => {
    it("sm.start with command='sudo' 抛 UnsafeCommandError", async () => {
      const { sm } = createTestSessionManager()
      const mockProvider = createMockProvider({
        name: "native-pty",
        isAvailable: true,
      })
      sm.registerProvider(mockProvider)

      await expect(sm.start({
        command: "sudo",
        args: [],
        cwd: "/tmp",
        cols: 80,
        rows: 24,
      })).rejects.toThrow(UnsafeCommandError)
    })

    it("UnsafeCommandError 包含被阻止的命令名和 code", async () => {
      const { sm } = createTestSessionManager()

      try {
        await sm.start({
          command: "sudo",
          args: [],
          cwd: "/tmp",
          cols: 80,
          rows: 24,
        })
      } catch (err) {
        expect(err).toBeInstanceOf(UnsafeCommandError)
        const tuErr = err as UnsafeCommandError
        expect(tuErr.code).toBe("UNSAFE_COMMAND")
        expect(tuErr.message).toContain("sudo")
        expect(tuErr.retryable).toBe(false)
      }
    })

    it("其他被拒绝的命令 (rm, shutdown) 同样抛 UnsafeCommandError", async () => {
      const { sm } = createTestSessionManager()

      for (const cmd of ["rm", "shutdown", "dd"]) {
        await expect(sm.start({
          command: cmd,
          args: [],
          cwd: "/tmp",
          cols: 80,
          rows: 24,
        })).rejects.toThrow(UnsafeCommandError)
      }
    })
  })

  // ── 7. SessionTimeoutError ───────────────────────────────
  describe("Session timeout", () => {
    it("SessionTimeoutError 正确构造且 code 为 SESSION_TIMEOUT", () => {
      const error = new SessionTimeoutError("sess-123", 5000)
      expect(error.code).toBe("SESSION_TIMEOUT")
      expect(error.sessionId).toBe("sess-123")
      expect(error.retryable).toBe(true)
      expect(error.message).toContain("5000ms")

      const envelope = error.toEnvelope()
      expect(envelope.error.code).toBe("SESSION_TIMEOUT")
      expect(envelope.error.retryable).toBe(true)
    })
  })

  // ── 8. LargePasteRefusedError ─────────────────────────────
  describe("Large paste refused", () => {
    it("超过硬限制 (10000 chars) 时 LargePasteRefusedError hard=true", () => {
      const error = new LargePasteRefusedError(15000, 10000, true)
      expect(error.code).toBe("LARGE_PASTE_REFUSED")
      expect(error.details).toEqual({ length: 15000, limit: 10000, hard: true })
      expect(error.retryable).toBe(false)
    })

    it("超过软限制 (2000 chars) 但未确认时 LargePasteRefusedError hard=false", () => {
      const error = new LargePasteRefusedError(5000, 2000, false)
      expect(error.code).toBe("LARGE_PASTE_REFUSED")
      expect(error.details).toEqual({ length: 5000, limit: 2000, hard: false })
      expect(error.hint).toBe("Set confirmLargePaste=true")
    })

    it("LargePasteRefusedError.toEnvelope() 生成稳定 envelope", () => {
      const error = new LargePasteRefusedError(15000, 10000, true)
      const envelope = error.toEnvelope()
      expect(envelope.ok).toBe(false)
      expect(envelope.error.code).toBe("LARGE_PASTE_REFUSED")
      expect(envelope.error.details).toEqual({ length: 15000, limit: 10000, hard: true })
    })
  })

  // ── 9. Secret detected ────────────────────────────────────
  describe("Secret detected", () => {
    it("SecretDetectedError 包含检测到的 secret 类型和正确 code", () => {
      const error = new SecretDetectedError(["github_token", "bearer_token"])
      expect(error.code).toBe("SECRET_DETECTED")
      expect(error.message).toContain("github_token")
      expect(error.message).toContain("bearer_token")
      expect(error.retryable).toBe(false)
    })

    it("getDetectedSecretTypes 正确检测 GitHub token", () => {
      const text = "export GITHUB_TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwxyz"
      const types = getDetectedSecretTypes(text)
      expect(types).toContain("github_token")
    })

    it("getDetectedSecretTypes 正确检测 .env 格式 secret", () => {
      const text = "password=supersecret123"
      const types = getDetectedSecretTypes(text)
      expect(types).toContain("env_secret")
    })

    it("getDetectedSecretTypes 对无 secret 文本返回空数组", () => {
      const text = "Hello, this is a normal terminal output"
      const types = getDetectedSecretTypes(text)
      expect(types).toEqual([])
    })

    it("redactSecrets 替换 secret 为占位符", () => {
      const text = "my token is ghp_1234567890abcdefghijklmnopqrstuvwxyz"
      const redacted = redactSecrets(text)
      expect(redacted).toContain("<REDACTED_github_token>")
      expect(redacted).not.toContain("ghp_")
    })
  })

  // ── 10. Dependency missing / Provider not registered ──────
  describe("Dependency missing (provider not registered)", () => {
    it("ProviderExecutor 对未注册 provider 抛 ProviderNotAvailableError", async () => {
      const { sm } = createTestSessionManager()
      const mockProvider = createMockProvider({
        name: "native-pty",
        isAvailable: true,
      })
      sm.registerProvider(mockProvider)

      // 先启动 session，然后构造不含该 provider 的 executor
      const session = await sm.start({
        command: "echo",
        args: [],
        cwd: "/tmp",
        cols: 80,
        rows: 24,
      })

      // 空 provider map → 触发 ProviderNotAvailableError
      const emptyProviders = new Map<string, TerminalProvider>()
      const executor = new ProviderExecutor(sm, emptyProviders)

      await expect(executor.executeSnapshot(session.sessionId))
        .rejects.toThrow(ProviderNotAvailableError)
    })
  })

  // ── 额外: 合法命令和合法 cwd 成功 ──────────────────────
  describe("Valid operations succeed", () => {
    it("合法命令+合法 cwd 的 start 成功", async () => {
      const { sm } = createTestSessionManager()
      const mockProvider = createMockProvider({
        name: "native-pty",
        isAvailable: true,
      })
      sm.registerProvider(mockProvider)

      const session = await sm.start({
        command: "echo",
        args: ["hello"],
        cwd: "/tmp",
        cols: 80,
        rows: 24,
      })

      expect(session).toBeDefined()
      expect(session.sessionId).toBeTruthy()
      expect(session.status).toBe("running")
      expect(session.command).toBe("echo")
    })
  })

  // ── 额外: Error Envelope 稳定性 ─────────────────────────
  describe("Error Envelope format stability", () => {
    it("所有 TerminalUseError 子类生成 ok:false envelope", () => {
      const errors = [
        new SessionNotFoundError("s1"),
        new ProviderNotAvailableError("tmux"),
        new ProviderCapabilityUnsupportedError("native-pty", "find"),
        new ProcessExitedError("s2", 1),
        new InvalidCwdError("/etc", "denied root"),
        new UnsafeCommandError("sudo"),
        new LargePasteRefusedError(15000, 10000, true),
        new SecretDetectedError(["github_token"]),
      ]

      for (const err of errors) {
        const envelope = err.toEnvelope()
        expect(envelope.ok).toBe(false)
        expect(envelope.error).toBeDefined()
        expect(envelope.error.code).toBeTruthy()
        expect(envelope.error.message).toBeTruthy()
        expect(typeof envelope.error.retryable).toBe("boolean")
      }
    })
  })

  // ── 额外: Provider 接口签名与返回结构一致性 ──────────────
  describe("provider 接口一致性", () => {
    it("mock provider 关键方法签名存在且为函数", () => {
      const mockProvider = createMockProvider({ name: "native-pty", isAvailable: true })

      expect(typeof mockProvider.start).toBe("function")
      expect(typeof mockProvider.snapshot).toBe("function")
      expect(typeof mockProvider.kill).toBe("function")
      expect(typeof mockProvider.type).toBe("function")
      expect(typeof mockProvider.press).toBe("function")
      expect(typeof mockProvider.paste).toBe("function")
      expect(typeof mockProvider.waitForText).toBe("function")
      expect(typeof mockProvider.waitStable).toBe("function")
      expect(typeof mockProvider.isAvailable).toBe("function")
      expect(typeof mockProvider.hasSession).toBe("function")
      expect(typeof mockProvider.listActiveSessionIds).toBe("function")
      expect(typeof mockProvider.exportTranscript).toBe("function")
    })

    it("start() 返回结构包含必要字段", async () => {
      const mockProvider = createMockProvider({ name: "native-pty", isAvailable: true })
      const session = await mockProvider.start({
        command: "bash",
        args: [],
        cwd: "/tmp",
        cols: 80,
        rows: 24,
      })

      expect(session).toHaveProperty("sessionId")
      expect(session).toHaveProperty("providerName")
      expect(session).toHaveProperty("providerSessionId")
      expect(session).toHaveProperty("capabilities")
      expect(session).toHaveProperty("command")
      expect(session).toHaveProperty("args")
      expect(session).toHaveProperty("cwd")
      expect(session).toHaveProperty("createdAt")
      expect(session).toHaveProperty("lastActivityAt")
      expect(session).toHaveProperty("ttlMs")
      expect(session.status).toBe("running")
      expect(session.providerName).toBe("native-pty")
    })

    it("snapshot() 返回结构符合 TerminalSnapshot", async () => {
      const mockProvider = createMockProvider({ name: "native-pty", isAvailable: true })
      const snap = await mockProvider.snapshot("mock-sid")

      expect(snap).toHaveProperty("screen")
      expect(snap).toHaveProperty("cursor")
      expect(snap).toHaveProperty("cols")
      expect(snap).toHaveProperty("rows")
      expect(snap).toHaveProperty("scrollbackLineCount")
      expect(snap).toHaveProperty("status")
      expect(snap).toHaveProperty("timestamp")
      expect(snap.observationTrust).toBe("untrusted")
      expect(typeof snap.screen).toBe("string")
      expect(typeof snap.cols).toBe("number")
      expect(typeof snap.rows).toBe("number")
      expect(typeof snap.scrollbackLineCount).toBe("number")
    })

    it("capabilities 结构包含所有必要字段", () => {
      const mockProvider = createMockProvider({ name: "native-pty", isAvailable: true })
      const caps = mockProvider.capabilities

      expect(caps.provider).toBe("native-pty")
      expect(typeof caps.supportsStart).toBe("boolean")
      expect(typeof caps.supportsAttach).toBe("boolean")
      expect(typeof caps.supportsStableWait).toBe("boolean")
      expect(typeof caps.supportsTextWait).toBe("boolean")
      expect(typeof caps.supportsHighlights).toBe("boolean")
      expect(typeof caps.supportsScrollback).toBe("boolean")
      expect(typeof caps.supportsResize).toBe("boolean")
      expect(typeof caps.supportsTranscriptExport).toBe("boolean")
      expect(typeof caps.supportsExitCode).toBe("boolean")
      expect(typeof caps.supportsTitle).toBe("boolean")
      expect(typeof caps.supportsFullscreenDetection).toBe("boolean")
      expect(typeof caps.supportsRename).toBe("boolean")
      expect(typeof caps.supportsScroll).toBe("boolean")
      expect(typeof caps.supportsFind).toBe("boolean")
      expect(typeof caps.supportsMouseClick).toBe("boolean")
      expect(typeof caps.supportsMouseScroll).toBe("boolean")
    })
  })
})
