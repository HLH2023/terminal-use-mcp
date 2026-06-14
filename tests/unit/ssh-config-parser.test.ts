import { join } from "node:path"
import { homedir } from "node:os"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"
import { parseSshConfig, findSshConfigEntry } from "../../src/targets/ssh-config-parser.js"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function writeSshConfig(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tumcp-ssh-config-"))
  tempDirs.push(dir)
  const filePath = join(dir, "config")
  await writeFile(filePath, content, "utf8")
  return filePath
}

describe("parseSshConfig", () => {
  it("不存在的文件返回空 map", async () => {
    const entries = await parseSshConfig("/nonexistent/path/config")
    expect(entries.size).toBe(0)
  })

  it("解析基本 Host 块", async () => {
    const path = await writeSshConfig(`
Host devbox
  HostName 192.168.1.20
  Port 2222
  User hlh
  IdentityFile ~/.ssh/id_rsa
`)
    const entries = await parseSshConfig(path)
    const devbox = entries.get("devbox")
    expect(devbox).toBeDefined()
    expect(devbox?.hostName).toBe("192.168.1.20")
    expect(devbox?.port).toBe(2222)
    expect(devbox?.username).toBe("hlh")
    expect(devbox?.identityFiles).toEqual([join(homedir(), ".ssh/id_rsa")])
  })

  it("HostName 缺省时用 Host 别名", async () => {
    const path = await writeSshConfig(`
Host myserver
  User admin
`)
    const entries = await parseSshConfig(path)
    const entry = entries.get("myserver")
    expect(entry?.hostName).toBe("myserver")
  })

  it("Port 缺省时默认 22", async () => {
    const path = await writeSshConfig(`
Host nospecify
  User test
`)
    const entries = await parseSshConfig(path)
    expect(entries.get("nospecify")?.port).toBe(22)
  })

  it("多个 Host 块", async () => {
    const path = await writeSshConfig(`
Host alpha
  HostName 10.0.0.1
  User root

Host beta
  HostName 10.0.0.2
  User deploy
`)
    const entries = await parseSshConfig(path)
    expect(entries.size).toBe(2)
    expect(entries.get("alpha")?.hostName).toBe("10.0.0.1")
    expect(entries.get("beta")?.hostName).toBe("10.0.0.2")
  })

  it("Host 带多个模式（空格分隔）", async () => {
    const path = await writeSshConfig(`
Host dev staging
  HostName 10.0.0.1
`)
    const entries = await parseSshConfig(path)
    expect(entries.get("dev")?.hostName).toBe("10.0.0.1")
    expect(entries.get("staging")?.hostName).toBe("10.0.0.1")
  })

  it("ProxyJump 解析", async () => {
    const path = await writeSshConfig(`
Host prod
  HostName prod.internal
  ProxyJump bastion
`)
    const entries = await parseSshConfig(path)
    expect(entries.get("prod")?.proxyJump).toBe("bastion")
  })

  it("StrictHostKeyChecking 解析", async () => {
    const path = await writeSshConfig(`
Host dev
  HostName dev.local
  StrictHostKeyChecking no
`)
    const entries = await parseSshConfig(path)
    expect(entries.get("dev")?.strictHostKeyChecking).toBe("no")
  })

  it("UserKnownHostsFile 解析且展开 ~", async () => {
    const path = await writeSshConfig(`
Host dev
  HostName dev.local
  UserKnownHostsFile ~/.ssh/my_known_hosts
`)
    const entries = await parseSshConfig(path)
    expect(entries.get("dev")?.userKnownHostsFile).toBe(join(homedir(), ".ssh/my_known_hosts"))
  })

  it("多个 IdentityFile", async () => {
    const path = await writeSshConfig(`
Host multi
  HostName example.com
  IdentityFile ~/.ssh/id_ed25519
  IdentityFile ~/.ssh/id_rsa
`)
    const entries = await parseSshConfig(path)
    expect(entries.get("multi")?.identityFiles).toEqual([
      join(homedir(), ".ssh/id_ed25519"),
      join(homedir(), ".ssh/id_rsa"),
    ])
  })

  it("注释行被忽略", async () => {
    const path = await writeSshConfig(`
# This is a comment
Host commented
  # Another comment
  HostName example.com
  User test  # inline comment
`)
    const entries = await parseSshConfig(path)
    const entry = entries.get("commented")
    expect(entry).toBeDefined()
    expect(entry?.hostName).toBe("example.com")
  })

  it("空行被忽略", async () => {
    const path = await writeSshConfig(`

Host blank

  HostName example.com

`)
    const entries = await parseSshConfig(path)
    expect(entries.get("blank")?.hostName).toBe("example.com")
  })

  it("指令大小写不敏感", async () => {
    const path = await writeSshConfig(`
Host MixedCase
  hostname example.com
  PORT 2222
  USER admin
`)
    const entries = await parseSshConfig(path)
    const entry = entries.get("MixedCase")
    expect(entry?.hostName).toBe("example.com")
    expect(entry?.port).toBe(2222)
    expect(entry?.username).toBe("admin")
  })

  it("非法 port 值回退到默认 22", async () => {
    const path = await writeSshConfig(`
Host badport
  HostName example.com
  Port abc
`)
    const entries = await parseSshConfig(path)
    expect(entries.get("badport")?.port).toBe(22)
  })

  it("不识别的指令被忽略", async () => {
    const path = await writeSshConfig(`
Host unknown
  HostName example.com
  ForwardX11 yes
  Compression yes
`)
    const entries = await parseSshConfig(path)
    expect(entries.get("unknown")?.hostName).toBe("example.com")
  })
})

describe("findSshConfigEntry", () => {
  it("精确匹配", () => {
    const entries = new Map([
      ["devbox", { host: "devbox", hostName: "10.0.0.1", port: 22, username: "hlh", identityFiles: [] }],
    ])
    const result = findSshConfigEntry("devbox", entries)
    expect(result?.hostName).toBe("10.0.0.1")
  })

  it("通配符 * 匹配", () => {
    const entries = new Map([
      ["*.example.com", { host: "*.example.com", hostName: "proxy", port: 22, username: "deploy", identityFiles: [] }],
    ])
    const result = findSshConfigEntry("dev.example.com", entries)
    expect(result?.hostName).toBe("proxy")
  })

  it("通配符 ? 匹配单字符", () => {
    const entries = new Map([
      ["host?.local", { host: "host?.local", hostName: "generic", port: 22, username: "user", identityFiles: [] }],
    ])
    const result = findSshConfigEntry("host1.local", entries)
    expect(result?.hostName).toBe("generic")
  })

  it("无匹配返回 undefined", () => {
    const entries = new Map([
      ["devbox", { host: "devbox", hostName: "10.0.0.1", port: 22, username: "hlh", identityFiles: [] }],
    ])
    const result = findSshConfigEntry("nonexistent", entries)
    expect(result).toBeUndefined()
  })

  it("精确匹配优先于通配符", () => {
    const entries = new Map([
      ["*.example.com", { host: "*.example.com", hostName: "generic", port: 22, username: "deploy", identityFiles: [] }],
      ["specific.example.com", { host: "specific.example.com", hostName: "specific-server", port: 22, username: "admin", identityFiles: [] }],
    ])
    const result = findSshConfigEntry("specific.example.com", entries)
    expect(result?.hostName).toBe("specific-server")
  })
})
