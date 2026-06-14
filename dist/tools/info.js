import { z } from "zod";
import { errorToToolResult, sessionToPublicInfo, textContent } from "./tool-helpers.js";
export function registerInfoTool(server, sm, logger) {
    server.registerTool("terminal.info", {
        description: "Get terminal session information",
        inputSchema: {
            sessionId: z.string().describe("Session ID from terminal.start — use exact value"),
        },
    }, async (input) => {
        try {
            const session = sm.getSession(input.sessionId);
            const info = sessionToPublicInfo(session);
            logger.debug("terminal.info completed", { sessionId: session.sessionId });
            return {
                content: [textContent(`Terminal session ${session.sessionId}: ${session.status}`)],
                structuredContent: { ok: true, ...info },
            };
        }
        catch (err) {
            return errorToToolResult(err);
        }
    });
}
