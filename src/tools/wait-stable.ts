/** terminal.wait_stable — 等待屏幕在 idleMs 窗口内保持稳定。 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { Logger } from "../logger.js"
import type { WaitStableOptions } from "../providers/provider.js"
import type { ProviderExecutor } from "./tool-helpers.js"
import { errorToToolResult, okToolResult } from "./tool-helpers.js"

const DEFAULT_IDLE_MS = 500
const DEFAULT_WAIT_TIMEOUT_MS = 5_000

export function registerWaitStableTool(server: McpServer, executor: ProviderExecutor, logger: Logger): void {
  server.registerTool(
    "terminal.wait_stable",
    {
      description: "Wait until terminal screen is stable. Returns current snapshot even on timeout (with timedOut=true).",
      inputSchema: {
        sessionId: z.string().min(1).describe("Session ID from terminal.start — use exact value"),
        idleMs: z.number().int().positive().optional().describe("Stable idle window in milliseconds, default 500"),
        timeoutMs: z.number().int().positive().optional().describe("Timeout in milliseconds, default 5000"),
        snapshotOnTimeout: z.boolean().optional().describe("Return current snapshot with timedOut=true on timeout, default true"),
      },
    },
    async (input) => {
      try {
        const options: WaitStableOptions = {
          idleMs: input.idleMs ?? DEFAULT_IDLE_MS,
          timeoutMs: input.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS,
          // 默认软超时：即使未确认稳定，也把当前屏幕交给 agent 判断，避免连续刷新 TUI 卡住流程。
          snapshotOnTimeout: input.snapshotOnTimeout ?? true,
        }
        const snapshot = await executor.executeWaitStable(input.sessionId, options)
        logger.debug("terminal screen stable wait completed", {
          sessionId: input.sessionId,
          idleMs: options.idleMs,
          timedOut: snapshot.timedOut === true,
        })
        const summary = snapshot.timedOut === true
          ? `Screen wait timed out for ${input.sessionId}; returned current snapshot`
          : `Screen stable for ${input.sessionId}`
        return okToolResult(summary, snapshot)
      } catch (err) {
        return errorToToolResult(err)
      }
    },
  )
}
