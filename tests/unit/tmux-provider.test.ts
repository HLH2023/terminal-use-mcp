/**
 * TmuxProvider 单元测试
 *
 * 覆盖关键路径：isAvailable / start / snapshot / kill / rename / capabilities。
 * 所有外部依赖通过 vi.mock 隔离，不依赖真实 tmux 或终端环境。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createLogger } from "../../src/logger.js"
import type { StartInput } from "../../src/providers/provider.js"
import { TmuxProvider } from "../../src/providers/tmux-provider.js"
import { SessionNotFoundError } from "../../src/terminal/errors.js"

// ============================================================
// Mock: node:child_process (execFile)
// ============================================================

/**
 * 模拟 execFile 的行为 — TmuxProvider.execTmux 内部调用 execFile("tmux", args, ...)。
 * 默认让 tmux -V 成功，使 isAvailable 返回 true。
 */
type ExecFileMockArgs = [
  cmd: string,
  args: string[],
  opts: unknown,
  callback: (error: Error | null, stdout: string, stderr: string) => void,
]

const execFileMock = vi.fn((_cmd: string, _args: string[], _opts: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
  callback(null, "tmux 3.4", "")
})

vi.mock("node:child_process", () => ({
  execFile: (...args: ExecFileMockArgs) => {
    // execFile(cmd, args, opts, callback) 或 execFile(cmd, args, callback)
    execFileMock(...args)
  },
}))

/**
 * 更精确的 mock：直接控制 execFile 的回调结果。
 * 因为 TmuxProvider.execTmux 包装了 Promise，我们直接拦截其私有方法。
 * 实际实现中较难直接 mock 私有 execTmux 方法，所以通过 mock execFile 实现。
 */

// ============================================================
// Mock: XtermAdapter
// ============================================================

const mockXtermAdapterInstance = {
  write: vi.fn(),
  readScreen: vi.fn(() => ({
    lines: [{ text: "$ ", hasContent: true }],
    cursor: { x: 2, y: 0 },
    cols: 80,
    rows: 24,
    scrollbackLineCount: 0,
    isAltBuffer: false,
    title: "test-tmux",
  })),
  detectHighlights: vi.fn(() => []),
  dispose: vi.fn(),
  resize: vi.fn(),
  markClean: vi.fn(),
  getLastWriteAt: vi.fn(() => Date.now()),
}

vi.mock("../../src/terminal/xterm-adapter.js", () => ({
  XtermAdapter: vi.fn(() => ({ ...mockXtermAdapterInstance })),
}))

// ============================================================
// Mock: TranscriptRecorder
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

/**
 * 创建一个 TmuxProvider 并替换其内部 execTmux 为可控 mock。
 * 直接 mock execFile 比较困难（因为 TmuxProvider 把它包在 Promise 中），
 * 所以我们换一种策略：直接用 provider 的 start 方法建立 session，
 * 然后测试后续操作。
 *
 * 为简化测试，我们通过 Object.defineProperty 替换 execTmux 私有方法。
 */
function createProviderWithMockedExec(): {
  provider: TmuxProvider
  execTmuxMock: ReturnType<typeof vi.fn>
} {
  const execTmuxMock = vi.fn(async (_args: string[]) => ({ stdout: "tmux 3.4", stderr: "" }))

  const provider = new TmuxProvider(logger)

  // 替换私有 execTmux 方法；#dev 任意 TS 私有字段在 JS 运行时仍可访问
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 测试内部方法 hack
  ;(provider as any).execTmux = execTmuxMock

  // isAvailable 依赖 execTmux，置缓存为 true 避免真实 exec
  provider.isAvailable = async () => true

  return { provider, execTmuxMock }
}

/** 通过 mock provider.start 创建一个 session */
async function startSession(
  provider: TmuxProvider,
  execMock: ReturnType<typeof vi.fn>,
  input?: Partial<StartInput>,
): Promise<string> {
  // start 内部调用 ensureTmuxAvailable + applyEnvironment + execTmux(new-session) + clearEnvironment
  // 我们让 execTmux 统一成功
  execMock.mockResolvedValue({ stdout: "", stderr: "" })

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

describe("TmuxProvider", () => {
  // ---- isAvailable ----

  it("isAvailable() 当 tmux 可用时返回 true 并缓存结果", async () => {
    const { execTmuxMock } = createProviderWithMockedExec()
    // 清除 isAvailable override，让它走真实路径
    // 注意：由于真实 isAvailable 调用 execTmux，而我们已 mock 了 execTmux
    const freshProvider = new TmuxProvider(logger)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(freshProvider as any).execTmux = execTmuxMock
    execTmuxMock.mockResolvedValue({ stdout: "tmux 3.4", stderr: "" })

    const result = await freshProvider.isAvailable()
    expect(result).toBe(true)

    // 第二次调用应使用缓存，不再调 execTmux
    execTmuxMock.mockClear()
    const result2 = await freshProvider.isAvailable()
    expect(result2).toBe(true)
    expect(execTmuxMock).not.toHaveBeenCalled()
  })

  it("isAvailable() 当 tmux 不可用时返回 false", async () => {
    const { execTmuxMock } = createProviderWithMockedExec()
    const freshProvider = new TmuxProvider(logger)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(freshProvider as any).execTmux = execTmuxMock
    execTmuxMock.mockRejectedValue(new Error("tmux not found"))

    const result = await freshProvider.isAvailable()
    expect(result).toBe(false)
  })

  // ---- capabilities ----

  it("capabilities 声明 tmux 核心能力标记", () => {
    const { provider } = createProviderWithMockedExec()

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

  it("start() 创建 session 并调用 tmux new-session", async () => {
    const { provider, execTmuxMock } = createProviderWithMockedExec()
    const session = await provider.start(createStartInput())

    expect(session.providerName).toBe("tmux")
    expect(session.providerSessionId).toMatch(/^tumcp_/)
    expect(session.status).toBe("running")
    expect(session.command).toBe("bash")

    // 验证 execTmux 被调用 new-session
    const newSessionCall = execTmuxMock.mock.calls.find(
      (call: string[]) => call[0]?.[0] === "new-session",
    )
    expect(newSessionCall).toBeDefined()
    expect(newSessionCall![0]).toContain("-d")
    expect(newSessionCall![0]).toContain("-s")
    expect(newSessionCall![0]).toContain("--")
  })

  it("start() 失败时 XtermAdapter.dispose 被调用且环境清理", async () => {
    const { provider, execTmuxMock } = createProviderWithMockedExec()

    // 让 new-session 失败，同时 clearEnvironment 也失败不应该阻塞
    execTmuxMock.mockImplementation(async (args: string[]) => {
      if (args[0] === "new-session") {
        throw new Error("tmux new-session failed")
      }
      // applyEnvironment / clearEnvironment 需要成功
      return { stdout: "", stderr: "" }
    })

    await expect(provider.start(createStartInput({ env: { FOO: "bar" } }))).rejects.toThrow("tmux new-session failed")

    // XtermAdapter 应被释放（start 失败时 dispose）
    expect(mockXtermAdapterInstance.dispose).toHaveBeenCalled()
  })

  // ---- snapshot ----

  it("snapshot() viewport 模式调用 capture-pane 无 -S 参数", async () => {
    const { provider, execTmuxMock } = createProviderWithMockedExec()
    const sessionId = await startSession(provider, execTmuxMock)

    // 重置 mock 以便区分 snapshot 调用
    execTmuxMock.mockReset()
    execTmuxMock.mockImplementation(async (args: string[]) => {
      if (args[0] === "capture-pane") return { stdout: "hello\r\nworld\r\n", stderr: "" }
      if (args[0] === "display-message" && args.includes("#{history_size}")) return { stdout: "17\n", stderr: "" }
      return { stdout: "test-tmux\n", stderr: "" }
    })

    const snapshot = await provider.snapshot(sessionId, "viewport")

    // capture-pane 应不含 -S（viewport 模式不拉 scrollback）
    const captureCall = execTmuxMock.mock.calls.find(
      (call: string[]) => call[0]?.[0] === "capture-pane",
    )
    expect(captureCall).toBeDefined()
    expect(captureCall![0]).toContain("-e")
    expect(captureCall![0]).not.toContain("-S")
    expect(snapshot.scrollbackLineCount).toBe(17)
    expect(snapshot.observationTrust).toBe("untrusted")
    const historyCall = execTmuxMock.mock.calls.find(
      (call: string[]) => call[0]?.[0] === "display-message" && call[0]?.includes("#{history_size}"),
    )
    expect(historyCall).toBeDefined()
  })

  it("snapshot() full 模式调用 capture-pane 含 -S -5000", async () => {
    const { provider, execTmuxMock } = createProviderWithMockedExec()
    const sessionId = await startSession(provider, execTmuxMock)

    execTmuxMock.mockReset()
    execTmuxMock.mockResolvedValue({ stdout: "full\r\ncontent\r\n", stderr: "" })

    await provider.snapshot(sessionId, "full")

    const captureCall = execTmuxMock.mock.calls.find(
      (call: string[]) => call[0]?.[0] === "capture-pane",
    )
    expect(captureCall).toBeDefined()
    expect(captureCall![0]).toContain("-S")
    expect(captureCall![0]).toContain("-5000")
  })

  // ---- kill ----

  it("kill() 调用 tmux kill-session + adapter.dispose", async () => {
    const { provider, execTmuxMock } = createProviderWithMockedExec()
    const sessionId = await startSession(provider, execTmuxMock)

    execTmuxMock.mockReset()
    execTmuxMock.mockResolvedValue({ stdout: "", stderr: "" })

    await provider.kill(sessionId)

    // kill-session 应被调用
    const killCall = execTmuxMock.mock.calls.find(
      (call: string[]) => call[0]?.[0] === "kill-session",
    )
    expect(killCall).toBeDefined()
    expect(mockXtermAdapterInstance.dispose).toHaveBeenCalled()

    // session 已移除
    await expect(provider.snapshot(sessionId)).rejects.toThrow(SessionNotFoundError)
  })

  it("kill() 不存在的 session 抛 SESSION_NOT_FOUND", async () => {
    const { provider } = createProviderWithMockedExec()
    await expect(provider.kill("nonexistent-session")).rejects.toThrow(SessionNotFoundError)
  })

  // ---- rename ----

  it("rename() 调用 tmux rename-session 并更新 session 映射", async () => {
    const { provider, execTmuxMock } = createProviderWithMockedExec()
    const sessionId = await startSession(provider, execTmuxMock)

    execTmuxMock.mockReset()
    execTmuxMock.mockResolvedValue({ stdout: "", stderr: "" })

    const newLabel = "my-renamed-session"
    await provider.rename(sessionId, newLabel)

    // rename-session 应被调用
    const renameCall = execTmuxMock.mock.calls.find(
      (call: string[]) => call[0]?.[0] === "rename-session",
    )
    expect(renameCall).toBeDefined()
    expect(renameCall![0]).toContain(newLabel)

    // 原 sessionId 应失效
    await expect(provider.snapshot(sessionId)).rejects.toThrow(SessionNotFoundError)

    // 用新 label 可以访问
    const snapshot = await provider.snapshot(newLabel)
    expect(snapshot.observationTrust).toBe("untrusted")
  })

  // ---- 对已退出 session 操作拒绝 ----

  it("对已 killed 的 session 调用 type 抛 SESSION_NOT_FOUND", async () => {
    const { provider, execTmuxMock } = createProviderWithMockedExec()
    const sessionId = await startSession(provider, execTmuxMock)

    execTmuxMock.mockReset()
    execTmuxMock.mockResolvedValue({ stdout: "", stderr: "" })

    // kill 后 session 从 map 移除，后续操作抛 SESSION_NOT_FOUND
    await provider.kill(sessionId)

    await expect(provider.type(sessionId, "echo hi")).rejects.toThrow(SessionNotFoundError)
  })
})
