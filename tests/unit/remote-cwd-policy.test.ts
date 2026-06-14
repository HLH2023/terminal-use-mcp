import { describe, expect, it } from "vitest"
import { RemoteCwdDeniedError } from "../../src/terminal/errors.js"
import type { SshHostProfile } from "../../src/targets/target-types.js"
import { createRemoteCwdPolicy, isRemoteCwdAllowed, resolveRemoteCwd } from "../../src/targets/remote-cwd-policy.js"

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
