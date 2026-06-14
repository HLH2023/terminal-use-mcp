import { errorToToolResult, textContent } from "./tool-helpers.js";
export function registerCleanupTool(server, sm, logger) {
    server.registerTool("terminal.cleanup", {
        description: "Cleanup terminal sessions managed by this MCP server",
        inputSchema: {},
    }, async () => {
        try {
            const sessionIds = sm.listSessions().map((session) => session.sessionId);
            const killed = [];
            const cleaned = [];
            for (const sessionId of sessionIds) {
                await sm.kill(sessionId);
                killed.push(sessionId);
                cleaned.push(sessionId);
            }
            logger.info("terminal.cleanup completed", { killed: killed.length, cleaned: cleaned.length });
            return {
                content: [textContent(`Cleaned up ${cleaned.length} terminal session(s)`)],
                structuredContent: { ok: true, killed, cleaned },
            };
        }
        catch (err) {
            return errorToToolResult(err);
        }
    });
}
