/** terminal.scroll — 滚动终端视图。 */
import { z } from "zod";
import { errorToToolResult, okToolResult } from "./tool-helpers.js";
export function registerScrollTool(server, executor, logger) {
    server.registerTool("terminal.scroll", {
        description: "Scroll terminal viewport up or down by a number of lines.",
        inputSchema: {
            sessionId: z.string().min(1).describe("Session ID from terminal.start — use exact value"),
            direction: z.enum(["up", "down"]).describe("Scroll direction"),
            lines: z.number().int().positive().describe("Number of lines to scroll"),
        },
    }, async (input) => {
        try {
            const direction = input.direction;
            await executor.executeScroll(input.sessionId, direction, input.lines);
            const output = { ok: true };
            logger.debug("terminal scrolled", { sessionId: input.sessionId, direction, lines: input.lines });
            return okToolResult(`Scrolled ${input.sessionId} ${direction} by ${input.lines} line(s)`, output);
        }
        catch (err) {
            return errorToToolResult(err);
        }
    });
}
