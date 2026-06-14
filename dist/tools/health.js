import { TerminalUseError } from "../terminal/errors.js";
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
const PROVIDER_NAMES = ["native-pty", "tmux", "ssh-pty", "ssh-tmux"];
export function registerHealthTool(server, providers, disabledProviders, version = "0.1.0") {
    server.registerTool("terminal.health", {
        description: "Check terminal-use-mcp server health and provider availability",
        inputSchema: {},
    }, async () => {
        try {
            const providerHealth = await buildProviderHealth(providers, disabledProviders);
            const hasAvailableProvider = Object.values(providerHealth).some((entry) => entry.available);
            const output = {
                ok: true,
                version,
                status: hasAvailableProvider ? "ok" : "degraded",
                providers: providerHealth,
            };
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
async function buildProviderHealth(providers, disabledProviders) {
    const entries = await Promise.all(PROVIDER_NAMES.map(async (providerName) => {
        if (disabledProviders.has(providerName)) {
            return [providerName, { available: false, reason: "disabled by TERMINAL_USE_PROVIDERS config" }];
        }
        const provider = providers.get(providerName);
        if (provider === undefined) {
            return [providerName, { available: false, reason: "not registered" }];
        }
        try {
            const available = await provider.isAvailable();
            return [providerName, available ? { available } : { available, reason: "provider dependency unavailable" }];
        }
        catch (err) {
            return [providerName, { available: false, reason: err instanceof Error ? err.message : String(err) }];
        }
    }));
    return Object.fromEntries(entries);
}
