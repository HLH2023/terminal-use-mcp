/**
 * Remote SSH capability discovery.
 *
 * The first SSH connection to a profile probes the remote host once, then caches
 * the result by profile name.  Providers consume this instead of assuming a
 * Unix `$SHELL` or a bare `tmux` binary on PATH.
 */
import path from "node:path";
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;
/** One-round-trip remote capability probe command. */
export const REMOTE_CAPABILITY_PROBE_COMMAND = "printf 'OS=%s\\nSHELL=%s\\nTMUX=%s\\nTMUX_V=%s\\nHOME=%s\\n' \"$(uname -s 2>/dev/null || echo Unknown)\" \"${SHELL:-/bin/sh}\" \"$(command -v tmux 2>/dev/null || echo '')\" \"$(tmux -V 2>/dev/null || echo '')\" \"${HOME:-unknown}\"";
const FALLBACK_UNIX_CAPABILITIES = {
    os: "Unknown",
    shell: "/bin/sh",
    tmuxPath: null,
    tmuxVersion: null,
    home: "unknown",
};
/** Parse structured key=value probe output into normalized remote capabilities. */
export function parseProbeOutput(raw) {
    const fields = new Map();
    for (const line of raw.split(/\r?\n/u)) {
        const separatorIndex = line.indexOf("=");
        if (separatorIndex <= 0)
            continue;
        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1);
        fields.set(key, value);
    }
    const os = normalizeOs(fields.get("OS"));
    const shell = normalizeShell(os, fields.get("SHELL"));
    const tmuxPath = normalizeNullableField(fields.get("TMUX"));
    const tmuxVersion = normalizeTmuxVersion(fields.get("TMUX_V"));
    const home = normalizeNullableField(fields.get("HOME")) ?? "unknown";
    return { os, shell, tmuxPath, tmuxVersion, home };
}
/** Cache remote capability probes by SSH profile name. */
export class RemoteCapabilityCache {
    cache;
    pending;
    constructor(initialEntries = []) {
        this.cache = new Map(initialEntries);
        this.pending = new Map();
    }
    /** Return cached capabilities for a profile without probing. */
    get(profileName) {
        return this.cache.get(profileName);
    }
    /** Probe a connected ssh2 Client once for the given profile name. */
    async probe(client, profileName) {
        return this.probeOnce(profileName, async () => {
            const raw = await execProbeViaSsh2(client);
            return parseProbeOutput(raw);
        });
    }
    /** Probe via the system-ssh transport once for the given profile name. */
    async probeViaTransport(transport, profileName) {
        return this.probeOnce(profileName, async () => {
            const result = await transport.execRemote(REMOTE_CAPABILITY_PROBE_COMMAND, DEFAULT_PROBE_TIMEOUT_MS);
            return parseProbeOutput(result.stdout);
        });
    }
    async probeOnce(profileName, loader) {
        const cached = this.cache.get(profileName);
        if (cached !== undefined)
            return cached;
        const existing = this.pending.get(profileName);
        if (existing !== undefined)
            return existing;
        const pendingProbe = loader()
            .catch(() => ({ ...FALLBACK_UNIX_CAPABILITIES }))
            .then((capabilities) => {
            this.cache.set(profileName, capabilities);
            this.pending.delete(profileName);
            return capabilities;
        });
        this.pending.set(profileName, pendingProbe);
        return pendingProbe;
    }
}
/** Module-level singleton used by SSH providers. */
export const remoteCapabilityCache = new RemoteCapabilityCache();
function execProbeViaSsh2(client) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let stdout = "";
        let stderr = "";
        let channelRef;
        const timer = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            channelRef?.close();
            reject(new Error(`Remote capability probe timed out after ${DEFAULT_PROBE_TIMEOUT_MS}ms`));
        }, DEFAULT_PROBE_TIMEOUT_MS);
        const finish = (error) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (error !== undefined) {
                reject(error);
                return;
            }
            resolve(stdout);
        };
        client.exec(REMOTE_CAPABILITY_PROBE_COMMAND, (error, channel) => {
            if (error !== undefined) {
                finish(error);
                return;
            }
            channelRef = channel;
            channel.on("data", (chunk) => {
                stdout += normalizeChunk(chunk);
            });
            channel.stderr.on("data", (chunk) => {
                stderr += normalizeChunk(chunk);
            });
            channel.on("error", (channelError) => finish(channelError));
            channel.on("close", (code) => {
                if (code === 0 || stdout.trim().length > 0) {
                    finish();
                    return;
                }
                finish(new Error(stderr.trim() || `Remote capability probe exited with code ${code ?? "unknown"}`));
            });
        });
    });
}
function normalizeChunk(chunk) {
    return typeof chunk === "string" ? chunk : chunk.toString("utf8");
}
function normalizeOs(rawOs) {
    const os = rawOs?.trim();
    if (os === undefined || os.length === 0)
        return "Unknown";
    if (isWindowsOs(os))
        return "Windows";
    return os;
}
function normalizeShell(os, rawShell) {
    const shell = rawShell?.trim() ?? "";
    if (isWindowsOs(os)) {
        return isUsefulWindowsShell(shell) ? shell : "cmd.exe";
    }
    return shell.length > 0 ? shell : "/bin/sh";
}
function normalizeNullableField(raw) {
    const value = raw?.trim() ?? "";
    return value.length > 0 ? value : null;
}
function normalizeTmuxVersion(raw) {
    const value = normalizeNullableField(raw);
    if (value === null)
        return null;
    return /^tmux\s+\d+\.\d+[A-Za-z0-9._-]*$/u.test(value) ? value : null;
}
function isWindowsOs(os) {
    return /^(Windows|Windows_NT)/iu.test(os) || /(?:MINGW|MSYS|CYGWIN)/iu.test(os);
}
function isUsefulWindowsShell(shell) {
    if (shell.length === 0)
        return false;
    const winBase = path.win32.basename(shell).toLowerCase();
    const posixBase = path.posix.basename(shell).toLowerCase();
    return [winBase, posixBase].some((base) => base === "cmd.exe" || base === "powershell.exe" || base === "pwsh.exe");
}
