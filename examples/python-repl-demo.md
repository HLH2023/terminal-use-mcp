# Using terminal-use-mcp with Python REPL

This example shows how to start a Python REPL, execute code, handle errors,
and exit cleanly.

## Prerequisites

- Python 3 installed
- terminal-use-mcp configured

## Workflow

### 1. Start the Python REPL

```text
terminal.start({
  command: "python3",
  cwd: "/home/user/dev/project",
  label: "python-repl"
})
→ {
    sessionId: "ses_py01",
    status: "starting",
    provider: "native-pty",
    ...
  }
```

### 2. Wait for the prompt

```text
terminal.wait_for_text({
  sessionId: "ses_py01",
  text: ">>>",
  timeoutMs: 5000
})
→ { screen: "Python 3.12.0 ...\n>>> ", ... }
```

### 3. Import a module and execute code

```text
terminal.type({ sessionId: "ses_py01", text: "import json" })
terminal.press({ sessionId: "ses_py01", key: "enter" })
terminal.wait_stable({ sessionId: "ses_py01", idleMs: 300 })
terminal.snapshot({ sessionId: "ses_py01" })
→ {
    screen: "Python 3.12.0 ...\n>>> import json\n>>> ",
    status: "running",
    ...
  }
```

No output — import succeeded silently. The `>>> ` prompt is back.

### 4. Execute a statement that produces output

```text
terminal.type({ sessionId: "ses_py01", text: "data = json.loads('{\"key\": \"value\"}')" })
terminal.press({ sessionId: "ses_py01", key: "enter" })
terminal.wait_stable({ sessionId: "ses_py01", idleMs: 300 })

terminal.type({ sessionId: "ses_py01", text: "print(data['key'])" })
terminal.press({ sessionId: "ses_py01", key: "enter" })
terminal.wait_stable({ sessionId: "ses_py01", idleMs: 300 })
terminal.snapshot({ sessionId: "ses_py01" })
→ {
    screen: "...>>> data = json.loads('{\"key\": \"value\"}')\n>>> print(data['key'])\nvalue\n>>> ",
    ...
  }
```

The output shows `value` — the JSON was parsed and accessed successfully.

### 5. Handle an error

```text
terminal.type({ sessionId: "ses_py01", text: "1 / 0" })
terminal.press({ sessionId: "ses_py01", key: "enter" })
terminal.wait_stable({ sessionId: "ses_py01", idleMs: 300 })
terminal.snapshot({ sessionId: "ses_py01" })
→ {
    screen: "...>>> 1 / 0\nTraceback (most recent call last):\n  File \"<stdin>\", line 1, in <module>\nZeroDivisionError: division by zero\n>>> ",
    ...
  }
```

The error traceback appeared, and Python returned to the `>>> ` prompt. The
session is still running — no need to restart.

### 6. Use multi-line input (indentation)

```text
terminal.type({ sessionId: "ses_py01", text: "for i in range(3):" })
terminal.press({ sessionId: "ses_py01", key: "enter" })
terminal.type({ sessionId: "ses_py01", text: "    print(f'item {i}')" })
terminal.press({ sessionId: "ses_py01", key: "enter" })
terminal.press({ sessionId: "ses_py01", key: "enter" })
terminal.wait_stable({ sessionId: "ses_py01", idleMs: 500 })
terminal.snapshot({ sessionId: "ses_py01" })
→ {
    screen: "...>>> for i in range(3):\n...     print(f'item {i}')\n...\nitem 0\nitem 1\nitem 2\n>>> ",
    ...
  }
```

Note: For the indentation, we type 4 spaces directly. The `... ` continuation
prompt appears. The second `enter` (empty line) ends the block.

### 7. Handle a large paste with caution

If you need to paste a multi-line script, use `terminal.paste`:

```text
terminal.paste({
  sessionId: "ses_py01",
  text: "def greet(name):\n    return f'Hello, {name}!'\n\nprint(greet('World'))",
  confirmLargePaste: true
})
→ { ok: true }
```

If the text is too long (>4096 chars), the server will refuse with
`LARGE_PASTE_REFUSED`. In that case, break the code into smaller chunks.

### 8. Exit the REPL

```text
terminal.type({ sessionId: "ses_py01", text: "exit()" })
terminal.press({ sessionId: "ses_py01", key: "enter" })
terminal.wait_stable({ sessionId: "ses_py01", idleMs: 500 })
terminal.snapshot({ sessionId: "ses_py01" })
→ { status: "exited", exitCode: 0, ... }
```

Or use a keyboard shortcut:

```text
terminal.press({ sessionId: "ses_py01", key: "control+d" })
```

### 9. Export transcript and clean up

```text
terminal.export_transcript({
  sessionId: "ses_py01",
  redact: true,
  format: "jsonl"
})
→ { path: "...", eventCount: 12, ... }

terminal.kill({ sessionId: "ses_py01" })
→ { ok: true }
```

## Tips

- **Python's `>>> ` and `... ` prompts** are reliable markers for
  `wait_for_text`. Use them instead of `wait_stable` when you need
  certainty that the REPL is ready.
- **Indentation in Python**: Use literal spaces in `terminal.type`. The tab
  key may not produce the right behavior depending on the REPL configuration.
- **Multi-line blocks**: End an indented block with an extra `enter` (empty
  line) or check the `... ` → `>>> ` transition.
- **Errors don't kill the session**: Python REPL shows a traceback and
  returns to the prompt. You can continue working after an error.
- **`control+d`** sends EOF, which exits the REPL. Equivalent to `exit()`.
- **`control+c`** interrupts the current command (useful for infinite loops).
  Use `terminal.press({ sessionId, key: "control+c" })`.
