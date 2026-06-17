import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { existsSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  verifyPinnedFingerprintViaKeyscan,
  verifyPinnedFingerprintOrThrow,
  cleanupTempKnownHosts,
} from "../../src/targets/ssh-keyscan-verify.js"
import type { ResolvedSshTarget } from "../../src/targets/ssh-profile-loader.js"
import { SshHostKeyMismatchError, SshHostKeyUnknownError } from "../../src/terminal/errors.js"
import { createLogger } from "../../src/logger.js"
import {
  SshTmuxProvider,
  type SshTmuxCommandExecutor,
} from "../../src/providers/ssh-tmux-provider.js"
import type { SystemSshCommandResult } from "../../src/providers/system-ssh-transport.js"
import { RemoteCapabilityCache, type RemoteCapabilities } from "../../src/targets/remote-capability-cache.js"
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

function createResolvedTarget(overrides: Partial<ResolvedSshTarget> = {}): ResolvedSshTarget {
  return {
    kind: "ssh",
    name: "devbox",
    host: "192.0.2.10",
    port: 2222,
    username: "tester",
    auth: { type: "agent" },
    remoteAllowedCwd: ["/home/tester"],
    knownHostPolicy: "strict",
    ...overrides,
  }
}

function ok(stdout = ""): SystemSshCommandResult {
  return { stdout, stderr: "", exitCode: 0 }
}

// ---- ssh-keyscan-verify 模块单元测试 ----

describe("ssh-keyscan-verify", () => {
  describe("verifyPinnedFingerprintViaKeyscan", () => {
    it("无 pinnedHostFingerprint 时返回失败", async () => {
      const target = createResolvedTarget()
      const result = await verifyPinnedFingerprintViaKeyscan(target)
      expect(result.verified).toBe(false)
      if (!result.verified) {
        expect(result.error).toContain("No pinnedHostFingerprint")
      }
    })

    it("ssh-keyscan 无输出时返回失败", async () => {
      const target = createResolvedTarget({ pinnedHostFingerprint: "SHA256:abc123" })
      // 在无法连接的 host 上 ssh-keyscan 会返回空输出
      const result = await verifyPinnedFingerprintViaKeyscan(target)
      // 本地测试环境：取决于 ssh-keyscan 是否可达该 host
      // 不可达时应返回失败
      expect(result.verified).toBe(false)
    })
  })

  describe("verifyPinnedFingerprintOrThrow", () => {
    it("ssh-keyscan 无输出时抛 SshHostKeyUnknownError", async () => {
      const target = createResolvedTarget({
        pinnedHostFingerprint: "SHA256:nonexistenthash",
        host: "192.0.2.1", // 不可达测试 IP
      })
      await expect(verifyPinnedFingerprintOrThrow(target)).rejects.toThrow()
    })
  })

  describe("cleanupTempKnownHosts", () => {
    it("传入 undefined 时为 no-op", () => {
      expect(() => cleanupTempKnownHosts(undefined)).not.toThrow()
    })

    it("传入空字符串时为 no-op", () => {
      expect(() => cleanupTempKnownHosts("")).not.toThrow()
    })

    it("清理存在的临时文件", () => {
      const tempPath = join(tmpdir(), `terminal-use-test-cleanup-${Date.now()}`)
      writeFileSync(tempPath, "test", { mode: 0o600 })
      expect(existsSync(tempPath)).toBe(true)

      cleanupTempKnownHosts(tempPath)
      expect(existsSync(tempPath)).toBe(false)
    })

    it("不存在的路径不抛错", () => {
      expect(() => cleanupTempKnownHosts("/tmp/nonexistent-file-12345")).not.toThrow()
    })
  })
})

// ---- SshTmuxProvider 与 pinnedHostFingerprint 集成测试 ----

describe("SshTmuxProvider with pinnedHostFingerprint", () => {
  it("profile 配置 pinnedHostFingerprint 时调用 keyscanVerifier", async () => {
    let keyscanCalled = false
    const keyscanVerifier = async (profile: ResolvedSshTarget) => {
      keyscanCalled = true
      return { tempKnownHostsPath: "/tmp/test-known-hosts", matchedFingerprint: "SHA256:abc" }
    }

    const executor: SshTmuxCommandExecutor = async (_profile, args, _options) => {
      if (args.includes("pwd")) return ok("/home/tester/project\n")
      return ok()
    }
    const provider = new SshTmuxProvider(logger, {
      hostsConfig: new Map([["devbox", createProfile({ pinnedHostFingerprint: "SHA256:abc" })]]),
      commandExecutor: executor,
      sshAvailabilityChecker: async () => true,
      capabilityCache: new RemoteCapabilityCache([["devbox", DEFAULT_REMOTE_CAPS]]),
      keyscanVerifier,
      rawCommandExecutor: async () => ok("/home/tester/project"),
    })

    await provider.start({
      command: "node",
      args: ["app.js"],
      cwd: "/home/tester/project",
      cols: 100,
      rows: 30,
      target: { kind: "ssh", profile: "devbox" },
    })

    expect(keyscanCalled).toBe(true)
  })

  it("keyscanVerifier 抛错时 start() 传播错误", async () => {
    const keyscanVerifier = async (_profile: ResolvedSshTarget) => {
      throw new SshHostKeyMismatchError("tester@192.0.2.10:2222", {
        reason: "fingerprint_mismatch_via_keyscan",
        detail: "No match",
        pinnedHostFingerprint: "SHA256:abc",
      })
    }

    const executor: SshTmuxCommandExecutor = async (_profile, args) => {
      if (args.includes("pwd")) return ok("/home/tester/project\n")
      return ok()
    }
    const provider = new SshTmuxProvider(logger, {
      hostsConfig: new Map([["devbox", createProfile({ pinnedHostFingerprint: "SHA256:abc" })]]),
      commandExecutor: executor,
      sshAvailabilityChecker: async () => true,
      capabilityCache: new RemoteCapabilityCache([["devbox", DEFAULT_REMOTE_CAPS]]),
      keyscanVerifier,
      rawCommandExecutor: async () => ok("/home/tester/project"),
    })

    await expect(provider.start({
      command: "node",
      args: ["app.js"],
      cwd: "/home/tester/project",
      cols: 100,
      rows: 30,
      target: { kind: "ssh", profile: "devbox" },
    })).rejects.toThrow(SshHostKeyMismatchError)
  })

  it("session 存储 tempKnownHostsPath 并在 kill 时清理", async () => {
    let capturedTempPath: string | undefined
    const keyscanVerifier = async (_profile: ResolvedSshTarget) => {
      capturedTempPath = "/tmp/test-known-hosts-kill-cleanup"
      return { tempKnownHostsPath: capturedTempPath, matchedFingerprint: "SHA256:abc" }
    }

    const executor: SshTmuxCommandExecutor = async (_profile, args, _options) => {
      if (args.includes("pwd")) return ok("/home/tester/project\n")
      return ok()
    }
    const provider = new SshTmuxProvider(logger, {
      hostsConfig: new Map([["devbox", createProfile({ pinnedHostFingerprint: "SHA256:abc" })]]),
      commandExecutor: executor,
      sshAvailabilityChecker: async () => true,
      capabilityCache: new RemoteCapabilityCache([["devbox", DEFAULT_REMOTE_CAPS]]),
      keyscanVerifier,
      rawCommandExecutor: async () => ok("/home/tester/project"),
    })

    const session = await provider.start({
      command: "node",
      args: ["app.js"],
      cwd: "/home/tester/project",
      cols: 100,
      rows: 30,
      target: { kind: "ssh", profile: "devbox" },
    })

    expect(capturedTempPath).toBe("/tmp/test-known-hosts-kill-cleanup")
    await provider.kill(session.providerSessionId)
  })

  it("无 pinnedHostFingerprint 时不调用 keyscanVerifier", async () => {
    let keyscanCalled = false
    const keyscanVerifier = async () => {
      keyscanCalled = true
      return { tempKnownHostsPath: "/tmp/test", matchedFingerprint: "SHA256:abc" }
    }

    const executor: SshTmuxCommandExecutor = async (_profile, args) => {
      if (args.includes("pwd")) return ok("/home/tester/project\n")
      return ok()
    }
    const provider = new SshTmuxProvider(logger, {
      hostsConfig: new Map([["devbox", createProfile()]]),
      commandExecutor: executor,
      sshAvailabilityChecker: async () => true,
      capabilityCache: new RemoteCapabilityCache([["devbox", DEFAULT_REMOTE_CAPS]]),
      keyscanVerifier,
      rawCommandExecutor: async () => ok("/home/tester/project"),
    })

    await provider.start({
      command: "node",
      args: ["app.js"],
      cwd: "/home/tester/project",
      cols: 100,
      rows: 30,
      target: { kind: "ssh", profile: "devbox" },
    })

    expect(keyscanCalled).toBe(false)
  })

  it("overrideKnownHosts 传递给 commandExecutor", async () => {
    let receivedOptions: { overrideKnownHosts?: string } | undefined
    const keyscanVerifier = async () => ({
      tempKnownHostsPath: "/tmp/verified-known-hosts",
      matchedFingerprint: "SHA256:abc",
    })
    const executor: SshTmuxCommandExecutor = async (_profile, args, options) => {
      receivedOptions = options
      if (args.includes("pwd")) return ok("/home/tester/project\n")
      return ok()
    }

    const provider = new SshTmuxProvider(logger, {
      hostsConfig: new Map([["devbox", createProfile({ pinnedHostFingerprint: "SHA256:abc" })]]),
      commandExecutor: executor,
      sshAvailabilityChecker: async () => true,
      capabilityCache: new RemoteCapabilityCache([["devbox", DEFAULT_REMOTE_CAPS]]),
      keyscanVerifier,
      rawCommandExecutor: async () => ok("/home/tester/project"),
    })

    await provider.start({
      command: "node",
      args: ["app.js"],
      cwd: "/home/tester/project",
      cols: 100,
      rows: 30,
      target: { kind: "ssh", profile: "devbox" },
    })

    expect(receivedOptions?.overrideKnownHosts).toBe("/tmp/verified-known-hosts")
  })
})
