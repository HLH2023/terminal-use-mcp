[Back to README](../README.md)

# Type Definitions & Error Codes — terminal-use-mcp

## Table of Contents

- [TerminalSnapshot](#terminalsnapshot)
- [ToolError](#toolerror)
- [TerminalUseErrorCode](#terminaluseerrorcode)
- [TerminalTarget (V2, Design Phase)](#terminaltarget-v2-design-phase)

## TerminalSnapshot

```ts
type TerminalSnapshot = {
  sessionId: string
  screen: string
  cursor: { x: number; y: number }
  cols: number
  rows: number
  status: "starting" | "running" | "exited" | "killed" | "error"
  changed?: boolean
  exitCode?: number | null
  title?: string
  isFullscreen?: boolean
  highlights?: Array<{
    row: number
    colStart: number
    colEnd: number
    text: string
    kind: "inverse" | "selection" | "active" | "unknown"
  }>
  riskSignals?: Array<{
    type: "confirmation_prompt" | "credential_prompt" | "destructive_prompt" | "external_agent_permission"
    text: string
    severity: "low" | "medium" | "high"
  }>
  timestamp: string
  observationTrust: "untrusted"
}
```

## ToolError

```ts
type ToolError = {
  ok: false
  error: {
    code: TerminalUseErrorCode
    message: string
    provider?: string
    sessionId?: string
    retryable: boolean
    hint?: string
    details?: unknown
  }
}
```

## TerminalUseErrorCode

```ts
type TerminalUseErrorCode =
  | "SESSION_NOT_FOUND"
  | "PROVIDER_NOT_AVAILABLE"
  | "PROVIDER_CAPABILITY_UNSUPPORTED"
  | "SESSION_TIMEOUT"
  | "UNSAFE_COMMAND"
  | "LARGE_PASTE_REFUSED"
  | "SECRET_DETECTED"
  | "CONFIRMATION_REQUIRED"
  | "SESSION_BUSY"
  | "PROCESS_EXITED"
  | "DEPENDENCY_MISSING"
  | "INVALID_CWD"
  | "INVALID_MOUSE_COORDS"
  | "INVALID_KEY"
  | "INTERNAL_ERROR"
  // V2 additions (design phase)
  | "SSH_PROFILE_NOT_FOUND"
  | "SSH_HOST_KEY_MISMATCH"
  | "SSH_HOST_KEY_UNKNOWN"
  | "SSH_AUTH_FAILED"
  | "SSH_CONNECT_TIMEOUT"
  | "SSH_CONNECTION_LOST"
  | "SSH_INLINE_TARGET_DENIED"
  | "REMOTE_CWD_DENIED"
  | "REMOTE_TMUX_NOT_AVAILABLE"
  | "REMOTE_COMMAND_DENIED"
```

## TerminalTarget (V2, Design Phase)

```ts
type TerminalTarget =
  | { kind: "local" }
  | {
      kind: "ssh"
      profile?: string
      host?: string
      port?: number
      username?: string
      auth?: SshAuthRef
      knownHostPolicy?: "strict"
    }
```

Where `SshAuthRef` is:

```ts
type SshAuthRef =
  | { type: "agent"; socket?: string }
  | { type: "key-file"; path: string; passphraseEnv?: string }
```

`{ type: "password" }` is prohibited. V2 does not support password login.
