import { afterEach, describe, expect, it } from "vitest"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"

import { parseKnownHosts, verifyHostKey } from "../../src/targets/known-hosts.js"

const PUBLIC_KEY = Buffer.from("terminal-use-known-host-key").toString("base64")
const OTHER_PUBLIC_KEY = Buffer.from("terminal-use-other-known-host-key").toString("base64")

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(async (root) => fs.rm(root, { recursive: true, force: true })))
})

describe("parseKnownHosts", () => {
  it("解析有效 known_hosts 条目", async () => {
    const filePath = await writeKnownHosts([
      `example.com ssh-ed25519 ${PUBLIC_KEY} comment`,
      `192.168.1.20 ssh-rsa ${OTHER_PUBLIC_KEY}`,
    ])

    const entries = await parseKnownHosts(filePath)

    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ host: "example.com", keyType: "ssh-ed25519", publicKey: PUBLIC_KEY, sourceLine: 1 })
    expect(entries[1]).toMatchObject({ host: "192.168.1.20", keyType: "ssh-rsa", publicKey: OTHER_PUBLIC_KEY, sourceLine: 2 })
  })

  it("解析 [host]:port 格式并保留端口", async () => {
    const filePath = await writeKnownHosts([`[devbox.local]:2222 ssh-ed25519 ${PUBLIC_KEY}`])

    const entries = await parseKnownHosts(filePath)

    expect(entries).toHaveLength(1)
    expect(entries[0]?.host).toBe("devbox.local:2222")
  })

  it("空文件和缺失文件返回空数组", async () => {
    const emptyFile = await writeKnownHosts([])
    const missingFile = path.join(await makeTempRoot(), "missing_known_hosts")

    await expect(parseKnownHosts(emptyFile)).resolves.toEqual([])
    await expect(parseKnownHosts(missingFile)).resolves.toEqual([])
  })

  it("跳过 malformed line 且不抛错", async () => {
    const filePath = await writeKnownHosts([
      "malformed-line-without-key",
      `bad.example ssh-ed25519 not@@base64`,
      `good.example ssh-ed25519 ${PUBLIC_KEY}`,
    ])

    const entries = await parseKnownHosts(filePath)

    expect(entries).toHaveLength(1)
    expect(entries[0]?.host).toBe("good.example")
  })
})

describe("verifyHostKey", () => {
  it("host 存在于 known_hosts 时返回 ok 与 fingerprint", async () => {
    const filePath = await writeKnownHosts([`devbox.local ssh-ed25519 ${PUBLIC_KEY}`])

    const result = await verifyHostKey("devbox.local", 22, filePath)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.fingerprint).toMatch(/^SHA256:/u)
    }
  })

  it("host 不存在时返回 host_not_found", async () => {
    const filePath = await writeKnownHosts([`devbox.local ssh-ed25519 ${PUBLIC_KEY}`])

    const result = await verifyHostKey("missing.local", 22, filePath)

    expect(result).toMatchObject({ ok: false, reason: "host_not_found" })
  })

  it("known_hosts 文件缺失时返回 file_not_found", async () => {
    const missingFile = path.join(await makeTempRoot(), "missing_known_hosts")

    const result = await verifyHostKey("devbox.local", 22, missingFile)

    expect(result).toMatchObject({ ok: false, reason: "file_not_found" })
  })
})

async function writeKnownHosts(lines: string[]): Promise<string> {
  const root = await makeTempRoot()
  const filePath = path.join(root, "known_hosts")
  await fs.writeFile(filePath, lines.join("\n"), "utf8")
  return filePath
}

async function makeTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tumcp-known-hosts-"))
  tempRoots.push(root)
  return root
}
