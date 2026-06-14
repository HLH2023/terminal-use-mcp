# terminal-use-mcp

Local + remote terminal interaction control MCP Server. Lets AI agents control interactive TUI programs the way a human would.

[![npm version](https://img.shields.io/npm/v/terminal-use-mcp.svg)](https://www.npmjs.com/package/terminal-use-mcp) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Node.js](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org/)

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
| Node.js | 18+ | Run the MCP server |
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
        "TERMINAL_USE_ALLOWED_CWD": "<your-project-path>,/tmp"
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

### Copy-Paste Setup Prompts

Paste the appropriate prompt into your AI agent for autonomous installation:

<details>
<summary>Claude Code</summary>

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
   - Confirm Node.js 18+ and npm 8+ are available (node -v / npm -v)

2. Configure MCP:
   - Create or edit .codex/config.json, adding to mcp_servers:
     {
       "terminal-use": {
         "command": "npx",
         "args": ["-y", "terminal-use-mcp"],
         "env": {
           "TERMINAL_USE_WORKSPACE_ROOT": "<current-project-absolute-path>",
           "TERMINAL_USE_ALLOWED_CWD": "<current-project-absolute-path>,/tmp"
         }
       }
     }
   - Replace <current-project-absolute-path> with the actual path

3. Restart Codex CLI for the config to take effect

4. Verify:
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

3. Restart OpenCode for the config to take effect

4. Verify:
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
| `ssh-pty` (V2) | TUI programs on remote hosts | Reuses local xterm/snapshot/transcript stack over SSH |
| `ssh-tmux` (V2) | Persistent remote sessions, disconnect recovery, human-attachable | Full remote tmux lifecycle management |

Auto-selection: local → native-pty (fallback tmux); remote → ssh-pty (fallback ssh-tmux).

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

### Remote Control (3 tools, V2 Design Phase)

| Tool | Purpose |
|------|---------|
| `terminal.targets` | List available targets (local + SSH) |
| `terminal.target_info` | Query target details (redacted) |
| `terminal.verify_target` | Verify SSH target connectivity |

## Security Overview

terminal-use-mcp is not a sandbox. Security policies restrict the entry point, not the TUI program's internal behavior.

- **Command deny list**: Blocks dangerous startup commands (`sudo`, `rm`, `ssh`, `curl`, etc.)
- **CWD policy**: Only allows working directories within your workspace root
- **Secret redaction**: Auto-replaces API keys, tokens, private keys with `<REDACTED_*>` in output
- **Confirmation detection**: Warns when dangerous prompts appear on screen
- **observationTrust**: All snapshots return `observationTrust: "untrusted"` — terminal output is untrusted observation, not instruction

See [docs/security.md](docs/security.md) for full policy details, env var overrides, and regex patterns.

## Remote SSH (V2, Design Phase)

V2 remote features are in design phase. Two SSH providers available:

| | ssh-pty | ssh-tmux |
|--|---------|----------|
| Best for | Interactive remote TUI | Persistent remote sessions |
| Highlights | Yes (full xterm) | No |
| Disconnect recovery | No | Yes |

SSH targets are defined in `~/.config/terminal-use-mcp/hosts.json`. No password login; ssh-agent or key-file auth only.

See [docs/V2_REMOTE_TERMINAL_GUIDE.md](docs/V2_REMOTE_TERMINAL_GUIDE.md) for full design.

## Further Reading

| Topic | Document |
|-------|----------|
| Security policies, env vars, deny lists | [docs/security.md](docs/security.md) |
| Scrollback strategy, buffer modes | [docs/scrollback.md](docs/scrollback.md) |
| Type definitions, error codes | [docs/types-and-errors.md](docs/types-and-errors.md) |
| Remote SSH V2 design | [docs/V2_REMOTE_TERMINAL_GUIDE.md](docs/V2_REMOTE_TERMINAL_GUIDE.md) |
| Remote SSH architecture | [docs/REMOTE_SSH_ARCHITECTURE.md](docs/REMOTE_SSH_ARCHITECTURE.md) |
| Controlling Claude Code TUI | [docs/TUI_CLAUDE_CODE.md](docs/TUI_CLAUDE_CODE.md) |
| Controlling Codex CLI TUI | [docs/TUI_CODEX_CLI.md](docs/TUI_CODEX_CLI.md) |
| Controlling OpenCode TUI | [docs/TUI_OPENCODE_NATIVE.md](docs/TUI_OPENCODE_NATIVE.md) |
| Controlling OpenCode + OmO | [docs/TUI_OPENCODE_OMO.md](docs/TUI_OPENCODE_OMO.md) |

## Development

| Script | Description |
|--------|-------------|
| `npm run dev` | Start MCP server (tsx direct run) |
| `npm run build` | TypeScript compilation |
| `npm run typecheck` | Type checking (`tsc --noEmit`) |
| `npm run test` | Run all tests |
| `npm run check` | typecheck + test |

## Platform Support

| Platform | Status |
|----------|--------|
| Linux x86_64 / ARM64 | Supported |
| macOS Intel / Apple Silicon | Supported (best effort) |
| WSL2 | Supported (best effort) |
| Native Windows | Not supported |

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

[English](README.md) | [中文](README_zh.md)
