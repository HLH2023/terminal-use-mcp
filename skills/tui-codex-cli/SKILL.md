# tui-codex-cli: Control Codex CLI TUI

> This skill is useful when one AI agent needs to remotely control a Codex CLI TUI session via terminal-use-mcp.

> **This skill is optional.** Only install if you need to control this agent's TUI via terminal-use-mcp. You can freely trim or remove sections you don't need — every section is self-contained.

通过 terminal-use-mcp 控制 OpenAI Codex CLI TUI 的操作技能。包含快捷键、slash 命令、权限模式和交互流程。

## 何时使用

- 需要通过 terminal-use-mcp 启动并交互控制 OpenAI Codex CLI TUI
- 需要在 Codex CLI 内切换权限模式、执行斜杠命令
- 需要读取 Codex CLI 对话内容、查看 diff、审批操作
- 需要通过 Codex CLI 执行 shell 命令

## 核心操作流程

### 启动与就绪检测

```
1. terminal.start(command="codex", cwd="~/project")
2. terminal.wait_stable(idleMs=5000, timeoutMs=20000)
3. terminal.find("codex|What|Ask")  # 确认 UI 就绪
```

### 发送消息

```
terminal.type("你的问题")
terminal.press("enter")
terminal.wait_stable(idleMs=15000, timeoutMs=120000)
```

### 退出

```
terminal.press("ctrl+c")            # 退出
```

## 核心快捷键

| 按键 | 功能 | 说明 |
|------|------|------|
| `enter` | 提交消息 | 发送当前输入 |
| `tab` | 补全/排队 | 命令自动补全；任务运行时排队下一轮 |
| `escape` | 回退编辑 | 空输入框时回退编辑上一条消息 |
| `ctrl+c` | 退出 | 在 composer 中退出；在 pager 中关闭 |
| `ctrl+o` | 复制最新响应 | 复制最近完成的 agent 输出 |
| `ctrl+v` | 粘贴图片 | 粘贴剪贴板中的图片 |
| `ctrl+l` | 清屏 | 清除终端显示 |
| `ctrl+t` | 打开 transcript | 查看对话历史 |
| `ctrl+g` | 外部编辑器 | 编辑当前草稿 |
| `alt+r` | 原样滚动回放 | 切换 raw scrollback 视图 |
| `q` | 关闭 pager | 在 /diff 等视图中退出 |

### 输入框换行

| 按键 | 功能 |
|------|------|
| `ctrl+j` / `ctrl+m` | 插入换行 |
| `shift+enter` | 插入换行 |
| `alt+enter` | 插入换行 |

### Shell 命令执行

输入 `!cmd` 直接运行本地 shell 命令，输出会出现在对话中：

```
terminal.type("!git status")
terminal.press("enter")
```

## Slash 命令速查

输入 `/` 打开命令面板，包含 46+ 命令。核心命令：

| 命令 | 功能 |
|------|------|
| `/model` | 选择模型 / reasoning |
| `/permissions` | 切换权限/审批策略 |
| `/keymap` | 重映射快捷键 |
| `/vim` | 切换 Vim 模式 |
| `/compact` | 压缩对话 |
| `/clear` | 清屏并开新对话 |
| `/new` | 新会话 |
| `/diff` | 显示 git diff（含 untracked） |
| `/review` | 代码审查 |
| `/approve` | 重试最近被 auto-review 拒绝的动作 |
| `/rename` | 重命名 thread |
| `/resume` | 恢复保存的会话 |
| `/fork` | 分叉当前会话 |
| `/archive` | 归档并退出 |
| `/delete` | 永久删除并退出 |
| `/init` | 生成 AGENTS.md |
| `/ide` | 带入 IDE 上下文 |
| `/experimental` | 实验功能开关 |
| `/memories` | 记忆设置 |
| `/skills` | 技能管理 |
| `/hooks` | 生命周期 hooks |
| `/import` | 导入 Claude Code 配置/历史 |
| `/mcp` | MCP 工具管理 |
| `/app` | 继续到 Codex Desktop |
| `/agent` | 切换 agent thread |
| `/side` | 侧边对话 |
| `/copy` | 复制最后响应 |
| `/raw` | raw scrollback |
| `/mention` | 提及文件 |
| `/status` | 会话状态 |
| `/theme` | 语法主题 |
| `/logout` | 登出 |
| `/exit` | 退出 |
| `/feedback` | 发送反馈 |
| `/ps` | 后台终端列表 |
| `/stop` | 停止后台终端 |
| `/pets` | 终端 pet |
| `/title` | 终端标题项 |
| `/statusline` | 状态栏项 |
| `/rollout` | 打印 rollout 路径 |
| `/subagents` | 切换 agent thread |

## 权限模式

| 模式 | 行为 | 入口 |
|------|------|------|
| Read Only | 只读，不修改文件 | `--sandbox readonly` 或 `/permissions` |
| Workspace | 可编辑工作区文件 | `--sandbox workspace-write` 或 `/permissions` |
| Workspace with network | 工作区 + 网络访问 | `/permissions` |
| Full Access | 完全访问 | `--sandbox full` 或 `/permissions` |

> ⚠️ `--full-auto` 已废弃，建议改用 `--sandbox workspace-write`。

**操作**：`/permissions` 是 TUI 内切换策略的入口。

## 审批弹窗

高风险操作会进入 approval modal：
- `Esc` 在 MCP 询问中**不会**静默继续
- 需要明确选择允许/拒绝

## Diff 视图

`/diff` 显示 git diff，包含 untracked 文件：
- `q`/`ctrl+c` 退出查看
- 支持标准 pager 滚动

## TUI 布局

- 主界面：全屏 TUI，底部 composer + 历史 transcript
- 命令 popup：输入 `/` 打开
- 状态栏：显示当前模式、模型、权限级别

## 读取长对话

Codex CLI 使用 alt buffer，scrollback 为 0。

**推荐方法**：
1. `mouse_scroll(direction="up")` — 鼠标滚轮向上滚动
2. `terminal.press("alt+r")` — 切换 raw scrollback 查看长输出
3. `terminal.press("ctrl+t")` — 打开 transcript 查看完整对话
4. `snapshot()` — 读取当前可见区
5. `find(pattern, {includeScrollback: true})` — 在 native-pty buffer 中搜索

## 常见操作示例

### 切换权限模式

```
terminal.type("/permissions")
terminal.press("enter")
terminal.wait_stable(idleMs=2000)
terminal.press("down")                    # 选择 Workspace
terminal.press("enter")                   # 确认
```

### 查看 diff

```
terminal.type("/diff")
terminal.press("enter")
terminal.wait_stable(idleMs=3000)
terminal.snapshot()                       # 读取 diff 内容
terminal.press("q")                       # 退出 diff 视图
```

### 执行 shell 命令

```
terminal.type("!git log --oneline -5")
terminal.press("enter")
terminal.wait_stable(idleMs=2000)
terminal.snapshot()
```

### Vim 模式

```
terminal.type("/vim")
terminal.press("enter")
# 现在输入框进入 Vim 编辑模式
# 用 i 进入插入模式，Esc 返回正常模式
```

## 注意事项

1. **Tab 排队**：任务运行中按 Tab 会将输入**排队到下一轮**，而非立即发送
2. **Esc 回退编辑**：空输入框按 Esc 可回退编辑上一条消息
3. **`!` 前缀**：直接执行 shell 命令，输出出现在对话中
4. **`--full-auto` 已废弃**：使用 `--sandbox workspace-write` 代替
5. **Vim 模式**：`/vim` 后输入框进入 Vim 风格编辑，需要 Vim 操作知识
6. **Ink TUI**：使用 alt buffer，`mode: "full"` 也只返回当前可见区
7. **版本**：当前最新稳定版 `0.139.0`，预发布 `0.140.0-alpha.14`

> For the base terminal control skill, see [terminal-use](../terminal-use/SKILL.md).
