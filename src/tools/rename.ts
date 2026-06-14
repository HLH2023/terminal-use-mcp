import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { Logger } from "../logger.js"
import type { SessionManager } from "../session-manager.js"
import { errorToToolResult, textContent } from "./tool-helpers.js"

export function registerRenameTool(server: McpServer, sm: SessionManager, logger: Logger): void {
  server.registerTool(
    "terminal.rename",
    {
      description: "Rename a terminal session label",
      inputSchema: {
        sessionId: z.string().describe("Session ID from terminal.start — use exact value"),
        label: z.string().describe("New session label"),
      },
    },
    async (input) => {
      try {
        await sm.rename(input.sessionId, input.label)
        logger.info("terminal.rename completed", { sessionId: input.sessionId, label: input.label })
        return {
          content: [textContent(`Renamed terminal session ${input.sessionId}`)],
          structuredContent: { ok: true },
        }
      } catch (err) {
        return errorToToolResult(err)
      }
    },
  )
}
