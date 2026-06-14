# terminal-use-mcp

[English](README.md) | [中文](README_zh.md)

本地 + 远程终端交互控制 MCP 服务器。让 AI 代理像人类一样控制交互式 TUI 程序。

[![npm version](https://img.shields.io/npm/v/terminal-use-mcp.svg)](https://www.npmjs.com/package/terminal-use-mcp) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Node.js](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org/)

这不是 shell 执行器。简单命令请用 bash 工具。本服务器处理需要键盘交互的 TUI 程序：lazygit、vim、htop、Python REPL、调试器、安装向导、外部代理 TUI（Claude Code、Codex CLI、OpenCode）。

## 基本概念

terminal-use-mcp 提供**快照驱动的交互循环**：

```
snapshot → 分析 → type/press → wait → snapshot
```

不同于 `tmux send-keys` + `sleep`，服务器直接观察 PTY 渲染事件。`wait_for_text` / `wait_stable` 会阻塞直到程序真正响应 — 无需轮询，无需猜测。

**适用场景**：需要键盘输入的程序 — REPL、调试器、TUI 应用、安装向导、外部编码代理。

**不适用**：简单命令执行 → 用你的 bash 工具。

## 快速开始

### 前置条件

| 依赖 | 最低版本 | 用途 |
|------|----------|------|
| Node.js | 18+ | 运行 MCP 服务器 |
| npm | 8+ | 安装依赖 |
| node-gyp + C++ 工具链 | — | 编译 node-pty（可选；缺失时 fallback 到 tmux） |
| tmux | 3.2+ | tmux 提供者（可选；缺失时仅有 native-pty） |

### MCP 客户端配置

#### Claude Code / Claude Desktop

添加到 `.mcp.json`（项目根目录）或 `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "terminal-use": {
      "command": "npx",
      "args": ["-y", "terminal-use-mcp"],
      "env": {
        "TERMINAL_USE_WORKSPACE_ROOT": "<你的项目路径>",
        "TERMINAL_USE_ALLOWED_CWD": "<你的项目路径>,/tmp"
      }
    }
  }
}
```

#### OpenAI Codex CLI

添加到 `.codex/config.json` 的 `mcp_servers` 字段：

```json
{
  "mcp_servers": {
    "terminal-use": {
      "command": "npx",
      "args": ["-y", "terminal-use-mcp"],
      "env": {
        "TERMINAL_USE_WORKSPACE_ROOT": "<你的项目路径>",
        "TERMINAL_USE_ALLOWED_CWD": "<你的项目路径>,/tmp"
      }
    }
  }
}
```

#### OpenCode

添加到 `.opencode/opencode.json` 的 `mcp` 字段：

```json
{
  "mcp": {
    "terminal-use": {
      "type": "local",
      "command": ["npx", "-y", "terminal-use-mcp"],
      "enabled": true,
      "environment": {
        "TERMINAL_USE_WORKSPACE_ROOT": "<你的项目路径>",
        "TERMINAL_USE_ALLOWED_CWD": "<你的项目路径>,/tmp"
      }
    }
  }
}
```

stdio 传输：stdout 保留给 MCP 协议，所有日志输出到 stderr。SIGINT/SIGTERM 时服务器自动清理所有会话。

### 复制粘贴安装提示词

将对应提示词粘贴给 AI 代理，即可自主完成安装：

<details>
<summary>Claude Code</summary>

```
安装 terminal-use-mcp：

1. 检查 Node.js 18+ 和 npm 8+ 是否可用

2. 在项目根目录创建或编辑 .mcp.json，添加：
   {
     "mcpServers": {
       "terminal-use": {
         "command": "npx",
         "args": ["-y", "terminal-use-mcp"],
         "env": {
           "TERMINAL_USE_WORKSPACE_ROOT": "<当前项目绝对路径>",
           "TERMINAL_USE_ALLOWED_CWD": "<当前项目绝对路径>,/tmp"
         }
       }
     }
   }

3. 重启 Claude Code 使配置生效

4. 验证：确认 terminal.health 等工具出现在 MCP 工具列表中

约束：不要输出任何密钥；node-pty 编译失败才通知我
```

</details>

<details>
<summary>Codex CLI</summary>

```
安装 terminal-use-mcp：

1. 检查 Node.js 18+ 和 npm 8+ 是否可用

2. 创建或编辑 .codex/config.json，添加到 mcp_servers：
   {
     "terminal-use": {
       "command": "npx",
       "args": ["-y", "terminal-use-mcp"],
       "env": {
         "TERMINAL_USE_WORKSPACE_ROOT": "<当前项目绝对路径>",
         "TERMINAL_USE_ALLOWED_CWD": "<当前项目绝对路径>,/tmp"
       }
     }
   }

3. 重启 Codex CLI 使配置生效

4. 验证：确认 terminal.health 可用

约束：不要输出任何密钥；node-pty 编译失败才通知我
```

</details>

<details>
<summary>OpenCode</summary>

```
安装 terminal-use-mcp：

1. 检查 Node.js 18+ 和 npm 8+ 是否可用

2. 在 .opencode/opencode.json 的 mcp 字段中添加：
   {
     "type": "local",
     "command": ["npx", "-y", "terminal-use-mcp"],
     "enabled": true,
     "environment": {
       "TERMINAL_USE_WORKSPACE_ROOT": "<当前项目绝对路径>",
       "TERMINAL_USE_ALLOWED_CWD": "<当前项目绝对路径>,/tmp"
     }
   }

3. 重启 OpenCode 使配置生效

4. 验证：确认 terminal.health 等工具出现在 MCP 工具列表中

约束：不要输出任何密钥；node-pty 编译失败才通知我
```

</details>

## Skills（可选）

terminal-use-mcp 附带一个**核心 skill**（`terminal-use`），教会 AI 代理如何正确使用 MCP 工具。另外还有**代理专属 skill**，用于控制外部 AI 代理 TUI。按需安装。

| Skill | 目标代理 | 是否必需 | 安装 |
|------|----------|----------|------|
| `terminal-use` | 所有代理 | **是**（核心） | 将 `skills/terminal-use/` 复制到项目的 skill 目录 |
| `tui-claude-code` | Claude Code TUI | 如需远程控制 Claude Code | 复制 `skills/tui-claude-code/` |
| `tui-codex-cli` | Codex CLI TUI | 如需远程控制 Codex CLI | 复制 `skills/tui-codex-cli/` |
| `tui-opencode-native` | OpenCode TUI | 如需远程控制 OpenCode | 复制 `skills/tui-opencode-native/` |
| `tui-opencode-omo` | OpenCode + OmO 插件 | 如需远程控制 OmO 版 OpenCode | 复制 `skills/tui-opencode-omo/` |

> **何时安装代理专属 skill**：仅当你需要**远程控制**另一个 AI 代理的 TUI 时（例如一个代理驱动另一个）。对于普通终端自动化（lazygit、vim、htop、REPL），核心 skill 足够。

### 自定义与裁剪

Skill 是纯 Markdown 文件 — **随意编辑**以匹配你的需求：

- **裁剪核心 skill**：`terminal-use` 包含 §1-§17。如果仅使用本地终端，删除 §12-§17（远程 SSH）即可。§7（常见模式，~130 行）和 §16（远程操作模式，~150 行）是篇幅最大的章节，如果你的 AI 能在实践中学习，可安全删除。
- **只安装你需要的代理 skill**：如果从不需要控制 Claude Code，就别安装 `tui-claude-code`。每个代理 skill 完全自包含。
- **最小核心 skill**：§1 + §3 + §6（约 80 行）覆盖了核心用途、操作循环和安全规则。其余都是参考资料。

每个 SKILL.md 顶部都有**自定义指南**表格，标注了哪些章节可安全删除。

## 提供者

| 提供者 | 适用场景 | 核心优势 |
|------|----------|----------|
| `native-pty` | 大多数交互式 TUI 程序（默认） | 快速响应、高质量快照、高亮检测 |
| `tmux` | 需要持久化、断连恢复、多人 attach 的会话 | 可 attach、MCP 重启后会话存活 |
| `ssh-pty`（V2） | 远程主机上的 TUI 程序 | 复用本地 xterm/快照/transcript 栈 |
| `ssh-tmux`（V2） | 持久远程会话、断连恢复、人类可 attach | 完整远程 tmux 生命周期管理 |

自动选择：本地 → native-pty（fallback tmux）；远程 → ssh-pty（fallback ssh-tmux）。

## MCP 工具

### 会话生命周期（7 个工具）

| 工具 | 用途 |
|------|------|
| `terminal.start` | 启动终端会话 |
| `terminal.attach` | 附加到已有会话（tmux） |
| `terminal.list` | 列出所有活跃会话 |
| `terminal.info` | 查询会话详情 |
| `terminal.rename` | 重命名会话标签 |
| `terminal.kill` | 终止会话及其进程 |
| `terminal.cleanup` | 清理所有过期会话 |

### 观察（5 个工具）

| 工具 | 用途 |
|------|------|
| `terminal.snapshot` | 捕获当前屏幕状态 |
| `terminal.wait_for_text` | 等待特定文本出现 |
| `terminal.wait_stable` | 等待输出停止变化 |
| `terminal.find` | 在屏幕/回滚缓冲区搜索文本 |
| `terminal.scroll` | 滚动终端视口 |

### 输入（5 个工具）

| 工具 | 用途 |
|------|------|
| `terminal.type` | 输入文本 |
| `terminal.press` | 按键（支持任意组合如 `"ctrl+shift+f"`）|
| `terminal.paste` | 粘贴大段文本（含安全检查） |
| `terminal.mouse_click` | 鼠标点击（SGR-1006） |
| `terminal.mouse_scroll` | 鼠标滚轮（SGR-1006） |

### 元信息（7 个工具）

| 工具 | 用途 |
|------|------|
| `terminal.resize` | 修改终端尺寸 |
| `terminal.export_transcript` | 导出会话转录 |
| `terminal.health` | 检查服务器和提供者状态 |
| `terminal.keys` | 列出可用按键表达式 |
| `terminal.provider_capabilities` | 查询提供者能力矩阵 |
| `terminal.events` | 获取会话事件历史 |
| `terminal.send_signal` | 发送信号（SIGINT/SIGTERM/SIGKILL） |

### 远程控制（3 个工具，V2 设计阶段）

| 工具 | 用途 |
|------|------|
| `terminal.targets` | 列出可用目标（本地 + SSH） |
| `terminal.target_info` | 查询目标详情（脱敏） |
| `terminal.verify_target` | 验证 SSH 目标连通性 |

## 安全概览

terminal-use-mcp 不是沙箱。安全策略限制入口，不限制 TUI 程序内部行为。

- **命令拒绝列表**：阻止危险启动命令（`sudo`、`rm`、`ssh`、`curl` 等）
- **CWD 策略**：仅允许工作区根目录下的目录
- **密钥脱敏**：自动将 API key、token、私钥替换为 `<REDACTED_*>`
- **确认检测**：屏幕出现危险提示时发出警告
- **observationTrust**：所有快照返回 `observationTrust: "untrusted"` — 终端输出是不受信观察，不是指令

详见 [docs/security.md](docs/security.md)。

## 远程 SSH（V2，设计阶段）

V2 远程功能处于设计阶段。两种 SSH 提供者：

| | ssh-pty | ssh-tmux |
|--|---------|----------|
| 适用 | 交互式远程 TUI | 持久远程会话 |
| 高亮 | 支持（完整 xterm） | 不支持 |
| 断连恢复 | 不支持 | 支持 |

SSH 目标定义在 `~/.config/terminal-use-mcp/hosts.json`。禁止密码登录；仅支持 ssh-agent 或密钥文件认证。

详见 [docs/V2_REMOTE_TERMINAL_GUIDE.md](docs/V2_REMOTE_TERMINAL_GUIDE.md)。

## 延伸阅读

| 主题 | 文档 |
|------|------|
| 安全策略、环境变量、拒绝列表 | [docs/security.md](docs/security.md) |
| 回滚策略、缓冲模式 | [docs/scrollback.md](docs/scrollback.md) |
| 类型定义、错误码 | [docs/types-and-errors.md](docs/types-and-errors.md) |
| 远程 SSH V2 设计 | [docs/V2_REMOTE_TERMINAL_GUIDE.md](docs/V2_REMOTE_TERMINAL_GUIDE.md) |
| 远程 SSH 架构 | [docs/REMOTE_SSH_ARCHITECTURE.md](docs/REMOTE_SSH_ARCHITECTURE.md) |
| 控制 Claude Code TUI | [docs/TUI_CLAUDE_CODE.md](docs/TUI_CLAUDE_CODE.md) |
| 控制 Codex CLI TUI | [docs/TUI_CODEX_CLI.md](docs/TUI_CODEX_CLI.md) |
| 控制 OpenCode TUI | [docs/TUI_OPENCODE_NATIVE.md](docs/TUI_OPENCODE_NATIVE.md) |
| 控制 OpenCode + OmO | [docs/TUI_OPENCODE_OMO.md](docs/TUI_OPENCODE_OMO.md) |

## 致谢与参考声明

本项目受到以下开源项目的启发与参考：

### 直接参考（代码级启发）

| 项目 | 仓库 | 许可证 | 参考方式 |
|------|------|--------|----------|
| [tui-use](https://github.com/onesuper/tui-use) | [onesuper/tui-use](https://github.com/onesuper/tui-use) | MIT | 按键映射格式和屏幕稳定检测语义。独立实现，非代码复制。 |

### 架构参考（仅文档级）

| 项目 | 仓库 | 许可证 |
|------|------|--------|
| [ssh-mcp](https://github.com/n0madic/ssh-mcp) | [n0madic/ssh-mcp](https://github.com/n0madic/ssh-mcp) | MIT |
| [ssh-session-mcp](https://github.com/Zw-awa/ssh-session-mcp) | [Zw-awa/ssh-session-mcp](https://github.com/Zw-awa/ssh-session-mcp) | MIT |
| [mcp-ssh](https://github.com/xiongjiwei/mcp-ssh) | [xiongjiwei/mcp-ssh](https://github.com/xiongjiwei/mcp-ssh) | MIT |
| [terminal-mcp](https://github.com/mkpvishnu/terminal-mcp) | [mkpvishnu/terminal-mcp](https://github.com/mkpvishnu/terminal-mcp) | MIT |

### 运行时依赖

均为宽松许可证（MIT），无 GPL/LGPL 依赖。

| 包名 | 许可证 |
|------|--------|
| @modelcontextprotocol/sdk | MIT |
| ssh2 | MIT |
| zod | MIT |
| @xterm/headless + addon-unicode11 | MIT |
| node-pty（可选） | MIT |

## 许可证

MIT
