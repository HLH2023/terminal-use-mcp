/**
 * Remote SSH capability discovery.
 *
 * The first SSH connection to a profile probes the remote host once, then caches
 * the result by profile name.  Providers consume this instead of assuming a
 * Unix `$SHELL` or a bare `tmux` binary on PATH.
 */
import type { Client } from "ssh2";
import type { SystemSshTransport } from "../providers/system-ssh-transport.js";
/** Discovered capabilities of a remote SSH target. */
export interface RemoteCapabilities {
    /** OS kernel name from `uname -s`, e.g. "Linux", "Darwin", "FreeBSD". "Windows" or "Unknown" if detection fails. */
    os: string;
    /** Absolute path to the user's default login shell, e.g. "/bin/bash", "/bin/zsh". Falls back to "/bin/sh" (Unix) or "cmd.exe" (Windows). */
    shell: string;
    /** Absolute path to tmux binary if found, e.g. "/usr/bin/tmux". null if tmux is not installed. */
    tmuxPath: string | null;
    /** tmux version string, e.g. "tmux 3.4a". null if tmux not found or version unparseable. */
    tmuxVersion: string | null;
    /** User home directory, e.g. "/home/user". "unknown" if detection fails. */
    home: string;
}
/** One-round-trip remote capability probe command. */
export declare const REMOTE_CAPABILITY_PROBE_COMMAND = "printf 'OS=%s\\nSHELL=%s\\nTMUX=%s\\nTMUX_V=%s\\nHOME=%s\\n' \"$(uname -s 2>/dev/null || echo Unknown)\" \"${SHELL:-/bin/sh}\" \"$(command -v tmux 2>/dev/null || echo '')\" \"$(tmux -V 2>/dev/null || echo '')\" \"${HOME:-unknown}\"";
/** Parse structured key=value probe output into normalized remote capabilities. */
export declare function parseProbeOutput(raw: string): RemoteCapabilities;
/** Cache remote capability probes by SSH profile name. */
export declare class RemoteCapabilityCache {
    private readonly cache;
    private readonly pending;
    constructor(initialEntries?: Iterable<readonly [string, RemoteCapabilities]>);
    /** Return cached capabilities for a profile without probing. */
    get(profileName: string): RemoteCapabilities | undefined;
    /** Probe a connected ssh2 Client once for the given profile name. */
    probe(client: Client, profileName: string): Promise<RemoteCapabilities>;
    /** Probe via the system-ssh transport once for the given profile name. */
    probeViaTransport(transport: SystemSshTransport, profileName: string): Promise<RemoteCapabilities>;
    private probeOnce;
}
/** Module-level singleton used by SSH providers. */
export declare const remoteCapabilityCache: RemoteCapabilityCache;
