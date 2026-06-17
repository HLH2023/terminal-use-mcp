# Changelog

All notable changes to terminal-use-mcp will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-06-17

### Added

- **Capability presets** (`TERMINAL_USE_CAPABILITY_PRESET`): Named provider configurations — `local`, `remote`, `persistent`, `remote-persistent`, `full`, `custom`. Simplifies SSH provider setup.
- **Tool profiles** (`TERMINAL_USE_TOOL_PROFILE`): Control which MCP tools are registered — `minimal`, `local-tui`, `remote-tui`, `persistent-tui`, `full`, `auto`. `TERMINAL_USE_TOOLS` for allowlist override, `EXTRA_TOOLS` and `DISABLED_TOOLS` for fine-tuning.
- **Enhanced `terminal.health`**: Now reports releaseState, capabilityPreset, toolProfile, registeredTools, disabledTools, configWarnings, registeredInternalBackends, disabledInternalBackends, remoteCapabilityEnabled, sshProfilesCount, and securitySummary.
- **ProxyJump fail-closed**: `ssh-pty` (ssh2.Client) rejects sessions with `proxyJump` configured. Use `ssh-tmux` or `remote-persistent` preset instead.
- **sshDefaults merge**: Global SSH defaults (`remoteDeniedCwd`, `allowTmux`, `connectTimeoutMs`, `keepaliveIntervalMs`) are merged into all SSH profiles. Profile values take priority.
- **Remote CWD canonical validation**: SSH providers now preflight `cd <cwd> && pwd -P` to resolve symlinks and validate the canonical path against CWD policy. Fail-closed.
- **Hashed known_hosts detection**: Detects hashed entries in `~/.ssh/known_hosts` and recommends `pinnedHostFingerprint`. Never suggests `StrictHostKeyChecking=no`.
- **SSH agent discovery mode** (`TERMINAL_USE_SSH_AGENT_DISCOVERY`): Control socket discovery — `env-only`, `xdg` (default), `scan`. Default no longer includes runtime scan.
- **Secret env policy** (`TERMINAL_USE_SECRET_ENV_POLICY`): Detect suspected secret env vars in `input.env` and `profile.env`. Default: `deny`. Options: `warn`, `allow`.
- **Session ID match mode** (`TERMINAL_USE_SESSION_ID_MATCH`): `strict` (exact + prefix strip only) or `lenient` (default, + fuzzy suffix). Multiple fuzzy matches rejected with `SESSION_AMBIGUOUS`.
- **Audit log** (`TERMINAL_USE_AUDIT_LOG`): All tool invocations recorded to `<artifactDir>/audit.ndjson`. Redacted input summaries. Best-effort writes. Default: enabled.
- **New error codes**: `PROXY_JUMP_UNSUPPORTED`, `SECRET_ENV_DENIED`, `SESSION_AMBIGUOUS`.

### Changed

- `terminal.health` output significantly expanded with v0.2.0 configuration and security fields.
- `ssh-pty` now fails closed on ProxyJump instead of silently ignoring it.
- SSH agent discovery defaults to `xdg` mode (no runtime scan by default).
- `sessionIdMatchMode` defaults to `lenient` (preserves current behavior); `strict` mode available for production.
- Version source consolidated to `src/version.ts` — `src/index.ts` no longer hardcodes version string.

### Security

- **ProxyJump fail-closed**: Prevents silent SSH direct connection when ProxyJump is intended.
- **Remote CWD canonical preflight**: Prevents symlink bypass of remote CWD policy.
- **Secret env deny by default**: Prevents accidental secret exposure through environment variables.
- **SSH agent discovery restricted**: Default `xdg` mode avoids runtime `ss -x` scanning.
- **Hashed known_hosts handled safely**: No fallback to insecure host key acceptance.
