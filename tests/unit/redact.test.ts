import { describe, it, expect } from "vitest"
import { redactSecrets, containsSecrets } from "../../src/terminal/redact.js"

describe("redactSecrets", () => {
  it("替换 GitHub token (ghp_)", () => {
    const token = "ghp_" + "a".repeat(36)
    const input = `export GITHUB_TOKEN=${token}`
    const result = redactSecrets(input)
    expect(result).toBe("export GITHUB_TOKEN=<REDACTED_github_token>")
  })

  it("替换 GitHub OAuth token (gho_)", () => {
    const token = "gho_" + "b".repeat(36)
    const input = `oauth=${token}`
    const result = redactSecrets(input)
    expect(result).toBe("oauth=<REDACTED_github_oauth>")
  })

  it("替换 AWS access key (AKIA)", () => {
    const key = "AKIA" + "0".repeat(16)
    const input = `AWS_ACCESS_KEY_ID=${key}`
    const result = redactSecrets(input)
    expect(result).toContain("<REDACTED_aws_access_key>")
    expect(result).not.toContain(key)
  })

  it("替换 OpenAI key (sk-...T3BlbkFJ...)", () => {
    const key = "sk-" + "a".repeat(20) + "T3BlbkFJ" + "b".repeat(20)
    const input = `OPENAI_API_KEY=${key}`
    const result = redactSecrets(input)
    expect(result).toContain("<REDACTED_openai_key>")
    expect(result).not.toContain(key)
  })

  it("替换 OpenAI project key (sk-proj-...)", () => {
    const key = "sk-proj-abc123XYZ"
    const input = `key=${key}`
    const result = redactSecrets(input)
    expect(result).toContain("<REDACTED_openai_proj_key>")
  })

  it("替换 Anthropic key (sk-ant-...)", () => {
    const key = "sk-ant-api03-xyz789"
    const input = `ANTHROPIC_API_KEY=${key}`
    const result = redactSecrets(input)
    expect(result).toContain("<REDACTED_anthropic_key>")
  })

  it("替换 Bearer token", () => {
    const input = "Authorization: Bearer abc123xyz.def456=="
    const result = redactSecrets(input)
    expect(result).toContain("<REDACTED_bearer_token>")
    expect(result).not.toContain("abc123xyz.def456==")
  })

  it("替换 private key 块", () => {
    const input = `-----BEGIN RSA PRIVATE KEY-----
MIIBogIBAAJBALRiMLAHudeSA6/0
-----END RSA PRIVATE KEY-----`
    const result = redactSecrets(input)
    expect(result).toBe("<REDACTED_private_key>")
  })

  it("替换 .env password= 行", () => {
    const input = "password=secret123"
    const result = redactSecrets(input)
    expect(result).toContain("<REDACTED_env_secret>")
    expect(result).toContain("password=")
    expect(result).not.toContain("secret123")
  })

  it("替换 .env secret= 行", () => {
    const input = "api_key=my-super-secret-key"
    const result = redactSecrets(input)
    expect(result).toContain("<REDACTED_env_secret>")
  })

  it("替换 x-api-key header", () => {
    const input = "x-api-key: abc123def"
    const result = redactSecrets(input)
    expect(result).toContain("<REDACTED_x_api_key>")
  })

  it("不替换不含 secret 的普通文本", () => {
    const input = "Hello World, this is a normal terminal output"
    const result = redactSecrets(input)
    expect(result).toBe(input)
  })

  it("同时替换多种 secret", () => {
    const token = "ghp_" + "c".repeat(36)
    // password= 在行首才能触发行级 .env 模式 (^ 修饰)
    const input = `Found ${token}\npassword=mypass123`
    const result = redactSecrets(input)
    expect(result).toContain("<REDACTED_github_token>")
    expect(result).toContain("<REDACTED_env_secret>")
    expect(result).not.toContain(token)
    expect(result).not.toContain("mypass123")
  })

  it("保留 .env key 名称部分", () => {
    const input = "  token=abc123xyz"
    const result = redactSecrets(input)
    expect(result).toMatch(/^\s*token=<REDACTED_env_secret>/)
  })
})

describe("containsSecrets", () => {
  it("含 GitHub token 时返回 true", () => {
    const token = "ghp_" + "d".repeat(36)
    expect(containsSecrets(`token=${token}`)).toBe(true)
  })

  it("含 AWS key 时返回 true", () => {
    expect(containsSecrets("AKIA" + "1".repeat(16))).toBe(true)
  })

  it("含 password= 时返回 true", () => {
    expect(containsSecrets("password=secret")).toBe(true)
  })

  it("不含 secret 时返回 false", () => {
    expect(containsSecrets("just normal output")).toBe(false)
  })

  it("空字符串返回 false", () => {
    expect(containsSecrets("")).toBe(false)
  })
})
