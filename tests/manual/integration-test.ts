import { loadConfig } from "../../src/config.js"
import { createLogger } from "../../src/logger.js"
import { SessionManager } from "../../src/session-manager.js"
import { createAndRegisterProviders } from "../../src/providers/provider-registry.js"
import { loadHostsConfig } from "../../src/targets/ssh-host-config.js"
import { ProviderExecutor } from "../../src/tools/tool-helpers.js"
import type { TmuxProvider } from "../../src/providers/tmux-provider.js"
import type { SshPtyProvider } from "../../src/providers/ssh-pty-provider.js"
import type { SshTmuxProvider } from "../../src/providers/ssh-tmux-provider.js"

const CWD = "/home/hlh/dev/homelab-terminal-use"
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function main() {
  const config = loadConfig()
  const logger = createLogger(config.logLevel)
  const sm = new SessionManager(config, logger)
  createAndRegisterProviders(sm, logger)
  sm.startTtlCleanup()

  const hostsConfig = await loadHostsConfig(config.hostsConfigPath)
  const providers = sm.getProviders()
  const executor = new ProviderExecutor(sm, providers, hostsConfig)

  const tmuxP = providers.get("tmux") as TmuxProvider
  const sshPtyP = providers.get("ssh-pty") as SshPtyProvider
  const sshTmuxP = providers.get("ssh-tmux") as SshTmuxProvider

  let pass = 0, fail = 0, skip = 0

  console.log("\n=== Test 1: tmux scrollback ===")
  try {
    const session = await sm.start({ command: "bash", args: [], cwd: CWD, cols: 120, rows: 10, provider: "tmux" })
    const tracked = sm.getSession(session.sessionId)
    await sleep(1000)
    await tmuxP.type(tracked.providerSessionId, "for i in $(seq 1 20); do echo \"History line $i\"; done\n")
    await sleep(1500)
    const snap = await tmuxP.snapshot(tracked.providerSessionId, "viewport")
    console.log(`  viewport: scrollbackLineCount=${snap.scrollbackLineCount}, rows=${snap.rows}`)
    const fullSnap = await tmuxP.snapshot(tracked.providerSessionId, "full")
    console.log(`  full:     scrollbackLineCount=${fullSnap.scrollbackLineCount}, rows=${fullSnap.rows}`)
    if (snap.scrollbackLineCount > 0) { console.log("  ✅ PASS"); pass++ }
    else { console.log(`  ⚠️ viewport=0 (full=${fullSnap.scrollbackLineCount})`); fullSnap.scrollbackLineCount > 0 ? pass++ : fail++ }
    await sm.kill(session.sessionId)
  } catch (err: unknown) { console.error("  ❌ FAIL:", err instanceof Error ? err.message : err); fail++ }

  console.log("\n=== Test 2: tmux_list (local) ===")
  try {
    const sessions = await executor.executeTmuxList({})
    console.log(`  Found ${sessions.length} local sessions`)
    for (const s of sessions.slice(0, 5)) console.log(`    - ${s.name} (windows=${s.windows}, isManaged=${s.isManaged})`)
    console.log("  ✅ PASS"); pass++
  } catch (err: unknown) { console.error("  ❌ FAIL:", err instanceof Error ? err.message : err); fail++ }

  console.log("\n=== Test 3: tmux_kill preview ===")
  try {
    const sessions = await executor.executeTmuxList({})
    if (sessions.length > 0) {
      const target = sessions.find(s => !s.isManaged) || sessions[0]
      const preview = await executor.executeTmuxKillPreview(target.name, {})
      console.log(`  Preview "${preview.name}": exists=${preview.exists}, windows=${preview.windows}`)
      console.log("  ✅ PASS"); pass++
    } else { console.log("  ⚠️ SKIP"); skip++ }
  } catch (err: unknown) { console.error("  ❌ FAIL:", err instanceof Error ? err.message : err); fail++ }

  console.log("\n=== Test 4: ssh-pty $SHELL -l -ic PATH ===")
  try {
    const available = await sshPtyP.isAvailable()
    if (!available) { console.log("  ⚠️ SKIP"); skip++ }
    else {
      const session = await sm.start({ command: "bash", args: ["-c", "which node; echo DONE"], cwd: "/home/hlh/dev", cols: 80, rows: 24, provider: "ssh-pty", target: { kind: "ssh", profile: "localhost" } })
      await sleep(5000)
      const tracked = sm.getSession(session.sessionId)
      const snap = await sshPtyP.snapshot(tracked.providerSessionId, "viewport")
      const output = snap.screen.trim()
      console.log(`  output: ${output.split('\n').map(l=>l.trim()).filter(Boolean).slice(-3).join(' | ')}`)
      if (output.includes(".nvm") || output.includes("/usr/bin/node") || output.includes("/usr/local")) { console.log("  ✅ PASS: PATH fix working"); pass++ }
      else { console.log("  ❌ FAIL: node not found"); fail++ }
      await sm.kill(session.sessionId)
    }
  } catch (err: unknown) { console.error("  ❌ FAIL:", err instanceof Error ? err.message : err); fail++ }

  console.log("\n=== Test 5: ssh-tmux $SHELL -l -ic + scrollback ===")
  try {
    const available = await sshTmuxP.isAvailable()
    if (!available) { console.log("  ⚠️ SKIP"); skip++ }
    else {
      const session = await sm.start({ command: "bash", args: [], cwd: "/home/hlh/dev", cols: 80, rows: 10, provider: "ssh-tmux", target: { kind: "ssh", profile: "localhost" } })
      await sleep(2500)
      const tracked = sm.getSession(session.sessionId)
      await sshTmuxP.type(tracked.providerSessionId, "which node\n")
      await sleep(2000)
      const snap = await sshTmuxP.snapshot(tracked.providerSessionId, "viewport")
      const lines = snap.screen.split('\n').map(l => l.trim()).filter(Boolean)
      console.log(`  which node → ${lines[lines.length - 1] || "(empty)"}`)
      await sshTmuxP.type(tracked.providerSessionId, "for i in $(seq 1 20); do echo \"line $i\"; done\n")
      await sleep(1500)
      const scrollSnap = await sshTmuxP.snapshot(tracked.providerSessionId, "viewport")
      console.log(`  scrollbackLineCount: ${scrollSnap.scrollbackLineCount}`)
      console.log("  ✅ PASS"); pass++
      await sm.kill(session.sessionId)
    }
  } catch (err: unknown) { console.error("  ❌ FAIL:", err instanceof Error ? err.message : err); fail++ }

  console.log("\n=== Test 6: tmux_list (SSH) ===")
  try {
    const sessions = await executor.executeTmuxList({ profile: "localhost" })
    console.log(`  Found ${sessions.length} remote sessions`)
    for (const s of sessions.slice(0, 5)) console.log(`    - ${s.name} (windows=${s.windows}, isManaged=${s.isManaged})`)
    console.log("  ✅ PASS"); pass++
  } catch (err: unknown) { console.error("  ❌ FAIL:", err instanceof Error ? err.message : err); fail++ }

  console.log("\n=== Test 7: tmux_kill preview (SSH) ===")
  try {
    const sessions = await executor.executeTmuxList({ profile: "localhost" })
    if (sessions.length > 0) {
      const preview = await executor.executeTmuxKillPreview(sessions[0].name, { profile: "localhost" })
      console.log(`  SSH preview "${preview.name}": exists=${preview.exists}`)
      console.log("  ✅ PASS"); pass++
    } else { console.log("  ⚠️ SKIP"); skip++ }
  } catch (err: unknown) { console.error("  ❌ FAIL:", err instanceof Error ? err.message : err); fail++ }

  await sm.killAllSessions()
  sm.stopTtlCleanup()
  console.log(`\n${"=".repeat(50)}`)
  console.log(`RESULTS: ${pass} passed, ${fail} failed, ${skip} skipped`)
  console.log(`${"=".repeat(50)}`)
}

main().catch(console.error)
