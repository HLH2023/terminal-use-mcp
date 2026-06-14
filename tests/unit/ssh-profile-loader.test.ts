import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"
import { SshInlineTargetDeniedError, SshProfileNotFoundError } from "../../src/terminal/errors.js"
import type { SshHostProfile, TerminalTarget } from "../../src/targets/target-types.js"
import { clearHostsConfigCache, loadHostsConfig } from "../../src/targets/ssh-host-config.js"
import { resolveSshTarget } from "../../src/targets/ssh-profile-loader.js"

const tempDirs: string[] = []

afterEach(async () => {
  delete process.env.TERMINAL_USE_HOSTS_CONFIG
  delete process.env.TERMINAL_USE_ALLOW_INLINE_SSH_TARGETS
  delete process.env.SSH_PROXY_JUMP
  clearHostsConfigCache()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function writeHostsJson(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tumcp-hosts-"))
  tempDirs.push(dir)
  const filePath = join(dir, "hosts.json")
  await writeFile(filePath, content, "utf8")
  return filePath
}

function createProfile(overrides: Partial<SshHostProfile> = {}): SshHostProfile {
  return {
    name: "devbox",
    host: "192.168.1.20",
    port: 22,
    username: "hlh",
    auth: { type: "agent" },
    knownHosts: "/tmp/known_hosts",
    defaultCwd: "/home/hlh/dev",
    remoteAllowedCwd: ["/home/hlh/dev"],
    remoteDeniedCwd: ["/root", "/etc"],
    allowTmux: true,
    ...overrides,
  }
}

describe("loadHostsConfig", () => {
  it("加载空 hosts config 返回空 map", async () => {
    const filePath = await writeHostsJson(JSON.stringify({ hosts: {} }))
    const profiles = await loadHostsConfig(filePath)
    expect(profiles.size).toBe(0)
  })

  it("加载有效 hosts.json 返回正确 profile map", async () => {
    const filePath = await writeHostsJson(JSON.stringify({
      hosts: {
        devbox: {
          host: "192.168.1.20",
          port: 22,
          username: "hlh",
          auth: { type: "agent" },
          knownHosts: "~/.ssh/known_hosts",
          defaultCwd: "/home/hlh/dev",
          remoteAllowedCwd: ["/home/hlh/dev", "/srv/lab"],
          remoteDeniedCwd: ["/root", "/etc"],
          allowTmux: true,
          connectTimeoutMs: 10000,
          keepaliveIntervalMs: 15000,
        },
      },
    }))

    const profiles = await loadHostsConfig(filePath)
    const devbox = profiles.get("devbox")
    expect(devbox).toBeDefined()
    expect(devbox?.name).toBe("devbox")
    expect(devbox?.host).toBe("192.168.1.20")
    expect(devbox?.auth.type).toBe("agent")
    expect(devbox?.remoteAllowedCwd).toEqual(["/home/hlh/dev", "/srv/lab"])
    expect(devbox?.allowTmux).toBe(true)
    expect(devbox?.knownHosts).toContain("/.ssh/known_hosts")
  })

  it("ProxyJump 作为 profile 字段加载且不会进入远端 env", async () => {
    const filePath = await writeHostsJson(JSON.stringify({
      hosts: {
        devbox: {
          host: "192.168.1.20",
          port: 22,
          username: "hlh",
          auth: { type: "agent" },
          knownHosts: "~/.ssh/known_hosts",
          remoteAllowedCwd: ["/home/hlh/dev"],
          proxyJump: "bastion",
          env: { SSH_PROXY_JUMP: "must-not-forward", FOO: "bar" },
        },
      },
    }))

    const profiles = await loadHostsConfig(filePath)
    const devbox = profiles.get("devbox")
    expect(devbox?.proxyJump).toBe("bastion")
    expect(devbox?.env).toEqual({ FOO: "bar" })
  })

  it("SSH_PROXY_JUMP 环境变量作为 profile 默认 ProxyJump", async () => {
    process.env.SSH_PROXY_JUMP = "env-bastion"
    const filePath = await writeHostsJson(JSON.stringify({
      hosts: {
        devbox: {
          host: "192.168.1.20",
          port: 22,
          username: "hlh",
          auth: { type: "agent" },
          knownHosts: "~/.ssh/known_hosts",
          remoteAllowedCwd: ["/home/hlh/dev"],
        },
      },
    }))

    const profiles = await loadHostsConfig(filePath)
    expect(profiles.get("devbox")?.proxyJump).toBe("env-bastion")
  })

  it("加载缺失文件返回空 map 且不抛错", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tumcp-missing-hosts-"))
    tempDirs.push(dir)
    const profiles = await loadHostsConfig(join(dir, "missing-hosts.json"))
    expect(profiles.size).toBe(0)
  })

  it("加载非法 JSON 抛出描述性错误", async () => {
    const filePath = await writeHostsJson("{ invalid json")
    await expect(loadHostsConfig(filePath)).rejects.toThrow(/Invalid hosts config JSON/)
  })
})

describe("resolveSshTarget", () => {
  it("解析 local target 返回 local", () => {
    expect(resolveSshTarget({ kind: "local" }, new Map())).toEqual({ kind: "local" })
  })

  it("通过 profile 名解析 SSH target", () => {
    const profiles = new Map([["devbox", createProfile()]])
    const resolved = resolveSshTarget({ kind: "ssh", profile: "devbox" }, profiles)
    expect(resolved.kind).toBe("ssh")
    if (resolved.kind === "ssh") {
      expect(resolved.profile).toBe("devbox")
      expect(resolved.host).toBe("192.168.1.20")
      expect(resolved.username).toBe("hlh")
      expect(resolved.knownHostPolicy).toBe("strict")
    }
  })

  it("profile + inline overrides 会覆盖 host port username auth", () => {
    const profiles = new Map([["devbox", createProfile()]])
    const resolved = resolveSshTarget({
      kind: "ssh",
      profile: "devbox",
      host: "10.0.0.5",
      port: 2222,
      username: "ops",
      auth: { type: "key-file", path: "/keys/id_ed25519", passphraseEnv: "SSH_KEY_PASSPHRASE" },
    }, profiles)

    expect(resolved.kind).toBe("ssh")
    if (resolved.kind === "ssh") {
      expect(resolved.host).toBe("10.0.0.5")
      expect(resolved.port).toBe(2222)
      expect(resolved.username).toBe("ops")
      expect(resolved.auth).toEqual({ type: "key-file", path: "/keys/id_ed25519", passphraseEnv: "SSH_KEY_PASSPHRASE" })
      expect(resolved.remoteAllowedCwd).toEqual(["/home/hlh/dev"])
    }
  })

  it("无 profile 的 inline SSH target 默认被拒绝", () => {
    const inlineTarget: TerminalTarget = { kind: "ssh", host: "127.0.0.1", port: 22, username: "me", auth: { type: "agent" } }
    expect(() => resolveSshTarget(inlineTarget, new Map())).toThrow(SshInlineTargetDeniedError)
  })

  it("启用环境变量后允许 inline SSH target", () => {
    process.env.TERMINAL_USE_ALLOW_INLINE_SSH_TARGETS = "1"
    const inlineTarget: TerminalTarget = { kind: "ssh", host: "127.0.0.1", port: 22, username: "me", auth: { type: "agent" } }
    const resolved = resolveSshTarget(inlineTarget, new Map())
    expect(resolved.kind).toBe("ssh")
    if (resolved.kind === "ssh") {
      expect(resolved.host).toBe("127.0.0.1")
      expect(resolved.port).toBe(22)
      expect(resolved.username).toBe("me")
      expect(resolved.remoteAllowedCwd).toEqual([])
    }
  })

  it("不存在的 profile 抛 SSH_PROFILE_NOT_FOUND", () => {
    expect(() => resolveSshTarget({ kind: "ssh", profile: "missing" }, new Map())).toThrow(SshProfileNotFoundError)
  })
})
