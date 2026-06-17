# terminal-use-mcp

[English](README.md) | [中文](README_zh.md)

本地 + 远程终端交互控制 MCP 服务器。让 AI 代理像人类一样控制交互式 TUI 程序。

[![npm version](https://img.shields.io/npm/v/terminal-use-mcp.svg)](https://www.npmjs.com/package/terminal-use-mcp) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Node.js](https://img.shields.io/badge/node-%3E%3D20-green.svg)](https://nodejs.org/)

| 平台 | 状态 |
|------|------|
| Linux x86_64 / ARM64 | 支持 |
| macOS Intel / Apple Silicon | 支持（尽力而为） |
| WSL2 | 支持（尽力而为） |
| 原生 Windows | 实验性（仅 native-pty；tmux 需要 [psmux](https://github.com/psmux/psmux) 或 WSL2） |

> **Windows 用户**：`native-pty` provider 在 Windows 上可用（自动检测 shell：`ComSpec` → `cmd.exe`）。`tmux` provider 依赖 Unix PTY 多路复用器 — 安装 [psmux](https://github.com/psmux/psmux)（tmux 兼容，支持 83 个命令，使用 `tmux` 作为别名）或使用 WSL2。若 `tmux` 不在 PATH 上，可通过 `TERMINAL_USE_TMUX_PATH` 设置其绝对或相对路径。

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
| Node.js | 20+ | 运行 MCP 服务器 |
| npm | 8+ | 安装依赖 |
| node-gyp + C++ 工具链 | — | 编译 node-pty（可选；缺失时 fallback 到 tmux）。编译 re2 也需要（可选；ReDoS 防护） |
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
        "TERMINAL_USE_ALLOWED_CWD": "<你的项目路径>,/tmp",
        "TERMINAL_USE_PROVIDERS": "native-pty,tmux"
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
        "TERMINAL_USE_ALLOWED_CWD": "<你的项目路径>,/tmp",
        "TERMINAL_USE_PROVIDERS": "native-pty,tmux"
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
        "TERMINAL_USE_ALLOWED_CWD": "<你的项目路径>,/tmp",
        "TERMINAL_USE_PROVIDERS": "native-pty,tmux"
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

1. 检查 Node.js 20+ 和 npm 8+ 是否可用

2. 在项目根目录创建或编辑 .mcp.json，添加：
    {
      "mcpServers": {
        "terminal-use": {
          "command": "npx",
          "args": ["-y", "terminal-use-mcp"],
          "env": {
            "TERMINAL_USE_WORKSPACE_ROOT": "<当前项目绝对路径>",
            "TERMINAL_USE_ALLOWED_CWD": "<当前项目绝对路径>,/tmp",
            "TERMINAL_USE_PROVIDERS": "native-pty,tmux"
          }
        }
      }
    }
   - TERMINAL_USE_PROVIDERS 控制启用的 provider（逗号分隔）。
     常用值：
     - "native-pty,tmux" — 仅本地（默认，不含 SSH）
     - "native-pty,tmux,ssh-pty,ssh-tmux" — 全部 provider（含远程 SSH）
     - "tmux" — 仅 tmux（node-pty 不可用时）
      如果不确定，使用 "native-pty,tmux"。
   - 若 tmux 不在 PATH 上，通过 TERMINAL_USE_TMUX_PATH 设置其绝对或相对路径。
    - Windows：默认仅 native-pty。如需 tmux 支持，安装 psmux（https://github.com/psmux/psmux）
      其提供 `tmux` 别名，或使用 WSL2。
    - 安全配置（可选）：
      - TERMINAL_USE_ALLOW_COMMANDS：允许命令白名单，覆盖内置黑名单（逗号分隔）
      - TERMINAL_USE_DENY_COMMANDS：额外拒绝命令列表，补充内置黑名单（逗号分隔）
      - TERMINAL_USE_RISKY_COMMAND_MODE：风险命令处理方式 — "deny"（默认，阻止）、"ask"（提示用户确认）、"allow"（允许全部）
      如果不确定，保持默认即可（deny 模式对大多数场景是安全的）。

3. 安装 skills：
   - 向用户提问："你是否安装了 npx skills（skills.sh）？(是 / 否 / 不确定)"
   - 如果是或不确定（先尝试）：
     向用户提问："全局安装（跨项目可用）还是仅本项目安装？(global / project)"
     如果全局：运行 npx skills add HLH2023/terminal-use-mcp -s terminal-use -s terminal-use-setup -g
     如果本项目：运行 npx skills add HLH2023/terminal-use-mcp -s terminal-use -s terminal-use-setup
     如果命令失败，回退到手动下载（见下方）。
   - 如果否（手动下载）：
     下载 https://raw.githubusercontent.com/HLH2023/terminal-use-mcp/main/skills/terminal-use/SKILL.md
     保存到 .claude/skills/terminal-use/SKILL.md
     下载 https://raw.githubusercontent.com/HLH2023/terminal-use-mcp/main/skills/terminal-use-setup/SKILL.md
     保存到 .claude/skills/terminal-use-setup/SKILL.md
   - 向用户提问："你需要通过 terminal-use-mcp 远程控制以下哪个 AI 代理 TUI？
     - Claude Code TUI (tui-claude-code)
     - Codex CLI TUI (tui-codex-cli)
     - OpenCode TUI (tui-opencode-native)
     - OpenCode + OmO 插件 TUI (tui-opencode-omo)
     如果不确定，先跳过 — 后续可通过 npx skills add HLH2023/terminal-use-mcp -s <skill-name> 添加"
   - 对用户确认的每个代理：如果 skills.sh 可用，运行
     npx skills add HLH2023/terminal-use-mcp -s <skill-name>
     （如果用户选择了全局安装，追加 -g）
     否则，从 https://raw.githubusercontent.com/HLH2023/terminal-use-mcp/main/skills/<skill-name>/SKILL.md
     下载并保存到 .claude/skills/<skill-name>/SKILL.md
   - 向用户提问："核心 skill 包含本地（§1-§11）和远程 SSH（§12-§17）两部分。
     如果你只使用本地终端，我可以删除 §12-§17 以节省约 500 行。
     需要我裁剪吗？"

4. 重启 Claude Code 使配置生效

5. 验证：
   - 确认 terminal.health 等工具出现在 MCP 工具列表中
   - 调用 terminal.health 确认服务器和 provider 状态正常
   - 将 terminal.health 返回的 version 与 skill 版本头（如 v0.2.0）对比。
     如果版本不匹配，提示用户更新 skill：npx skills update

约束：不要输出任何密钥；node-pty 编译失败才通知我
```

</details>

<details>
<summary>Codex CLI</summary>

```
安装 terminal-use-mcp：

1. 检查 Node.js 20+ 和 npm 8+ 是否可用

2. 创建或编辑 .codex/config.json，添加到 mcp_servers：
    {
      "terminal-use": {
        "command": "npx",
        "args": ["-y", "terminal-use-mcp"],
        "env": {
          "TERMINAL_USE_WORKSPACE_ROOT": "<当前项目绝对路径>",
          "TERMINAL_USE_ALLOWED_CWD": "<当前项目绝对路径>,/tmp",
          "TERMINAL_USE_PROVIDERS": "native-pty,tmux"
        }
      }
    }
   - TERMINAL_USE_PROVIDERS 控制启用的 provider（逗号分隔）。
     常用值：
     - "native-pty,tmux" — 仅本地（默认，不含 SSH）
     - "native-pty,tmux,ssh-pty,ssh-tmux" — 全部 provider（含远程 SSH）
     - "tmux" — 仅 tmux（node-pty 不可用时）
      如果不确定，使用 "native-pty,tmux"。
   - 若 tmux 不在 PATH 上，通过 TERMINAL_USE_TMUX_PATH 设置其绝对或相对路径。
    - Windows：默认仅 native-pty。如需 tmux 支持，安装 psmux（https://github.com/psmux/psmux）
      其提供 `tmux` 别名，或使用 WSL2。
    - 安全配置（可选）：
      - TERMINAL_USE_ALLOW_COMMANDS：允许命令白名单，覆盖内置黑名单（逗号分隔）
      - TERMINAL_USE_DENY_COMMANDS：额外拒绝命令列表，补充内置黑名单（逗号分隔）
      - TERMINAL_USE_RISKY_COMMAND_MODE：风险命令处理方式 — "deny"（默认，阻止）、"ask"（提示用户确认）、"allow"（允许全部）
      如果不确定，保持默认即可（deny 模式对大多数场景是安全的）。

3. 安装 skills：
   - 向用户提问："你是否安装了 npx skills（skills.sh）？(是 / 否 / 不确定)"
   - 如果是或不确定（先尝试）：
     向用户提问："全局安装（跨项目可用）还是仅本项目安装？(global / project)"
     如果全局：运行 npx skills add HLH2023/terminal-use-mcp -s terminal-use -s terminal-use-setup -g
     如果本项目：运行 npx skills add HLH2023/terminal-use-mcp -s terminal-use -s terminal-use-setup
     如果命令失败，回退到手动下载（见下方）。
   - 如果否（手动下载）：
     下载 https://raw.githubusercontent.com/HLH2023/terminal-use-mcp/main/skills/terminal-use/SKILL.md
     保存到 .codex/skills/terminal-use/SKILL.md
     下载 https://raw.githubusercontent.com/HLH2023/terminal-use-mcp/main/skills/terminal-use-setup/SKILL.md
     保存到 .codex/skills/terminal-use-setup/SKILL.md
   - 向用户提问："你需要通过 terminal-use-mcp 远程控制以下哪个 AI 代理 TUI？
     - Claude Code TUI (tui-claude-code)
     - Codex CLI TUI (tui-codex-cli)
     - OpenCode TUI (tui-opencode-native)
     - OpenCode + OmO 插件 TUI (tui-opencode-omo)
     如果不确定，先跳过 — 后续可通过 npx skills add HLH2023/terminal-use-mcp -s <skill-name> 添加"
   - 对用户确认的每个代理：如果 skills.sh 可用，运行
     npx skills add HLH2023/terminal-use-mcp -s <skill-name>
     （如果用户选择了全局安装，追加 -g）
     否则，从 https://raw.githubusercontent.com/HLH2023/terminal-use-mcp/main/skills/<skill-name>/SKILL.md
     下载并保存到 .codex/skills/<skill-name>/SKILL.md
   - 向用户提问："核心 skill 包含本地（§1-§11）和远程 SSH（§12-§17）两部分。
     如果你只使用本地终端，我可以删除 §12-§17 以节省约 500 行。
     需要我裁剪吗？"

4. 重启 Codex CLI 使配置生效

5. 验证：
   - 确认 terminal.health 可用
   - 调用 terminal.health 并将返回的 version 与 skill 版本头（如 v0.2.0）对比。
     如果版本不匹配，提示用户更新 skill：npx skills update

约束：不要输出任何密钥；node-pty 编译失败才通知我
```

</details>

<details>
<summary>OpenCode</summary>

```
安装 terminal-use-mcp：

1. 检查 Node.js 20+ 和 npm 8+ 是否可用

2. 在 .opencode/opencode.json 的 mcp 字段中添加：
    {
      "type": "local",
      "command": ["npx", "-y", "terminal-use-mcp"],
      "enabled": true,
      "environment": {
        "TERMINAL_USE_WORKSPACE_ROOT": "<当前项目绝对路径>",
        "TERMINAL_USE_ALLOWED_CWD": "<当前项目绝对路径>,/tmp",
        "TERMINAL_USE_PROVIDERS": "native-pty,tmux"
      }
    }
   - TERMINAL_USE_PROVIDERS 控制启用的 provider（逗号分隔）。
     常用值：
     - "native-pty,tmux" — 仅本地（默认，不含 SSH）
     - "native-pty,tmux,ssh-pty,ssh-tmux" — 全部 provider（含远程 SSH）
     - "tmux" — 仅 tmux（node-pty 不可用时）
      如果不确定，使用 "native-pty,tmux"。
   - 若 tmux 不在 PATH 上，通过 TERMINAL_USE_TMUX_PATH 设置其绝对或相对路径。
    - Windows：默认仅 native-pty。如需 tmux 支持，安装 psmux（https://github.com/psmux/psmux）
      其提供 `tmux` 别名，或使用 WSL2。
    - 安全配置（可选）：
      - TERMINAL_USE_ALLOW_COMMANDS：允许命令白名单，覆盖内置黑名单（逗号分隔）
      - TERMINAL_USE_DENY_COMMANDS：额外拒绝命令列表，补充内置黑名单（逗号分隔）
      - TERMINAL_USE_RISKY_COMMAND_MODE：风险命令处理方式 — "deny"（默认，阻止）、"ask"（提示用户确认）、"allow"（允许全部）
      如果不确定，保持默认即可（deny 模式对大多数场景是安全的）。

3. 安装 skills：
   - 向用户提问："你是否安装了 npx skills（skills.sh）？(是 / 否 / 不确定)"
   - 如果是或不确定（先尝试）：
     向用户提问："全局安装（跨项目可用）还是仅本项目安装？(global / project)"
     如果全局：运行 npx skills add HLH2023/terminal-use-mcp -s terminal-use -s terminal-use-setup -g
     如果本项目：运行 npx skills add HLH2023/terminal-use-mcp -s terminal-use -s terminal-use-setup
     如果命令失败，回退到手动下载（见下方）。
   - 如果否（手动下载）：
     下载 https://raw.githubusercontent.com/HLH2023/terminal-use-mcp/main/skills/terminal-use/SKILL.md
     保存到 .opencode/skills/terminal-use/SKILL.md
     下载 https://raw.githubusercontent.com/HLH2023/terminal-use-mcp/main/skills/terminal-use-setup/SKILL.md
     保存到 .opencode/skills/terminal-use-setup/SKILL.md
   - 向用户提问："你需要通过 terminal-use-mcp 远程控制以下哪个 AI 代理 TUI？
     - Claude Code TUI (tui-claude-code)
     - Codex CLI TUI (tui-codex-cli)
     - OpenCode TUI (tui-opencode-native)
     - OpenCode + OmO 插件 TUI (tui-opencode-omo)
     如果不确定，先跳过 — 后续可通过 npx skills add HLH2023/terminal-use-mcp -s <skill-name> 添加"
   - 对用户确认的每个代理：如果 skills.sh 可用，运行
     npx skills add HLH2023/terminal-use-mcp -s <skill-name>
     （如果用户选择了全局安装，追加 -g）
     否则，从 https://raw.githubusercontent.com/HLH2023/terminal-use-mcp/main/skills/<skill-name>/SKILL.md
     下载并保存到 .opencode/skills/<skill-name>/SKILL.md
   - 向用户提问："核心 skill 包含本地（§1-§11）和远程 SSH（§12-§17）两部分。
     如果你只使用本地终端，我可以删除 §12-§17 以节省约 500 行。
     需要我裁剪吗？"

4. 重启 OpenCode 使配置生效

5. 验证：
   - 确认 terminal.health 等工具出现在 MCP 工具列表中
   - 调用 terminal.health 并将返回的 version 与 skill 版本头（如 v0.2.0）对比。
     如果版本不匹配，提示用户更新 skill：npx skills update

约束：不要输出任何密钥；node-pty 编译失败才通知我
```

</details>

## Skills（可选）

terminal-use-mcp 提供**核心 skill**（`terminal-use` 和 `terminal-use-setup`，可在 [GitHub 仓库](https://github.com/HLH2023/terminal-use-mcp/tree/main/skills) 获取），教会 AI 代理如何正确使用 MCP 工具以及如何配置服务器。另外还有**代理专属 skill**，用于控制外部 AI 代理 TUI。Skill 不包含在 npm 包中 — 需从 GitHub 下载。按需安装。

### 通过 skills.sh 安装（推荐）

[skills.sh](https://skills.sh)（`npx skills`）提供一键安装和更新，支持 19+ AI 代理平台：

```bash
# 交互选择 — 仓库有多个 skill 时，默认弹出选择器让你挑选
npx skills add HLH2023/terminal-use-mcp

# 只安装核心 skill（推荐大多数用户）
npx skills add HLH2023/terminal-use-mcp -s terminal-use -s terminal-use-setup

# 安装特定的代理 TUI skill
npx skills add HLH2023/terminal-use-mcp -s tui-claude-code

# 安装全部 skill（核心 + 所有代理 TUI skill）
npx skills add HLH2023/terminal-use-mcp --all

# 全局安装（跨项目可用）
npx skills add HLH2023/terminal-use-mcp -s terminal-use -s terminal-use-setup -g

# 更新已安装的 skill 到最新版本
npx skills update
```

> **提示**：只安装你需要的 TUI skill。对于普通终端自动化（lazygit、vim、htop、REPL），两个核心 skill 足够了。

### 手动安装

从 [GitHub](https://github.com/HLH2023/terminal-use-mcp/tree/main/skills) 下载 SKILL.md 文件，放到代理的 skill 目录：

| Skill | 是否必需 | 安装 |
|------|----------|------|
| `terminal-use` | **是**（核心操作） | 将 `skills/terminal-use/` 复制到项目的 skill 目录 |
| `terminal-use-setup` | **是**（核心配置） | 将 `skills/terminal-use-setup/` 复制到项目的 skill 目录 |
| `tui-claude-code` | 如需远程控制 Claude Code | 复制 `skills/tui-claude-code/` |
| `tui-codex-cli` | 如需远程控制 Codex CLI | 复制 `skills/tui-codex-cli/` |
| `tui-opencode-native` | 如需远程控制 OpenCode | 复制 `skills/tui-opencode-native/` |
| `tui-opencode-omo` | 如需远程控制 OmO 版 OpenCode | 复制 `skills/tui-opencode-omo/` |

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
| `ssh-pty` | 远程主机上的 TUI 程序 | 复用本地 xterm/快照/transcript 栈 |
| `ssh-tmux` | 持久远程会话、断连恢复、人类可 attach | 完整远程 tmux 生命周期管理 |

自动选择：本地 → native-pty（fallback tmux）；远程 → ssh-pty（fallback ssh-tmux）。

### Provider 配置

通过 `TERMINAL_USE_PROVIDERS` 环境变量控制启用的 provider（逗号分隔白名单）。未设置则全部启用。

```json
{
  "env": {
    "TERMINAL_USE_PROVIDERS": "native-pty,tmux"
  }
}
```

| 值 | 效果 |
|------|------|
| _(未设置)_ | 全部 provider 启用 |
| `native-pty,tmux` | 仅本地 — 不含 SSH provider |
| `tmux` | 仅 tmux — 适用于没有 node-pty 的环境 |
| `ssh-pty,ssh-tmux` | 仅远程 — 不含本地终端 provider |

禁用的 provider 不参与注册和自动选择。`terminal.health` 会将它们报告为 `"disabled by TERMINAL_USE_PROVIDERS config"`。

### 环境变量

#### 核心配置

| 变量 | 用途 | 默认值 |
|------|------|--------|
| `TERMINAL_USE_PROVIDERS` | 启用 provider 白名单（逗号分隔） | 全部 provider |
| `TERMINAL_USE_DEFAULT_PROVIDER` | 默认 provider（覆盖自动选择优先级） | `native-pty` |
| `TERMINAL_USE_TMUX_PATH` | tmux 二进制的绝对或相对路径（当 tmux 不在 PATH 上时） | `tmux` |
| `TERMINAL_USE_WORKSPACE_ROOT` | CWD 策略根目录 | 当前工作目录 |
| `TERMINAL_USE_ALLOWED_CWD` | 允许的工作目录（逗号分隔） | _(空；工作区根目录始终通过 TERMINAL_USE_WORKSPACE_ROOT 允许)_ |
| `TERMINAL_USE_CWD_POLICY_MODE` | 本地 `terminal.start` 的 CWD 策略。`"guarded"` 允许 workspaceRoot/allowedCwdRoots，拒绝已知危险目录，其他目录默认允许。`"strict"` 仅允许 workspaceRoot/allowedCwdRoots 下的目录。 | `guarded` |
| `TERMINAL_USE_ALLOW_COMMANDS` | 允许的命令，即使在内置黑名单中（逗号分隔，覆盖黑名单） | _(空)_ |
| `TERMINAL_USE_DENY_COMMANDS` | 在内置黑名单之外额外拒绝的命令（逗号分隔） | _(空)_ |
| `TERMINAL_USE_RISKY_COMMAND_MODE` | 黑名单命令处理方式：`deny`、`ask` 或 `allow` | `deny` |

#### 会话与行为

| 变量 | 用途 | 默认值 |
|------|------|--------|
| `TERMINAL_USE_SESSION_TTL_MS` | 会话自动清理超时（毫秒） | `3600000`（1 小时） |
| `TERMINAL_USE_CLEANUP_INTERVAL_MS` | 检查过期会话的间隔（毫秒） | `60000`（1 分钟） |
| `TERMINAL_USE_DEFAULT_COLS` | 新会话默认终端列数 | `120` |
| `TERMINAL_USE_DEFAULT_ROWS` | 新会话默认终端行数 | `30` |
| `TERMINAL_USE_LARGE_PASTE_LIMIT` | 需要确认的粘贴大小阈值（字符数） | `2000` |
| `TERMINAL_USE_HARD_PASTE_LIMIT` | 硬性粘贴大小上限 — 超过此大小一律拒绝（字符数） | `10000` |
| `TERMINAL_USE_LOG_LEVEL` | 日志详细度：`debug`、`info`、`warn`、`error` | `info` |
| `TERMINAL_USE_HOSTS_CONFIG` | SSH 主机配置文件路径 | XDG 配置目录 / hosts.json（profiles/*.json 优先） |
| `TERMINAL_USE_ALLOW_INLINE_SSH_TARGETS` | 设为 `1` 允许在工具调用中内联指定 SSH 主机 | _(未设置 — 禁止)_ |
| `TERMINAL_USE_STORE_RAW_TRANSCRIPT` | 设为 `1` 同时保存原始（未脱敏）transcript 文件 | _(未设置 — 仅保存脱敏版)_ |

#### 路径覆盖

| 变量 | 用途 | 默认值 |
|------|------|--------|
| `TERMINAL_USE_ARTIFACT_DIR` | 覆盖 artifact/transcript 输出目录 | `<数据目录>/artifacts` |
| `TERMINAL_USE_CONFIG_DIR` | 覆盖 XDG 配置目录 | 见下方 XDG/平台默认值 |
| `TERMINAL_USE_CONFIG_FILE` | 覆盖 config.json 文件路径 | `<配置目录>/config.json` |
| `TERMINAL_USE_DATA_DIR` | 覆盖 XDG 数据目录（artifact、session 数据） | 见下方 XDG/平台默认值 |

#### XDG / 平台路径

| 变量 | 用途 | 平台 |
|------|------|------|
| `XDG_CONFIG_HOME` | XDG 配置主目录 — 应用追加 `terminal-use-mcp/` | Linux, macOS |
| `XDG_DATA_HOME` | XDG 数据主目录 — 应用追加 `terminal-use-mcp/` | Linux, macOS |
| `XDG_RUNTIME_DIR` | XDG 运行时目录（用于 SSH agent socket 发现） | Linux |
| `APPDATA` | Windows 漫游应用数据 — 应用追加 `terminal-use-mcp/` | Windows |
| `LOCALAPPDATA` | Windows 本地应用数据 — 应用追加 `terminal-use-mcp/` | Windows |
| `ComSpec` | Windows 命令解释器路径（native-pty shell 包装使用） | Windows |

#### SSH 认证

| 变量 | 用途 |
|------|------|
| `SSH_AUTH_SOCK` | SSH agent socket 路径（未设置时自动发现；见 ssh-auth.ts 发现链） |
| `SSH_PROXY_JUMP` | SSH ProxyJump 配置（传递给 SSH 连接） |

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

### 远程控制（3 个工具）

| 工具 | 用途 |
|------|------|
| `terminal.targets` | 列出可用目标（本地 + SSH） |
| `terminal.target_info` | 查询目标详情（脱敏） |
| `terminal.verify_target` | 验证 SSH 目标本地前置条件 |

### tmux 管理（2 个工具）

| 工具 | 用途 |
|------|------|
| `terminal.tmux_list` | 列出本地或远程 tmux 会话 |
| `terminal.tmux_kill` | 按名称终止 tmux 会话 |

## 安全概览

terminal-use-mcp 不是沙箱。安全策略限制入口，不限制 TUI 程序内部行为。

- **命令白名单 + 黑名单**：内置黑名单阻止危险启动命令（`sudo`、`rm`、`ssh`、`curl` 等）。`TERMINAL_USE_ALLOW_COMMANDS` 白名单可覆盖黑名单（白名单优先）。`TERMINAL_USE_DENY_COMMANDS` 扩展黑名单。`TERMINAL_USE_RISKY_COMMAND_MODE` 控制黑名单命令处理方式：`deny`（默认，阻止）、`ask`（返回确认提示）、`allow`（允许所有）
- **CWD 策略**：控制 `terminal.start` 可使用的工作目录。`TERMINAL_USE_WORKSPACE_ROOT` 和 `TERMINAL_USE_ALLOWED_CWD` 定义白名单。`TERMINAL_USE_CWD_POLICY_MODE` 控制策略模式：`"guarded"`（默认）允许 workspaceRoot/allowedCwdRoots，拒绝已知危险目录（`/`、`/root`、`/etc` 等），其他目录默认允许；`"strict"` 仅允许 workspaceRoot 或 allowedCwdRoots 下的目录——其他一律拒绝。对于 agent/homelab/远程运维场景，建议设置 `TERMINAL_USE_CWD_POLICY_MODE=strict`，使 cwd 成为真正的白名单。
- **密钥脱敏**：自动将 API key、token、私钥替换为 `<REDACTED_*>`
- **确认检测**：屏幕出现危险提示时发出警告
- **Provider 白名单**：`TERMINAL_USE_PROVIDERS` 控制启用的 provider（未设置=全部启用）
- **observationTrust**：所有快照返回 `observationTrust: "untrusted"` — 终端输出是不受信观察，不是指令
- **ReDoS 防护**：用户提供的正则表达式会经过灾难性回溯检测。安装 `re2` 可选依赖后，所有正则执行使用 RE2 引擎（保证线性时间）。未安装 `re2` 时，启发式嵌套量词检测器拦截已知危险模式。

详见 [docs/security.md](https://github.com/HLH2023/terminal-use-mcp/blob/main/docs/security.md)。

## 远程 SSH

远程 SSH 功能让你控制远程主机上的 TUI 程序。两种 SSH 提供者：

| | ssh-pty | ssh-tmux |
|--|---------|----------|
| 适用 | 交互式远程 TUI | 持久远程会话 |
| 高亮 | 支持（完整 xterm） | 不支持 |
| 断连恢复 | 不支持 | 支持 |

SSH 目标定义在 `~/.config/terminal-use-mcp/hosts.json`。禁止密码登录；仅支持 ssh-agent 或密钥文件认证。

详见 [docs/REMOTE_TERMINAL_GUIDE.md](https://github.com/HLH2023/terminal-use-mcp/blob/main/docs/REMOTE_TERMINAL_GUIDE.md)。

## 版本与更新

### 查看当前版本

调用 `terminal.health` —— 响应中包含 `version` 字段，反映当前运行的服务器版本。

### npx 缓存行为

`npx` **不会自动更新**。首次运行时会缓存包，后续使用缓存版本直到过期。确保运行最新版本：

| 目的 | 命令 |
|------|------|
| 运行最新版 | `npx -y terminal-use-mcp@latest` |
| 固定版本 | `npx -y terminal-use-mcp@0.2.0` |
| 强制刷新缓存 | `npx -y terminal-use-mcp@latest`（`@latest` 标签会绕过缓存） |
| 清空 npx 缓存 | `npx clear-npx-cache` |

### Skill 版本机制

terminal-use-mcp 提供两类 skill：

| Skill | 版本头 | 维护方式 |
|-------|--------|---------|
| `terminal-use`（操作） | `terminal-use-mcp vX.Y.Z` — 跟随 MCP 服务器版本 | **随服务器发布维护** |
| `terminal-use-setup`（配置） | `terminal-use-mcp vX.Y.Z` — 跟随 MCP 服务器版本 | **随服务器发布维护** |
| `tui-*`（特定代理） | `Reference: <程序> vX.Y.Z` — 针对特定目标版本验证 | **社区维护** — 不随目标程序发布同步更新 |

如果 TUI 程序更新导致快捷键变化，请自行更新对应 skill 或提交 PR。核心 `terminal-use` 和 `terminal-use-setup` skill 随每次服务器发布更新。

### CWD 策略模式

`TERMINAL_USE_CWD_POLICY_MODE` 控制 `terminal.start` 的工作目录限制：

| 模式 | 行为 |
|------|------|
| `guarded`（默认） | 允许 `workspaceRoot` + `allowedCwd`，阻止已知危险根目录（`/`、`/root`、`/etc` 等），允许其他未被拒绝的目录 |
| `strict` | 仅允许 `workspaceRoot` + `allowedCwd` —— 其他目录一律拒绝 |

生产/代理场景建议设置 `TERMINAL_USE_CWD_POLICY_MODE=strict`，使 CWD 成为真正的白名单。

## 延伸阅读

| 主题 | 文档 |
|------|------|
| 安全策略、环境变量、拒绝列表 | [docs/security.md](https://github.com/HLH2023/terminal-use-mcp/blob/main/docs/security.md) |
| 回滚策略、缓冲模式 | [docs/scrollback.md](https://github.com/HLH2023/terminal-use-mcp/blob/main/docs/scrollback.md) |
| 类型定义、错误码 | [docs/types-and-errors.md](https://github.com/HLH2023/terminal-use-mcp/blob/main/docs/types-and-errors.md) |
| 远程 SSH 设计 | [docs/REMOTE_TERMINAL_GUIDE.md](https://github.com/HLH2023/terminal-use-mcp/blob/main/docs/REMOTE_TERMINAL_GUIDE.md) |
| 远程 SSH 架构 | [docs/REMOTE_SSH_ARCHITECTURE.md](https://github.com/HLH2023/terminal-use-mcp/blob/main/docs/REMOTE_SSH_ARCHITECTURE.md) |
| 控制 Claude Code TUI | [docs/TUI_CLAUDE_CODE.md](https://github.com/HLH2023/terminal-use-mcp/blob/main/docs/TUI_CLAUDE_CODE.md) |
| 控制 Codex CLI TUI | [docs/TUI_CODEX_CLI.md](https://github.com/HLH2023/terminal-use-mcp/blob/main/docs/TUI_CODEX_CLI.md) |
| 控制 OpenCode TUI | [docs/TUI_OPENCODE_NATIVE.md](https://github.com/HLH2023/terminal-use-mcp/blob/main/docs/TUI_OPENCODE_NATIVE.md) |
| 控制 OpenCode + OmO | [docs/TUI_OPENCODE_OMO.md](https://github.com/HLH2023/terminal-use-mcp/blob/main/docs/TUI_OPENCODE_OMO.md) |

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
| re2（可选） | BSD-3-Clause |

## 参与贡献

欢迎贡献！以下是快速开始指南：

### 分支策略

| 分支 | 用途 | 推送权限 |
|------|------|----------|
| `main` | 仅稳定发布 | 需要 PR（强制） |
| `dev` | 日常开发 | 外部贡献者需 PR；维护者可直接推送 |

### 开发流程

1. **Fork** 本仓库
2. 从 `dev` **创建功能分支**: `git checkout -b feature/your-feature dev`
3. **修改代码**并确保所有测试通过:
   ```bash
   npm run typecheck   # tsc --noEmit — 零错误
   npm test            # 全部测试必须通过
   npm run build       # 必须成功
   ```
4. **提交**使用 [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat: 添加新 provider
   fix: 修正滚动行为
   docs: 更新 SSH 指南
   ```
5. **推送**分支并向 `dev` **发起 Pull Request**
6. **处理审查反馈**，等待批准后合并

### 报告问题

- **Bug 报告**: [提交 Issue](https://github.com/HLH2023/terminal-use-mcp/issues/new?template=bug_report.md)，附上复现步骤、期望与实际行为、环境信息
- **功能请求**: [提交 Issue](https://github.com/HLH2023/terminal-use-mcp/issues/new?template=feature_request.md)，附上使用场景和提议的 API
- **安全漏洞**: 请私下报告 — 详见 [SECURITY.md](SECURITY.md)

### 代码风格

- TypeScript 严格模式 — 禁止 `any`，禁止 `@ts-ignore`
- ESM（`"type": "module"`）
- 所有公共 API 必须有 JSDoc 注释
- 新功能需要测试覆盖（vitest）

### 添加 Skill

Skill 是 `skills/` 目录下的 Markdown 文件，包含 YAML frontmatter（`name` + `description`）。添加新 Skill 的步骤：

1. 创建 `skills/<skill-name>/SKILL.md`，包含 frontmatter
2. 使用 `npx skills add HLH2023/terminal-use-mcp -s <skill-name> --dry-run` 本地测试
3. 向 `dev` 分支提交 PR

## 许可证

MIT
