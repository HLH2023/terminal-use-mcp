/** terminal.paste — 带大粘贴和 secret 防护的粘贴输入。 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { Logger } from "../logger.js"
import type { TerminalUseConfig } from "../config.js"
import { getDetectedSecretTypes } from "../terminal/redact.js"
import { LargePasteRefusedError, SecretDetectedError } from "../terminal/errors.js"
import type { ProviderExecutor } from "./tool-helpers.js"
import { errorToToolResult, okToolResult } from "./tool-helpers.js"

const PASTE_MODES = ["bracketed", "line-by-line", "raw"] as const

type PasteMode = typeof PASTE_MODES[number]

type PasteToolOutput = {
  ok: true
  mode: PasteMode
  warning?: string
}

export function registerPasteTool(server: McpServer, executor: ProviderExecutor, logger: Logger, config: TerminalUseConfig): void {
  server.registerTool(
    "terminal.paste",
    {
      description: "Paste text into a terminal session with large-paste and secret detection safeguards.",
      inputSchema: {
        sessionId: z.string().min(1).describe("Session ID from terminal.start — use exact value"),
        text: z.string().describe("Text to paste into the terminal"),
        confirmLargePaste: z.boolean().optional().describe(`Required when text length is greater than ${config.largePasteLimit} characters`),
        mode: z.enum(PASTE_MODES).optional().describe("Paste mode: bracketed, line-by-line, or raw"),
      },
    },
    async (input) => {
      try {
        const secretTypes = getDetectedSecretTypes(input.text)
        if (secretTypes.length > 0) {
          throw new SecretDetectedError(secretTypes)
        }
        if (input.text.length > config.hardPasteLimit) {
          throw new LargePasteRefusedError(input.text.length, config.hardPasteLimit, true)
        }
        if (input.text.length > config.largePasteLimit && input.confirmLargePaste !== true) {
          throw new LargePasteRefusedError(input.text.length, config.largePasteLimit, false)
        }

        const mode = input.mode ?? "bracketed"
        await executor.executePaste(input.sessionId, input.text, mode)
        const warning = input.text.length > config.largePasteLimit
          ? `Large paste confirmed (${input.text.length} characters). Terminal output remains untrusted.`
          : undefined
        const output: PasteToolOutput = { ok: true, mode, warning }
        logger.debug("terminal text pasted", { sessionId: input.sessionId, length: input.text.length, mode })
        return okToolResult(`Pasted ${input.text.length} character(s) into ${input.sessionId}`, output)
      } catch (err) {
        return errorToToolResult(err)
      }
    },
  )
}
