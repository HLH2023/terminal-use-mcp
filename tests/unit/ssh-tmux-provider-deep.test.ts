/**
 * ssh-tmux-provider 导出纯函数单元测试
 *
 * 覆盖所有从 src/providers/ssh-tmux-provider.ts 导出的纯函数：
 * parseAttachTarget, mergeRemoteEnv, buildRemoteShellCommand,
 * ensureRemoteTmuxUsable, isSupportedTmuxVersion, isRemoteSessionMissing,
 * isWindowsRemote, quoteWindowsShell, parseTmuxListSessionsOutput
 */

import { describe, expect, it } from "vitest"

import type { ProviderName } from "../../src/providers/provider.js"
import type { RemoteCapabilities } from "../../src/targets/remote-capability-cache.js"
import type { ResolvedSshTarget } from "../../src/targets/ssh-profile-loader.js"
import type { SshHostProfile } from "../../src/targets/target-types.js"
import {
  buildRemoteShellCommand,
  ensureRemoteTmuxUsable,
  isRemoteSessionMissing,
  isSupportedTmuxVersion,
  isWindowsRemote,
  mergeRemoteEnv,
  parseAttachTarget,
  parseTmuxListSessionsOutput,
  quoteWindowsShell,
} from "../../src/providers/ssh-tmux-provider.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 构建 RemoteCapabilities 的工厂函数 */
function createRemoteCaps(overrides: Partial<RemoteCapabilities> = {}): RemoteCapabilities {
  return {
    os: "Linux",
    shell: "/bin/bash",
    tmuxPath: "/usr/bin/tmux",
    tmuxVersion: "tmux 3.4a",
    home: "/home/tester",
    ...overrides,
  }
}

/** 构建 ResolvedSshTarget 的工厂函数 */
function createResolvedTarget(overrides: Partial<ResolvedSshTarget> = {}): ResolvedSshTarget {
  const base: SshHostProfile = {
    name: "devbox",
    host: "192.0.2.10",
    port: 2222,
    username: "tester",
    auth: { type: "agent" },
    defaultCwd: "/home/tester/project",
    remoteAllowedCwd: ["/home/tester"],
    ...overrides,
  }
  return {
    ...base,
    kind: "ssh",
    profile: "devbox",
    knownHostPolicy: "strict",
  }
}

// ---------------------------------------------------------------------------
// parseAttachTarget
// ---------------------------------------------------------------------------

describe("parseAttachTarget", () => {
  it("ssh-tmux://profile/session 格式 → { profile, tmuxId }", () => {
    expect(parseAttachTarget("ssh-tmux://devbox/my-session")).toEqual({
      profile: "devbox",
      tmuxId: "my-session",
    })
  })

  it("profile:session 格式 → { profile, tmuxId }", () => {
    expect(parseAttachTarget("devbox:my-session")).toEqual({
      profile: "devbox",
      tmuxId: "my-session",
    })
  })

  it("空字符串 → undefined", () => {
    expect(parseAttachTarget("")).toBeUndefined()
  })

  it("纯空白 → undefined", () => {
    expect(parseAttachTarget("   ")).toBeUndefined()
    expect(parseAttachTarget("\t\n")).toBeUndefined()
  })

  it("ssh-tmux:// (无路径) → undefined", () => {
    expect(parseAttachTarget("ssh-tmux://")).toBeUndefined()
  })

  it("ssh-tmux://profile/ (无 tmuxId) → undefined", () => {
    expect(parseAttachTarget("ssh-tmux://devbox/")).toBeUndefined()
  })

  it("ssh-tmux://profile (无斜杠) → undefined", () => {
    expect(parseAttachTarget("ssh-tmux://devbox")).toBeUndefined()
  })

  it(": (空 profile) → undefined", () => {
    expect(parseAttachTarget(":")).toBeUndefined()
  })

  it("profile: (空 tmuxId) → undefined", () => {
    expect(parseAttachTarget("devbox:")).toBeUndefined()
  })

  it(":session (profile 为空) → undefined", () => {
    expect(parseAttachTarget(":session")).toBeUndefined()
  })

  it("前后空白会被 trim", () => {
    expect(parseAttachTarget("  devbox:my-session  ")).toEqual({
      profile: "devbox",
      tmuxId: "my-session",
    })
    expect(parseAttachTarget("  ssh-tmux://devbox/my-session  ")).toEqual({
      profile: "devbox",
      tmuxId: "my-session",
    })
  })

  it("ssh-tmux://profile/multi/part → 第一个 / 分割 profile 与 tmuxId", () => {
    // profile = "devbox", tmuxId = "session/extra"
    expect(parseAttachTarget("ssh-tmux://devbox/session/extra")).toEqual({
      profile: "devbox",
      tmuxId: "session/extra",
    })
  })

  it("profile:with:colons → 第一个 : 分割", () => {
    expect(parseAttachTarget("devbox:session:extra")).toEqual({
      profile: "devbox",
      tmuxId: "session:extra",
    })
  })
})

// ---------------------------------------------------------------------------
// mergeRemoteEnv
// ---------------------------------------------------------------------------

describe("mergeRemoteEnv", () => {
  it("两者都是 undefined → undefined", () => {
    expect(mergeRemoteEnv(undefined, undefined)).toBeUndefined()
  })

  it("只有 profileEnv → 返回 profileEnv", () => {
    const profileEnv = { PATH: "/usr/bin", HOME: "/home/user" }
    expect(mergeRemoteEnv(profileEnv, undefined)).toEqual(profileEnv)
  })

  it("只有 inputEnv → 返回 inputEnv", () => {
    const inputEnv = { NODE_ENV: "test" }
    expect(mergeRemoteEnv(undefined, inputEnv)).toEqual(inputEnv)
  })

  it("两者都有 → inputEnv 覆盖 profileEnv 的 key", () => {
    const profileEnv = { PATH: "/usr/bin", HOME: "/home/user", FOO: "bar" }
    const inputEnv = { PATH: "/custom/bin", BAZ: "qux" }
    expect(mergeRemoteEnv(profileEnv, inputEnv)).toEqual({
      PATH: "/custom/bin",
      HOME: "/home/user",
      FOO: "bar",
      BAZ: "qux",
    })
  })

  it("空对象 → 返回空对象", () => {
    expect(mergeRemoteEnv({}, {})).toEqual({})
  })

  it("profileEnv 为空对象 + inputEnv 有值 → 返回 inputEnv", () => {
    const inputEnv = { KEY: "value" }
    expect(mergeRemoteEnv({}, inputEnv)).toEqual(inputEnv)
  })
})

// ---------------------------------------------------------------------------
// buildRemoteShellCommand
// ---------------------------------------------------------------------------

describe("buildRemoteShellCommand", () => {
  /** Linux 默认 capabilities */
  const linuxCaps = createRemoteCaps()

  it("Linux: ['node', 'app.js'] → 对每个 token 做 shell-quote 后再整体 shell-quote", () => {
    const result = buildRemoteShellCommand(linuxCaps, "node", ["app.js"])
    // shellQuote("node") = "'node'", shellQuote("app.js") = "'app.js'"
    // commandLine = "'node' 'app.js'"
    // shellQuote(commandLine) 对单引号做转义
    expect(result).toBe("exec '/bin/bash' -l -ic ''\\''node'\\'' '\\''app.js'\\'''")
  })

  it("Linux: 空 args → shell-quote 单个命令", () => {
    const result = buildRemoteShellCommand(linuxCaps, "cmd", [])
    expect(result).toBe("exec '/bin/bash' -l -ic ''\\''cmd'\\'''")
  })

  it("Linux: args 含空格 → 空格被保留在单引号内", () => {
    const result = buildRemoteShellCommand(linuxCaps, "echo", ["hello world"])
    expect(result).toBe("exec '/bin/bash' -l -ic ''\\''echo'\\'' '\\''hello world'\\'''")
  })

  it("Linux: args 含单引号 → shell-quote 正确转义", () => {
    const result = buildRemoteShellCommand(linuxCaps, "echo", ["it's ok"])
    // shellQuote("it's ok") = "'it'\\''s ok'"
    // 整体被 shellQuote 再次包裹
    expect(result).toContain("exec '/bin/bash' -l -ic ")
    expect(result).toContain("it") // 含 it's ok 的转义形式
  })

  it("Windows: shell 含空格 → 引用 shell 路径 + /c + shell-quoted args", () => {
    const winCaps = createRemoteCaps({
      os: "Windows",
      shell: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    })
    const result = buildRemoteShellCommand(winCaps, "node", ["app.js"])
    expect(result).toBe('"C:\\Program Files\\PowerShell\\7\\pwsh.exe" /c \'node\' \'app.js\'')
  })

  it("MINGW → 检测为 Windows，使用 /c 形式", () => {
    const mingwCaps = createRemoteCaps({
      os: "MINGW64",
      shell: "/usr/bin/bash",
    })
    const result = buildRemoteShellCommand(mingwCaps, "node", ["app.js"])
    // MINGW 被检测为 Windows，走 /c 路径
    expect(result).toContain("/c")
    expect(result).not.toContain("exec")
  })

  it("Linux os → 不使用 Windows /c 形式", () => {
    const result = buildRemoteShellCommand(linuxCaps, "node", ["app.js"])
    expect(result).not.toContain("/c")
    expect(result).toContain("exec")
  })

  it("Windows: shell 无空格 → 不加引号", () => {
    const winCaps = createRemoteCaps({
      os: "Windows",
      shell: "pwsh.exe",
    })
    const result = buildRemoteShellCommand(winCaps, "node", ["app.js"])
    expect(result).toBe("pwsh.exe /c 'node' 'app.js'")
  })
})

// ---------------------------------------------------------------------------
// ensureRemoteTmuxUsable
// ---------------------------------------------------------------------------

describe("ensureRemoteTmuxUsable", () => {
  const providerName: ProviderName = "ssh-tmux"
  const target = createResolvedTarget()

  it("tmuxPath: null → 抛出 REMOTE_TMUX_NOT_AVAILABLE 含 'not installed'", () => {
    const caps = createRemoteCaps({ tmuxPath: null, tmuxVersion: null })
    expect(() => ensureRemoteTmuxUsable(providerName, target, caps)).toThrow(/not installed/u)
  })

  it("tmuxVersion: null → 抛出含 'unknown'", () => {
    const caps = createRemoteCaps({ tmuxPath: "/usr/bin/tmux", tmuxVersion: null })
    expect(() => ensureRemoteTmuxUsable(providerName, target, caps)).toThrow(/unknown/u)
  })

  it('tmuxVersion: "tmux 3.1c" → 抛出含 "not supported"', () => {
    const caps = createRemoteCaps({ tmuxVersion: "tmux 3.1c" })
    expect(() => ensureRemoteTmuxUsable(providerName, target, caps)).toThrow(/not supported/u)
  })

  it('tmuxVersion: "tmux 3.2a" → 不抛出', () => {
    const caps = createRemoteCaps({ tmuxVersion: "tmux 3.2a" })
    expect(() => ensureRemoteTmuxUsable(providerName, target, caps)).not.toThrow()
  })

  it('tmuxVersion: "tmux 3.4" → 不抛出', () => {
    const caps = createRemoteCaps({ tmuxVersion: "tmux 3.4" })
    expect(() => ensureRemoteTmuxUsable(providerName, target, caps)).not.toThrow()
  })

  it('tmuxVersion: "tmux 4.0" → 不抛出', () => {
    const caps = createRemoteCaps({ tmuxVersion: "tmux 4.0" })
    expect(() => ensureRemoteTmuxUsable(providerName, target, caps)).not.toThrow()
  })

  it('tmuxVersion: "garbage" → 抛出', () => {
    const caps = createRemoteCaps({ tmuxVersion: "garbage" })
    expect(() => ensureRemoteTmuxUsable(providerName, target, caps)).toThrow()
  })

  it("provider name 出现在错误信息中", () => {
    const caps = createRemoteCaps({ tmuxPath: null, tmuxVersion: null })
    try {
      ensureRemoteTmuxUsable(providerName, target, caps)
    } catch (error) {
      expect(error).toHaveProperty("provider", "ssh-tmux")
    }
  })

  it("tmuxPath 存在但 version 不可解析 → 抛出", () => {
    const caps = createRemoteCaps({ tmuxPath: "/usr/bin/tmux", tmuxVersion: "garbage" })
    expect(() => ensureRemoteTmuxUsable(providerName, target, caps)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// isSupportedTmuxVersion
// ---------------------------------------------------------------------------

describe("isSupportedTmuxVersion", () => {
  it('"tmux 3.2" → true', () => {
    expect(isSupportedTmuxVersion("tmux 3.2")).toBe(true)
  })

  it('"tmux 3.2a" → true', () => {
    expect(isSupportedTmuxVersion("tmux 3.2a")).toBe(true)
  })

  it('"tmux 3.4" → true', () => {
    expect(isSupportedTmuxVersion("tmux 3.4")).toBe(true)
  })

  it('"tmux 4.0" → true', () => {
    expect(isSupportedTmuxVersion("tmux 4.0")).toBe(true)
  })

  it('"tmux 3.1c" → false', () => {
    expect(isSupportedTmuxVersion("tmux 3.1c")).toBe(false)
  })

  it('"tmux 3.0" → false', () => {
    expect(isSupportedTmuxVersion("tmux 3.0")).toBe(false)
  })

  it('"tmux 2.9a" → false', () => {
    expect(isSupportedTmuxVersion("tmux 2.9a")).toBe(false)
  })

  it("空字符串 → false", () => {
    expect(isSupportedTmuxVersion("")).toBe(false)
  })

  it('"garbage" → false', () => {
    expect(isSupportedTmuxVersion("garbage")).toBe(false)
  })

  it('"3.2" (缺少 tmux 前缀) → false', () => {
    expect(isSupportedTmuxVersion("3.2")).toBe(false)
  })

  it('"tmux 5.0" → true (major > 3)', () => {
    expect(isSupportedTmuxVersion("tmux 5.0")).toBe(true)
  })

  it('"tmux 3.2" 恰好是最低支持版本', () => {
    // 3.2 是边界值
    expect(isSupportedTmuxVersion("tmux 3.2")).toBe(true)
    // 3.1 低于边界
    expect(isSupportedTmuxVersion("tmux 3.1")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isRemoteSessionMissing
// ---------------------------------------------------------------------------

describe("isRemoteSessionMissing", () => {
  it('"can\'t find session foo" → true', () => {
    expect(isRemoteSessionMissing("can't find session foo")).toBe(true)
  })

  it('"no server running" → true', () => {
    expect(isRemoteSessionMissing("no server running")).toBe(true)
  })

  it('"no such session: bar" → true', () => {
    expect(isRemoteSessionMissing("no such session: bar")).toBe(true)
  })

  it('"session not found" → true', () => {
    expect(isRemoteSessionMissing("session not found")).toBe(true)
  })

  it('"Can\'t find session" (大写 C) → true', () => {
    expect(isRemoteSessionMissing("Can't find session")).toBe(true)
  })

  it("空字符串 → false", () => {
    expect(isRemoteSessionMissing("")).toBe(false)
  })

  it('"rtumcp_abcd" → false', () => {
    expect(isRemoteSessionMissing("rtumcp_abcd")).toBe(false)
  })

  it("随机 tmux 输出 → false", () => {
    expect(isRemoteSessionMissing("some random output")).toBe(false)
  })

  it("全大写 NO SERVER RUNNING → true (大小写不敏感)", () => {
    expect(isRemoteSessionMissing("NO SERVER RUNNING")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// isWindowsRemote
// ---------------------------------------------------------------------------

describe("isWindowsRemote", () => {
  it('"Windows" → true', () => {
    expect(isWindowsRemote("Windows")).toBe(true)
  })

  it('"Windows_NT" → true', () => {
    expect(isWindowsRemote("Windows_NT")).toBe(true)
  })

  it('"MINGW64" → true', () => {
    expect(isWindowsRemote("MINGW64")).toBe(true)
  })

  it('"MSYS" → true', () => {
    expect(isWindowsRemote("MSYS")).toBe(true)
  })

  it('"CYGWIN" → true', () => {
    expect(isWindowsRemote("CYGWIN")).toBe(true)
  })

  it('"Linux" → false', () => {
    expect(isWindowsRemote("Linux")).toBe(false)
  })

  it('"Darwin" → false', () => {
    expect(isWindowsRemote("Darwin")).toBe(false)
  })

  it('"MINGW" (无数字后缀) → true', () => {
    expect(isWindowsRemote("MINGW")).toBe(true)
  })

  it('"windows" (小写) → true (大小写不敏感)', () => {
    expect(isWindowsRemote("windows")).toBe(true)
  })

  it('"cygwin" (小写) → true', () => {
    expect(isWindowsRemote("cygwin")).toBe(true)
  })

  it('"FreeBSD" → false', () => {
    expect(isWindowsRemote("FreeBSD")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// quoteWindowsShell
// ---------------------------------------------------------------------------

describe("quoteWindowsShell", () => {
  it("无空格 → 原样返回", () => {
    expect(quoteWindowsShell("pwsh.exe")).toBe("pwsh.exe")
    expect(quoteWindowsShell("/bin/bash")).toBe("/bin/bash")
  })

  it("路径含空格 → 加双引号", () => {
    expect(quoteWindowsShell("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toBe(
      '"C:\\Program Files\\PowerShell\\7\\pwsh.exe"',
    )
  })

  it("只有空格的路径 → 加双引号", () => {
    expect(quoteWindowsShell("/path with spaces/shell")).toBe('"/path with spaces/shell"')
  })

  it("空字符串 → 原样返回（无空格）", () => {
    expect(quoteWindowsShell("")).toBe("")
  })
})

// ---------------------------------------------------------------------------
// parseTmuxListSessionsOutput (含 parseTmuxListEntry 边界用例)
// ---------------------------------------------------------------------------

describe("parseTmuxListSessionsOutput", () => {
  it("标准输出 → 结构化列表", () => {
    const output = "rtumcp_abcd1234\t1710000000\t120\t40\n"
    const entries = parseTmuxListSessionsOutput(output)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual({
      name: "rtumcp_abcd1234",
      createdAt: "2024-03-09T16:00:00.000Z",
      cols: 120,
      rows: 40,
    })
  })

  it("多行输出 → 多个条目", () => {
    const output = "session1\t1710000000\t80\t24\nsession2\t1710001000\t120\t30\n"
    const entries = parseTmuxListSessionsOutput(output)
    expect(entries).toHaveLength(2)
    expect(entries[0]?.name).toBe("session1")
    expect(entries[1]?.name).toBe("session2")
  })

  it("缺失字段 → 默认值 (cols=80, rows=24)", () => {
    // 只有 name 和 created，缺 cols 和 rows
    const output = "my-session\t1710000000\n"
    const entries = parseTmuxListSessionsOutput(output)
    expect(entries[0]?.name).toBe("my-session")
    expect(entries[0]?.cols).toBe(80)
    expect(entries[0]?.rows).toBe(24)
  })

  it("空行 → name 为空字符串（被 trim 后过滤）", () => {
    const output = "\n\n"
    const entries = parseTmuxListSessionsOutput(output)
    // 空行 trim 后长度为 0，被 filter 过滤
    expect(entries).toHaveLength(0)
  })

  it("非数字 cols → 默认 80", () => {
    const output = "session\t1710000000\txyz\t24\n"
    const entries = parseTmuxListSessionsOutput(output)
    expect(entries[0]?.cols).toBe(80)
  })

  it("非数字 rows → 默认 24", () => {
    const output = "session\t1710000000\t120\tabc\n"
    const entries = parseTmuxListSessionsOutput(output)
    expect(entries[0]?.rows).toBe(24)
  })

  it("非数字 created → fallback 到当前日期", () => {
    const output = "session\tbad_timestamp\t120\t40\n"
    const entries = parseTmuxListSessionsOutput(output)
    expect(entries[0]?.name).toBe("session")
    // createdAt 应该是有效 ISO 日期字符串（fallback 到 new Date().toISOString()）
    expect(entries[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u)
  })

  it("空字符串 → 空数组", () => {
    expect(parseTmuxListSessionsOutput("")).toHaveLength(0)
  })

  it("混合正常与异常行", () => {
    const output = "good\t1710000000\t120\t40\n\t\nbad_ts\tnope\t80\t24\n"
    const entries = parseTmuxListSessionsOutput(output)
    // 第一行正常，第二行空行被过滤，第三行 name="bad_ts" created=fallback cols=80 rows=24
    expect(entries.length).toBeGreaterThanOrEqual(2)
    expect(entries[0]?.name).toBe("good")
  })
})
