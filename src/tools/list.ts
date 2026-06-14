import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import type { Logger } from "../logger.js"
import type { SessionManager } from "../session-manager.js"
import { errorToToolResult, sessionToPublicInfo, textContent } from "./tool-helpers.js"

export function registerListTool(server: McpServer, sm: SessionManager, logger: Logger): void {
  server.registerTool(
    "terminal.list",
    {
      description: "List active terminal sessions",
      inputSchema: {},
    },
    async () => {
      try {
        const sessions = sm.listSessions().map(sessionToPublicInfo)
        logger.debug("terminal.list completed", { count: sessions.length })
        return {
          content: [textContent(`Found ${sessions.length} terminal session(s)`)],
          structuredContent: { ok: true, sessions },
        }
      } catch (err) {
        return errorToToolResult(err)
      }
    },
  )
}
