# Using terminal-use-mcp with Claude Code

This example shows how an agent can observe and respond to an external coding
agent (Claude Code) running in a terminal session.

> ⚠️ **Safety critical**: When controlling another agent, ALWAYS stop and ask
> the user before responding to any permission/approval prompt on screen.

## Prerequisites

- Claude Code CLI installed
- terminal-use-mcp configured in your agent's MCP config

## Workflow

### 1. Start Claude Code

```text
terminal.start({
  command: "claude",
  cwd: "/home/user/dev/my-project",
  label: "claude-code-agent",
  ttlMs: 7200000
})
→ {
    sessionId: "ses_x9y8z7",
    status: "starting",
    provider: "native-pty",
    ...
  }
```

### 2. Wait for the TUI to load

```text
terminal.wait_for_text({
  sessionId: "ses_x9y8z7",
  text: "claude",
  timeoutMs: 10000
})
terminal.wait_stable({ sessionId: "ses_x9y8z7", idleMs: 1000 })
```

### 3. Observe what Claude Code is doing

```text
terminal.snapshot({ sessionId: "ses_x9y8z7" })
→ {
    sessionId: "ses_x9y8z7",
    screen: "╭──────────────────────────────╮\n│ > Refactor the auth module   │\n│                              │\n│ ● Reading src/auth.ts...     │\n│ ● Analyzing dependencies...   │\n╰──────────────────────────────╯",
    highlights: [{ row: 2, colStart: 1, colEnd: 30, text: "● Reading src/auth.ts...", kind: "active" }],
    riskSignals: [],
    isFullscreen: true,
    ...
  }
```

Claude Code is working. The `highlights` show which line is currently active.
No `riskSignals`, so it's safe to wait.

### 4. Wait for work to progress

```text
terminal.wait_stable({ sessionId: "ses_x9y8z7", idleMs: 2000 })
terminal.snapshot({ sessionId: "ses_x9y8z7" })
→ {
    screen: "╭──────────────────────────────╮\n│ > Refactor the auth module   │\n│                              │\n│ ✓ Reading src/auth.ts        │\n│ ● Running: npm test          │\n│                              │\n│ ⚠ Allow command: npm test?  │\n│   [Y] Yes  [N] No            │\n╰──────────────────────────────╯",
    riskSignals: [{
      type: "external_agent_permission",
      text: "Allow command: npm test?",
      severity: "medium"
    }],
    ...
  }
```

### 5. Handle the approval prompt

🔴 **STOP.** The `riskSignals` array contains an `external_agent_permission`
entry. This means Claude Code is asking for permission to run a command.

**You MUST NOT type "Y" or "N" automatically.** Instead:

1. Report the prompt to the user: *"Claude Code is asking: 'Allow command: npm test?' — should I approve?"*
2. Wait for the user's explicit instruction.
3. Only then type the response.

If the user says "approve":

```text
terminal.type({ sessionId: "ses_x9y8z7", text: "Y" })
terminal.press({ sessionId: "ses_x9y8z7", key: "enter" })
terminal.wait_stable({ sessionId: "ses_x9y8z7", idleMs: 2000 })
```

If the user says "deny":

```text
terminal.type({ sessionId: "ses_x9y8z7", text: "N" })
terminal.press({ sessionId: "ses_x9y8z7", key: "enter" })
terminal.wait_stable({ sessionId: "ses_x9y8z7", idleMs: 2000 })
```

### 6. Continue monitoring

```text
terminal.snapshot({ sessionId: "ses_x9y8z7" })
→ {
    screen: "...",
    riskSignals: [],
    ...
  }
```

No more risk signals. Claude Code continues working.

### 7. Graceful shutdown when done

When the task is complete or you no longer need to observe:

```text
terminal.export_transcript({
  sessionId: "ses_x9y8z7",
  redact: true,
  format: "jsonl"
})
→ { path: "...", eventCount: 42, ... }

terminal.kill({ sessionId: "ses_x9y8z7" })
→ { ok: true }
```

## Safety Rules for Controlling Other Agents

1. **Never respond to a permission prompt without user confirmation.**
   Always check `riskSignals` in every snapshot.
2. **Look for `external_agent_permission`** — this is the most common type
   when controlling coding agents.
3. **Look for `credential_prompt`** — if the agent asks for a password/token,
   **never type it**. Report to the user immediately.
4. **Look for `destructive_prompt`** — if the agent wants to delete/overwrite
   files, stop and ask the user.
5. **Use `isFullscreen`** to detect TUI mode. Fullscreen TUIs need special
   care (cursor position, scrolling, etc.).
6. **Set a long `ttlMs`** for agent sessions — coding tasks can take minutes.
7. **Export transcript before killing** — you may need the history for debugging.
