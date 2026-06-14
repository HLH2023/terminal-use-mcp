# 通过 ssh-pty 远程控制 lazygit TUI

演示如何使用 `ssh-pty` provider 连接远程主机，启动 lazygit，浏览提交记录并退出。

> V2 远程功能处于设计阶段，尚未实现。完整设计参见 [docs/V2_REMOTE_TERMINAL_GUIDE.md](../docs/V2_REMOTE_TERMINAL_GUIDE.md)。

## 前提

- 远程主机已在 `~/.config/terminal-use-mcp/hosts.json` 中配置 profile
- 远程主机已安装 lazygit
- 远程主机上的目标目录是一个 git 仓库
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
      defaultCwd: "/home/hlh/dev",
      allowedCwd: ["/home/hlh/dev", "/srv/lab"]
    }
  }
```

确认 SSH 连通且远程环境满足要求。

### 2. 启动远程 lazygit

```text
terminal.start({
  provider: "ssh-pty",
  target: { kind: "ssh", profile: "devbox" },
  command: "lazygit",
  cwd: "/home/hlh/dev/my-project",
  label: "remote-lazygit",
  cols: 120,
  rows: 40
})
→ {
    sessionId: "ses_rlg01",
    status: "starting",
    provider: "ssh-pty",
    target: { kind: "ssh", profile: "devbox" },
    ...
  }
```

建议指定 `cols` 和 `rows`，lazygit 对终端尺寸比较敏感。

### 3. 等待 TUI 渲染完成

```text
terminal.wait_for_text({
  sessionId: "ses_rlg01",
  text: "Commits",
  timeoutMs: 8000
})
terminal.wait_stable({ sessionId: "ses_rlg01", idleMs: 500 })
```

远程 TUI 加载可能比本地慢几百毫秒，`idleMs` 建议 500ms 以上。

### 4. 观察初始界面

```text
terminal.snapshot({ sessionId: "ses_rlg01" })
→ {
    sessionId: "ses_rlg01",
    screen: " 1 │ Status │ Unstaged Changes │  Logs  │ Stash │\n   │ Commits │                   │        │       │\n   │ Files   │                   │        │       │\n ● │ feat: add auth module        │        │       │\n   │ fix: resolve timeout issue   │        │       │",
    isFullscreen: true,
    highlights: [{ row: 4, colStart: 1, colEnd: 3, text: "●", kind: "active" }],
    riskSignals: [],
    ...
  }
```

`isFullscreen: true`，`highlights` 标记当前选中行。无 `riskSignals`，界面安全。

### 5. 导航浏览

下移一行：

```text
terminal.press({ sessionId: "ses_rlg01", key: "down" })
terminal.wait_stable({ sessionId: "ses_rlg01", idleMs: 200 })
terminal.snapshot({ sessionId: "ses_rlg01" })
→ {
    highlights: [{ row: 5, colStart: 1, colEnd: 3, text: "●", kind: "active" }],
    screen: "...● │ fix: resolve timeout issue   │...",
    ...
  }
```

进入 commit diff 细节：

```text
terminal.press({ sessionId: "ses_rlg01", key: "enter" })
terminal.wait_stable({ sessionId: "ses_rlg01", idleMs: 500 })
terminal.snapshot({ sessionId: "ses_rlg01" })
→ {
    screen: "commit abc1234\nAuthor: hlh <hlh@devbox>\nDate:   Sat Jun 13 10:00:00 2026\n\n    fix: resolve timeout issue\n\ndiff --git a/src/client.ts b/src/client.ts\n--- a/src/client.ts\n+++ b/src/client.ts\n@@ -42,7 +42,7 @@\n-    timeout: 5000,\n+    timeout: 30000,",
    isFullscreen: true,
    riskSignals: [],
    ...
  }
```

查看更多 diff 内容：

```text
terminal.scroll({
  sessionId: "ses_rlg01",
  direction: "down",
  lines: 10
})
→ { ok: true }
```

返回主界面：

```text
terminal.press({ sessionId: "ses_rlg01", key: "escape" })
terminal.wait_stable({ sessionId: "ses_rlg01", idleMs: 300 })
```

### 6. 退出 lazygit

```text
terminal.press({ sessionId: "ses_rlg01", key: "q" })
terminal.wait_stable({ sessionId: "ses_rlg01", idleMs: 500 })
terminal.snapshot({ sessionId: "ses_rlg01" })
→ { status: "exited", exitCode: 0, ... }
```

### 7. 清理

```text
terminal.export_transcript({
  sessionId: "ses_rlg01",
  redact: true,
  format: "jsonl"
})
→ { path: "...", eventCount: 18, ... }

terminal.kill({ sessionId: "ses_rlg01" })
→ { ok: true }
```

## 注意事项

- **终端尺寸**: 远程 TUI 对 cols/rows 非常敏感。lazygit 在小尺寸下可能布局错乱，建议 `cols >= 100` 且 `rows >= 30`。
- **wait_stable 参数**: 每次按键后至少等 200ms，TUI 渲染需要时间。翻页或切换面板后建议 500ms。
- **SSH 延迟**: 远程操作比本地多一个 SSH 往返延迟，按键到屏幕更新的间隔可能达到 100-300ms（取决于网络）。如果 snapshot 中看到半个渲染帧，增加 `idleMs` 再试。
- **断线处理**: `ssh-pty` 不支持断线恢复。如果 SSH 连接中断，session 直接进入 `error` 状态。如需持久化，改用 `ssh-tmux` provider。
- **危险操作确认**: 如果 lazygit 弹出 "Are you sure you want to discard changes?" 对话框，`riskSignals` 会出现 `destructive_prompt`。STOP，询问用户。
