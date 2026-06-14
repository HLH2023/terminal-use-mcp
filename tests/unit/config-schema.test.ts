import { describe, expect, it } from "vitest"
import {
  SshAuthRefSchema,
  SshHostProfileSchema,
  SshProfileOverlaySchema,
  LocalConfigSchema,
  RootConfigSchema,
  expandEnvVars,
  expandTildeInPath,
  expandTildeInObject,
} from "../../src/targets/config-schema.js"
import { homedir } from "node:os"
import { join } from "node:path"

describe("expandEnvVars", () => {
  it("展开字符串中的 ${VAR}", () => {
    expect(expandEnvVars("${HOME}/dev", { HOME: "/home/user" })).toBe("/home/user/dev")
  })

  it("未设置的环境变量保留原样", () => {
    expect(expandEnvVars("${UNSET_VAR}/dev", {})).toBe("${UNSET_VAR}/dev")
  })

  it("HOME 特殊变量始终可展开", () => {
    expect(expandEnvVars("${HOME}/dev", {})).toBe(`${homedir()}/dev`)
  })

  it("递归展开对象", () => {
    const input = { path: "${HOME}/keys", name: "static" }
    const result = expandEnvVars(input, { HOME: "/home/user" })
    expect(result).toEqual({ path: "/home/user/keys", name: "static" })
  })

  it("递归展开数组", () => {
    const input = ["${HOME}/a", "${HOME}/b", "literal"]
    const result = expandEnvVars(input, { HOME: "/home/user" })
    expect(result).toEqual(["/home/user/a", "/home/user/b", "literal"])
  })

  it("非字符串值不处理", () => {
    expect(expandEnvVars(42, {})).toBe(42)
    expect(expandEnvVars(true, {})).toBe(true)
    expect(expandEnvVars(null, {})).toBe(null)
  })
})

describe("expandTildeInPath", () => {
  it("~ 展开为 homedir", () => {
    expect(expandTildeInPath("~")).toBe(homedir())
  })

  it("~/x 展开为 join(homedir, x)", () => {
    expect(expandTildeInPath("~/ssh/config")).toBe(join(homedir(), "ssh/config"))
  })

  it("非 ~ 开头的路径不变", () => {
    expect(expandTildeInPath("/absolute/path")).toBe("/absolute/path")
  })
})

describe("expandTildeInObject", () => {
  it("递归展开对象中的 ~", () => {
    const input = { key: "~/ssh/id_rsa", nested: { file: "~/data" } }
    const result = expandTildeInObject(input)
    expect(result.key).toBe(join(homedir(), "ssh/id_rsa"))
    expect(result.nested.file).toBe(join(homedir(), "data"))
  })
})

describe("SshAuthRefSchema", () => {
  it("agent 类型合法", () => {
    const result = SshAuthRefSchema.safeParse({ type: "agent" })
    expect(result.success).toBe(true)
  })

  it("agent 带 socket 合法", () => {
    const result = SshAuthRefSchema.safeParse({ type: "agent", socket: "/tmp/agent.sock" })
    expect(result.success).toBe(true)
  })

  it("key-file 类型合法", () => {
    const result = SshAuthRefSchema.safeParse({ type: "key-file", path: "/home/user/.ssh/id_rsa" })
    expect(result.success).toBe(true)
  })

  it("key-file 带 passphraseEnv 合法", () => {
    const result = SshAuthRefSchema.safeParse({ type: "key-file", path: "/home/user/.ssh/id_rsa", passphraseEnv: "SSH_PASS" })
    expect(result.success).toBe(true)
  })

  it("password 类型被拒绝", () => {
    const result = SshAuthRefSchema.safeParse({ type: "password" })
    expect(result.success).toBe(false)
  })

  it("key-file 缺少 path 被拒绝", () => {
    const result = SshAuthRefSchema.safeParse({ type: "key-file" })
    expect(result.success).toBe(false)
  })

  it("password 类型被拒绝（discriminated union 不匹配）", () => {
    const result = SshAuthRefSchema.safeParse({ type: "password" })
    expect(result.success).toBe(false)
  })
})

describe("SshHostProfileSchema", () => {
  const validProfile = {
    name: "devbox",
    host: "192.168.1.20",
    port: 22,
    username: "hlh",
    auth: { type: "agent" },
    remoteAllowedCwd: ["/home/hlh/dev"],
  }

  it("最小合法 profile", () => {
    const result = SshHostProfileSchema.safeParse(validProfile)
    expect(result.success).toBe(true)
  })

  it("sshConfigHost 可选字段", () => {
    const result = SshHostProfileSchema.safeParse({ ...validProfile, sshConfigHost: "devbox-ssh" })
    expect(result.success).toBe(true)
  })

  it("缺少 name 被拒绝", () => {
    const { name: _, ...noName } = validProfile
    const result = SshHostProfileSchema.safeParse(noName)
    expect(result.success).toBe(false)
  })

  it("缺少 remoteAllowedCwd 被拒绝", () => {
    const { remoteAllowedCwd: _, ...noCwd } = validProfile
    const result = SshHostProfileSchema.safeParse(noCwd)
    expect(result.success).toBe(false)
  })

  it("空 remoteAllowedCwd 被拒绝", () => {
    const result = SshHostProfileSchema.safeParse({ ...validProfile, remoteAllowedCwd: [] })
    expect(result.success).toBe(false)
  })

  it("port 超出范围被拒绝", () => {
    const result = SshHostProfileSchema.safeParse({ ...validProfile, port: 99999 })
    expect(result.success).toBe(false)
  })

  it("password auth 被拒绝", () => {
    const result = SshHostProfileSchema.safeParse({ ...validProfile, auth: { type: "password" } })
    expect(result.success).toBe(false)
  })

  it("port 0 被拒绝", () => {
    const result = SshHostProfileSchema.safeParse({ ...validProfile, port: 0 })
    expect(result.success).toBe(false)
  })
})

describe("SshProfileOverlaySchema", () => {
  it("sshConfigHost 模式合法", () => {
    const result = SshProfileOverlaySchema.safeParse({ sshConfigHost: "devbox", defaultCwd: "/home/user/dev" })
    expect(result.success).toBe(true)
  })

  it("完整自描述模式合法", () => {
    const result = SshProfileOverlaySchema.safeParse({
      host: "192.168.1.20",
      port: 22,
      username: "hlh",
      auth: { type: "agent" },
      remoteAllowedCwd: ["/home/hlh/dev"],
    })
    expect(result.success).toBe(true)
  })

  it("空 overlay 合法", () => {
    const result = SshProfileOverlaySchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it("password auth 被拒绝（discriminated union 不匹配）", () => {
    const result = SshProfileOverlaySchema.safeParse({ auth: { type: "password" } })
    expect(result.success).toBe(false)
  })
})

describe("RootConfigSchema", () => {
  it("空对象合法", () => {
    const result = RootConfigSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it("带 local 配置合法", () => {
    const result = RootConfigSchema.safeParse({
      version: 1,
      local: { workspaceRoot: "/home/user/dev", logLevel: "debug" },
      sshDefaults: { remoteDeniedCwd: ["/", "/root", "/etc"], allowTmux: true },
    })
    expect(result.success).toBe(true)
  })

  it("invalid logLevel 被拒绝", () => {
    const result = RootConfigSchema.safeParse({ local: { logLevel: "verbose" } })
    expect(result.success).toBe(false)
  })

  it("invalid riskyCommandMode 被拒绝", () => {
    const result = RootConfigSchema.safeParse({ local: { riskyCommandMode: "prompt" } })
    expect(result.success).toBe(false)
  })
})

describe("LocalConfigSchema", () => {
  it("所有字段合法", () => {
    const result = LocalConfigSchema.safeParse({
      workspaceRoot: "/home/user/dev",
      allowedCwdRoots: ["/tmp"],
      allowedCommands: ["git", "make"],
      deniedCommands: ["rm"],
      riskyCommandMode: "ask",
      sessionTtlMs: 7200000,
      defaultCols: 160,
      defaultRows: 48,
      logLevel: "debug",
    })
    expect(result.success).toBe(true)
  })

  it("空对象合法（所有字段可选）", () => {
    const result = LocalConfigSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it("负数 sessionTtlMs 被拒绝", () => {
    const result = LocalConfigSchema.safeParse({ sessionTtlMs: -1 })
    expect(result.success).toBe(false)
  })
})
