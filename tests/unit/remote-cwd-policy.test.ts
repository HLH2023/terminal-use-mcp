import { describe, expect, it } from "vitest"
import { RemoteCwdDeniedError } from "../../src/terminal/errors.js"
import type { SshHostProfile } from "../../src/targets/target-types.js"
import { createRemoteCwdPolicy, isRemoteCwdAllowed, isRemoteCwdAllowedAgainstPath, resolveRemoteCwd, validateCanonicalRemoteCwd } from "../../src/targets/remote-cwd-policy.js"

function createProfile(overrides: Partial<SshHostProfile> = {}): SshHostProfile {
  return {
    name: "devbox",
    host: "example.internal",
    port: 22,
    username: "ops",
    auth: { type: "agent" },
    defaultCwd: "/home/user/dev",
    remoteAllowedCwd: ["/home/user/dev"],
    remoteDeniedCwd: ["/home/user/dev/secret", "/root", "/etc"],
    ...overrides,
  }
}

describe("RemoteCwdPolicy", () => {
  it("allowedRoot 下的 cwd 允许", () => {
    const policy = createRemoteCwdPolicy(createProfile())
    expect(isRemoteCwdAllowed(policy, "/home/user/dev/project")).toEqual({ ok: true })
  })

  it("deniedRoots 下的 cwd 拒绝", () => {
    const policy = createRemoteCwdPolicy(createProfile())
    const result = isRemoteCwdAllowed(policy, "/home/user/dev/secret/project")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain("denied root")
    }
  })

  it("deniedRoots 优先于 allowedRoots", () => {
    const policy = createRemoteCwdPolicy(createProfile({
      remoteAllowedCwd: ["/home/user"],
      remoteDeniedCwd: ["/home/user/dev/private"],
    }))
    expect(isRemoteCwdAllowed(policy, "/home/user/dev/private/repo").ok).toBe(false)
  })

  it("规范化 trailing slash、.. 和 . 后正确比较", () => {
    const policy = createRemoteCwdPolicy(createProfile())
    expect(isRemoteCwdAllowed(policy, "/home/user/dev/../dev/./project/")).toEqual({ ok: true })
  })

  it("未指定 cwd 时使用 profile.defaultCwd", () => {
    const policy = createRemoteCwdPolicy(createProfile({ defaultCwd: "/home/user/dev" }))
    expect(isRemoteCwdAllowed(policy)).toEqual({ ok: true })
    expect(resolveRemoteCwd(policy)).toBe("/home/user/dev")
  })

  it("empty remoteAllowedCwd 表示不允许任何 cwd", () => {
    const policy = createRemoteCwdPolicy(createProfile({ remoteAllowedCwd: [], defaultCwd: undefined }))
    const result = isRemoteCwdAllowed(policy, "/home/user/dev")
    expect(result.ok).toBe(false)
  })

  it("常见模式: /home/user/dev 允许，/root /etc / 拒绝", () => {
    const policy = createRemoteCwdPolicy(createProfile({
      remoteAllowedCwd: ["/home/user/dev"],
      remoteDeniedCwd: ["/", "/root", "/etc"],
    }))
    expect(isRemoteCwdAllowed(policy, "/home/user/dev")).toEqual({ ok: true })
    expect(isRemoteCwdAllowed(policy, "/root").ok).toBe(false)
    expect(isRemoteCwdAllowed(policy, "/etc").ok).toBe(false)
    expect(isRemoteCwdAllowed(policy, "/").ok).toBe(false)
  })

  it("resolveRemoteCwd 在拒绝时抛 REMOTE_CWD_DENIED", () => {
    const policy = createRemoteCwdPolicy(createProfile())
    expect(() => resolveRemoteCwd(policy, "/home/user/dev/secret")).toThrow(RemoteCwdDeniedError)
  })
})

describe("isRemoteCwdAllowedAgainstPath", () => {
  it("已规范化路径在 allowedRoot 下通过", () => {
    const policy = createRemoteCwdPolicy(createProfile())
    expect(isRemoteCwdAllowedAgainstPath(policy, "/home/user/dev/project")).toEqual({ ok: true })
  })

  it("已规范化路径在 allowedRoot 外拒绝", () => {
    const policy = createRemoteCwdPolicy(createProfile())
    expect(isRemoteCwdAllowedAgainstPath(policy, "/usr/local").ok).toBe(false)
  })

  it("已规范化路径在 deniedRoot 下拒绝", () => {
    const policy = createRemoteCwdPolicy(createProfile())
    expect(isRemoteCwdAllowedAgainstPath(policy, "/home/user/dev/secret/sub").ok).toBe(false)
  })
})

describe("validateCanonicalRemoteCwd", () => {
  it("canonical 路径在 allowedRoot 内通过并返回规范化路径", () => {
    const policy = createRemoteCwdPolicy(createProfile())
    expect(validateCanonicalRemoteCwd(policy, "/home/user/dev/project")).toBe("/home/user/dev/project")
  })

  it("canonical 路径在 allowedRoot 外抛 RemoteCwdDeniedError", () => {
    const policy = createRemoteCwdPolicy(createProfile())
    expect(() => validateCanonicalRemoteCwd(policy, "/etc/config")).toThrow(RemoteCwdDeniedError)
  })

  it("canonical 路径在 deniedRoot 下抛 RemoteCwdDeniedError", () => {
    const policy = createRemoteCwdPolicy(createProfile())
    expect(() => validateCanonicalRemoteCwd(policy, "/home/user/dev/secret/key")).toThrow(RemoteCwdDeniedError)
  })

  it("错误消息包含 'Canonical path' 关键字", () => {
    const policy = createRemoteCwdPolicy(createProfile())
    try {
      validateCanonicalRemoteCwd(policy, "/etc/config")
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(RemoteCwdDeniedError)
      expect((error as RemoteCwdDeniedError).message).toContain("Canonical path")
    }
  })

  it("symlink bypass 场景：字符串路径通过但 canonical 路径被拒绝", () => {
    const policy = createRemoteCwdPolicy(createProfile({
      remoteAllowedCwd: ["/home/user/dev"],
      remoteDeniedCwd: ["/etc"],
    }))
    // 字符串路径看起来属于 allowedRoot（通过了 isRemoteCwdAllowed）
    expect(isRemoteCwdAllowed(policy, "/home/user/dev/link").ok).toBe(true)
    // 但 canonical 路径 /etc/private 被 deny — validateCanonicalRemoteCwd 抓住
    expect(() => validateCanonicalRemoteCwd(policy, "/etc/private")).toThrow(RemoteCwdDeniedError)
  })
})
