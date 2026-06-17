---
name: tui-claude-code
description: 'Control Claude Code TUI via terminal-use-mcp — key mappings, slash commands, permission modes, and interaction flows.'
---

# tui-claude-code: Control Claude Code TUI

> **Reference: Claude Code v2.1.179** — Keybindings verified against this version. This skill is community-maintained; it is NOT updated in lockstep with Claude Code releases. If Claude Code updates break keybindings, update this skill yourself or submit a PR to [GitHub](https://github.com/HLH2023/terminal-use-mcp/tree/main/skills).

> This skill is optional. Only install if you need to control this agent's TUI via terminal-use-mcp.

> This skill is useful when one AI agent needs to remotely control a Claude Code TUI session via terminal-use-mcp.

Operational skill for controlling the Claude Code TUI through terminal-use-mcp. Includes complete key mappings, slash commands, permission modes, and interaction flows.

## When To Use

- You need to start and interactively control a Claude Code TUI through terminal-use-mcp.
- You need to switch permission modes or run slash commands inside Claude Code.
- You need to read Claude Code conversation content or search historical messages.
- You need advanced features such as the transcript viewer, `/btw` side questions, or background tasks.

## Core Operation Flow

### Start And Readiness Check

```
1. terminal.start(command="claude", cwd="~/project")
2. terminal.wait_stable(idleMs=5000, timeoutMs=15000)
3. terminal.find("claude|Hi|What")  # Confirm the UI is ready
```

### Send A Message

```
terminal.type("your question")
terminal.press("enter")
terminal.wait_stable(idleMs=15000, timeoutMs=120000)  # Wait for the model response
```

### Interrupt And Exit

```
terminal.press("escape")          # Interrupt the current response/tool call
terminal.press("ctrl+c")          # Interrupt input; press a second time to exit
terminal.press("ctrl+d")          # Exit
```

## Global Keybindings

| Key | Function | Notes |
|-----|----------|-------|
| `ctrl+c` | Interrupt / clear input | First press clears input, second press exits |
| `escape` | Interrupt current response/tool call | Stops active generation |
| `escape`+`escape` | Clear draft / open rewind | Double Esc opens rewind when input is empty |
| `ctrl+d` | Exit | Exit directly |
| `ctrl+l` | Redraw screen | Refresh terminal display |
| `ctrl+o` | Transcript viewer | View/browse the full conversation record |
| `ctrl+r` | History search | Search previous commands |
| `ctrl+b` | Background current task | Move the current task to the background |
| `ctrl+t` | Task list | View background tasks |
| `shift+tab` | Cycle permission mode | Cycles default -> acceptEdits -> plan |
| `alt+p` / `option+p` | Switch model | Open model picker |
| `alt+t` / `option+t` | Toggle extended thinking | Enable/disable deeper thinking |
| `alt+o` / `option+o` | Toggle fast mode | Fast mode |
| `ctrl+g` / `ctrl+x`+`ctrl+e` | External editor | Edit the message in an external editor |
| `ctrl+j` | Insert newline | Add a line break in the input box |
| `ctrl+v` / `cmd+v` / `alt+v` | Paste image | Paste an image from the clipboard |
| `up`/`down` or `ctrl+p`/`ctrl+n` | Cursor movement / history | Move up/down or browse message history |

## Permission Modes

| Mode | Behavior | Entry |
|------|----------|-------|
| `default` | Read-only | Default / `shift+tab` cycle |
| `acceptEdits` | Allow regular edits and common file operations | `shift+tab` cycle |
| `plan` | Research only, no file changes | `shift+tab` cycle |
| `auto` | Automatic execution with safety classifier | Added to the cycle only after conditions are met |
| `dontAsk` | Pre-approved tools only | Added to the cycle only after conditions are met |
| `bypassPermissions` | Skip checks; isolated environments only | Added to the cycle only after conditions are met |

**Operation**: `shift+tab` cycles between `default -> acceptEdits -> plan` by default.

## Transcript Viewer

| Key | Function |
|-----|----------|
| `?` | Help |
| `{`/`}` | Jump to previous/next user message |
| `ctrl+e` | Show all |
| `[` | Export to terminal scrollback |
| `v` | Write to a temporary file |
| `q`/`ctrl+c`/`escape` | Exit |

## /btw Side Questions

| Key | Function |
|-----|----------|
| `space`/`enter`/`escape` | Close side question |
| `up`/`down` | Scroll content |
| `c` | Copy |
| `f` | Fork to a new session |
| `x` | Clear historical side questions |

## Slash Command Quick Reference

| Command | Function |
|---------|----------|
| `/help` | Show help |
| `/compact` | Compact context |
| `/clear` | Start a new conversation |
| `/model` | Switch model; without arguments opens the picker |
| `/plan` | Enter plan mode |
| `/fast` | Toggle fast mode |
| `/config` | Open settings |
| `/keybindings` | Open keybinding configuration |
| `/terminal-setup` | Configure terminal newline, Meta key, and tmux behavior |
| `/context` | Show context usage |
| `/resume` | Return to an old session |
| `/branch` / `/fork` | Fork session/subagent |
| `/agents` | Manage subagents |
| `/background` / `/bg` | Move session to background |
| `/tasks` | View background tasks |
| `/diff` | View diff |
| `/doctor` | Diagnostics |
| `/debug` | Debug |
| `/btw` | Side question |
| `/goal` | Track goal |
| `/cd` | Change working directory |
| `/plugin` | Plugin management |
| `/workflows` | Workflows |
| `/usage` | Usage statistics |
| `/desktop` | Desktop mode |
| `/remote-control` | Remote control |
| `/teleport` | Teleport |
| `/voice` | Voice |
| `/theme` | Theme |

## Reading Long Conversations

Claude Code uses an Ink TUI with the alt buffer, so terminal scrollback is 0.

**Recommended method**:
1. `terminal.press("ctrl+o")` - open the transcript viewer to inspect the full conversation.
2. `mouse_scroll(direction="up")` - scroll the conversation upward with the mouse wheel.
3. `snapshot()` - read the current visible viewport.
4. `find(pattern, {includeScrollback: true})` - search inside the native-pty buffer.

## Common Operation Examples

### Switch Permission Mode

```
terminal.press("shift+tab")                            # Cycle mode
terminal.wait_stable(idleMs=1000)
terminal.snapshot()                                     # Confirm the current mode
terminal.find("acceptEdits|plan|default")              # Verify the mode name
```

### View Diff

```
terminal.type("/diff")
terminal.press("enter")
terminal.wait_stable(idleMs=3000)
terminal.snapshot()
```

### Background Tasks

```
terminal.press("ctrl+b")               # Move the current task to the background
terminal.press("ctrl+t")               # View the background task list
terminal.type("/tasks")
terminal.press("enter")
```

### Side Question Feature

```
terminal.type("/btw")
terminal.press("enter")
terminal.wait_stable(idleMs=3000)
terminal.type("your side question")    # Type inside the side question prompt
terminal.press("enter")
```

## Notes

1. **Double Esc**: Quickly pressing Esc twice may trigger rewind, especially when input is empty.
2. **Permission mode cycle**: `shift+tab` only cycles `default -> acceptEdits -> plan`; `auto` and `bypassPermissions` require additional conditions.
3. **External editor**: `ctrl+g` depends on the `$EDITOR` or `$VISUAL` environment variable.
4. **Image paste**: `ctrl+v` requires image data in the clipboard.
5. **Ink TUI**: It uses the alt buffer; `mode: "full"` still returns only the current visible viewport.

> For the base terminal control skill, see [terminal-use](../terminal-use/SKILL.md).
