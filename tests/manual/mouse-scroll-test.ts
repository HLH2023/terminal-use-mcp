import { loadConfig } from "../../src/config.js"
import { createLogger } from "../../src/logger.js"
import { SessionManager } from "../../src/session-manager.js"
import { createAndRegisterProviders } from "../../src/providers/provider-registry.js"
import { loadHostsConfig } from "../../src/targets/ssh-host-config.js"
import { parseKeyExpr } from "../../src/terminal/keymap.js"
import type { ProviderName, TerminalProvider } from "../../src/providers/provider.js"
import type { TerminalTarget } from "../../src/targets/target-types.js"
import type { TerminalSnapshot } from "../../src/terminal/terminal-snapshot.js"

const PROJECT_ROOT = "/home/hlh/dev/homelab-terminal-use"
const TOOL_ROOT = `${PROJECT_ROOT}/tools/local/terminal-use-mcp`
const TEST_CWD = "/home/hlh/dev"
const HOSTS_CONFIG = `${TOOL_ROOT}/.config/hosts.json`
const LESS_FILE = "/etc/services"
const LESS_MOUSE_ENV: Record<string, string> = {
  // less 默认不一定启用 mouse tracking；显式启用后才能判断 provider 注入的滚轮事件是否被 TUI 消费。
  LESS: "--mouse",
}

const LESS_PROVIDERS: readonly ProviderName[] = ["native-pty", "tmux", "ssh-pty", "ssh-tmux"]
const OPENCODE_PROVIDERS: readonly ProviderName[] = ["native-pty", "tmux"]

type ProgramName = "less" | "opencode"
type ResultStatus = "changed" | "unchanged" | "unsupported" | "skipped" | "failed"

type MouseScrollResult = {
  program: ProgramName
  providerName: ProviderName
  supportsMouseScroll: boolean
  status: ResultStatus
  changed: boolean
  initialFirstLine?: string
  afterFirstLine?: string
  afterScrollBackFirstLine?: string
  reason?: string
}

type TestContext = {
  sm: SessionManager
  providers: ReadonlyMap<ProviderName, TerminalProvider>
  hasLocalhostProfile: boolean
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function appendCsvEnv(name: string, values: readonly string[]): void {
  const existing = process.env[name]?.split(",").map((part) => part.trim()).filter(Boolean) ?? []
  const merged = [...existing]
  for (const value of values) {
    if (!merged.includes(value)) merged.push(value)
  }
  process.env[name] = merged.join(",")
}

function configureManualTestEnv(): void {
  process.env.TERMINAL_USE_WORKSPACE_ROOT ??= PROJECT_ROOT
  process.env.TERMINAL_USE_HOSTS_CONFIG ??= HOSTS_CONFIG
  process.env.TERMINAL_USE_LOG_LEVEL ??= "warn"
  appendCsvEnv("TERMINAL_USE_ALLOWED_CWD", [PROJECT_ROOT, TOOL_ROOT, TEST_CWD, "/tmp"])
}

function firstLine(screen: string): string {
  return screen.split("\n").map((line) => line.trim()).find((line) => line.length > 0)?.slice(0, 80) ?? "(empty)"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function statusIcon(status: ResultStatus): string {
  switch (status) {
    case "changed": return "✅"
    case "unchanged": return "⚠️"
    case "unsupported": return "⚠️"
    case "skipped": return "⏭️"
    case "failed": return "❌"
  }
}

async function pressKey(provider: TerminalProvider, providerSessionId: string, keyExpr: string): Promise<void> {
  await provider.press(providerSessionId, keyExpr, parseKeyExpr(keyExpr))
}

async function sendMouseScroll(
  provider: TerminalProvider,
  providerSessionId: string,
  direction: "up" | "down",
  ticks: number,
): Promise<void> {
  if (!provider.capabilities.supportsMouseScroll || provider.mouseScroll === undefined) {
    return
  }

  const mouseScroll = provider.mouseScroll.bind(provider)
  for (let i = 0; i < ticks; i++) {
    await mouseScroll(providerSessionId, {
      col: 40,
      row: 8,
      direction,
    })
  }
}

async function cleanupSession(ctx: TestContext, sessionId: string | undefined, label: string): Promise<void> {
  if (sessionId === undefined) return
  try {
    const tracked = ctx.sm.getSession(sessionId)
    const provider = ctx.providers.get(tracked.providerName)
    if (provider !== undefined) {
      try {
        const snap = await provider.snapshot(tracked.providerSessionId, "viewport")
        if (snap.status !== "running" && snap.status !== "starting") {
          forgetManagedSession(ctx, sessionId)
          return
        }
      } catch {
        forgetManagedSession(ctx, sessionId)
        return
      }
    }
  } catch {
    return
  }

  try {
    await ctx.sm.kill(sessionId)
  } catch (error) {
    // 手动测试脚本里，TUI 可能已通过 q/ctrl+c 正常退出；这里仅做兜底清理，失败不覆盖测试结论。
    console.log(`  cleanup(${label}) ignored: ${errorMessage(error)}`)
  }
}

function forgetManagedSession(ctx: TestContext, sessionId: string): void {
  try {
    ctx.sm.removeSession(sessionId)
  } catch {
    return
  }
}

async function exitByKey(
  ctx: TestContext,
  provider: TerminalProvider,
  sessionId: string,
  providerSessionId: string,
  keyExpr: string,
): Promise<boolean> {
  try {
    await pressKey(provider, providerSessionId, keyExpr)
  } catch {
    return false
  }

  await sleep(900)
  try {
    const snap = await provider.snapshot(providerSessionId, "viewport")
    if (snap.status === "running" || snap.status === "starting") return false
    forgetManagedSession(ctx, sessionId)
    return true
  } catch {
    forgetManagedSession(ctx, sessionId)
    return true
  }
}

function targetForProvider(providerName: ProviderName, hasLocalhostProfile: boolean): TerminalTarget | undefined {
  if (providerName === "ssh-pty" || providerName === "ssh-tmux") {
    return hasLocalhostProfile ? { kind: "ssh", profile: "localhost" } : undefined
  }
  return undefined
}

function startupDelayFor(providerName: ProviderName, program: ProgramName): number {
  if (program === "opencode") return providerName === "tmux" ? 7_000 : 6_000
  if (providerName === "ssh-pty" || providerName === "ssh-tmux") return 4_000
  return 2_000
}

async function testLessMouseScroll(ctx: TestContext, providerName: ProviderName): Promise<MouseScrollResult> {
  const provider = ctx.providers.get(providerName)
  if (provider === undefined) {
    return { program: "less", providerName, supportsMouseScroll: false, status: "skipped", changed: false, reason: "provider not registered" }
  }

  const available = await provider.isAvailable()
  if (!available) {
    return { program: "less", providerName, supportsMouseScroll: provider.capabilities.supportsMouseScroll, status: "skipped", changed: false, reason: "provider unavailable" }
  }

  const target = targetForProvider(providerName, ctx.hasLocalhostProfile)
  if ((providerName === "ssh-pty" || providerName === "ssh-tmux") && target === undefined) {
    return { program: "less", providerName, supportsMouseScroll: provider.capabilities.supportsMouseScroll, status: "skipped", changed: false, reason: "localhost SSH profile not found" }
  }

  if (!provider.capabilities.supportsMouseScroll || provider.mouseScroll === undefined) {
    return { program: "less", providerName, supportsMouseScroll: provider.capabilities.supportsMouseScroll, status: "unsupported", changed: false, reason: "capabilities.supportsMouseScroll=false" }
  }

  let sessionId: string | undefined
  let exitedByKey = false
  try {
    const session = await ctx.sm.start({
      command: "less",
      args: [LESS_FILE],
      cwd: TEST_CWD,
      cols: 80,
      rows: 15,
      provider: providerName,
      env: LESS_MOUSE_ENV,
      ...(target !== undefined ? { target } : {}),
    })
    sessionId = session.sessionId
    await sleep(startupDelayFor(providerName, "less"))

    const tracked = ctx.sm.getSession(session.sessionId)
    const snap1 = await provider.snapshot(tracked.providerSessionId, "viewport")
    await sendMouseScroll(provider, tracked.providerSessionId, "down", 5)
    await sleep(700)
    const snap2 = await provider.snapshot(tracked.providerSessionId, "viewport")
    const changed = snap1.screen !== snap2.screen

    // 按用户要求，less 优先通过 q 正常退出；kill 只作为 cleanupSession 的兜底。
    exitedByKey = await exitByKey(ctx, provider, session.sessionId, tracked.providerSessionId, "q")

    return {
      program: "less",
      providerName,
      supportsMouseScroll: provider.capabilities.supportsMouseScroll,
      status: changed ? "changed" : "unchanged",
      changed,
      initialFirstLine: firstLine(snap1.screen),
      afterFirstLine: firstLine(snap2.screen),
    }
  } catch (error) {
    return {
      program: "less",
      providerName,
      supportsMouseScroll: provider.capabilities.supportsMouseScroll,
      status: "failed",
      changed: false,
      reason: errorMessage(error),
    }
  } finally {
    if (!exitedByKey) await cleanupSession(ctx, sessionId, `${providerName}:less`)
  }
}

async function snapshotAfterWait(provider: TerminalProvider, providerSessionId: string): Promise<TerminalSnapshot> {
  try {
    return await provider.waitStable(providerSessionId, { idleMs: 3_000, timeoutMs: 15_000, snapshotOnTimeout: true })
  } catch {
    return provider.snapshot(providerSessionId, "viewport")
  }
}

async function testOpencodeMouseScroll(ctx: TestContext, providerName: ProviderName): Promise<MouseScrollResult> {
  const provider = ctx.providers.get(providerName)
  if (provider === undefined) {
    return { program: "opencode", providerName, supportsMouseScroll: false, status: "skipped", changed: false, reason: "provider not registered" }
  }

  const available = await provider.isAvailable()
  if (!available) {
    return { program: "opencode", providerName, supportsMouseScroll: provider.capabilities.supportsMouseScroll, status: "skipped", changed: false, reason: "provider unavailable" }
  }

  if (!provider.capabilities.supportsMouseScroll || provider.mouseScroll === undefined) {
    return { program: "opencode", providerName, supportsMouseScroll: provider.capabilities.supportsMouseScroll, status: "unsupported", changed: false, reason: "capabilities.supportsMouseScroll=false" }
  }

  let sessionId: string | undefined
  let exitedByKey = false
  try {
    const session = await ctx.sm.start({
      command: "opencode",
      args: [],
      cwd: PROJECT_ROOT,
      cols: 100,
      rows: 28,
      provider: providerName,
    })
    sessionId = session.sessionId
    await sleep(startupDelayFor(providerName, "opencode"))

    const tracked = ctx.sm.getSession(session.sessionId)
    const snap1 = await snapshotAfterWait(provider, tracked.providerSessionId)
    await sendMouseScroll(provider, tracked.providerSessionId, "up", 5)
    await sleep(700)
    const snap2 = await provider.snapshot(tracked.providerSessionId, "viewport")
    await sendMouseScroll(provider, tracked.providerSessionId, "down", 5)
    await sleep(700)
    const snap3 = await provider.snapshot(tracked.providerSessionId, "viewport")
    const changed = snap1.screen !== snap2.screen || snap2.screen !== snap3.screen

    exitedByKey = await exitByKey(ctx, provider, session.sessionId, tracked.providerSessionId, "ctrl+c")

    return {
      program: "opencode",
      providerName,
      supportsMouseScroll: provider.capabilities.supportsMouseScroll,
      status: changed ? "changed" : "unchanged",
      changed,
      initialFirstLine: firstLine(snap1.screen),
      afterFirstLine: firstLine(snap2.screen),
      afterScrollBackFirstLine: firstLine(snap3.screen),
    }
  } catch (error) {
    return {
      program: "opencode",
      providerName,
      supportsMouseScroll: provider.capabilities.supportsMouseScroll,
      status: "failed",
      changed: false,
      reason: errorMessage(error),
    }
  } finally {
    if (!exitedByKey) await cleanupSession(ctx, sessionId, `${providerName}:opencode`)
  }
}

function printResult(result: MouseScrollResult): void {
  console.log(`  ${statusIcon(result.status)} ${result.providerName}: status=${result.status}, changed=${result.changed}, supportsMouseScroll=${result.supportsMouseScroll}`)
  if (result.initialFirstLine !== undefined) console.log(`     Initial first line: ${result.initialFirstLine}`)
  if (result.afterFirstLine !== undefined) console.log(`     After scroll first line: ${result.afterFirstLine}`)
  if (result.afterScrollBackFirstLine !== undefined) console.log(`     After scroll-back first line: ${result.afterScrollBackFirstLine}`)
  if (result.reason !== undefined) console.log(`     Reason: ${result.reason}`)
}

function printConclusion(lessResults: readonly MouseScrollResult[], opencodeResults: readonly MouseScrollResult[]): void {
  const lessChanged = lessResults.filter((result) => result.status === "changed")
  const lessNonChanged = lessResults.filter((result) => result.status !== "changed")
  const opencodeChanged = opencodeResults.filter((result) => result.status === "changed")

  console.log("\n=== Conclusion ===")
  if (lessChanged.length === LESS_PROVIDERS.length) {
    console.log("✅ less: mouse_scroll 对 4/4 provider 的 TUI viewport 均有效。")
  } else {
    console.log(`⚠️ less: mouse_scroll 仅 ${lessChanged.length}/${LESS_PROVIDERS.length} provider 出现 viewport 变化。`)
    for (const result of lessNonChanged) {
      console.log(`  - ${result.providerName}: ${result.status}${result.reason !== undefined ? ` (${result.reason})` : ""}`)
    }
  }

  if (opencodeChanged.length > 0) {
    console.log(`✅ opencode: ${opencodeChanged.map((result) => result.providerName).join(", ")} 观察到滚动导致的 viewport 变化。`)
  } else {
    console.log("⚠️ opencode: 本轮未观察到 viewport 变化；可能是初始界面无可滚动历史，需结合截图/人工观察复核。")
  }
}

async function main(): Promise<void> {
  configureManualTestEnv()
  const config = loadConfig()
  const logger = createLogger(config.logLevel)
  const sm = new SessionManager(config, logger)
  createAndRegisterProviders(sm, logger)
  sm.startTtlCleanup()

  try {
    const hostsConfig = await loadHostsConfig(config.hostsConfigPath)
    const ctx: TestContext = {
      sm,
      providers: sm.getProviders(),
      hasLocalhostProfile: hostsConfig.has("localhost"),
    }

    console.log("=== Mouse scroll manual integration test ===")
    console.log(`Hosts config: ${config.hostsConfigPath ?? "<default>"}`)
    console.log(`localhost SSH profile: ${ctx.hasLocalhostProfile ? "yes" : "no"}`)
    console.log(`less env: LESS=${LESS_MOUSE_ENV.LESS}`)

    console.log("\n=== less: 4 providers ===")
    const lessResults: MouseScrollResult[] = []
    for (const providerName of LESS_PROVIDERS) {
      const result = await testLessMouseScroll(ctx, providerName)
      lessResults.push(result)
      printResult(result)
    }

    console.log("\n=== opencode: native-pty + tmux ===")
    const opencodeResults: MouseScrollResult[] = []
    for (const providerName of OPENCODE_PROVIDERS) {
      const result = await testOpencodeMouseScroll(ctx, providerName)
      opencodeResults.push(result)
      printResult(result)
    }

    printConclusion(lessResults, opencodeResults)
  } finally {
    await sm.killAllSessions()
    sm.stopTtlCleanup()
  }
}

main().catch((error: unknown) => {
  console.error(errorMessage(error))
  process.exitCode = 1
})
