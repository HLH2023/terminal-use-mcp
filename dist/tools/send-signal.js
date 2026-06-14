import { z } from "zod";
import { errorToToolResult, okToolResult } from "./tool-helpers.js";
export function registerSendSignalTool(server, executor) {
    server.registerTool("terminal.send_signal", {
        description: "Send a signal semantic to a terminal session process",
        inputSchema: {
            sessionId: z.string().describe("Session ID from terminal.start — use exact value"),
            signal: z.enum(["SIGINT", "SIGTERM", "SIGKILL"]),
        },
    }, async (input) => {
        try {
            await executor.executeSendSignal(input.sessionId, input.signal);
            const output = { ok: true, signal: input.signal, sessionId: input.sessionId };
            return okToolResult(`Sent ${input.signal} to session ${input.sessionId}`, output);
        }
        catch (err) {
            return errorToToolResult(err);
        }
    });
}
