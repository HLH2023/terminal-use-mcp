# tui-opencode-omo

通过 terminal-use-mcp 控制 OpenCode + Oh My OpenAgent 插件 TUI 的操作技能。在原生 OpenCode 操作基础上，增加 OmO 专属的 Tab/Prometheus、ultrawork 循环、团队模式等能力。

## 何时使用

- 需要通过 terminal-use-mcp 控制**安装了 Oh My OpenAgent 插件的 OpenCode** TUI
- 需要使用 Prometheus 计划模式、ultrawork 循环、团队模式
- 需要触发 OmO 专属的斜杠命令或关键词模式
- 原生 OpenCode 操作参见 `tui-opencode-native` 技能

## 与原生 OpenCode 的关系

本技能**叠加**在 `tui-opencode-native` 之上。所有原生快捷键（Ctrl+K、Ctrl+S、Ctrl+O 等）依然适用。
本技能只记录 OmO **新增或修改**的交互。

## 核心差异

### Tab 键 → Prometheus 模式

OmO 将 `Tab` 键映射为进入 Prometheus 计划模式的入口：

```
terminal.press("tab")              # 进入 Prometheus 模式
terminal.type("你的计划需求")       # 输入计划描述
terminal.press("enter")            # 提交给 Prometheus
```

**注意**：原生 OpenCode 的 Tab 用于切换代理（Build/Plan），OmO 的 Tab 在非编辑状态下进入 Prometheus。

### 自然语言关键词（非斜杠命令）

以下关键词直接在聊天输入中生效，不需要 `/` 前缀：

| 关键词 | 功能 |
|--------|------|
| `ultrawork` 或 `ulw` | 进入 ultrawork 深度工作模式 |
| `search` | 触发搜索 |
| `analyze` | 触发分析 |
| `team` | 触发团队模式 |
| `hyperplan` | 触发超规划 |
| `hyperplan ultrawork` | 超规划 + 深度工作组合 |

## OmO 专属斜杠命令

| 命令 | 功能 |
|------|------|
| `/init-deep` | 初始化 AGENTS.md 知识库 |
| `/start-work` | 从 Prometheus 计划开始工作 |
| `/ralph-loop` | 启动自指开发循环 |
| `/ulw-loop` | 启动 ultrawork 循环 |
| `/cancel-ralph` | 取消活跃的 Ralph 循环 |
| `/stop-continuation` | 停止所有延续机制 |
| `/refactor` | 智能重构命令 |
| `/handoff` | 创建上下文接力提示词 |
| `/remove-ai-slops` | 移除 AI 代码坏味道 |
| `/hyperplan` | 对抗性多智能体规划 |

## 团队模式（Team Mode）

启用后新增功能：
- `team_*` 工具簇（12 个团队协作工具）
- tmux 可视化窗口显示每个成员输出
- 子代理并行执行

**操作**：在聊天中输入 `team` 关键词或使用 `/start-work` 后选择团队模式。

## 运行时注入的 MCP

以下 MCP 由插件运行时注入，`opencode mcp list` 看不到：
- `websearch` / `exa` — 网页搜索
- `context7` — 文档查询
- `grep_app` — GitHub 代码搜索

需用 `doctor --verbose` 查看。

## 完整操作流程示例

### Prometheus 计划 → ultrawork 执行

```
# 1. 启动 OpenCode
terminal.start(command="opencode", cwd="~/project")
terminal.wait_stable(idleMs=5000, timeoutMs=15000)

# 2. 进入 Prometheus 模式
terminal.press("tab")                    # Tab 进入 Prometheus
terminal.type("实现用户认证模块")
terminal.press("enter")                  # 提交
terminal.wait_stable(idleMs=15000, timeoutMs=60000)  # 等待计划

# 3. 审查并确认计划后，开始 ultrawork
terminal.type("ultrawork")
terminal.press("enter")
terminal.wait_stable(idleMs=30000, timeoutMs=120000)

# 4. 读取结果
terminal.snapshot(mode="viewport")
terminal.find("完成", {includeScrollback: true})

# 5. 退出
terminal.press("ctrl+c")
```

### 使用 ralph-loop 自主循环

```
terminal.press("ctrl+k")                 # 命令面板
terminal.type("ralph-loop")               # 输入命令
terminal.press("enter")                  # 执行
terminal.wait_stable(idleMs=30000, timeoutMs=180000)  # 等待循环完成

# 完成后查看结果
terminal.find("完成", {includeScrollback: true})
```

## 注意事项

1. **Tab 键行为变化**：OmO 中 Tab 用于 Prometheus 模式，不再仅用于代理切换
2. **命令面板仍然可用**：Ctrl+K 仍然打开原生命令面板，OmO 命令也会出现在其中
3. **团队模式需要 tmux**：Team Mode 的多窗口可视化依赖 tmux
4. **运行时 MCP 不可见**：插件注入的 MCP 在 `opencode mcp list` 中不显示，要用 `doctor --verbose`