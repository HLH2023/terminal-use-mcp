import { describe, it, expect } from "vitest"
import {
  isSuspectedSecretKey,
  findSuspectedSecretKeys,
  checkSecretEnvPolicy,
} from "../../src/terminal/secret-env-policy.js"
import type { SecretEnvPolicy } from "../../src/config.js"

describe("isSuspectedSecretKey", () => {
  it("GITHUB_TOKEN → true", () => {
    expect(isSuspectedSecretKey("GITHUB_TOKEN")).toBe(true)
  })

  it("OPENAI_API_KEY → true", () => {
    expect(isSuspectedSecretKey("OPENAI_API_KEY")).toBe(true)
  })

  it("MY_SECRET → true（匹配 /SECRET$/ 模式）", () => {
    expect(isSuspectedSecretKey("MY_SECRET")).toBe(true)
  })

  it("AWS_SECRET_ACCESS_KEY → true", () => {
    expect(isSuspectedSecretKey("AWS_SECRET_ACCESS_KEY")).toBe(true)
  })

  it("PATH → false", () => {
    expect(isSuspectedSecretKey("PATH")).toBe(false)
  })

  it("HOME → false", () => {
    expect(isSuspectedSecretKey("HOME")).toBe(false)
  })

  it("MY_PASSWORD → true（匹配 /PASSWORD$/ 模式）", () => {
    expect(isSuspectedSecretKey("MY_PASSWORD")).toBe(true)
  })

  it("MY_TOKEN → true（匹配 /TOKEN$/ 模式）", () => {
    expect(isSuspectedSecretKey("MY_TOKEN")).toBe(true)
  })

  it("PRIVATE_KEY → true（匹配 /PRIVATE_KEY$/ 模式）", () => {
    expect(isSuspectedSecretKey("PRIVATE_KEY")).toBe(true)
  })

  it("ACCESS_KEY → true（匹配 /ACCESS_KEY$/ 模式）", () => {
    expect(isSuspectedSecretKey("ACCESS_KEY")).toBe(true)
  })

  it("MY_PASS → true（匹配 /PASS$/ 模式）", () => {
    expect(isSuspectedSecretKey("MY_PASS")).toBe(true)
  })

  it("NPM_TOKEN → true", () => {
    expect(isSuspectedSecretKey("NPM_TOKEN")).toBe(true)
  })

  it("GITLAB_TOKEN → true", () => {
    expect(isSuspectedSecretKey("GITLAB_TOKEN")).toBe(true)
  })

  it("ANTHROPIC_API_KEY → true", () => {
    expect(isSuspectedSecretKey("ANTHROPIC_API_KEY")).toBe(true)
  })

  it("NODE_ENV → false", () => {
    expect(isSuspectedSecretKey("NODE_ENV")).toBe(false)
  })

  it("EDITOR → false", () => {
    expect(isSuspectedSecretKey("EDITOR")).toBe(false)
  })
})

describe("findSuspectedSecretKeys", () => {
  it("返回疑似 secret 的 key 列表", () => {
    const env = { PATH: "/usr/bin", GITHUB_TOKEN: "ghp_xxx" }
    const result = findSuspectedSecretKeys(env)
    expect(result).toEqual(["GITHUB_TOKEN"])
  })

  it("无 secret key 时返回空数组", () => {
    const env = { PATH: "/usr/bin", HOME: "/home/user" }
    const result = findSuspectedSecretKeys(env)
    expect(result).toEqual([])
  })

  it("多个 secret key 全部检测", () => {
    const env = {
      GITHUB_TOKEN: "ghp_xxx",
      OPENAI_API_KEY: "sk-xxx",
      PATH: "/usr/bin",
      MY_SECRET: "s3cret",
    }
    const result = findSuspectedSecretKeys(env)
    expect(result).toHaveLength(3)
    expect(result).toContain("GITHUB_TOKEN")
    expect(result).toContain("OPENAI_API_KEY")
    expect(result).toContain("MY_SECRET")
  })

  it("空 env 返回空数组", () => {
    expect(findSuspectedSecretKeys({})).toEqual([])
  })
})

describe("checkSecretEnvPolicy", () => {
  const envWithSecret = { GITHUB_TOKEN: "ghp_xxx", PATH: "/usr/bin" }
  const envWithoutSecret = { PATH: "/usr/bin", HOME: "/home/user" }

  it("deny + 有 secret key → {allowed: false, deniedKeys}", () => {
    const result = checkSecretEnvPolicy(envWithSecret, "deny" as SecretEnvPolicy)
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.deniedKeys).toContain("GITHUB_TOKEN")
    }
  })

  it("warn + 有 secret key → {allowed: true, warningKeys}", () => {
    const result = checkSecretEnvPolicy(envWithSecret, "warn" as SecretEnvPolicy)
    expect(result.allowed).toBe(true)
    if (result.allowed) {
      expect(result.warningKeys).toContain("GITHUB_TOKEN")
    }
  })

  it("allow → 始终 {allowed: true, warningKeys: []}", () => {
    const result = checkSecretEnvPolicy(envWithSecret, "allow" as SecretEnvPolicy)
    expect(result.allowed).toBe(true)
    if (result.allowed) {
      expect(result.warningKeys).toEqual([])
    }
  })

  it("deny + 无 secret key → {allowed: true, warningKeys: []}", () => {
    const result = checkSecretEnvPolicy(envWithoutSecret, "deny" as SecretEnvPolicy)
    expect(result.allowed).toBe(true)
    if (result.allowed) {
      expect(result.warningKeys).toEqual([])
    }
  })

  it("warn + 无 secret key → {allowed: true, warningKeys: []}", () => {
    const result = checkSecretEnvPolicy(envWithoutSecret, "warn" as SecretEnvPolicy)
    expect(result.allowed).toBe(true)
    if (result.allowed) {
      expect(result.warningKeys).toEqual([])
    }
  })
})
