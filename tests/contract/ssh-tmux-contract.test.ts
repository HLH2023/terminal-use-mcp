import { execSync } from "node:child_process"
import { homedir } from "node:os"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { Logger } from "../../src/logger.js"
import { SshTmuxProvider } from "../../src/providers/ssh-tmux-provider.js"
import type { SshHostProfile } from "../../src/targets/target-types.js"
import { parseKeyExpr } from "../../src/terminal/keymap.js"

// SSH guard 必须使用 BatchMode，避免测试挂在密码或 passphrase 提示上。
const SSH_E2E_AVAILABLE = (() => {
  try {
    execSync("ssh -o BatchMode=yes -o ConnectTimeout=3 -o StrictHostKeyChecking=accept-new hlh@localhost echo ok", {
      timeout: 5_000,
      stdio: "pipe",
    })
    return true
  } catch {
    return false
  }
})()

// ssh-tmux 依赖远端 tmux；localhost e2e 中本机与远端是同一台机器。
const TMUX_AVAILABLE = (() => {
  try {
    execSync("which tmux", { stdio: "pipe" })
    return true
  } catch {
    return false
  }
})()

const logger = {
  debug: vi.fn<Logger["debug"]>(),
  info: vi.fn<Logger["info"]>(),
  warn: vi.fn<Logger["warn"]>(),
  error: vi.fn<Logger["error"]>(),
  setLevel: vi.fn<Logger["setLevel"]>(),
} satisfies Logger

let providerForCleanup: SshTmuxProvider | undefined
const startedSessionIds = new Set<string>()

function createLocalhostProfile(): SshHostProfile {
  const home = homedir()

  return {
    name: "localhost",
    host: "localhost",
    port: 22,
    username: "hlh",
    auth: { type: "key-file", path: `${home}/.ssh/id_rsa` },
    knownHosts: `${home}/.ssh/known_hosts`,
    defaultCwd: home,
    remoteAllowedCwd: [home, "/tmp"],
    remoteDeniedCwd: ["/", "/root", "/etc"],
    allowTmux: true,
    connectTimeoutMs: 10_000,
    keepaliveIntervalMs: 15_000,
  }
}

function createProvider(): SshTmuxProvider {
  const provider = new SshTmuxProvider(logger, {
    hostsConfig: new Map([["localhost", createLocalhostProfile()]]),
  })
  providerForCleanup = provider
  return provider
}

function expectShellPrompt(screen: string): void {
  const visibleScreen = screen.trim()

  // 不假设用户 PS1 的完整形态；只要求快照中已有可见交互提示内容，并包含常见 prompt 结尾符。
  expect(visibleScreen.length).toBeGreaterThan(0)
  expect(visibleScreen).toMatch(/[$#>%❯❱]\s*$/m)
}

describe.skipIf(!SSH_E2E_AVAILABLE || !TMUX_AVAILABLE)("ssh-tmux provider contract", () => {
  afterEach(async () => {
    const provider = providerForCleanup
    if (provider !== undefined) {
      const sessionIds = new Set([...startedSessionIds, ...provider.listActiveSessionIds()])

      for (const sessionId of sessionIds) {
        if (!provider.hasSession(sessionId)) continue

        try {
          await provider.kill(sessionId)
        } catch (error) {
          // cleanup 只能尽力而为：测试断言失败时仍要继续释放后续 session，避免远端 tmux 残留。
          logger.warn("ssh-tmux e2e cleanup failed", {
            sessionId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    startedSessionIds.clear()
    providerForCleanup = undefined
    vi.clearAllMocks()
  })

  it("start remote tmux → snapshot → type → press enter → wait_for_text → attach → kill", async () => {
    const provider = createProvider()
    const home = homedir()

    const session = await provider.start({
      command: "bash",
      args: [],
      cwd: home,
      cols: 80,
      rows: 24,
      target: { kind: "ssh", profile: "localhost" },
    })
    startedSessionIds.add(session.providerSessionId)

    // tmux new-session 返回后 shell prompt 仍可能需要一次调度才能写入 pane。
    await new Promise((resolve) => setTimeout(resolve, 1_000))

    const initialSnapshot = await provider.snapshot(session.providerSessionId)
    expect(initialSnapshot.status).toBe("running")
    expectShellPrompt(initialSnapshot.screen)

    await provider.type(session.providerSessionId, "echo HELLO_TMUX_SSH")
    await provider.press(session.providerSessionId, "enter", parseKeyExpr("enter"))

    const outputSnapshot = await provider.waitForText(session.providerSessionId, "HELLO_TMUX_SSH", {
      text: "HELLO_TMUX_SSH",
      timeoutMs: 10_000,
    })
    expect(outputSnapshot.screen).toContain("HELLO_TMUX_SSH")

    const attached = await provider.attach(session.providerSessionId)
    expect(attached.sessionId).toBe(session.sessionId)
    expect(attached.providerSessionId).toBe(session.providerSessionId)

    await expect(provider.kill(session.providerSessionId)).resolves.toBeUndefined()
    startedSessionIds.delete(session.providerSessionId)
  }, 30_000)
})
