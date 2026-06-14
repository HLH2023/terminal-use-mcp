import { afterEach, describe, expect, it } from "vitest"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"

import { getSshAgentSocket, isKeyFileAccessible, resolveSshAuth } from "../../src/targets/ssh-auth.js"

const tempRoots: string[] = []
const originalSshAuthSock = process.env.SSH_AUTH_SOCK
const originalXdgRuntimeDir = process.env.XDG_RUNTIME_DIR
const originalHome = process.env.HOME
const originalPassphrase = process.env.TUMCP_TEST_KEY_PASSPHRASE

afterEach(async () => {
  restoreEnv("SSH_AUTH_SOCK", originalSshAuthSock)
  restoreEnv("XDG_RUNTIME_DIR", originalXdgRuntimeDir)
  restoreEnv("HOME", originalHome)
  restoreEnv("TUMCP_TEST_KEY_PASSPHRASE", originalPassphrase)
  await Promise.all(tempRoots.splice(0).map(async (root) => fs.rm(root, { recursive: true, force: true })))
})

describe("resolveSshAuth agent", () => {
  it("SSH_AUTH_SOCK 存在时解析 agent socket", async () => {
    const socketPath = await writeTempFile("agent.sock", "")
    process.env.SSH_AUTH_SOCK = socketPath

    const result = await resolveSshAuth({ type: "agent" })

    expect(result).toEqual({ type: "agent", socket: socketPath })
  })

  it("没有 SSH_AUTH_SOCK 且无 fallback 时给出可读错误", async () => {
    delete process.env.SSH_AUTH_SOCK
    process.env.XDG_RUNTIME_DIR = await makeTempRoot()

    expect(getSshAgentSocket()).toBeUndefined()
    await expect(resolveSshAuth({ type: "agent" })).rejects.toThrow(/SSH agent socket not found/u)
  })
})

describe("resolveSshAuth key-file", () => {
  it("key-file 存在时解析路径并检查 passphraseEnv 是否存在", async () => {
    const keyPath = await writeTempFile("id_ed25519", "fake-private-key-placeholder")
    process.env.TUMCP_TEST_KEY_PASSPHRASE = "present-but-never-read"

    const result = await resolveSshAuth({ type: "key-file", path: keyPath, passphraseEnv: "TUMCP_TEST_KEY_PASSPHRASE" })

    expect(result).toEqual({ type: "key-file", path: keyPath, passphraseAvailable: true })
  })

  it("key-file 路径中的 ~ 会展开到 homedir", async () => {
    const homeRoot = await makeTempRoot()
    process.env.HOME = homeRoot
    const sshDir = path.join(homeRoot, ".ssh")
    await fs.mkdir(sshDir, { recursive: true })
    const keyPath = path.join(sshDir, "id_ed25519")
    await fs.writeFile(keyPath, "fake-private-key-placeholder", "utf8")

    const result = await resolveSshAuth({ type: "key-file", path: "~/.ssh/id_ed25519" })

    expect(result).toEqual({ type: "key-file", path: keyPath, passphraseAvailable: false })
    await expect(isKeyFileAccessible("~/.ssh/id_ed25519")).resolves.toBe(true)
  })

  it("key-file 不存在时抛出描述性错误", async () => {
    const missingKey = path.join(await makeTempRoot(), "missing_id_ed25519")

    await expect(resolveSshAuth({ type: "key-file", path: missingKey })).rejects.toThrow(/SSH key file is not accessible/u)
  })
})

async function writeTempFile(fileName: string, content: string): Promise<string> {
  const root = await makeTempRoot()
  const filePath = path.join(root, fileName)
  await fs.writeFile(filePath, content, "utf8")
  return filePath
}

async function makeTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tumcp-ssh-auth-"))
  tempRoots.push(root)
  return root
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}
