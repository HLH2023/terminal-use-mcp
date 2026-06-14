import { describe, expect, it } from "vitest"

import { createLogger } from "../../src/logger.js"
import type { StartInput } from "../../src/providers/provider.js"
import {
  createSshTmuxSessionName,
  parseTmuxListSessionsOutput,
  sanitizeTmuxSessionName,
  SshTmuxProvider,
  type SshTmuxCommandExecutor,
} from "../../src/providers/ssh-tmux-provider.js"
import { buildSshCommandArgs, buildSshRawCommandArgs, quoteRemoteArg, type SystemSshCommandResult } from "../../src/providers/system-ssh-transport.js"
import { RemoteCapabilityCache, type RemoteCapabilities } from "../../src/targets/remote-capability-cache.js"
import { RemoteCommandDeniedError, RemoteCwdDeniedError, SessionNotFoundError } from "../../src/terminal/errors.js"
import type { SshHostProfile } from "../../src/targets/target-types.js"

const logger = createLogger("error")
const DEFAULT_REMOTE_CAPS: RemoteCapabilities = {
  os: "Linux",
  shell: "/bin/bash",
  tmuxPath: "/usr/bin/tmux",
  tmuxVersion: "tmux 3.4a",
  home: "/home/tester",
}

function createProfile(overrides: Partial<SshHostProfile> = {}): SshHostProfile {
  return {
    name: "devbox",
    host: "192.0.2.10",
    port: 2222,
    username: "tester",
    auth: { type: "agent" },
    defaultCwd: "/home/tester/project",
    remoteAllowedCwd: ["/home/tester", "/srv/lab"],
    remoteDeniedCwd: ["/root", "/etc"],
    allowTmux: true,
    connectTimeoutMs: 10_000,
    ...overrides,
  }
}

function createStartInput(overrides: Partial<StartInput> = {}): StartInput {
  return {
    command: "node",
    args: ["app.js"],
    cwd: "/home/tester/project",
    cols: 100,
    rows: 30,
    target: { kind: "ssh", profile: "devbox" },
    ...overrides,
  }
}

function ok(stdout = ""): SystemSshCommandResult {
  return { stdout, stderr: "", exitCode: 0 }
}

function createProviderWithExecutor(
  handler?: (args: readonly string[]) => SystemSshCommandResult,
  capabilities: RemoteCapabilities = DEFAULT_REMOTE_CAPS,
): {
  provider: SshTmuxProvider
  calls: string[][]
} {
  const calls: string[][] = []
  const executor: SshTmuxCommandExecutor = async (_profile, args) => {
    calls.push([...args])
    return handler?.(args) ?? ok()
  }
  const provider = new SshTmuxProvider(logger, {
    hostsConfig: new Map([["devbox", createProfile()]]),
    commandExecutor: executor,
    sshAvailabilityChecker: async () => true,
    capabilityCache: new RemoteCapabilityCache([["devbox", capabilities]]),
  })
  return { provider, calls }
}

describe("system ssh transport", () => {
  it("isAvailable 不依赖真实连接且不会崩溃", async () => {
    const provider = new SshTmuxProvider(logger)
    await expect(provider.isAvailable()).resolves.toEqual(expect.any(Boolean))
  })

  it("构造 SSH argv 时强制 BatchMode 与 StrictHostKeyChecking", () => {
    const args = buildSshCommandArgs(
      { host: "example.test", port: 2222, username: "tester" },
      ["tmux", "send-keys", "-l", "hello world"],
      { connectTimeoutMs: 10_000 },
    )

    expect(args).toContain("BatchMode=yes")
    expect(args).toContain("StrictHostKeyChecking=yes")
    expect(args).toContain("ConnectTimeout=10")
    expect(args).toContain("tester@example.test")
    expect(args).toContain("--")
    expect(args).toContain("tmux")
    expect(args).toContain("'hello world'")
  })

  it("构造 raw SSH command argv 时不对内部 probe 命令做 token 拆分", () => {
    const args = buildSshRawCommandArgs(
      { host: "example.test", port: 2222, username: "tester" },
      "printf 'OS=%s\\n' \"$(uname -s)\"",
      { connectTimeoutMs: 10_000 },
    )

    expect(args).toContain("BatchMode=yes")
    expect(args.at(-1)).toBe("printf 'OS=%s\\n' \"$(uname -s)\"")
  })

  it("key-file 模式把 -i path 放在 host 参数之前", () => {
    const args = buildSshCommandArgs(
      { host: "example.test", port: 22, username: "tester" },
      ["tmux", "-V"],
      { keyFile: "/home/tester/.ssh/id_ed25519" },
    )

    expect(args.slice(0, 2)).toEqual(["-i", "/home/tester/.ssh/id_ed25519"])
    expect(args.indexOf("tester@example.test")).toBeGreaterThan(args.indexOf("-i"))
  })

  it("ProxyJump 作为 SSH option 放在 host 参数之前", () => {
    const args = buildSshCommandArgs(
      { host: "example.test", port: 22, username: "tester", proxyJump: "bastion" },
      ["tmux", "-V"],
    )

    expect(args).toContain("ProxyJump=bastion")
    expect(args.indexOf("tester@example.test")).toBeGreaterThan(args.indexOf("ProxyJump=bastion"))
  })

  it("远端 argv 会按 POSIX shell token 规则转义", () => {
    expect(quoteRemoteArg("simple-OK_1")).toBe("simple-OK_1")
    expect(quoteRemoteArg("a b;c$(rm)")).toBe("'a b;c$(rm)'")
    expect(quoteRemoteArg("it's ok")).toBe("'it'\"'\"'s ok'")
  })
})

describe("SshTmuxProvider", () => {
  it("能力矩阵符合 ssh-tmux 规格", () => {
    const { provider } = createProviderWithExecutor()
    expect(provider.capabilities).toMatchObject({
      provider: "ssh-tmux",
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
    })
  })

  it("生成 rtumcp_ + 8 位 hex 的安全远程 session 名", () => {
    for (let index = 0; index < 20; index += 1) {
      expect(createSshTmuxSessionName()).toMatch(/^rtumcp_[0-9a-f]{8}$/)
    }
  })

  it("净化特殊字符 session 名，避免冒号和空白污染 tmux target", () => {
    const safe = sanitizeTmuxSessionName(" :bad name;$(rm)-x ")
    expect(safe).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
    expect(safe).not.toContain(":")
    expect(safe).not.toContain(" ")
    expect(safe).not.toContain(";")
  })

  it("start 使用远程 tmux new-session argv 并生成安全 session 名", async () => {
    const { provider, calls } = createProviderWithExecutor()
    const session = await provider.start(createStartInput())
    const startCall = calls.find((call) => call[1] === "new-session")

    expect(session.providerName).toBe("ssh-tmux")
    expect(session.providerSessionId).toMatch(/^rtumcp_[0-9a-f]{8}$/)
    expect(startCall).toBeDefined()
    expect(startCall).toEqual([
      "/usr/bin/tmux",
      "new-session",
      "-d",
      "-s",
      session.providerSessionId,
      "-x",
      "100",
      "-y",
      "30",
      "-c",
      "/home/tester/project",
      "--",
      expect.stringMatching(/^exec '\/bin\/bash' -l -ic /u),
    ])
    expect(startCall?.at(-1)).toContain("node")
    expect(startCall?.at(-1)).toContain("app.js")
  })

  it("Windows shell 路径含空格时 start command 引用 shell executable", async () => {
    const shell = "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
    const { provider, calls } = createProviderWithExecutor(undefined, {
      ...DEFAULT_REMOTE_CAPS,
      os: "Windows",
      shell,
    })

    await provider.start(createStartInput({ command: "node", args: ["app.js"], cwd: "/home/tester/project" }))

    const startCall = calls.find((call) => call[1] === "new-session")
    expect(startCall?.at(-1)).toContain(`"${shell}" /c`)
  })

  it("RemoteCwdPolicy 拒绝远程 denied cwd", async () => {
    const { provider } = createProviderWithExecutor()
    await expect(provider.start(createStartInput({ cwd: "/etc" }))).rejects.toThrow(RemoteCwdDeniedError)
  })

  it("target.kind=local 会被 ssh-tmux 拒绝", async () => {
    const { provider } = createProviderWithExecutor()
    await expect(provider.start(createStartInput({ target: { kind: "local" } }))).rejects.toThrow(RemoteCommandDeniedError)
  })

  it("kill 未跟踪 session 返回 SESSION_NOT_FOUND", async () => {
    const { provider } = createProviderWithExecutor()
    await expect(provider.kill("missing-session")).rejects.toThrow(SessionNotFoundError)
  })

  it("press 复用本地 tmux keymap", async () => {
    const { provider, calls } = createProviderWithExecutor()
    const session = await provider.start(createStartInput())
    await provider.press(session.providerSessionId, "ctrl+c", { modifiers: ["ctrl"], key: "c" })

    expect(calls.at(-1)).toEqual(["/usr/bin/tmux", "send-keys", "-t", session.providerSessionId, "C-c"])
  })

  it("remote tmux 缺失时 start 失败关闭", async () => {
    const { provider } = createProviderWithExecutor(undefined, { ...DEFAULT_REMOTE_CAPS, tmuxPath: null, tmuxVersion: null })

    await expect(provider.start(createStartInput())).rejects.toThrow(/tmux is not installed/u)
  })

  it("remote tmux 低于 3.2 时 start 失败关闭", async () => {
    const { provider } = createProviderWithExecutor(undefined, { ...DEFAULT_REMOTE_CAPS, tmuxVersion: "tmux 3.1c" })

    await expect(provider.start(createStartInput())).rejects.toThrow(/not supported/u)
  })

  it("remote tmux version 不可解析时 start 失败关闭", async () => {
    const { provider } = createProviderWithExecutor(undefined, { ...DEFAULT_REMOTE_CAPS, tmuxVersion: null })

    await expect(provider.start(createStartInput())).rejects.toThrow(/unknown/u)
  })

  it("rejects remote tmux when version is unparseable despite tmuxPath present", async () => {
    const caps: RemoteCapabilities = {
      os: "Linux",
      shell: "/bin/bash",
      tmuxPath: "/usr/bin/tmux",
      tmuxVersion: null,
      home: "/home/user",
    }
    const { provider } = createProviderWithExecutor(undefined, caps)

    await expect(provider.start(createStartInput())).rejects.toThrow(/unknown/u)
  })

  it("parse tmux list-sessions 输出为结构化列表", () => {
    const entries = parseTmuxListSessionsOutput("rtumcp_abcd1234\t1710000000\t120\t40\nother\tbad\tx\ty\n")
    expect(entries[0]).toEqual({
      name: "rtumcp_abcd1234",
      createdAt: "2024-03-09T16:00:00.000Z",
      cols: 120,
      rows: 40,
    })
    expect(entries[1]?.name).toBe("other")
    expect(entries[1]?.cols).toBe(80)
    expect(entries[1]?.rows).toBe(24)
  })

  it("snapshot 通过 XtermAdapter 解析 capture-pane -e 输出", async () => {
    const { provider, calls } = createProviderWithExecutor((args) => {
      if (args[1] === "capture-pane") return ok("hello\nworld\n")
      if (args[1] === "display-message" && args.includes("#{history_size}")) return ok("23\n")
      if (args[1] === "display-message" && args.includes("#{session_name}")) return ok("remote-title\n")
      return ok()
    })

    const session = await provider.start(createStartInput())
    const snapshot = await provider.snapshot(session.providerSessionId)

    // XtermAdapter 从 capture-pane -e 的输出解析屏幕内容（全网格，含尾部空行）
    expect(snapshot.screen).toContain("hello")
    expect(snapshot.screen).toContain("world")
    // cursor 来自 xterm-headless 解析，不再通过 display-message 查询
    expect(snapshot.cursor).toEqual({ x: expect.any(Number), y: expect.any(Number) })
    expect(snapshot.title).toBe("remote-title")
    expect(snapshot.scrollbackLineCount).toBe(23)
    expect(snapshot.observationTrust).toBe("untrusted")
    // 验证 capture-pane 调用包含 -e 标志
    const captureCall = calls.find((call) => call[1] === "capture-pane")
    expect(captureCall).toBeDefined()
    expect(captureCall).toContain("-e")
    const historyCall = calls.find((call) => call[1] === "display-message" && call.includes("#{history_size}"))
    expect(historyCall).toBeDefined()
  })
})
