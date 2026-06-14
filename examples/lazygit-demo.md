# Using terminal-use-mcp with lazygit

This example shows how to control the lazygit TUI — navigate commits, view
diffs, and quit cleanly.

## Prerequisites

- lazygit installed (`go install github.com/jesseduffield/lazygit@latest`)
- Inside a git repository
- terminal-use-mcp configured

## Workflow

### 1. Start lazygit

```text
terminal.start({
  command: "lazygit",
  cwd: "/home/user/dev/my-project",
  label: "lazygit",
  cols: 120,
  rows: 40
})
→ {
    sessionId: "ses_lg01",
    status: "starting",
    provider: "native-pty",
    ...
  }
```

### 2. Wait for lazygit to load

```text
terminal.wait_for_text({
  sessionId: "ses_lg01",
  text: "Commits",
  timeoutMs: 5000
})
terminal.wait_stable({ sessionId: "ses_lg01", idleMs: 500 })
```

### 3. Observe the initial screen

```text
terminal.snapshot({ sessionId: "ses_lg01" })
→ {
    sessionId: "ses_lg01",
    screen: " 1 │ Status │ Unstaged Changes │  Logs  │ Stash │\n   │ Commits │                   │        │       │\n   │ Files   │                   │        │       │\n   │ ...     │                   │        │       │\n ● │ feat: add auth module        │        │       │\n   │ fix: resolve timeout issue   │        │       │\n   │ chore: update deps           │        │       │",
    isFullscreen: true,
    highlights: [{ row: 4, colStart: 1, colEnd: 3, text: "●", kind: "active" }],
    riskSignals: [],
    ...
  }
```

The `●` highlight shows the currently selected commit. The `Commits` panel is
active.

### 4. Navigate with arrow keys

Move down to the next commit:

```text
terminal.press({ sessionId: "ses_lg01", key: "down" })
terminal.wait_stable({ sessionId: "ses_lg01", idleMs: 200 })
terminal.snapshot({ sessionId: "ses_lg01" })
→ {
    highlights: [{ row: 5, colStart: 1, colEnd: 3, text: "●", kind: "active" }],
    screen: "...● │ fix: resolve timeout issue   │...",
    ...
  }
```

The selection moved to "fix: resolve timeout issue".

Move down one more:

```text
terminal.press({ sessionId: "ses_lg01", key: "down" })
terminal.wait_stable({ sessionId: "ses_lg01", idleMs: 200 })
```

Move back up:

```text
terminal.press({ sessionId: "ses_lg01", key: "up" })
terminal.wait_stable({ sessionId: "ses_lg01", idleMs: 200 })
```

### 5. Press Enter to view a commit diff

```text
terminal.press({ sessionId: "ses_lg01", key: "enter" })
terminal.wait_stable({ sessionId: "ses_lg01", idleMs: 500 })
terminal.snapshot({ sessionId: "ses_lg01" })
→ {
    screen: "commit abc1234\nAuthor: user <user@example.com>\nDate:   Sat Jun 13 10:00:00 2026\n\n    fix: resolve timeout issue\n\ndiff --git a/src/client.ts b/src/client.ts\n--- a/src/client.ts\n+++ b/src/client.ts\n@@ -42,7 +42,7 @@\n-    timeout: 5000,\n+    timeout: 30000,",
    isFullscreen: true,
    ...
  }
```

The commit detail view is now showing the diff.

### 6. Scroll through the diff

```text
terminal.press({ sessionId: "ses_lg01", key: "pagedown" })
terminal.wait_stable({ sessionId: "ses_lg01", idleMs: 200 })
```

Or use the dedicated scroll tool for more precise control:

```text
terminal.scroll({
  sessionId: "ses_lg01",
  direction: "down",
  lines: 10
})
→ { ok: true }
```

Scroll back up:

```text
terminal.scroll({
  sessionId: "ses_lg01",
  direction: "up",
  lines: 10
})
→ { ok: true }
```

### 7. Return to the main view

```text
terminal.press({ sessionId: "ses_lg01", key: "escape" })
terminal.wait_stable({ sessionId: "ses_lg01", idleMs: 300 })
```

### 8. Quit lazygit

```text
terminal.press({ sessionId: "ses_lg01", key: "q" })
terminal.wait_stable({ sessionId: "ses_lg01", idleMs: 500 })
terminal.snapshot({ sessionId: "ses_lg01" })
→ { status: "exited", exitCode: 0, ... }
```

The session exited cleanly with code 0.

### 9. Clean up

```text
terminal.kill({ sessionId: "ses_lg01" })
→ { ok: true }
```

## Tips for TUI Navigation

- **Use `wait_stable` with short idleMs (200-500ms)** after each keypress.
  TUIs re-render quickly but not instantly.
- **Arrow keys**: `up`, `down`, `left`, `right` — use the key names from
  `terminal.keys` for the full list.
- **Check `isFullscreen: true`** — lazygit is always fullscreen. This means
  the screen buffer is the entire terminal; there's no scrollback from the
  host shell.
- **Use `terminal.scroll`** instead of repeated `press("down")` for scrolling
  through long diffs — it's faster and more reliable.
- **Press `escape`** to go back from detail views to the main panel.
- **If lazygit shows a confirmation dialog** (e.g., "Are you sure you want to
  discard changes?"), check `riskSignals` for `destructive_prompt` and ask the
  user before responding.
