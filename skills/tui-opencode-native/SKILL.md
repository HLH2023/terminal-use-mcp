# tui-opencode-native: Control OpenCode TUI

> For OmO plugin version, use the `tui-opencode-omo` skill instead.

> **This skill is optional.** Only install if you need to control this agent's TUI via terminal-use-mcp. You can freely trim or remove sections you don't need — every section is self-contained.

通过 terminal-use-mcp 控制 OpenCode TUI 原生版本的操作技能。包含按键映射、斜杠命令、交互流程和注意事项。

## 何时使用

- 需要通过 terminal-use-mcp 启动并交互控制 OpenCode TUI
- 需要在 OpenCode 内执行 slash 命令、切换模型/会话/代理
- 需要读取 OpenCode 对话内容、搜索历史消息
- 需要在 OpenCode 内切换权限模式或执行特定操作

## 核心操作流程

### 启动与就绪检测

```
1. terminal.start(command="opencode", cwd="~/project")
2. terminal.wait_stable(idleMs=5000, timeoutMs=15000)
3. terminal.find("Ask|Sisyphus|Welcome")  # 确认 UI 渲染完成
```

### 发送消息

```
terminal.type("你的问题")
terminal.press("enter")
terminal.wait_stable(idleMs=15000, timeoutMs=120000)
```

### 退出

```
terminal.press("ctrl+c")  # 退出
```

## 全局快捷键（源码验证，非 README）

> ⚠️ README 文档与源码有出入：README 写 Ctrl+A 切会话、Ctrl+X 取消、i 聚焦编辑器；
> 源码实际是 Ctrl+S 切会话、Esc 取消、i 仅在文件选择器中用于手动路径输入。
> 以下以源码为准。

| 按键 | 功能 | 说明 |
|------|------|------|
| `ctrl+c` | 退出 | 两次强制退出 |
| `ctrl+l` | 日志页 | 打开日志查看器 |
| `ctrl+s` | 会话切换 | ⚠️ 注意：与编辑器发送键冲突，全局层优先截获 |
| `ctrl+k` | 命令对话框 | 打开命令选择 |
| `ctrl+o` | 模型选择 | 切换模型/provider |
| `ctrl+f` | 文件选择器 | 选择文件 |
| `ctrl+t` | 主题切换 | 切换主题 |
| `ctrl+?` / `ctrl+h` / `ctrl+_` | 帮助面板 | 显示按键总览 |
| `escape` | 关闭当前 overlay | 返回上一层 |

## 聊天/编辑器快捷键

| 按键 | 功能 |
|------|------|
| `ctrl+n` | 新建/清空当前会话 |
| `escape` | 中断当前生成/取消 |
| `enter` | 发送消息 |
| `ctrl+s` | 发送消息（⚠️ 与全局会话切换冲突，不建议使用） |
| `ctrl+e` | 打开外部编辑器 |
| `@` | 打开补全弹窗 |
| `ctrl+r` | 进入附件删除模式 |

### 附件删除模式

| 按键 | 功能 |
|------|------|
| `r` | 删除全部附件 |
| `0`-`9` | 删除对应编号附件 |
| `escape` | 退出删除模式 |

## 会话/模型/主题对话框

| 对话框 | 导航 | 选择 | 关闭 |
|--------|------|------|------|
| 会话切换 | `↑`/`↓` 或 `j`/`k` | `enter` | `escape` |
| 模型切换 | `↑`/`↓` 或 `j`/`k` | `enter` | `escape` |
| Provider 切换 | `←`/`→` 或 `h`/`l` | `enter` | `escape` |
| 主题切换 | `↑`/`↓` 或 `j`/`k` | `enter` | `escape` |

## 权限弹窗

| 按键 | 功能 |
|------|------|
| `←`/`→` 或 `tab` | 切换选项 |
| `enter`/`space` | 确认 |
| `a` | 允许 |
| `s` | 允许本次会话 |
| `d` | 拒绝 |

## 退出确认弹窗

| 按键 | 功能 |
|------|------|
| `←`/`→` 或 `tab` | 切换 Yes/No |
| `enter`/`space` | 确认 |
| `y`/`Y` | 是 |
| `n`/`N` | 否 |

## 命令系统

OpenCode **没有** `/session`、`/help` 等 TUI slash 命令。命令入口是 `Ctrl+K` 打开的命令对话框。

内置命令仅两个：
- `init` — 初始化项目
- `compact` — 压缩当前会话

自定义命令来源：
- `$XDG_CONFIG_HOME/opencode/commands`
- `$HOME/.opencode/commands`
- `<data>/commands`

命令 ID 格式：`user:*` / `project:*`

带 `$NAME` 占位符的命令会先弹出多参数对话框，再执行。

## 消息滚动

| 按键 | 功能 |
|------|------|
| `pageup`/`pagedown` | 翻页 |
| `ctrl+u`/`ctrl+d` | 半页滚动 |

## 读取长对话

OpenCode 使用 Ink TUI（alt buffer），scrollback 为 0。

**推荐方法**：
1. `mouse_scroll(direction="up")` — 鼠标滚轮向上滚动对话历史
2. `snapshot()` — 读取当前可见区
3. `find(pattern, {includeScrollback: true})` — 在完整的 xterm buffer 搜索（native-pty 支持）
4. `mouse_scroll(direction="down")` — 滚回底部继续提问

**注意**：native-pty provider 的 `find` 可搜索完整 scrollback；tmux provider 的 `find` 搜索 capture-pane 获取的内容。

## 帮助面板

`Ctrl+?` 打开的帮助面板会聚合以下按键：
- 全局按键
- 当前页按键
- 当前 overlay 按键
- 日志页返回键

这是 TUI 里最终可见的快捷键总览。

## 常见操作示例

### 切换模型

```
terminal.press("ctrl+o")           # 打开模型选择
terminal.press("down")             # 下移
terminal.type("sonnet")            # 过滤
terminal.press("enter")            # 选择
```

### 切换会话

```
terminal.press("ctrl+s")           # 打开会话切换
terminal.press("j")                # 下移
terminal.press("enter")            # 选择
```

### 执行命令

```
terminal.press("ctrl+k")           # 打开命令对话框
terminal.type("compact")           # 输入命令
terminal.press("enter")            # 执行
```

> For the base terminal control skill, see [terminal-use](../terminal-use/SKILL.md).
