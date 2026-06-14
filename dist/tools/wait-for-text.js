/** terminal.wait_for_text — 等待屏幕出现指定文本或正则。 */
import { z } from "zod";
import { errorToToolResult, okToolResult } from "./tool-helpers.js";
const DEFAULT_WAIT_TIMEOUT_MS = 10_000;
export function registerWaitForTextTool(server, executor, logger) {
    server.registerTool("terminal.wait_for_text", {
        description: "Wait until terminal screen contains text, or matches text as a regex when regex=true.",
        inputSchema: {
            sessionId: z.string().min(1).describe("Session ID from terminal.start — use exact value"),
            text: z.string().min(1).describe("Text to wait for; treated as regex pattern when regex=true"),
            regex: z.boolean().optional().describe("Treat text as a regular expression"),
            timeoutMs: z.number().int().positive().optional().describe("Timeout in milliseconds, default 10000"),
            caseSensitive: z.boolean().optional().describe("Case-sensitive match, default true"),
        },
    }, async (input) => {
        try {
            const options = {
                text: input.text,
                regex: input.regex,
                timeoutMs: input.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS,
                caseSensitive: input.caseSensitive,
            };
            const snapshot = await executor.executeWaitForText(input.sessionId, input.text, options);
            logger.debug("terminal text observed", { sessionId: input.sessionId, regex: input.regex ?? false });
            return okToolResult(`Observed target text in ${input.sessionId}`, snapshot);
        }
        catch (err) {
            return errorToToolResult(err);
        }
    });
}
