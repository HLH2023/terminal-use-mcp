/** terminal.mouse_scroll — 在终端指定位置注入鼠标滚轮事件 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { Logger } from "../logger.js"
import type { MouseScrollDirection } from "../terminal/mouse.js"
import type { ScrollMode } from "../providers/provider.js"
import type { ProviderExecutor } from "./tool-helpers.js"
import { errorToToolResult, okToolResult } from "./tool-helpers.js"

type MouseScrollToolOutput = {
  ok: true
  direction: string
  col: number
  row: number
  lines: number
}

export function registerMouseScrollTool(server: McpServer, executor: ProviderExecutor, logger: Logger): void {
  server.registerTool(
    "terminal.mouse_scroll",
    {
      description:
        "Scroll the mouse wheel at a specific position in the terminal. " +
        "Sends SGR-1006 scroll sequences that interactive TUI programs understand. " +
        "Useful for scrolling through long content in TUI apps (chat history, logs, file viewers). " +
        "The child process must have mouse mode enabled for scroll events to take effect.",
      inputSchema: {
        sessionId: z.string().min(1).describe("Session ID from terminal.start — use exact value"),
        col: z.number().int().min(1).describe("1-based column (x position, left=1)"),
        row: z.number().int().min(1).describe("1-based row (y position, top=1)"),
        direction: z.enum(["up", "down"]).describe("Scroll direction"),
        lines: z.number().int().min(1).max(20).describe("Number of scroll ticks (1-20, each ~3 lines)").default(3),
        shift: z.boolean().describe("Shift key held (fast scroll in some apps)").default(false),
        alt: z.boolean().describe("Alt key held").default(false),
        ctrl: z.boolean().describe("Ctrl key held").default(false),
        mode: z.enum(["program-mouse", "tmux-copy", "program-key"]).optional().describe("Scroll mode: program-mouse (default, SGR mouse sequence), tmux-copy (copy-mode + scroll-up/scroll-down), program-key (PageUp/PageDown keys)").default("program-mouse"),
      },
    },
    async (input) => {
      try {
        const direction: MouseScrollDirection = input.direction
        const mode: ScrollMode = input.mode ?? "program-mouse"
        const lines = input.lines ?? 3
        await executor.executeMouseScroll(input.sessionId, {
          col: input.col,
          row: input.row,
          direction,
          mode,
          shift: input.shift ?? false,
          alt: input.alt ?? false,
          ctrl: input.ctrl ?? false,
        }, lines)
        const output: MouseScrollToolOutput = { ok: true, direction, col: input.col, row: input.row, lines }
        logger.debug("mouse scroll sent", { sessionId: input.sessionId, direction, col: input.col, row: input.row, lines })
        return okToolResult(`Scrolled ${direction} ${lines} tick(s) at (${input.col},${input.row}) in ${input.sessionId}`, output)
      } catch (err) {
        return errorToToolResult(err)
      }
    },
  )
}
