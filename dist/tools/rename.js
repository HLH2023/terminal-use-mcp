import { z } from "zod";
import { errorToToolResult, textContent } from "./tool-helpers.js";
export function registerRenameTool(server, sm, logger) {
    server.registerTool("terminal.rename", {
        description: "Rename a terminal session label",
        inputSchema: {
            sessionId: z.string().describe("Session ID from terminal.start — use exact value"),
            label: z.string().describe("New session label"),
        },
    }, async (input) => {
        try {
            await sm.rename(input.sessionId, input.label);
            logger.info("terminal.rename completed", { sessionId: input.sessionId, label: input.label });
            return {
                content: [textContent(`Renamed terminal session ${input.sessionId}`)],
                structuredContent: { ok: true },
            };
        }
        catch (err) {
            return errorToToolResult(err);
        }
    });
}
