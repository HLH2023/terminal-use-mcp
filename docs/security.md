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
