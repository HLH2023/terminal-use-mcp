# terminal-use-mcp

[English](README.md) | [中文](README_zh.md)

Local + remote terminal interaction control MCP Server. Lets AI agents control interactive TUI programs the way a human would.

[![npm version](https://img.shields.io/npm/v/terminal-use-mcp.svg)](https://www.npmjs.com/package/terminal-use-mcp) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Node.js](https://img.shields.io/badge/node-%3E%3D20-green.svg)](https://nodejs.org/)

| Platform | Status |
|----------|--------|
| Linux x86_64 / ARM64 | Supported |
| macOS Intel / Apple Silicon | Supported (best effort) |
| WSL2 | Supported (best effort) |
| Native Windows | Experimental (native-pty only; tmux requires [psmux](https://github.com/psmux/psmux) or WSL2) |

> **Windows users**: The `native-pty` provider works on Windows (shell auto-detection: `ComSpec` → `cmd.exe`). The `tmux` provider requires a Unix PTY multiplexer — install [psmux](https://github.com/psmux/psmux) (tmux-compatible, 83 commands, uses `tmux` as alias) or use WSL2. If `tmux` is not on PATH, set `TERMINAL_USE_TMUX_PATH` to its absolute or relative path.

This is not a shell runner. Use your bash tool for simple commands. This server handles TUI programs that require keyboard interaction: lazygit, vim, htop, Python REPL, debuggers, installers, external agent TUIs (Claude Code, Codex CLI, OpenCode).

## Concept

terminal-use-mcp provides a **snapshot-driven interaction loop**:

```
snapshot → analyze → type/press → wait → snapshot
```

Unlike `tmux send-keys` + `sleep`, the server observes PTY render events directly. `wait_for_text` / `wait_stable` block until the program actually responds — no polling, no guessing.

**What it is for**: Programs that need keyboard input — REPLs, debuggers, TUI apps, installers, external coding agents.

**What it is NOT for**: Simple command execution → use your bash tool.

## Quick Start

### Prerequisites

| Dependency | Minimum | Purpose |
|------------|---------|---------|
| Node.js | 20+ | Run the MCP server |
| npm | 8+ | Install dependencies |
| node-gyp + C++ toolchain | — | Compile node-pty (optional; fallback to tmux if missing) |
| tmux | 3.2+ | tmux provider (optional; only native-pty available if missing) |

### MCP Client Configuration

#### Claude Code / Claude Desktop

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

#### OpenAI Codex CLI

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
        "TERMINAL_USE_ALLOWED_CWD": "<your-project-path>,/tmp",
        "TERMINAL_USE_PROVIDERS": "native-pty,tmux"
      }
    }
  }
}
```

stdio transport: stdout is reserved for MCP protocol. All logs go to stderr. Server cleans up all sessions on SIGINT/SIGTERM.

### Copy-Paste Setup Prompts

Paste the appropriate prompt into your AI agent for autonomous installation:

<details>
<summary>Claude Code</summary>

```
Set up terminal-use-mcp with these steps:

1. Prerequisites check:
   - Confirm Node.js 20+ and npm 8+ are available (node -v / npm -v)

2. Configure MCP:
   - Create or edit .mcp.json in the project root, adding:
     {
       "mcpServers": {
         "terminal-use": {
           "command": "npx",
           "args": ["-y", "terminal-use-mcp"],
           "env": {
             "TERMINAL_USE_WORKSPACE_ROOT": "<current-project-absolute-path>",
             "TERMINAL_USE_ALLOWED_CWD": "<current-project-absolute-path>,/tmp",
             "TERMINAL_USE_PROVIDERS": "native-pty,tmux"
           }
         }
       }
     }
   - Replace <current-project-absolute-path> with the actual path
   - TERMINAL_USE_PROVIDERS controls which providers are enabled (comma-separated).
     Common values:
     - "native-pty,tmux" — local only (default, no SSH)
     - "native-pty,tmux,ssh-pty,ssh-tmux" — all providers (include remote SSH)
      - "tmux" — tmux only (when node-pty is unavailable)
      If unsure, use "native-pty,tmux".
    - If tmux is not on PATH, set TERMINAL_USE_TMUX_PATH to its absolute or relative path.
    - Windows: native-pty only by default. For tmux support, install psmux (https://github.com/psmux/psmux)
      which provides a `tmux` alias, or use WSL2.
    - Security configuration (optional):
      - TERMINAL_USE_ALLOW_COMMANDS: commands allowed despite built-in deny list (comma-separated)
      - TERMINAL_USE_DENY_COMMANDS: additional commands to deny beyond built-in list (comma-separated)
      - TERMINAL_USE_RISKY_COMMAND_MODE: how to handle risky commands — "deny" (default, block), "ask" (prompt user), "allow" (permit all)
      If unsure, leave these unset (default deny mode is safe for most use cases).

3. Install skills:
   - Core skill (required for all users):
     Download https://raw.githubusercontent.com/HLH2023/terminal-use-mcp/main/skills/terminal-use/SKILL.md
     and save to .claude/skills/terminal-use/SKILL.md
   - Before installing agent-specific skills, ASK the user:
     "Do you need to remotely control any of these AI agent TUIs via terminal-use-mcp?
      - Claude Code TUI (tui-claude-code)
      - Codex CLI TUI (tui-codex-cli)
      - OpenCode TUI (tui-opencode-native)
      - OpenCode + OmO plugin TUI (tui-opencode-omo)
      If unsure, skip them — you can always add them later."
   - For each confirmed agent, download the corresponding SKILL.md from
     https://raw.githubusercontent.com/HLH2023/terminal-use-mcp/main/skills/<skill-name>/SKILL.md
     and save to .claude/skills/<skill-name>/SKILL.md
   - After downloading, ASK the user:
     "The core skill includes both local (§1-§11) and remote SSH (§12-§17) sections.
      If you only use local terminals, I can remove §12-§17 to save ~500 lines.
      I can also trim reference sections (patterns, error codes, key lists) if you prefer a minimal skill (~80 lines).
      Should I trim the skill?"

4. Restart Claude Code for the config to take effect

5. Verify:
   - Confirm terminal.health, terminal.start etc. appear in the MCP tool list
   - Call terminal.health to confirm server and provider status are OK

Constraints:
- Do not output any secrets
- Only notify me if node-pty compilation fails; handle other issues yourself
```

</details>

<details>
<summary>Codex CLI</summary>

```
Set up terminal-use-mcp with these steps:

1. Prerequisites check:
   - Confirm Node.js 20+ and npm 8+ are available (node -v / npm -v)

2. Configure MCP:
   - Create or edit .codex/config.json, adding to mcp_servers:
     {
       "terminal-use": {
         "command": "npx",
         "args": ["-y", "terminal-use-mcp"],
         "env": {
           "TERMINAL_USE_WORKSPACE_ROOT": "<current-project-absolute-path>",
           "TERMINAL_USE_ALLOWED_CWD": "<current-project-absolute-path>,/tmp",
           "TERMINAL_USE_PROVIDERS": "native-pty,tmux"
         }
       }
     }
   - Replace <current-project-absolute-path> with the actual path
   - TERMINAL_USE_PROVIDERS controls which providers are enabled (comma-separated).
     Common values:
     - "native-pty,tmux" — local only (default, no SSH)
     - "native-pty,tmux,ssh-pty,ssh-tmux" — all providers (include remote SSH)
      - "tmux" — tmux only (when node-pty is unavailable)
      If unsure, use "native-pty,tmux".
    - If tmux is not on PATH, set TERMINAL_USE_TMUX_PATH to its absolute or relative path.
    - Windows: native-pty only by default. For tmux support, install psmux (https://github.com/psmux/psmux)
      which provides a `tmux` alias, or use WSL2.
    - Security configuration (optional):
      - TERMINAL_USE_ALLOW_COMMANDS: commands allowed despite built-in deny list (comma-separated)
      - TERMINAL_USE_DENY_COMMANDS: additional commands to deny beyond built-in list (comma-separated)
      - TERMINAL_USE_RISKY_COMMAND_MODE: how to handle risky commands — "deny" (default, block), "ask" (prompt user), "allow" (permit all)
      If unsure, leave these unset (default deny mode is safe for most use cases).

3. Install skills:
   - Core skill (required for all users):
     Download https://raw.githubusercontent.com/HLH2023/terminal-use-mcp/main/skills/terminal-use/SKILL.md
     and save to .codex/skills/terminal-use/SKILL.md
   - Before installing agent-specific skills, ASK the user:
     "Do you need to remotely control any of these AI agent TUIs via terminal-use-mcp?
      - Claude Code TUI (tui-claude-code)
      - Codex CLI TUI (tui-codex-cli)
      - OpenCode TUI (tui-opencode-native)
      - OpenCode + OmO plugin TUI (tui-opencode-omo)
      If unsure, skip them — you can always add them later."
   - For each confirmed agent, download the corresponding SKILL.md from
     https://raw.githubusercontent.com/HLH2023/terminal-use-mcp/main/skills/<skill-name>/SKILL.md
     and save to .codex/skills/<skill-name>/SKILL.md
   - After downloading, ASK the user:
     "The core skill includes both local (§1-§11) and remote SSH (§12-§17) sections.
      If you only use local terminals, I can remove §12-§17 to save ~500 lines.
      I can also trim reference sections (patterns, error codes, key lists) if you prefer a minimal skill (~80 lines).
      Should I trim the skill?"

4. Restart Codex CLI for the config to take effect

5. Verify:
   - Confirm terminal.health appears when you start a session

Constraints:
- Do not output any secrets
- Only notify me if node-pty compilation fails; handle other issues yourself
```

</details>

<details>
<summary>OpenCode</summary>

```
Set up terminal-use-mcp with these steps:

1. Prerequisites check:
   - Confirm Node.js 20+ and npm 8+ are available (node -v / npm -v)

2. Configure MCP:
   - Add to .opencode/opencode.json in the mcp field:
     {
       "type": "local",
       "command": ["npx", "-y", "terminal-use-mcp"],
       "enabled": true,
       "environment": {
         "TERMINAL_USE_WORKSPACE_ROOT": "<current-project-absolute-path>",
         "TERMINAL_USE_ALLOWED_CWD": "<current-project-absolute-path>,/tmp",
         "TERMINAL_USE_PROVIDERS": "native-pty,tmux"
       }
     }
   - TERMINAL_USE_PROVIDERS controls which providers are enabled (comma-separated).
     Common values:
     - "native-pty,tmux" — local only (default, no SSH)
     - "native-pty,tmux,ssh-pty,ssh-tmux" — all providers (include remote SSH)
      - "tmux" — tmux only (when node-pty is unavailable)
       If unsure, use "native-pty,tmux".
     - If tmux is not on PATH, set TERMINAL_USE_TMUX_PATH to its absolute or relative path.
     - Windows: native-pty only by default. For tmux support, install psmux (https://github.com/psmux/psmux)
       which provides a `tmux` alias, or use WSL2.
     - Security configuration (optional):
       - TERMINAL_USE_ALLOW_COMMANDS: commands allowed despite built-in deny list (comma-separated)
       - TERMINAL_USE_DENY_COMMANDS: additional commands to deny beyond built-in list (comma-separated)
       - TERMINAL_USE_RISKY_COMMAND_MODE: how to handle risky commands — "deny" (default, block), "ask" (prompt user), "allow" (permit all)
       If unsure, leave these unset (default deny mode is safe for most use cases).

3. Install skills:
   - Core skill (required for all users):
     Download https://raw.githubusercontent.com/HLH2023/terminal-use-mcp/main/skills/terminal-use/SKILL.md
     and save to .opencode/skills/terminal-use/SKILL.md
   - Before installing agent-specific skills, ASK the user:
     "Do you need to remotely control any of these AI agent TUIs via terminal-use-mcp?
      - Claude Code TUI (tui-claude-code)
      - Codex CLI TUI (tui-codex-cli)
      - OpenCode TUI (tui-opencode-native)
      - OpenCode + OmO plugin TUI (tui-opencode-omo)
      If unsure, skip them — you can always add them later."
   - For each confirmed agent, download the corresponding SKILL.md from
     https://raw.githubusercontent.com/HLH2023/terminal-use-mcp/main/skills/<skill-name>/SKILL.md
     and save to .opencode/skills/<skill-name>/SKILL.md
   - After downloading, ASK the user:
     "The core skill includes both local (§1-§11) and remote SSH (§12-§17) sections.
      If you only use local terminals, I can remove §12-§17 to save ~500 lines.
      I can also trim reference sections (patterns, error codes, key lists) if you prefer a minimal skill (~80 lines).
      Should I trim the skill?"

4. Restart OpenCode for the config to take effect

5. Verify:
   - Confirm terminal.health, terminal.start etc. appear in the MCP tool list

Constraints:
- Do not output any secrets
- Only notify me if node-pty compilation fails; handle other issues yourself
```

</details>

## Skills (Optional)

terminal-use-mcp ships with a **core skill** (`terminal-use`) that teaches AI agents how to use the MCP tools correctly. Additionally, there are **agent-specific skills** for controlling external AI agent TUIs. Install only the ones you need.

| Skill | Target Agent | Required? | Install |
|-------|-------------|-----------|---------|
| `terminal-use` | All agents | **Yes** (core) | Copy `skills/terminal-use/` into your project's skill directory |
| `tui-claude-code` | Claude Code TUI | If you remotely control Claude Code | Copy `skills/tui-claude-code/` |
| `tui-codex-cli` | Codex CLI TUI | If you remotely control Codex CLI | Copy `skills/tui-codex-cli/` |
| `tui-opencode-native` | OpenCode TUI | If you remotely control OpenCode | Copy `skills/tui-opencode-native/` |
| `tui-opencode-omo` | OpenCode + OmO plugin | If you remotely control OpenCode with OmO | Copy `skills/tui-opencode-omo/` |

> **When to install agent-specific skills**: Only when you need to **remotely control** another AI agent's TUI (e.g., one agent driving another). For normal terminal automation (lazygit, vim, htop, REPLs), the core skill is sufficient.

### Customization & Trimming

Skills are plain Markdown — **edit them freely** to match your needs:

- **Trim the core skill**: `terminal-use` includes §1-§17. If you only use local terminals, delete §12-§17 (remote SSH). Sections like §7 (Common Patterns, ~130 lines) and §16 (Remote Operation Patterns, ~150 lines) are the largest and safe to remove if your AI learns by doing.
- **Pick only the agent skills you need**: Don't install `tui-claude-code` if you never control Claude Code. Each agent skill is fully self-contained.
- **Minimal core skill**: §1 + §3 + §6 (~80 lines) covers the essential purpose, operation loop, and safety rules. Everything else is reference material.

Each SKILL.md includes a **Customization Guide** table at the top that marks which sections are safe to remove.

## Providers

| Provider | Use Case | Key Advantage |
|----------|----------|---------------|
| `native-pty` | Most interactive TUI programs (default) | Fast response, high-quality snapshots, highlight detection |
| `tmux` | Sessions needing persistence, disconnect recovery, multi-user attach | Attachable, sessions survive MCP restart |
| `ssh-pty` | TUI programs on remote hosts | Reuses local xterm/snapshot/transcript stack over SSH |
| `ssh-tmux` | Persistent remote sessions, disconnect recovery, human-attachable | Full remote tmux lifecycle management |

Auto-selection: local → native-pty (fallback tmux); remote → ssh-pty (fallback ssh-tmux).

### Provider Configuration

Control which providers are available via the `TERMINAL_USE_PROVIDERS` environment variable (comma-separated whitelist). If unset, all providers are enabled.

```json
{
  "env": {
    "TERMINAL_USE_PROVIDERS": "native-pty,tmux"
  }
}
```

| Value | Effect |
|-------|--------|
| _(not set)_ | All providers enabled |
| `native-pty,tmux` | Local only — no SSH providers |
| `tmux` | tmux only — useful in environments without node-pty |
| `ssh-pty,ssh-tmux` | Remote only — no local terminal providers |

Disabled providers are excluded from registration and auto-selection. `terminal.health` reports them as `"disabled by TERMINAL_USE_PROVIDERS config"`.

### Environment Variables

#### Core Configuration

| Variable | Purpose | Default |
|----------|---------|---------|
| `TERMINAL_USE_PROVIDERS` | Enabled provider whitelist (CSV) | All providers |
| `TERMINAL_USE_DEFAULT_PROVIDER` | Default provider (overrides auto-selection priority) | `native-pty` |
| `TERMINAL_USE_TMUX_PATH` | Absolute or relative path to tmux binary (when not on PATH) | `tmux` |
| `TERMINAL_USE_WORKSPACE_ROOT` | CWD policy root | current working directory |
| `TERMINAL_USE_ALLOWED_CWD` | Allowed working directories (CSV) | Workspace root |
| `TERMINAL_USE_ALLOW_COMMANDS` | Commands allowed even if on deny list (CSV, overrides deny) | _(empty)_ |
| `TERMINAL_USE_DENY_COMMANDS` | Extra denied commands beyond built-in list (CSV) | _(empty)_ |
| `TERMINAL_USE_RISKY_COMMAND_MODE` | How to handle denied commands: `deny`, `ask`, or `allow` | `deny` |

#### Session & Behavior

| Variable | Purpose | Default |
|----------|---------|---------|
| `TERMINAL_USE_SESSION_TTL_MS` | Session auto-cleanup timeout (ms) | `3600000` (1 hour) |
| `TERMINAL_USE_CLEANUP_INTERVAL_MS` | How often to check for expired sessions (ms) | `60000` (1 min) |
| `TERMINAL_USE_DEFAULT_COLS` | Default terminal columns for new sessions | `120` |
| `TERMINAL_USE_DEFAULT_ROWS` | Default terminal rows for new sessions | `30` |
| `TERMINAL_USE_LARGE_PASTE_LIMIT` | Paste size threshold requiring confirmation (characters) | `2000` |
| `TERMINAL_USE_HARD_PASTE_LIMIT` | Hard paste size limit — pastes above this are always refused (characters) | `10000` |
| `TERMINAL_USE_LOG_LEVEL` | Log verbosity: `debug`, `info`, `warn`, `error` | `info` |
| `TERMINAL_USE_HOSTS_CONFIG` | Path to SSH host profiles configuration file | `~/.config/terminal-use-mcp/hosts.json` |
| `TERMINAL_USE_ALLOW_INLINE_SSH_TARGETS` | Set to `1` to allow inline SSH host specification in tool calls | _(not set — denied)_ |

#### Path Overrides

| Variable | Purpose | Default |
|----------|---------|---------|
| `TERMINAL_USE_ARTIFACT_DIR` | Override artifact/transcript output directory | `<package-dir>/artifacts` |
| `TERMINAL_USE_CONFIG_DIR` | Override XDG config directory | See XDG/platform defaults below |
| `TERMINAL_USE_CONFIG_FILE` | Override config.json file path | `<config-dir>/config.json` |
| `TERMINAL_USE_DATA_DIR` | Override XDG data directory (artifact, session data) | See XDG/platform defaults below |

#### XDG / Platform Paths

| Variable | Purpose | Platform |
|----------|---------|----------|
| `XDG_CONFIG_HOME` | XDG config home — app appends `terminal-use-mcp/` | Linux, macOS |
| `XDG_DATA_HOME` | XDG data home — app appends `terminal-use-mcp/` | Linux, macOS |
| `XDG_RUNTIME_DIR` | XDG runtime directory (used for SSH agent socket discovery) | Linux |
| `APPDATA` | Windows roaming app data — app appends `terminal-use-mcp/` | Windows |
| `LOCALAPPDATA` | Windows local app data — app appends `terminal-use-mcp/` | Windows |

#### SSH Authentication

| Variable | Purpose |
|----------|---------|
| `SSH_AUTH_SOCK` | SSH agent socket path (discovered automatically if not set; see ssh-auth.ts discovery chain) |
| `SSH_PROXY_JUMP` | SSH ProxyJump configuration (passed to SSH connection) |

## MCP Tools

### Session Lifecycle (7 tools)

| Tool | Purpose |
|------|---------|
| `terminal.start` | Start a terminal session |
| `terminal.attach` | Attach to an existing session (tmux) |
| `terminal.list` | List all active sessions |
| `terminal.info` | Query session details |
| `terminal.rename` | Rename a session label |
| `terminal.kill` | Terminate a session and its process |
| `terminal.cleanup` | Clean up all expired sessions |

### Observation (5 tools)

| Tool | Purpose |
|------|---------|
| `terminal.snapshot` | Capture current screen state |
| `terminal.wait_for_text` | Wait for specific text to appear |
| `terminal.wait_stable` | Wait until output stops changing |
| `terminal.find` | Search for text in screen/scrollback |
| `terminal.scroll` | Scroll the terminal viewport |

### Input (5 tools)

| Tool | Purpose |
|------|---------|
| `terminal.type` | Type text into the terminal |
| `terminal.press` | Send a key press (supports arbitrary combos e.g. `"ctrl+shift+f"`) |
| `terminal.paste` | Paste large text (with safety checks) |
| `terminal.mouse_click` | Mouse click (SGR-1006) |
| `terminal.mouse_scroll` | Mouse wheel scroll (SGR-1006) |

### Meta (7 tools)

| Tool | Purpose |
|------|---------|
| `terminal.resize` | Change terminal dimensions |
| `terminal.export_transcript` | Export session transcript |
| `terminal.health` | Check server and provider status |
| `terminal.keys` | List available key expressions |
| `terminal.provider_capabilities` | Query provider capability matrix |
| `terminal.events` | Get session event history |
| `terminal.send_signal` | Send signal (SIGINT/SIGTERM/SIGKILL) |

### Remote Control (3 tools)

| Tool | Purpose |
|------|---------|
| `terminal.targets` | List available targets (local + SSH) |
| `terminal.target_info` | Query target details (redacted) |
| `terminal.verify_target` | Verify SSH target connectivity |

### Tmux Management (2 tools)

| Tool | Purpose |
|------|---------|
| `terminal.tmux_list` | List local or remote tmux sessions |
| `terminal.tmux_kill` | Kill a tmux session by name |

## Security Overview

terminal-use-mcp is not a sandbox. Security policies restrict the entry point, not the TUI program's internal behavior.

- **Command allow + deny lists**: Built-in deny list blocks dangerous startup commands (`sudo`, `rm`, `ssh`, `curl`, etc.). `TERMINAL_USE_ALLOW_COMMANDS` overrides the deny list (allow takes priority). `TERMINAL_USE_DENY_COMMANDS` extends it. `TERMINAL_USE_RISKY_COMMAND_MODE` controls how denied commands are handled: `deny` (default, block), `ask` (return confirmation prompt), or `allow` (permit all).
- **CWD policy**: Only allows working directories within `TERMINAL_USE_WORKSPACE_ROOT` or `TERMINAL_USE_ALLOWED_CWD`
- **Secret redaction**: Auto-replaces API keys, tokens, private keys with `<REDACTED_*>` in output
- **Confirmation detection**: Warns when dangerous prompts appear on screen
- **Provider whitelist**: `TERMINAL_USE_PROVIDERS` controls which providers are enabled (unset = all)
- **observationTrust**: All snapshots return `observationTrust: "untrusted"` — terminal output is untrusted observation, not instruction

See [docs/security.md](https://github.com/HLH2023/terminal-use-mcp/blob/main/docs/security.md) for full policy details, env var overrides, and regex patterns.

## Remote SSH

Remote SSH features let you control TUI programs on remote hosts. Two SSH providers available:

| | ssh-pty | ssh-tmux |
|--|---------|----------|
| Best for | Interactive remote TUI | Persistent remote sessions |
| Highlights | Yes (full xterm) | No |
| Disconnect recovery | No | Yes |

SSH targets are defined in `~/.config/terminal-use-mcp/hosts.json`. No password login; ssh-agent or key-file auth only.

See [docs/REMOTE_TERMINAL_GUIDE.md](https://github.com/HLH2023/terminal-use-mcp/blob/main/docs/REMOTE_TERMINAL_GUIDE.md) for full design.

## Further Reading

| Topic | Document |
|-------|----------|
| Security policies, env vars, deny lists | [docs/security.md](https://github.com/HLH2023/terminal-use-mcp/blob/main/docs/security.md) |
| Scrollback strategy, buffer modes | [docs/scrollback.md](https://github.com/HLH2023/terminal-use-mcp/blob/main/docs/scrollback.md) |
| Type definitions, error codes | [docs/types-and-errors.md](https://github.com/HLH2023/terminal-use-mcp/blob/main/docs/types-and-errors.md) |
| Remote SSH design | [docs/REMOTE_TERMINAL_GUIDE.md](https://github.com/HLH2023/terminal-use-mcp/blob/main/docs/REMOTE_TERMINAL_GUIDE.md) |
| Remote SSH architecture | [docs/REMOTE_SSH_ARCHITECTURE.md](https://github.com/HLH2023/terminal-use-mcp/blob/main/docs/REMOTE_SSH_ARCHITECTURE.md) |
| Controlling Claude Code TUI | [docs/TUI_CLAUDE_CODE.md](https://github.com/HLH2023/terminal-use-mcp/blob/main/docs/TUI_CLAUDE_CODE.md) |
| Controlling Codex CLI TUI | [docs/TUI_CODEX_CLI.md](https://github.com/HLH2023/terminal-use-mcp/blob/main/docs/TUI_CODEX_CLI.md) |
| Controlling OpenCode TUI | [docs/TUI_OPENCODE_NATIVE.md](https://github.com/HLH2023/terminal-use-mcp/blob/main/docs/TUI_OPENCODE_NATIVE.md) |
| Controlling OpenCode + OmO | [docs/TUI_OPENCODE_OMO.md](https://github.com/HLH2023/terminal-use-mcp/blob/main/docs/TUI_OPENCODE_OMO.md) |

## Development

| Script | Description |
|--------|-------------|
| `npm run dev` | Start MCP server (tsx direct run) |
| `npm run build` | TypeScript compilation |
| `npm run typecheck` | Type checking (`tsc --noEmit`) |
| `npm run test` | Run all tests |
| `npm run check` | typecheck + test |

## Acknowledgments

This project was inspired by and references the following open-source projects:

### Direct References (code-level inspiration)

| Project | Repository | License | How Referenced |
|---------|-----------|---------|----------------|
| [tui-use](https://github.com/onesuper/tui-use) | [onesuper/tui-use](https://github.com/onesuper/tui-use) | MIT | Key mapping format and screen stabilization semantics. Independent implementation — no code copied. |

### Architecture References (documentation-level only)

| Project | Repository | License |
|---------|-----------|---------|
| [ssh-mcp](https://github.com/n0madic/ssh-mcp) | [n0madic/ssh-mcp](https://github.com/n0madic/ssh-mcp) | MIT |
| [ssh-session-mcp](https://github.com/Zw-awa/ssh-session-mcp) | [Zw-awa/ssh-session-mcp](https://github.com/Zw-awa/ssh-session-mcp) | MIT |
| [mcp-ssh](https://github.com/xiongjiwei/mcp-ssh) | [xiongjiwei/mcp-ssh](https://github.com/xiongjiwei/mcp-ssh) | MIT |
| [terminal-mcp](https://github.com/mkpvishnu/terminal-mcp) | [mkpvishnu/terminal-mcp](https://github.com/mkpvishnu/terminal-mcp) | MIT |

### Runtime Dependencies

All permissively licensed (MIT). No GPL/LGPL dependencies.

| Package | License |
|---------|---------|
| @modelcontextprotocol/sdk | MIT |
| ssh2 | MIT |
| zod | MIT |
| @xterm/headless + addon-unicode11 | MIT |
| node-pty (optional) | MIT |

## License

MIT
