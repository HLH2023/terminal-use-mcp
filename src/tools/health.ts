import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import type { ProviderName, TerminalProvider } from "../providers/provider.js"
import { TerminalUseError } from "../terminal/errors.js"

type ToolTextContent = { type: "text"; text: string }
type ToolErrorResult = { content: ToolTextContent[]; isError: true }
type ProviderHealth = { available: boolean; reason?: string }
type HealthOutput = {
  ok: true
  version: string
  status: "ok" | "degraded"
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
  version = "0.1.0",
): void {
  server.registerTool(
    "terminal.health",
    {
      description: "Check terminal-use-mcp server health and provider availability",
      inputSchema: {},
    },
    async () => {
      try {
        const providerHealth = await buildProviderHealth(providers, disabledProviders)
        const hasAvailableProvider = Object.values(providerHealth).some((entry) => entry.available)
        const output: HealthOutput = {
          ok: true,
          version,
          status: hasAvailableProvider ? "ok" : "degraded",
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
