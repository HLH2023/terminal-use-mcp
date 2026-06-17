---
name: terminal-use-setup
description: 'Configuration & setup guide for terminal-use-mcp — MCP client config, env vars, SSH targets, provider selection, version management.'
---

# terminal-use-setup: Configuration & Setup Guide

> **terminal-use-mcp v0.2.0** — This skill is maintained alongside the MCP server. **Version check**: call `terminal.health` → compare the `version` field with this header. If mismatched, prompt the user to update. The `terminal-use` skill makes this check mandatory before first terminal operation (Pre-flight Check section).

> This skill covers **installation, MCP configuration, environment variables, version management, and SSH setup** for terminal-use-mcp.
> For **how to use the tools** (operation loop, safety rules, patterns), see the `terminal-use` skill instead.

## When To Use

- You need to **install or configure** terminal-use-mcp as an MCP server.
- You need to **set or adjust** environment variables (CWD policy, command safety, session behavior, providers).
- You need to **set up SSH remote access** (hosts.json, profiles, authentication).
- You need to **check or update** the server version, or understand npx caching behavior.
- You need to **configure** the config.json file for persistent settings.

## Quick Configuration

### OpenCode

Add to `.opencode/opencode.json` in the `mcp` field:

```json
{
  "mcp": {
    "terminal-use": {
      "type": "local",
      "command": ["npx", "-y", "terminal-use-mcp"],
      "enabled": true,
      "environment": {
        "TERMINAL_USE_WORKSPACE_ROOT": "<your-project-path>",
        "TERMINAL_USE_ALLOWED_CWD": "<your-project-path>,/tmp",
        "TERMINAL_USE_PROVIDERS": "native-pty,tmux"
      }
    }
  }
}
```

### Claude Code / Claude Desktop

Add to `.mcp.json` (project root) or `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "terminal-use": {
      "command": "npx",
      "args": ["-y", "terminal-use-mcp"],
      "env": {
        "TERMINAL_USE_WORKSPACE_ROOT": "<your-project-path>",
        "TERMINAL_USE_ALLOWED_CWD": "<your-project-path>,/tmp",
        "TERMINAL_USE_PROVIDERS": "native-pty,tmux"
      }
    }
  }
}
```

### Codex CLI

Add to `.codex/config.json` in the `mcp_servers` field:

```json
{
  "mcp_servers": {
    "terminal-use": {
      "command": "npx",
      "args": ["-y", "terminal-use-mcp"],
      "env": {
        "TERMINAL_USE_WORKSPACE_ROOT": "<your-project-path>",
        "TERMINAL_USE_ALLOWED_CWD": "<your-project-path>,/tmp",
        "TERMINAL_USE_PROVIDERS": "native-pty,tmux"
      }
    }
  }
}
```

### With Remote SSH Support

```json
{
  "mcpServers": {
    "terminal-use": {
      "command": "npx",
      "args": ["-y", "terminal-use-mcp"],
      "env": {
        "TERMINAL_USE_WORKSPACE_ROOT": "/path/to/your/project",
        "TERMINAL_USE_SESSION_TTL_MS": "3600000",
        "TERMINAL_USE_ALLOWED_CWD": "/path/to/your/project,/tmp",
        "TERMINAL_USE_HOSTS_CONFIG": "/home/hlh/.config/terminal-use-mcp/hosts.json"
      }
    }
  }
}
```

Do NOT set `TERMINAL_USE_ALLOW_INLINE_SSH_TARGETS=1` in production configurations.

---

## Environment Variables

### Core Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `TERMINAL_USE_PROVIDERS` | All providers | Enabled provider whitelist (comma-separated) |
| `TERMINAL_USE_DEFAULT_PROVIDER` | `native-pty` | Default provider (overrides auto-selection priority) |
| `TERMINAL_USE_TMUX_PATH` | `tmux` | Absolute or relative path to tmux binary (when not on PATH) |
| `TERMINAL_USE_WORKSPACE_ROOT` | `process.cwd()` | Root directory for CWD validation |
| `TERMINAL_USE_ALLOWED_CWD` | _(empty; workspace root is always allowed via TERMINAL_USE_WORKSPACE_ROOT)_ | Comma-separated additional allowed directories |
| `TERMINAL_USE_CWD_POLICY_MODE` | `guarded` | CWD policy mode: `guarded` (allow workspaceRoot/allowedCwdRoots + non-denied dirs) or `strict` (only workspaceRoot/allowedCwdRoots). Production recommendation: `strict` |
| `TERMINAL_USE_ALLOW_COMMANDS` | _(empty)_ | Comma-separated commands to allow despite denylist |
| `TERMINAL_USE_DENY_COMMANDS` | _(empty)_ | Additional commands to deny |
| `TERMINAL_USE_RISKY_COMMAND_MODE` | `deny` | How to handle risky commands: `deny`, `ask`, `allow` |

### Session & Behavior

| Variable | Default | Purpose |
|----------|---------|---------|
| `TERMINAL_USE_SESSION_TTL_MS` | `3600000` (1 hour) | Session auto-cleanup timeout |
| `TERMINAL_USE_CLEANUP_INTERVAL_MS` | `60000` (1 min) | How often to check for expired sessions |
| `TERMINAL_USE_DEFAULT_COLS` | `120` | Default terminal columns for new sessions |
| `TERMINAL_USE_DEFAULT_ROWS` | `30` | Default terminal rows for new sessions |
| `TERMINAL_USE_LARGE_PASTE_LIMIT` | `2000` | Paste size threshold requiring confirmation (characters) |
| `TERMINAL_USE_HARD_PASTE_LIMIT` | `10000` | Hard paste size limit — pastes above this are always refused (characters) |
| `TERMINAL_USE_LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |
| `TERMINAL_USE_HOSTS_CONFIG` | XDG config dir / hosts.json (profiles/*.json takes priority) | Path to SSH host profiles configuration file |
| `TERMINAL_USE_ALLOW_INLINE_SSH_TARGETS` | _(not set — denied)_ | Set to `1` to allow inline SSH host specification in tool calls |
| `TERMINAL_USE_STORE_RAW_TRANSCRIPT` | _(not set — only redacted)_ | Set to `1` to also save raw (unredacted) transcript files |

### Path Overrides

| Variable | Default | Purpose |
|----------|---------|---------|
| `TERMINAL_USE_ARTIFACT_DIR` | `<data-dir>/artifacts` | Override artifact/transcript output directory |
| `TERMINAL_USE_CONFIG_DIR` | See XDG/platform defaults | Override XDG config directory |
| `TERMINAL_USE_CONFIG_FILE` | `<config-dir>/config.json` | Override config.json file path |
| `TERMINAL_USE_DATA_DIR` | See XDG/platform defaults | Override XDG data directory (artifact, session data) |

### XDG / Platform Paths

| Variable | Purpose | Platform |
|----------|---------|----------|
| `XDG_CONFIG_HOME` | XDG config home — app appends `terminal-use-mcp/` | Linux, macOS |
| `XDG_DATA_HOME` | XDG data home — app appends `terminal-use-mcp/` | Linux, macOS |
| `XDG_RUNTIME_DIR` | XDG runtime directory (used for SSH agent socket discovery) | Linux |
| `APPDATA` | Windows roaming app data — app appends `terminal-use-mcp/` | Windows |
| `LOCALAPPDATA` | Windows local app data — app appends `terminal-use-mcp/` | Windows |
| `ComSpec` | Windows command interpreter path (used by native-pty shell wrapping) | Windows |

### SSH Authentication

| Variable | Purpose |
|----------|---------|
| `SSH_AUTH_SOCK` | SSH agent socket path (auto-discovered if unset; see ssh-auth.ts discovery chain) |
| `SSH_PROXY_JUMP` | SSH ProxyJump configuration (passed to SSH connection) |

---

## CWD Policy Mode

`TERMINAL_USE_CWD_POLICY_MODE` controls which directories `terminal.start` can use as working directories.

| Mode | Behavior |
|------|----------|
| `guarded` (default) | Allows `workspaceRoot` + `allowedCwd`, blocks known dangerous roots (`/`, `/root`, `/etc`, `/boot`, `/proc`, `/sys`, etc.), allows other non-denied dirs |
| `strict` | Only allows `workspaceRoot` + `allowedCwd` — all other dirs denied |

**Recommendations**:
- For **local development**: `guarded` is usually sufficient — you may need `/tmp` or project dirs outside workspaceRoot.
- For **production / agent / homelab**: set `strict` to make CWD a true allowlist. No dir outside workspaceRoot/allowedCwdRoots can be used.

Invalid env var values (e.g., `permissive`, `open`) fall back to `guarded` with a warning log.

---

## config.json

terminal-use-mcp supports a persistent configuration file at `~/.config/terminal-use-mcp/config.json` (or `TERMINAL_USE_CONFIG_FILE` override). This file is loaded on startup and merged with environment variables (env vars take priority).

### Supported Fields

```json
{
  "cwdPolicyMode": "strict",
  "workspaceRoot": "/home/user/project",
  "allowedCwd": "/home/user/project,/tmp",
  "providers": "native-pty,tmux",
  "defaultProvider": "native-pty",
  "tmuxPath": "tmux",
  "allowCommands": "",
  "denyCommands": "",
  "riskyCommandMode": "deny",
  "sessionTtlMs": 3600000,
  "cleanupIntervalMs": 60000,
  "defaultCols": 120,
  "defaultRows": 30,
  "largePasteLimit": 2000,
  "hardPasteLimit": 10000,
  "logLevel": "info",
  "hostsConfig": "",
  "allowInlineSshTargets": false,
  "storeRawTranscript": false
}
```

Only include fields you want to override. Missing fields use defaults. Environment variables override config.json values.

---

## Version & Updates

### Checking Your Version

Call `terminal.health` — the response includes a `version` field reflecting the running server version.

### Detecting Outdated Skills

**Core skills** (`terminal-use`, `terminal-use-setup`) track the server version. The `terminal-use` skill includes a **Pre-flight Check** section that makes this check mandatory before the first terminal operation in each session.

The check covers three things:
1. **Server is running** — `terminal.health` must succeed
2. **Providers are available** — at least one provider must be enabled and healthy
3. **Version matches** — compare `terminal.health.version` with the SKILL.md version header

Version mismatch handling:

| Condition | Meaning | Action |
|-----------|---------|--------|
| Server == Skill | In sync | Proceed normally |
| Server > Skill | Skill is outdated | Prompt: *"Skills outdated (v{skill} vs server v{server}). Update with `npx skills update`."* May still proceed. |
| Server < Skill | Server is outdated | Prompt: *"Server outdated (v{server} vs skill v{skill}). Update with `npx -y terminal-use-mcp@latest`."* May still proceed. |

**TUI skills** (`tui-*`) use the target program version, not the server version. They cannot be auto-detected as outdated — you'll notice when keybindings stop working after the target program updates.

**Recommended practice**: The Pre-flight Check in the `terminal-use` skill enforces this automatically. If you've trimmed that section, check manually on first terminal tool usage in each session.

### npx Caching Behavior

`npx` **does not auto-update**. It caches the package on first run and reuses the cached version until the cache expires.

| Intent | Command |
|--------|---------|
| Run latest | `npx -y terminal-use-mcp@latest` |
| Pin a version | `npx -y terminal-use-mcp@0.2.0` |
| Force refresh cache | `npx -y terminal-use-mcp@latest` (the `@latest` tag bypasses cache) |
| Clear npx cache entirely | `npx clear-npx-cache` |

### Skill Versioning

terminal-use-mcp provides two categories of skills:

| Skill | Version Header | Maintenance |
|-------|---------------|-------------|
| `terminal-use` (operations) | `terminal-use-mcp vX.Y.Z` — tracks the MCP server version | **Maintained** alongside server releases |
| `terminal-use-setup` (configuration) | `terminal-use-mcp vX.Y.Z` — tracks the MCP server version | **Maintained** alongside server releases |
| `tui-*` (agent-specific) | `Reference: <Program> vX.Y.Z` — verified against a specific target version | **Community-maintained** — NOT updated in lockstep with target program releases |

If a TUI program updates and keybindings change, update the corresponding skill yourself or submit a PR. The core `terminal-use` and `terminal-use-setup` skills are updated with each server release.

### Updating Skills

**Via skills.sh (recommended)**:

```bash
# Update all installed terminal-use-mcp skills
npx skills update

# Update a specific skill
npx skills update terminal-use
```

**Manual update**: Download the latest SKILL.md from [GitHub](https://github.com/HLH2023/terminal-use-mcp/tree/main/skills) and replace the file in your project's skill directory (`.claude/skills/`, `.opencode/skills/`, `.codex/skills/`).

---

## Remote SSH Configuration

### hosts.json Path

SSH profiles are loaded from:

```
~/.config/terminal-use-mcp/hosts.json
```

Or override via environment variable:

```
TERMINAL_USE_HOSTS_CONFIG=/path/to/hosts.json
```

Alternatively, place individual profile files in `profiles/*.json` under the config directory — they take priority over the top-level `hosts.json`.

### hosts.json Example

```json
{
  "hosts": {
    "devbox": {
      "host": "192.168.1.20",
      "port": 22,
      "username": "hlh",
      "auth": {
        "type": "agent"
      },
      "knownHosts": "~/.ssh/known_hosts",
      "defaultCwd": "/home/hlh/dev",
      "remoteAllowedCwd": [
        "/home/hlh/dev",
        "/srv/lab"
      ],
      "remoteDeniedCwd": [
        "/",
        "/root",
        "/etc",
        "/boot",
        "/proc",
        "/sys"
      ],
      "allowTmux": true,
      "connectTimeoutMs": 10000,
      "keepaliveIntervalMs": 15000
    }
  }
}
```

**Security**: The hosts.json file must NOT contain passwords, private key content, tokens, passphrases, or `.env` values. Key-file auth only stores the file path. Passphrases are referenced by env var name via `passphraseEnv`, never by value.

### Inline SSH Target Control

Inline SSH targets (host/port/username specified directly in the tool call) are **denied by default**. To enable:

```
TERMINAL_USE_ALLOW_INLINE_SSH_TARGETS=1
```

This is intended for development and testing only. Production use should always rely on SSH profiles.

### Remote Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `TERMINAL_USE_HOSTS_CONFIG` | XDG config dir / hosts.json (profiles/*.json takes priority) | Path to SSH host profiles configuration file |
| `TERMINAL_USE_ALLOW_INLINE_SSH_TARGETS` | _(not set)_ | Set to `1` to allow inline SSH host specification in tool calls |
| `SSH_AUTH_SOCK` | _(auto-discovered)_ | SSH agent socket path (discovered via: `auth.socket` → env var → `XDG_RUNTIME_DIR/ssh-agent.socket` → `XDG_RUNTIME_DIR/keyring/ssh` → runtime scan) |
| `SSH_PROXY_JUMP` | _(not set)_ | SSH ProxyJump configuration (passed to SSH connection) |

---

## stdio Transport

The MCP server uses **stdio transport** — it reads from stdin and writes to stdout. All logging goes to stderr. This means:

- **stdout** is reserved for MCP protocol messages — never pipe other output there
- **stderr** contains structured logs for debugging
- The server shuts down cleanly on `SIGINT`/`SIGTERM`

---

## Provider Selection

| Provider | Use Case | Key Advantage |
|----------|----------|---------------|
| `native-pty` | Most interactive TUI programs (default) | Fast response, high-quality snapshots, highlight detection |
| `tmux` | Sessions needing persistence, disconnect recovery, multi-user attach | Attachable, sessions survive MCP restart |
| `ssh-pty` | TUI programs on remote hosts | Reuses local xterm/snapshot/transcript stack over SSH |
| `ssh-tmux` | Persistent remote sessions, disconnect recovery, human-attachable | Full remote tmux lifecycle management |

Auto-selection: local → native-pty (fallback tmux); remote → ssh-pty (fallback ssh-tmux).

### Provider Configuration

Control which providers are available via the `TERMINAL_USE_PROVIDERS` environment variable (comma-separated whitelist). If unset, all providers are enabled.

| Value | Effect |
|-------|--------|
| _(not set)_ | All providers enabled |
| `native-pty,tmux` | Local only — no SSH providers |
| `tmux` | tmux only — useful in environments without node-pty |
| `ssh-pty,ssh-tmux` | Remote only — no local terminal providers |

Disabled providers are excluded from registration and auto-selection. `terminal.health` reports them as `"disabled by TERMINAL_USE_PROVIDERS config"`.

---

## Customization Guide

This skill is designed to be **trimmed to your needs**. Each section is self-contained — delete any sections you don't need to reduce token consumption.

| Section | Content | Safe to Remove? |
|---------|---------|-----------------|
| §1 Quick Configuration | MCP client config examples for OpenCode/Claude/Codex | ⚠️ Keep until MCP is configured |
| §2 Environment Variables | Full env var reference (4 sub-tables) | ✅ Remove once you've set your env vars |
| §3 CWD Policy Mode | guarded vs strict explanation | ✅ Remove if using default guarded mode |
| §4 config.json | Persistent config file format | ✅ Remove if you only use env vars |
| §5 Version & Updates | Version check, npx caching, skill versioning | ✅ Remove after initial setup |
| §6 Remote SSH Configuration | hosts.json, inline SSH, env vars | ✅ Remove if you only use local terminals |
| §7 stdio Transport | stdout/stderr behavior | ✅ Remove — informational only |
| §8 Provider Selection | Provider types and configuration | ✅ Remove if using default providers |

**Minimal viable skill**: §1 + §3 (~40 lines). Everything else is reference material.
