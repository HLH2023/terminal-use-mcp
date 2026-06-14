import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"
import { SshInlineTargetDeniedError } from "../../src/terminal/errors.js"
import type { SshHostProfile, TerminalTarget } from "../../src/targets/target-types.js"
import { isSshAgentAuthRef, isSshAuthRef, isSshKeyFileAuthRef } from "../../src/targets/target-types.js"
import { clearHostsConfigCache, loadHostsConfig } from "../../src/targets/ssh-host-config.js"
import { resolveSshTarget } from "../../src/targets/ssh-profile-loader.js"
import { getTargetInfo, listTargets } from "../../src/targets/target-registry.js"

const tempDirs: string[] = []

afterEach(async () => {
  delete process.env.TERMINAL_USE_ALLOW_INLINE_SSH_TARGETS
  clearHostsConfigCache()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function writeHostsJson(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tumcp-safety-hosts-"))
  tempDirs.push(dir)
  const filePath = join(dir, "hosts.json")
  await writeFile(filePath, content, "utf8")
  return filePath
}

function keyFileProfile(): SshHostProfile {
  return {
    name: "prod",
    host: "prod.internal",
    port: 22,
    username: "deploy",
    auth: { type: "key-file", path: "/home/deploy/.ssh/id_ed25519", passphraseEnv: "SSH_KEY_PASSPHRASE" },
    remoteAllowedCwd: ["/srv/app"],
    defaultCwd: "/srv/app",
    env: { SERVICE_TOKEN: "super-token-value" },
    allowTmux: true,
  }
}

describe("SSH target safety", () => {
  it("inline SSH 默认拒绝并返回 SSH_INLINE_TARGET_DENIED", () => {
    const target: TerminalTarget = { kind: "ssh", host: "127.0.0.1", port: 22, username: "me", auth: { type: "agent" } }
    try {
      resolveSshTarget(target, new Map())
      throw new Error("expected inline target denial")
    } catch (error) {
      expect(error).toBeInstanceOf(SshInlineTargetDeniedError)
      if (error instanceof SshInlineTargetDeniedError) {
        expect(error.code).toBe("SSH_INLINE_TARGET_DENIED")
      }
    }
  })

  it("启用 env 后 inline SSH 允许", () => {
    process.env.TERMINAL_USE_ALLOW_INLINE_SSH_TARGETS = "1"
    const target: TerminalTarget = { kind: "ssh", host: "127.0.0.1", port: 22, username: "me", auth: { type: "agent" } }
    const resolved = resolveSshTarget(target, new Map())
    expect(resolved.kind).toBe("ssh")
  })

  it("hosts config 禁止 password auth type", async () => {
    const filePath = await writeHostsJson(JSON.stringify({
      hosts: {
        badhost: {
          host: "127.0.0.1",
          port: 22,
          username: "me",
          auth: { type: "password" },
          remoteAllowedCwd: ["/home/me"],
        },
      },
    }))
    await expect(loadHostsConfig(filePath)).rejects.toThrow(/auth\.type/)
  })

  it("target info 输出不包含 private key、passphrase、token 或 password", () => {
    const profiles = new Map([["prod", keyFileProfile()]])
    const allTargets = listTargets(profiles)
    const targetInfo = getTargetInfo("prod", profiles)
    const output = JSON.stringify({ allTargets, targetInfo })

    expect(output).toContain("key-file")
    expect(output).not.toContain("id_ed25519")
    expect(output).not.toContain("SSH_KEY_PASSPHRASE")
    expect(output).not.toContain("super-token-value")
    expect(output.toLowerCase()).not.toContain("password")
  })

  it("SshAuthRef type guard 区分 agent 与 key-file", () => {
    const agentAuth: unknown = { type: "agent", socket: "/tmp/ssh-agent.sock" }
    const keyFileAuth: unknown = { type: "key-file", path: "/keys/id_ed25519", passphraseEnv: "SSH_PASSPHRASE" }
    const passwordAuth: unknown = { type: "password", password: "secret" }

    expect(isSshAgentAuthRef(agentAuth)).toBe(true)
    expect(isSshKeyFileAuthRef(agentAuth)).toBe(false)
    expect(isSshKeyFileAuthRef(keyFileAuth)).toBe(true)
    expect(isSshAuthRef(keyFileAuth)).toBe(true)
    expect(isSshAuthRef(passwordAuth)).toBe(false)
  })
})
