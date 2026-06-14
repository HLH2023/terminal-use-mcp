/** terminal.find — 在当前屏幕或 scrollback 中查找文本/正则匹配。 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { Logger } from "../logger.js"
import type { FindResult } from "../providers/provider.js"
import type { ProviderExecutor } from "./tool-helpers.js"
import { errorToToolResult, okToolResult } from "./tool-helpers.js"

type FindToolOutput = {
  ok: true
  matches: FindResult[]
}

export function registerFindTool(server: McpServer, executor: ProviderExecutor, logger: Logger): void {
  server.registerTool(
    "terminal.find",
    {
      description: "Find pattern in terminal screen; pattern is a regex when regex=true.",
      inputSchema: {
        sessionId: z.string().min(1).describe("Session ID from terminal.start — use exact value"),
        pattern: z.string().min(1).describe("Search pattern; treated as regex pattern when regex=true"),
        regex: z.boolean().optional().describe("Treat pattern as a regular expression"),
        includeScrollback: z.boolean().optional().describe("Search provider scrollback when supported"),
      },
    },
    async (input) => {
      try {
        const matches = await executor.executeFind(input.sessionId, input.pattern, input.regex, input.includeScrollback)
        const output: FindToolOutput = { ok: true, matches }
        logger.debug("terminal find completed", { sessionId: input.sessionId, matches: matches.length })
        return okToolResult(`Found ${matches.length} match(es) in ${input.sessionId}`, output)
      } catch (err) {
        return errorToToolResult(err)
      }
    },
  )
}
