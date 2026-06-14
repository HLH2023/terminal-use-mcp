import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { ProviderExecutor } from "./tool-helpers.js"
import { errorToToolResult, okToolResult } from "./tool-helpers.js"

type SignalName = "SIGINT" | "SIGTERM" | "SIGKILL"

export function registerSendSignalTool(server: McpServer, executor: ProviderExecutor): void {
  server.registerTool(
    "terminal.send_signal",
    {
      description: "Send a signal semantic to a terminal session process",
      inputSchema: {
        sessionId: z.string().describe("Session ID from terminal.start — use exact value"),
        signal: z.enum(["SIGINT", "SIGTERM", "SIGKILL"]),
      },
    },
    async (input) => {
      try {
        await executor.executeSendSignal(input.sessionId, input.signal)
        const output: { ok: true; signal: SignalName; sessionId: string } = { ok: true, signal: input.signal, sessionId: input.sessionId }
        return okToolResult(
          `Sent ${input.signal} to session ${input.sessionId}`,
          output,
        )
      } catch (err) {
        return errorToToolResult(err)
      }
    },
  )
}
