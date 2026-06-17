import { describe, it, expect } from "vitest"
import { mergeSshDefaultsIntoProfile, mergeSshDefaultsIntoAllProfiles } from "../../src/targets/ssh-defaults-merge.js"
import type { SshHostProfile } from "../../src/targets/target-types.js"
import type { SshDefaultsConfig } from "../../src/config.js"

/** 构造最小合法 SshHostProfile */
function createProfile(overrides: Partial<SshHostProfile> = {}): SshHostProfile {
  return {
    name: "test-host",
    host: "example.com",
    port: 22,
    username: "user",
    auth: { type: "agent" },
    remoteAllowedCwd: ["/home/user"],
    ...overrides,
  }
}

/** 构造 SshDefaultsConfig */
function createDefaults(overrides: Partial<SshDefaultsConfig> = {}): SshDefaultsConfig {
  return {
    remoteDeniedCwd: [],
    allowTmux: false,
    connectTimeoutMs: 30000,
    keepaliveIntervalMs: 60000,
    ...overrides,
  }
}

describe("mergeSshDefaultsIntoProfile", () => {
  it("空 sshDefaults 不修改 profile", () => {
    const profile = createProfile()
    const defaults = createDefaults()
    const result = mergeSshDefaultsIntoProfile(profile, defaults)
    // profile 中 remoteDeniedCwd/allowTmux/connectTimeoutMs/keepaliveIntervalMs 均为 undefined
    // 合并后会使用 defaults 的值
    expect(result.remoteDeniedCwd).toEqual([])
    expect(result.allowTmux).toBe(false)
    expect(result.connectTimeoutMs).toBe(30000)
    expect(result.keepaliveIntervalMs).toBe(60000)
  })

  it("sshDefaults 填充 profile 中缺失的字段", () => {
    const profile = createProfile()
    const defaults = createDefaults({
      remoteDeniedCwd: ["/etc", "/root"],
      allowTmux: true,
      connectTimeoutMs: 10000,
      keepaliveIntervalMs: 30000,
    })
    const result = mergeSshDefaultsIntoProfile(profile, defaults)
    expect(result.remoteDeniedCwd).toEqual(["/etc", "/root"])
    expect(result.allowTmux).toBe(true)
    expect(result.connectTimeoutMs).toBe(10000)
    expect(result.keepaliveIntervalMs).toBe(30000)
  })

  it("profile 字段优先于 sshDefaults", () => {
    const profile = createProfile({
      remoteDeniedCwd: ["/tmp"],
      allowTmux: false,
      connectTimeoutMs: 5000,
      keepaliveIntervalMs: 15000,
    })
    const defaults = createDefaults({
      remoteDeniedCwd: ["/etc", "/root"],
      allowTmux: true,
      connectTimeoutMs: 10000,
      keepaliveIntervalMs: 30000,
    })
    const result = mergeSshDefaultsIntoProfile(profile, defaults)
    // profile 字段已定义，不应被 defaults 覆盖
    expect(result.remoteDeniedCwd).toEqual(["/tmp"])
    expect(result.allowTmux).toBe(false)
    expect(result.connectTimeoutMs).toBe(5000)
    expect(result.keepaliveIntervalMs).toBe(15000)
  })

  it("不修改原始 profile 对象", () => {
    const profile = createProfile()
    const originalRemoteDeniedCwd = profile.remoteDeniedCwd
    const defaults = createDefaults({ allowTmux: true })
    mergeSshDefaultsIntoProfile(profile, defaults)
    // 原始 profile 不应被修改
    expect(profile.remoteDeniedCwd).toBe(originalRemoteDeniedCwd)
  })

  it("部分字段有值时只合并缺失字段", () => {
    const profile = createProfile({
      allowTmux: true,
      // remoteDeniedCwd, connectTimeoutMs, keepaliveIntervalMs 未设置
    })
    const defaults = createDefaults({
      remoteDeniedCwd: ["/opt"],
      allowTmux: false,
      connectTimeoutMs: 20000,
      keepaliveIntervalMs: 45000,
    })
    const result = mergeSshDefaultsIntoProfile(profile, defaults)
    // allowTmux 在 profile 中已定义 → 保留 profile 值
    expect(result.allowTmux).toBe(true)
    // 其他字段使用 defaults
    expect(result.remoteDeniedCwd).toEqual(["/opt"])
    expect(result.connectTimeoutMs).toBe(20000)
    expect(result.keepaliveIntervalMs).toBe(45000)
  })
})

describe("mergeSshDefaultsIntoAllProfiles", () => {
  it("批量合并所有 profiles", () => {
    const profileA = createProfile({ name: "host-a" })
    const profileB = createProfile({ name: "host-b", allowTmux: true })
    const profiles = new Map<string, SshHostProfile>([
      ["host-a", profileA],
      ["host-b", profileB],
    ])
    const defaults = createDefaults({
      remoteDeniedCwd: ["/opt"],
      allowTmux: false,
      connectTimeoutMs: 15000,
      keepaliveIntervalMs: 25000,
    })
    const result = mergeSshDefaultsIntoAllProfiles(profiles, defaults)

    expect(result.size).toBe(2)

    const mergedA = result.get("host-a")!
    expect(mergedA.remoteDeniedCwd).toEqual(["/opt"])
    expect(mergedA.allowTmux).toBe(false) // profile 未设置 → 用 defaults

    const mergedB = result.get("host-b")!
    expect(mergedB.allowTmux).toBe(true) // profile 已设置 → 保留 profile
    expect(mergedB.remoteDeniedCwd).toEqual(["/opt"]) // profile 未设置 → 用 defaults
  })

  it("空 profiles map 返回空 map", () => {
    const profiles = new Map<string, SshHostProfile>()
    const defaults = createDefaults()
    const result = mergeSshDefaultsIntoAllProfiles(profiles, defaults)
    expect(result.size).toBe(0)
  })
})
