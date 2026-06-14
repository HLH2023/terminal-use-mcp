# Using terminal-use-mcp with OpenAI Codex CLI

This example shows how an agent can observe and interact with OpenAI's Codex
CLI running in a terminal session.

> ⚠️ **Safety critical**: Codex may prompt for file writes, command execution,
> or other dangerous operations. ALWAYS check `riskSignals` and ask the user
> before responding.

## Prerequisites

- OpenAI Codex CLI installed (`npm install -g @openai/codex`)
- `OPENAI_API_KEY` set in the environment
- terminal-use-mcp configured

## Workflow

### 1. Start Codex

```text
terminal.start({
  command: "codex",
  args: ["--model", "o4-mini"],
  cwd: "/home/user/dev/my-project",
  label: "codex-agent",
  env: { "OPENAI_API_KEY": "sk-..." },
  ttlMs: 7200000
})
→ {
    sessionId: "ses_cx01",
    status: "starting",
    provider: "native-pty",
    ...
  }
```

> ⚠️ **Do not hardcode API keys.** Pass them via the `env` parameter so they
> are scoped to this session, or set them in the MCP server config's `env`
> block.

### 2. Wait for the TUI to load

```text
terminal.wait_for_text({
  sessionId: "ses_cx01",
  text: "codex",
  timeoutMs: 10000
})
terminal.wait_stable({ sessionId: "ses_cx01", idleMs: 1000 })
terminal.snapshot({ sessionId: "ses_cx01" })
→ {
    screen: "╭─────────────────────────────────────╮\n│  OpenAI Codex CLI                    │\n│  Model: o4-mini                      │\n│                                      │\n│  > What should I do?                 │\n│                                      │\n╰─────────────────────────────────────╯",
    isFullscreen: true,
    ...
  }
```

### 3. Send a task prompt

Type the task you want Codex to work on:

```text
terminal.type({ sessionId: "ses_cx01", text: "Add input validation to the login form component" })
terminal.press({ sessionId: "ses_cx01", key: "enter" })
terminal.wait_stable({ sessionId: "ses_cx01", idleMs: 2000 })
```

### 4. Monitor Codex's progress

Periodically check what Codex is doing:

```text
terminal.snapshot({ sessionId: "ses_cx01" })
→ {
    screen: "...● Reading src/components/LoginForm.tsx...\n● Planning changes...\n● Writing src/components/LoginForm.tsx...",
    riskSignals: [],
    ...
  }
```

No risk signals — Codex is working autonomously.

### 5. Handle a file write approval

```text
terminal.snapshot({ sessionId: "ses_cx01" })
→ {
    screen: "...● Codex wants to write:\n  src/components/LoginForm.tsx\n\n  [A]pprove  [R]eject  [D]iff",
    riskSignals: [{
      type: "external_agent_permission",
      text: "Codex wants to write: src/components/LoginForm.tsx",
      severity: "medium"
    }],
    ...
  }
```

🔴 **STOP.** Report to the user: *"Codex wants to write src/components/LoginForm.tsx — approve, reject, or view diff?"*

If the user says "approve":

```text
terminal.type({ sessionId: "ses_cx01", text: "A" })
terminal.press({ sessionId: "ses_cx01", key: "enter" })
terminal.wait_stable({ sessionId: "ses_cx01", idleMs: 2000 })
```

If the user says "view diff first":

```text
terminal.type({ sessionId: "ses_cx01", text: "D" })
terminal.press({ sessionId: "ses_cx01", key: "enter" })
terminal.wait_stable({ sessionId: "ses_cx01", idleMs: 1000 })
terminal.snapshot({ sessionId: "ses_cx01" })
→ {
    screen: "...diff --git a/src/components/LoginForm.tsx\n-  const handleSubmit = () => {\n+  const handleSubmit = () => {\n+    if (!email) {\n+      setError('Email is required');\n+      return;\n+    }...",
    ...
  }
```

Show the diff to the user, then handle the next approval/reject prompt.

### 6. Handle a command execution prompt

```text
terminal.snapshot({ sessionId: "ses_cx01" })
→ {
    riskSignals: [{
      type: "external_agent_permission",
      text: "Codex wants to run: npm test",
      severity: "medium"
    }],
    ...
  }
```

Same protocol: stop, ask the user, only respond with explicit permission.

### 7. Session cleanup when done

```text
terminal.export_transcript({
  sessionId: "ses_cx01",
  redact: true,
  format: "jsonl"
})
→ { path: "...", eventCount: 25, ... }

terminal.kill({ sessionId: "ses_cx01" })
→ { ok: true }
```

## Tips

- **Codex uses a TUI** — always check `isFullscreen` and use `wait_stable`
  with longer `idleMs` (1-2 seconds) since Codex may make API calls.
- **Multiple approval prompts** may appear in sequence. Do not auto-approve
  batch operations — check each one.
- **Use `terminal.find`** to search for keywords like "approve", "confirm",
  "allow" in the current screen if you suspect a prompt is partially scrolled
  out of view.
- **API keys**: Never type them into the terminal. Use the `env` parameter in
  `terminal.start` or set them in the MCP server config.
- **Long-running tasks**: Set a high `ttlMs` (e.g., `7200000` for 2 hours)
  to prevent the session from being auto-killed during slow model responses.
