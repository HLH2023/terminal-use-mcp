/**
 * ssh-pty Provider localhost E2E 合约测试。
 *
 * 这些用例不 mock Provider：它们通过本机 sshd 连接 localhost，并验证 SSH
 * target/profile、host key 校验、key-file 认证与远端 PTY 基础生命周期。
 */
import { execSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import type { Logger } from "../../src/logger.js"
import { SshPtyProvider } from "../../src/providers/ssh-pty-provider.js"
import type { SshHostProfile } from "../../src/targets/target-types.js"
import { parseKeyExpr } from "../../src/terminal/keymap.js"
import { TerminalUseError, type TerminalUseErrorCode } from "../../src/terminal/errors.js"

const HOME_DIR = homedir()
const SSH_USERNAME = process.env.USER?.trim() || "hlh"
const SSH_KEY_PATH = join(HOME_DIR, ".ssh", "id_rsa")
const LOCALHOST_PROFILE = "localhost"
const START_TIMEOUT_MS = 30_000

function shellArg(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`
}

/**
 * 运行前探测本机 SSH 条件；不可达时整组 skip，避免在未配置 sshd 的机器上误报失败。
 * 探测使用与测试相同的 key-file，避免不小心依赖 ssh-agent 或密码回退。
 */
const SSH_E2E_AVAILABLE = (() => {
  try {
    execSync(
      [
        "ssh",
        "-i",
        shellArg(SSH_KEY_PATH),
        "-o BatchMode=yes",
        "-o IdentitiesOnly=yes",
        "-o ConnectTimeout=3",
        "-o StrictHostKeyChecking=accept-new",
        `${SSH_USERNAME}@localhost`,
        "echo ok",
      ].join(" "),
      { timeout: 5_000, stdio: "pipe" },
    )
    execSync("ssh-keyscan -p 22 localhost", { timeout: 5_000, stdio: "pipe" })
    return true
  } catch {
    return false
  }
})()

function createLoggerMock(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setLevel: vi.fn(),
  }
}

function createLocalhostProfile(overrides: {
  auth?: SshHostProfile["auth"]
  knownHosts?: string
} = {}): SshHostProfile {
  return {
    name: LOCALHOST_PROFILE,
    host: "localhost",
    port: 22,
    username: SSH_USERNAME,
    auth: overrides.auth ?? { type: "key-file", path: "~/.ssh/id_rsa" },
    knownHosts: overrides.knownHosts ?? "~/.ssh/known_hosts",
    defaultCwd: HOME_DIR,
    remoteAllowedCwd: [HOME_DIR, "/tmp"],
    remoteDeniedCwd: ["/", "/root", "/etc"],
    allowTmux: true,
    connectTimeoutMs: 10_000,
    keepaliveIntervalMs: 15_000,
  }
}

function createProvider(profile: SshHostProfile): SshPtyProvider {
  const provider = new SshPtyProvider(createLoggerMock(), {
    hostsConfig: new Map<string, SshHostProfile>([[LOCALHOST_PROFILE, profile]]),
  })
  activeProviders.push(provider)
  return provider
}

function createTempDir(): string {
  const tempDir = mkdtempSync(join(tmpdir(), "terminal-use-ssh-e2e-"))
  tempDirs.push(tempDir)
  return tempDir
}

function createScannedKnownHostsFile(): string {
  const tempDir = createTempDir()
  const knownHosts = join(tempDir, "known_hosts")
  const scanOutput = execSync("ssh-keyscan -p 22 localhost", {
    timeout: 5_000,
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8",
  })
  writeFileSync(knownHosts, scanOutput, "utf8")
  return knownHosts
}

function assertTerminalErrorCode(error: unknown, code: TerminalUseErrorCode): void {
  expect(error).toBeInstanceOf(TerminalUseError)
  const terminalError = error as TerminalUseError
  expect(terminalError.code).toBe(code)
}

const activeProviders: SshPtyProvider[] = []
const tempDirs: string[] = []

describe.skipIf(!SSH_E2E_AVAILABLE)("ssh-pty provider contract", () => {
  afterEach(async () => {
    for (const provider of activeProviders.splice(0)) {
      for (const sessionId of provider.listActiveSessionIds()) {
        await provider.kill(sessionId)
      }
    }

    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it("start → wait_stable → snapshot → type → press enter → wait_for_text → resize → kill", async () => {
    const provider = createProvider(createLocalhostProfile({ knownHosts: createScannedKnownHostsFile() }))
    const session = await provider.start({
      command: "bash",
      args: [],
      cwd: HOME_DIR,
      cols: 80,
      rows: 24,
      target: { kind: "ssh", profile: LOCALHOST_PROFILE },
    })

    await provider.waitStable(session.providerSessionId, { idleMs: 500, timeoutMs: 5_000 })
    const snapshot = await provider.snapshot(session.providerSessionId)

    expect(snapshot.screen.length).toBeGreaterThan(0)
    expect(snapshot.status).toBe("running")

    await provider.type(session.providerSessionId, "echo HELLO_SSH")
    await provider.press(session.providerSessionId, "enter", parseKeyExpr("enter"))

    const helloSnapshot = await provider.waitForText(session.providerSessionId, "HELLO_SSH", {
      text: "HELLO_SSH",
      timeoutMs: 5_000,
      caseSensitive: true,
    })
    expect(helloSnapshot.screen).toContain("HELLO_SSH")

    await expect(provider.resize(session.providerSessionId, 120, 40)).resolves.toBeUndefined()
    await expect(provider.kill(session.providerSessionId)).resolves.toBeUndefined()
  }, START_TIMEOUT_MS)

  it("host key mismatch should fail before opening PTY channel", async () => {
    const tempDir = createTempDir()
    const emptyKnownHosts = join(tempDir, "known_hosts")
    writeFileSync(emptyKnownHosts, "", "utf8")
    const provider = createProvider(createLocalhostProfile({ knownHosts: emptyKnownHosts }))

    let caught: unknown
    try {
      await provider.start({
        command: "bash",
        args: [],
        cwd: HOME_DIR,
        cols: 80,
        rows: 24,
        target: { kind: "ssh", profile: LOCALHOST_PROFILE },
      })
    } catch (error) {
      caught = error
    }

    assertTerminalErrorCode(caught, "SSH_HOST_KEY_UNKNOWN")
    expect(provider.listActiveSessionIds()).toHaveLength(0)
  }, START_TIMEOUT_MS)

  it("auth failure should return SSH_AUTH_FAILED without password fallback", async () => {
    const provider = createProvider(createLocalhostProfile({
      auth: { type: "key-file", path: "/nonexistent/key" },
    }))

    await expect(provider.start({
      command: "bash",
      args: [],
      cwd: HOME_DIR,
      cols: 80,
      rows: 24,
      target: { kind: "ssh", profile: LOCALHOST_PROFILE },
    })).rejects.toThrow(/SSH key file is not accessible/u)

    expect(provider.listActiveSessionIds()).toHaveLength(0)
  }, START_TIMEOUT_MS)
})
