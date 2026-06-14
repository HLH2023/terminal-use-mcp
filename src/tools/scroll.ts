/** terminal.scroll — 滚动终端视图。 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { Logger } from "../logger.js"
import type { ScrollDirection } from "../providers/provider.js"
import type { ProviderExecutor } from "./tool-helpers.js"
import { errorToToolResult, okToolResult } from "./tool-helpers.js"

type ScrollToolOutput = {
  ok: true
}

export function registerScrollTool(server: McpServer, executor: ProviderExecutor, logger: Logger): void {
  server.registerTool(
    "terminal.scroll",
    {
      description: "Scroll terminal viewport up or down by a number of lines.",
      inputSchema: {
        sessionId: z.string().min(1).describe("Session ID from terminal.start — use exact value"),
        direction: z.enum(["up", "down"]).describe("Scroll direction"),
        lines: z.number().int().positive().describe("Number of lines to scroll"),
      },
    },
    async (input) => {
      try {
        const direction: ScrollDirection = input.direction
        await executor.executeScroll(input.sessionId, direction, input.lines)
        const output: ScrollToolOutput = { ok: true }
        logger.debug("terminal scrolled", { sessionId: input.sessionId, direction, lines: input.lines })
        return okToolResult(`Scrolled ${input.sessionId} ${direction} by ${input.lines} line(s)`, output)
      } catch (err) {
        return errorToToolResult(err)
      }
    },
  )
}
