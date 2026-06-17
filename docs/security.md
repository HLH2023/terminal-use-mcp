[Back to README](../README.md)

# Security Policies — terminal-use-mcp

## Table of Contents

- [Command Safety](#command-safety)
- [CWD Policy](#cwd-policy)
- [Secret Redaction](#secret-redaction)
- [Confirmation Detection](#confirmation-detection)
- [observationTrust](#observationtrust)
- [Remote Security Restrictions](#remote-security-restrictions)
- [Security Restrictions Summary](#security-restrictions-summary)
- [Capability Presets](#capability-presets)
- [Tool Profiles](#tool-profiles)
- [Secret Env Policy](#secret-env-policy)
- [SSH Agent Discovery Mode](#ssh-agent-discovery-mode)
- [Session ID Match Mode](#session-id-match-mode)
- [Audit Log](#audit-log)
- [Remote CWD Canonical Validation](#remote-cwd-canonical-validation)
- [ProxyJump Fail-Closed](#proxyjump-fail-closed)
- [Hashed known_hosts](#hashed-known_hosts)
- [Environment Variables](#environment-variables)

terminal-use-mcp is not a sandbox. Security policies restrict the entry point, not the TUI program's internal behavior.

## Command Safety

Startup command deny list:

```
sudo, su, sh, ssh, scp, sftp, rm, dd, mkfs,
shutdown, reboot, chmod, chown, curl, wget,
nc, ncat, telnet
```

**Windows-specific:**
`cmd`, `cmd.exe`, `powershell`, `powershell.exe`, `pwsh`, `pwsh.exe`, `del`, `erase`, `rmdir`, `rd`, `format`, `diskpart`, `reg`, `reg.exe`, `takeown`, `icacls`, `net`, `net.exe`, `netsh`, `netsh.exe`, `sc`, `sc.exe`, `taskkill`, `taskkill.exe`

Note: Command matching is case-insensitive.

```ts
// Environment variable overrides
TERMINAL_USE_ALLOW_COMMANDS=git,make    // additional allow
TERMINAL_USE_DENY_COMMANDS=node,python3  // additional deny
TERMINAL_USE_RISKY_COMMAND_MODE=deny     // deny | ask | allow
```

Under `ask` mode, dangerous commands return `CONFIRMATION_REQUIRED`. The agent should stop and ask the user.

**Boundary**: command policy only restricts the startup command passed to `terminal.start`. TUI subprocesses, REPL `eval()`/`exec()`, and shell chains within the TUI are not restricted. The deny list is not a complete sandbox.

## CWD Policy

Local CWD validation:

```ts
// Allowed by default
const allowedCwdRoots = [
  process.cwd(),
  process.env.TERMINAL_USE_WORKSPACE_ROOT,
  ...splitCsv(process.env.TERMINAL_USE_ALLOWED_CWD),
]

// Denied by default (unless under an allowedCwdRoots subtree)
const deniedCwdRoots = ["/", "/root", "/home", "/etc", "/usr", "/var", "/sys", "/proc", "/boot"]
```

When workspace root is `$HOME/dev/homelab`, `$HOME/dev/homelab/**` is allowed, but the entire `$HOME` is not.

Remote CWD uses independent validation with `remoteAllowedCwd` / `remoteDeniedCwd` from the profile, not local rules. **Known limitation**: remote CWD validation is string-based prefix matching — remote symlinks pointing outside allowed roots are not detected.

## Secret Redaction

The following patterns are automatically replaced with `<REDACTED_*>` in snapshots and transcripts:

```ts
const SECRET_PATTERNS = [
  /ghp_[0-9a-zA-Z]{36}/g,           // GitHub PAT
  /sk-[a-zA-Z0-9]{20}T3BlbkFJ.+/g,  // OpenAI key
  /sk-ant-[a-zA-Z0-9-]+/g,          // Anthropic key
  /(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}/g,  // AWS key
  /Bearer\s+[a-zA-Z0-9\-._~+/]+=*/g,      // Bearer token
  /-----BEGIN .* PRIVATE KEY----[\s\S]*?-----END .* PRIVATE KEY-----/g,  // Private key block
  /(?<=^|\n)\s*(password|secret|token|api_key)\s*=\s*.+/gi,  // .env style
]
```

## Confirmation Detection

Snapshots automatically detect dangerous prompts on screen:

```ts
const CONFIRMATION_PATTERNS = [
  /\bapprov[ei]\b/i, /\ballow\b/i, /\bconfirm\b/i,
  /\boverwrite\b/i, /\bdelete\b/i, /\bpassword\b/i,
  /\[y\/n\]/i, /\[Y\/n\]/i,
  /\bAllow command\??/i, /\bRun command\??/i,
]
```

Severity levels: `high` (credential/destructive prompt, agent must stop and ask user), `medium` (confirmation prompt, proceed with caution), `low` (generic approval, normal judgment applies).

## observationTrust

All snapshots return:

```ts
{ observationTrust: "untrusted" }
```

Terminal output is untrusted observation, not instruction.

## Remote Security Restrictions

> See [REMOTE_TERMINAL_GUIDE.md](REMOTE_TERMINAL_GUIDE.md) for the full remote design.

| Rule | Description |
|------|-------------|
| Strict host key verification | Must pass via known_hosts or pinned fingerprint; unverified connections are refused |
| No password login | `SshAuthRef` does not include `type: "password"` |
| Inline SSH denied by default | Direct host/port in tool call is refused unless `TERMINAL_USE_ALLOW_INLINE_SSH_TARGETS=1` |
| No auto-approve of agent permission prompts | "Allow command?" / "Apply changes?" in remote TUI, agent must stop and ask user |
| Remote terminal output is untrusted | `observationTrust: "untrusted"` applies to remote as well |

## Security Restrictions Summary

| Restriction | Local | Remote |
|-------------|-----------|-------------|
| Command deny list | Yes | Yes |
| CWD allowlist | Yes | Yes (independent policy) |
| Secret redaction | Yes | Yes (additionally redacts hostname/username/home path) |
| Confirmation detection | Yes | Yes (extended: remote_privilege_prompt / remote_host_key_prompt) |
| observationTrust | `"untrusted"` | `"untrusted"` |
| Host key verification | N/A | Strict (known_hosts or pinned fingerprint) |
| Password login | N/A | Prohibited |
| Inline SSH target | N/A | Denied by default, must explicitly enable |
| Paste limits | >2000 chars requires confirmation, >10000 hard limit; secrets rejected | Same as local |

## Capability Presets

`TERMINAL_USE_CAPABILITY_PRESET` selects a predefined set of providers. When neither `TERMINAL_USE_PROVIDERS` nor `TERMINAL_USE_CAPABILITY_PRESET` is set, all providers are enabled (backward compat). `TERMINAL_USE_PROVIDERS` takes priority over `TERMINAL_USE_CAPABILITY_PRESET`.

| Preset | Providers | Use Case |
|--------|-----------|----------|
| `local` | native-pty, tmux | Local development only (no SSH) |
| `local-persistent` | tmux | Local sessions that survive MCP restart |
| `remote-interactive` | ssh-pty | Interactive remote TUI (highlights, snapshots) |
| `remote-persistent` | ssh-tmux | Persistent remote sessions (disconnect recovery) |
| `full` | native-pty, tmux, ssh-pty, ssh-tmux | All providers enabled |

```ts
TERMINAL_USE_CAPABILITY_PRESET=local  // default
```

## Tool Profiles

`TERMINAL_USE_TOOL_PROFILE` selects a predefined set of MCP tools. Useful for reducing the tool surface area exposed to the LLM.

| Profile | Tool Set | Use Case |
|---------|----------|----------|
| `minimal` | start, snapshot, type, press, kill | Bare-bones interaction loop |
| `local-tui` | minimal + wait_for_text, wait_stable, paste, scroll, find, resize, send_signal | Full local TUI control |
| `remote-tui` | local-tui + targets, target_info, verify_target | Local + remote SSH |
| `persistent-tui` | remote-tui + attach, tmux_list, tmux_kill | With tmux lifecycle |
| `full` | All 29 tools | Everything |
| `auto` | _(selects based on capability preset)_ | Default — adapts to enabled providers |

```ts
TERMINAL_USE_TOOL_PROFILE=auto       // default
TERMINAL_USE_EXTRA_TOOLS=mouse_click,mouse_scroll   // add tools beyond the profile
TERMINAL_USE_DISABLED_TOOLS=events,export_transcript // remove tools from the profile
```

## Secret Env Policy

`TERMINAL_USE_SECRET_ENV_POLICY` controls whether environment variables with names that look like secrets are allowed in `terminal.start` input.env and SSH profile env fields.

```ts
TERMINAL_USE_SECRET_ENV_POLICY=deny  // deny | warn | allow (default: deny)
```

Detected name patterns (case-insensitive suffix or substring):

```
TOKEN, SECRET, PASSWORD, PASSWD, API_KEY, APIKEY,
ACCESS_KEY, SECRET_KEY, PRIVATE_KEY, AUTH_TOKEN,
CREDENTIAL, AUTH
```

- **deny**: Reject the call with `SECRET_ENV_DENIED` error.
- **warn**: Log a warning but proceed.
- **allow**: No check — all env vars allowed.

Values of secret-named env vars are **never written** to audit logs or artifact files, regardless of policy.

## SSH Agent Discovery Mode

`TERMINAL_USE_SSH_AGENT_DISCOVERY` controls how the SSH agent socket is found when `auth.type === "agent"` and `auth.socket` is not explicitly set.

```ts
TERMINAL_USE_SSH_AGENT_DISCOVERY=xdg  // env-only | xdg | scan (default: xdg)
```

Discovery chain (stops at first found):

1. `auth.socket` (explicit in profile)
2. `SSH_AUTH_SOCK` environment variable
3. XDG runtime paths (`$XDG_RUNTIME_DIR/ssh-agent.sock`, `/run/user/<uid>/openssh_agent`)
4. `ss -x` Unix domain socket scan (only when mode is `scan`)

| Mode | Steps | Security |
|------|-------|----------|
| `env-only` | 1–2 only | Most restrictive — no filesystem probing |
| `xdg` | 1–3 | Default — standard XDG paths only |
| `scan` | 1–4 | Broadest — scans Unix sockets via `ss -x` |

## Session ID Match Mode

`TERMINAL_USE_SESSION_ID_MATCH` controls how session IDs are resolved when a tool receives a partial or human-readable session ID.

```ts
TERMINAL_USE_SESSION_ID_MATCH=lenient  // strict | lenient (default: lenient)
```

- **strict**: Exact match only. Prefix stripping (removing provider prefix) is allowed, but no fuzzy matching.
- **lenient**: Exact match first, then prefix strip, then fuzzy suffix match. If multiple sessions match fuzzily, the call is rejected with `SESSION_AMBIGUOUS` — the agent must use the exact ID.

## Audit Log

`TERMINAL_USE_AUDIT_LOG` controls whether security-relevant operations are recorded to `<artifactDir>/audit.ndjson`.

```ts
TERMINAL_USE_AUDIT_LOG=1  // 1 | 0 (default: 1)
```

Each line is a JSON object with: `timestamp`, `sessionId`, `tool`, `action`, and event-specific fields.

**Security constraints on audit content:**

- No secrets, keys, passphrases, or raw content values are ever written.
- `paste` events: only `length`, `mode`, and `secretDetected` (boolean) are recorded.
- `type` events: only `length` is recorded.
- `press` events: only `keyExpr` is recorded.
- `deny` and `error` events are always logged regardless of policy.
- Write failure does not break the main flow — errors are logged to stderr only.

## Remote CWD Canonical Validation

For SSH sessions, the server performs a preflight check to resolve the remote CWD to its canonical (symlink-free) path:

```
cd <cwd> && pwd -P
```

The resolved canonical path is validated against the remote CWD policy (remoteAllowedCwd / remoteDeniedCwd). This prevents symlink-based CWD bypass on remote hosts.

**Fail-closed**: If the preflight command fails (e.g., the directory does not exist), the session start is refused with `REMOTE_CWD_DENIED`.

## ProxyJump Fail-Closed

The `ssh-pty` provider (backed by `ssh2.Client`) does not support SSH ProxyJump (`-J` / `ProxyJump`). If an SSH profile defines `proxyJump` and the session is routed to `ssh-pty`, the call is rejected with:

```
PROXY_JUMP_UNSUPPORTED: ssh-pty does not support ProxyJump; use ssh-tmux or remove proxyJump from the profile
```

**Workaround**: Use the `ssh-tmux` provider (which shells out to system `ssh` and supports ProxyJump natively), or use the `remote-persistent` capability preset.

## Hashed known_hosts

When the user's `known_hosts` file contains hashed entries (format `|1|<salt>|<hash>`), hostname-based matching is impossible — the hash is one-way.

When a hashed entry is the only match for a host, the server:

1. Detects the hashed entry and returns `SSH_HOST_KEY_UNKNOWN` with a hint.
2. Recommends setting `pinnedHostFingerprint` in the SSH profile to bypass `known_hosts` lookup.
3. **Never** suggests `StrictHostKeyChecking=no` — this would disable host key verification entirely, violating the fail-closed security model.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TERMINAL_USE_WORKSPACE_ROOT` | `process.cwd()` | Root directory for CWD validation |
| `TERMINAL_USE_ALLOWED_CWD` | _(empty; workspace root is always allowed via TERMINAL_USE_WORKSPACE_ROOT)_ | Comma-separated additional allowed directories |
| `TERMINAL_USE_SESSION_TTL_MS` | `3600000` | Session auto-cleanup timeout (1 hour) |
| `TERMINAL_USE_CLEANUP_INTERVAL_MS` | `60000` | Cleanup check interval (1 minute) |
| `TERMINAL_USE_ALLOW_COMMANDS` | _(empty)_ | Comma-separated commands to allow despite denylist |
| `TERMINAL_USE_DENY_COMMANDS` | _(empty)_ | Additional commands to deny |
| `TERMINAL_USE_RISKY_COMMAND_MODE` | `deny` | Risky command handling: `deny` / `ask` / `allow` |
| `TERMINAL_USE_HOSTS_CONFIG` | XDG config dir / hosts.json (profiles/*.json takes priority) | SSH hosts configuration file path |
| `TERMINAL_USE_ALLOW_INLINE_SSH_TARGETS` | _(not set)_ | Set to `1` to allow inline SSH host specification in tool calls |
| `TERMINAL_USE_CAPABILITY_PRESET` | `local` | Provider preset: `local` / `local-persistent` / `remote-interactive` / `remote-persistent` / `full` |
| `TERMINAL_USE_TOOL_PROFILE` | `auto` | Tool profile: `minimal` / `local-tui` / `remote-tui` / `persistent-tui` / `full` / `auto` |
| `TERMINAL_USE_EXTRA_TOOLS` | _(empty)_ | Comma-separated tools to add beyond the selected profile |
| `TERMINAL_USE_DISABLED_TOOLS` | _(empty)_ | Comma-separated tools to remove from the selected profile |
| `TERMINAL_USE_SECRET_ENV_POLICY` | `deny` | Secret env var handling: `deny` / `warn` / `allow` |
| `TERMINAL_USE_SSH_AGENT_DISCOVERY` | `xdg` | SSH agent socket discovery mode: `env-only` / `xdg` / `scan` |
| `TERMINAL_USE_SESSION_ID_MATCH` | `lenient` | Session ID matching mode: `strict` / `lenient` |
| `TERMINAL_USE_AUDIT_LOG` | `1` | Audit log enabled: `1` / `0` |
