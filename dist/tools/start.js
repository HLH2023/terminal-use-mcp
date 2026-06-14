import { z } from "zod";
import { errorToToolResult, textContent } from "./tool-helpers.js";
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
export function registerStartTool(server, sm, logger, config) {
    server.registerTool("terminal.start", {
        description: "Start a new terminal session",
        inputSchema: {
            command: z.string().min(1).describe("Command to run. On Unix, complex commands are automatically wrapped with /bin/sh -c; on Windows, with cmd.exe /c."),
            args: z.array(z.string()).default([]).optional().describe("Command arguments"),
            cwd: z.string().min(1).describe("Working directory"),
            cols: z.number().default(config.defaultCols).optional().describe("Terminal columns"),
            rows: z.number().default(config.defaultRows).optional().describe("Terminal rows"),
            provider: z.enum(["native-pty", "tmux", "ssh-pty", "ssh-tmux"]).optional().describe("Preferred provider"),
            target: terminalTargetSchema.optional().describe("Terminal target: local or configured SSH profile"),
            env: z.record(z.string()).optional().describe("Extra environment variables"),
            label: z.string().optional().describe("Session label"),
            ttlMs: z.number().default(config.sessionTtlMs).optional().describe("Session TTL in ms"),
            transcript: z.boolean().default(true).optional().describe("Enable transcript recording"),
        },
    }, async (input) => {
        try {
            const provider = input.provider;
            const session = await sm.start({
                command: input.command,
                args: input.args ?? [],
                cwd: input.cwd,
                cols: input.cols ?? config.defaultCols,
                rows: input.rows ?? config.defaultRows,
                provider,
                target: input.target,
                env: input.env,
                label: input.label,
                ttlMs: input.ttlMs ?? config.sessionTtlMs,
                transcript: input.transcript ?? true,
            });
            logger.info("terminal.start completed", { sessionId: session.sessionId, provider: session.providerName });
            return {
                content: [textContent(`Started terminal session ${session.sessionId}. Use this exact sessionId for all subsequent calls (snapshot, type, kill, etc.) — do not modify or add prefixes.`)],
                structuredContent: {
                    ok: true,
                    sessionId: session.sessionId,
                    status: session.status,
                    cwd: session.cwd,
                    label: session.label,
                    capabilities: session.capabilities,
                },
            };
        }
        catch (err) {
            return errorToToolResult(err);
        }
    });
}
