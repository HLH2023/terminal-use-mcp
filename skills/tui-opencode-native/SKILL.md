# tui-opencode-native: Control OpenCode TUI

> This skill is optional. Only install if you need to control this agent's TUI via terminal-use-mcp.

> For OmO plugin version, use the `tui-opencode-omo` skill instead.

Operational skill for controlling the vanilla OpenCode TUI through terminal-use-mcp. Includes key mappings, command dialog behavior, interaction flows, and operational notes.

## When To Use

- You need to start and interactively control an OpenCode TUI through terminal-use-mcp.
- You need to run commands or switch model/session/agent inside OpenCode.
- You need to read OpenCode conversation content or search historical messages.
- You need to switch permission modes or perform specific operations inside OpenCode.

## Core Operation Flow

### Start And Readiness Check

```
1. terminal.start(command="opencode", cwd="~/project")
2. terminal.wait_stable(idleMs=5000, timeoutMs=15000)
3. terminal.find("Ask|Sisyphus|Welcome")  # Confirm the UI has finished rendering
```

### Send A Message

```
terminal.type("your question")
terminal.press("enter")
terminal.wait_stable(idleMs=15000, timeoutMs=120000)
```

### Exit

```
terminal.press("ctrl+c")  # Exit
```

## Global Keybindings (Source-Verified, Not README)

> Warning: README documentation differs from source code. README says Ctrl+A switches sessions, Ctrl+X cancels, and i focuses the editor.
> The source code actually uses Ctrl+S for session switching, Esc for cancellation, and i only for manual path input in the file picker.
> The table below follows the source code.

| Key | Function | Notes |
|-----|----------|-------|
| `ctrl+c` | Exit | Press twice to force exit |
| `ctrl+l` | Log page | Open log viewer |
| `ctrl+s` | Session switcher | Warning: conflicts with editor send key; global layer intercepts first |
| `ctrl+k` | Command dialog | Open command picker |
| `ctrl+o` | Model picker | Switch model/provider |
| `ctrl+f` | File picker | Select file |
| `ctrl+t` | Theme switcher | Switch theme |
| `ctrl+?` / `ctrl+h` / `ctrl+_` | Help panel | Show key overview |
| `escape` | Close current overlay | Return to previous layer |

## Chat / Editor Keybindings

| Key | Function |
|-----|----------|
| `ctrl+n` | Create/clear current session |
| `escape` | Interrupt current generation / cancel |
| `enter` | Send message |
| `ctrl+s` | Send message; conflicts with global session switcher, not recommended |
| `ctrl+e` | Open external editor |
| `@` | Open completion popup |
| `ctrl+r` | Enter attachment deletion mode |

### Attachment Deletion Mode

| Key | Function |
|-----|----------|
| `r` | Delete all attachments |
| `0`-`9` | Delete attachment by number |
| `escape` | Exit deletion mode |

## Session / Model / Theme Dialogs

| Dialog | Navigation | Select | Close |
|--------|------------|--------|-------|
| Session switcher | `up`/`down` or `j`/`k` | `enter` | `escape` |
| Model switcher | `up`/`down` or `j`/`k` | `enter` | `escape` |
| Provider switcher | `left`/`right` or `h`/`l` | `enter` | `escape` |
| Theme switcher | `up`/`down` or `j`/`k` | `enter` | `escape` |

## Permission Modal

| Key | Function |
|-----|----------|
| `left`/`right` or `tab` | Switch option |
| `enter`/`space` | Confirm |
| `a` | Allow |
| `s` | Allow for this session |
| `d` | Deny |

## Exit Confirmation Modal

| Key | Function |
|-----|----------|
| `left`/`right` or `tab` | Switch Yes/No |
| `enter`/`space` | Confirm |
| `y`/`Y` | Yes |
| `n`/`N` | No |

## Command System

OpenCode does not have TUI slash commands such as `/session` or `/help`. The command entry point is the command dialog opened with `Ctrl+K`.

Built-in commands are only two:
- `init` - initialize the project.
- `compact` - compact the current session.

Custom command sources:
- `$XDG_CONFIG_HOME/opencode/commands`
- `$HOME/.opencode/commands`
- `<data>/commands`

Command ID format: `user:*` / `project:*`

Commands with `$NAME` placeholders first open a multi-parameter dialog, then execute.

## Message Scrolling

| Key | Function |
|-----|----------|
| `pageup`/`pagedown` | Page up/down |
| `ctrl+u`/`ctrl+d` | Half-page scroll |

## Reading Long Conversations

OpenCode uses an Ink TUI with the alt buffer, so terminal scrollback is 0.

**Recommended method**:
1. `mouse_scroll(direction="up")` - scroll conversation history upward with the mouse wheel.
2. `snapshot()` - read the current visible viewport.
3. `find(pattern, {includeScrollback: true})` - search the full xterm buffer when native-pty is available.
4. `mouse_scroll(direction="down")` - scroll back to the bottom before continuing.

**Note**: The native-pty provider can search full scrollback with `find`; the tmux provider searches content captured by `capture-pane`.

## Help Panel

The help panel opened with `Ctrl+?` aggregates these keys:
- Global keys.
- Current page keys.
- Current overlay keys.
- Log page return key.

This is the final visible keybinding overview inside the TUI.

## Common Operation Examples

### Switch Model

```
terminal.press("ctrl+o")           # Open model picker
terminal.press("down")             # Move down
terminal.type("sonnet")            # Filter
terminal.press("enter")            # Select
```

### Switch Session

```
terminal.press("ctrl+s")           # Open session switcher
terminal.press("j")                # Move down
terminal.press("enter")            # Select
```

### Execute Command

```
terminal.press("ctrl+k")           # Open command dialog
terminal.type("compact")           # Type command
terminal.press("enter")            # Execute
```

> For the base terminal control skill, see [terminal-use](../terminal-use/SKILL.md).
