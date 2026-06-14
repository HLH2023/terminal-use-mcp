# Using terminal-use-mcp with OpenCode

This example shows how an agent running inside OpenCode can use terminal-use-mcp
to spawn a Node.js REPL, execute some code, verify the output, and cleanly
shut down.

## Prerequisites

- OpenCode configured with the terminal-use-mcp server (see `mcp.json.example`)
- Node.js installed

## Workflow

### 1. Start a Node.js REPL

```text
terminal.start({
  command: "node",
  cwd: "/home/user/dev/project",
  label: "node-repl"
})
→ {
    sessionId: "ses_a1b2c3",
    status: "starting",
    provider: "native-pty",
    cwd: "/home/user/dev/project",
    label: "node-repl",
    capabilities: { supportsHighlights: true, supportsScrollback: true, ... }
  }
```

### 2. Wait for the REPL to be ready

```text
terminal.wait_for_text({
  sessionId: "ses_a1b2c3",
  text: ">",
  timeoutMs: 5000
})
→ { screen: "> ", cursor: { x: 2, y: 0 }, ... }
```

### 3. Type code and execute

```text
terminal.type({ sessionId: "ses_a1b2c3", text: "const x = 42" })
terminal.press({ sessionId: "ses_a1b2c3", key: "enter" })
```

### 4. Wait for output to stabilize

```text
terminal.wait_stable({ sessionId: "ses_a1b2c3", idleMs: 500 })
→ { screen: "> const x = 42\nundefined\n> ", status: "running", ... }
```

### 5. Take a snapshot to verify the result

```text
terminal.snapshot({ sessionId: "ses_a1b2c3" })
→ {
    sessionId: "ses_a1b2c3",
    screen: "> const x = 42\nundefined\n> ",
    cursor: { x: 2, y: 2 },
    cols: 80,
    rows: 24,
    status: "running",
    highlights: [],
    riskSignals: [],
    timestamp: "2026-06-13T10:00:00.000Z",
    observationTrust: "untrusted"
  }
```

The output shows `undefined` (return value of a `const` declaration) followed
by the `>` prompt, confirming the code executed successfully.

### 6. Run a multi-line expression

```text
terminal.type({ sessionId: "ses_a1b2c3", text: "x * 2" })
terminal.press({ sessionId: "ses_a1b2c3", key: "enter" })
terminal.wait_stable({ sessionId: "ses_a1b2c3", idleMs: 500 })
terminal.snapshot({ sessionId: "ses_a1b2c3" })
→ {
    screen: "> const x = 42\nundefined\n> x * 2\n84\n> ",
    ...
  }
```

Result: `84` — the expression evaluated correctly.

### 7. Export the transcript

```text
terminal.export_transcript({
  sessionId: "ses_a1b2c3",
  redact: true,
  format: "jsonl",
  includeSnapshots: false
})
→ {
    path: "/home/user/dev/project/.terminal-use/sessions/ses_a1b2c3/transcript.jsonl",
    redacted: 0,
    snapshotCount: 0,
    eventCount: 8
  }
```

### 8. Kill the session

```text
terminal.kill({ sessionId: "ses_a1b2c3" })
→ { ok: true }
```

The transcript file is preserved on disk even after the session is killed.

## Tips

- **Always `wait_stable` after input** before reading a snapshot. TUI programs
  may take a few hundred ms to render.
- **Use `label`** to make `terminal.list` easier to read when you have
  multiple sessions.
- **Check `riskSignals`** in every snapshot. If the terminal shows a
  confirmation/destructive prompt, **STOP and ask the user** before typing
  anything.
- **Transcript export** is safe to call multiple times. Use it before killing
  if you need a record of what happened.
