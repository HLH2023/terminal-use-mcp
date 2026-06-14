import { z } from "zod";
import { errorToToolResult, okToolResult } from "./tool-helpers.js";
export function registerResizeTool(server, executor) {
    server.registerTool("terminal.resize", {
        description: "Resize an active terminal session",
        inputSchema: {
            sessionId: z.string().describe("Session ID from terminal.start — use exact value"),
            cols: z.number().int().positive(),
            rows: z.number().int().positive(),
        },
    }, async (input) => {
        try {
            await executor.executeResize(input.sessionId, input.cols, input.rows);
            return okToolResult(`Resized session ${input.sessionId} to ${input.cols}x${input.rows}`, { ok: true });
        }
        catch (err) {
            return errorToToolResult(err);
        }
    });
}
