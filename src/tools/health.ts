import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import type { TerminalUseConfig } from "../config.js"
import type { ProviderName, TerminalProvider } from "../providers/provider.js"
import type { SshHostProfile } from "../targets/target-types.js"
import type { ToolRegistryResult } from "./tool-registry.js"
import { TerminalUseError } from "../terminal/errors.js"

type ToolTextContent = { type: "text"; text: string }
type ToolErrorResult = { content: ToolTextContent[]; isError: true }
type ProviderHealth = { available: boolean; reason?: string }

/** 安全策略摘要 */
type SecuritySummary = {
  /** 非沙箱环境 */
  notSandbox: boolean
  /** 面向开发的设计 */
  developmentFocused: boolean
  /** CWD 策略模式 */
  cwdPolicyMode: string
  /** 密钥环境变量策略 */
  secretEnvPolicy: string
  /** 是否允许内联 SSH 目标 */
  inlineSshTargetsAllowed: boolean
  /** Session ID 匹配模式 */
  sessionIdMatchMode: string
}

/** terminal.health 工具的完整输出类型（v0.2.0） */
type HealthOutput = {
  ok: true
  version: string
  /** 发布状态：tagged release 为 "stable"，否则为 "dev" */
  releaseState: "stable" | "dev"
  status: "ok" | "degraded"
  /** 用户侧能力预设 */
  capabilityPreset: string
  /** 用户侧工具配置 */
  toolProfile: string
  /** 当前 server 实例已注册的工具 */
  registeredTools: string[]
  /** 被配置禁用的工具 */
  disabledTools: string[]
  /** 配置警告（未知工具名等） */
  configWarnings: string[]
  /** 已注册且可用的内部后端 */
  registeredInternalBackends: ProviderName[]
  /** 被禁用的内部后端 */
  disabledInternalBackends: ProviderName[]
  /** 是否启用远程 SSH 能力 */
  remoteCapabilityEnabled: boolean
  /** 已配置的 SSH profile 数量 */
  sshProfilesCount: number
  /** 安全策略摘要 */
  securitySummary: SecuritySummary
  /** Provider 健康详情（内部后端） */
  providers: Record<ProviderName, ProviderHealth>
}

function errorToToolResult(err: unknown): ToolErrorResult {
  if (err instanceof TerminalUseError) {
    const envelope = err.toEnvelope()
    return { content: [{ type: "text", text: JSON.stringify(envelope) }], isError: true }
  }
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, error: { code: "INTERNAL_ERROR", message: String(err), retryable: false } }) }],
    isError: true,
  }
}

const PROVIDER_NAMES: ProviderName[] = ["native-pty", "tmux", "ssh-pty", "ssh-tmux"]

export function registerHealthTool(
  server: McpServer,
  providers: Map<ProviderName, TerminalProvider>,
  disabledProviders: Set<ProviderName>,
  version: string,
  config: TerminalUseConfig,
  toolRegistry: ToolRegistryResult,
  hostsConfig: Map<string, SshHostProfile>,
): void {
  server.registerTool(
    "terminal.health",
    {
      description: "Check terminal-use-mcp server health, configuration, and provider availability",
      inputSchema: {},
    },
    async () => {
      try {
        const providerHealth = await buildProviderHealth(providers, disabledProviders)
        const hasAvailableProvider = Object.values(providerHealth).some((entry) => entry.available)

        // 计算已注册/被禁用的内部后端
        const registeredInternalBackends = PROVIDER_NAMES.filter((name) => !disabledProviders.has(name) && providers.has(name))
        const disabledInternalBackends = PROVIDER_NAMES.filter((name) => disabledProviders.has(name) || !providers.has(name))

        // 远程能力 = 任意 SSH provider 可用
        const remoteCapabilityEnabled = registeredInternalBackends.some((name) => name === "ssh-pty" || name === "ssh-tmux")

        const output: HealthOutput = {
          ok: true,
          version,
          releaseState: version.includes("-") ? "dev" : "stable",
          status: hasAvailableProvider ? "ok" : "degraded",
          capabilityPreset: config.capabilityPreset,
          toolProfile: config.toolProfile,
          registeredTools: toolRegistry.registeredTools,
          disabledTools: toolRegistry.disabledTools,
          configWarnings: toolRegistry.configWarnings,
          registeredInternalBackends,
          disabledInternalBackends,
          remoteCapabilityEnabled,
          sshProfilesCount: hostsConfig.size,
          securitySummary: {
            notSandbox: true,
            developmentFocused: true,
            cwdPolicyMode: config.cwdPolicyMode,
            secretEnvPolicy: config.secretEnvPolicy,
            inlineSshTargetsAllowed: config.allowInlineSshTargets,
            sessionIdMatchMode: config.sessionIdMatchMode,
          },
          providers: providerHealth,
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (err) {
        return errorToToolResult(err)
      }
    },
  )
}

async function buildProviderHealth(
  providers: Map<ProviderName, TerminalProvider>,
  disabledProviders: Set<ProviderName>,
): Promise<Record<ProviderName, ProviderHealth>> {
  const entries = await Promise.all(PROVIDER_NAMES.map(async (providerName): Promise<[ProviderName, ProviderHealth]> => {
    if (disabledProviders.has(providerName)) {
      return [providerName, { available: false, reason: "disabled by TERMINAL_USE_PROVIDERS config" }]
    }

    const provider = providers.get(providerName)
    if (provider === undefined) {
      return [providerName, { available: false, reason: "not registered" }]
    }

    try {
      const available = await provider.isAvailable()
      return [providerName, available ? { available } : { available, reason: "provider dependency unavailable" }]
    } catch (err) {
      return [providerName, { available: false, reason: err instanceof Error ? err.message : String(err) }]
    }
  }))

  return Object.fromEntries(entries) as Record<ProviderName, ProviderHealth>
}
