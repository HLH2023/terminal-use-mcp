# terminal-use-mcp

[English](README.md) | [中文](README_zh.md)

MCP-native terminal computer-use for long-lived PTY/TUI sessions.

terminal-use-mcp lets AI agents start, observe, type into, press keys in, wait on, and control interactive terminal programs through a snapshot-driven loop:

snapshot → analyze → type/press/mouse → wait → snapshot

It is designed for programs that cannot be handled well by one-shot shell commands: vim, lazygit, htop, REPLs, debuggers, installers, remote SSH TUI sessions, and external agent TUIs.

This is not a shell runner. Use a normal shell tool for simple command execution.

[![npm version](https://img.shields.io/npm/v/terminal-use-mcp.svg)](https://www.npmjs.com/package/terminal-use-mcp) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Node.js](https://img.shields.io/badge/node-%3E%3D20-green.svg)](https://nodejs.org/)

| Platform | Status |
|----------|--------|
| Linux x86_64 / ARM64 | Supported |
| macOS Intel / Apple Silicon | Supported (best effort) |
| WSL2 | Supported (best effort) |
| Native Windows | Experimental (native-pty only; tmux requires [psmux](https://github.com/psmux/psmux) or WSL2) |

> **Windows users**: The `native-pty` provider works on Windows (shell auto-detection: `ComSpec` → `cmd.exe`). The `tmux` provider requires a Unix PTY multiplexer — install [psmux](https://github.com/psmux/psmux) (tmux-compatible, 83 commands, uses `tmux` as alias) or use WSL2. If `tmux` is not on PATH, set `TERMINAL_USE_TMUX_PATH` to its absolute or relative path.

## Development & Security Notice

terminal-use-mcp is primarily designed for local development, agent terminal-use workflows, and controlled remote development environments.

It is not a sandbox.
It is not a production bastion host.
It is not a full remote operations security boundary.
Do not expose it directly to untrusted users or production infrastructure.

The project includes basic safety controls:
- Command denylist
- CWD policy
- Secret redaction
- Confirmation detection
- Strict SSH host key verification
- No password SSH auth
- Inline SSH disabled by default
- Audit log

But these do not replace: RBAC, credential vault, multi-user isolation, network policy, approval workflow, full audit system, sandbox/container isolation, or a production bastion host.

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
| node-gyp + C++ toolchain | — | Compile node-pty (optional; fallback to tmux if missing). Also needed for re2 (optional; ReDoS protection) |
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
   - ASK the user: "Do you have npx skills (skills.sh) installed? (Yes / No / Not sure)"
   - If Yes or Not sure (try first):
     ASK the user: "Install skills globally (available across all projects) or in this project only? (global / project)"
     If global: Run: npx skills add HLH2023/terminal-use-mcp -s terminal-use -s terminal-use-setup -g
     If project: Run: npx skills add HLH2023/terminal-use-mcp -s terminal-use -s terminal-use-setup
     If the command fails, fall back to manual download (see below).
   - If No (manual download):
     Download https://raw.githubusercontent.com/HLH2023/terminal-use-mcp/main/skills/terminal-use/SKILL.md
     and save to .claude/skills/terminal-use/SKILL.md
     Download https://raw.githubusercontent.com/HLH2023/terminal-use-mcp/main/skills/terminal-use-setup/SKILL.md
     and save to .claude/skills/terminal-use-setup/SKILL.md
   - ASK the user: "Do you need to remotely control any of these AI agent TUIs via terminal-use-mcp?
     - Claude Code TUI (tui-claude-code)
     - Codex CLI TUI (tui-codex-cli)
     - OpenCode TUI (tui-opencode-native)
     - OpenCode + OmO plugin TUI (tui-opencode-omo)
     If unsure, skip — you can add them later with: npx skills add HLH2023/terminal-use-mcp -s <skill-name>"
   - For each confirmed agent: if skills.sh is available, run
     npx skills add HLH2023/terminal-use-mcp -s <skill-name>
     (append -g if the user chose global install)
     Otherwise, download from
     https://raw.githubusercontent.com/HLH2023/terminal-use-mcp/main/skills/<skill-name>/SKILL.md
     and save to .claude/skills/<skill-name>/SKILL.md
   - ASK the user: "The core skill includes both local (§1-§11) and remote SSH (§12-§17) sections.
     If you only use local terminals, I can remove §12-§17 to save ~500 lines.
     Should I trim the skill?"

4. Restart Claude Code for the config to take effect

5. Verify:
   - Confirm terminal.health, terminal.start etc. appear in the MCP tool list
   - Call terminal.health to confirm server and provider status are OK
   - Compare the version in terminal.health response with the skill version header (e.g. v0.2.0).
     If they mismatch, inform the user and suggest updating skills with: npx skills update

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
   - ASK the user: "Do you have npx skills (skills.sh) installed? (Yes / No / Not sure)"
   - If Yes or Not sure (try first):
     ASK the user: "Install skills globally (available across all projects) or in this project only? (global / project)"
     If global: Run: npx skills add HLH2023/terminal-use-mcp -s terminal-use -s terminal-use-setup -g
     If project: Run: npx skills add HLH2023/terminal-use-mcp -s terminal-use -s terminal-use-setup
     If the command fails, fall back to manual download (see below).
   - If No (manual download):
     Download https://raw.githubusercontent.com/HLH2023/terminal-use-mcp/main/skills/terminal-use/SKILL.md
     and save to .codex/skills/terminal-use/SKILL.md
     Download https://raw.githubusercontent.com/HLH2023/terminal-use-mcp/main/skills/terminal-use-setup/SKILL.md
     and save to .codex/skills/terminal-use-setup/SKILL.md
   - ASK the user: "Do you need to remotely control any of these AI agent TUIs via terminal-use-mcp?
     - Claude Code TUI (tui-claude-code)
     - Codex CLI TUI (tui-codex-cli)
     - OpenCode TUI (tui-opencode-native)
     - OpenCode + OmO plugin TUI (tui-opencode-omo)
     If unsure, skip — you can add them later with: npx skills add HLH2023/terminal-use-mcp -s <skill-name>"
   - For each confirmed agent: if skills.sh is available, run
     npx skills add HLH2023/terminal-use-mcp -s <skill-name>
     (append -g if the user chose global install)
     Otherwise, download from
     https://raw.githubusercontent.com/HLH2023/terminal-use-mcp/main/skills/<skill-name>/SKILL.md
     and save to .codex/skills/<skill-name>/SKILL.md
   - ASK the user: "The core skill includes both local (§1-§11) and remote SSH (§12-§17) sections.
     If you only use local terminals, I can remove §12-§17 to save ~500 lines.
     Should I trim the skill?"

4. Restart Codex CLI for the config to take effect

5. Verify:
   - Confirm terminal.health appears when you start a session
   - Call terminal.health and compare the version with the skill version header (e.g. v0.2.0).
     If they mismatch, inform the user and suggest updating skills with: npx skills update

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
   - ASK the user: "Do you have npx skills (skills.sh) installed? (Yes / No / Not sure)"
   - If Yes or Not sure (try first):
     ASK the user: "Install skills globally (available across all projects) or in this project only? (global / project)"
     If global: Run: npx skills add HLH2023/terminal-use-mcp -s terminal-use -s terminal-use-setup -g
     If project: Run: npx skills add HLH2023/terminal-use-mcp -s terminal-use -s terminal-use-setup
     If the command fails, fall back to manual download (see below).
   - If No (manual download):
     Download https://raw.githubusercontent.com/HLH2023/terminal-use-mcp/main/skills/terminal-use/SKILL.md
     and save to .opencode/skills/terminal-use/SKILL.md
     Download https://raw.githubusercontent.com/HLH2023/terminal-use-mcp/main/skills/terminal-use-setup/SKILL.md
     and save to .opencode/skills/terminal-use-setup/SKILL.md
   - ASK the user: "Do you need to remotely control any of these AI agent TUIs via terminal-use-mcp?
     - Claude Code TUI (tui-claude-code)
     - Codex CLI TUI (tui-codex-cli)
     - OpenCode TUI (tui-opencode-native)
     - OpenCode + OmO plugin TUI (tui-opencode-omo)
     If unsure, skip — you can add them later with: npx skills add HLH2023/terminal-use-mcp -s <skill-name>"
   - For each confirmed agent: if skills.sh is available, run
     npx skills add HLH2023/terminal-use-mcp -s <skill-name>
     (append -g if the user chose global install)
     Otherwise, download from
     https://raw.githubusercontent.com/HLH2023/terminal-use-mcp/main/skills/<skill-name>/SKILL.md
     and save to .opencode/skills/<skill-name>/SKILL.md
   - ASK the user: "The core skill includes both local (§1-§11) and remote SSH (§12-§17) sections.
     If you only use local terminals, I can remove §12-§17 to save ~500 lines.
     Should I trim the skill?"

4. Restart OpenCode for the config to take effect

5. Verify:
   - Confirm terminal.health, terminal.start etc. appear in the MCP tool list
   - Call terminal.health and compare the version with the skill version header (e.g. v0.2.0).
     If they mismatch, inform the user and suggest updating skills with: npx skills update

Constraints:
- Do not output any secrets
- Only notify me if node-pty compilation fails; handle other issues yourself
```

</details>

## Skills (Optional)

terminal-use-mcp provides **core skills** (`terminal-use` and `terminal-use-setup`, available in the [GitHub repository](https://github.com/HLH2023/terminal-use-mcp/tree/main/skills)) that teach AI agents how to use the MCP tools correctly and how to configure the server. Additionally, there are **agent-specific skills** for controlling external AI agent TUIs. Skills are not included in the npm package — download them from GitHub. Install only the ones you need.

### Installation via skills.sh (Recommended)

[skills.sh](https://skills.sh) (`npx skills`) provides one-command install and update for skills across 19+ AI agent platforms:

```bash
# Interactive selection — pick which skills to install (default when repo has multiple skills)
npx skills add HLH2023/terminal-use-mcp

# Install only core skills (recommended for most users)
npx skills add HLH2023/terminal-use-mcp -s terminal-use -s terminal-use-setup

# Install a specific agent TUI skill
npx skills add HLH2023/terminal-use-mcp -s tui-claude-code

# Install all skills (core + all agent TUI skills)
npx skills add HLH2023/terminal-use-mcp --all

# Install globally (available across projects)
npx skills add HLH2023/terminal-use-mcp -s terminal-use -s terminal-use-setup -g

# Update installed skills to latest
npx skills update
```

> **Tip**: Only install the TUI skills you need. For normal terminal automation (lazygit, vim, htop, REPLs), the two core skills are sufficient.

### Manual Installation

Download SKILL.md files from [GitHub](https://github.com/HLH2023/terminal-use-mcp/tree/main/skills) and place them in your agent's skill directory:

| Skill | Required? | Install |
|-------|-----------|---------|
| `terminal-use` | **Yes** (core operations) | Copy `skills/terminal-use/` into your project's skill directory |
| `terminal-use-setup` | **Yes** (core configuration) | Copy `skills/terminal-use-setup/` into your project's skill directory |
| `tui-claude-code` | If you remotely control Claude Code | Copy `skills/tui-claude-code/` |
| `tui-codex-cli` | If you remotely control Codex CLI | Copy `skills/tui-codex-cli/` |
| `tui-opencode-native` | If you remotely control OpenCode | Copy `skills/tui-opencode-native/` |
| `tui-opencode-omo` | If you remotely control OpenCode with OmO | Copy `skills/tui-opencode-omo/` |

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
| `TERMINAL_USE_ALLOWED_CWD` | Allowed working directories (CSV) | _(empty; workspace root is always allowed via TERMINAL_USE_WORKSPACE_ROOT)_ |
| `TERMINAL_USE_CWD_POLICY_MODE` | CWD policy for local `terminal.start`. `"guarded"` allows workspaceRoot/allowedCwdRoots, blocks known dangerous roots, and allows other non-denied dirs. `"strict"` only allows workspaceRoot/allowedCwdRoots. | `guarded` |
| `TERMINAL_USE_ALLOW_COMMANDS` | Commands allowed even if on deny list (CSV, overrides deny) | _(empty)_ |
| `TERMINAL_USE_DENY_COMMANDS` | Extra denied commands beyond built-in list (CSV) | _(empty)_ |
| `TERMINAL_USE_RISKY_COMMAND_MODE` | How to handle denied commands: `deny`, `ask`, or `allow` | `deny` |
| `TERMINAL_USE_CAPABILITY_PRESET` | Provider preset: `local`, `remote`, `persistent`, `remote-persistent`, `full`, `custom` | `local` |
| `TERMINAL_USE_TOOL_PROFILE` | Tool profile: `minimal`, `local-tui`, `remote-tui`, `persistent-tui`, `full`, `auto` | `auto` |
| `TERMINAL_USE_EXTRA_TOOLS` | Add tools beyond profile (CSV) | _(empty)_ |
| `TERMINAL_USE_DISABLED_TOOLS` | Remove tools from profile (CSV) | _(empty)_ |

#### Session & Behavior

| Variable | Purpose | Default |
|----------|---------|---------|
| `TERMINAL_USE_SESSION_TTL_MS` | Session auto-cleanup timeout (ms) | `3600000` (1 hour) |
| `TERMINAL_USE_CLEANUP_INTERVAL_MS` | How often to check for expired sessions (ms) | `60000` (1 min) |
| `TERMINAL_USE_DEFAULT_COLS` | Default terminal columns for new sessions | `120` |
| `TERMINAL_USE_DEFAULT_ROWS` | Default terminal rows for new sessions | `30` |
| `TERMINAL_USE_DEFAULT_WAIT_FOR_TEXT_TIMEOUT_MS` | Default timeout for `wait_for_text` (ms); overridden by `timeoutMs` param | `10000` |
| `TERMINAL_USE_DEFAULT_WAIT_STABLE_TIMEOUT_MS` | Default timeout for `wait_stable` (ms); overridden by `timeoutMs` param | `5000` |
| `TERMINAL_USE_DEFAULT_WAIT_STABLE_IDLE_MS` | Default idle window for `wait_stable` (ms); overridden by `idleMs` param | `500` |
| `TERMINAL_USE_LARGE_PASTE_LIMIT` | Paste size threshold requiring confirmation (characters) | `2000` |
| `TERMINAL_USE_HARD_PASTE_LIMIT` | Hard paste size limit — pastes above this are always refused (characters) | `10000` |
| `TERMINAL_USE_LOG_LEVEL` | Log verbosity: `debug`, `info`, `warn`, `error` | `info` |
| `TERMINAL_USE_HOSTS_CONFIG` | Path to SSH host profiles configuration file | XDG config dir / hosts.json (profiles/*.json takes priority) |
| `TERMINAL_USE_ALLOW_INLINE_SSH_TARGETS` | Set to `1` to allow inline SSH host specification in tool calls | _(not set — denied)_ |
| `TERMINAL_USE_STORE_RAW_TRANSCRIPT` | Set to `1` to also save raw (unredacted) transcript files | _(not set — only redacted)_ |
| `TERMINAL_USE_SECRET_ENV_POLICY` | Secret env var handling: `deny`, `warn`, `allow` | `deny` |
| `TERMINAL_USE_SESSION_ID_MATCH` | Session ID matching: `strict`, `lenient` | `lenient` |
| `TERMINAL_USE_AUDIT_LOG` | Enable audit log to `<artifactDir>/audit.ndjson` | `1` |

#### Configuration File (config.json)

Environment variables are convenient for quick overrides, but for persistent settings you can create a `config.json` file. The server **does not auto-create** this file — you must create it manually.

**File location** (auto-discovered, no need to specify the path unless you override it):

| Platform | Default path |
|----------|-------------|
| Linux | `~/.config/terminal-use-mcp/config.json` |
| macOS | `~/Library/Application Support/terminal-use-mcp/config.json` |
| Windows | `%APPDATA%/terminal-use-mcp/config.json` |

Override the config directory with `TERMINAL_USE_CONFIG_DIR`, or the file path directly with `TERMINAL_USE_CONFIG_FILE`.

**File format** ([JSON Schema](https://github.com/HLH2023/terminal-use-mcp/blob/main/docs/config-schema.json) · [Zod source](https://github.com/HLH2023/terminal-use-mcp/blob/main/src/targets/config-schema.ts)):

```json
{
  "version": 1,
  "local": {
    "workspaceRoot": "/path/to/project",
    "defaultWaitForTextTimeoutMs": 60000,
    "defaultWaitStableTimeoutMs": 30000,
    "defaultWaitStableIdleMs": 500,
    "logLevel": "debug"
  },
  "sshDefaults": {
    "connectTimeoutMs": 15000,
    "keepaliveIntervalMs": 20000
  }
}
```

All fields are optional — only include what you want to override from defaults. String values support `${ENV_VAR}` placeholders (e.g., `"workspaceRoot": "${HOME}/projects/my-app"`).

**Priority**: environment variables > config.json > code defaults. If the same setting is configured in both `config.json` and an environment variable, the environment variable wins.

#### Path Overrides

| Variable | Purpose | Default |
|----------|---------|---------|
| `TERMINAL_USE_ARTIFACT_DIR` | Override artifact/transcript output directory | `<data-dir>/artifacts` |
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
| `ComSpec` | Windows command interpreter path (used by native-pty shell wrapping) | Windows |

#### SSH Authentication

| Variable | Purpose | Default |
|----------|---------|---------|
| `SSH_AUTH_SOCK` | SSH agent socket path (discovered automatically if not set; see ssh-auth.ts discovery chain) | _(auto-discovered)_ |
| `SSH_PROXY_JUMP` | SSH ProxyJump configuration (passed to SSH connection) | _(not set)_ |
| `TERMINAL_USE_SSH_AGENT_DISCOVERY` | SSH agent socket discovery mode: `env-only`, `xdg`, `scan` | `xdg` |

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
| `terminal.verify_target` | Verify SSH target local readiness preflight |

### Tmux Management (2 tools)

| Tool | Purpose |
|------|---------|
| `terminal.tmux_list` | List local or remote tmux sessions |
| `terminal.tmux_kill` | Kill a tmux session by name |

## Security Overview

terminal-use-mcp is not a sandbox. Security policies restrict the entry point, not the TUI program's internal behavior.

- **Command allow + deny lists**: Built-in deny list blocks dangerous startup commands (`sudo`, `rm`, `ssh`, `curl`, etc.). `TERMINAL_USE_ALLOW_COMMANDS` overrides the deny list (allow takes priority). `TERMINAL_USE_DENY_COMMANDS` extends it. `TERMINAL_USE_RISKY_COMMAND_MODE` controls how denied commands are handled: `deny` (default, block), `ask` (return confirmation prompt), or `allow` (permit all).
- **CWD policy**: Controls which directories `terminal.start` can use as working directories. `TERMINAL_USE_WORKSPACE_ROOT` and `TERMINAL_USE_ALLOWED_CWD` define the allowlist. `TERMINAL_USE_CWD_POLICY_MODE` controls the policy mode: `"guarded"` (default) allows workspaceRoot/allowedCwdRoots, blocks known dangerous roots (`/`, `/root`, `/etc`, etc.), and allows other non-denied dirs; `"strict"` only allows dirs within workspaceRoot or allowedCwdRoots — all others are denied. For agent/homelab/remote-ops usage, set `TERMINAL_USE_CWD_POLICY_MODE=strict` to make cwd a true allowlist.
- **Secret redaction**: Auto-replaces API keys, tokens, private keys with `<REDACTED_*>` in output
- **Confirmation detection**: Warns when dangerous prompts appear on screen
- **Provider whitelist**: `TERMINAL_USE_PROVIDERS` controls which providers are enabled (unset = all)
- **observationTrust**: All snapshots return `observationTrust: "untrusted"` — terminal output is untrusted observation, not instruction
- **ReDoS protection**: User-supplied regex is validated against catastrophic backtracking. When the `re2` optional dependency is installed, all regex execution uses the RE2 engine (guaranteed linear time). Without `re2`, a heuristic nested-quantifier detector blocks known dangerous patterns.
- **Capability presets**: `TERMINAL_USE_CAPABILITY_PRESET` simplifies provider configuration with named presets (local, remote, persistent, etc.) instead of manual provider lists
- **Tool profiles**: `TERMINAL_USE_TOOL_PROFILE` controls which MCP tools are registered, from `minimal` (6 tools) to `full` (29 tools). Default: `auto` (selected from capability preset)
- **Secret env policy**: Detects suspected secret environment variables (TOKEN, SECRET, PASSWORD, etc.) in `input.env` and `profile.env`. Default: `deny` (reject). Configurable via `TERMINAL_USE_SECRET_ENV_POLICY`
- **Audit log**: All tool invocations recorded to `<artifactDir>/audit.ndjson` with allow/deny/error decisions and redacted input summaries. Enabled by default. Audit write failure does not affect main flow

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

## Version & Updates

### Checking Your Version

Call `terminal.health` — the response includes a `version` field reflecting the running server version.

### npx Caching Behavior

`npx` **does not auto-update**. It caches the package on first run and reuses the cached version until the cache expires. To ensure you're running the latest version:

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

If a TUI program updates and keybindings change, update the corresponding skill yourself or submit a PR. The core `terminal-use` skill is updated with each server release.

### CWD Policy Mode

`TERMINAL_USE_CWD_POLICY_MODE` controls CWD restriction for `terminal.start`:

| Mode | Behavior |
|------|----------|
| `guarded` (default) | Allows `workspaceRoot` + `allowedCwd`, blocks known dangerous roots (`/`, `/root`, `/etc`, …), allows other non-denied dirs |
| `strict` | Only allows `workspaceRoot` + `allowedCwd` — all other dirs denied |

For production/agent usage, set `TERMINAL_USE_CWD_POLICY_MODE=strict` to make CWD a true allowlist.

## Further Reading

| Topic | Document |
|-------|----------|
| Config file JSON Schema | [docs/config-schema.json](https://github.com/HLH2023/terminal-use-mcp/blob/main/docs/config-schema.json) |
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
| re2 (optional) | BSD-3-Clause |

## Contributing

Contributions are welcome! Here's how to get started:

### Branch Strategy

| Branch | Purpose | Push Access |
|--------|---------|-------------|
| `main` | Stable releases only | PR required (enforced) |
| `dev` | Active development | PR required for external contributors; maintainers can push directly |

### Development Workflow

1. **Fork** the repository
2. **Create a feature branch** from `dev`: `git checkout -b feature/your-feature dev`
3. **Make changes** and ensure all tests pass:
   ```bash
   npm run typecheck   # tsc --noEmit — zero errors
   npm test            # All tests must pass
   npm run build       # Must succeed
   ```
4. **Commit** with [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat: add new provider
   fix: correct scroll behavior
   docs: update SSH guide
   ```
5. **Push** your branch and **open a Pull Request** against `dev`
6. **Address review feedback** and wait for approval

### Reporting Issues

- **Bug reports**: [Open an issue](https://github.com/HLH2023/terminal-use-mcp/issues/new?template=bug_report.md) with reproduction steps, expected vs actual behavior, and environment info
- **Feature requests**: [Open an issue](https://github.com/HLH2023/terminal-use-mcp/issues/new?template=feature_request.md) with use case and proposed API
- **Security vulnerabilities**: Please report privately — see [SECURITY.md](SECURITY.md) for details

### Code Style

- TypeScript strict mode — no `any`, no `@ts-ignore`
- ESM (`"type": "module"`)
- All public APIs must have JSDoc comments
- Test coverage for new features (vitest)

### Adding Skills

Skills are Markdown files in `skills/` with YAML frontmatter (`name` + `description`). To add a new skill:

1. Create `skills/<skill-name>/SKILL.md` with frontmatter
2. Test with `npx skills add HLH2023/terminal-use-mcp -s <skill-name> --dry-run` (local)
3. Submit a PR against `dev`

## License

MIT
