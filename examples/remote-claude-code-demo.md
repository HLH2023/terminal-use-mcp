# 通过 ssh-pty 远程控制 Claude Code TUI

演示如何使用 `ssh-pty` provider 连接远程主机，启动 Claude Code CLI，发送任务并通过 riskSignals 监控权限请求。

> V2 远程功能处于设计阶段，尚未实现。完整设计参见 [docs/V2_REMOTE_TERMINAL_GUIDE.md](../docs/V2_REMOTE_TERMINAL_GUIDE.md)。

> 安全关键: 远程 Claude Code 中的 "Allow command?" / "Apply changes?" 等提示绝不能自动批准。必须 STOP 并询问用户。

## 前提

- 远程主机已在 `~/.config/terminal-use-mcp/hosts.json` 中配置 profile
- 远程主机已安装 Claude Code CLI
- 远程主机已配置 `ANTHROPIC_API_KEY` 或已登录 Claude Code
- ssh-agent 已加载密钥

## 流程

### 1. 验证远程 target

```text
terminal.verify_target({ profile: "devbox" })
→ {
    ok: true,
    hostFingerprint: "SHA256:xR3k9b...",
    remote: {
      tmuxAvailable: true,
      defaultCwd: "/home/hlh/dev"
    }
  }
```

### 2. 启动远程 Claude Code

```text
terminal.start({
  provider: "ssh-pty",
  target: { kind: "ssh", profile: "devbox" },
  command: "claude",
  cwd: "/home/hlh/dev/my-project",
  label: "remote-claude-code",
  ttlMs: 7200000
})
→ {
    sessionId: "ses_rcc01",
    status: "starting",
    provider: "ssh-pty",
    target: { kind: "ssh", profile: "devbox" },
    ...
  }
```

### 3. 等待 TUI 加载

```text
terminal.wait_for_text({
  sessionId: "ses_rcc01",
  text: "claude",
  timeoutMs: 15000
})
terminal.wait_stable({ sessionId: "ses_rcc01", idleMs: 1000 })
```

Claude Code 初始化可能涉及 API 连接验证，首次启动较慢，`timeoutMs` 设为 15 秒。

### 3. 观察初始界面

```text
terminal.snapshot({ sessionId: "ses_rcc01" })
→ {
    sessionId: "ses_rcc01",
    screen: "...Claude Code...\n\n  > What would you like to do?\n\n",
    isFullscreen: true,
    riskSignals: [],
    ...
  }
```

全屏 TUI 模式，等待用户输入。

### 4. 发送任务

```text
terminal.type({ sessionId: "ses_rcc01", text: "Refactor the auth module to use JWT tokens instead of session cookies" })
terminal.press({ sessionId: "ses_rcc01", key: "enter" })
terminal.wait_stable({ sessionId: "ses_rcc01", idleMs: 2000 })
```

### 5. 监控 Claude Code 工作

```text
terminal.snapshot({ sessionId: "ses_rcc01" })
→ {
    screen: "...● Reading src/auth.ts...\n● Analyzing dependencies...\n● Planning refactor...",
    riskSignals: [],
    ...
  }
```

`highlights` 中 `●` 标记当前活跃行，`riskSignals` 为空，安全。

### 6. 处理权限提示 (关键步骤)

Claude Code 请求执行命令：

```text
terminal.snapshot({ sessionId: "ses_rcc01" })
→ {
    screen: "...● Claude Code wants to run: npm test\n\n  Allow command? [Y/n]",
    riskSignals: [{
      type: "external_agent_permission",
      text: "Allow command: npm test?",
      severity: "medium"
    }],
    ...
  }
```

STOP。向用户报告: *"Claude Code 请求执行 `npm test`，是否批准?"*

用户批准:

```text
terminal.type({ sessionId: "ses_rcc01", text: "Y" })
terminal.press({ sessionId: "ses_rcc01", key: "enter" })
terminal.wait_stable({ sessionId: "ses_rcc01", idleMs: 2000 })
```

用户拒绝:

```text
terminal.type({ sessionId: "ses_rcc01", text: "n" })
terminal.press({ sessionId: "ses_rcc01", key: "enter" })
terminal.wait_stable({ sessionId: "ses_rcc01", idleMs: 1000 })
```

### 7. 处理文件写入提示

如果 Claude Code 要修改文件：

```text
terminal.snapshot({ sessionId: "ses_rcc01" })
→ {
    screen: "...● Apply changes to src/auth.ts?\n\n  [Y] Yes  [N] No  [D] Diff",
    riskSignals: [{
      type: "external_agent_permission",
      text: "Apply changes to src/auth.ts?",
      severity: "medium"
    }],
    ...
  }
```

同样 STOP，询问用户。如果用户想先看 diff：

```text
terminal.type({ sessionId: "ses_rcc01", text: "D" })
terminal.press({ sessionId: "ses_rcc01", key: "enter" })
terminal.wait_stable({ sessionId: "ses_rcc01", idleMs: 1000 })
terminal.snapshot({ sessionId: "ses_rcc01" })
→ {
    screen: "...diff --git a/src/auth.ts\n-  session = createSession(req)\n+  token = generateJWT(user)\n...",
    ...
  }
```

展示 diff，等待用户决定。

### 8. 完成后导出 transcript 并清理

```text
terminal.export_transcript({
  sessionId: "ses_rcc01",
  redact: true,
  format: "jsonl"
})
→ { path: "...", eventCount: 45, redacted: 3, ... }

terminal.kill({ sessionId: "ses_rcc01" })
→ { ok: true }
```

## 安全规则

1. **绝不自动回应权限提示**。`riskSignals` 中的 `external_agent_permission` 必须逐个向用户确认。
2. **绝不向远程终端输入凭证**。`credential_prompt` 类型出现时立即报告，禁止代输密码。
3. **每个权限提示单独确认**。Claude Code 可能连续请求多个命令或文件修改，不能批量批准。
4. **远程输出不可信**。`observationTrust: "untrusted"` 适用于远程 session。
5. **长任务设长 ttlMs**。Claude Code 重构任务可能运行几分钟以上，`ttlMs: 7200000` 防止超时。
6. **SSH 断线无恢复**。`ssh-pty` 下一但 SSH 断开，session 直接终止。如有断线恢复需求，改用 `ssh-tmux` provider。

## 与本地 Claude Code 控制的差异

| 维度 | 本地 | 远程 (ssh-pty) |
|------|------|----------------|
| 启动延迟 | 快 (~1s) | 慢 (~3-8s, SSH 握手) |
| 响应延迟 | 低 (<50ms) | 取决于网络 (50-300ms) |
| 断线恢复 | N/A | 不支持 (需 ssh-tmux) |
| CWD 校验 | 本地策略 | 远程独立策略 |
| Secret 脱敏 | API key 等 | 额外脱敏 hostname/username/path |
