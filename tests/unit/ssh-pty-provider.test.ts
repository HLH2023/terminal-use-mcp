import { afterEach, describe, expect, it } from "vitest"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"

import { createLogger } from "../../src/logger.js"
import {
  buildRemoteExecCommand,
  buildShellExecCommand,
  quoteWindowsPath,
  resolveSshPtyAuthConnectConfig,
  resolveSshPtyTarget,
  SshPtyDirtyTracker,
  SshPtyProvider,
  verifyPresentedHostKey,
} from "../../src/providers/ssh-pty-provider.js"
import { shellQuote } from "../../src/terminal/shell-quote.js"
import type { ResolvedSshTarget } from "../../src/targets/ssh-profile-loader.js"
import type { SshHostProfile } from "../../src/targets/target-types.js"
import { computeHostFingerprint } from "../../src/targets/host-fingerprint.js"
import {
  ProviderCapabilityUnsupportedError,
  SessionNotFoundError,
  SshHostKeyMismatchError,
  SshHostKeyUnknownError,
} from "../../src/terminal/errors.js"

const tempRoots: string[] = []
const originalSshAuthSock = process.env.SSH_AUTH_SOCK
const originalPassphrase = process.env.TUMCP_TEST_SSH_PASSPHRASE

afterEach(async () => {
  restoreEnv("SSH_AUTH_SOCK", originalSshAuthSock)
  restoreEnv("TUMCP_TEST_SSH_PASSPHRASE", originalPassphrase)
  await Promise.all(tempRoots.splice(0).map(async (root) => fs.rm(root, { recursive: true, force: true })))
})

describe("SshPtyProvider capability and availability", () => {
  it("isAvailable() 固定返回 true", async () => {
    const provider = new SshPtyProvider(createLogger("error"))

    await expect(provider.isAvailable()).resolves.toBe(true)
  })

  it("capabilities 声明 ssh-pty 支持的能力矩阵", () => {
    const provider = new SshPtyProvider(createLogger("error"))

    expect(provider.capabilities).toEqual({
      provider: "ssh-pty",
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
})

describe("resolveSshPtyTarget", () => {
  it("local target 对 ssh-pty 失败关闭", () => {
    expect(() => resolveSshPtyTarget({ kind: "local" }, new Map()))
      .toThrow(ProviderCapabilityUnsupportedError)
  })

  it("SSH profile target 解析为完整 ResolvedSshTarget", () => {
    const profile = createProfile()
    const resolved = resolveSshPtyTarget({ kind: "ssh", profile: "devbox" }, new Map([[profile.name, profile]]))

    expect(resolved.kind).toBe("ssh")
    expect(resolved.profile).toBe("devbox")
    expect(resolved.host).toBe("example.test")
    expect(resolved.port).toBe(22)
    expect(resolved.username).toBe("tester")
    expect(resolved.knownHostPolicy).toBe("strict")
  })
})

describe("verifyPresentedHostKey pinned fingerprint", () => {
  it("pinned fingerprint 匹配时返回实际指纹", async () => {
    const offeredKey = Buffer.from("host-key-a")
    const fingerprint = computeHostFingerprint(offeredKey.toString("base64"), "sha256")
    const target = createResolvedTarget({ pinnedHostFingerprint: fingerprint })

    await expect(verifyPresentedHostKey(target, offeredKey)).resolves.toBe(fingerprint)
  })

  it("pinned fingerprint 不匹配时抛 SSH_HOST_KEY_MISMATCH", async () => {
    const offeredKey = Buffer.from("host-key-a")
    const otherKey = Buffer.from("host-key-b")
    const pinned = computeHostFingerprint(otherKey.toString("base64"), "sha256")
    const target = createResolvedTarget({ pinnedHostFingerprint: pinned })

    await expect(verifyPresentedHostKey(target, offeredKey)).rejects.toThrow(SshHostKeyMismatchError)
  })
})

describe("verifyPresentedHostKey known_hosts", () => {
  it("known_hosts host 与 key 均匹配时返回指纹", async () => {
    const offeredKey = Buffer.from("known-host-key-a")
    const knownHostsPath = await writeTempFile("known_hosts", `example.test ssh-ed25519 ${offeredKey.toString("base64")}\n`)
    const expected = computeHostFingerprint(offeredKey.toString("base64"), "sha256")
    const target = createResolvedTarget({ knownHosts: knownHostsPath })

    await expect(verifyPresentedHostKey(target, offeredKey)).resolves.toBe(expected)
  })

  it("known_hosts host 不存在时抛 SSH_HOST_KEY_UNKNOWN", async () => {
    const offeredKey = Buffer.from("known-host-key-a")
    const knownHostsPath = await writeTempFile("known_hosts", `other.test ssh-ed25519 ${offeredKey.toString("base64")}\n`)
    const target = createResolvedTarget({ knownHosts: knownHostsPath })

    await expect(verifyPresentedHostKey(target, offeredKey)).rejects.toThrow(SshHostKeyUnknownError)
  })

  it("known_hosts host 存在但 key 不匹配时抛 SSH_HOST_KEY_MISMATCH", async () => {
    const offeredKey = Buffer.from("known-host-key-a")
    const knownKey = Buffer.from("known-host-key-b")
    const knownHostsPath = await writeTempFile("known_hosts", `example.test ssh-ed25519 ${knownKey.toString("base64")}\n`)
    const target = createResolvedTarget({ knownHosts: knownHostsPath })

    await expect(verifyPresentedHostKey(target, offeredKey)).rejects.toThrow(SshHostKeyMismatchError)
  })

  it("无 known_hosts 与 pinned fingerprint 时拒绝连接", async () => {
    const offeredKey = Buffer.from("known-host-key-a")
    const target = createResolvedTarget()

    await expect(verifyPresentedHostKey(target, offeredKey)).rejects.toThrow(SshHostKeyUnknownError)
  })
})

describe("resolveSshPtyAuthConnectConfig", () => {
  it("agent auth 返回 ssh2 agent socket 字段", async () => {
    const socketPath = await writeTempFile("agent.sock", "")

    const result = await resolveSshPtyAuthConnectConfig({ type: "agent", socket: socketPath })

    expect(result.authType).toBe("agent")
    if (result.authType === "agent") {
      expect(result.connectConfig.agent).toBe(socketPath)
    }
  })

  it("key-file auth 使用 fs.promises.readFile 读入 Buffer 并引用 passphraseEnv", async () => {
    const keyContent = "fake-private-key-placeholder"
    const keyPath = await writeTempFile("id_ed25519", keyContent)
    process.env.TUMCP_TEST_SSH_PASSPHRASE = "secret-passphrase-for-test"

    const result = await resolveSshPtyAuthConnectConfig({ type: "key-file", path: keyPath, passphraseEnv: "TUMCP_TEST_SSH_PASSPHRASE" })

    expect(result.authType).toBe("key-file")
    if (result.authType === "key-file") {
      expect(Buffer.isBuffer(result.connectConfig.privateKey)).toBe(true)
      expect((result.connectConfig.privateKey as Buffer).toString("utf8")).toBe(keyContent)
      expect(result.connectConfig.passphrase).toBe("secret-passphrase-for-test")
    }
  })
})

describe("SshPtyDirtyTracker", () => {
  it("markDirty / markClean 维护 dirty 与 lastDataAt", () => {
    const tracker = new SshPtyDirtyTracker()
    const now = new Date("2026-06-13T00:00:00.000Z")

    expect(tracker.isDirty()).toBe(false)
    tracker.markDirty(now)
    expect(tracker.isDirty()).toBe(true)
    expect(tracker.getLastDataAtMs()).toBe(now.getTime())
    expect(tracker.getLastDataAtIso()).toBe(now.toISOString())
    tracker.markClean()
    expect(tracker.isDirty()).toBe(false)
  })
})

describe("buildRemoteExecCommand", () => {
  it("通过探测到的远端 shell 执行原始命令", () => {
    const innerCommand = `cd ${shellQuote("/home/tester/project")} && ${buildShellExecCommand("node", ["app.js"])}`

    expect(buildRemoteExecCommand("node", ["app.js"], "/home/tester/project", { os: "Linux", shell: "/bin/bash" }))
      .toBe(`exec ${shellQuote("/bin/bash")} -l -ic ${shellQuote(innerCommand)}`)
  })

  it("嵌套单引号参数保持不可逃逸的 shell token", () => {
    const command = buildRemoteExecCommand("node", ["it's ok"], "/tmp/a'b", { os: "Linux", shell: "/bin/zsh" })

    expect(command).toContain(`exec ${shellQuote("/bin/zsh")} -l -ic`)
    expect(command).toContain("\\''")
    expect(command).not.toContain("; node")
  })

  it("Windows target 不使用 Unix login interactive flags", () => {
    const command = buildRemoteExecCommand("node", ["app.js"], "C:\\Users\\dev", { os: "Windows", shell: "cmd.exe" })

    expect(command).toContain("cmd.exe /c")
    expect(command).not.toContain("-l -ic")
    expect(command).toContain("node")
    expect(command).toContain("app.js")
  })

  it("Windows shell 路径含空格时会引用 executable", () => {
    const shell = "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
    const command = buildRemoteExecCommand("node", ["app.js"], "C:\\Users\\dev", { os: "Windows", shell })

    expect(quoteWindowsPath(shell)).toBe(`"${shell}"`)
    expect(command).toContain(`"${shell}" -NoProfile -Command`)
  })

  it("quotes Windows shell path containing spaces and includes /c for cmd.exe", () => {
    const shell = "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
    const cmd = buildRemoteExecCommand("node", ["app.js"], "C:\\Users\\dev", { os: "Windows", shell })

    expect(cmd).toContain('"C:\\Program Files\\PowerShell\\7\\pwsh.exe"')
    expect(cmd).toContain("node")
  })
})

describe("SshPtyProvider error path", () => {
  it("kill non-existent session 抛 SESSION_NOT_FOUND", async () => {
    const provider = new SshPtyProvider(createLogger("error"))

    await expect(provider.kill("missing-session")).rejects.toThrow(SessionNotFoundError)
  })
})

function createProfile(overrides: Partial<SshHostProfile> = {}): SshHostProfile {
  return {
    name: "devbox",
    host: "example.test",
    port: 22,
    username: "tester",
    auth: { type: "agent", socket: "/tmp/fake-agent.sock" },
    remoteAllowedCwd: ["/home/tester"],
    remoteDeniedCwd: ["/root"],
    defaultCwd: "/home/tester",
    ...overrides,
  }
}

function createResolvedTarget(overrides: Partial<SshHostProfile> = {}): ResolvedSshTarget {
  const profile = createProfile(overrides)
  return {
    ...profile,
    kind: "ssh",
    profile: profile.name,
    knownHostPolicy: "strict",
  }
}

async function writeTempFile(fileName: string, content: string): Promise<string> {
  const root = await makeTempRoot()
  const filePath = path.join(root, fileName)
  await fs.writeFile(filePath, content, "utf8")
  return filePath
}

async function makeTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tumcp-ssh-pty-"))
  tempRoots.push(root)
  return root
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}
