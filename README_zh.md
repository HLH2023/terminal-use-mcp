# terminal-use-mcp

[English](README.md) | 中文

本地 + 远程终端交互控制 MCP Server。让 AI agent 像人类一样控制交互式终端程序。

这不是 shell runner。简单命令用 bash tool 跑，这里只处理需要键盘交互的 TUI 程序。

## 功能特性

- **4 个 Provider**: native-pty / tmux / ssh-pty / ssh-tmux
- **25 个 MCP Tools**: 22 个 V1 + 3 个 V2 (设计阶段) + tmux_list + tmux_kill
- **本地 TUI 控制**: lazygit, vim, htop, Python REPL, pdb, 安装器等
- **远程 SSH 终端控制**: 通过 SSH 控制远程 TUI 和外部 agent (V2, 设计阶段)
- **安全策略**: 启动命令过滤 / CWD 白名单 / Secret redaction / 确认提示检测
- **structuredContent 双输出**: 机器可读结构化数据 + 人类可读文本摘要
- **Session 生命周期管理**: TTL 自动清理 / 操作队列 / Transcript 导出
- **Host key 严格校验**: known_hosts 或 pinned fingerprint (V2)

## 快速开始

### 前置依赖

| 依赖 | 最低版本 | 用途 |
|------|----------|------|
| Node.js | 18+ | 运行 MCP server |
| npm | 8+ | 安装依赖 |
| node-gyp + C++ toolchain | — | 编译 node-pty native addon (可选，缺失时 fallback 到 tmux) |
| tmux | 3.2+ | tmux provider (可选，缺失时仅 native-pty 可用) |

### 安装

```bash
cd tools/local/terminal-use-mcp
npm install
```

`node-pty` 是 native addon，编译需要 node-gyp + C++ toolchain。安装失败时自动 fallback 到 tmux provider。

### 环境变量

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `TERMINAL_USE_WORKSPACE_ROOT` | 是 | `process.cwd()` | CWD 校验根目录 |
| `TERMINAL_USE_ALLOWED_CWD` | 否 | _(空)_ | 逗号分隔的额外允许目录 |
| `TERMINAL_USE_SESSION_TTL_MS` | 否 | `3600000` | Session 自动清理超时 (1 小时) |

### MCP Client 配置

根据你使用的客户端选择对应配置：

#### OpenCode

在项目根目录 `.opencode/opencode.json` 的 `mcp` 字段中添加：

```json
{
  "mcp": {
    "terminal-use": {
      "type": "local",
      "command": ["npx", "tsx", "tools/local/terminal-use-mcp/src/index.ts"],
      "cwd": ".",
      "enabled": true,
      "environment": {
        "TERMINAL_USE_WORKSPACE_ROOT": "<你的项目绝对路径>",
        "TERMINAL_USE_ALLOWED_CWD": "<你的项目绝对路径>,/tmp"
      }
    }
  }
}
```

#### Claude Code

在项目根目录 `.mcp.json` 中添加：

```json
{
  "mcpServers": {
    "terminal-use": {
      "command": "npx",
      "args": ["tsx", "tools/local/terminal-use-mcp/src/index.ts"],
      "cwd": "<你的项目绝对路径>",
      "env": {
        "TERMINAL_USE_WORKSPACE_ROOT": "<你的项目绝对路径>",
        "TERMINAL_USE_ALLOWED_CWD": "<你的项目绝对路径>,/tmp"
      }
    }
  }
}
```

#### Claude Desktop

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) 或 `%APPDATA%\Claude\claude_desktop_config.json` (Windows)：

```json
{
  "mcpServers": {
    "terminal-use": {
      "command": "npx",
      "args": ["tsx", "tools/local/terminal-use-mcp/src/index.ts"],
      "cwd": "<你的项目绝对路径>",
      "env": {
        "TERMINAL_USE_WORKSPACE_ROOT": "<你的项目绝对路径>",
        "TERMINAL_USE_ALLOWED_CWD": "<你的项目绝对路径>,/tmp"
      }
    }
  }
}
```

stdio transport: stdout 仅用于 MCP 协议，所有日志写 stderr。服务器收到 SIGINT/SIGTERM 时自动清理所有 session。

### 复制提示词安装（给 AI agent 一键安装）

把以下提示词复制给你的 AI agent，它会自主完成安装、配置和验证。

#### OpenCode 用户

```
请完成 terminal-use-mcp 的安装与接入，步骤如下：

1. 前置检查：
   - 确认 Node.js 18+ 和 npm 8+ 可用（node -v / npm -v）
   - 确认项目根目录有 tools/local/terminal-use-mcp/ 目录

2. 安装依赖：
   - 在 tools/local/terminal-use-mcp/ 下执行 npm install
   - 如果 node-pty 编译失败，这是正常的（会 fallback 到 tmux provider），不要中断

3. 配置 MCP：
   - 在项目根目录 .opencode/opencode.json 的 mcp 字段中添加 terminal-use 配置
   - 配置内容：
     {
       "type": "local",
       "command": ["npx", "tsx", "tools/local/terminal-use-mcp/src/index.ts"],
       "cwd": ".",
       "enabled": true,
       "environment": {
         "TERMINAL_USE_WORKSPACE_ROOT": "<当前项目绝对路径>",
         "TERMINAL_USE_ALLOWED_CWD": "<当前项目绝对路径>,/tmp"
       }
     }
   - 替换 <当前项目绝对路径> 为实际路径

4. 重启客户端使配置生效

5. 验证安装：
   - 确认 MCP 工具列表中出现 terminal.health、terminal.start 等工具
   - 调用 terminal.health 确认 server 和 provider 状态正常
   - 如果工具不可见，检查 .opencode/opencode.json 是否格式正确，然后重新重启

约束：
- 不要修改 apps/* 或 packages/*
- 不要输出任何 secret
- 仅在 node-pty 编译失败时告知我，其他问题自行处理
```

#### Claude Code 用户

```
请完成 terminal-use-mcp 的安装与接入，步骤如下：

1. 前置检查：
   - 确认 Node.js 18+ 和 npm 8+ 可用（node -v / npm -v）
   - 确认项目根目录有 tools/local/terminal-use-mcp/ 目录

2. 安装依赖：
   - 在 tools/local/terminal-use-mcp/ 下执行 npm install
   - 如果 node-pty 编译失败，这是正常的（会 fallback 到 tmux provider），不要中断

3. 配置 MCP：
   - 在项目根目录创建或编辑 .mcp.json，添加 terminal-use 配置：
     {
       "mcpServers": {
         "terminal-use": {
           "command": "npx",
           "args": ["tsx", "tools/local/terminal-use-mcp/src/index.ts"],
           "cwd": "<当前项目绝对路径>",
           "env": {
             "TERMINAL_USE_WORKSPACE_ROOT": "<当前项目绝对路径>",
             "TERMINAL_USE_ALLOWED_CWD": "<当前项目绝对路径>,/tmp"
           }
         }
       }
     }
   - 替换 <当前项目绝对路径> 为实际路径

4. 重启 Claude Code 使配置生效

5. 验证安装：
   - 确认 MCP 工具列表中出现 terminal.health、terminal.start 等工具
   - 调用 terminal.health 确认 server 和 provider 状态正常
   - 如果工具不可见，检查 .mcp.json 格式是否正确，然后重新重启

约束：
- 不要修改 apps/* 或 packages/*
- 不要输出任何 secret
- 仅在 node-pty 编译失败时告知我，其他问题自行处理
```

#### Claude Desktop 用户

```
请完成 terminal-use-mcp 的安装与接入，步骤如下：

1. 前置检查：
   - 确认 Node.js 18+ 和 npm 8+ 可用（node -v / npm -v）
   - 确认项目根目录有 tools/local/terminal-use-mcp/ 目录

2. 安装依赖：
   - 在 tools/local/terminal-use-mcp/ 下执行 npm install
   - 如果 node-pty 编译失败，这是正常的（会 fallback 到 tmux provider），不要中断

3. 配置 MCP：
   - 编辑 Claude Desktop 配置文件：
     - macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
     - Windows: %APPDATA%\Claude\claude_desktop_config.json
   - 在 mcpServers 中添加：
     "terminal-use": {
       "command": "npx",
       "args": ["tsx", "tools/local/terminal-use-mcp/src/index.ts"],
       "cwd": "<当前项目绝对路径>",
       "env": {
         "TERMINAL_USE_WORKSPACE_ROOT": "<当前项目绝对路径>",
         "TERMINAL_USE_ALLOWED_CWD": "<当前项目绝对路径>,/tmp"
       }
     }
   - 替换 <当前项目绝对路径> 为实际路径

4. 完全退出并重启 Claude Desktop

5. 验证安装：
   - 在对话中确认能看到 terminal-use 提供的工具（terminal.health 等）
   - 调用 terminal.health 确认 server 状态正常
   - 如果工具不可见，检查配置文件 JSON 格式和路径拼写

约束：
- 不要修改 apps/* 或 packages/*
- 不要输出任何 secret
- 仅在 node-pty 编译失败或配置文件找不到时告知我
```

## Provider 介绍

| Provider | 用途 | 核心优势 |
|----------|------|----------|
| `native-pty` | 大多数交互式 TUI 程序 (默认) | 响应快, snapshot 质量高, 支持 highlights |
| `tmux` | 需要持久化、断线恢复、多人 attach 的 session | 可 attach, MCP 重启后 session 存活 |
| `ssh-pty` (V2) | 远程主机上的 TUI 程序 | 复用本地 xterm/snapshot/transcript 体系 |
| `ssh-tmux` (V2) | 远程持久 session / 断线恢复 / 人类可 attach | 远程 tmux 全生命周期管理 |

Auto 选择规则:
- 本地: native-pty → tmux
- 远程 (V2): ssh-pty → ssh-tmux (fallback 时响应标记 `fallbackFrom`)

## MCP Tools 列表

### Session 生命周期 (7 tools)

| Tool | 功能 | 关键参数 |
|------|------|----------|
| `terminal.start` | 启动终端 session | `command`, `args?`, `cwd`, `cols?`, `rows?`, `provider?`, `target?` (V2), `env?`, `label?`, `ttlMs?`, `transcript?` |
| `terminal.attach` | 接入已有 session (tmux) | `sessionId` 或 `tmuxSessionName` |
| `terminal.list` | 列出所有活跃 session | _(无)_ |
| `terminal.info` | 查询 session 详情 | `sessionId` |
| `terminal.rename` | 重命名 session 标签 | `sessionId`, `label` |
| `terminal.kill` | 终止 session 及其进程 | `sessionId` |
| `terminal.cleanup` | 清理所有过期 session | _(无)_ |

### 观察 (5 tools)

| Tool | 功能 | 关键参数 |
|------|------|----------|
| `terminal.snapshot` | 捕获当前屏幕状态 | `sessionId` |
| `terminal.wait_for_text` | 等待特定文本出现 | `sessionId`, `text`, `regex?`, `timeoutMs?`, `caseSensitive?` |
| `terminal.wait_stable` | 等待输出停止变化 | `sessionId`, `idleMs?`, `timeoutMs?` |
| `terminal.find` | 在屏幕/scrollback 中搜索文本 | `sessionId`, `pattern`, `regex?`, `includeScrollback?` |
| `terminal.scroll` | 滚动终端视口 | `sessionId`, `direction`, `lines` |

### 输入 (5 tools)

| Tool | 功能 | 关键参数 |
|------|------|----------|
| `terminal.type` | 输入文本 | `sessionId`, `text` |
| `terminal.press` | 发送按键 (支持任意组合键) | `sessionId`, `key` (如 `"ctrl+p"`, `"alt+enter"`, `"f1"`, `"ctrl+shift+f"`) |
| `terminal.paste` | 粘贴大段文本 (带安全检查) | `sessionId`, `text`, `confirmLargePaste?`, `mode?` |
| `terminal.mouse_click` | 鼠标点击 (SGR-1006) | `sessionId`, `col`, `row`, `button?` (left/right/middle), `shift?`, `alt?`, `ctrl?` |
| `terminal.mouse_scroll` | 鼠标滚轮 (SGR-1006) | `sessionId`, `col`, `row`, `direction` (up/down), `lines?` (1-20), `shift?` |

### 元信息 (7 tools)

| Tool | 功能 | 关键参数 |
|------|------|----------|
| `terminal.resize` | 改变终端尺寸 | `sessionId`, `cols`, `rows` |
| `terminal.export_transcript` | 导出 session transcript | `sessionId`, `redact?`, `format?`, `includeSnapshots?` |
| `terminal.health` | 检查服务器和 provider 状态 | _(无)_ |
| `terminal.keys` | 列出可用按键表达式 (按类别) | _(无)_ |
| `terminal.provider_capabilities` | 查询 provider 支持的能力 | `provider` |
| `terminal.events` | 获取 session 事件历史 | `sessionId`, `limit?`, `sinceSeq?` |
| `terminal.send_signal` | 发送信号 (SIGINT/SIGTERM/SIGKILL) | `sessionId`, `signal` |

### 远程控制 (3 tools, V2 设计阶段)

| Tool | 功能 | 关键参数 |
|------|------|----------|
| `terminal.targets` | 列出可用 target (local + SSH) | _(无)_ |
| `terminal.target_info` | 查询 target 详情 (脱敏) | `profile` |
| `terminal.verify_target` | 验证 SSH target 连通性 | `profile` |

## 安全策略

terminal-use-mcp 不是沙箱。安全策略限制启动入口, 不限制 TUI 程序内部行为。

### Command Safety

启动命令 deny 列表:

```
sudo, su, ssh, scp, sftp, rm, dd, mkfs,
shutdown, reboot, chmod, chown, curl, wget,
nc, ncat, telnet
```

```ts
// 环境变量覆盖
TERMINAL_USE_ALLOW_COMMANDS=git,make    // 额外允许
TERMINAL_USE_DENY_COMMANDS=node,python3  // 额外拒绝
TERMINAL_USE_RISKY_COMMAND_MODE=deny     // deny | ask | allow
```

`ask` 模式下, 遇到危险命令返回 `CONFIRMATION_REQUIRED`, agent 应停下询问用户。

**边界**: command policy 只限制 `terminal.start` 的启动命令。TUI 内部子进程、REPL 内 `eval()`/`exec()`、shell 内链式命令不受限。不得把 deny list 当完整沙箱。

### CWD Policy

本地 CWD 校验:

```ts
// 默认允许
const allowedCwdRoots = [
  process.cwd(),
  process.env.TERMINAL_USE_WORKSPACE_ROOT,
  ...splitCsv(process.env.TERMINAL_USE_ALLOWED_CWD),
]

// 默认拒绝 (除非在 allowedCwdRoots 子目录下)
const deniedCwdRoots = ["/", "/root", "/home", "/etc", "/usr", "/var", "/sys", "/proc", "/boot"]
```

workspace root 是 `$HOME/dev/homelab` 时, `$HOME/dev/homelab/**` 允许, 但整个 `$HOME` 不允许。

远程 CWD (V2) 独立校验, 使用 profile 中的 `remoteAllowedCwd` / `remoteDeniedCwd`, 不复用本地规则。

### Secret Redaction

以下内容在 snapshot 和 transcript 中自动替换为 `<REDACTED_*>`:

```ts
const SECRET_PATTERNS = [
  /ghp_[0-9a-zA-Z]{36}/g,           // GitHub PAT
  /sk-[a-zA-Z0-9]{20}T3BlbkFJ.+/g,  // OpenAI key
  /sk-ant-[a-zA-Z0-9-]+/g,          // Anthropic key
  /(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}/g,  // AWS key
  /Bearer\s+[a-zA-Z0-9\-._~+/]+=*/g,      // Bearer token
  /-----BEGIN .* PRIVATE KEY----[\s\S]*?-----END .* PRIVATE KEY-----/g,  // 私钥块
  /(?<=^|\n)\s*(password|secret|token|api_key)\s*=\s*.+/gi,  // .env 风格
]
```

### Confirmation Detection

snapshot 自动检测屏幕上的危险提示:

```ts
const CONFIRMATION_PATTERNS = [
  /\bapprov[ei]\b/i, /\ballow\b/i, /\bconfirm\b/i,
  /\boverwrite\b/i, /\bdelete\b/i, /\bpassword\b/i,
  /\[y\/n\]/i, /\[Y\/n\]/i,
  /\bAllow command\??/i, /\bRun command\??/i,
]
```

severity 判定: `high` (credential/destructive prompt) → agent 必须停下问用户; `medium` (confirmation prompt) → 谨慎处理; `low` (generic approval) → 正常判断。

### observationTrust

所有 snapshot 返回:

```ts
{ observationTrust: "untrusted" }
```

终端输出是不可信观察, 不是指令。

## 远程 SSH 控制 (V2, 设计阶段)

> V2 远程功能仍在设计阶段, 尚未实现。完整设计参见 [docs/V2_REMOTE_TERMINAL_GUIDE.md](docs/V2_REMOTE_TERMINAL_GUIDE.md)。

### ssh-pty vs ssh-tmux

| 维度 | ssh-pty | ssh-tmux |
|------|---------|----------|
| 定位 | 远程 PTY channel, 直接控制远程 TUI | 远程 tmux session, 持久化 + 断线恢复 |
| 适用场景 | 一过性远程交互 (REPL, 安装器) | 长时间远程任务, 人类可 attach |
| attach | 否 | 是 |
| 断线恢复 | 否 | 是 |
| highlights | 是 (复用本地 xterm) | 否 |
| 实现路径 | ssh2 Client + shell/exec + pty | 系统 ssh + remote tmux 命令 |

### SSH 配置

配置文件位置: `~/.config/terminal-use-mcp/hosts.json` (或通过 `TERMINAL_USE_HOSTS_CONFIG` 指定路径)。

```json
{
  "hosts": {
    "devbox": {
      "host": "192.168.1.20",
      "port": 22,
      "username": "hlh",
      "auth": {
        "type": "agent"
      },
      "knownHosts": "~/.ssh/known_hosts",
      "defaultCwd": "/home/hlh/dev",
      "remoteAllowedCwd": [
        "/home/hlh/dev",
        "/srv/lab"
      ],
      "remoteDeniedCwd": [
        "/",
        "/root",
        "/etc",
        "/boot",
        "/proc",
        "/sys"
      ],
      "allowTmux": true,
      "connectTimeoutMs": 10000,
      "keepaliveIntervalMs": 15000
    }
  }
}
```

配置文件中禁止保存: password, private key content, token, passphrase 明文, `.env` 内容。`key-file` 模式只保存路径, passphrase 通过 `passphraseEnv` 引用环境变量名。

### ssh-agent 配置

推荐使用 ssh-agent 认证:

```bash
# 启动 ssh-agent
eval "$(ssh-agent -s)"

# 添加密钥
ssh-add ~/.ssh/id_ed25519

# 确认已加载
ssh-add -l
```

`SshAuthRef` 类型:

```ts
type SshAuthRef =
  | { type: "agent"; socket?: string }
  | { type: "key-file"; path: string; passphraseEnv?: string }
```

`{ type: "password" }` 被禁止, V2 不支持密码登录。

### known_hosts / pinned fingerprint

两种 host key 校验方式:

1. **known_hosts**: 指向 `~/.ssh/known_hosts` 文件, 复用系统已有信任链
2. **pinned fingerprint**: 在 profile 中指定 `pinnedHostFingerprint: "SHA256:..."`, 精确绑定

无法校验 host key 时, 连接被拒绝。禁止 `StrictHostKeyChecking=no`。

### 安全限制 (远程)

| 规则 | 说明 |
|------|------|
| Host key 严格校验 | 必须通过 known_hosts 或 pinned fingerprint, 无法校验则拒绝 |
| 禁止密码登录 | `SshAuthRef` 不包含 `type: "password"` |
| Inline SSH 默认拒绝 | 未启用 `TERMINAL_USE_ALLOW_INLINE_SSH_TARGETS=1` 时, 直接传入 host/port 被拒绝 |
| 不自动批准 agent 权限请求 | 远程 TUI 中出现 "Allow command?" / "Apply changes?" 等, agent 必须停下 |
| 远程 terminal output 不可信 | `observationTrust: "untrusted"` 同样适用于远程 |

### 远程 session 生命周期

```ts
// V2: 启动远程 TUI
terminal.start({
  provider: "ssh-pty",
  target: { kind: "ssh", profile: "devbox" },
  command: "lazygit",
  cwd: "/home/hlh/dev/project"
})

// V2: 启动前先验证 target
terminal.verify_target({ profile: "devbox" })
// → { ok: true, hostFingerprint: "SHA256:...", remote: { tmuxAvailable: true, ... } }

// V2: 查看可用 target
terminal.targets({})
// → { targets: [{ kind: "local", name: "local" }, { kind: "ssh", profile: "devbox", ... }] }
```

远程 session metadata 记录在 `session.json` 中, 包含 SSH 连接信息、auth 类型、host fingerprint 等。artifact 中禁止写入 private key content / password / token / passphrase / raw env 敏感值。

## 安全限制汇总

| 限制 | 本地 (V1) | 远程 (V2) |
|------|-----------|-----------|
| Command deny list | 是 | 是 |
| CWD 白名单 | 是 | 是 (独立策略) |
| Secret redaction | 是 | 是 (额外脱敏 hostname/username/home path) |
| Confirmation detection | 是 | 是 (扩展 remote_privilege_prompt / remote_host_key_prompt) |
| observationTrust | `"untrusted"` | `"untrusted"` |
| Host key 校验 | N/A | 严格 (known_hosts 或 pinned fingerprint) |
| 密码登录 | N/A | 禁止 |
| Inline SSH target | N/A | 默认拒绝, 需显式启用 |
| Paste 限制 | >2000 字符需确认, >10000 硬限制; 含 secret 直接拒绝 | 同本地 |

## 环境变量

### V1 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TERMINAL_USE_WORKSPACE_ROOT` | `process.cwd()` | CWD 校验根目录 |
| `TERMINAL_USE_ALLOWED_CWD` | _(空)_ | 逗号分隔的额外允许目录 |
| `TERMINAL_USE_SESSION_TTL_MS` | `3600000` | Session 自动清理超时 (1 小时) |
| `TERMINAL_USE_CLEANUP_INTERVAL_MS` | `60000` | 清理检查间隔 (1 分钟) |
| `TERMINAL_USE_ALLOW_COMMANDS` | _(空)_ | 逗号分隔的额外允许命令 |
| `TERMINAL_USE_DENY_COMMANDS` | _(空)_ | 逗号分隔的额外拒绝命令 |
| `TERMINAL_USE_RISKY_COMMAND_MODE` | `deny` | 危险命令处理: `deny` / `ask` / `allow` |

### V2 环境变量 (设计阶段)

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TERMINAL_USE_HOSTS_CONFIG` | `~/.config/terminal-use-mcp/hosts.json` | SSH hosts 配置文件路径 |
| `TERMINAL_USE_ALLOW_INLINE_SSH_TARGETS` | _(空/未设置)_ | 启用后允许直接在 tool 参数中指定 SSH host |

## 核心类型定义

### TerminalSnapshot

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

### ToolError

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
  // V2 新增 (设计阶段)
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

### TerminalTarget (V2, 设计阶段)

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

## 开发命令

```bash
npm run dev              # 启动 MCP server (tsx 直接运行)
npm run build            # TypeScript 编译
npm run typecheck        # 类型检查 (tsc --noEmit)
npm run test             # 运行全部测试
npm run test:unit        # 单元测试
npm run test:contract    # Provider 契约测试
npm run test:mcp         # MCP stdio smoke 测试
npm run test:integration # 集成测试
npm run check            # typecheck + test
```

## 平台支持

| 平台 | V1 状态 | 说明 |
|------|---------|------|
| Linux x86_64 / ARM64 | 支持 | native-pty + tmux 均可用 |
| macOS Intel / Apple Silicon | 支持 / 尽力 | native-pty 需 Xcode CLI tools; tmux 通过 brew 安装 |
| WSL2 | 支持 / 尽力 | 同 Linux; 需确认 node-pty 编译 |
| Native Windows | 不支持 | ConPTY 支持计划在后续版本实现, tmux 不可用 |

## 已知限制

1. native-pty 依赖 node-gyp, 部分环境可能编译失败 (fallback 到 tmux)
2. `@xterm/headless` 的 highlight 检测是 best-effort
3. tmux provider 不支持 true color ANSI
4. Native Windows 不支持 (V1)
5. Session 不持久化, server 重启丢失
6. 大粘贴硬限制 10000 字符
7. 确认检测是正则匹配, 可能误报

## 致谢与参考声明

本项目的开发受到以下开源项目的启发与参考。感谢他们的作者和贡献者。

### 直接参考（代码级启发）

| 项目 | 仓库 | 许可证 | 参考方式 |
|------|------|--------|----------|
| [tui-use](https://github.com/onesuper/tui-use) | [onesuper/tui-use](https://github.com/onesuper/tui-use) | MIT | 按键映射格式 (`keymap.ts`)、CLI press 参数命名 (`TUI_USE_NAMED_MAP` / `TUI_USE_FN_MAP`)、屏幕稳定检测语义 (`wait_stable` / `wait_for_text`)。terminal-use-mcp 是独立实现，架构不同 (MCP 服务器 vs. CLI 守护进程; 多 Provider vs. 单一 native-pty)。未复制代码 — 仅适配了按键命名约定和 wait 抽象模式。 |

### 架构与设计参考（仅文档级参考）

| 项目 | 仓库 | 许可证 | 参考方式 |
|------|------|--------|----------|
| [ssh-mcp](https://github.com/n0madic/ssh-mcp) | [n0madic/ssh-mcp](https://github.com/n0madic/ssh-mcp) | MIT | SSH 安全最佳实践参考 (known_hosts, ssh-agent) |
| [ssh-session-mcp](https://github.com/Zw-awa/ssh-session-mcp) | [Zw-awa/ssh-session-mcp](https://github.com/Zw-awa/ssh-session-mcp) | MIT | 分布式 session owner 架构参考 |
| [mcp-ssh](https://github.com/xiongjiwei/mcp-ssh) | [xiongjiwei/mcp-ssh](https://github.com/xiongjiwei/mcp-ssh) | MIT | 反面案例参考 (默认关闭 host key 校验) |
| [terminal-mcp](https://github.com/mkpvishnu/terminal-mcp) | [mkpvishnu/terminal-mcp](https://github.com/mkpvishnu/terminal-mcp) | MIT | PTY 容器方案对比参考 |

### 运行时依赖

所有运行时和可选依赖均使用宽松许可证 (MIT 或 Apache-2.0)。不存在 GPL/LGPL 等 copyleft 依赖。

| 包名 | 仓库 | 许可证 |
|------|------|--------|
| @modelcontextprotocol/sdk | [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) | MIT |
| ssh2 | [mscdex/ssh2](https://github.com/mscdex/ssh2) | MIT |
| zod | [colinhacks/zod](https://github.com/colinhacks/zod) | MIT |
| @xterm/headless | [xtermjs/xterm.js](https://github.com/xtermjs/xterm.js) | MIT |
| @xterm/addon-unicode11 | [xtermjs/xterm.js](https://github.com/xtermjs/xterm.js) | MIT |
| node-pty (可选) | [microsoft/node-pty](https://github.com/microsoft/node-pty) | MIT |

### 参考的标准与规范

- [XTerm Control Sequences](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html) — ANSI 转义序列编码 (SGR-1006 鼠标, C0/C1/SS3 按键)
- [tmux(1) 手册](https://man7.org/linux/man-pages/man1/tmux.1.html) — `capture-pane`、`send-keys`、`display-message` 格式变量
- [Model Context Protocol 规范](https://spec.modelcontextprotocol.io/) — MCP 服务器/工具/资源/提示词注册模式

## 许可证

MIT

[English](README.md) | 中文
