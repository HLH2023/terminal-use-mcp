# Remote SSH Architecture

> Reference document for the implemented SSH terminal provider system.

## 1. Architecture Overview

terminal-use-mcp provides four terminal providers registered via `ProviderRegistry`:

| Provider | Scope | Transport |
|----------|-------|-----------|
| `native-pty` | Local | `node-pty` direct PTY spawn |
| `tmux` | Local | System `tmux` binary via `execFile` |
| `ssh-pty` | Remote | `ssh2` library PTY channel |
| `ssh-tmux` | Remote | System `ssh` binary + remote `tmux` |

Auto-selection logic:

```
target.kind === "local"  → native-pty (fallback tmux)
target.kind === "ssh"    → ssh-pty   (fallback ssh-tmux)
```

Data flow:

```
Agent → MCP Client → [stdio] → terminal-use-mcp
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
              native-pty       ssh-pty         ssh-tmux
              (local)      (ssh2 channel)   (system ssh)
                    │              │              │
                    ▼              ▼              ▼
              Local PTY    Remote PTY      Remote tmux
              process      on SSH host     on SSH host
```

Source: `src/providers/provider-registry.ts`

---

## 2. ssh-pty Provider

The `ssh-pty` provider uses the `ssh2` Node.js library to establish an SSH connection and open a remote PTY channel. It shares the same observation/input model as `native-pty`: remote channel output is fed into `XtermAdapter`, enabling snapshot, highlight detection, transcript, and wait operations.

### Connection

```typescript
// src/providers/ssh-pty-provider.ts
const client = new ssh2.Client()
client.connect({
  host, port, username,
  agent: resolvedAuth.socket,      // ssh-agent
  privateKey: keyBuffer,           // key-file (read into memory, never logged)
  passphrase: envValue,            // optional, from env var reference only
  readyTimeout: connectTimeoutMs,
  keepaliveInterval: keepaliveMs,
})
```

### Remote Command Execution

The provider opens an exec channel with PTY allocation:

```typescript
client.exec(remoteCommand, { pty: { term, cols, rows }, env, ... })
```

The remote command is constructed as:

```bash
exec $SHELL -l -ic 'cd <cwd> && exec <command> <args...>'
```

This ensures the remote shell loads the user's profile (`.bashrc`, `.zshrc`, etc.) and `cd`s to the requested working directory before executing the command.

Source: `src/providers/ssh-pty-provider.ts` → `buildRemoteExecCommand()`

### Capabilities

| Capability | Value | Notes |
|------------|-------|-------|
| Highlights | **Yes** | Full xterm-adapter pipeline: ANSI SGR → cell buffer → highlight regions |
| Scrollback | Best-effort | Limited to current xterm buffer; not complete remote scrollback |
| Mouse | Yes | SGR-1006 click + scroll sequences written to channel |
| Disconnect recovery | **No** | Session dies when SSH connection drops |
| Attach | **No** | Each session is a new SSH exec channel |
| Rename | **No** | Session ID is immutable |

### Session Lifecycle

1. **Resolve target** — Lookup SSH profile by name from `hosts.json`
2. **Resolve auth** — ssh-agent socket or key-file path
3. **Verify host key** — Check against `known_hosts` or pinned fingerprint
4. **Connect** — `ssh2.Client.connect()` with resolved auth
5. **Open exec channel** — `client.exec(command, { pty, env })`
6. **Pipe output** — Channel `data` events → `XtermAdapter.write()`
7. **Interact** — `channel.write()` for key/type/paste/mouse input
8. **Observe** — Snapshot/wait/find via xterm-adapter, same as native-pty
9. **Kill** — `channel.close()` + `client.end()`

Source: `src/providers/ssh-pty-provider.ts` — `start()`, `kill()`

---

## 3. ssh-tmux Provider

The `ssh-tmux` provider uses the system `ssh` binary to execute tmux commands on a remote host. All tmux operations (create, send-keys, capture-pane, kill-session, etc.) are forwarded through SSH. Sessions persist on the remote host and survive disconnects.

### Transport

All operations go through `SystemSshTransport`:

```typescript
execFile("ssh", [
  "-i", keyFile,                    // (optional) key-file auth
  "-p", String(port),
  "-o", "StrictHostKeyChecking=yes",
  "-o", `ConnectTimeout=${seconds}`,
  "-o", "BatchMode=yes",
  `${username}@${host}`,
  "--",
  ...remoteArgs.map(quoteRemoteArg),  // POSIX single-quote escaping
])
```

Source: `src/providers/system-ssh-transport.ts` → `execSshCommand()`

### Remote Command Construction

For new tmux sessions, the shell command is:

```bash
exec $SHELL -l -ic 'exec <command> <args...>'
```

This is passed to `tmux new-session -d '<shell-command>'` on the remote host.

Source: `src/providers/ssh-tmux-provider.ts` → `buildLoginInteractiveShellCommand()`

### Capabilities

| Capability | Value | Notes |
|------------|-------|-------|
| Highlights | **Yes** | Snapshot-mode: `capture-pane -e` returns ANSI SGR, parsed by xterm-adapter |
| Scrollback | Best-effort | Limited by `capture-pane -S -N` history depth |
| Mouse | **Yes** | tmux mouse events via `send-keys` |
| Disconnect recovery | **Yes** | tmux session persists on remote host |
| Attach | **Yes** | Re-attach to existing tmux session |
| Rename | **Yes** | tmux `rename-session` |

> **Note on highlight implementation**: Unlike `ssh-pty` which streams data into xterm-adapter in real time, `ssh-tmux` takes periodic `capture-pane -e` snapshots and parses the full ANSI output into the xterm buffer. Both approaches produce the same highlight/snapshot output, but the underlying mechanism differs (streaming vs. snapshot).

### Session Lifecycle

1. **Resolve target** — Lookup SSH profile by name
2. **Validate CWD** — Remote CWD policy check (local, no SSH yet)
3. **Create session** — `ssh <host> tmux new-session -d -s <name> '<command>'`
4. **Interact** — `ssh <host> tmux send-keys -t <session>` for input
5. **Observe** — `ssh <host> tmux capture-pane -t <session> -e -p` for snapshot
6. **Resize** — `ssh <host> tmux set-option -t <session> window-size ...`
7. **Detach/Kill** — `ssh <host> tmux kill-session -t <session>`
8. **Attach** — `ssh <host> tmux attach -t <session>` (re-enter existing session)

Source: `src/providers/ssh-tmux-provider.ts`

---

## 4. System SSH Transport

`SystemSshTransport` wraps `child_process.execFile("ssh", args)` with enforced security options. It is used exclusively by the `ssh-tmux` provider.

### Fixed Options

| Option | Value | Purpose |
|--------|-------|---------|
| `StrictHostKeyChecking` | `yes` | Reject unknown or changed host keys |
| `BatchMode` | `yes` | Never prompt for password/passphrase |
| `ConnectTimeout` | From profile config (default 10s) | Fail fast on unreachable hosts |

### Authentication

- **Key-file**: `-i <keyFile>` passed as separate argv entries before the host
- **SSH agent**: Implicit — OpenSSH uses `SSH_AUTH_SOCK` when no `-i` is specified
- **Password**: **Not supported** — `BatchMode=yes` prevents interactive prompts

### Remote Argument Escaping

All remote arguments undergo POSIX single-quote escaping before being passed to `ssh`:

```typescript
// src/providers/system-ssh-transport.ts → quoteRemoteArg()
function quoteRemoteArg(value: string): string {
  if (value.length === 0) return "''"
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value
  return `'${value.replaceAll("'", `'"'"'`)}'`
}
```

This prevents shell injection through remote arguments. Arguments are passed as an array to `execFile`, not concatenated into a shell command string.

### Proxy Jump Support

If the SSH profile has `SSH_PROXY_JUMP` set (via OpenSSH config merge or explicit `env` field), the `ssh-tmux` provider passes it to the system `ssh` command via `-o ProxyJump=<value>`. ProxyJump support requires explicit profile configuration; the `SSH_PROXY_JUMP` environment variable is NOT directly forwarded as an SSH option.

Source: `src/providers/system-ssh-transport.ts`

---

## 5. Configuration

### SSH Profiles

SSH targets are defined in profile configuration files. There are three configuration sources (by priority):

1. **Legacy `hosts.json`** — Single file with all profiles (triggered by `TERMINAL_USE_HOSTS_CONFIG` env var)
2. **Overlay `profiles/<name>.json`** — One file per host under XDG config dir (`~/.config/terminal-use-mcp/profiles/`)
3. **OpenSSH `~/.ssh/config`** — Referenced via `sshConfigHost` field in profiles; connection parameters merged

### Profile Schema

```typescript
// src/targets/target-types.ts
type SshHostProfile = {
  name: string
  sshConfigHost?: string       // Reference to OpenSSH config Host alias
  host: string
  port: number
  username: string
  auth: SshAuthRef
  knownHosts?: string          // Path to known_hosts file
  pinnedHostFingerprint?: string  // SHA256/MD5 fingerprint pin
  defaultCwd?: string
  remoteAllowedCwd: string[]
  remoteDeniedCwd?: string[]
  allowTmux?: boolean
  env?: Record<string, string>
  connectTimeoutMs?: number
  keepaliveIntervalMs?: number
}
```

### Example Profile (hosts.json)

```json
{
  "my-server": {
    "name": "my-server",
    "host": "192.168.1.100",
    "port": 22,
    "username": "deploy",
    "auth": {
      "type": "key-file",
      "path": "~/.ssh/id_deploy"
    },
    "knownHosts": "~/.ssh/known_hosts",
    "defaultCwd": "/home/deploy/app",
    "remoteAllowedCwd": ["/home/deploy", "/tmp"],
    "remoteDeniedCwd": ["/home/deploy/.ssh"],
    "connectTimeoutMs": 8000
  }
}
```

### Example Profile (OpenSSH config integration)

```json
// ~/.config/terminal-use-mcp/profiles/prod.json
{
  "sshConfigHost": "prod-web",
  "defaultCwd": "/var/www",
  "remoteAllowedCwd": ["/var/www", "/tmp", "/var/log"],
  "pinnedHostFingerprint": "SHA256:abc123..."
}
```

When `sshConfigHost` is set, the system parses `~/.ssh/config` and merges `HostName`, `Port`, `User`, and `IdentityFile` from the matching `Host` entry.

Source: `src/targets/ssh-host-config.ts`

---

## 6. Security Model

### Host Key Verification

Host key verification is **always strict**. One of two mechanisms must pass:

1. **known_hosts file** — The host's public key must match an entry in `knownHosts` (default: `~/.ssh/known_hosts`). On mismatch (ROTATED_KEY), the connection is rejected with `SshHostKeyMismatchError`. On missing entry, the connection is rejected with `SshHostKeyUnknownError`.

2. **Pinned fingerprint** — If the profile has `pinnedHostFingerprint` set, the actual host key fingerprint is computed and compared against the pinned value (SHA256 or MD5 format). This is the strongest guarantee — it pins the exact key, independent of known_hosts file management.

> There is **no** `StrictHostKeyChecking=no` mode. Unknown hosts are never silently accepted.

Source: `src/targets/host-fingerprint.ts`, `src/targets/known-hosts.ts`

### Authentication

Only two auth methods are supported:

| Method | How | Security |
|--------|-----|----------|
| `ssh-agent` | Agent socket (`SSH_AUTH_SOCK`) | Safest — MCP never touches private keys |
| `key-file` | Path to private key file | Key read into memory for `ssh2`; never logged or stored |

**Password authentication is permanently disabled.** The system rejects profiles with `auth.type: "password"` at config validation time. `BatchMode=yes` in system SSH transport prevents any interactive password prompt.

### SSH Agent Socket Discovery

When `auth.type` is `"agent"` and no explicit `socket` is configured, the system auto-discovers the agent socket:

1. `SSH_AUTH_SOCK` environment variable (highest priority)
2. `$XDG_RUNTIME_DIR/ssh-agent.socket` (systemd user service)
3. `$XDG_RUNTIME_DIR/keyring/ssh` (GNOME Keyring)
4. Runtime scan via `ss -x --no-header` (fallback)

Source: `src/targets/ssh-auth.ts` → `getSshAgentSocket()`

### Remote CWD Policy

Remote working directories are validated **locally** (no SSH connection needed) against per-profile rules:

- **`remoteAllowedCwd`** (required): List of allowed directory roots. CWD must be inside at least one.
- **`remoteDeniedCwd`** (optional): List of denied roots. Takes precedence over allowed.
- **`defaultCwd`** (optional): Used when caller doesn't specify a CWD.

If a profile has no `remoteAllowedCwd` entries, all remote CWD requests are denied.

Source: `src/targets/remote-cwd-policy.ts`

### Credential Handling

- Key file paths are stored in config, but **private key content is never logged, stored in metadata, or written to artifacts**
- ssh-agent socket paths are referenced but MCP never sends data to the socket beyond what `ssh2` requires for authentication
- Passphrase support: only via environment variable reference (`passphraseEnv` field), never as plaintext in config
- Config files containing forbidden keys (`password`, `privateKey`, `privateKeyContent`, `token`) are rejected at load time

### Command Safety

The same deny/allow/risky command model applies to remote sessions:

- Built-in deny list: `sudo`, `rm`, `ssh`, `curl`, etc.
- `TERMINAL_USE_ALLOW_COMMANDS` overrides the deny list (allow takes priority)
- `TERMINAL_USE_DENY_COMMANDS` extends it
- `TERMINAL_USE_RISKY_COMMAND_MODE`: `deny` (default), `ask`, or `allow`

Source: `src/terminal/command-safety.ts`

---

## 7. Host Fingerprint Pinning

Profiles can pin a host's expected fingerprint via `pinnedHostFingerprint`:

```
SHA256:uNiVztksCsDhcc0u9e8BgrgrXK+J2wm0wdFz5q9ZYQo
MD5:1a:2b:3c:4d:5e:6f:7g:8h:9i:0j:1k:2l:3m:4n:5o:6p
```

When set:

1. The actual host key fingerprint is computed during the SSH handshake
2. It is compared against the pinned value (normalizing format differences)
3. On mismatch or format error, the connection is rejected

This provides protection beyond known_hosts — a compromised known_hosts file cannot bypass the pin.

Source: `src/targets/host-fingerprint.ts` → `verifyPinnedFingerprint()`

---

## 8. Tool Integration

The MCP server exposes SSH-related tools for target discovery and management:

### Target Discovery

| Tool | Description |
|------|-------------|
| `terminal.targets` | Lists available targets: `{ kind: "local" }` plus all SSH profiles from `hosts.json` |
| `terminal.target_info` | Returns redacted profile details (auth type shown, key paths and socket paths redacted) |
| `terminal.verify_target` | Pre-flight validation: checks profile exists, auth is resolvable, known_hosts accessible. **Does NOT** open an SSH connection |

### Remote Tmux Management

| Tool | Description |
|------|-------------|
| `terminal.tmux_list` | List tmux sessions on a remote host via `ssh <host> tmux list-sessions` |
| `terminal.tmux_kill` | Kill a tmux session on a remote host via `ssh <host> tmux kill-session` |

Both `tmux_list` and `tmux_kill` accept an optional `profile` / `target` parameter. When a remote target is specified, the command is forwarded through SSH.

---

## 9. Inline SSH Targets (Disabled by Default)

By default, SSH targets must be pre-configured in `hosts.json`. The environment variable `TERMINAL_USE_ALLOW_INLINE_SSH_TARGETS=1` enables inline host specification in tool calls ( `{ kind: "ssh", host, port, username, auth }` without a profile name).

This is disabled by default because inline targets bypass profile-based CWD policies and may encourage insecure patterns. When enabled, inline targets still enforce strict host key checking and key/agent-only auth.

---

## 10. Limitations

### ssh-pty

| Limitation | Detail |
|------------|--------|
| **No disconnect recovery** | When the SSH connection drops, the remote PTY process and all session state are lost. There is no reconnection mechanism. |
| **Scrollback is limited** | Only the current xterm-headless buffer is available for find/scrollback. Complete remote history is not accessible. |
| **No attach** | Each `start()` creates a new SSH exec channel. There is no way to re-attach to a disconnected session. |
| **No rename** | Session ID is assigned at creation and cannot be changed. |

### ssh-tmux

| Limitation | Detail |
|------------|--------|
| **Per-command SSH overhead** | Every tmux operation (send-keys, capture-pane, etc.) opens a new SSH connection. This adds latency compared to the persistent channel in ssh-pty. |
| **tmux 3.2+ required on remote** | The server requires tmux 3.2+ for `resize-window` support. tmux <3.2 is rejected (fail-closed). |
| **Snapshot-based parsing** | Highlights are parsed from periodic `capture-pane -e` snapshots, not from a real-time data stream. Rapidly changing screens may produce stale snapshots. |

### Cross-provider

| Limitation | Detail |
|------------|--------|
| **CWD validation is local** | Remote CWD policy checks run locally via string prefix matching (`normalizeRemotePath`). The server does not resolve remote symlinks — a remote symlink pointing outside the allowed CWD root (e.g. `/home/user/dev/link → /etc`) will pass string validation but access a denied directory at runtime. |
| **No Windows SSH host support for ssh-tmux** | ssh-tmux requires tmux on the remote host, which is Unix-only. ssh-pty works with Windows SSH hosts (ConPTY). |
| **System SSH transport dependency** | ssh-tmux requires the `ssh` binary on the local PATH. If missing, only ssh-pty is available for remote sessions. |

---

## 11. Error Handling

SSH-specific errors are mapped to typed error codes:

| Error Code | Trigger |
|------------|---------|
| `SSH_HOST_KEY_MISMATCH` | Host key in known_hosts doesn't match actual key (rotation or MITM) |
| `SSH_HOST_KEY_UNKNOWN` | Host not found in known_hosts and no pinned fingerprint |
| `SSH_AUTH_FAILED` | Authentication failed (wrong key, agent unavailable, etc.) |
| `SSH_CONNECT_TIMEOUT` | Connection timeout (unreachable host, firewall) |
| `SSH_CONNECTION_LOST` | Connection dropped after establishment (ssh-pty only) |
| `REMOTE_CWD_DENIED` | Requested CWD not in profile's `remoteAllowedCwd` |
| `REMOTE_TMUX_NOT_AVAILABLE` | `tmux` not found on remote host |
| `REMOTE_COMMAND_DENIED` | Startup command blocked by deny list |

Source: `src/terminal/errors.ts`

---

## 12. Source File Index

| File | Responsibility |
|------|---------------|
| `src/providers/ssh-pty-provider.ts` | ssh-pty provider: ssh2 connection, PTY channel, xterm-adapter integration |
| `src/providers/ssh-tmux-provider.ts` | ssh-tmux provider: system SSH + remote tmux lifecycle |
| `src/providers/system-ssh-transport.ts` | `execFile("ssh", ...)` wrapper with security options and error mapping |
| `src/providers/provider-registry.ts` | Provider registration and whitelist filtering |
| `src/providers/provider.ts` | `ProviderName`, `ProviderCapabilities`, `TerminalProvider` interface |
| `src/targets/ssh-host-config.ts` | Profile loading: hosts.json, overlay files, OpenSSH config merge |
| `src/targets/ssh-auth.ts` | Auth resolution: agent socket discovery, key-file validation |
| `src/targets/ssh-profile-loader.ts` | Target resolution: profile lookup by name, inline target handling |
| `src/targets/ssh-config-parser.ts` | OpenSSH `~/.ssh/config` parser |
| `src/targets/target-types.ts` | `SshHostProfile`, `SshAuthRef`, `TerminalTarget`, `SshSessionMetadata` types |
| `src/targets/host-fingerprint.ts` | Fingerprint computation, parsing, and pinned-fingerprint verification |
| `src/targets/known-hosts.ts` | known_hosts file parser and host key lookup |
| `src/targets/remote-cwd-policy.ts` | Remote CWD allow/deny policy enforcement |
| `src/targets/config-schema.ts` | Zod schemas for profile validation (forbidden key rejection) |
| `src/targets/ssh-host-config-helpers.ts` | Tilde expansion, path utilities |
| `src/targets/xdg-paths.ts` | XDG config/data directory resolution |
