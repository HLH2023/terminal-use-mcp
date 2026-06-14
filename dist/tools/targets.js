/**
 * terminal.targets — 列出本地与 SSH profile target。
 *
 * 输出只包含连接所需的非敏感摘要；不会暴露 key-file 路径、passphrase、
 * token、password 或任何 env 值。
 */
import { errorToToolResult, textContent } from "./tool-helpers.js";
export function registerTargetsTool(server, hostsConfig, logger) {
    server.registerTool("terminal.targets", {
        description: "List available terminal targets (local + configured SSH profiles)",
        inputSchema: {},
    }, async () => {
        try {
            const output = {
                ok: true,
                targets: buildTargetSummaries(hostsConfig),
            };
            logger.debug("terminal.targets completed", { sshProfiles: hostsConfig.size });
            return {
                content: [textContent(`Available targets: ${output.targets.length}`)],
                structuredContent: output,
            };
        }
        catch (err) {
            return errorToToolResult(err);
        }
    });
}
function buildTargetSummaries(hostsConfig) {
    const local = { kind: "local", name: "local" };
    const sshTargets = [...hostsConfig.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([profileName, profile]) => ({
        kind: "ssh",
        profile: profile.name || profileName,
        host: profile.host,
        port: profile.port,
        username: profile.username,
        authType: profile.auth.type,
        knownHostPolicy: "strict",
        defaultCwd: profile.defaultCwd,
        allowTmux: profile.allowTmux ?? false,
    }));
    return [local, ...sshTargets];
}
