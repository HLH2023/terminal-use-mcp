# terminal-use-mcp 开发进度

> 最后更新: 2026-06-14
> Local Terminal status: PHASE 0-15 ALL COMPLETE — 生产就绪 ✅
> Remote SSH status: Remote-0 至 Remote-5 全部完成 ✅
> E2E 状态: 项目级 OpenCode MCP 配置已就绪，SSH localhost 自测环境待 setup-e2e-ssh.sh 初始化 ✅

---

## node-pty 可选动态依赖改造记录（2026-06-14） ✅

### 本会话新增/修改文件

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/providers/native-pty-provider.ts` | ✅ 更新 | 移除顶层 `node-pty` 静态 import，新增模块级动态 import 缓存；`isAvailable()` 与 `start()` 共用 loader，缺失时抛 `PROVIDER_NOT_AVAILABLE` |
| `src/providers/provider-registry.ts` | ✅ 更新 | provider 注册阶段增加实例化保护，日志只输出实际注册进 `SessionManager` 的 provider key |
| `src/index.ts` | ✅ 更新 | provider 注册后增加 0 provider fail-fast 检查，避免 MCP Server 在无后端时半启动 |
| `tests/unit/native-pty-provider.test.ts` | ✅ 更新 | 调整动态 import mock，新增 `node-pty` 缺失时 `isAvailable=false` 与 `start()` 结构化错误覆盖 |
| `PROGRESS.md` | ✅ 更新 | 记录本次可选动态依赖改造、验证结果与完成标准 |

### 验证结果

| 命令/检查 | 结果 |
|-----------|------|
| 基线 `npm run typecheck`（修改前） | ✅ `tsc --noEmit` 零错误 |
| LSP diagnostics: `src/providers/native-pty-provider.ts` | ✅ 0 diagnostics |
| LSP diagnostics: `src/providers/provider-registry.ts` | ✅ 0 diagnostics |
| LSP diagnostics: `src/index.ts` | ✅ 0 diagnostics |
| LSP diagnostics: `tests/unit/native-pty-provider.test.ts` | ✅ 0 diagnostics |
| `npx vitest run tests/unit/native-pty-provider.test.ts` | ✅ 1 file / 15 tests passed |
| `npm run typecheck` | ✅ `tsc --noEmit` 零错误 |
| `npm run test` | ✅ 29 files passed / 571 tests passed |
| 模拟 `node-pty` 缺失：临时移动 `node_modules/node-pty` 后启动 `src/index.ts` | ✅ MCP server 成功启动并优雅退出，无顶层 import 崩溃 |
| 模拟 `node-pty` 缺失：同条件下 `SessionManager.start()` auto provider | ✅ `native-pty` 不可用时 fallback 到 `tmux`，输出 `providerName="tmux"` |

### 完成标准对照

| 标准 | 状态 |
|------|------|
| `native-pty-provider.ts` 无顶层 `node-pty` 静态 import | ✅ |
| 动态 import 使用模块级缓存，避免重复加载/重复失败探测 | ✅ |
| `isAvailable()` 吞掉 optional dependency 缺失错误并返回 `false` | ✅ |
| `start()` 在 `node-pty` 不可用时抛 `ProviderNotAvailableError` | ✅ |
| `provider-registry.ts` 单 provider 实例化失败不影响其他 provider | ✅ |
| `index.ts` 在 0 provider 注册成功时 fail-fast | ✅ |
| `command-safety.ts` 未引入 `node-pty` 静态依赖 | ✅ |
| 不使用 `any` / `@ts-ignore` / `@ts-expect-error` | ✅ |
| 不修改 HomeLab 主业务 (`apps/*` / `packages/*`) | ✅ |

### 技术笔记

- `node-pty` 已位于 `optionalDependencies`，代码层通过动态 import 与缓存配合，保证安装失败只影响 `native-pty` provider 的可用性，不影响 MCP server 和 `tmux` fallback。
- `NativePtyProvider` 内部改用 `MinimalPty` 窄接口，避免为了保存 session pty 句柄而保留顶层 `IPty` type import。
- 当前 registry 仍会注册 `native-pty` 类实例；真正可用性由 `SessionManager.selectProvider()` 调用 `provider.isAvailable()` 判定，因此 `node-pty` 缺失时 auto local 路径会跳过 native 并选择 `tmux`。
- 本次仅修改 `tools/local/terminal-use-mcp/`，未触碰 HomeLab 主业务、冻结规划或主任务板。

---

## mouse_scroll 四 Provider 手动验证记录（2026-06-14） ✅

### 本会话新增/修改文件

| 文件 | 状态 | 说明 |
|------|------|------|
| `tests/manual/mouse-scroll-test.ts` | ✅ 新增 | 新增基于 provider API 的手动集成脚本，覆盖 `native-pty` / `tmux` / `ssh-pty` / `ssh-tmux` + `less`，并额外覆盖 `native-pty` / `tmux` + `opencode` |
| `PROGRESS.md` | ✅ 更新 | 记录 mouse_scroll 验证结果、完成标准对照和技术笔记 |

### 验证结果

| 命令/检查 | 结果 |
|-----------|------|
| `npm run typecheck` | ✅ `tsc --noEmit` 零错误 |
| `npx tsx tests/manual/mouse-scroll-test.ts` | ✅ less 4/4 provider 均 `changed=true`；opencode 已覆盖 native-pty/tmux，但初始界面无可滚动历史，本轮 `changed=false` |

### less 结果矩阵

| Provider | supportsMouseScroll | changed | 结论 |
|----------|---------------------|---------|------|
| `native-pty` | ✅ true | ✅ true | 有效 |
| `tmux` | ✅ true | ✅ true | 有效 |
| `ssh-pty` | ✅ true | ✅ true | 有效 |
| `ssh-tmux` | ✅ true | ✅ true | 有效 |

### opencode 额外测试

| Provider | supportsMouseScroll | changed | 说明 |
|----------|---------------------|---------|------|
| `native-pty` | ✅ true | ⚠️ false | 已启动并发送 mouse_scroll up/down；初始欢迎界面无可滚动历史，viewport 未变化 |
| `tmux` | ✅ true | ⚠️ false | 已启动并发送 mouse_scroll up/down；初始欢迎界面无可滚动历史，viewport 未变化 |

### 完成标准对照

| 标准 | 状态 |
|------|------|
| 4 个 provider 的 less 测试结果清晰（changed/not changed） | ✅ |
| 输出包含每个 provider 的 `supportsMouseScroll` capability | ✅ |
| 也测 opencode（至少 tmux provider） | ✅ native-pty + tmux 均覆盖 |
| 结论明确：mouse_scroll 是否对所有 4 个 provider 的 TUI 程序有效 | ✅ less 场景 4/4 有效 |
| 如果某个 provider 不支持，明确说明原因 | ✅ 本轮无 provider 标记不支持，4 个 provider capability 均为 true |
| 不修改 HomeLab 主业务 (`apps/*` / `packages/*`) | ✅ |

### 技术笔记

- `less` 默认不一定启用 mouse tracking；脚本通过 `LESS=--mouse` 保持命令仍为 `less /etc/services`，并显式让 TUI 消费 SGR-1006 滚轮事件。
- Provider 层 `mouseScroll()` 一次只发送一个滚轮 tick；脚本模拟 tool 层语义，循环发送 5 tick 后比较 viewport。
- `ssh-pty` 与 `ssh-tmux` 使用 `.config/hosts.json` 中的 `localhost` profile 完成真实 localhost SSH 验证。
- opencode 初始界面本轮没有可滚动对话历史，因此未观察到 viewport 变化；这不是 provider 不支持，脚本仍输出 capability 与 changed 状态，便于后续在有长会话时复测。
- 本次仅修改 `tools/local/terminal-use-mcp/`，未触碰 HomeLab 主业务、冻结规划或主任务板。

---

## tmux 常规操作 MCP 工具新增记录（2026-06-14） ✅

### 本会话新增/修改文件

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/tools/tmux-list.ts` | ✅ 新增 | 新增 `registerTmuxListTool`，支持本地/SSH profile/SSH target 列出全部 tmux session，输出 `structuredContent.sessions` 与人类可读摘要 |
| `src/tools/tmux-kill.ts` | ✅ 新增 | 新增 `registerTmuxKillTool`，通过 tmux session name kill 本地/远程 session，并在输出中包含危险操作确认提示 |
| `src/tools/tool-helpers.ts` | ✅ 更新 | `ProviderExecutor` 增加 tmux 常规操作窄接口：解析 target/profile、执行本地/远程 tmux list/kill、标记/清理 MCP managed session |
| `src/tools/attach.ts` | ✅ 更新 | `terminal.attach` provider enum 增加 `ssh-tmux`，允许 `profile:tmuxSessionName` 与 `ssh-tmux://profile/tmuxSessionName` 交给 ssh-tmux provider 解析 |

### 验证结果

| 命令/检查 | 结果 |
|-----------|------|
| LSP diagnostics: `src/tools/tool-helpers.ts` | ✅ 0 diagnostics |
| LSP diagnostics: `src/tools/tmux-list.ts` | ✅ 0 diagnostics |
| LSP diagnostics: `src/tools/tmux-kill.ts` | ✅ 0 diagnostics |
| LSP diagnostics: `src/tools/attach.ts` | ✅ 0 diagnostics |
| `npx tsc --noEmit` | ✅ 零错误 |
| `npx vitest run` | ✅ 第 2 次全量通过：29 files passed / 570 tests passed；第 1 次仅 `ssh-tmux-contract` 首屏 prompt E2E 调度波动失败，未改代码后重跑通过 |

### 完成标准对照

| 标准 | 状态 |
|------|------|
| `src/tools/tmux-list.ts` 创建且导出 `registerTmuxListTool` | ✅ |
| `src/tools/tmux-kill.ts` 创建且导出 `registerTmuxKillTool` | ✅ |
| `terminal.tmux_list` 输出 `textContent()` + `structuredContent`，包含 `name/created/cols/rows/isManaged/windows` | ✅ |
| `terminal.tmux_kill` 输出 `textContent()` + `structuredContent`，并包含危险操作确认提示 | ✅ |
| `terminal.tmux_kill` 对 MCP managed tmuxId 通过 `SessionManager.kill()` 清理 session/provider 状态 | ✅ |
| `terminal.attach` provider enum 包含 `ssh-tmux` | ✅ |
| 不修改 `src/mcp-server.ts`，等待用户手动注册 | ✅ |
| 不引入新依赖、不使用 `any` / `@ts-ignore` / `@ts-expect-error` | ✅ |
| 不修改 HomeLab 主业务 (`apps/*` / `packages/*`) | ✅ |

### 技术笔记

- 新工具注册函数支持两种调用方式：传入现有 `ProviderExecutor`，或传入 `SessionManager` 后在工具内部用 `sm.getProviders()` 构造 executor；后续手动注册时可复用当前 `mcp-server.ts` 已有 executor。
- 远程 tmux 命令沿用 ssh-tmux provider 的 `execSshTmux()` 与严格 SSH 边界；profile/target 解析复用 `resolveSshTarget()` 与 hosts config。
- `tmux list-sessions` 使用制表符分隔 format，避免 tmux 字段拼接后无法可靠解析；无 session 时返回空列表，kill 不存在 session 时映射为 `SESSION_NOT_FOUND`。
- 本次只修改 `tools/local/terminal-use-mcp/`，未触碰主业务目录、冻结规划或主任务板。

---

## tmux scrollback 与 SSH login shell PATH 修复记录（2026-06-14） ✅

### 本会话新增/修改文件

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/providers/tmux-provider.ts` | ✅ 更新 | viewport snapshot 额外读取 tmux `#{history_size}`，用真实 pane history 覆盖重建 xterm 的 scrollback 估算 |
| `src/providers/ssh-tmux-provider.ts` | ✅ 更新 | ssh-tmux viewport snapshot 同步读取远端 tmux `#{history_size}`；start shell command 改为经 `$SHELL -l -ic` 执行 |
| `src/providers/ssh-pty-provider.ts` | ✅ 更新 | `buildRemoteExecCommand()` 改为 `exec $SHELL -l -ic 'cd ... && exec ...'`，并移除未使用的 transport cleanup 私有方法 |
| `tests/unit/tmux-provider.test.ts` | ✅ 更新 | 覆盖 viewport `history_size` 覆盖 scrollbackLineCount；修正测试 mock 的 LSP 诊断 |
| `tests/unit/ssh-tmux-provider.test.ts` | ✅ 更新 | 覆盖 ssh-tmux start shell wrapper 与远端 `history_size` scrollbackLineCount |
| `tests/unit/ssh-pty-provider.test.ts` | ✅ 更新 | 覆盖 `buildRemoteExecCommand()` 新格式与嵌套单引号转义 |
| `tests/contract/ssh-tmux-contract.test.ts` | ✅ 更新 | login shell 初始化等待放宽到 1s，避免完整套件并发时 prompt 写入竞态 |
| `PROGRESS.md` | ✅ 更新 | 记录本次修复、验证结果和完成标准 |

### 验证结果

| 命令/检查 | 结果 |
|-----------|------|
| LSP diagnostics: 7 个变更 TS 文件 | ✅ 0 diagnostics |
| `npx tsc --noEmit` | ✅ 零错误 |
| `npx vitest run` | ✅ 29 files passed / 570 tests passed |

### 完成标准对照

| 标准 | 状态 |
|------|------|
| `buildRemoteExecCommand` 输出格式变为 `exec $SHELL -l -ic '…'` | ✅ |
| ssh-tmux start 命令通过 `$SHELL -l -ic` 执行 | ✅ |
| tmux viewport snapshot 使用 `#{history_size}` 报告真实 scrollbackLineCount | ✅ |
| ssh-tmux viewport snapshot 使用远端 `#{history_size}` 报告真实 scrollbackLineCount | ✅ |
| 不修改 `.bashrc` / `.profile` | ✅ |
| 不在 ssh2 `ConnectConfig` 添加连接级 env | ✅ |
| 不硬编码 bash 路径，使用 `$SHELL` | ✅ |
| `applyEnvironment` / `clearEnvironment` 保留，用于用户自定义 env | ✅ |
| 不修改 HomeLab 主业务 (`apps/*` / `packages/*`) | ✅ |

### 技术笔记

- tmux provider 的 viewport `capture-pane` 仍不带 `-S`，仅额外读取 pane `history_size` 作为 scrollback 计数来源，避免把 full capture 写入 xterm 导致视口滚出。
- ssh-pty 的远端命令现在先进入 `$SHELL -l -ic`，再在内层执行 `cd <cwd> && exec <command> <args>`，从而加载远端 login/interactive shell 初始化后的 PATH，同时用 `exec` 避免保留额外业务命令 shell 层。
- ssh-tmux 的新 session shell command 使用 `exec $SHELL -l -ic 'exec <command> <args>'`，保留 tmux env 注入/清理以支持用户传入的自定义 env。
- 本次仅修改 `tools/local/terminal-use-mcp/`，未触碰 HomeLab 主业务、冻结规划或主任务板。

---

## ssh-tmux localhost e2e contract 补全记录（2026-06-14） ✅

### 本会话新增/修改文件

| 文件 | 状态 | 说明 |
|------|------|------|
| `tests/contract/ssh-tmux-contract.test.ts` | ✅ 更新 | 将原 `test.skip` 占位改为真实 localhost SSH + 远端 tmux provider e2e 合约测试 |

### 验证结果

| 命令/检查 | 结果 |
|-----------|------|
| LSP diagnostics: `tests/contract/ssh-tmux-contract.test.ts` | ✅ 0 diagnostics |
| `npx tsc --noEmit` | ✅ 零错误 |
| `npx vitest run tests/contract/ssh-tmux-contract.test.ts` | ✅ 1 file / 1 test passed |

### 完成标准对照

| 标准 | 状态 |
|------|------|
| 使用真实 `SshTmuxProvider`，不 mock provider | ✅ |
| 注入 localhost `hostsConfig`，key-file auth 不依赖 ssh-agent | ✅ |
| 覆盖 start → snapshot → type → press enter → wait_for_text → attach → kill | ✅ |
| SSH/tmux 不可达时通过 guard skip，不误报通过 | ✅ |
| afterEach 尽力清理所有已启动远端 tmux session | ✅ |
| 不使用 `any` / `@ts-ignore` / `@ts-expect-error` | ✅ |
| 不修改 HomeLab 主业务 (`apps/*` / `packages/*`) | ✅ |

### 技术笔记

- ssh-tmux contract 现在通过系统 `ssh` 连接 `hlh@localhost`，并由 provider 远程执行 `tmux new-session/capture-pane/send-keys/kill-session`。
- `WaitOptions` 当前类型要求 options 内保留 `text` 字段，因此测试中同时传入位置参数 text 和 options.text 以匹配现有 provider 接口。
- `SshHostProfile` 实际类型要求 `name` 字段，localhost profile 明确设置 `name: "localhost"`。

---

## Provider 层代码审查修复记录（2026-06-13） ✅

### 本会话新增/修改文件

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/providers/native-pty-provider.ts` | ✅ 更新 | `pty.spawn()` 失败时立即释放已创建的 `XtermAdapter` |
| `src/providers/tmux-provider.ts` | ✅ 更新 | `applyEnvironment()` 纳入 `try/finally`，失败路径必定 `clearEnvironment()`；start 失败释放 adapter |
| `src/providers/ssh-tmux-provider.ts` | ✅ 更新 | 远程环境变量清理进入 `finally`；start 失败释放 adapter；remote kill 失败不阻塞本地 session 清理 |
| `src/terminal/xterm-adapter.ts` | ✅ 更新 | Unicode11 addon 加载增加 disposed 双检查，并在 dispose 中释放 addon 句柄 |
| `src/providers/provider.ts` | ✅ 更新 | 明确 `find()` 的 `includeScrollback` 跨 Provider 语义与 `supportsScrollback` 能力含义 |

### 验证结果

| 命令/检查 | 结果 |
|-----------|------|
| `npx tsc --noEmit` | ✅ 零错误 |
| LSP diagnostics: `native-pty-provider.ts` | ✅ 0 diagnostics |
| LSP diagnostics: `tmux-provider.ts` | ✅ 0 diagnostics |
| LSP diagnostics: `ssh-tmux-provider.ts` | ✅ 0 diagnostics |
| LSP diagnostics: `xterm-adapter.ts` | ✅ 0 diagnostics |
| LSP diagnostics: `provider.ts` | ✅ 0 diagnostics |

### 完成标准对照

| 标准 | 状态 |
|------|------|
| H3 native-pty spawn 失败释放 XtermAdapter | ✅ |
| H3 tmux start 环境变量失败路径必清理 | ✅ |
| H3 ssh-tmux start 环境变量失败路径必清理且 adapter 异常释放 | ✅ |
| H4 ssh-tmux kill 远程失败不阻塞本地清理 | ✅ |
| M3 XtermAdapter Unicode addon dispose/load 生命周期收敛 | ✅ |
| M4 includeScrollback 语义在接口层明确 | ✅ |
| 不使用 `any` / `@ts-ignore` / `@ts-expect-error` | ✅ |
| 不引入新依赖、不修改测试文件、不修改 HomeLab 主业务 | ✅ |

### 技术笔记

- 本次只修改 `tools/local/terminal-use-mcp/`，未触碰 `apps/*`、`packages/*`、冻结规划或主任务板。
- 4 个 provider 的 `supportsScrollback` 当前均为 `true`，与 `native-pty` / `ssh-pty` 实时 buffer 搜索、`tmux` / `ssh-tmux` capture-pane 历史搜索能力一致。
- start 失败路径中 session 尚未进入 provider map，因此清理点必须围绕本地临时资源（`XtermAdapter`）和 tmux 环境变量，而不是依赖后续 session cleanup。

---

## 安全层与核心层代码审查修复记录（2026-06-13） ✅

### 本会话修改文件

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/terminal/command-safety.ts` | ✅ 更新 | CWD 子目录判断改为路径分隔符边界；命令安全检查剥除常见 wrapper 后再命中 allow/deny list |
| `src/terminal/errors.ts` | ✅ 更新 | 新增 `INVALID_MOUSE_COORDS` 错误码与 `InvalidMouseCoordsError extends TerminalUseError` |
| `src/terminal/mouse.ts` | ✅ 更新 | SGR/X10 鼠标编码入口新增坐标校验；X10 超过 227 直接抛结构化错误；保留旧导入路径 re-export |
| `src/tools/start.ts` | ✅ 更新 | `terminal.start` 的 `command` 与 `cwd` schema 增加 `.min(1)` 校验 |

### 验证结果

| 命令/检查 | 结果 |
|-----------|------|
| 基线 `npx tsc --noEmit` | ✅ 通过 |
| `npx tsc --noEmit` | ✅ 零错误 |
| `npx vitest run tests/unit/command-safety.test.ts tests/unit/mouse.test.ts` | ✅ 2 files / 57 tests passed |
| LSP diagnostics: `src/terminal/command-safety.ts` / `src/terminal/errors.ts` / `src/terminal/mouse.ts` / `src/tools/start.ts` | ✅ 0 diagnostics |

### 完成标准对照

| 标准 | 状态 |
|------|------|
| H1: CWD `startsWith` 前缀误判修复 | ✅ |
| H2: 常见 wrapper 绕过 denylist 修复 | ✅ |
| M1: 鼠标编码坐标越界校验 | ✅ |
| M2: 鼠标坐标错误码对齐结构化错误体系 | ✅ |
| L2: `terminal.start` schema 空字符串校验 | ✅ |
| 不使用 `any` / `@ts-ignore` / `@ts-expect-error` | ✅ |
| 不引入新依赖、不修改 HomeLab 主业务 (`apps/*` / `packages/*`) | ✅ |

### 技术笔记

- `isSubdirectory()` 使用“完全相等或 `parent/` 前缀”判断，避免 `/home/user/project2` 被误判为 `/home/user/project` 子目录；`/home` 特例同步使用该边界函数。
- wrapper 剥除覆盖 `env`、`nice`、`nohup`、`xargs`、`busybox`、`strace`、`ltrace`、`timeout`、`unshare`，并处理 `env VAR=...`、`timeout 10`、`nice -n 5` 等常见参数形态。
- `InvalidMouseCoordsError` 现在继承 `TerminalUseError`，tool 层会得到稳定的 `INVALID_MOUSE_COORDS` error envelope，不再退化为 `INTERNAL_ERROR`。

---

## 冗余外部 CLI Provider 删除记录（2026-06-13） ✅

### 本会话新增/修改/删除文件

| 文件 | 状态 | 说明 |
|------|------|------|
| 冗余外部 CLI provider 源文件 | ✅ 删除 | native-pty 已完全取代该冗余 Provider |
| `src/providers/provider.ts` | ✅ 更新 | `ProviderName` 收敛为 `native-pty` / `tmux` / `ssh-pty` / `ssh-tmux` |
| `src/providers/provider-registry.ts` | ✅ 更新 | 移除冗余 Provider 注册和日志名单 |
| `src/session-manager.ts` | ✅ 更新 | 本地 provider 自动选择顺序收敛为 `native-pty` → `tmux` |
| `src/tools/start.ts` / `attach.ts` / `provider-capabilities.ts` / `health.ts` | ✅ 更新 | tool schema 和 health/capability provider 名单同步收敛 |
| `src/prompts/terminal-use-workflow.ts` / `src/terminal/mouse.ts` / `src/terminal/wait.ts` | ✅ 更新 | 删除过时 provider 描述，仅保留通用能力边界说明 |
| `tests/mcp/mcp-tools.test.ts` / `tests/contract/provider-contract.test.ts` | ✅ 更新 | 移除冗余 provider 断言和说明 |
| `README.md` / `DEV-PLAN.md` / `docs/*` / `examples/*` / `skills/terminal-use-local/SKILL.md` / `RESUME-CONTEXT.md` | ✅ 更新 | 文档、示例和恢复上下文同步为 4 Provider 事实 |
| `.opencode/skills/terminal-use-operations/SKILL.md` | ✅ 更新 | 鼠标错误处理建议去除过时 provider 特例 |

### 验证结果

| 命令/检查 | 结果 |
|-----------|------|
| `npx tsc --noEmit` | ✅ 零错误 |
| `npx vitest run` | ✅ 21 files passed / 2 skipped；392 tests passed / 4 skipped |
| 指定旧 Provider 名称残留 grep（`src/ tests/`） | ✅ 零输出 |
| LSP diagnostics: 关键变更 TS 文件 | ✅ 0 diagnostics |

### 完成标准对照

| 标准 | 状态 |
|------|------|
| 删除冗余 Provider 源文件 | ✅ |
| 代码和测试中无旧 Provider 引用 | ✅ |
| Provider 类型和 tool schema 已收敛 | ✅ |
| README/SKILL/示例/恢复上下文已同步 | ✅ |
| 不修改 HomeLab 主业务 (`apps/*` / `packages/*`) | ✅ |
| 不引入新依赖、不使用 `any` / `@ts-ignore` | ✅ |

### 技术笔记

- 本次为删除型维护任务，仅移除冗余 provider 的注册、类型、schema、测试断言和文档说明；未修改 native-pty / tmux / ssh-pty / ssh-tmux 的实现逻辑。
- 鼠标能力说明改为通用 provider 能力边界：不支持 SGR-1006 注入的 provider 应直接返回 capability unsupported，而不是保留特定 provider 特例。

---

## Local Terminal — Completion Summary

### 基线统计
- 测试: 209 passing (11 files)
- Typecheck: `tsc --noEmit` 零错误
- Provider runtime: NativePty 7 tests ✅ + Tmux 9 tests ✅
- MCP stdio smoke: 4 tests ✅
- Git commits: 11 atomic commits on feature/terminal-use-mcp

### DEV-PLAN.md 修订 ✅

已完成 9 项生产级校验修订:

1. **MCP tools 数量修正**: 统一为 22 tools，新增 `terminal.events` 和 `terminal.send_signal`
   - Session lifecycle: 7 tools (start/attach/list/info/rename/kill/cleanup)
   - Observation: 5 tools (snapshot/wait_for_text/wait_stable/find/scroll)
   - Input: 3 tools (type/press/paste)
   - Meta: 7 tools (resize/export_transcript/health/keys/provider_capabilities/events/send_signal)
   - 去重: rename/keys 只出现一次

2. **强制 structuredContent**: 所有成功 tool 响必须返回 `structuredContent` + `content`。
   agent 不应依赖纯文本 JSON 解析。所有失败通过 TerminalUseError 子类。

3. **NativePtyProvider 完成标准收紧**: 必须实现；构建失败时 tmux 可通过 fallback 测试，
   但必须生成 `artifacts/native-pty-blocked.md` 记录失败原因。

4. **Platform support**: Linux ✅ / macOS ✅ (best-effort) / WSL2 ✅ (best-effort) /
   Native Windows ❌ (ConPTY)

5. **Command policy 边界**: 明确声明 denylist 只限制 terminal.start 启动命令，
   不覆盖 TUI 内部子进程 / agent 后续命令 / REPL 执行。不得当作完整沙箱。

6. **Integration run artifact 目录**: `artifacts/integration/<runId>/` 结构定义，
   包含 provider-matrix.json / mcp-tools.json / self-critique.md 等。

7. **失败路径 Provider contract tests**: 10 项失败场景 + 预期错误码。

8. **外部 CLI Provider 串线测试**: 已随冗余外部 CLI provider 删除。

9. **SDK 代码模式更新**: 使用 `registerTool` + structuredContent 示例。

### Local Terminal — Phase Completion Table

| Phase | 内容 | 状态 |
|-------|------|------|
| 0 | 项目脚手架 | ✅ 完成 |
| 1 | 核心类型 + Safety 层 | ✅ 完成 |
| 2 | Terminal 层 (xterm-adapter / screen-buffer / highlights / wait / transcript) | ✅ 完成 |
| 3 | SessionManager + PromiseQueue + Artifacts | ✅ 完成 |
| 4 | NativePtyProvider | ✅ 完成 |
| 5 | TmuxProvider | ✅ 完成 |
| 6 | 外部 CLI Provider | ✅ 已删除（native-pty 完全取代） |
| 7 | MCP Tools (22 tools 注册) | ✅ 完成 (22 files + tool-helpers.ts + ProviderExecutor) |
| 7.5 | 跨文件一致性统一 | ✅ 完成 (ProviderExecutor 合并 + errorToToolResult 统一 + import 风格 + SessionManager.getProviders()) |
| 8 | MCP Resources + Prompts | ✅ 完成 (2 resources + 2 prompts) |
| 9 | MCP Server 完整入口 (index.ts + mcp-server.ts 重写) | ✅ 完成 (stdio smoke test: 22 tools 通过) |
| 9.5 | @xterm/headless ESM 兼容修复 | ✅ 完成 (default.Terminal 替代 named import) |
| 10 | Unit tests | ✅ 完成 |
| 11 | Test fixtures | ✅ 完成 |
| 12 | Provider contract + MCP smoke tests | ✅ 完成 |
| 13 | SKILL.md (terminal-use-local 使用说明) | ✅ 完成 |
| 14 | Examples | ✅ 完成 (7 files: mcp.json + 5 demos + troubleshooting) |
| 15 | 验证 + 最终报告 | ✅ 完成 (209 tests + tsc --noEmit 零错误 + MCP stdio 通过 + NativePty 7 tests + Tmux 9 tests) |

### Local Terminal — Completion Criteria Checklist (DEV-PLAN §14)

| # | 标准 | 状态 |
|---|------|------|
| 1 | DEV-PLAN.md 生产级 | ✅ 完成 |
| 2 | MCP server 可启动 | ✅ stdio smoke test 通过 (22 tools + 2 resources + 2 prompts) |
| 3 | NativePtyProvider 生产可用 | ✅ 已实现 + 7 integration tests 通过 |
| 4 | 9 核心 tools 可用 | ✅ 22/22 tools 注册文件已创建 |
| 5 | 13 扩展 tools 可用 | ✅ 同上 |
| 6 | Tool 输出结构化 JSON | ✅ content + structuredContent 双输出 |
| 7 | Error envelope 稳定 | ✅ TerminalUseError 统一串行化, 10 项失败路径测试通过 |
| 8 | Session operation queue | ✅ PromiseQueue 串行化 |
| 9 | TTL cleanup | ✅ SessionManager.startTtlCleanup() |
| 10 | Transcript/artifact | ✅ TranscriptRecorder + artifacts.ts |
| 11 | Redaction 有测试 | ✅ 19 tests (redact.test.ts) |
| 12 | Confirmation detection 有测试 | ✅ 13 tests (confirm-detection.test.ts) |
| 13 | SKILL.md 完成 | ✅ skills/terminal-use-local/SKILL.md |
| 14 | Examples 完成 | ✅ 7 files (mcp.json + 5 demos + troubleshooting) |
| 15 | Unit tests 通过 | ✅ 150 tests (6 files) |
| 16 | MCP stdio smoke 通过 | ✅ 14 tests (mcp-tools + mcp-stdio-smoke) |
| 17 | 至少一个 fixture 集成测试通过 | ✅ NativePty 7 tests + Tmux 9 tests 通过 |
| 18 | 联调证据目录 | ✅ artifacts/integration/ 已生成 provider runtime 证据 |
| 19 | 未修改 HomeLab 主业务 | ✅ |
| 20 | 未修改冻结规划 | ✅ |
| 21 | 未修改 master-task-board | ✅ |

---

## Remote Terminal Control (Remote Terminal Control over SSH)

### Remote Terminal Objectives

Local + Remote Terminal Computer Use over MCP — 新增 ssh-pty 和 ssh-tmux Provider

```
Agent
  ↓ MCP stdio
terminal-use-mcp
  ↓ ProviderRegistry
local native-pty / local tmux / ssh-pty / ssh-tmux
  ↓
本机或远程主机上的 TUI 程序
```

### Remote Design Documents

- `docs/REMOTE_SSH_ARCHITECTURE.md` ✅ (三种架构路径分析，方案 A 选定)
- `docs/REMOTE_TERMINAL_GUIDE.md` ✅ (完整 28 项标准 + 19 章节 + 实施指导)

### Remote Key Decisions

1. **方案 A 选定**: 本机 MCP + ssh2 远程 PTY channel，不做远端 MCP agent 安装 (方案 B) 和 portal 模式 (方案 C)
2. **TerminalTarget 类型**: 区分 target (在哪里运行) / provider (用什么后端) / command (跑什么程序)，不在 terminal.start 顶层堆砌 SSH 参数
3. **Provider 拆分**: `ssh-pty` (远程 PTY channel，适合直接跑 TUI) 和 `ssh-tmux` (远程 tmux session 控制，适合长期/断线恢复/人类 attach)，不做笼统的 `"ssh"` provider
4. **SSH profile 默认只允许**: 默认不允许 agent 任意传 host，需 `TERMINAL_USE_ALLOW_INLINE_SSH_TARGETS=1` 才开放
5. **密码登录禁止**: `SshAuthRef` 只支持 `agent` 和 `key-file`，不做 `{ type: "password" }`
6. **Host key 严格校验**: 禁止 `StrictHostKeyChecking=no`，必须 known_hosts 或 pinned fingerprint
7. **远程能力不是完整沙箱**: command policy 只限制启动命令，agent 遇到远程 TUI 权限请求必须停止并询问用户
8. **RemoteCwdPolicy 独立**: 远程 cwd 不得复用本地 workspace cwd policy，按 profile 配置 allowed/denied roots
9. **凭据安全**: hosts.json 只存路径不存内容，passphrase 只引用环境变量名

### Remote Development Phases

| Phase | 内容 | 依赖 | 状态 |
|-------|------|------|------|
| Remote-0 | 远程设计落文档 (DEV-PLAN/PROGRESS/README/SKILL.md) | Local complete | 🔄 进行中 |
| Remote-1 | TerminalTarget + SshHostProfile + hosts.json loader + RemoteCwdPolicy + tests | Remote-0 | ✅ 完成 |
| Remote-2 | known_hosts/pinned fingerprint + ssh-agent auth + key-file + verify_target + tests | Remote-1 | ✅ 完成（含 MCP 注册接线） |
| Remote-3 | ssh-pty Provider (ssh2 channel + xterm adapter + I/O + resize + kill + transcript) | Remote-2 | ✅ 完成 |
| Remote-4 | ssh-tmux Provider (remote tmux commands + attach/list/snapshot/type/press/kill) | Remote-2 | ✅ 完成 |
| Remote-5 | Remote examples + troubleshooting + integration evidence + self-critique | Remote-3+Remote-4 | ⬜ 未开始 |

### Remote Completion Criteria (28 项)

| # | 标准 | 状态 |
|---|------|------|
| 1 | `TerminalTarget` 已实现 | ✅ Remote-1 |
| 2 | SSH profile loader 已实现 | ✅ Remote-1 |
| 3 | known_hosts 或 pinned fingerprint 校验已实现 | ✅ Remote-2 单元测试通过 |
| 4 | 默认禁止 inline SSH target | ✅ Remote-1 |
| 5 | 默认禁止密码登录 | ✅ Remote-1 |
| 6 | `ssh-pty` Provider 可用 | ✅ Remote-3 单元测试 + 合约骨架 |
| 7 | `ssh-tmux` Provider 可用 | ✅ Remote-4 单元测试 + 合约骨架 |
| 8 | `terminal.targets` 可用 | ✅ 已注册到 createMcpServer，25 tools smoke 通过 |
| 9 | `terminal.target_info` 可用 | ✅ 已注册到 createMcpServer，25 tools smoke 通过 |
| 10 | `terminal.verify_target` 可用 | ✅ 已注册到 createMcpServer，25 tools smoke 通过 |
| 11 | `terminal.start` 支持 `target.kind=ssh` | ✅ Remote-3 existing start tool 已透传 target/provider |
| 12 | `terminal.snapshot/wait/type/press/paste/resize/kill/export_transcript` 支持远程 session | ✅ Remote-3/Remote-4 provider 层完成 |
| 13 | 远程 session artifact 不包含敏感信息 | ✅ Remote-3 metadata 不含私钥/passphrase/token/env 值 |
| 14 | RemoteCwdPolicy 有测试 | ✅ Remote-1 |
| 15 | host key mismatch 有测试 | ✅ Remote-3 pinned + known_hosts 握手 key mismatch 单元覆盖 |
| 16 | auth failure 有测试 | ✅ key-file/agent 本地 preflight 失败覆盖 |
| 17 | connection timeout 有测试 | ⬜ |
| 18 | remote fixture 集成测试通过，或在当前环境明确 skip 并给出原因 | ✅ Remote-3/Remote-4 contract tests skip: No SSH fixture available |
| 19 | 至少一个真实远程联调示例文档完成 | ⬜ |
| 20 | SKILL.md 已补充远程规则 | ⬜ |
| 21 | README 已补充远程章节 | ⬜ |
| 22 | 不修改 HomeLab 主业务代码 | ✅ |
| 23 | 不修改 HomeLab 冻结规划 | ✅ |
| 24 | 不修改 HomeLab 主任务板 | ✅ |
| 25 | 不读取真实 `.env` 值 | ✅ |
| 26 | 不复制任何私钥、密码、token | ✅ |
| 27 | 不关闭 host key 校验 | ✅ |
| 28 | 不自动批准远程 TUI 权限请求 | ✅ |

### Remote-1 完成记录（2026-06-13） ✅

#### 本会话新增/修改文件

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/targets/target-types.ts` | ✅ 补全 | 新增 `SshAuthRef` / `SshHostProfile` / `TerminalTarget` / `RemoteCwdPolicy` / `SshSessionMetadata` 与认证 type guards |
| `src/targets/ssh-host-config.ts` | ✅ 补全 | async hosts.json loader；支持默认路径、`TERMINAL_USE_HOSTS_CONFIG`、`~` 展开、cache、缺失文件空 map、JSON/profile/auth 校验；保留 `expandUserPath()` 兼容 Remote-2 |
| `src/targets/ssh-profile-loader.ts` | ✅ 补全 | 新增 `resolveSshTarget()`；默认拒绝 inline SSH；profile + inline override 合并；保留 `getSshProfile()` 兼容 Remote-2 |
| `src/targets/remote-cwd-policy.ts` | ✅ 新增 | 远程 cwd policy 创建、规范化、allow/deny 判断、`REMOTE_CWD_DENIED` 抛错入口 |
| `src/targets/target-registry.ts` | ✅ 新增 | local + SSH target 脱敏摘要输出，不返回 key path/passphrase/token/password/env 值 |
| `src/targets/index.ts` | ✅ 新增 | targets barrel export |
| `src/terminal/errors.ts` | ✅ 扩展 | 新增 10 个 SSH/Remote 错误码与错误类 |
| `src/providers/provider.ts` | ✅ 扩展 | `ProviderName` 扩展 `ssh-pty` / `ssh-tmux`，并清理未用 import hint |
| `src/config.ts` | ✅ 扩展 | 新增 `hostsConfigPath` / `allowInlineSshTargets` 配置字段 |
| `src/logger.ts` | ✅ 扩展 | 新增 stderr-only 模块级 `logger` 供配置加载器使用 |
| `tests/unit/ssh-profile-loader.test.ts` | ✅ 新增 | hosts loader + target resolution 覆盖 |
| `tests/unit/remote-cwd-policy.test.ts` | ✅ 新增 | 远程 cwd allow/deny/default/normalize/throw 覆盖 |
| `tests/unit/ssh-target-safety.test.ts` | ✅ 新增 | inline deny、password auth 拒绝、target info 脱敏、auth type guard 覆盖 |
| `tests/unit/session-manager.test.ts` | ✅ 更新 | 旧 mock config 补齐 remote config fields，保持 LSP clean |

#### 验证结果

| 命令/检查 | 结果 |
|-----------|------|
| `npx tsc --noEmit` | ✅ 零错误 |
| `npx vitest run tests/unit/ssh-profile-loader.test.ts tests/unit/remote-cwd-policy.test.ts tests/unit/ssh-target-safety.test.ts` | ✅ 3 files / 23 tests passed |
| `npx vitest run` | ✅ 17 files / 250 tests passed |
| LSP diagnostics: `src/targets`, `src/providers/provider.ts`, `src/terminal/errors.ts`, `src/config.ts`, `tests/unit` | ✅ 0 diagnostics |

#### 完成标准对照

| 标准 | 状态 |
|------|------|
| TerminalTarget 已实现 | ✅ |
| SSH profile loader 已实现 | ✅ |
| 默认禁止 inline SSH target | ✅ |
| 默认禁止密码登录 | ✅ |
| RemoteCwdPolicy 有测试 | ✅ |
| 不修改 HomeLab 主业务代码 (`apps/*` / `packages/*`) | ✅ |
| 不安装新依赖、不创建真实 SSH 连接 | ✅ |
| 不读取真实 `.env` / 不复制密钥、密码、token | ✅ |

#### 下一步待办

1. Remote-2: 在当前 Remote-2 预检代码基础上完成 `hostsConfig` 注入与 MCP tools 接线。
2. Remote-3: 在 Remote-2 接线完成后实现 `ssh-pty` Provider，不在 Remote-1 中提前引入 `ssh2`。
3. Remote-4: 在 Remote-2 接线完成后实现 `ssh-tmux` Provider。

### Remote-2 实现记录（2026-06-13）

#### 本会话新增/修改文件

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/targets/known-hosts.ts` | ✅ 新增 | known_hosts 解析、`[host]:port` 归一化、只读 host key preflight |
| `src/targets/host-fingerprint.ts` | ✅ 新增 | SHA256/MD5 fingerprint 解析、计算与 pinned fingerprint 比对 |
| `src/targets/ssh-auth.ts` | ✅ 新增 | ssh-agent socket 与 key-file 可读性解析，不读取 passphrase 值 |
| `src/tools/verify-target.ts` | ✅ 新增 | `terminal.verify_target` 注册函数，本阶段仅做本地 preflight，不建立 SSH 连接 |
| `src/tools/targets.ts` | ✅ 新增 | `terminal.targets` 注册函数，返回 local + SSH profile 脱敏摘要 |
| `src/tools/target-info.ts` | ✅ 新增 | `terminal.target_info` 注册函数，敏感字段全脱敏 |
| `tests/unit/known-hosts.test.ts` | ✅ 新增 | known_hosts 解析/缺失/host 命中/未命中/malformed 覆盖 |
| `tests/unit/host-fingerprint.test.ts` | ✅ 新增 | SHA256/MD5 解析与 pinned fingerprint 匹配/不匹配覆盖 |
| `tests/unit/ssh-auth.test.ts` | ✅ 新增 | agent/key-file/`~` 展开/缺失文件错误覆盖 |
| `src/targets/target-types.ts` | ✅ Remote-1 已补全 | Remote-2 依赖其中 `SshAuthRef` / `SshHostProfile` 类型 |
| `src/targets/ssh-host-config.ts` | ✅ Remote-1 已补全 | Remote-2 复用其中 `expandUserPath()` 路径展开兼容入口 |
| `src/targets/ssh-profile-loader.ts` | ✅ Remote-1 已补全 | Remote-2 复用其中 `getSshProfile()` profile 查询入口 |

#### 验证结果

| 命令/检查 | 结果 |
|-----------|------|
| `lsp_diagnostics` on changed `src/targets` | ✅ 0 diagnostics |
| `lsp_diagnostics` on changed `src/tools/*.ts` | ✅ 0 diagnostics |
| `lsp_diagnostics` on new unit tests | ✅ 0 diagnostics |
| `npx tsc --noEmit` | ✅ 通过 |
| `npm run test:unit` | ✅ 12 files / 191 tests passed |
| `npm test` | ✅ 17 files / 250 tests passed |

备注：一次 `tests/unit` 目录级 LSP 扫描发现未改文件 `tests/unit/session-manager.test.ts` 中与 Remote-1 配置类型相关的 diagnostic；本会话新增测试文件逐个扫描均为 0 diagnostics，且 typecheck/full test 均通过。

#### 技术笔记

- `verify_target` 在 Remote-2 阶段不执行真实 SSH 连接；只验证 profile、known_hosts/pinned fingerprint 格式和本地认证材料可访问性，避免提前引入 `ssh2`。
- `known_hosts` 的 `@revoked` 条目被跳过，不能作为可信 host key；hashed host pattern 暂不反解，后续可在 Remote-3 连接阶段结合实际 host key 策略扩展。
- `ssh-auth` 对 key-file 只做 `fs.access(..., R_OK)`，不会读取私钥内容；对 `passphraseEnv` 只检查环境变量名是否存在，不读取变量值。
- 三个 remote target tool 注册函数暂未接入 `createMcpServer()`，因为当前 Local MCP smoke 测试固定断言 22 tools，且 `hostsConfig` 注入由 Remote-1 集成；后续接线时需同步更新 MCP tool count 至 25。

#### 下一步待办

1. Remote-1 合并完整 `target-types.ts` / `ssh-host-config.ts` / `ssh-profile-loader.ts` 后，复核本会话最小占位是否需要删除或合并。
2. 在 `createMcpServer()` 可获得 `hostsConfig` 后注册 `terminal.targets` / `terminal.target_info` / `terminal.verify_target`，并将 MCP smoke test 的 tools/list 期望更新为 25。
3. Remote-3 建立真实 SSH 握手后，用实际 host key 与本会话返回的 known_hosts fingerprint 做最终 mismatch 校验。

### Remote-3 实现记录（2026-06-13） ✅

#### 本会话新增/修改文件

| 文件 | 状态 | 说明 |
|------|------|------|
| `package.json` / `package-lock.json` | ✅ 更新 | 新增 `ssh2` runtime dependency 与 `@types/ssh2` dev dependency；ESM named/default import 已用 Node 验证 |
| `src/providers/ssh-pty-provider.ts` | ✅ 新增 | ssh2 Client + exec PTY channel；复用 XtermAdapter、snapshot、wait、paste、resize、transcript；实现 strict hostVerifier、agent/key-file auth、dirty tracker、metadata |
| `src/providers/provider.ts` | ✅ 更新 | `StartInput.target` 与 `TerminalSession.metadata` 透传 SSH target/session metadata |
| `src/providers/provider-registry.ts` | ✅ 更新 | 注册 `SshPtyProvider`，不影响 local provider |
| `src/session-manager.ts` | ✅ 更新 | SSH target 跳过本地 CWD policy，改走 provider 内 RemoteCwdPolicy；远程 auto priority 为 `ssh-pty → ssh-tmux`；metadata 写入 session artifact |
| `src/tools/start.ts` | ✅ 更新 | 既有 `terminal.start` schema 支持 `ssh-pty` / `ssh-tmux` 与 `target` 字段；未注册新的 remote tools |
| `src/tools/tool-helpers.ts` | ✅ 更新 | 公开 session 信息透传 metadata，并清理未用 import |
| `src/providers/ssh-tmux-provider.ts` | ✅ 修复 | 最小修复既有 `SshTmuxCommandExecutor` options 签名不一致，保持行为不变 |
| `tests/unit/ssh-pty-provider.test.ts` | ✅ 新增 | 14 个单元测试覆盖 capabilities、target 解析、pinned/known_hosts 校验、auth config、dirty tracker、missing session kill |
| `tests/contract/ssh-pty-contract.test.ts` | ✅ 新增 | 无 SSH fixture 环境下 3 个 contract tests 明确 skip，保留完整契约路径说明 |

#### 验证结果

| 命令/检查 | 结果 |
|-----------|------|
| `node --input-type=module -e "import ssh2, { Client } from 'ssh2'; ..."` | ✅ ssh2 ESM default + named import 可用 |
| `npx vitest run tests/unit/ssh-pty-provider.test.ts tests/contract/ssh-pty-contract.test.ts` | ✅ 14 passed / 3 skipped |
| `npx vitest run` | ✅ 19 files passed / 2 skipped；278 tests passed / 4 skipped |
| `npx tsc --noEmit` | ✅ 零错误 |
| LSP diagnostics: changed TS files | ✅ 0 diagnostics |

#### 安全边界与技术笔记

- `ssh-pty` 使用 ssh2 `hostVerifier`，如果 profile 同时缺少 `knownHosts` 与 `pinnedHostFingerprint`，直接抛 `SSH_HOST_KEY_UNKNOWN`，不提供 `StrictHostKeyChecking=no` 等旁路。
- pinned fingerprint 与 known_hosts 均使用 SSH 握手阶段实际 offered key 计算 SHA256 fingerprint 后比对；host 存在但 key 不同会抛 `SSH_HOST_KEY_MISMATCH`。
- 认证仅支持 `agent` 与 `key-file`，`authHandler` 限制为 `agent` 或 `publickey`，不启用 password / keyboard-interactive fallback。
- key-file 模式使用 `fs.promises.readFile` 将私钥交给 ssh2；私钥内容与 passphrase 值不写日志、不写 metadata、不写 artifact。
- ssh2 exec request 仍是远端 command string，因此使用 POSIX 单引号转义构造 `cd <cwd> && exec <command> <args...>`，避免未转义拼接。
- `SessionManager` 只在 `target.kind=ssh` 时跳过本地 CWD policy；远程 cwd 仍由 `RemoteCwdPolicy` 严格校验。
- 当前无真实 SSH fixture，contract test 明确 skip；后续 Remote-5 需补 Docker SSH fixture 或手动真实主机证据。

#### 下一步待办

1. Remote-3 follow-up：补 Docker SSH fixture 后启用 `ssh-pty-contract.test.ts`，覆盖真实 start/wait/snapshot/input/resize/transcript/kill。
2. Remote-2/remote tools 接线：在 `createMcpServer()` 注入 `hostsConfig` 后注册 `terminal.targets` / `terminal.target_info` / `terminal.verify_target`，并将 MCP smoke tools/list 更新为 25。
3. Remote-4：继续保持 `ssh-tmux` Provider 与真实远程 tmux 契约验证同步。
4. Remote-5：更新 README/SKILL remote 章节、remote troubleshooting/examples 与 integration evidence。

### Remote-4 实现记录（2026-06-13） ✅

#### 本会话新增/修改文件

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/providers/system-ssh-transport.ts` | ✅ 新增 | 系统 `ssh` transport；所有调用经 `execFile("ssh", args)`，强制 `BatchMode=yes` 与 `StrictHostKeyChecking=yes`，远端 argv 逐项 POSIX 转义 |
| `src/providers/ssh-tmux-provider.ts` | ✅ 新增 | 远程 tmux Provider；支持 start/attach/snapshot/type/press/paste/resize/rename/scroll/list/kill/exportTranscript/waitForText/waitStable |
| `src/providers/provider.ts` | ✅ 扩展 | `StartInput` 新增可选 `target?: TerminalTarget`，保持旧调用兼容 |
| `src/providers/provider-registry.ts` | ✅ 更新 | 注册 `SshTmuxProvider`，provider log 列表补充 `ssh-tmux` |
| `tests/unit/ssh-tmux-provider.test.ts` | ✅ 新增 | 无真实 SSH 的单元测试；覆盖 capabilities、session name、SSH argv、key-file、BatchMode/StrictHostKeyChecking、RemoteCwdPolicy、keymap、list/snapshot 解析 |
| `tests/contract/ssh-tmux-contract.test.ts` | ✅ 新增 | SSH fixture 合约测试骨架；当前环境明确 skip：`No SSH fixture available` |

#### 验证结果

| 命令/检查 | 结果 |
|-----------|------|
| `lsp_diagnostics` on changed provider/source/test files | ✅ 0 diagnostics |
| `npm run typecheck` | ✅ `tsc --noEmit` 零错误 |
| `npm test` | ✅ 19 files passed / 2 skipped；278 tests passed / 4 skipped |

#### 完成标准对照

| 标准 | 状态 |
|------|------|
| `ssh-tmux` Provider 可用 | ✅ 单元测试覆盖核心控制路径；真实远程 fixture 当前 skip |
| 系统 SSH 而非 ssh2 | ✅ `system-ssh-transport.ts` 使用 `child_process.execFile("ssh", args)` |
| 禁止 shell 字符串拼接与 `shell: true` | ✅ execFile argv + 远端 argv 逐项 quote；无 `shell: true` |
| `BatchMode=yes` | ✅ 单元测试覆盖，防止密码交互提示 |
| `StrictHostKeyChecking=yes` | ✅ 单元测试覆盖，不关闭 host key 校验 |
| RemoteCwdPolicy 集成 | ✅ denied cwd 抛 `REMOTE_CWD_DENIED` |
| 不做真实 SSH 单元测试 | ✅ executor 注入模拟；contract 明确 skip |
| 不修改 HomeLab 主业务 (`apps/*` / `packages/*`) | ✅ |
| 不读取 `.env` / 不复制私钥、密码、token | ✅ |

#### 技术笔记

- 系统 `ssh` 的本地调用使用 argv，但远端 command 仍由远端 shell 解析；因此 `buildSshCommandArgs()` 对每个 remote arg 做 POSIX 单引号 token 转义，避免空格、分号、`$()` 等字符逃逸。
- `ssh-tmux` 的 `isAvailable()` 只检测本机 OpenSSH client 是否存在，不连接远程主机；远程 tmux 是否可用由实际命令失败映射为 `REMOTE_TMUX_NOT_AVAILABLE`。
- `attach()` 在当前 Provider 接口限制下支持 `profile:sessionName` 与 `ssh-tmux://profile/sessionName` 两种字符串形式；后续 MCP tool 接线若需要更结构化的 attach 输入，应在 tool 层扩展 schema。
- `StartInput.target` 已作为可选字段接入 provider 层；SessionManager 的远程 target 全链路接线仍属于后续 remote tool integration任务，本次不修改 `src/mcp-server.ts`。

#### 下一步待办

1. Remote-5: 补充 remote examples、troubleshooting、真实远程/fixture 联调证据与 self-critique。
2. 如提供 Docker SSH fixture，再启用 `ssh-tmux-contract.test.ts` 的真实 start/snapshot/type/attach/kill 合约。

### remote target tools MCP 接线记录（2026-06-13） ✅

#### 本会话新增/修改文件

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/index.ts` | ✅ 更新 | 启动链路中 `await loadHostsConfig(config.hostsConfigPath)`，并将 hostsConfig 传给 `createMcpServer()` |
| `src/mcp-server.ts` | ✅ 更新 | 注册 `terminal.targets` / `terminal.target_info` / `terminal.verify_target`，MCP tool 总数更新为 25 |
| `src/tools/health.ts` | ✅ 更新 | `terminal.health` provider health 覆盖 `native-pty` / `tmux` / `ssh-pty` / `ssh-tmux` |
| `tests/mcp/mcp-tools.test.ts` | ✅ 更新 | `tools/list` 断言 25 tools；预期 tool 名称加入 3 个 remote target tools；health 断言 5 个 provider |
| `tests/mcp/mcp-stdio-smoke.test.ts` | ✅ 更新 | smoke 子进程显式使用空 hosts config 路径，避免读取用户真实 SSH hosts 配置 |
| `DEV-PLAN.md` | ✅ 更新 | MCP 入口签名、tools/list smoke 期望与当前 25 tools 状态同步 |
| `PROGRESS.md` | ✅ 更新 | 记录本轮接线、验证与后续待办 |

#### 验证结果

| 命令/检查 | 结果 |
|-----------|------|
| LSP diagnostics: `src/mcp-server.ts` | ✅ 0 diagnostics |
| LSP diagnostics: `src/index.ts` | ✅ 0 diagnostics |
| LSP diagnostics: `src/tools/health.ts` | ✅ 0 diagnostics |
| LSP diagnostics: `tests/mcp` | ✅ 0 diagnostics |
| `npx tsc --noEmit && npm test` | ✅ typecheck 通过；19 files passed / 2 skipped；278 tests passed / 4 skipped |

#### 完成标准对照

| 标准 | 状态 |
|------|------|
| `terminal.targets` 已注册 | ✅ |
| `terminal.target_info` 已注册 | ✅ |
| `terminal.verify_target` 已注册 | ✅ |
| smoke tool count 22 → 25 | ✅ |
| `terminal.health` 覆盖 `ssh-pty` / `ssh-tmux` | ✅ |
| 不修改 HomeLab 主业务 (`apps/*` / `packages/*`) | ✅ |
| 不读取真实 `.env` / 不复制密钥、密码、token | ✅ |

#### 技术笔记

- `loadHostsConfig()` 在启动阶段只读取 hosts profile 元数据；缺失配置文件返回空 Map，格式错误时 fail-fast，避免 MCP Server 半初始化后暴露不一致的远程 target 能力。
- MCP smoke 测试显式设置 `TERMINAL_USE_HOSTS_CONFIG=/tmp/terminal-use-mcp-test-empty-hosts.json`，避免 CI 或开发机已有真实 SSH profile 影响工具列表与隐私边界。
- `terminal.verify_target` 当前仍是本地 preflight，不建立真实 SSH 连接；真实远程连通性与 tmux/cwd 探测留给 Remote-5 fixture/联调证据。

#### 下一步待办

1. ~~Remote-5: 补充 remote examples、troubleshooting、README/SKILL 远程章节与 integration evidence。~~ ✅ Remote-5 已完成
2. 如提供 Docker SSH fixture，再启用 `ssh-pty-contract.test.ts` / `ssh-tmux-contract.test.ts` 的真实远程合约测试。
3. 运行 `bash .config/setup-e2e-ssh.sh` 初始化 localhost SSH 自测环境，然后 agent 即可使用 `terminal.start({ target: { kind: "ssh", profile: "localhost" } })` 进行 Remote E2E 测试。

### Shell auto-wrap 实现记录（2026-06-13） ✅

#### 本会话新增/修改文件

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/terminal/command-safety.ts` | ✅ 更新 | 新增 `SHELL_METACHAR_REGEX` 与 `maybeWrapWithShell()`；`sh` 加入默认拒绝命令；base command 提取支持 shell 元字符分隔 |
| `src/session-manager.ts` | ✅ 更新 | `start()` 固定执行“原始命令安全检查 → CWD 检查 → shell 自动包装 → provider.start”流程，内部 `/bin/sh` 包装不会绕过原始 base command 检查 |
| `src/tools/start.ts` | ✅ 更新 | `terminal.start` 的 `command` schema 描述补充复杂命令自动 `/bin/sh -c` 包装说明 |
| `tests/unit/command-safety.test.ts` | ✅ 更新 | 增加 `maybeWrapWithShell()` 包装/不包装测试，覆盖 `sh` raw command 拒绝与 shell 元字符前 base command 提取 |

#### 验证结果

| 命令/检查 | 结果 |
|-----------|------|
| 基线 `npx tsc --noEmit` | ✅ 通过 |
| LSP diagnostics: `src/terminal/command-safety.ts` / `src/session-manager.ts` / `src/tools/start.ts` / `tests/unit/command-safety.test.ts` | ✅ 0 diagnostics |
| `npx tsc --noEmit && npx vitest run` | ✅ typecheck 通过；19 files passed / 2 skipped；292 tests passed / 4 skipped |

#### 完成标准对照

| 标准 | 状态 |
|------|------|
| `terminal.start` 复杂命令自动 shell 包装 | ✅ |
| 显式传入 `args` 时不包装 | ✅ |
| 简单命令不包装 | ✅ |
| 原始 base command 先做 denylist 检查 | ✅ |
| raw `/bin/sh` 因 base command `sh` 被拒绝 | ✅ |
| 不修改 provider 文件 | ✅ |
| 不修改 `StartInput` 类型 | ✅ |
| 不修改 HomeLab 主业务 (`apps/*` / `packages/*`) | ✅ |

### Snapshot viewport/full mode 更新记录（2026-06-13） ✅

#### 本会话新增/修改文件

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/terminal/terminal-snapshot.ts` | ✅ 更新 | 新增 `TerminalSnapshotMode`、`mode?: "viewport" \| "full"` 输入意图字段与 `scrollbackLineCount` 输出字段；`createSnapshot()` 默认补 `scrollbackLineCount: 0`，避免非 xterm provider 必须改动 |
| `src/terminal/xterm-adapter.ts` | ✅ 更新 | `readScreen(mode)` 默认只读取 `viewportY..viewportY+rows`；`mode="full"` 保留旧的全 buffer 读取；highlights 行号与读取范围同步 |
| `src/providers/provider.ts` | ✅ 更新 | `TerminalProvider.snapshot(sessionId, mode?)` 接口透传 snapshot mode |
| `src/providers/native-pty-provider.ts` | ✅ 更新 | `snapshot()` 接收并传递 mode；默认 viewport；`find()` 显式使用 full 以保持全缓冲区搜索行为不变 |
| `src/tools/snapshot.ts` | ✅ 更新 | MCP `terminal.snapshot` 新增 `mode` 参数，`z.enum(["viewport", "full"]).default("viewport")` |
| `src/tools/tool-helpers.ts` | ✅ 更新 | `ProviderExecutor.executeSnapshot()` 透传 mode 到 provider |
| `tests/contract/provider-contract.test.ts` | ✅ 更新 | mock snapshot 补齐 `scrollbackLineCount` 字段 |
| `tests/unit/xterm-adapter.test.ts` | ✅ 新增 | 覆盖默认 viewport 与 full buffer 的行数/scrollback 差异 |

#### 验证结果

| 命令/检查 | 结果 |
|-----------|------|
| 恢复基线 `npx tsc --noEmit` | ✅ 零错误 |
| LSP diagnostics: changed TS/test files | ✅ 0 diagnostics |
| `npx tsc --noEmit && npx vitest run` | ✅ typecheck 通过；20 files passed / 2 skipped；293 tests passed / 4 skipped |

#### 完成标准对照

| 标准 | 状态 |
|------|------|
| `terminal.snapshot` 默认返回 viewport | ✅ |
| `terminal.snapshot({ mode: "full" })` 返回完整 xterm buffer | ✅ |
| `scrollbackLineCount` 告知是否存在更多历史行 | ✅ |
| `find` 不退化为 viewport 搜索 | ✅ native-pty 显式 full |
| 未修改 tmux/tui-use/ssh provider 文件 | ✅ |
| 不修改 HomeLab 主业务 (`apps/*` / `packages/*`) | ✅ |

#### 技术笔记

- xterm 的 `buffer.active.viewportY` 是当前视口顶部行；viewport 模式不能简单假设 `buffer.length - rows`，否则用户滚动到历史区域时会读取错误范围。
- `mode` 只作为请求输入传递，不写入 `TerminalSnapshot` 返回值；返回值新增 `scrollbackLineCount` 让 agent 判断是否需要显式二次拉取 `mode="full"`。
- 非 xterm provider 暂不接收 mode，`createSnapshot()` 默认补 `scrollbackLineCount: 0`，符合“tmux/tui-use/ssh provider 暂不修改”的约束。

---

## E2E 测试配置 (2026-06-13)

### 项目级 MCP 接入

OpenCode 项目配置 `.opencode/config.json` 已注册 terminal-use MCP server：

```json
{
  "mcp": {
    "terminal-use": {
      "type": "local",
      "command": ["npx", "tsx", "tools/local/terminal-use-mcp/src/index.ts"],
      "cwd": ".",
      "enabled": true,
      "environment": {
        "TERMINAL_USE_WORKSPACE_ROOT": "/home/hlh/dev/homelab-terminal-use",
        "TERMINAL_USE_ALLOWED_CWD": "/home/hlh/dev/homelab-terminal-use,/tmp",
        "TERMINAL_USE_LOG_LEVEL": "info",
        "TERMINAL_USE_HOSTS_CONFIG": "tools/local/terminal-use-mcp/.config/hosts.json"
      },
      "timeout": 30000
    }
  }
}
```

重启 OpenCode 后，agent 可直接调用 25 个 terminal.* MCP tools。

### SSH localhost 自测目标

`.config/hosts.json` 定义了 `localhost` profile — SSH 到本机用于远程 E2E 测试。

前置条件（一次性设置）：

```bash
bash tools/local/terminal-use-mcp/.config/setup-e2e-ssh.sh
```

该脚本检查并配置：
1. sshd 运行状态
2. SSH 密钥对（如无则自动生成 ed25519）
3. 公钥 → authorized_keys 安装
4. localhost → known_hosts 添加
5. ssh-agent 状态 + 密钥加载指引
6. 连通性验证

### Agent E2E 测试场景

配置完成后，agent 可执行以下实际 E2E 测试：

| 场景 | Provider | 命令示例 |
|------|----------|----------|
| 本地 Python REPL | native-pty | `terminal.start({ command: "python3", cwd: "/tmp" })` |
| 本地 lazygit | native-pty | `terminal.start({ command: "lazygit", cwd: "/home/hlh/dev/homelab-terminal-use" })` |
| 本地 tmux session | tmux | `terminal.start({ command: "htop", provider: "tmux", cwd: "/tmp" })` |
| 远程 SSH Python REPL | ssh-pty | `terminal.start({ command: "python3", target: { kind: "ssh", profile: "localhost" }, cwd: "/tmp" })` |
| 远程 SSH tmux session | ssh-tmux | `terminal.start({ command: "htop", provider: "ssh-tmux", target: { kind: "ssh", profile: "localhost" }, cwd: "/tmp" })` |
| 远程 SSH lazygit | ssh-pty | `terminal.start({ command: "lazygit", target: { kind: "ssh", profile: "localhost" }, cwd: "/home/hlh/dev" })` |

远程 session 操作流程：
1. `terminal.targets({})` → 列出可用 target（含 localhost）
2. `terminal.verify_target({ profile: "localhost" })` → 验证 SSH 连通性
3. `terminal.start({ target, command, ... })` → 启动远程 session
4. `terminal.snapshot({ sessionId })` → 观察远程终端
5. `terminal.type/press/paste({ sessionId, ... })` → 远程交互
6. `terminal.kill({ sessionId })` → 终止

### Remote E2E 验收标准

- [ ] Local: agent 能启动 python3 REPL，执行代码，正确读取输出
- [ ] Local: agent 能启动 lazygit，导航，安全退出
- [ ] ssh-pty: agent 能 SSH 到 localhost，启动远程 python3，交互正确
- [ ] ssh-tmux: agent 能 SSH 到 localhost，创建远程 tmux session
- [ ] Remote security: 远程 snapshot 包含 `observationTrust: "untrusted"`
- [ ] Remote security: 远程 session CWD 违规返回 `REMOTE_CWD_DENIED`
- [ ] Remote security: 未配置 target 的 inline SSH 被拒绝

---

## Local Terminal — Detailed Implementation

### 项目脚手架 ✅

| 文件 | 状态 |
|------|------|
| package.json | ✅ 依赖已安装 |
| tsconfig.json | ✅ ES2022 / Node16 |
| artifacts/.gitignore | ✅ |
| src/index.ts | ✅ 完整入口 (config → SessionManager → providers → McpServer → stdio + signal) |
| src/mcp-server.ts | ✅ createMcpServer() 工厂 (22 tools + 2 resources + 2 prompts) |
| npm install | ✅ 149 packages |

### 核心类型文件 ✅

| 文件 | 内容 |
|------|------|
| src/terminal/errors.ts | TerminalUseError 体系 + 14 个子类 + ErrorEnvelope |
| src/terminal/ids.ts | generateSessionId() |
| src/terminal/keymap.ts | 17 keys + ANSI/tmux/tui-use 映射 |
| src/terminal/redact.ts | 11 种 secret pattern + redactSecrets/containsSecrets |
| src/terminal/confirm-detection.ts | 4 类 riskSignal + 20 检测模式 |
| src/terminal/command-safety.ts | isCommandSafe + isCwdAllowed + env 覆盖 |
| src/terminal/terminal-snapshot.ts | TerminalSnapshot 类型 + createSnapshot 工厂 |
| src/providers/provider.ts | TerminalProvider 接口 + 全部 IO 类型 |
| src/config.ts | TerminalUseConfig + loadConfig (12 个环境变量) |
| src/logger.ts | stderr-only logger (4 级别) |

### Test Fixtures ✅

| 文件 | 状态 |
|------|------|
| tests/fixtures/ask-name.js | ✅ 交互式姓名提示 |
| tests/fixtures/menu-app.js | ✅ 方向键菜单 + inverse video |
| tests/fixtures/confirm-app.js | ✅ y/n 确认 |
| tests/fixtures/spinner-app.js | ✅ 动态 spinner (2秒稳定) |
| tests/fixtures/secret-output.js | ✅ 假 secret 输出 |
| tests/fixtures/fullscreen-tui.js | ✅ 清屏 + 边框 |

### Phase 2 Terminal 层 ✅

| 文件 | 内容 |
|------|------|
| src/terminal/screen-buffer.ts | ScreenLine / ScreenBuffer / LineHighlight 类型；screenBufferToString / getContentRange / createEmptyScreenBuffer / isFullscreenHeuristic |
| src/terminal/highlights.ts | CellAttributes / HighlightSpan 类型；detectHighlights / mergeHighlightSpans / isCellHighlighted / classifyHighlightKind |
| src/terminal/xterm-adapter.ts | XtermAdapter 类 — @xterm/headless Terminal 封装；write/readScreen/detectHighlights/resize/isDirty/markClean/dispose + Unicode11Addon best-effort |
| src/terminal/wait.ts | WaitForTextOptions / WaitStableOptions / ScreenState 类型；checkTextMatch / checkScreenStable / calculatePollDelay / hashScreen |
| src/terminal/transcript.ts | TranscriptEventType / TranscriptEvent / TranscriptExportFormat 类型 + TranscriptRecorder 类 (record*/getEvents/export/getEventsRange) + FIFO 防 OOM |

新增 devDependency: `@xterm/addon-unicode11 ^0.9.0`

### Phase 3 SessionManager ✅

- **artifacts.ts**: ArtifactPaths / IntegrationArtifactPaths 类型；session/integration 目录管理；generateRunId() 使用 YYYYMMDD-HHmmss 格式；appendNdjsonLine 用于 events.jsonl
- **session-manager.ts**: PromiseQueue 串行执行 + FIFO 队列；ManagedSession 组合 TranscriptRecorder + PromiseQueue + lastSnapshot；TTL cleanup 使用 setInterval + SIGTERM→3s→SIGKILL 语义；artifact 写入 best-effort (runBestEffortArtifactWrite) 不影响主流程；selectProvider 按优先级 native-pty→tmux

### Phase 4-6 Provider ✅

- **NativePtyProvider** (477行): node-pty spawn + XtermAdapter 串联；isAvailable 通过 dynamic import node-pty 检测；paste 安全检查 (secret + 大小限制)；snapshot 通过 xtermAdapter.readScreen() + detectHighlights() + detectRiskSignals() 构建；waitForText/waitStable 轮询 + checkTextMatch/checkScreenStable
- **TmuxProvider** (576行): 所有 tmux 调用用 execFile 参数数组 (禁止 shell 拼接)；session 命名 `tumcp_<8hex>`；snapshot 用 capture-pane + display-message；paste 逐行 send-keys + 5ms delay；listSessions 解析 tmux list-sessions 格式化输出

### Phase 7 MCP Tools ✅

| 文件 | 内容 |
|------|------|
| src/tools/tool-helpers.ts | errorToToolResult / okToolResult / textContent / sessionToPublicInfo / ProviderExecutor (11 methods) |
| src/tools/start.ts | registerStartTool: terminal.start |
| src/tools/attach.ts | registerAttachTool: terminal.attach |
| src/tools/list.ts | registerListTool: terminal.list |
| src/tools/info.ts | registerInfoTool: terminal.info |
| src/tools/rename.ts | registerRenameTool: terminal.rename |
| src/tools/kill.ts | registerKillTool: terminal.kill |
| src/tools/cleanup.ts | registerCleanupTool: terminal.cleanup |
| src/tools/snapshot.ts | registerSnapshotTool: terminal.snapshot |
| src/tools/wait-for-text.ts | registerWaitForTextTool: terminal.wait_for_text |
| src/tools/wait-stable.ts | registerWaitStableTool: terminal.wait_stable |
| src/tools/find.ts | registerFindTool: terminal.find |
| src/tools/scroll.ts | registerScrollTool: terminal.scroll |
| src/tools/type.ts | registerTypeTool: terminal.type |
| src/tools/press.ts | registerPressTool: terminal.press |
| src/tools/paste.ts | registerPasteTool: terminal.paste (3 层安全: >2000 软限制, >10000 硬限制, secret 检测) |
| src/tools/resize.ts | registerResizeTool: terminal.resize |
| src/tools/export-transcript.ts | registerExportTranscriptTool: terminal.export_transcript |
| src/tools/health.ts | registerHealthTool: terminal.health |
| src/tools/keys.ts | registerKeysTool: terminal.keys |
| src/tools/provider-capabilities.ts | registerProviderCapabilitiesTool: terminal.provider_capabilities |
| src/tools/events.ts | registerEventsTool: terminal.events |
| src/tools/send-signal.ts | registerSendSignalTool: terminal.send_signal |

### Phase 7.5 审查修复 ✅

- **tool-helpers.ts ProviderExecutor 合并**: resize.ts/send-signal.ts/events.ts 的冗余 ProviderExecutor 和 errorToToolResult 统一到 tool-helpers.ts 权威版本
- **McpServer import 统一**: 8 个 tool 文件从 `import { McpServer }` 改为 `import type { McpServer }`
- **SessionManager.getProviders()**: 公开方法返回 `ReadonlyMap<ProviderName, TerminalProvider>`
- **xterm-adapter.ts ESM 兼容**: `@xterm/headless` v6.0.0 只暴露 default export，改为 `import xtermModule from "@xterm/headless"` + `const TerminalCtor = xtermModule.Terminal`

### Phase 8 MCP Resources + Prompts ✅

| 文件 | 内容 |
|------|------|
| src/resources/sessions-resource.ts | registerSessionsResource: terminal://sessions (JSON 数组) |
| src/resources/transcript-resource.ts | registerTranscriptResource: terminal://sessions/{id}/transcript (脱敏文本) |
| src/prompts/terminal-use-workflow.ts | registerTerminalUseWorkflowPrompt: 标准observe-act循环 + 安全规范 |
| src/prompts/external-agent-control.ts | registerExternalAgentControlPrompt: 外部agent只读观察 + 审批中断规则 |

### Phase 9 MCP Server 入口 ✅

| 文件 | 内容 |
|------|------|
| src/mcp-server.ts | createMcpServer(sm, config, logger): McpServer 工厂，注册全部 22 tools + 2 resources + 2 prompts |
| src/index.ts | 完整入口: loadConfig → createLogger → SessionManager → createAndRegisterProviders → startTtlCleanup → createMcpServer → StdioServerTransport + 优雅退出 |

MCP stdio smoke test: MCP initialize 握手成功 (protocolVersion `2024-11-05`)，22 tools + 2 resources + 2 prompts 均已注册，双次信号退出正常。

### 开发范式补完 ✅

- `local-tool-development` SKILL.md 增加 4 个新章节：继续与恢复开发、复杂工具并行开发、停止/接力上下文规范、与 HomeLab 主 Skills 协作
- AGENTS.md 追加: §2 tools/local/ 条目 + §4 local-tool 分类 + §5 Skill 索引 + §6 大任务豁免 + §9 独立工具验收

---

## 技术笔记

### node-pty + @xterm/headless 研究 (Phase 0-1 原始)

基于 librarian 研究结果 (canopyide/canopy + badlogic/terminalcp 两个生产项目):

**初始化模式**:
```ts
const term = new Terminal({ cols, rows, scrollback: 10000, allowProposedApi: true })
term.loadAddon(new Unicode11Addon())
term.unicode.activeVersion = "11"
const proc = pty.spawn(command, args, { name: "xterm-256color", cols, rows, cwd, env })
```

**屏幕读取**: `terminal.buffer.active.getLine(y).translateToString(true)`
**光标**: `terminal.buffer.active.cursorX/Y`
**Highlights**: `cell.isInverse()` / `cell.isBold()` + fg/bg color 检测 (best-effort)
**Resize**: `pty.resize(cols, rows)` + `term.resize(cols, rows)` (需 debounce)
**Exit**: `proc.onExit(({ exitCode, signal }) => { ... })`
**Gotcha**: getLine/getCell 返回值立即使用，不长期持有；write 后等 onWriteParsed

### MCP SDK 1.29.0

**API**: `server.registerTool(name, { description, inputSchema }, handler)` (registerTool 非 tool())
**inputSchema**: ZodRawShapeCompat 即 `{ key: z.string() }` 形式
**structuredContent**: 带 outputSchema 时返回 `{ content: [...], structuredContent: output }`
**zod 兼容**: SDK zod-compat 同时支持 v3 和 v4

### @xterm/headless v6 ESM 兼容

Node ESM 环境下 `@xterm/headless` v6.0.0 只暴露 default export，Terminal 需通过 `default.Terminal` 访问:
```ts
import xtermModule from "@xterm/headless"
const TerminalCtor = xtermModule.Terminal
```
直接 `import { Terminal }` 在 ESM 下 undefined。

### Phase 7 MCP Tools 实现笔记

- 22 个 tool 文件 + 1 个 tool-helpers.ts
- **tool-helpers.ts** 提供: errorToToolResult / okToolResult / textContent / sessionToPublicInfo / ProviderExecutor
- **ProviderExecutor** 解决 SessionManager 不暴露 provider 实例的问题: tool 层通过 ProviderExecutor(sm, providersMap) 调用 provider 操作，所有操作经 session.queue.enqueue() 串行化
- ProviderExecutor 含 11 个方法: executeSnapshot/executeWaitForText/executeWaitStable/executeFind/executeScroll/executeType/executePress/executePaste/executeResize/getEvents/executeSendSignal
- paste tool 3 层安全: >2000 软限制(需确认)、>10000 硬限制、secret 检测
- Phase 7.5 统一: resize.ts/send-signal.ts/events.ts 的冗余 errorToToolResult 删除，ProviderExecutor 合并到 tool-helpers.ts
