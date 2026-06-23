/**
 * MCP Server 工厂 — 创建 McpServer 实例并根据配置动态注册 tools + resources + prompts。
 *
 * 由 index.ts 调用 createMcpServer(sm, config, hostsConfig, logger)，
 * 返回已就绪的 McpServer 实例，只需连接 StdioServerTransport 即可启动。
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import type { SessionManager } from "./session-manager.js"
import type { TerminalUseConfig } from "./config.js"
import type { Logger } from "./logger.js"
import type { AuditLogger } from "./audit-log.js"
import type { ProviderName, TerminalProvider } from "./providers/provider.js"
import type { SshHostProfile } from "./targets/target-types.js"
import { ProviderExecutor } from "./tools/tool-helpers.js"
import { resolveEnabledTools } from "./tools/tool-registry.js"
import { VERSION } from "./version.js"

// ── 22 Session tools ───────────────────────────────────────────
import { registerStartTool } from "./tools/start.js"
import { registerAttachTool } from "./tools/attach.js"
import { registerListTool } from "./tools/list.js"
import { registerInfoTool } from "./tools/info.js"
import { registerRenameTool } from "./tools/rename.js"
import { registerKillTool } from "./tools/kill.js"
import { registerCleanupTool } from "./tools/cleanup.js"

import { registerSnapshotTool } from "./tools/snapshot.js"
import { registerWaitForTextTool } from "./tools/wait-for-text.js"
import { registerWaitStableTool } from "./tools/wait-stable.js"
import { registerFindTool } from "./tools/find.js"
import { registerScrollTool } from "./tools/scroll.js"
import { registerTypeTool } from "./tools/type.js"
import { registerPressTool } from "./tools/press.js"
import { registerPasteTool } from "./tools/paste.js"
import { registerMouseClickTool } from "./tools/mouse-click.js"
import { registerMouseScrollTool } from "./tools/mouse-scroll.js"

import { registerResizeTool } from "./tools/resize.js"
import { registerExportTranscriptTool } from "./tools/export-transcript.js"
import { registerHealthTool } from "./tools/health.js"
import { registerKeysTool } from "./tools/keys.js"
import { registerProviderCapabilitiesTool } from "./tools/provider-capabilities.js"
import { registerEventsTool } from "./tools/events.js"
import { registerSendSignalTool } from "./tools/send-signal.js"

// ── 3 Remote target tools ─────────────────────────────────────
import { registerTargetsTool } from "./tools/targets.js"
import { registerTargetInfoTool } from "./tools/target-info.js"
import { registerVerifyTargetTool } from "./tools/verify-target.js"

// ── 3 Tmux management tools ──────────────────────────────────
import { registerTmuxListTool } from "./tools/tmux-list.js"
import { registerTmuxKillTool } from "./tools/tmux-kill.js"
import { registerTmuxCommandTool } from "./tools/tmux-command.js"

// ── 2 resources ───────────────────────────────────────────────
import { registerSessionsResource } from "./resources/sessions-resource.js"
import { registerTranscriptResource } from "./resources/transcript-resource.js"

// ── 2 prompts ─────────────────────────────────────────────────
import { registerTerminalUseWorkflowPrompt } from "./prompts/terminal-use-workflow.js"
import { registerExternalAgentControlPrompt } from "./prompts/external-agent-control.js"

/**
 * 创建并配置完整的 MCP Server 实例。
 *
 * @param sm      已完成 provider 注册的 SessionManager
 * @param config  终端配置（主要取 artifactDir）
 * @param hostsConfig SSH hosts.json 加载后的安全 profile Map
 * @param logger  stderr 日志
 */
export function createMcpServer(
  sm: SessionManager,
  config: TerminalUseConfig,
  hostsConfig: Map<string, SshHostProfile>,
  logger: Logger,
  auditLogger: AuditLogger,
): McpServer {
  const server = new McpServer({
    name: "terminal-use-mcp",
    version: VERSION,
  })

  /* ── 构建 ProviderExecutor ──
   * SessionManager.getProviders() 返回 ReadonlyMap<ProviderName, TerminalProvider>，
   * ProviderExecutor 构造函数接受 ReadonlyMap<string, TerminalProvider>，
   * 二者类型兼容（ProviderName 是 string 的子类型）。 */
  const providers = sm.getProviders()
  const executor = new ProviderExecutor(sm, providers, undefined, auditLogger)

  /* health / provider_capabilities 需要可变 Map<ProviderName, TerminalProvider>，
   * 从 ReadonlyMap 构造一份可变副本。 */
  const mutableProviders = new Map<ProviderName, TerminalProvider>(providers)

  const ALL_PROVIDER_NAMES: ProviderName[] = ["native-pty", "tmux", "ssh-pty", "ssh-tmux"]
  const enabledSet = config.enabledProviders.length > 0
    ? new Set(config.enabledProviders)
    : null
  const disabledProviders = new Set<ProviderName>(
    enabledSet
      ? ALL_PROVIDER_NAMES.filter((n) => !enabledSet.has(n))
      : [],
  )

  // 解析工具集
  const toolRegistry = resolveEnabledTools({
    toolProfile: config.toolProfile,
    capabilityPreset: config.capabilityPreset,
    enabledTools: config.enabledTools,
    extraTools: config.extraTools,
    disabledTools: config.disabledTools,
  })
  const enabledToolSet = new Set(toolRegistry.registeredTools)

  if (toolRegistry.configWarnings.length > 0) {
    for (const w of toolRegistry.configWarnings) {
      logger.warn(w)
    }
  }

  // Helper: only register if tool is enabled
  const registerIf = (name: string, fn: () => void): void => {
    if (enabledToolSet.has(name)) fn()
  }

  // ── Session lifecycle (7) ──
  registerIf("terminal.start", () => registerStartTool(server, sm, logger, config))
  registerIf("terminal.attach", () => registerAttachTool(server, sm, logger))
  registerIf("terminal.list", () => registerListTool(server, sm, logger))
  registerIf("terminal.info", () => registerInfoTool(server, sm, logger))
  registerIf("terminal.rename", () => registerRenameTool(server, sm, logger))
  registerIf("terminal.kill", () => registerKillTool(server, sm, logger))
  registerIf("terminal.cleanup", () => registerCleanupTool(server, sm, logger))

  // ── Observation + Input (10) ──
  registerIf("terminal.snapshot", () => registerSnapshotTool(server, executor, logger))
  registerIf("terminal.wait_for_text", () => registerWaitForTextTool(server, executor, logger))
  registerIf("terminal.wait_stable", () => registerWaitStableTool(server, executor, logger))
  registerIf("terminal.find", () => registerFindTool(server, executor, logger))
  registerIf("terminal.scroll", () => registerScrollTool(server, executor, logger))
  registerIf("terminal.type", () => registerTypeTool(server, executor, logger))
  registerIf("terminal.press", () => registerPressTool(server, executor, logger))
  registerIf("terminal.paste", () => registerPasteTool(server, executor, logger, config))
  registerIf("terminal.mouse_click", () => registerMouseClickTool(server, executor, logger))
  registerIf("terminal.mouse_scroll", () => registerMouseScrollTool(server, executor, logger))

  // ── Meta (7) ──
  registerIf("terminal.resize", () => registerResizeTool(server, executor))
  registerIf("terminal.export_transcript", () => registerExportTranscriptTool(server, sm, config.artifactDir))
  // terminal.health 始终注册（resolveEnabledTools 保证其始终在 registeredTools 中）
  registerHealthTool(server, mutableProviders, disabledProviders, VERSION, config, toolRegistry, hostsConfig)
  registerIf("terminal.keys", () => registerKeysTool(server))
  registerIf("terminal.provider_capabilities", () => registerProviderCapabilitiesTool(server, mutableProviders))
  registerIf("terminal.events", () => registerEventsTool(server, executor))
  registerIf("terminal.send_signal", () => registerSendSignalTool(server, executor))

  // ── Remote targets (3) ──
  registerIf("terminal.targets", () => registerTargetsTool(server, hostsConfig, logger))
  registerIf("terminal.target_info", () => registerTargetInfoTool(server, hostsConfig, logger))
  registerIf("terminal.verify_target", () => registerVerifyTargetTool(server, sm, hostsConfig, logger))

  // ── Tmux management (3) ──
  registerIf("terminal.tmux_list", () => registerTmuxListTool(server, executor, logger, hostsConfig))
  registerIf("terminal.tmux_kill", () => registerTmuxKillTool(server, executor, logger, hostsConfig))
  registerIf("terminal.tmux_command", () => registerTmuxCommandTool(server, sm, config, auditLogger))

  // ── Resources (2) ──
  registerSessionsResource(server, sm)
  registerTranscriptResource(server, sm)

  // ── Prompts (2) ──
  registerTerminalUseWorkflowPrompt(server)
  registerExternalAgentControlPrompt(server)

  logger.info("MCP server configured", {
    tools: toolRegistry.registeredTools.length,
    resources: 2,
    prompts: 2,
  })

  return server
}
