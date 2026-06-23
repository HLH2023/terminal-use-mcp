/**
 * TmuxProvider 单元测试
 *
 * 薄壳委托模式下，TmuxProvider 只做接口适配 + 版本检测 + 外部 session 查询。
 * 核心逻辑由 TmuxCore 实现，transport 由 LocalTmuxTransport 实现。
 *
 * 测试策略：mock TmuxCore 和 LocalTmuxTransport，验证 TmuxProvider 的
 * 接口适配、版本检测、secretEnvPolicy 检查、外部 session 列表等功能。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createLogger } from "../../src/logger.js"
import type { StartInput, TerminalSession } from "../../src/providers/provider.js"
import { TmuxProvider } from "../../src/providers/tmux-provider.js"
import type { TmuxCoreSession } from "../../src/providers/tmux-core.js"
import {
  SecretEnvDeniedError,
  SessionNotFoundError,
} from "../../src/terminal/errors.js"

// ============================================================
// Mock: TmuxCore
// ============================================================

/** 创建模拟的 TmuxCoreSession */
function createMockCoreSession(overrides: Partial<TmuxCoreSession> = {}): TmuxCoreSession {
  return {
    sessionInfo: {
      sessionId: "test-session-id",
      providerName: "tmux",
      providerSessionId: "tmux_test-session-id",
      command: "bash",
      args: [],
      cwd: "/tmp",
      label: undefined,
      status: "running",
      exitCode: undefined,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      ttlMs: 3600000,
      ...overrides.sessionInfo,
    },
    tmuxId: "tumcp_abcd1234",
    transport: {} as never,
    renderPty: null,
    controlChannel: null,
    xtermAdapter: {} as never,
    renderPhase: "normal",
    lastRenderWriteAt: Date.now(),
    renderDirty: false,
    snapshotCount: 0,
    rows: 24,
    cols: 80,
    transcript: {} as never,
    paneGeometry: null,
    attachTarget: "tumcp_abcd1234",
    ...overrides,
  }
}

const mockCoreStart = vi.fn()
const mockCoreAttach = vi.fn()
const mockCoreSnapshot = vi.fn()
const mockCoreWaitForText = vi.fn()
const mockCoreWaitStable = vi.fn()
const mockCoreType = vi.fn()
const mockCorePress = vi.fn()
const mockCorePaste = vi.fn()
const mockCoreFind = vi.fn()
const mockCoreScroll = vi.fn()
const mockCoreMouseClick = vi.fn()
const mockCoreMouseScroll = vi.fn()
const mockCoreResize = vi.fn()
const mockCoreRename = vi.fn()
const mockCoreKill = vi.fn()
const mockCoreExportTranscript = vi.fn()
const mockCoreHasSession = vi.fn()
const mockCoreListActiveSessionIds = vi.fn()
const mockCoreListSessions = vi.fn()
const mockCoreDispose = vi.fn()

vi.mock("../../src/providers/tmux-core.js", () => ({
  TmuxCore: vi.fn(() => ({
    start: mockCoreStart,
    attach: mockCoreAttach,
    snapshot: mockCoreSnapshot,
    waitForText: mockCoreWaitForText,
    waitStable: mockCoreWaitStable,
    type: mockCoreType,
    press: mockCorePress,
    paste: mockCorePaste,
    find: mockCoreFind,
    scroll: mockCoreScroll,
    mouseClick: mockCoreMouseClick,
    mouseScroll: mockCoreMouseScroll,
    resize: mockCoreResize,
    rename: mockCoreRename,
    kill: mockCoreKill,
    exportTranscript: mockCoreExportTranscript,
    hasSession: mockCoreHasSession,
    listActiveSessionIds: mockCoreListActiveSessionIds,
    listSessions: mockCoreListSessions,
    dispose: mockCoreDispose,
  })),
}))

// ============================================================
// Mock: LocalTmuxTransport
// ============================================================

const mockExecTmux = vi.fn()

vi.mock("../../src/providers/tmux-transport.js", () => ({
  LocalTmuxTransport: vi.fn(() => ({
    execTmux: mockExecTmux,
    remote: false,
    tmuxBin: "tmux",
    description: "local-tmux",
    getRenderSpawnArgs: vi.fn(),
    getControlSpawnArgs: vi.fn(),
    execRaw: vi.fn(),
  })),
}))

// ============================================================
// 工具函数
// ============================================================

const logger = createLogger("error")

function createStartInput(overrides: Partial<StartInput> = {}): StartInput {
  return {
    command: "bash",
    args: [],
    cwd: "/tmp",
    cols: 80,
    rows: 24,
    ...overrides,
  }
}

/** 创建 TmuxProvider 并预设 transport mock 让 isAvailable 成功 */
function createProvider(): TmuxProvider {
  mockExecTmux.mockResolvedValue({ stdout: "tmux 3.4", stderr: "", exitCode: 0 })
  return new TmuxProvider(logger)
}

// ============================================================
// 测试
// ============================================================

beforeEach(() => {
  vi.clearAllMocks()
  mockExecTmux.mockResolvedValue({ stdout: "tmux 3.4", stderr: "", exitCode: 0 })
  mockCoreStart.mockResolvedValue(createMockCoreSession())
  mockCoreAttach.mockResolvedValue(createMockCoreSession())
  mockCoreListSessions.mockReturnValue([])
  mockCoreHasSession.mockReturnValue(false)
  mockCoreListActiveSessionIds.mockReturnValue([])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("TmuxProvider", () => {
  // ---- isAvailable ----

  it("isAvailable() 当 tmux 版本满足时返回 true 并缓存结果", async () => {
    const provider = createProvider()

    const result = await provider.isAvailable()
    expect(result).toBe(true)

    // 第二次调用应使用缓存，不再调 transport.execTmux
    mockExecTmux.mockClear()
    const result2 = await provider.isAvailable()
    expect(result2).toBe(true)
    expect(mockExecTmux).not.toHaveBeenCalled()
  })

  it("isAvailable() 当 tmux 版本不满足时返回 false", async () => {
    mockExecTmux.mockResolvedValue({ stdout: "tmux 2.9", stderr: "", exitCode: 0 })
    const provider = new TmuxProvider(logger)

    const result = await provider.isAvailable()
    expect(result).toBe(false)
  })

  it("isAvailable() 当 tmux 不可用时返回 false", async () => {
    mockExecTmux.mockRejectedValue(new Error("tmux not found"))
    const provider = new TmuxProvider(logger)

    const result = await provider.isAvailable()
    expect(result).toBe(false)
  })

  // ---- capabilities ----

  it("capabilities 声明 tmux 核心能力标记", () => {
    const provider = createProvider()

    expect(provider.capabilities).toEqual({
      provider: "tmux",
      supportsStart: true,
      supportsAttach: true,
      supportsStableWait: true,
      supportsTextWait: true,
      supportsHighlights: true,
      supportsScrollback: true,
      supportsResize: true,
      supportsTranscriptExport: true,
      supportsExitCode: true,
      supportsTitle: true,
      supportsFullscreenDetection: true,
      supportsRename: true,
      supportsScroll: true,
      supportsFind: true,
      supportsMouseClick: true,
      supportsMouseScroll: true,
    })
  })

  // ---- start ----

  it("start() 委托给 TmuxCore.start 并返回 TerminalSession", async () => {
    const provider = createProvider()
    const input = createStartInput()
    const session = await provider.start(input)

    expect(mockCoreStart).toHaveBeenCalledWith(input, expect.anything(), "tmux")
    expect(session.providerName).toBe("tmux")
    expect(session.status).toBe("running")
    expect(session.command).toBe("bash")
    expect(session.capabilities).toBe(provider.capabilities)
  })

  it("start() 有疑似 secret 环境变量时拒绝（deny 策略）", async () => {
    const provider = new TmuxProvider(logger, { secretEnvPolicy: "deny" })

    await expect(provider.start(createStartInput({ env: { API_KEY: "secret" } })))
      .rejects.toThrow(SecretEnvDeniedError)
  })

  it("start() 无 secret 环境变量时正常通过", async () => {
    const provider = createProvider()

    const session = await provider.start(createStartInput({ env: { PATH: "/usr/bin" } }))
    expect(session.status).toBe("running")
  })

  it("start() allow 策略下允许疑似 secret 环境变量", async () => {
    const provider = new TmuxProvider(logger, { secretEnvPolicy: "allow" })

    const session = await provider.start(createStartInput({ env: { API_KEY: "secret" } }))
    expect(session.status).toBe("running")
  })

  // ---- attach ----

  it("attach() 委托给 TmuxCore.attach 并返回 TerminalSession", async () => {
    const provider = createProvider()

    const session = await provider.attach("my-session")
    expect(mockCoreAttach).toHaveBeenCalledWith("my-session", expect.anything(), "tmux")
    expect(session.providerName).toBe("tmux")
  })

  it("attach() 已 tracked 的 session 不再调用 core.attach", async () => {
    const provider = createProvider()
    // 先 start 一个 session
    mockCoreStart.mockResolvedValue(createMockCoreSession({
      sessionInfo: {
        sessionId: "test-session-id",
        providerName: "tmux",
        providerSessionId: "tmux_test-session-id",
        command: "bash",
        args: [],
        cwd: "/tmp",
        status: "running",
        exitCode: undefined,
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        ttlMs: 3600000,
      },
      tmuxId: "my-existing",
    }))
    await provider.start(createStartInput())

    // 用 tmuxId 查找已 tracked session
    mockCoreListSessions.mockReturnValue([createMockCoreSession({ tmuxId: "my-existing" })])

    const session = await provider.attach("my-existing")
    expect(mockCoreAttach).not.toHaveBeenCalled()
    expect(session.providerName).toBe("tmux")
  })

  // ---- 观测方法委托 ----

  it("snapshot() 委托给 TmuxCore.snapshot", async () => {
    const provider = createProvider()
    const mockSnapshot = { screen: "$ ", observationTrust: "untrusted" as const }
    mockCoreSnapshot.mockResolvedValue(mockSnapshot)

    const result = await provider.snapshot("session-1", "viewport")
    expect(mockCoreSnapshot).toHaveBeenCalledWith("session-1", "viewport")
    expect(result).toBe(mockSnapshot)
  })

  it("waitForText() 委托给 TmuxCore.waitForText", async () => {
    const provider = createProvider()
    const opts = { timeoutMs: 5000 }
    const mockSnap = { screen: "hello", observationTrust: "untrusted" as const }
    mockCoreWaitForText.mockResolvedValue(mockSnap)

    const result = await provider.waitForText("session-1", "hello", opts)
    expect(mockCoreWaitForText).toHaveBeenCalledWith("session-1", "hello", opts)
    expect(result).toBe(mockSnap)
  })

  it("waitStable() 委托给 TmuxCore.waitStable", async () => {
    const provider = createProvider()
    const opts = { timeoutMs: 5000, idleMs: 500 }
    const mockSnap = { screen: "$ ", observationTrust: "untrusted" as const }
    mockCoreWaitStable.mockResolvedValue(mockSnap)

    const result = await provider.waitStable("session-1", opts)
    expect(mockCoreWaitStable).toHaveBeenCalledWith("session-1", opts)
    expect(result).toBe(mockSnap)
  })

  // ---- 输入方法委托 ----

  it("type/press/paste 委托给 TmuxCore", async () => {
    const provider = createProvider()

    await provider.type("s1", "hello")
    expect(mockCoreType).toHaveBeenCalledWith("s1", "hello")

    await provider.press("s1", "ctrl+a", {} as never)
    expect(mockCorePress).toHaveBeenCalledWith("s1", "ctrl+a", {})

    await provider.paste("s1", "text", "bracketed")
    expect(mockCorePaste).toHaveBeenCalledWith("s1", "text", "bracketed")
  })

  // ---- 搜索与滚动委托 ----

  it("find/scroll 委托给 TmuxCore", async () => {
    const provider = createProvider()
    mockCoreFind.mockResolvedValue([])

    await provider.find("s1", "pattern", true, false)
    expect(mockCoreFind).toHaveBeenCalledWith("s1", "pattern", true, false)

    await provider.scroll("s1", "up", 5)
    expect(mockCoreScroll).toHaveBeenCalledWith("s1", "up", 5, "program-key")
  })

  // ---- 鼠标方法委托 ----

  it("mouseClick/mouseScroll 委托给 TmuxCore", async () => {
    const provider = createProvider()
    const clickInput = { col: 1, row: 1, button: "left" as const }
    const scrollInput = { col: 1, row: 1, direction: "up" as const }

    await provider.mouseClick("s1", clickInput)
    expect(mockCoreMouseClick).toHaveBeenCalledWith("s1", clickInput)

    await provider.mouseScroll("s1", scrollInput)
    expect(mockCoreMouseScroll).toHaveBeenCalledWith("s1", scrollInput)
  })

  // ---- 管理命令委托 ----

  it("resize/rename/kill/exportTranscript 委托给 TmuxCore", async () => {
    const provider = createProvider()
    mockCoreExportTranscript.mockResolvedValue({ format: "text", content: "", snapshotCount: 0, eventCount: 0, redacted: true })

    await provider.resize("s1", 120, 30)
    expect(mockCoreResize).toHaveBeenCalledWith("s1", 120, 30)

    await provider.rename("s1", "new-label")
    expect(mockCoreRename).toHaveBeenCalledWith("s1", "new-label")

    await provider.kill("s1")
    expect(mockCoreKill).toHaveBeenCalledWith("s1")

    await provider.exportTranscript("s1", { format: "text", redact: true })
    expect(mockCoreExportTranscript).toHaveBeenCalledWith("s1", { format: "text", redact: true })
  })

  // ---- 查询方法委托 ----

  it("hasSession/listActiveSessionIds 委托给 TmuxCore", () => {
    const provider = createProvider()
    mockCoreHasSession.mockReturnValue(true)
    mockCoreListActiveSessionIds.mockReturnValue(["s1", "s2"])

    expect(provider.hasSession("s1")).toBe(true)
    expect(mockCoreHasSession).toHaveBeenCalledWith("s1")

    expect(provider.listActiveSessionIds()).toEqual(["s1", "s2"])
    expect(mockCoreListActiveSessionIds).toHaveBeenCalled()
  })

  // ---- list (含外部 session) ----

  it("list() 返回 tracked sessions + 外部 tmux sessions", async () => {
    const provider = createProvider()
    // 先触发 isAvailable 缓存 true
    await provider.isAvailable()

    const trackedCoreSession = createMockCoreSession({
      sessionInfo: {
        sessionId: "tracked-id",
        providerName: "tmux",
        providerSessionId: "tmux_tracked-id",
        command: "bash",
        args: [],
        cwd: "/tmp",
        status: "running",
        exitCode: undefined,
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        ttlMs: 3600000,
      },
    })
    mockCoreListSessions.mockReturnValue([trackedCoreSession])

    // list-sessions 返回 tracked + 外部 session
    mockExecTmux.mockResolvedValue({
      stdout: "tmux_tracked-id\t1700000000\t80\t24\nexternal-session\t1700000001\t120\t30\n",
      stderr: "",
      exitCode: 0,
    })

    const sessions = await provider.list()

    // 应包含 tracked session
    expect(sessions.some(s => s.providerSessionId === "tmux_tracked-id")).toBe(true)
    // 应包含外部 session（不与 tracked 重复）
    expect(sessions.some(s => s.providerSessionId === "external-session")).toBe(true)
    expect(sessions.some(s => s.command === "tmux-external")).toBe(true)
  })

  it("list() 当 tmux 无 session 时返回空列表", async () => {
    const provider = createProvider()
    // 先触发 isAvailable 缓存 true
    await provider.isAvailable()
    mockCoreListSessions.mockReturnValue([])
    // list-sessions 无 session 时 tmux 返回非零 exitCode
    mockExecTmux.mockResolvedValue({ stdout: "", stderr: "", exitCode: 1 })

    const sessions = await provider.list()
    expect(sessions).toEqual([])
  })

  // ---- coreSessionToTerminalSession 转换 ----

  it("start() 返回的 TerminalSession 正确映射 TmuxCoreSession 字段", async () => {
    const provider = createProvider()
    const coreSession = createMockCoreSession({
      sessionInfo: {
        sessionId: "mapped-id",
        providerName: "tmux",
        providerSessionId: "tmux_mapped-id",
        command: "vim",
        args: ["file.txt"],
        cwd: "/home",
        label: "my-editor",
        status: "running",
        exitCode: undefined,
        createdAt: "2025-01-01T00:00:00.000Z",
        lastActivityAt: "2025-01-01T00:00:01.000Z",
        ttlMs: 7200000,
      },
    })
    mockCoreStart.mockResolvedValue(coreSession)

    const session = await provider.start(createStartInput())

    expect(session.sessionId).toBe("mapped-id")
    expect(session.providerSessionId).toBe("tmux_mapped-id")
    expect(session.command).toBe("vim")
    expect(session.args).toEqual(["file.txt"])
    expect(session.cwd).toBe("/home")
    expect(session.label).toBe("my-editor")
    expect(session.exitCode).toBeNull()
    expect(session.ttlMs).toBe(7200000)
    expect(session.capabilities).toBe(provider.capabilities)
  })
})
