# 通过 ssh-pty 远程控制 OpenCode TUI

演示如何使用 `ssh-pty` provider 连接远程主机，启动 OpenCode，发送分析任务并监控输出。

> V2 远程功能处于设计阶段，尚未实现。完整设计参见 [docs/V2_REMOTE_TERMINAL_GUIDE.md](../docs/V2_REMOTE_TERMINAL_GUIDE.md)。

> 安全关键: OpenCode 内部可能调用 tool broker 执行 shell 命令、文件操作。如果出现权限确认提示，必须 STOP 并询问用户。

## 前提

- 远程主机已在 `~/.config/terminal-use-mcp/hosts.json` 中配置 profile
- 远程主机已安装 OpenCode (含 `opencode` 命令)
- 远程主机已配置所需 LLM provider (ANTHROPIC_API_KEY / OPENAI_API_KEY 等)
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

### 2. 启动远程 OpenCode

```text
terminal.start({
  provider: "ssh-pty",
  target: { kind: "ssh", profile: "devbox" },
  command: "opencode",
  cwd: "/home/hlh/dev/my-project",
  label: "remote-opencode",
  cols: 120,
  rows: 40,
  ttlMs: 7200000
})
→ {
    sessionId: "ses_rOC01",
    status: "starting",
    provider: "ssh-pty",
    target: { kind: "ssh", profile: "devbox" },
    ...
  }
```

建议指定较大的终端尺寸 (`cols: 120` 以上)，OpenCode TUI 在窄屏下布局容易错乱。

### 3. 等待 TUI 加载

```text
terminal.wait_for_text({
  sessionId: "ses_rOC01",
  text: ">",
  timeoutMs: 12000
})
terminal.wait_stable({ sessionId: "ses_rOC01", idleMs: 1500 })
```

OpenCode 启动涉及 LLM provider 连接验证和 project index 初始化，延迟比普通 TUI 程序高，`idleMs` 建议 1500ms 以上。

### 4. 观察初始界面

```text
terminal.snapshot({ sessionId: "ses_rOC01" })
→ {
    sessionId: "ses_rOC01",
    screen: "...OpenCode...\nProject: my-project\nModel: anthropic/claude-sonnet\n\n  > Enter your prompt...\n\n",
    isFullscreen: true,
    riskSignals: [],
    ...
  }
```

全屏 TUI，等待输入。

### 5. 发送只读分析任务

```text
terminal.type({ sessionId: "ses_rOC01", text: "List all TypeScript files in the src directory and describe the purpose of each one. Do not modify any files." })
terminal.press({ sessionId: "ses_rOC01", key: "enter" })
terminal.wait_stable({ sessionId: "ses_rOC01", idleMs: 3000 })
```

先发一个只读任务，减少触发权限提示的可能。

### 6. 监控 OpenCode 执行

```text
terminal.snapshot({ sessionId: "ses_rOC01" })
→ {
    screen: "...● Reading src/index.ts...\n● Reading src/server.ts...\n● Reading src/auth.ts...\n● Compiling response...",
    riskSignals: [],
    ...
  }
```

OpenCode 通过 tool broker 读取文件，`riskSignals` 为空说明没有触发需要用户确认的操作。

### 7. 处理权限确认提示 (关键步骤)

OpenCode tool broker 可能在执行 shell 命令时弹出确认：

```text
terminal.snapshot({ sessionId: "ses_rOC01" })
→ {
    screen: "...● Tool: shell\n  Command: find src -name '*.test.ts' | wc -l\n\n  [A]llow  [D]eny  [V]iew details",
    riskSignals: [{
      type: "external_agent_permission",
      text: "OpenCode wants to run: find src -name '*.test.ts' | wc -l",
      severity: "medium"
    }],
    ...
  }
```

STOP。向用户报告: *"OpenCode 请求执行 `find src -name '*.test.ts' | wc -l`，是否允许?"*

用户批准:

```text
terminal.type({ sessionId: "ses_rOC01", text: "A" })
terminal.press({ sessionId: "ses_rOC01", key: "enter" })
terminal.wait_stable({ sessionId: "ses_rOC01", idleMs: 2000 })
```

用户拒绝:

```text
terminal.type({ sessionId: "ses_rOC01", text: "D" })
terminal.press({ sessionId: "ses_rOC01", key: "enter" })
terminal.wait_stable({ sessionId: "ses_rOC01", idleMs: 1000 })
```

用户想看详情:

```text
terminal.type({ sessionId: "ses_rOC01", text: "V" })
terminal.press({ sessionId: "ses_rOC01", key: "enter" })
terminal.wait_stable({ sessionId: "ses_rOC01", idleMs: 500 })
terminal.snapshot({ sessionId: "ses_rOC01" })
```

### 8. 处理 destructive prompt

如果 OpenCode 想要写入或删除文件：

```text
terminal.snapshot({ sessionId: "ses_rOC01" })
→ {
    screen: "...● Tool: file_write\n  Path: src/auth.ts\n  Changes: 3 additions, 1 deletion\n\n  [A]pply  [R]eject  [D]iff",
    riskSignals: [{
      type: "external_agent_permission",
      text: "Apply 3 additions, 1 deletion to src/auth.ts?",
      severity: "medium"
    }],
    ...
  }
```

同样 STOP，询问用户。先看 diff 再决定：

```text
terminal.type({ sessionId: "ses_rOC01", text: "D" })
terminal.press({ sessionId: "ses_rOC01", key: "enter" })
terminal.wait_stable({ sessionId: "ses_rOC01", idleMs: 1000 })
terminal.snapshot({ sessionId: "ses_rOC01" })
→ {
    screen: "...diff --git a/src/auth.ts\n-  session = createSession(req)\n+  token = generateJWT(user)\n+  verify = checkJWTSignature(token)\n...",
    ...
  }
```

### 9. 导出 transcript 并清理

```text
terminal.export_transcript({
  sessionId: "ses_rOC01",
  redact: true,
  format: "jsonl"
})
→ { path: "...", eventCount: 52, redacted: 5, ... }

terminal.kill({ sessionId: "ses_rOC01" })
→ { ok: true }
```

## 注意事项

- **OpenCode 自身也是 MCP 客户端**: 如果远程 OpenCode 的 MCP 配置中也启用了 terminal-use-mcp，会出现嵌套控制的情况。避免在同一 agent 链路中递归调用。
- **TUI 渲染延迟**: OpenCode 的 TUI 使用 Ink (React for CLI)，初始渲染和重渲染比简单 TUI 慢。`wait_stable` 的 `idleMs` 建议 1000-2000ms。
- **终端尺寸敏感**: OpenCode TUI 需要足够大的终端。窄于 80 列或矮于 24 行可能导致布局异常。
- **长任务需要耐心**: OpenCode 分析项目可能涉及多轮 tool 调用，期间 TUI 会持续更新。不要因为短时间无变化就认为卡死，用 `wait_stable` 配合较长 `idleMs` 判断。
- **prompt 中输入特殊字符**: OpenCode 的输入框支持 markdown，如果需要在 prompt 中输入 `{`、`}`、反引号等字符，直接 `terminal.type` 即可，不需要转义。
- **SSH 断线无恢复**: `ssh-pty` 不持久化 session。如需断线后能重新 attach，考虑 `ssh-tmux` provider。
