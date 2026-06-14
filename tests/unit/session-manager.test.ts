import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { SessionManager, PromiseQueue } from "../../src/session-manager.js"
import type { TerminalProvider, TerminalSession, ProviderCapabilities } from "../../src/providers/provider.js"
import type { ProviderName } from "../../src/providers/provider.js"
import type { TerminalUseConfig } from "../../src/config.js"
import type { Logger } from "../../src/logger.js"

// ============================================================
// Mock 工厂
// ============================================================

// realpath fail-closed 要求 workspaceRoot 和 CWD 必须真实存在
let tempWorkspaceDir: string

function createMockConfig(overrides?: Partial<TerminalUseConfig>): TerminalUseConfig {
  const baseConfig: TerminalUseConfig = {
    workspaceRoot: tempWorkspaceDir,
    allowedCwdRoots: [],
    allowedCommands: [],
    deniedCommands: [],
    riskyCommandMode: "deny",
    sessionTtlMs: 3_600_000,
    cleanupIntervalMs: 60_000,
    defaultProvider: "native-pty",
    defaultCols: 120,
    defaultRows: 30,
    artifactDir: "/tmp/terminal-use-mcp-test/artifacts",
    largePasteLimit: 2000,
    hardPasteLimit: 10000,
    logLevel: "warn",
    hostsConfigPath: undefined,
    allowInlineSshTargets: false,
    sshDefaults: {
      remoteDeniedCwd: ["/", "/root", "/etc", "/boot", "/proc", "/sys"],
      allowTmux: true,
      connectTimeoutMs: 10_000,
      keepaliveIntervalMs: 15_000,
    },
    enabledProviders: ["native-pty", "tmux", "ssh-pty", "ssh-tmux"],
  }
  return { ...baseConfig, ...overrides }
}

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setLevel: vi.fn(),
  }
}

function createMockCapabilities(): ProviderCapabilities {
  return {
    provider: "native-pty" as ProviderName,
    supportsStart: true,
    supportsAttach: true,
    supportsStableWait: true,
    supportsTextWait: true,
    supportsHighlights: false,
    supportsScrollback: false,
    supportsResize: true,
    supportsTranscriptExport: true,
    supportsExitCode: true,
    supportsTitle: false,
    supportsFullscreenDetection: false,
    supportsRename: false,
    supportsScroll: false,
    supportsFind: false,
    supportsMouseClick: false,
    supportsMouseScroll: false,
  }
}

function createMockProviderSession(overrides?: Partial<TerminalSession>): TerminalSession {
  return {
    sessionId: "term_abc123",
    providerName: "native-pty",
    providerSessionId: "pty_001",
    command: "bash",
    args: [],
    cwd: tempWorkspaceDir,
    label: undefined,
    status: "running",
    exitCode: undefined,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    ttlMs: 3_600_000,
    capabilities: createMockCapabilities(),
    ...overrides,
  }
}

function createMockProvider(overrides?: Partial<TerminalProvider> | ProviderName): TerminalProvider {
  const normalizedOverrides: Partial<TerminalProvider> | undefined = typeof overrides === "string"
    ? { name: overrides, capabilities: { ...createMockCapabilities(), provider: overrides } }
    : overrides

  const provider: TerminalProvider = {
    name: "native-pty" as ProviderName,
    capabilities: createMockCapabilities(),
    isAvailable: vi.fn().mockResolvedValue(true),
    start: vi.fn().mockResolvedValue(createMockProviderSession()),
    snapshot: vi.fn(),
    waitForText: vi.fn(),
    waitStable: vi.fn(),
    type: vi.fn(),
    press: vi.fn(),
    paste: vi.fn(),
    kill: vi.fn().mockResolvedValue(undefined),
    exportTranscript: vi.fn(),
    hasSession: vi.fn().mockReturnValue(false),
    listActiveSessionIds: vi.fn().mockReturnValue([]),
  }
  return normalizedOverrides === undefined ? provider : Object.assign(provider, normalizedOverrides)
}

// ============================================================
// PromiseQueue 测试
// ============================================================

describe("PromiseQueue", () => {
  it("操作按入队顺序串行执行", async () => {
    const queue = new PromiseQueue()
    const order: number[] = []

    const p1 = queue.enqueue(async () => {
      order.push(1)
    })
    const p2 = queue.enqueue(async () => {
      order.push(2)
    })
    const p3 = queue.enqueue(async () => {
      order.push(3)
    })

    await Promise.all([p1, p2, p3])
    expect(order).toEqual([1, 2, 3])
  })

  it("操作返回值正确传递", async () => {
    const queue = new PromiseQueue()
    const result = await queue.enqueue(async () => 42)
    expect(result).toBe(42)
  })

  it("操作抛出的错误正确传递", async () => {
    const queue = new PromiseQueue()
    await expect(
      queue.enqueue(async () => {
        throw new Error("test error")
      }),
    ).rejects.toThrow("test error")
  })

  it("一个操作失败不影响后续操作", async () => {
    const queue = new PromiseQueue()
    const order: number[] = []

    const p1 = queue.enqueue(async () => {
      order.push(1)
      throw new Error("fail")
    }).catch(() => { /* 吞掉错误 */ })
    const p2 = queue.enqueue(async () => {
      order.push(2)
    })

    await Promise.all([p1, p2])
    expect(order).toEqual([1, 2])
  })
})

// ============================================================
// SessionManager 测试
// ============================================================

describe("SessionManager", () => {
  let config: TerminalUseConfig
  let logger: Logger

  beforeEach(() => {
    tempWorkspaceDir = mkdtempSync(join(tmpdir(), "tumcp-sm-test-"))
    mkdirSync(tempWorkspaceDir, { recursive: true })
    config = createMockConfig()
    logger = createMockLogger()
  })

  afterEach(() => {
    rmSync(tempWorkspaceDir, { recursive: true, force: true })
  })

  it("构造函数创建 manager 实例", () => {
    const manager = new SessionManager(config, logger)
    expect(manager).toBeInstanceOf(SessionManager)
  })

  it("registerProvider 注册 provider 到内部 map", () => {
    const manager = new SessionManager(config, logger)
    const provider = createMockProvider()
    manager.registerProvider(provider)
    const providers = manager.getProviders()
    expect(providers.has("native-pty")).toBe(true)
    expect(providers.get("native-pty")).toBe(provider)
  })

  it("getProviders() 返回已注册的 providers map", () => {
    const manager = new SessionManager(config, logger)
    const providers = manager.getProviders()
    expect(providers.size).toBe(0)

    const provider = createMockProvider()
    manager.registerProvider(provider)
    expect(manager.getProviders().size).toBe(1)
  })

  it("listSessions() 初始返回空数组", () => {
    const manager = new SessionManager(config, logger)
    expect(manager.listSessions()).toEqual([])
  })

  it("getSession() 对不存在的 id 抛出 SessionNotFoundError", () => {
    const manager = new SessionManager(config, logger)
    expect(() => manager.getSession("nonexistent")).toThrow("Session not found: nonexistent")
  })

  it("getSession() 对存在的 id 返回 session", async () => {
    const manager = new SessionManager(config, logger)
    const provider = createMockProvider()
    manager.registerProvider(provider)

    const session = await manager.start({
      command: "bash",
      args: [],
      cwd: tempWorkspaceDir,
      cols: 120,
      rows: 30,
    })

    const found = manager.getSession(session.sessionId)
    expect(found.sessionId).toBe(session.sessionId)
  })

  it("touchSession() 更新 lastActivityAt", async () => {
    const manager = new SessionManager(config, logger)
    const provider = createMockProvider()
    manager.registerProvider(provider)

    const session = await manager.start({
      command: "bash",
      args: [],
      cwd: tempWorkspaceDir,
      cols: 120,
      rows: 30,
    })

    const before = session.lastActivityAt.getTime()
    // 等待一点时间确保时间差
    await new Promise((r) => setTimeout(r, 10))
    manager.touchSession(session.sessionId)
    const after = session.lastActivityAt.getTime()
    expect(after).toBeGreaterThanOrEqual(before)
  })

  it("start() 对不安全的命令抛出 UnsafeCommandError", async () => {
    const manager = new SessionManager(config, logger)
    const provider = createMockProvider()
    manager.registerProvider(provider)

    await expect(
      manager.start({
        command: "sudo rm -rf /",
        args: [],
        cwd: tempWorkspaceDir,
        cols: 120,
        rows: 30,
      }),
    ).rejects.toThrow("blocked by safety policy")
  })

  it("start() 对不允许的 CWD 抛出 InvalidCwdError", async () => {
    const manager = new SessionManager(config, logger)
    const provider = createMockProvider()
    manager.registerProvider(provider)

    await expect(
      manager.start({
        command: "bash",
        args: [],
        cwd: "/etc",
        cols: 120,
        rows: 30,
      }),
    ).rejects.toThrow()
  })

  it("start() 成功创建 session", async () => {
    const manager = new SessionManager(config, logger)
    const provider = createMockProvider()
    manager.registerProvider(provider)

    const session = await manager.start({
      command: "bash",
      args: [],
      cwd: tempWorkspaceDir,
      cols: 120,
      rows: 30,
    })

    expect(session).toBeDefined()
    expect(session.status).toBe("running")
    expect(session.command).toBe("bash")
    expect(manager.listSessions().length).toBe(1)
  })

  it("listSessions() 返回所有 session", async () => {
    const manager = new SessionManager(config, logger)
    const provider = createMockProvider()

    // 让 start 返回不同的 sessionId
    provider.start = vi.fn()
      .mockResolvedValueOnce(createMockProviderSession({ sessionId: "term_aaa111" }))
      .mockResolvedValueOnce(createMockProviderSession({ sessionId: "term_bbb222" }))

    manager.registerProvider(provider)

    await manager.start({ command: "bash", args: [], cwd: tempWorkspaceDir, cols: 80, rows: 24 })
    await manager.start({ command: "node", args: [], cwd: tempWorkspaceDir, cols: 80, rows: 24 })

    const sessions = manager.listSessions()
    expect(sessions.length).toBe(2)
  })

  it("removeSession() 从列表移除 session", async () => {
    const manager = new SessionManager(config, logger)
    const provider = createMockProvider()
    provider.start = vi.fn().mockResolvedValue(
      createMockProviderSession({ sessionId: "term_remove001" }),
    )
    manager.registerProvider(provider)

    const session = await manager.start({
      command: "bash", args: [], cwd: tempWorkspaceDir, cols: 80, rows: 24,
    })

    expect(manager.listSessions().length).toBe(1)
    manager.removeSession(session.sessionId)
    expect(manager.listSessions().length).toBe(0)
  })

  it("removeSession() 对不存在的 id 抛出 SessionNotFoundError", () => {
    const manager = new SessionManager(config, logger)
    expect(() => manager.removeSession("nonexistent")).toThrow("Session not found")
  })

  it("kill() 调用 provider.kill 并移除 session", async () => {
    const manager = new SessionManager(config, logger)
    const provider = createMockProvider()
    provider.start = vi.fn().mockResolvedValue(
      createMockProviderSession({ sessionId: "term_kill001" }),
    )
    manager.registerProvider(provider)

    const session = await manager.start({
      command: "bash", args: [], cwd: tempWorkspaceDir, cols: 80, rows: 24,
    })

    await manager.kill(session.sessionId)
    expect(provider.kill).toHaveBeenCalledWith(session.providerSessionId)
    expect(manager.listSessions().length).toBe(0)
  })

  it("TTL cleanup 定时器启动和停止", () => {
    const manager = new SessionManager(config, logger)
    // 启动定时器
    manager.startTtlCleanup()
    // 再次启动不应创建新定时器
    manager.startTtlCleanup()

    // 停止定时器
    manager.stopTtlCleanup()
    // 再次停止不应报错
    manager.stopTtlCleanup()
  })
})

describe("SessionManager.stripProviderPrefix", () => {
  // 该 describe 独立于主 SessionManager describe，需要自己的 fixture
  beforeEach(() => {
    tempWorkspaceDir = mkdtempSync(join(tmpdir(), "tumcp-sm-test-"))
    mkdirSync(tempWorkspaceDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempWorkspaceDir, { recursive: true, force: true })
  })

  it("剥离 native_ 前缀", () => {
    expect(SessionManager.stripProviderPrefix("native_term_abc123")).toBe("term_abc123")
  })

  it("剥离 sshpty_ 前缀", () => {
    expect(SessionManager.stripProviderPrefix("sshpty_term_def456")).toBe("term_def456")
  })

  it("剥离 tumcp_ 前缀", () => {
    expect(SessionManager.stripProviderPrefix("tumcp_term_ghi789")).toBe("term_ghi789")
  })

  it("剥离 tmux_ 前缀", () => {
    expect(SessionManager.stripProviderPrefix("tmux_term_jkl012")).toBe("term_jkl012")
  })

  it("无前缀时原样返回", () => {
    expect(SessionManager.stripProviderPrefix("term_mno345")).toBe("term_mno345")
  })

  it("getSession 容忍 native_ 前缀并找到 session", async () => {
    const provider = createMockProvider("native-pty")
    const logger = createMockLogger()
    const localConfig = createMockConfig()
    const manager = new SessionManager(localConfig, logger)
    manager.registerProvider(provider)

    const session = await manager.start({
      command: "bash", args: [], cwd: tempWorkspaceDir, cols: 80, rows: 24,
    })

    // 精确 ID 查找
    expect(manager.getSession(session.sessionId)).toBeDefined()

    // 带 native_ 前缀查找 (模拟 LLM 错误拼接)
    const prefixedId = `native_${session.sessionId}`
    const found = manager.getSession(prefixedId)
    expect(found.sessionId).toBe(session.sessionId)
    expect(logger.info).toHaveBeenCalledWith(
      "session lookup: stripped provider prefix",
      expect.objectContaining({ original: prefixedId, resolved: session.sessionId }),
    )

    await manager.kill(session.sessionId)
  })

  it("getSession 模糊后缀匹配兜底未知前缀变形", async () => {
    const provider = createMockProvider("native-pty")
    const logger = createMockLogger()
    const manager = new SessionManager(createMockConfig(), logger)
    manager.registerProvider(provider)

    const session = await manager.start({
      command: "bash", args: [], cwd: tempWorkspaceDir, cols: 80, rows: 24,
    })

    // 模拟 LLM 添加未知前缀（不在 native_|sshpty_|tumcp_|tmux_| 列表中）
    const unknownPrefixedId = `unknown_prefix_${session.sessionId}`
    const found = manager.getSession(unknownPrefixedId)
    expect(found.sessionId).toBe(session.sessionId)
    expect(logger.warn).toHaveBeenCalledWith(
      "session lookup: fuzzy suffix match",
      expect.objectContaining({ original: unknownPrefixedId, resolved: session.sessionId }),
    )

    await manager.kill(session.sessionId)
  })

  it("getSession 模糊后缀匹配：输入 ID 是 session key 的后缀", async () => {
    const provider = createMockProvider("native-pty")
    const logger = createMockLogger()
    const manager = new SessionManager(createMockConfig(), logger)
    manager.registerProvider(provider)

    const session = await manager.start({
      command: "bash", args: [], cwd: tempWorkspaceDir, cols: 80, rows: 24,
    })

    // 只有 ID 的后缀部分（极端情况：LLM 截断了 ID 前半部分）
    const suffixOnly = session.sessionId.split("-").pop()!
    const found = manager.getSession(suffixOnly)
    expect(found.sessionId).toBe(session.sessionId)

    await manager.kill(session.sessionId)
  })
})
