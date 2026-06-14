# terminal-use-mcp

Local + remote terminal interaction control MCP Server. Lets AI agents control interactive TUI programs the way a human would.

[![npm version](https://img.shields.io/npm/v/terminal-use-mcp.svg)](https://www.npmjs.com/package/terminal-use-mcp) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Node.js](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org/)

This is not a shell runner. Use your bash tool for simple commands. This server handles TUI programs that require keyboard interaction: lazygit, vim, htop, Python REPL, debuggers, installers, external agent TUIs (Claude Code, Codex CLI, OpenCode).

## Quick Start

### Prerequisites

| Dependency | Minimum | Purpose |
|------------|---------|---------|
| Node.js | 18+ | Run the MCP server |
| npm | 8+ | Install dependencies |
| node-gyp + C++ toolchain | -- | Compile node-pty native addon (optional; fallback to tmux if missing) |
| tmux | 3.2+ | tmux provider (optional; only native-pty available if missing) |

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TERMINAL_USE_WORKSPACE_ROOT` | Yes | `process.cwd()` | Root directory for CWD validation |
| `TERMINAL_USE_ALLOWED_CWD` | No | _(empty)_ | Comma-separated additional allowed directories |
| `TERMINAL_USE_SESSION_TTL_MS` | No | `3600000` | Session auto-cleanup timeout (1 hour) |

### MCP Client Configuration

#### Claude Code

Add to your project root `.mcp.json`:

```json
{
  "mcpServers": {
    "terminal-use": {
      "command": "npx",
      "args": ["-y", "terminal-use-mcp"],
      "env": {
        "TERMINAL_USE_WORKSPACE_ROOT": "<your-project-path>",
        "TERMINAL_USE_ALLOWED_CWD": "<your-project-path>,/tmp"
      }
    }
  }
}
```

#### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "terminal-use": {
      "command": "npx",
      "args": ["-y", "terminal-use-mcp"],
      "env": {
        "TERMINAL_USE_WORKSPACE_ROOT": "<your-project-path>",
        "TERMINAL_USE_ALLOWED_CWD": "<your-project-path>,/tmp"
      }
    }
  }
}
```

#### OpenCode

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
        "TERMINAL_USE_ALLOWED_CWD": "<your-project-path>,/tmp"
      }
    }
  }
}
```

stdio transport: stdout is reserved for MCP protocol. All logs go to stderr. Server cleans up all sessions on SIGINT/SIGTERM.

### Copy-Paste Setup (for AI agent one-shot install)

Paste the appropriate prompt below into your AI agent. It will handle installation, configuration, and verification autonomously.

#### Claude Code

```
Set up terminal-use-mcp with these steps:

1. Prerequisites check:
   - Confirm Node.js 18+ and npm 8+ are available (node -v / npm -v)

2. Configure MCP:
   - Create or edit .mcp.json in the project root, adding:
     {
       "mcpServers": {
         "terminal-use": {
           "command": "npx",
           "args": ["-y", "terminal-use-mcp"],
           "env": {
             "TERMINAL_USE_WORKSPACE_ROOT": "<current-project-absolute-path>",
             "TERMINAL_USE_ALLOWED_CWD": "<current-project-absolute-path>,/tmp"
           }
         }
       }
     }
   - Replace <current-project-absolute-path> with the actual path

3. Restart Claude Code for the config to take effect

4. Verify:
   - Confirm terminal.health, terminal.start etc. appear in the MCP tool list
   - Call terminal.health to confirm server and provider status are OK
   - If tools are not visible, check .mcp.json formatting and restart again

Constraints:
- Do not output any secrets
- Only notify me if node-pty compilation fails; handle other issues yourself
```

#### Claude Desktop

```
Set up terminal-use-mcp with these steps:

1. Prerequisites check:
   - Confirm Node.js 18+ and npm 8+ are available (node -v / npm -v)

2. Configure MCP:
   - Edit the Claude Desktop config file:
     - macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
     - Windows: %APPDATA%\Claude\claude_desktop_config.json
   - Add to mcpServers:
     "terminal-use": {
       "command": "npx",
       "args": ["-y", "terminal-use-mcp"],
       "env": {
         "TERMINAL_USE_WORKSPACE_ROOT": "<current-project-absolute-path>",
         "TERMINAL_USE_ALLOWED_CWD": "<current-project-absolute-path>,/tmp"
       }
     }
   - Replace <current-project-absolute-path> with the actual path

3. Fully quit and restart Claude Desktop

4. Verify:
   - Confirm terminal.health and similar tools appear in conversation
   - Call terminal.health to confirm server status is OK
   - If tools are not visible, check config file JSON format and path spelling

Constraints:
- Do not output any secrets
- Only notify me if node-pty compilation fails or config file cannot be found
```

#### OpenCode

```
Set up terminal-use-mcp with these steps:

1. Prerequisites check:
   - Confirm Node.js 18+ and npm 8+ are available (node -v / npm -v)

2. Configure MCP:
   - Add to .opencode/opencode.json in the mcp field:
     {
       "type": "local",
       "command": ["npx", "-y", "terminal-use-mcp"],
       "enabled": true,
       "environment": {
         "TERMINAL_USE_WORKSPACE_ROOT": "<current-project-absolute-path>",
         "TERMINAL_USE_ALLOWED_CWD": "<current-project-absolute-path>,/tmp"
       }
     }
   - Replace <current-project-absolute-path> with the actual path

3. Restart OpenCode for the config to take effect

4. Verify:
   - Confirm terminal.health, terminal.start etc. appear in the MCP tool list
   - Call terminal.health to confirm server and provider status are OK
   - If tools are not visible, check .opencode/opencode.json formatting and restart again

Constraints:
- Do not output any secrets
- Only notify me if node-pty compilation fails; handle other issues yourself
```

## Providers

| Provider | Use Case | Key Advantage |
|----------|----------|---------------|
| `native-pty` | Most interactive TUI programs (default) | Fast response, high-quality snapshots, highlight detection |
| `tmux` | Sessions needing persistence, disconnect recovery, multi-user attach | Attachable, sessions survive MCP restart |
| `ssh-pty` (V2) | TUI programs on remote hosts | Reuses local xterm/snapshot/transcript stack over SSH |
| `ssh-tmux` (V2) | Persistent remote sessions, disconnect recovery, human-attachable | Full remote tmux lifecycle management |

Auto-selection rules:

- Local: native-pty, falling back to tmux
- Remote (V2): ssh-pty, falling back to ssh-tmux (fallback response tagged with `fallbackFrom`)

## MCP Tools

### Session Lifecycle (7 tools)

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `terminal.start` | Start a terminal session | `command`, `args?`, `cwd`, `cols?`, `rows?`, `provider?`, `target?` (V2), `env?`, `label?`, `ttlMs?`, `transcript?` |
| `terminal.attach` | Attach to an existing session (tmux) | `sessionId` or `tmuxSessionName` |
| `terminal.list` | List all active sessions | _(none)_ |
| `terminal.info` | Query session details | `sessionId` |
| `terminal.rename` | Rename a session label | `sessionId`, `label` |
| `terminal.kill` | Terminate a session and its process | `sessionId` |
| `terminal.cleanup` | Clean up all expired sessions | _(none)_ |

### Observation (5 tools)

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `terminal.snapshot` | Capture current screen state | `sessionId`, `mode?` ("viewport" or "full") |
| `terminal.wait_for_text` | Wait for specific text to appear | `sessionId`, `text`, `regex?`, `timeoutMs?`, `caseSensitive?` |
| `terminal.wait_stable` | Wait until output stops changing | `sessionId`, `idleMs?`, `timeoutMs?` |
| `terminal.find` | Search for text in screen/scrollback | `sessionId`, `pattern`, `regex?`, `includeScrollback?` |
| `terminal.scroll` | Scroll the terminal viewport | `sessionId`, `direction`, `lines` |

### Input (5 tools)

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `terminal.type` | Type text into the terminal | `sessionId`, `text` |
| `terminal.press` | Send a key press (supports arbitrary combos) | `sessionId`, `key` (e.g. `"ctrl+p"`, `"alt+enter"`, `"f1"`, `"ctrl+shift+f"`) |
| `terminal.paste` | Paste large text (with safety checks) | `sessionId`, `text`, `confirmLargePaste?`, `mode?` |
| `terminal.mouse_click` | Mouse click (SGR-1006) | `sessionId`, `col`, `row`, `button?` (left/right/middle), `shift?`, `alt?`, `ctrl?` |
| `terminal.mouse_scroll` | Mouse wheel scroll (SGR-1006) | `sessionId`, `col`, `row`, `direction` (up/down), `lines?` (1-20), `shift?` |

### Meta (7 tools)

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `terminal.resize` | Change terminal dimensions | `sessionId`, `cols`, `rows` |
| `terminal.export_transcript` | Export session transcript | `sessionId`, `redact?`, `format?`, `includeSnapshots?` |
| `terminal.health` | Check server and provider status | _(none)_ |
| `terminal.keys` | List available key expressions (by category) | _(none)_ |
| `terminal.provider_capabilities` | Query provider capability matrix | `provider` |
| `terminal.events` | Get session event history | `sessionId`, `limit?`, `sinceSeq?` |
| `terminal.send_signal` | Send signal (SIGINT/SIGTERM/SIGKILL) | `sessionId`, `signal` |

### Remote Control (3 tools, V2 Design Phase)

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `terminal.targets` | List available targets (local + SSH) | _(none)_ |
| `terminal.target_info` | Query target details (redacted) | `profile` |
| `terminal.verify_target` | Verify SSH target connectivity | `profile` |

## Scrollback Strategy

Terminals have two buffer modes that affect how scrollback works. Understanding this distinction is critical for effective terminal control.

### Two Buffer Modes

| Mode | Programs | tmux `#{history_size}` | `snapshot(mode="full")` vs `mode="viewport"` |
|------|----------|------------------------|-----------------------------------------------|
| **Normal buffer** | bash, python REPL, shell commands | > 0 | `full` returns viewport + scrollback history |
| **Alternate buffer** | vim, htop, less, opencode, claude code, lazygit | = 0 | `full` is identical to `viewport` |

Alternate buffer (fullscreen TUI) programs have zero tmux scrollback. They take over the entire screen and manage their own internal scrolling. `terminal.scroll()` and `snapshot(mode="full")` provide no additional content for these programs.

### Snapshot Mode Recommendations

| Scenario | Recommended | Why |
|----------|-------------|-----|
| Normal shell, need recent output | `mode="viewport"` | Default, compact |
| Normal shell, need scrolled-off output | `mode="viewport"` + `scroll()` | Incremental, avoids context duplication |
| Normal shell, need ALL output at once | `mode="full"` | One-shot complete capture; use sparingly |
| TUI program (opencode/vim/htop) | `mode="viewport"` | `full` is identical, no savings |

### Browsing History in TUI Programs

`terminal.scroll()` enters tmux copy-mode, which does NOT work for TUI programs. Use the program's own navigation instead:

| Program | How to scroll/browse history |
|---------|------------------------------|
| **opencode** | `mouse_scroll` on conversation area; `ctrl+p` for session list; arrow keys to navigate |
| **claude code** | `mouse_scroll` on conversation; `ctrl+o` for transcript viewer; up/down for history |
| **codex cli** | `mouse_scroll` on conversation; `alt+r` for raw scrollback view; `ctrl+t` for transcript |
| **vim** | `ctrl+u` / `ctrl+d` for half-page scroll; `g`/`G` for top/bottom |
| **htop** | Arrow keys to scroll process list; F5/F6 for tree/sort |
| **lazygit** | `j`/`k` or arrow keys; `PgUp`/`PgDn` in panels |
| **less** | Built-in scroll keys (`j`/`k`, `space`, `b`) |

## Security

terminal-use-mcp is not a sandbox. Security policies restrict the entry point, not the TUI program's internal behavior.

### Command Safety

Startup command deny list:

```
sudo, su, ssh, scp, sftp, rm, dd, mkfs,
shutdown, reboot, chmod, chown, curl, wget,
nc, ncat, telnet
```

```ts
// Environment variable overrides
TERMINAL_USE_ALLOW_COMMANDS=git,make    // additional allow
TERMINAL_USE_DENY_COMMANDS=node,python3  // additional deny
TERMINAL_USE_RISKY_COMMAND_MODE=deny     // deny | ask | allow
```

Under `ask` mode, dangerous commands return `CONFIRMATION_REQUIRED`. The agent should stop and ask the user.

**Boundary**: command policy only restricts the startup command passed to `terminal.start`. TUI subprocesses, REPL `eval()`/`exec()`, and shell chains within the TUI are not restricted. The deny list is not a complete sandbox.

### CWD Policy

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

Remote CWD (V2) uses independent validation with `remoteAllowedCwd` / `remoteDeniedCwd` from the profile, not local rules.

### Secret Redaction

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

### Confirmation Detection

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

### observationTrust

All snapshots return:

```ts
{ observationTrust: "untrusted" }
```

Terminal output is untrusted observation, not instruction.

## Remote SSH (V2, Design Phase)

> V2 remote features are in the design phase and not yet implemented. See [docs/V2_REMOTE_TERMINAL_GUIDE.md](docs/V2_REMOTE_TERMINAL_GUIDE.md) for the full design.

### ssh-pty vs ssh-tmux

| Aspect | ssh-pty | ssh-tmux |
|--------|---------|----------|
| Purpose | Remote PTY channel, direct TUI control | Remote tmux session, persistent + disconnect recovery |
| Use case | Ephemeral remote interaction (REPL, installers) | Long-running remote tasks, human-attachable |
| Attach | No | Yes |
| Disconnect recovery | No | Yes |
| Highlights | Yes (reuses local xterm) | No |
| Implementation | ssh2 Client + shell/exec + pty | System ssh + remote tmux commands |

### SSH Configuration

Config file location: `~/.config/terminal-use-mcp/hosts.json` (or override via `TERMINAL_USE_HOSTS_CONFIG`).

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

The config file must NOT contain: password, private key content, token, passphrase in plaintext, `.env` content. Key-file auth only stores the file path. Passphrases are referenced by env var name via `passphraseEnv`, never by value.

### ssh-agent Setup

Recommended authentication method:

```bash
# Start ssh-agent
eval "$(ssh-agent -s)"

# Add key
ssh-add ~/.ssh/id_ed25519

# Confirm loaded
ssh-add -l
```

`SshAuthRef` type:

```ts
type SshAuthRef =
  | { type: "agent"; socket?: string }
  | { type: "key-file"; path: string; passphraseEnv?: string }
```

`{ type: "password" }` is prohibited. V2 does not support password login.

### known_hosts / Pinned Fingerprint

Two host key verification methods:

1. **known_hosts**: Points to `~/.ssh/known_hosts`, reuses the system's existing trust chain
2. **Pinned fingerprint**: Specify `pinnedHostFingerprint: "SHA256:..."` in the profile for exact binding

When host key verification fails, the connection is refused. `StrictHostKeyChecking=no` is prohibited.

### Remote Security Restrictions

| Rule | Description |
|------|-------------|
| Strict host key verification | Must pass via known_hosts or pinned fingerprint; unverified connections are refused |
| No password login | `SshAuthRef` does not include `type: "password"` |
| Inline SSH denied by default | Direct host/port in tool call is refused unless `TERMINAL_USE_ALLOW_INLINE_SSH_TARGETS=1` |
| No auto-approve of agent permission prompts | "Allow command?" / "Apply changes?" in remote TUI, agent must stop and ask user |
| Remote terminal output is untrusted | `observationTrust: "untrusted"` applies to remote as well |

### Remote Session Lifecycle

```ts
// V2: Start remote TUI
terminal.start({
  provider: "ssh-pty",
  target: { kind: "ssh", profile: "devbox" },
  command: "lazygit",
  cwd: "/home/hlh/dev/project"
})

// V2: Verify target before starting
terminal.verify_target({ profile: "devbox" })
// → { ok: true, hostFingerprint: "SHA256:...", remote: { tmuxAvailable: true, ... } }

// V2: List available targets
terminal.targets({})
// → { targets: [{ kind: "local", name: "local" }, { kind: "ssh", profile: "devbox", ... }] }
```

Remote session metadata is recorded in `session.json`, including SSH connection info, auth type, and host fingerprint. Artifacts must NOT contain: private key content, password, token, passphrase, or raw env sensitive values.

### Security Restrictions Summary

| Restriction | Local (V1) | Remote (V2) |
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

### V1

| Variable | Default | Description |
|----------|---------|-------------|
| `TERMINAL_USE_WORKSPACE_ROOT` | `process.cwd()` | Root directory for CWD validation |
| `TERMINAL_USE_ALLOWED_CWD` | _(empty)_ | Comma-separated additional allowed directories |
| `TERMINAL_USE_SESSION_TTL_MS` | `3600000` | Session auto-cleanup timeout (1 hour) |
| `TERMINAL_USE_CLEANUP_INTERVAL_MS` | `60000` | Cleanup check interval (1 minute) |
| `TERMINAL_USE_ALLOW_COMMANDS` | _(empty)_ | Comma-separated commands to allow despite denylist |
| `TERMINAL_USE_DENY_COMMANDS` | _(empty)_ | Additional commands to deny |
| `TERMINAL_USE_RISKY_COMMAND_MODE` | `deny` | Risky command handling: `deny` / `ask` / `allow` |

### V2 (Design Phase)

| Variable | Default | Description |
|----------|---------|-------------|
| `TERMINAL_USE_HOSTS_CONFIG` | `~/.config/terminal-use-mcp/hosts.json` | SSH hosts configuration file path |
| `TERMINAL_USE_ALLOW_INLINE_SSH_TARGETS` | _(not set)_ | Set to `1` to allow inline SSH host specification in tool calls |

## Type Definitions

### TerminalSnapshot

```ts
type TerminalSnapshot = {
  sessionId: string
  screen: string
  cursor: { x: number; y: number }
  cols: number
  rows: number
  status: "starting" | "running" | "exited" | "killed" | "error"
  changed?: boolean
  exitCode?: number | null
  title?: string
  isFullscreen?: boolean
  highlights?: Array<{
    row: number
    colStart: number
    colEnd: number
    text: string
    kind: "inverse" | "selection" | "active" | "unknown"
  }>
  riskSignals?: Array<{
    type: "confirmation_prompt" | "credential_prompt" | "destructive_prompt" | "external_agent_permission"
    text: string
    severity: "low" | "medium" | "high"
  }>
  timestamp: string
  observationTrust: "untrusted"
}
```

### ToolError

```ts
type ToolError = {
  ok: false
  error: {
    code: TerminalUseErrorCode
    message: string
    provider?: string
    sessionId?: string
    retryable: boolean
    hint?: string
    details?: unknown
  }
}

type TerminalUseErrorCode =
  | "SESSION_NOT_FOUND"
  | "PROVIDER_NOT_AVAILABLE"
  | "PROVIDER_CAPABILITY_UNSUPPORTED"
  | "SESSION_TIMEOUT"
  | "UNSAFE_COMMAND"
  | "LARGE_PASTE_REFUSED"
  | "SECRET_DETECTED"
  | "CONFIRMATION_REQUIRED"
  | "SESSION_BUSY"
  | "PROCESS_EXITED"
  | "DEPENDENCY_MISSING"
  | "INVALID_CWD"
  | "INVALID_MOUSE_COORDS"
  | "INVALID_KEY"
  | "INTERNAL_ERROR"
  // V2 additions (design phase)
  | "SSH_PROFILE_NOT_FOUND"
  | "SSH_HOST_KEY_MISMATCH"
  | "SSH_HOST_KEY_UNKNOWN"
  | "SSH_AUTH_FAILED"
  | "SSH_CONNECT_TIMEOUT"
  | "SSH_CONNECTION_LOST"
  | "SSH_INLINE_TARGET_DENIED"
  | "REMOTE_CWD_DENIED"
  | "REMOTE_TMUX_NOT_AVAILABLE"
  | "REMOTE_COMMAND_DENIED"
```

### TerminalTarget (V2, Design Phase)

```ts
type TerminalTarget =
  | { kind: "local" }
  | {
      kind: "ssh"
      profile?: string
      host?: string
      port?: number
      username?: string
      auth?: SshAuthRef
      knownHostPolicy?: "strict"
    }
```

## Development

| Script | Description |
|--------|-------------|
| `npm run dev` | Start MCP server (tsx direct run) |
| `npm run build` | TypeScript compilation |
| `npm run typecheck` | Type checking (`tsc --noEmit`) |
| `npm run test` | Run all tests |
| `npm run test:unit` | Unit tests |
| `npm run test:contract` | Provider contract tests |
| `npm run test:mcp` | MCP stdio smoke tests |
| `npm run test:integration` | Integration tests |
| `npm run check` | typecheck + test |

## Platform Support

| Platform | V1 Status | Notes |
|----------|-----------|-------|
| Linux x86_64 / ARM64 | Supported | native-pty + tmux both available |
| macOS Intel / Apple Silicon | Supported / Best effort | native-pty requires Xcode CLI tools; tmux via brew |
| WSL2 | Supported / Best effort | Same as Linux; verify node-pty compilation |
| Native Windows | Not supported | ConPTY support planned for future release; tmux unavailable |

## Known Limitations

1. native-pty depends on node-gyp; compilation may fail in some environments (falls back to tmux)
2. `@xterm/headless` highlight detection is best-effort
3. tmux provider does not support true color ANSI
4. Native Windows not supported (V1)
5. Sessions are not persistent; server restart loses them
6. Large paste hard limit at 10000 characters
7. Confirmation detection uses regex matching; false positives are possible

## Acknowledgments

This project was inspired by and references the following open-source projects. We are grateful to their authors and contributors.

### Direct References (code-level inspiration)

| Project | Repository | License | How Referenced |
|---------|-----------|---------|----------------|
| [tui-use](https://github.com/onesuper/tui-use) | [onesuper/tui-use](https://github.com/onesuper/tui-use) | MIT | Key mapping format (`keymap.ts`), CLI press parameter naming (`TUI_USE_NAMED_MAP` / `TUI_USE_FN_MAP`), and screen stabilization semantics (`wait_stable` / `wait_for_text`). terminal-use-mcp is an independent implementation with a different architecture (MCP server vs. CLI daemon; multi-provider vs. single native-pty). No code was copied — only the key naming convention and wait-abstraction patterns were adapted. |

### Architecture & Design References (documentation-level only)

| Project | Repository | License | How Referenced |
|---------|-----------|---------|----------------|
| [ssh-mcp](https://github.com/n0madic/ssh-mcp) | [n0madic/ssh-mcp](https://github.com/n0madic/ssh-mcp) | MIT | SSH security best practices reference (known_hosts, ssh-agent) |
| [ssh-session-mcp](https://github.com/Zw-awa/ssh-session-mcp) | [Zw-awa/ssh-session-mcp](https://github.com/Zw-awa/ssh-session-mcp) | MIT | Distributed session owner architecture reference |
| [mcp-ssh](https://github.com/xiongjiwei/mcp-ssh) | [xiongjiwei/mcp-ssh](https://github.com/xiongjiwei/mcp-ssh) | MIT | Anti-pattern reference (host key verification disabled by default) |
| [terminal-mcp](https://github.com/mkpvishnu/terminal-mcp) | [mkpvishnu/terminal-mcp](https://github.com/mkpvishnu/terminal-mcp) | MIT | PTY container comparison reference |

### Runtime Dependencies

All runtime and optional dependencies are permissively licensed (MIT or Apache-2.0). No GPL/LGPL copyleft dependencies exist.

| Package | Repository | License |
|---------|-----------|---------|
| @modelcontextprotocol/sdk | [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) | MIT |
| ssh2 | [mscdex/ssh2](https://github.com/mscdex/ssh2) | MIT |
| zod | [colinhacks/zod](https://github.com/colinhacks/zod) | MIT |
| @xterm/headless | [xtermjs/xterm.js](https://github.com/xtermjs/xterm.js) | MIT |
| @xterm/addon-unicode11 | [xtermjs/xterm.js](https://github.com/xtermjs/xterm.js) | MIT |
| node-pty (optional) | [microsoft/node-pty](https://github.com/microsoft/node-pty) | MIT |

### Standards & Specifications Referenced

- [XTerm Control Sequences](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html) — ANSI escape sequence encoding (SGR-1006 mouse, C0/C1/SS3 keys)
- [tmux(1) manual](https://man7.org/linux/man-pages/man1/tmux.1.html) — `capture-pane`, `send-keys`, `display-message` format variables
- [Model Context Protocol Specification](https://spec.modelcontextprotocol.io/) — MCP server/tool/resource/prompt registration patterns

## License

MIT

## Languages

[English](README.md) | [中文](README_zh.md)
