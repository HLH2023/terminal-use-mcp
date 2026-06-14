[Back to README](../README.md)

# Scrollback Strategy — terminal-use-mcp

## Table of Contents

- [Two Buffer Modes](#two-buffer-modes)
- [Snapshot Mode Recommendations](#snapshot-mode-recommendations)
- [Browsing History in TUI Programs](#browsing-history-in-tui-programs)

Terminals have two buffer modes that affect how scrollback works. Understanding this distinction is critical for effective terminal control.

## Two Buffer Modes

| Mode | Programs | tmux `#{history_size}` | `snapshot(mode="full")` vs `mode="viewport"` |
|------|----------|------------------------|-----------------------------------------------|
| **Normal buffer** | bash, python REPL, shell commands | > 0 | `full` returns viewport + scrollback history |
| **Alternate buffer** | vim, htop, less, opencode, claude code, lazygit | = 0 | `full` is identical to `viewport` |

Alternate buffer (fullscreen TUI) programs have zero tmux scrollback. They take over the entire screen and manage their own internal scrolling. `terminal.scroll()` and `snapshot(mode="full")` provide no additional content for these programs.

## Snapshot Mode Recommendations

| Scenario | Recommended | Why |
|----------|-------------|-----|
| Normal shell, need recent output | `mode="viewport"` | Default, compact |
| Normal shell, need scrolled-off output | `mode="viewport"` + `scroll()` | Incremental, avoids context duplication |
| Normal shell, need ALL output at once | `mode="full"` | One-shot complete capture; use sparingly |
| TUI program (opencode/vim/htop) | `mode="viewport"` | `full` is identical, no savings |

## Browsing History in TUI Programs

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
