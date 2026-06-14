# terminal-use-mcp 远程 SSH 终端支持 — 架构探讨

> 探讨日期: 2026-06-13
> 状态: 待用户决策，不绑定大任务，工具分支内实现

## 核心问题

当前 MCP 架构是**纯本地模型** — 所有 Provider 假设进程在本机执行。远程 SSH 需要「连接上下文」这一层，当前设计中不存在。

## 当前架构的本地假设清单

### 接口层
- `ProviderName = "native-pty" | "tmux"` — 无远程 provider
- `StartInput.cwd` / `TerminalSession.cwd` — 本地路径语义
- `StartInput` 无 `host/port/user/sshKeyPath` 等连接字段
- `TerminalSession` 无 `host` 远程主机元数据

### 实现层
| 文件 | 行号 | 本地假设 |
|------|------|----------|
| `native-pty-provider.ts` | 10-13, 130-136 | 直接 `node-pty spawn()`，只能本机起子进程 |
| `native-pty-provider.ts` | 160-179 | 数据来自本地 PTY onData/onExit |
| `native-pty-provider.ts` | 283-295 | 输入直接写入本地 pty |
| `tmux-provider.ts` | 98-104, 118-135 | `execFile("tmux", ...)` 依赖本机 tmux 二进制 |
| `tmux-provider.ts` | 185, 556 | attach/list cwd 用 `process.cwd()` |
| `tmux-provider.ts` | 448-465 | set-environment/clear-environment 是本地 tmux 环境操作 |

### 安全/配置层
| 文件 | 行号 | 本地假设 |
|------|------|----------|
| `command-safety.ts` | 18-24, 67-107 | cwd 按本地 workspaceRoot 校验，远程 cwd 会误判 |
| `session-manager.ts` | 357-384 | 命令安全和 cwd 安全校验是本地工作区模型 |
| `config.ts` | 31-49 | 无 SSH host/user/key/port 配置项 |
| `artifacts.ts` | 37-116 | 文件写入本地磁盘 |
| `export-transcript.ts` | 34-53 | transcript 导出到本地文件 |

### 工具/枚举层 (机械改动点)
| 文件 | 行号 | 硬编码 |
|------|------|--------|
| `start.ts` | 20-24 | provider 输入枚举只有 3 个 |
| `attach.ts` | 16-18 | attach 枚举只有 3 个 |
| `provider-capabilities.ts` | 27-29 | capabilities tool provider enum 硬编码 |
| `health.ts` | 27-28 | health 检查 provider 名单硬编码 |
| `provider-registry.ts` | 21-27 | 只注册 3 个 provider |

---

## 三种架构路径

### 方案 A: 新增 SshProvider (推荐主路径)

**模式**: 本机 MCP + ssh2 远程 PTY channel

```
Agent → MCP Client → [stdio] → terminal-use-mcp (本机)
                                        ↓ ssh2 Client
                                   Remote Host PTY
```

**优点**:
- 最小改动，单进程部署
- session 模型完全复用
- ssh2 的 `requestPty()` + `shell()` 提供完整交互 PTY
- 和现有 NativePtyProvider 共享 xterm-adapter 解析逻辑

**缺点**:
- 凭据安全风险 — MCP 进程可访问所有 SSH key
- 单进程是单点 — MCP 挂了所有远程 session 断

**实现要项**:
- 新文件 `src/providers/ssh-pty-provider.ts`
- 核心: `ssh2.Client.connect()` → `client.shell({pty:{...}})` → channel
- `type/press/paste` → `channel.write()`
- `snapshot` → xterm-adapter 解析 channel data 事件 (和 NativePty 一致)
- `kill` → `channel.close()` + `client.end()`

**需要改的地方**:

| 层 | 改动 |
|----|------|
| 接口 | `ProviderName` 加 `"ssh-pty"`；`StartInput` 加 host/port/user/sshKeyPath/sshAgent (或 `RemoteStartInput extends StartInput`)；`TerminalSession` 加 `host?: string` |
| 实现 | 新 SshProvider，复用 xterm-adapter 解析，channel 替代 pty |
| 安全 | SshProvider 内跳过 `isCwdAllowed()` 本地校验；凭据走 ssh-agent/key file |
| 配置 | `TerminalUseConfig` 加 `sshHosts: SshHostConfig[]`；环境变量 `TERMINAL_USE_SSH_*` |
| 工具 | 所有 `z.enum(...)` 加 `"ssh-pty"`；health/capabilities/registry 注册新 provider |
| artifact | 无需大改 — channel data 流过来后本地解析落盘 |

### 方案 B: Remote-agent 架构 (重型)

**模式**: 每台远端装 MCP，本机做路由

```
Agent → MCP Client → [stdio] → terminal-use-mcp (本机/路由)
                        ↓ HTTP/SSE        ↓ HTTP/SSE
                Remote MCP 1        Remote MCP 2
              (远端主机 A)         (远端主机 B)
```

**优点**:
- 天然安全隔离 — 凭据不过网
- 支持多人协作、浏览器可见
- 单点故障不会全挂

**缺点**:
- 每台主机都要安装维护 MCP server
- 架构复杂度高 — 需要路由、分布式 session owner、反向代理信任
- 适合长生命周期管理主机，不适合临时连一台

**参考**: `Zw-awa/ssh-session-mcp` — 有 REMOTE_OWNER、publicBaseUrl、trusted reverse proxy

### 方案 C: SSH 透传 tmux (最轻量)

**模式**: 把 `execFile("tmux", ...)` 替换为 `execFile("ssh", ["-t", "user@host", "tmux", ...])`

```
Agent → MCP Client → [stdio] → terminal-use-mcp (本机)
                                        ↓ ssh -t
                                   Remote Host tmux
```

**优点**:
- 零安装远端 — 只要远端有 tmux
- tmux session 持久化 — SSH 断了 session 不丢
- 改动极小 — 本质是给 TmuxProvider 加个 SSH 传输前缀

**缺点**:
- 只能操作远端已有 tmux session，不能 start 新的裸 PTY
- `ssh -t` 的 PTY 输出解析不稳定 — 网络卡顿时输出碎片化
- 每个操作一次 ssh 连接开销（除非用 ControlMaster 复用）

**参考命令**:
```bash
ssh -t user@host "tmux new-session -s NAME -d 'bash'"
ssh -t user@host "tmux send-keys -t NAME 'echo hello' Enter"
ssh -t user@host "tmux capture-pane -t NAME -p"
ssh -t user@host "tmux kill-session -t NAME"
```

---

## 安全要点 (跨方案通用)

1. **Host key 校验** — 必须用 `~/.ssh/known_hosts`，禁止 `StrictHostKeyChecking=no`
   - 反例: `mcp-ssh` 默认关闭 host key 校验，不适合生产
   - 正例: `ssh-mcp` (n0madic) 默认开 known_hosts 校验

2. **凭据管理** — 优先级排序:
   - `ssh-agent` / `SSH_AUTH_SOCK` (最安全，MCP 不接触私钥)
   - `~/.ssh/id_*` 指定 key 文件路径 (MCP 读路径，不读内容)
   - 密码 **永远不**存入配置文件或环境变量

3. **远端暴露** — 如果 MCP 本身要对外提供:
   - HTTP 模式加 bearer token / trusted proxy
   - 参考 `ssh-session-mcp` 的分布式模式

---

## 已有参考项目

| 项目 | 语言 | 模式 | 关键能力 | 安全水平 |
|------|------|------|----------|----------|
| [n0madic/ssh-mcp](https://github.com/n0madic/ssh-mcp) | Go | ssh2 + PTY + SFTP + tunnel | 连接池、ssh-agent 优先、known_hosts | ✅ 高 |
| [xiongjiwei/mcp-ssh](https://github.com/xiongjiwei/mcp-ssh) | Go | 系统 ssh 子进程 | 简单，`-T` 无 PTY | ⚠️ 低 (关 host key) |
| [Zw-awa/ssh-session-mcp](https://github.com/Zw-awa/ssh-session-mcp) | TS | 分布式 owner 路由 + 浏览器 viewer | 多人协作、反向代理 | ✅ 中高 |
| [mkpvishnu/terminal-mcp](https://github.com/mkpvishnu/terminal-mcp) | Python | 通用 PTY 容器 | SSH 只是 session 里跑的命令 | 中 |

npm 侧同类包: `mcp-server-ssh`, `@zibdie/ssh-mcp-server`, `@fangjunjie/ssh-mcp-server`, `@alolite/ssh-mcp`, `@xuyehua/remote-terminal-mcp` (质量参差)

---

## 推荐: A (SshProvider) + C (tmux fallback)

主路径用 **ssh2 PTY channel** 获得完整交互能力，退路用 **tmux attach** 处理持久化共享场景。两条路径都在同一 SshProvider 内实现:

- `start({host, ...})` 默认走 ssh2 PTY channel (方案 A)
- `start({host, ..., attachTmux: "session-name"})` 走 tmux 模式 (方案 C)
- 两种模式共享 `host/port/user/key` 连接配置

---

## 待用户决策

1. SshProvider 的连接配置放在哪 — 环境变量 vs mcp.json 传参 vs 新配置文件?
2. tmux fallback 是否作为第一阶段就必须实现?
3. 是否需要方案 B (多主机路由) 的预留接口?
4. ssh2 vs 系统 ssh 子进程的偏好 — ssh2 更可控，系统 ssh 更通用?
