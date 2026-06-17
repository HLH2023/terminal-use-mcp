---
name: tui-codex-cli
description: 'Control OpenAI Codex CLI TUI via terminal-use-mcp — keybindings, slash commands, permission modes, and interaction flows.'
---

# tui-codex-cli: Control Codex CLI TUI

> **Reference: Codex CLI v0.140.0** — Keybindings verified against this version. This skill is community-maintained; it is NOT updated in lockstep with Codex CLI releases. If Codex CLI updates break keybindings, update this skill yourself or submit a PR to [GitHub](https://github.com/HLH2023/terminal-use-mcp/tree/main/skills).

> This skill is optional. Only install if you need to control this agent's TUI via terminal-use-mcp.

> This skill is useful when one AI agent needs to remotely control a Codex CLI TUI session via terminal-use-mcp.

Operational skill for controlling the OpenAI Codex CLI TUI through terminal-use-mcp. Includes keybindings, slash commands, permission modes, and interaction flows.

## When To Use

- You need to start and interactively control an OpenAI Codex CLI TUI through terminal-use-mcp.
- You need to switch permission modes or run slash commands inside Codex CLI.
- You need to read Codex CLI conversation content, view diffs, or approve actions.
- You need to run shell commands through Codex CLI.

## Core Operation Flow

### Start And Readiness Check

```
1. terminal.start(command="codex", cwd="~/project")
2. terminal.wait_stable(idleMs=5000, timeoutMs=20000)
3. terminal.find("codex|What|Ask")  # Confirm the UI is ready
```

### Send A Message

```
terminal.type("your question")
terminal.press("enter")
terminal.wait_stable(idleMs=15000, timeoutMs=120000)
```

### Exit

```
terminal.press("ctrl+c")            # Exit
```

## Core Keybindings

| Key | Function | Notes |
|-----|----------|-------|
| `enter` | Submit message | Send current input |
| `tab` | Complete / queue | Command autocomplete; queues the next turn while a task is running |
| `escape` | Backtrack edit | When the input box is empty, edit the previous message |
| `ctrl+c` | Exit | Exits in composer; closes in pager |
| `ctrl+o` | Copy latest response | Copy the most recently completed agent output |
| `ctrl+v` | Paste image | Paste an image from the clipboard |
| `ctrl+l` | Clear screen | Clear terminal display |
| `ctrl+t` | Open transcript | View conversation history |
| `ctrl+g` | External editor | Edit the current draft |
| `alt+r` | Raw scrollback playback | Toggle raw scrollback view |
| `q` | Close pager | Exit views such as `/diff` |

### Input Box Newline

| Key | Function |
|-----|----------|
| `ctrl+j` / `ctrl+m` | Insert newline |
| `shift+enter` | Insert newline |
| `alt+enter` | Insert newline |

### Shell Command Execution

Type `!cmd` to run a local shell command directly. The output appears in the conversation:

```
terminal.type("!git status")
terminal.press("enter")
```

## Slash Command Quick Reference

Type `/` to open the command palette. It contains 46+ commands. Core commands:

| Command | Function |
|---------|----------|
| `/model` | Select model / reasoning |
| `/permissions` | Switch permission / approval policy |
| `/keymap` | Remap keybindings |
| `/vim` | Toggle Vim mode |
| `/compact` | Compact conversation |
| `/clear` | Clear screen and start a new conversation |
| `/new` | New session |
| `/diff` | Show git diff, including untracked files |
| `/review` | Code review |
| `/approve` | Retry the latest action rejected by auto-review |
| `/rename` | Rename thread |
| `/resume` | Resume a saved session |
| `/fork` | Fork current session |
| `/archive` | Archive and exit |
| `/delete` | Permanently delete and exit |
| `/init` | Generate AGENTS.md |
| `/ide` | Include IDE context |
| `/experimental` | Experimental feature toggles |
| `/memories` | Memory settings |
| `/skills` | Skill management |
| `/hooks` | Lifecycle hooks |
| `/import` | Import Claude Code configuration/history |
| `/mcp` | MCP tool management |
| `/app` | Continue to Codex Desktop |
| `/agent` | Switch agent thread |
| `/side` | Side conversation |
| `/copy` | Copy the last response |
| `/raw` | Raw scrollback |
| `/mention` | Mention file |
| `/status` | Session status |
| `/theme` | Syntax theme |
| `/logout` | Log out |
| `/exit` | Exit |
| `/feedback` | Send feedback |
| `/ps` | Background terminal list |
| `/stop` | Stop background terminal |
| `/pets` | Terminal pet |
| `/title` | Terminal title item |
| `/statusline` | Status line item |
| `/rollout` | Print rollout path |
| `/subagents` | Switch agent thread |

## Permission Modes

| Mode | Behavior | Entry |
|------|----------|-------|
| Read Only | Read-only, no file modifications | `--sandbox readonly` or `/permissions` |
| Workspace | Can edit workspace files | `--sandbox workspace-write` or `/permissions` |
| Workspace with network | Workspace access plus network access | `/permissions` |
| Full Access | Full access | `--sandbox full` or `/permissions` |

> Warning: `--full-auto` is deprecated. Prefer `--sandbox workspace-write`.

**Operation**: `/permissions` is the entry point for switching policies inside the TUI.

## Approval Modal

High-risk operations enter an approval modal:
- `Esc` in an MCP prompt does not silently continue.
- You must explicitly choose allow or deny.

## Diff View

`/diff` shows git diff, including untracked files:
- `q`/`ctrl+c` exits the view.
- Standard pager scrolling is supported.

## TUI Layout

- Main screen: full-screen TUI with bottom composer plus historical transcript.
- Command popup: opens when you type `/`.
- Status bar: shows current mode, model, and permission level.

## Reading Long Conversations

Codex CLI uses the alt buffer, so terminal scrollback is 0.

**Recommended method**:
1. `mouse_scroll(direction="up")` - scroll upward with the mouse wheel.
2. `terminal.press("alt+r")` - switch to raw scrollback for long output.
3. `terminal.press("ctrl+t")` - open the transcript to view the full conversation.
4. `snapshot()` - read the current visible viewport.
5. `find(pattern, {includeScrollback: true})` - search inside the native-pty buffer.

## Common Operation Examples

### Switch Permission Mode

```
terminal.type("/permissions")
terminal.press("enter")
terminal.wait_stable(idleMs=2000)
terminal.press("down")                    # Select Workspace
terminal.press("enter")                   # Confirm
```

### View Diff

```
terminal.type("/diff")
terminal.press("enter")
terminal.wait_stable(idleMs=3000)
terminal.snapshot()                        # Read diff content
terminal.press("q")                        # Exit diff view
```

### Execute A Shell Command

```
terminal.type("!git log --oneline -5")
terminal.press("enter")
terminal.wait_stable(idleMs=2000)
terminal.snapshot()
```

### Vim Mode

```
terminal.type("/vim")
terminal.press("enter")
# The input box is now in Vim editing mode
# Use i to enter insert mode, Esc to return to normal mode
```

## Notes

1. **Tab queueing**: Pressing Tab while a task is running queues input for the next turn instead of sending immediately.
2. **Esc backtrack edit**: Pressing Esc with an empty input box edits the previous message.
3. **`!` prefix**: Runs a shell command directly; output appears in the conversation.
4. **`--full-auto` is deprecated**: Use `--sandbox workspace-write` instead.
5. **Vim mode**: After `/vim`, the input box uses Vim-style editing and requires Vim editing knowledge.
6. **Ink TUI**: It uses the alt buffer; `mode: "full"` still returns only the current visible viewport.
7. **Version**: Current latest stable version is `0.139.0`; pre-release is `0.140.0-alpha.14`.

> For the base terminal control skill, see [terminal-use](../terminal-use/SKILL.md).
