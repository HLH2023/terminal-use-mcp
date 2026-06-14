/**
 * NativePtyProvider 单元测试
 *
 * 覆盖关键路径：isAvailable / start / snapshot / mouseClick / mouseScroll / kill / capabilities。
 * 所有外部依赖通过 vi.mock 隔离，不依赖真实 node-pty 或终端环境。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createLogger } from "../../src/logger.js"
import { NativePtyProvider } from "../../src/providers/native-pty-provider.js"
import type { StartInput } from "../../src/providers/provider.js"
import { InvalidMouseCoordsError, SessionNotFoundError } from "../../src/terminal/errors.js"

// ============================================================
// Mock: node-pty
// ============================================================

const mockPtyInstance = {
  write: vi.fn(),
  kill: vi.fn(),
  resize: vi.fn(),
  onData: vi.fn((_callback: (data: string) => void) => ({ dispose: vi.fn() })),
  onExit: vi.fn((_callback: (e: { exitCode: number; signal?: number }) => void) => ({ dispose: vi.fn() })),
}

vi.mock("node-pty", () => ({
  spawn: vi.fn(() => mockPtyInstance),
}))

// ============================================================
// Mock: XtermAdapter
// ============================================================

const mockXtermAdapter = {
  write: vi.fn(),
  readScreen: vi.fn(() => ({
    lines: [{ text: "$ ", hasContent: true }],
    cursor: { x: 2, y: 0 },
    cols: 80,
    rows: 24,
    scrollbackLineCount: 0,
    isAltBuffer: false,
    title: "test-terminal",
  })),
  detectHighlights: vi.fn(() => []),
  dispose: vi.fn(),
  resize: vi.fn(),
  markClean: vi.fn(),
  getLastWriteAt: vi.fn(() => Date.now()),
}

vi.mock("../../src/terminal/xterm-adapter.js", () => ({
  XtermAdapter: vi.fn(() => ({ ...mockXtermAdapter })),
}))

// ============================================================
// Mock: TranscriptRecorder — 避免真实 transcript 副作用
// ============================================================

vi.mock("../../src/terminal/transcript.js", () => ({
  TranscriptRecorder: vi.fn(() => ({
    recordOutput: vi.fn(),
    recordInput: vi.fn(),
    recordExit: vi.fn(),
    recordSnapshot: vi.fn(),
    recordResize: vi.fn(),
    export: vi.fn(() => "transcript-content"),
    getEventCount: vi.fn(() => 0),
    getEvents: vi.fn(() => ({ events: [] })),
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

/** 通过 provider.start 创建一个 session，返回 providerSessionId */
async function startSession(provider: NativePtyProvider, input?: Partial<StartInput>): Promise<string> {
  const session = await provider.start(createStartInput(input))
  return session.providerSessionId
}

// ============================================================
// 测试
// ============================================================

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("NativePtyProvider", () => {
  // ---- isAvailable ----

  it("isAvailable() 当 node-pty 可导入时返回 true", async () => {
    // vi.mock("node-pty") 默认让 import 成功
    const provider = new NativePtyProvider(logger)
    await expect(provider.isAvailable()).resolves.toBe(true)
  })

  it("isAvailable() 重复调用复用已加载的 node-pty mock", async () => {
    const provider = new NativePtyProvider(logger)
    await expect(provider.isAvailable()).resolves.toBe(true)
    await expect(provider.isAvailable()).resolves.toBe(true)
  })

  // ---- capabilities ----

  it("capabilities 声明 native-pty 核心能力标记", () => {
    const provider = new NativePtyProvider(logger)

    expect(provider.capabilities).toEqual({
      provider: "native-pty",
      supportsStart: true,
      supportsAttach: false,
      supportsStableWait: true,
      supportsTextWait: true,
      supportsHighlights: true,
      supportsScrollback: true,
      supportsResize: true,
      supportsTranscriptExport: true,
      supportsExitCode: true,
      supportsTitle: true,
      supportsFullscreenDetection: true,
      supportsRename: false,
      supportsScroll: true,
      supportsFind: true,
      supportsMouseClick: true,
      supportsMouseScroll: true,
    })
  })

  // ---- start ----

  it("start() 创建 session 并注册到 sessions map", async () => {
    const provider = new NativePtyProvider(logger)
    const session = await provider.start(createStartInput())

    expect(session.providerName).toBe("native-pty")
    expect(session.providerSessionId).toMatch(/^native_/)
    expect(session.status).toBe("running")
    expect(session.command).toBe("bash")
    // TerminalSession 不含 cols/rows；caps 在 capabilities 中声明
    expect(session.capabilities.provider).toBe("native-pty")

    // pty.spawn 应被调用一次
    const { spawn } = await import("node-pty")
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledWith("bash", [], expect.objectContaining({
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: "/tmp",
    }))
  })

  it("start() spawn 失败时 XtermAdapter.dispose 被调用", async () => {
    const { spawn } = await import("node-pty")
    const spawnError = new Error("spawn failed: command not found")
    vi.mocked(spawn).mockImplementationOnce(() => { throw spawnError })

    const provider = new NativePtyProvider(logger)
    await expect(provider.start(createStartInput())).rejects.toThrow("spawn failed: command not found")

    // XtermAdapter 在 spawn 之前已创建，spawn 失败后应被释放
    expect(mockXtermAdapter.dispose).toHaveBeenCalledTimes(1)
  })

  // ---- snapshot ----

  it("snapshot() viewport 模式返回屏幕结构", async () => {
    const provider = new NativePtyProvider(logger)
    const sessionId = await startSession(provider)

    const snapshot = await provider.snapshot(sessionId, "viewport")

    // readScreen 在 viewport 模式下被调用
    expect(mockXtermAdapter.readScreen).toHaveBeenCalledWith("viewport")
    expect(snapshot.screen).toBe("$ ")
    expect(snapshot.cursor).toEqual({ x: 2, y: 0 })
    expect(snapshot.observationTrust).toBe("untrusted")
  })

  it("snapshot() full 模式传入 'full' 参数给 readScreen", async () => {
    const provider = new NativePtyProvider(logger)
    const sessionId = await startSession(provider)

    await provider.snapshot(sessionId, "full")

    expect(mockXtermAdapter.readScreen).toHaveBeenCalledWith("full")
  })

  it("snapshot() 不存在的 session 抛 SESSION_NOT_FOUND", async () => {
    const provider = new NativePtyProvider(logger)
    await expect(provider.snapshot("nonexistent-session")).rejects.toThrow(SessionNotFoundError)
  })

  // ---- mouseClick ----

  it("mouseClick() 对活跃 session 调用 pty.write", async () => {
    const provider = new NativePtyProvider(logger)
    const sessionId = await startSession(provider)

    await provider.mouseClick(sessionId, { col: 5, row: 3, button: "left" })

    // pty.write 被调用（只检查被调用，不验证具体 ANSI 序列）
    expect(mockPtyInstance.write).toHaveBeenCalled()
  })

  it("mouseClick() 坐标越界抛 INVALID_MOUSE_COORDS", async () => {
    const provider = new NativePtyProvider(logger)
    const sessionId = await startSession(provider)

    await expect(
      provider.mouseClick(sessionId, { col: 0, row: 3, button: "left" }),
    ).rejects.toThrow(InvalidMouseCoordsError)
  })

  // ---- mouseScroll ----

  it("mouseScroll() 对活跃 session 调用 pty.write", async () => {
    const provider = new NativePtyProvider(logger)
    const sessionId = await startSession(provider)

    await provider.mouseScroll(sessionId, { col: 1, row: 1, direction: "down" })

    expect(mockPtyInstance.write).toHaveBeenCalled()
  })

  // ---- kill ----

  it("kill() 调用 pty.kill + adapter.dispose，并移除 session", async () => {
    const provider = new NativePtyProvider(logger)
    const sessionId = await startSession(provider)

    await provider.kill(sessionId)

    expect(mockPtyInstance.kill).toHaveBeenCalled()
    expect(mockXtermAdapter.dispose).toHaveBeenCalled()
    // kill 后再 snapshot 应抛 SESSION_NOT_FOUND
    await expect(provider.snapshot(sessionId)).rejects.toThrow(SessionNotFoundError)
  })

  it("kill() 在 win32 下调用 pty.kill 时不传 signal", async () => {
    const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")
    Object.defineProperty(process, "platform", { value: "win32", configurable: true })

    try {
      const provider = new NativePtyProvider(logger)
      const sessionId = await startSession(provider)

      await provider.kill(sessionId)

      expect(mockPtyInstance.kill).toHaveBeenCalledWith()
    } finally {
      if (originalPlatformDescriptor !== undefined) {
        Object.defineProperty(process, "platform", originalPlatformDescriptor)
      }
    }
  })

  it("kill() 不存在的 session 抛 SESSION_NOT_FOUND", async () => {
    const provider = new NativePtyProvider(logger)
    await expect(provider.kill("nonexistent-session")).rejects.toThrow(SessionNotFoundError)
  })

  // ---- 已退出 session 操作拒绝 ----

  it("对已 kill 的 session 执行 mouseClick 抛 SESSION_NOT_FOUND", async () => {
    const provider = new NativePtyProvider(logger)
    const sessionId = await startSession(provider)

    // kill 后 session 从 map 中移除，后续操作抛 SESSION_NOT_FOUND
    await provider.kill(sessionId)

    await expect(
      provider.mouseClick(sessionId, { col: 1, row: 1, button: "left" }),
    ).rejects.toThrow(SessionNotFoundError)
  })

  it("node-pty 缺失时 isAvailable() 返回 false 且 start() 抛 PROVIDER_NOT_AVAILABLE", async () => {
    vi.resetModules()
    vi.doMock("node-pty", () => {
      throw new Error("node-pty missing")
    })

    const { NativePtyProvider: IsolatedNativePtyProvider } = await import("../../src/providers/native-pty-provider.js")
    const provider = new IsolatedNativePtyProvider(logger)

    await expect(provider.isAvailable()).resolves.toBe(false)
    await expect(provider.start(createStartInput())).rejects.toMatchObject({
      code: "PROVIDER_NOT_AVAILABLE",
      hint: "node-pty not available",
      provider: "native-pty",
    })
  })
})
