import { z } from "zod";
import { TerminalUseError } from "../terminal/errors.js";
import { errorToToolResult, textContent } from "./tool-helpers.js";
export function registerAttachTool(server, sm, logger) {
    server.registerTool("terminal.attach", {
        description: "Attach to an existing terminal session",
        inputSchema: {
            sessionId: z.string().optional().describe("Session ID (from terminal.start or terminal.list — use exact value, do not modify)"),
            tmuxSessionName: z.string().optional().describe("Existing tmux session name"),
            provider: z.enum(["native-pty", "tmux", "ssh-tmux"]).optional().describe("Provider used for attach"),
        },
    }, async (input) => {
        try {
            const target = input.sessionId ?? input.tmuxSessionName;
            if (target === undefined || target.length === 0) {
                throw new TerminalUseError({
                    code: "INTERNAL_ERROR",
                    message: "terminal.attach requires sessionId or tmuxSessionName",
                    retryable: false,
                });
            }
            const session = await sm.attach(target, input.provider);
            logger.info("terminal.attach completed", { sessionId: session.sessionId, provider: session.providerName });
            return {
                content: [textContent(`Attached terminal session ${session.sessionId}. Use this exact sessionId for all subsequent calls.`)],
                structuredContent: {
                    ok: true,
                    sessionId: session.sessionId,
                    status: session.status,
                    capabilities: session.capabilities,
                },
            };
        }
        catch (err) {
            return errorToToolResult(err);
        }
    });
}
