import { z } from "zod";
import { errorToToolResult, ProviderExecutor, textContent, } from "./tool-helpers.js";
const sshAuthSchema = z.union([
    z.object({ type: z.literal("agent"), socket: z.string().optional() }),
    z.object({ type: z.literal("key-file"), path: z.string(), passphraseEnv: z.string().optional() }),
]);
const terminalTargetSchema = z.union([
    z.object({ kind: z.literal("local") }),
    z.object({
        kind: z.literal("ssh"),
        profile: z.string().optional(),
        host: z.string().optional(),
        port: z.number().optional(),
        username: z.string().optional(),
        auth: sshAuthSchema.optional(),
        knownHostPolicy: z.literal("strict").optional(),
    }),
]);
export function registerTmuxListTool(server, runtime, logger, hostsConfig) {
    const executor = toProviderExecutor(runtime, hostsConfig);
    server.registerTool("terminal.tmux_list", {
        description: "List all tmux sessions on local or configured SSH target",
        inputSchema: {
            target: terminalTargetSchema.optional().describe("SSH target. Omit to list local tmux sessions"),
            profile: z.string().optional().describe("SSH profile name shorthand for target"),
        },
    }, async (input) => {
        try {
            const sessions = await executor.executeTmuxList({
                target: input.target,
                profile: input.profile,
            });
            const output = { ok: true, sessions };
            logger.debug("terminal.tmux_list completed", {
                count: sessions.length,
                target: formatInputTarget(input.profile, input.target),
            });
            return {
                content: [textContent(`Found ${sessions.length} tmux session(s) on ${formatInputTarget(input.profile, input.target)}`)],
                structuredContent: output,
            };
        }
        catch (err) {
            return errorToToolResult(err);
        }
    });
}
function toProviderExecutor(runtime, hostsConfig) {
    if (runtime instanceof ProviderExecutor)
        return runtime;
    return new ProviderExecutor(runtime, runtime.getProviders(), hostsConfig);
}
function formatInputTarget(profile, target) {
    if (profile !== undefined)
        return `ssh:${profile}`;
    if (target?.kind === "ssh")
        return `ssh:${target.profile ?? target.username ?? target.host ?? "inline"}`;
    return "local";
}
