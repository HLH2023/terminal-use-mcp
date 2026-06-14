import { z } from "zod";
import { ProviderNotAvailableError, TerminalUseError } from "../terminal/errors.js";
function errorToToolResult(err) {
    if (err instanceof TerminalUseError) {
        const envelope = err.toEnvelope();
        return { content: [{ type: "text", text: JSON.stringify(envelope) }], isError: true };
    }
    return {
        content: [{ type: "text", text: JSON.stringify({ ok: false, error: { code: "INTERNAL_ERROR", message: String(err), retryable: false } }) }],
        isError: true,
    };
}
export function registerProviderCapabilitiesTool(server, providers) {
    server.registerTool("terminal.provider_capabilities", {
        description: "Return the declared capability matrix for a terminal provider",
        inputSchema: {
            provider: z.enum(["native-pty", "tmux", "ssh-pty", "ssh-tmux"]),
        },
    }, async (input) => {
        try {
            const provider = providers.get(input.provider);
            if (provider === undefined) {
                throw new ProviderNotAvailableError(input.provider, "Provider is not registered");
            }
            const output = { ok: true, capabilities: provider.capabilities };
            return {
                content: [{ type: "text", text: JSON.stringify(output) }],
                structuredContent: output,
            };
        }
        catch (err) {
            return errorToToolResult(err);
        }
    });
}
