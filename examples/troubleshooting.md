# Terminal-Use-MCP Troubleshooting

Common issues, their causes, and solutions.

## Table of Contents

- [DEPENDENCY_MISSING](#dependency_missing)
- [SESSION_NOT_FOUND](#session_not_found)
- [PROVIDER_CAPABILITY_UNSUPPORTED](#provider_capability_unsupported)
- [UNSAFE_COMMAND](#unsafe_command)
- [LARGE_PASTE_REFUSED](#large_paste_refused)
- [Server won't start](#server-wont-start)
- [tmux not found](#tmux-not-found)
- [Screen output is garbled](#screen-output-is-garbled)
- [Session auto-killed unexpectedly](#session-auto-killed-unexpectedly)
- [Commands run but no visible output](#commands-run-but-no-visible-output)

---

### DEPENDENCY_MISSING

**Symptom**: Error on server start or `terminal.start`:

```json
{
  "ok": false,
  "error": {
    "code": "DEPENDENCY_MISSING",
    "message": "node-pty native addon failed to load",
    "retryable": false
  }
}
```

**Cause**: `node-pty` is a native C++ addon that requires `node-gyp` and a
C++ toolchain to compile.

**Solutions**:

1. **Install build tools** (Linux):
   ```bash
   sudo apt-get install build-essential python3
   npm rebuild node-pty
   ```

2. **Use the tmux provider** instead (no native addons needed):
   ```text
   terminal.start({
     command: "node",
     provider: "tmux",
     ...
   })
   ```

3. **Set provider to tmux globally** via env var:
   ```
   TERMINAL_USE_PROVIDERS=tmux
   ```

The server automatically falls back to tmux if `node-pty` fails to load, so
this error usually means tmux is also unavailable.

---

### SESSION_NOT_FOUND

**Symptom**:

```json
{
  "ok": false,
  "error": {
    "code": "SESSION_NOT_FOUND",
    "message": "Session ses_abc123 not found",
    "retryable": false
  }
}
```

**Causes**:

1. **Session expired** — the session exceeded its TTL (default: 1 hour of
   inactivity) and was auto-cleaned.
2. **Session was killed** — a previous `terminal.kill` removed it.
3. **Wrong sessionId** — typo or stale ID from an old session.

**Solutions**:

- Check `terminal.list()` to see active sessions.
- If the session expired, start a new one with `terminal.start`.
- To prevent early expiration, set a longer `ttlMs` when starting:
  ```text
  terminal.start({ command: "node", ttlMs: 7200000, ... })
  ```
- Check the server logs (stderr) for TTL cleanup messages.

---

### PROVIDER_CAPABILITY_UNSUPPORTED

**Symptom**:

```json
{
  "ok": false,
  "error": {
    "code": "PROVIDER_CAPABILITY_UNSUPPORTED",
    "message": "Provider 'tmux' does not support 'find'",
    "provider": "tmux",
    "retryable": false
  }
}
```

**Cause**: The current provider does not implement the requested operation.
Each provider has a capability matrix:

| Capability | native-pty | tmux |
|---|---|---|
| highlights | ✅ (best-effort) | ❌ |
| scrollback | ✅ | ✅ (paged) |
| find | ✅ | ❌ |
| attach | ❌ | ✅ |
| rename | ❌ | ✅ |
| fullscreenDetection | ✅ (best-effort) | ❌ |

**Solutions**:

- Check `terminal.provider_capabilities({ provider: "tmux" })` before using
  a feature.
- Switch to a provider that supports the capability:
  ```text
  terminal.start({ command: "lazygit", provider: "native-pty", ... })
  ```
- Use `terminal.find` with `native-pty`; for tmux sessions, use scroll/snapshot workflows.
- Use `terminal.scroll` with `direction` and `lines` as a workaround for
  providers that don't support `find`.

---

### UNSAFE_COMMAND

**Symptom**:

```json
{
  "ok": false,
  "error": {
    "code": "UNSAFE_COMMAND",
    "message": "Command 'sudo' is in the denylist",
    "retryable": false,
    "hint": "Set TERMINAL_USE_ALLOW_COMMANDS=sudo to override"
  }
}
```

**Cause**: The command is in the built-in denylist (`sudo`, `su`, `ssh`,
`rm`, `dd`, `mkfs`, `shutdown`, `reboot`, `chmod`, `chown`, `curl`, `wget`,
`nc`, `ncat`, `telnet`).

**Solutions**:

1. **Override specifically** (recommended — minimal risk surface):
   ```
   TERMINAL_USE_ALLOW_COMMANDS=curl
   ```
   This removes `curl` from the denylist while keeping everything else blocked.

2. **Use risky-mode "ask"** — the server returns `CONFIRMATION_REQUIRED`
   instead of outright refusing, letting the agent ask the user:
   ```
   TERMINAL_USE_RISKY_COMMAND_MODE=ask
   ```

3. **Use risky-mode "allow"** (⚠️ dangerous — removes all protection):
   ```
   TERMINAL_USE_RISKY_COMMAND_MODE=allow
   ```

> ⚠️ **Remember**: The denylist only filters `terminal.start` commands.
> It cannot restrict commands executed *inside* a running TUI program or REPL.

---

### LARGE_PASTE_REFUSED

**Symptom**:

```json
{
  "ok": false,
  "error": {
    "code": "LARGE_PASTE_REFUSED",
    "message": "Paste text exceeds 4096 characters",
    "retryable": false,
    "hint": "Break the text into smaller chunks or pass confirmLargePaste: true"
  }
}
```

**Cause**: Pasting more than 4096 characters at once is blocked by default to
prevent terminal buffer corruption.

**Solutions**:

1. **Confirm explicitly** if you really need to paste a large block:
   ```text
   terminal.paste({
     sessionId: "ses_abc123",
     text: "...very long text...",
     confirmLargePaste: true
   })
   ```

2. **Break into smaller chunks** (recommended for reliability):
   ```text
   terminal.type({ sessionId: "ses_abc123", text: "first chunk" })
   terminal.type({ sessionId: "ses_abc123", text: "second chunk" })
   terminal.type({ sessionId: "ses_abc123", text: "third chunk" })
   ```

---

### Server won't start

**Symptom**: The MCP server process exits immediately or the agent reports
it cannot connect to the terminal-use server.

**Common causes**:

1. **stdout is redirected** — MCP uses stdout for the JSON-RPC protocol. If
   stdout is captured or piped (e.g., by a logging framework), the protocol
   breaks. All server logs go to **stderr only**.

2. **Wrong entry path** — verify the `args` in your MCP config:
   ```json
   {
     "args": ["tsx", "/absolute/path/to/terminal-use-mcp/src/index.ts"]
   }
   ```

3. **Missing dependencies** — run `npm install` in the terminal-use-mcp
   directory first.

4. **TERMINAL_USE_WORKSPACE_ROOT not set** — this is recommended. Without it,
   the safety layer defaults to `process.cwd()` as the cwd root and will reject sessions outside that path.

**Diagnostic steps**:

```bash
# Run the server directly to see startup errors on stderr
TERMINAL_USE_WORKSPACE_ROOT=/tmp npx tsx src/index.ts 2>server.log
# Check server.log for errors
cat server.log
```

---

### tmux not found

**Symptom**: Server falls back past tmux, or `terminal.start` with
`provider: "tmux"` returns `PROVIDER_NOT_AVAILABLE`.

**Cause**: tmux is not installed or is an old version.

**Solution**:

```bash
# Install tmux (Ubuntu/Debian)
sudo apt-get install tmux

# Install tmux (macOS)
brew install tmux

# Verify version (need 3.2+ for resize-window and other features)
tmux -V
# tmux 3.4  ← good
# tmux 3.3a ← may work, 3.2+ required
```

For older systems, consider building tmux from source or using the
`native-pty` provider instead.

---

### Screen output is garbled

**Symptom**: `terminal.snapshot` returns garbled text, misaligned cursor, or
missing characters.

**Causes**:

1. **Terminal size mismatch** — the PTY/tmux session was created with
   different dimensions than the snapshot expects.
2. **Incomplete rendering** — the TUI program is still painting when the
   snapshot is taken.
3. **Full-redraw TUI** — some programs (htop, lazygit) do full-screen
   redraws that can cause transient garbled states.

**Solutions**:

- Use `terminal.wait_stable({ idleMs: 500 })` before snapshotting to let
  the rendering settle.
- Set appropriate `cols` and `rows` when starting the session:
  ```text
  terminal.start({ command: "htop", cols: 120, rows: 40, ... })
  ```
- If using tmux, resize the tmux window before snapshotting:
  ```text
  terminal.resize({ sessionId: "ses_abc123", cols: 120, rows: 40 })
  ```

---

### Session auto-killed unexpectedly

**Symptom**: A session disappears while you're still using it.

**Cause**: The session exceeded its TTL (Time-To-Live). Default is 1 hour
of inactivity (no tool calls targeting that session).

**Solutions**:

- Set a longer `ttlMs` when starting:
  ```text
  terminal.start({ command: "node", ttlMs: 86400000, ... })  // 24 hours
  ```
- Or increase the global default:
  ```
  TERMINAL_USE_SESSION_TTL_MS=86400000
  ```
- Note: each tool call to the session resets the inactivity timer. If you're
  actively polling with `snapshot`, the session stays alive.

---

### Commands run but no visible output

**Symptom**: `terminal.type` succeeds but `terminal.snapshot` shows no new
text.

**Causes**:

1. **Output went to scrollback** — the new output scrolled above the visible
   screen area.
2. **The program is waiting for more input** (e.g., a multi-line REPL block
   waiting for a blank line to execute).
3. **The output is on a different virtual terminal** (tmux only).

**Solutions**:

- Use `terminal.scroll({ direction: "up", lines: 50 })` to check scrollback.
- Use `terminal.find({ pattern: "expected_text" })` with
  `includeScrollback: true` to search the full buffer.
- Check the cursor position in the snapshot — if it hasn't moved, your
  input may not have been accepted.
- For tmux, use `terminal.snapshot` after `wait_stable` to ensure the
  screen has been captured.
