/** terminal.wait_stable — 等待屏幕在 idleMs 窗口内保持稳定。 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { TerminalUseConfig } from "../config.js"
import type { Logger } from "../logger.js"
import type { WaitStableOptions } from "../providers/provider.js"
import type { ProviderExecutor } from "./tool-helpers.js"
import { errorToToolResult, okToolResult } from "./tool-helpers.js"

export function registerWaitStableTool(
  server: McpServer,
  executor: ProviderExecutor,
  logger: Logger,
  config: TerminalUseConfig,
): void {
  server.registerTool(
    "terminal.wait_stable",
    {
      description: "Wait until terminal screen is stable. Returns current snapshot even on timeout (with timedOut=true).",
      inputSchema: {
        sessionId: z.string().min(1).describe("Session ID from terminal.start — use exact value"),
        idleMs: z.number().int().positive().optional().describe(`Stable idle window in milliseconds, default ${config.defaultWaitStableIdleMs}`),
        timeoutMs: z.number().int().positive().optional().describe(`Timeout in milliseconds, default ${config.defaultWaitStableTimeoutMs}`),
        snapshotOnTimeout: z.boolean().optional().describe("Return current snapshot with timedOut=true on timeout, default true"),
      },
    },
    async (input) => {
      try {
        const options: WaitStableOptions = {
          idleMs: input.idleMs ?? config.defaultWaitStableIdleMs,
          timeoutMs: input.timeoutMs ?? config.defaultWaitStableTimeoutMs,
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