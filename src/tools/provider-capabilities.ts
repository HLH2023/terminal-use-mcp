import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { ProviderCapabilities, ProviderName, TerminalProvider } from "../providers/provider.js"
import { ProviderNotAvailableError, TerminalUseError } from "../terminal/errors.js"

type ToolTextContent = { type: "text"; text: string }
type ToolErrorResult = { content: ToolTextContent[]; isError: true }
type ProviderCapabilitiesOutput = { ok: true; capabilities: ProviderCapabilities }

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

export function registerProviderCapabilitiesTool(server: McpServer, providers: Map<ProviderName, TerminalProvider>): void {
  server.registerTool(
    "terminal.provider_capabilities",
    {
      description: "Return the declared capability matrix for a terminal provider",
      inputSchema: {
        provider: z.enum(["native-pty", "tmux", "ssh-pty", "ssh-tmux"]),
      },
    },
    async (input) => {
      try {
        const provider = providers.get(input.provider)
        if (provider === undefined) {
          throw new ProviderNotAvailableError(input.provider, "Provider is not registered")
        }

        const output: ProviderCapabilitiesOutput = { ok: true, capabilities: provider.capabilities }
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
