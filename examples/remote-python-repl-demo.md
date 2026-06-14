# 通过 ssh-pty 远程运行 Python REPL

演示如何使用 `ssh-pty` provider 连接远程主机，启动 Python REPL，执行代码并检索输出。

> Remote SSH features are available. Full design: [REMOTE_TERMINAL_GUIDE.md](../docs/REMOTE_TERMINAL_GUIDE.md).

## 前提

- 远程主机已在 `~/.config/terminal-use-mcp/hosts.json` 中配置 profile
- 远程主机已安装 Python 3
- ssh-agent 已加载密钥 (`ssh-add -l` 可看到对应 key)
- 远程主机的 host key 已在 `known_hosts` 中，或在 profile 中配置了 `pinnedHostFingerprint`

## 流程

### 1. 验证远程 target 连通性

启动前先确认 SSH profile 可达、host key 可校验、远程 tmux 是否可用：

```text
terminal.verify_target({ profile: "devbox" })
→ {
    ok: true,
    hostFingerprint: "SHA256:xR3k9b...",
    remote: {
      tmuxAvailable: true,
      defaultCwd: "/home/hlh/dev",
      allowedCwd: ["/home/hlh/dev", "/srv/lab"]
    }
  }
```

`ok: true` 意味着 SSH 连接、认证、host key 校验均通过。如果失败，参见 [remote-troubleshooting.md](./remote-troubleshooting.md)。

### 2. 启动远程 Python REPL

```text
terminal.start({
  provider: "ssh-pty",
  target: { kind: "ssh", profile: "devbox" },
  command: "python3",
  cwd: "/home/hlh/dev/project",
  label: "remote-py-repl"
})
→ {
    sessionId: "ses_rpy01",
    status: "starting",
    provider: "ssh-pty",
    target: { kind: "ssh", profile: "devbox" },
    ...
  }
```

`ssh-pty` 通过 ssh2 Client 建立 PTY channel，在远程主机上启动 `python3`。

### 3. 等待 Python 提示符

```text
terminal.wait_for_text({
  sessionId: "ses_rpy01",
  text: ">>>",
  timeoutMs: 8000
})
→ { screen: "Python 3.12.0 ...\n>>> ", status: "running", ... }
```

远程连接首次可能稍慢（SSH 握手 + 远程 shell 初始化），`timeoutMs` 设为 8 秒比较稳妥。

### 4. 执行代码

```text
terminal.type({ sessionId: "ses_rpy01", text: "import json" })
terminal.press({ sessionId: "ses_rpy01", key: "enter" })
terminal.wait_stable({ sessionId: "ses_rpy01", idleMs: 300 })
```

等待 `>>>` 重新出现，确认 import 成功。然后执行带输出的语句：

```text
terminal.type({ sessionId: "ses_rpy01", text: "data = json.loads('{\"host\": \"devbox\", \"port\": 22}')" })
terminal.press({ sessionId: "ses_rpy01", key: "enter" })
terminal.wait_stable({ sessionId: "ses_rpy01", idleMs: 300 })

terminal.type({ sessionId: "ses_rpy01", text: "print(f\"Connected to {data['host']}:{data['port']}\")" })
terminal.press({ sessionId: "ses_rpy01", key: "enter" })
terminal.wait_stable({ sessionId: "ses_rpy01", idleMs: 300 })
terminal.snapshot({ sessionId: "ses_rpy01" })
→ {
    screen: "...>>> data = json.loads('{\"host\": \"devbox\", \"port\": 22}')\n>>> print(f\"Connected to {data['host']}:{data['port']}\")\nConnected to devbox:22\n>>> ",
    riskSignals: [],
    ...
  }
```

输出 `Connected to devbox:22`，REPL 正常运行。

### 5. 处理错误

```text
terminal.type({ sessionId: "ses_rpy01", text: "1 / 0" })
terminal.press({ sessionId: "ses_rpy01", key: "enter" })
terminal.wait_stable({ sessionId: "ses_rpy01", idleMs: 500 })
terminal.snapshot({ sessionId: "ses_rpy01" })
→ {
    screen: "...>>> 1 / 0\nTraceback (most recent call last):\n  File \"<stdin>\", line 1, in <module>\nZeroDivisionError: division by zero\n>>> ",
    ...
  }
```

错误 traceback 正常显示，REPL 仍然存活，可以继续执行。

### 6. 导出 Transcript

```text
terminal.export_transcript({
  sessionId: "ses_rpy01",
  redact: true,
  format: "jsonl"
})
→ { path: "...", eventCount: 14, redacted: 0, ... }
```

远程 session 的 transcript 同样支持 `redact: true`，会额外对 hostname、username、home path 做脱敏。

### 7. 退出并清理

```text
terminal.type({ sessionId: "ses_rpy01", text: "exit()" })
terminal.press({ sessionId: "ses_rpy01", key: "enter" })
terminal.wait_stable({ sessionId: "ses_rpy01", idleMs: 500 })
terminal.snapshot({ sessionId: "ses_rpy01" })
→ { status: "exited", exitCode: 0, ... }
```

也可以用 `control+d` 发送 EOF：

```text
terminal.press({ sessionId: "ses_rpy01", key: "control+d" })
```

最后 kill session（即使进程已退出，也需要 kill 释放资源）：

```text
terminal.kill({ sessionId: "ses_rpy01" })
→ { ok: true }
```

## 注意事项

- **首次连接延迟**: SSH 握手 + 远程 shell 初始化比本地慢，`wait_for_text` 的 `timeoutMs` 建议 8-10 秒。
- **CWD 校验独立**: 远程 cwd 使用 profile 中的 `remoteAllowedCwd` / `remoteDeniedCwd`，不复用本地策略。
- **Secret redaction 覆盖更广**: 远程 transcript 中 hostname、username、home path 也会被脱敏为 `<REDACTED_*>`。
- **REPL 内部行为不受 command policy 限制**: Python REPL 中可以执行 `os.system()` 或 `subprocess`，command deny list 只限制 `terminal.start` 的启动命令。
- **断线不可恢复**: `ssh-pty` 是一过性 PTY channel，SSH 断开后 session 直接进入 `error` 状态。如果需要断线恢复，改用 `ssh-tmux` provider。
