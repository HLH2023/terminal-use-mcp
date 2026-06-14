/** terminal.type — 向终端输入普通文本，不自动追加 Enter。 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { Logger } from "../logger.js"
import type { ProviderExecutor } from "./tool-helpers.js"
import { errorToToolResult, okToolResult } from "./tool-helpers.js"

type TypeToolOutput = {
  ok: true
}

export function registerTypeTool(server: McpServer, executor: ProviderExecutor, logger: Logger): void {
  server.registerTool(
    "terminal.type",
    {
      description: "Type text into a terminal session. Does not append Enter automatically.",
      inputSchema: {
        sessionId: z.string().min(1).describe("Session ID from terminal.start — use exact value"),
        text: z.string().describe("Text to type into the terminal"),
      },
    },
    async (input) => {
      try {
        await executor.executeType(input.sessionId, input.text)
        const output: TypeToolOutput = { ok: true }
        logger.debug("terminal text typed", { sessionId: input.sessionId, length: input.text.length })
        return okToolResult(`Typed ${input.text.length} character(s) into ${input.sessionId}`, output)
      } catch (err) {
        return errorToToolResult(err)
      }
    },
  )
}
