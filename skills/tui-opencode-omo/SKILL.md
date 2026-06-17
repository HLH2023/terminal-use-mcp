---
name: tui-opencode-omo
description: 'Control OpenCode + Oh My OpenAgent TUI via terminal-use-mcp — vanilla OpenCode controls plus OmO-specific Tab/Prometheus, ultrawork, Team Mode.'
---

# tui-opencode-omo: Control OpenCode + OmO TUI

> **Reference: OpenCode v1.17.7 + OmO plugin** — Keybindings verified against this version. This skill is community-maintained; it is NOT updated in lockstep with OpenCode or OmO releases. If updates break keybindings, update this skill yourself or submit a PR to [GitHub](https://github.com/HLH2023/terminal-use-mcp/tree/main/skills).

> This skill is optional. Only install if you need to control this agent's TUI via terminal-use-mcp.

> This skill is useful when one AI agent needs to remotely control an OpenCode + Oh My OpenAgent TUI session via terminal-use-mcp. It is self-contained and includes the full vanilla OpenCode controls plus OmO-specific additions.

Operational skill for controlling OpenCode with the Oh My OpenAgent plugin through terminal-use-mcp. Includes complete vanilla OpenCode key mappings, command dialog behavior, interaction flows, plus OmO-specific Tab/Prometheus, ultrawork loop, and Team Mode capabilities.

## When To Use

- You need to control an OpenCode TUI with the Oh My OpenAgent plugin installed through terminal-use-mcp.
- You need all vanilla OpenCode controls plus OmO-specific behavior in a single installed skill.
- You need Prometheus planning mode, ultrawork loop, or Team Mode.
- You need to trigger OmO-specific slash commands or keyword modes.

## Relationship To Native OpenCode

This skill is self-contained. It includes the full vanilla OpenCode TUI controls below: global keys, chat/editor keys, dialogs, command system, scrolling, help panel, and common examples.

It also records OmO additions and behavior changes. A user who installs only `tui-opencode-omo` has enough information to control OpenCode with OmO.

The key behavior change is `Tab`: in vanilla OpenCode, Tab switches agents such as Build/Plan; in OmO, Tab enters Prometheus planning mode when not editing.

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

## OmO-Specific Differences

### Tab Key -> Prometheus Mode

OmO maps `Tab` to the entry point for Prometheus planning mode:

```
terminal.press("tab")              # Enter Prometheus mode
terminal.type("your planning request")
terminal.press("enter")            # Submit to Prometheus
```

**Note**: Vanilla OpenCode uses Tab to switch agents such as Build/Plan. In OmO, Tab enters Prometheus when not editing.

### Natural-Language Keywords (Not Slash Commands)

The following keywords work directly in chat input and do not require a `/` prefix:

| Keyword | Function |
|---------|----------|
| `ultrawork` or `ulw` | Enter ultrawork deep work mode |
| `search` | Trigger search |
| `analyze` | Trigger analysis |
| `team` | Trigger Team Mode |
| `hyperplan` | Trigger hyperplanning |
| `hyperplan ultrawork` | Combine hyperplanning with deep work |

## OmO-Specific Slash Commands

| Command | Function |
|---------|----------|
| `/init-deep` | Initialize AGENTS.md knowledge base |
| `/start-work` | Start work from a Prometheus plan |
| `/ralph-loop` | Start self-referential development loop |
| `/ulw-loop` | Start ultrawork loop |
| `/cancel-ralph` | Cancel active Ralph loop |
| `/stop-continuation` | Stop all continuation mechanisms |
| `/refactor` | Intelligent refactoring command |
| `/handoff` | Create a context handoff prompt |
| `/remove-ai-slops` | Remove AI code smells |
| `/hyperplan` | Adversarial multi-agent planning |

## Team Mode

When enabled, Team Mode adds:
- The `team_*` tool family with 12 team collaboration tools.
- tmux visualization windows that show each member's output.
- Parallel subagent execution.

**Operation**: Type the `team` keyword in chat or use `/start-work`, then choose Team Mode.

## Runtime-Injected MCPs

The following MCPs are injected by the plugin runtime and do not appear in `opencode mcp list`:
- `websearch` / `exa` - web search.
- `context7` - documentation lookup.
- `grep_app` - GitHub code search.

Use `doctor --verbose` to inspect them.

## Complete Operation Flow Examples

### Prometheus Plan -> Ultrawork Execution

```
# 1. Start OpenCode
terminal.start(command="opencode", cwd="~/project")
terminal.wait_stable(idleMs=5000, timeoutMs=15000)

# 2. Enter Prometheus mode
terminal.press("tab")                    # Tab enters Prometheus
terminal.type("implement user authentication module")
terminal.press("enter")                  # Submit
terminal.wait_stable(idleMs=15000, timeoutMs=60000)  # Wait for the plan

# 3. After reviewing and confirming the plan, start ultrawork
terminal.type("ultrawork")
terminal.press("enter")
terminal.wait_stable(idleMs=30000, timeoutMs=120000)

# 4. Read the result
terminal.snapshot(mode="viewport")
terminal.find("done|complete|finished", {includeScrollback: true})

# 5. Exit
terminal.press("ctrl+c")
```

### Use ralph-loop Autonomous Loop

```
terminal.press("ctrl+k")                 # Command panel
terminal.type("ralph-loop")              # Type command
terminal.press("enter")                  # Execute
terminal.wait_stable(idleMs=30000, timeoutMs=180000)  # Wait for loop completion

# Check result after completion
terminal.find("done|complete|finished", {includeScrollback: true})
```

## Notes

1. **Tab behavior change**: In OmO, Tab enters Prometheus mode instead of only switching agents.
2. **Command panel still works**: Ctrl+K still opens the native command panel, and OmO commands also appear there.
3. **Team Mode requires tmux**: Team Mode's multi-window visualization depends on tmux.
4. **Runtime MCPs are not visible in `opencode mcp list`**: Plugin-injected MCPs require `doctor --verbose`.

> For the base terminal control skill, see [terminal-use](../terminal-use/SKILL.md).
