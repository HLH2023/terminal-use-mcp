import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { Logger } from "../logger.js"
import type { SessionManager } from "../session-manager.js"
import { errorToToolResult, textContent } from "./tool-helpers.js"

export function registerKillTool(server: McpServer, sm: SessionManager, logger: Logger): void {
  server.registerTool(
    "terminal.kill",
    {
      description: "Kill a terminal session",
      inputSchema: {
        sessionId: z.string().describe("Session ID from terminal.start — use exact value"),
      },
    },
    async (input) => {
      try {
        await sm.kill(input.sessionId)
        logger.info("terminal.kill completed", { sessionId: input.sessionId })
        return {
          content: [textContent(`Killed terminal session ${input.sessionId}`)],
          structuredContent: { ok: true },
        }
      } catch (err) {
        return errorToToolResult(err)
      }
    },
  )
}
