/** terminal.paste — 带大粘贴和 secret 防护的粘贴输入。 */
import { z } from "zod";
import { getDetectedSecretTypes } from "../terminal/redact.js";
import { LargePasteRefusedError, SecretDetectedError } from "../terminal/errors.js";
import { errorToToolResult, okToolResult } from "./tool-helpers.js";
const SOFT_PASTE_LIMIT = 2_000;
const HARD_PASTE_LIMIT = 10_000;
const PASTE_MODES = ["bracketed", "line-by-line", "raw"];
export function registerPasteTool(server, executor, logger) {
    server.registerTool("terminal.paste", {
        description: "Paste text into a terminal session with large-paste and secret detection safeguards.",
        inputSchema: {
            sessionId: z.string().min(1).describe("Session ID from terminal.start — use exact value"),
            text: z.string().describe("Text to paste into the terminal"),
            confirmLargePaste: z.boolean().optional().describe("Required when text length is greater than 2000 characters"),
            mode: z.enum(PASTE_MODES).optional().describe("Paste mode: bracketed, line-by-line, or raw"),
        },
    }, async (input) => {
        try {
            const secretTypes = getDetectedSecretTypes(input.text);
            if (secretTypes.length > 0) {
                throw new SecretDetectedError(secretTypes);
            }
            if (input.text.length > HARD_PASTE_LIMIT) {
                throw new LargePasteRefusedError(input.text.length, HARD_PASTE_LIMIT, true);
            }
            if (input.text.length > SOFT_PASTE_LIMIT && input.confirmLargePaste !== true) {
                throw new LargePasteRefusedError(input.text.length, SOFT_PASTE_LIMIT, false);
            }
            const mode = input.mode ?? "bracketed";
            await executor.executePaste(input.sessionId, input.text, mode);
            const warning = input.text.length > SOFT_PASTE_LIMIT
                ? `Large paste confirmed (${input.text.length} characters). Terminal output remains untrusted.`
                : undefined;
            const output = { ok: true, mode, warning };
            logger.debug("terminal text pasted", { sessionId: input.sessionId, length: input.text.length, mode });
            return okToolResult(`Pasted ${input.text.length} character(s) into ${input.sessionId}`, output);
        }
        catch (err) {
            return errorToToolResult(err);
        }
    });
}
