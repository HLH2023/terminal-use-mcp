import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { TranscriptEvent } from "../terminal/transcript.js"
import type { ProviderExecutor } from "./tool-helpers.js"
import { errorToToolResult, okToolResult } from "./tool-helpers.js"

export function registerEventsTool(server: McpServer, executor: ProviderExecutor): void {
  server.registerTool(
    "terminal.events",
    {
      description: "Read transcript events for a terminal session",
      inputSchema: {
        sessionId: z.string(),
        limit: z.number().int().min(0).max(500).default(50).optional(),
        sinceSeq: z.number().int().min(0).optional(),
      },
    },
    async (input) => {
      try {
        const result = executor.getEvents(input.sessionId, input.limit, input.sinceSeq)
        const output: { ok: true; events: TranscriptEvent[]; totalEvents: number; hasMore: boolean } = { ok: true, ...result }
        return okToolResult(
          `${output.events.length} events (total ${output.totalEvents}, hasMore=${output.hasMore})`,
          output,
        )
      } catch (err) {
        return errorToToolResult(err)
      }
    },
  )
}
