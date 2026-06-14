# tui-claude-code: Control Claude Code TUI

> This skill is useful when one AI agent needs to remotely control a Claude Code TUI session via terminal-use-mcp.

> **This skill is optional.** Only install if you need to control this agent's TUI via terminal-use-mcp. You can freely trim or remove sections you don't need — every section is self-contained.

通过 terminal-use-mcp 控制 Claude Code TUI 的操作技能。包含完整按键映射、slash 命令、权限模式和交互流程。

## 何时使用

- 需要通过 terminal-use-mcp 启动并交互控制 Claude Code TUI
- 需要在 Claude Code 内切换权限模式、执行斜杠命令
- 需要读取 Claude Code 对话内容、搜索历史消息
- 需要使用 transcript viewer、侧问、后台任务等高级功能

## 核心操作流程

### 启动与就绪检测

```
1. terminal.start(command="claude", cwd="~/project")
2. terminal.wait_stable(idleMs=5000, timeoutMs=15000)
3. terminal.find("claude|Hi|What")  # 确认 UI 就绪
```

### 发送消息

```
terminal.type("你的问题")
terminal.press("enter")
terminal.wait_stable(idleMs=15000, timeoutMs=120000)  # 等待模型回复
```

### 中断与退出

```
terminal.press("escape")           # 中断当前响应/工具调用
terminal.press("ctrl+c")           # 中断输入；第二次退出
terminal.press("ctrl+d")          # 退出
```

## 全局快捷键

| 按键 | 功能 | 说明 |
|------|------|------|
| `ctrl+c` | 中断/清空输入 | 第一次清输入，第二次退出 |
| `escape` | 中断当前响应/工具调用 | 停止正在进行的生成 |
| `escape`+`escape` | 清空草稿/打开 rewind | 空输入时双击 Esc 开启 rewind |
| `ctrl+d` | 退出 | 直接退出 |
| `ctrl+l` | 重绘屏幕 | 刷新终端显示 |
| `ctrl+o` | Transcript viewer | 查看/浏览完整对话记录 |
| `ctrl+r` | 历史搜索 | 搜索之前的命令 |
| `ctrl+b` | 后台运行任务 | 将当前任务转后台 |
| `ctrl+t` | 任务列表 | 查看后台任务 |
| `shift+tab` | 切换权限模式 | 在 default → acceptEdits → plan 间循环 |
| `alt+p` / `option+p` | 切换模型 | 打开模型选择 |
| `alt+t` / `option+t` | 切换 extended thinking | 开关深度思考 |
| `alt+o` / `option+o` | 切换 fast mode | 快速模式 |
| `ctrl+g` / `ctrl+x`+`ctrl+e` | 外部编辑器 | 用外部编辑器编辑消息 |
| `ctrl+j` | 插入换行 | 在输入框中换行 |
| `ctrl+v` / `cmd+v` / `alt+v` | 粘贴图片 | 粘贴剪贴板中的图片 |
| `↑`/`↓` 或 `ctrl+p`/`ctrl+n` | 光标移动/历史 | 上下移动或浏览历史消息 |

## 权限模式

| 模式 | 行为 | 入口 |
|------|------|------|
| `default` | 只读 | 默认 / `shift+tab` 循环 |
| `acceptEdits` | 允许常规编辑和常见文件操作 | `shift+tab` 循环 |
| `plan` | 只研究、不改文件 | `shift+tab` 循环 |
| `auto` | 自动执行，带安全分类器 | 需满足条件后加入循环 |
| `dontAsk` | 仅预批准工具 | 需满足条件后加入循环 |
| `bypassPermissions` | 跳过检查（仅隔离环境） | 需满足条件后加入循环 |

**操作**：`shift+tab` 默认在 `default → acceptEdits → plan` 间循环。

## Transcript Viewer

| 按键 | 功能 |
|------|------|
| `?` | 帮助 |
| `{`/`}` | 跳转上/下一个用户消息 |
| `ctrl+e` | 显示全部 |
| `[` | 导出到终端滚动区 |
| `v` | 写临时文件 |
| `q`/`ctrl+c`/`escape` | 退出 |

## /btw 侧问

| 按键 | 功能 |
|------|------|
| `space`/`enter`/`escape` | 关闭侧问 |
| `up`/`down` | 滚动内容 |
| `c` | 复制 |
| `f` | 分叉到新会话 |
| `x` | 清除历史侧问 |

## Slash 命令速查

| 命令 | 功能 |
|------|------|
| `/help` | 显示帮助 |
| `/compact` | 压缩上下文 |
| `/clear` | 开启新对话 |
| `/model` | 切换模型（无参数打开选择器） |
| `/plan` | 进入 plan 模式 |
| `/fast` | 切换 fast mode |
| `/config` | 打开设置 |
| `/keybindings` | 打开快捷键配置 |
| `/terminal-setup` | 配置终端换行/Meta 键/tmux |
| `/context` | 查看上下文占用 |
| `/resume` | 回到旧会话 |
| `/branch` / `/fork` | 分叉会话/子代理 |
| `/agents` | 管理 subagents |
| `/background` / `/bg` | 转后台会话 |
| `/tasks` | 查看后台任务 |
| `/diff` | 查看差异 |
| `/doctor` | 诊断 |
| `/debug` | 调试 |
| `/btw` | 侧问 |
| `/goal` | 追踪目标 |
| `/cd` | 移动工作目录 |
| `/plugin` | 插件管理 |
| `/workflows` | 工作流 |
| `/usage` | 用量统计 |
| `/desktop` | 桌面模式 |
| `/remote-control` | 远程控制 |
| `/teleport` | 传送 |
| `/voice` | 语音 |
| `/theme` | 主题 |

## 读取长对话

Claude Code 使用 Ink TUI（alt buffer），scrollback 为 0。

**推荐方法**：
1. `terminal.press("ctrl+o")` — 打开 Transcript viewer 查看完整对话
2. `mouse_scroll(direction="up")` — 鼠标滚轮向上滚动对话
3. `snapshot()` — 读取当前可见区
4. `find(pattern, {includeScrollback: true})` — 在 native-pty buffer 中搜索

## 常见操作示例

### 切换权限模式

```
terminal.press("shift+tab")                             # 切换模式
terminal.wait_stable(idleMs=1000)
terminal.snapshot()                                      # 确认当前模式
terminal.find("acceptEdits|plan|default")               # 验证模式名称
```

### 查看差异

```
terminal.type("/diff")
terminal.press("enter")
terminal.wait_stable(idleMs=3000)
terminal.snapshot()
```

### 后台任务

```
terminal.press("ctrl+b")                # 将当前任务转后台
terminal.press("ctrl+t")                # 查看后台任务列表
terminal.type("/tasks")
terminal.press("enter")
```

### 侧问功能

```
terminal.type("/btw")
terminal.press("enter")
terminal.wait_stable(idleMs=3000)
terminal.type("你的侧问问题")          # 在侧问中输入
terminal.press("enter")
```

## 注意事项

1. **Esc 双击**：快速双击 Esc 可能触发 rewind — 空输入时注意
2. **权限模式循环**：`shift+tab` 只在 `default → acceptEdits → plan` 间循环；`auto`/`bypassPermissions` 需满足条件
3. **外部编辑器**：`ctrl+g` 依赖 `$EDITOR` 或 `$VISUAL` 环境变量
4. **图片粘贴**：`ctrl+v` 需要剪贴板中有图片数据
5. **Ink TUI**：使用 alt buffer，`mode: "full"` 也只返回当前可见区

> For the base terminal control skill, see [terminal-use](../terminal-use/SKILL.md).
