# 远程 SSH 连接故障排查

Common errors, causes, and solutions for remote terminal sessions.

> Remote SSH features are available. Full design: [REMOTE_TERMINAL_GUIDE.md](../docs/REMOTE_TERMINAL_GUIDE.md).

---

## 目录

- [SSH 连接失败](#ssh-连接失败)
- [Host key 校验失败](#host-key-校验失败)
- [认证失败](#认证失败)
- [连接超时](#连接超时)
- [远程 tmux 不可用](#远程-tmux-不可用)
- [远程 CWD 被拒绝](#远程-cwd-被拒绝)
- [Inline SSH target 被拒绝](#inline-ssh-target-被拒绝)
- [SSH 连接意外中断](#ssh-连接意外中断)
- [远程命令被拒绝](#远程命令被拒绝)

---

## SSH 连接失败

### 症状

```json
{
  "ok": false,
  "error": {
    "code": "SSH_PROFILE_NOT_FOUND",
    "message": "SSH profile 'devbox' not found in hosts config",
    "retryable": false,
    "hint": "Check ~/.config/terminal-use-mcp/hosts.json"
  }
}
```

### 原因

1. Profile 名称拼错或不存在
2. `hosts.json` 文件路径不正确
3. `hosts.json` 格式错误 (JSON 语法错误)

### 解决

1. 用 `terminal.targets()` 列出所有可用 profile，确认名称正确：

```text
terminal.targets({})
→ {
    targets: [
      { kind: "local", name: "local" },
      { kind: "ssh", profile: "devbox", host: "192.168.1.20", username: "hlh" }
    ]
  }
```

2. 用 `terminal.target_info({ profile: "devbox" })` 查询 profile 脱敏详情，确认配置有效。

3. 检查 `hosts.json` 是否存在且格式正确：

```bash
cat ~/.config/terminal-use-mcp/hosts.json | python3 -m json.tool
```

4. 如果使用自定义路径：

```bash
# 确认环境变量指向正确的文件
echo $TERMINAL_USE_HOSTS_CONFIG
```

---

## Host key 校验失败

### 症状

```json
{
  "ok": false,
  "error": {
    "code": "SSH_HOST_KEY_MISMATCH",
    "message": "Host key for 192.168.1.20 does not match known_hosts entry",
    "retryable": false,
    "hint": "The remote host may have been reinstalled. Verify the fingerprint manually before updating known_hosts."
  }
}
```

或：

```json
{
  "ok": false,
  "error": {
    "code": "SSH_HOST_KEY_UNKNOWN",
    "message": "No known_hosts entry for 192.168.1.20 and no pinned fingerprint configured",
    "retryable": false,
    "hint": "Add the host to known_hosts via: ssh hlh@192.168.1.20, or set pinnedHostFingerprint in the profile"
  }
}
```

### 原因

1. **SSH_HOST_KEY_MISMATCH**: 远程主机的 host key 发生了变化（重装系统、更换 SSH 密钥对、中间人攻击）
2. **SSH_HOST_KEY_UNKNOWN**: 远程主机第一次连接，尚无信任记录

### 解决

1. **验证真实性**。先从可信渠道确认远程主机的新 host key fingerprint：

```bash
# 在远程主机上查看
ssh-keygen -l -f /etc/ssh/ssh_host_ed25519_key.pub
# 输出: 256 SHA256:xR3k9b... root@devbox (ED25519)
```

2. **通过 known_hosts 信任**（推荐）：

```bash
# 用系统 ssh 第一次连接并手动确认 fingerprint
ssh hlh@192.168.1.20
# 确认后 host key 自动写入 ~/.ssh/known_hosts
```

之后 profile 中的 `knownHosts: "~/.ssh/known_hosts"` 就能找到匹配记录。

3. **通过 pinned fingerprint 信任**（适合自动化场景）：

在 `hosts.json` 中添加：

```json
{
  "hosts": {
    "devbox": {
      "pinnedHostFingerprint": "SHA256:xR3k9b...",
      ...
    }
  }
}
```

4. **如果是 host key 变更**（重装系统等），手动更新 known_hosts：

```bash
# 删除旧记录
ssh-keygen -R 192.168.1.20
# 重新连接建立信任
ssh hlh@192.168.1.20
```

> 禁止使用 `StrictHostKeyChecking=no`。terminal-use-mcp 不支持此选项。

---

## 认证失败

### 症状

```json
{
  "ok": false,
  "error": {
    "code": "SSH_AUTH_FAILED",
    "message": "SSH authentication failed for hlh@192.168.1.20",
    "retryable": false,
    "hint": "Check ssh-agent keys or key-file path in profile"
  }
}
```

### 原因

1. ssh-agent 未启动或未加载对应密钥
2. profile 中 `key-file` 路径错误
3. 密钥 passphrase 未通过 `passphraseEnv` 正确引用
4. Password login is not supported，如果服务器只允许密码方式则会失败

### 解决

1. **检查 ssh-agent**：

```bash
# 确认 agent 运行中
ssh-add -l
# 应该列出至少一个密钥，如:
# 256 SHA256:xxx... hlh@local (ED25519)
```

如果没有密钥：

```bash
ssh-add ~/.ssh/id_ed25519
```

2. **检查 profile 中的 auth 配置**：

```json
{
  "auth": {
    "type": "agent"
  }
}
```

默认使用 ssh-agent。如果需要指定 socket（非默认 `$SSH_AUTH_SOCK`）：

```json
{
  "auth": {
    "type": "agent",
    "socket": "/run/user/1000/keyring/ssh"
  }
}
```

3. **使用 key-file 模式**（不需要 ssh-agent）：

```json
{
  "auth": {
    "type": "key-file",
    "path": "~/.ssh/id_ed25519",
    "passphraseEnv": "MY_SSH_KEY_PASSPHRASE"
  }
}
```

确保环境变量 `MY_SSH_KEY_PASSPHRASE` 已设置：

```bash
export MY_SSH_KEY_PASSPHRASE="your-passphrase"
```

4. **确认远程服务器支持密钥认证**：

```bash
# 用系统 ssh 测试
ssh -v hlh@192.168.1.20
# 看 "Offering public key" 和 "Server accepts key" 日志
```

如果服务器只允许密码认证，Password login is not supported，需要在远程服务器上启用公钥认证。

---

## 连接超时

### 症状

```json
{
  "ok": false,
  "error": {
    "code": "SSH_CONNECT_TIMEOUT",
    "message": "Connection to 192.168.1.20 timed out after 10000ms",
    "retryable": true,
    "hint": "Check network connectivity and increase connectTimeoutMs if needed"
  }
}
```

### 原因

1. 远程主机不可达（网络问题、防火墙、主机离线）
2. `connectTimeoutMs` 设得太短
3. SSH 端口被阻止

### 解决

1. **检查基本连通性**：

```bash
ping 192.168.1.20
```

2. **检查 SSH 端口可达**：

```bash
nc -zv 192.168.1.20 22
# 或
telnet 192.168.1.20 22
```

3. **增加超时时间**（在 profile 中）：

```json
{
  "connectTimeoutMs": 30000
}
```

默认 10000ms (10s)，网络不稳定时可以增加到 30 秒。

4. **检查防火墙**：

```bash
# 远程主机确认 sshd 监听
sudo ss -tlnp | grep :22
```

5. **调整 keepalive**（防止连接被中间设备断开）：

```json
{
  "keepaliveIntervalMs": 10000
}
```

默认 15000ms，如果网络有中间设备（NAT、防火墙）会在空闲时断开连接，缩短 keepalive 间隔。

---

## 远程 tmux 不可用

### 症状

```json
{
  "ok": false,
  "error": {
    "code": "REMOTE_TMUX_NOT_AVAILABLE",
    "message": "Remote tmux is not available on devbox, but allowTmux is set to true",
    "retryable": false,
    "hint": "Install tmux on the remote host or set allowTmux to false in the profile"
  }
}
```

### 原因

1. 远程主机未安装 tmux
2. tmux version too old (< 3.2)
3. profile 中 `allowTmux: true` 但远程无 tmux

### 解决

1. **安装 tmux**：

```bash
# Ubuntu/Debian
sudo apt-get install tmux

# CentOS/RHEL
sudo yum install tmux

# macOS
brew install tmux
```

2. **检查版本**：

```bash
tmux -V
# 需要 3.2+
```

3. **如果不需要 tmux**，把 profile 中 `allowTmux` 设为 `false`，强制使用 `ssh-pty`。

4. **从源码安装新版 tmux**（系统仓库版本太旧时）：

```bash
git clone https://github.com/tmux/tmux.git
cd tmux
autoreconf -f i
./configure
make && sudo make install
```

---

## 远程 CWD 被拒绝

### 症状

```json
{
  "ok": false,
  "error": {
    "code": "REMOTE_CWD_DENIED",
    "message": "Remote CWD '/etc' is denied by remoteDeniedCwd policy",
    "retryable": false,
    "hint": "Use a CWD under /home/hlh/dev or /srv/lab"
  }
}
```

### 原因

1. 指定的 cwd 在 profile 的 `remoteDeniedCwd` 列表中
2. 指定的 cwd 不在 `remoteAllowedCwd` 列表中

### 解决

1. **确认允许的目录列表**：

```text
terminal.target_info({ profile: "devbox" })
→ {
    remote: {
      allowedCwd: ["/home/hlh/dev", "/srv/lab"],
      deniedCwd: ["/", "/root", "/etc", "/boot", "/proc", "/sys"]
    }
  }
```

2. **使用允许范围内的目录**：

```text
# 错误: /etc 不在允许列表
terminal.start({ cwd: "/etc", ... })

# 正确: /home/hlh/dev/project 在允许列表子目录下
terminal.start({ cwd: "/home/hlh/dev/project", ... })
```

3. **修改 profile 增加允许目录**：

编辑 `~/.config/terminal-use-mcp/hosts.json`：

```json
{
  "remoteAllowedCwd": ["/home/hlh/dev", "/srv/lab", "/opt/workspace"]
}
```

> 远程 CWD 策略与本地独立。本地 `TERMINAL_USE_ALLOWED_CWD` 不影响远程校验。

---

## Inline SSH target 被拒绝

### 症状

```json
{
  "ok": false,
  "error": {
    "code": "SSH_INLINE_TARGET_DENIED",
    "message": "Inline SSH targets are not allowed. Use a profile from hosts.json or set TERMINAL_USE_ALLOW_INLINE_SSH_TARGETS=1",
    "retryable": false
  }
}
```

### 原因

直接在 `terminal.start` 的 `target` 参数中指定 `host`/`port`/`username`（而非 profile），且未启用 inline SSH targets。

Inline SSH targets are denied by default，因为 inline target 绕过了 hosts.json 的集中管理和安全审查。

### 解决

1. **推荐方式: 使用 profile**（在 `hosts.json` 中定义）：

```json
// hosts.json
{
  "hosts": {
    "devbox": {
      "host": "192.168.1.20",
      "port": 22,
      "username": "hlh",
      "auth": { "type": "agent" }
    }
  }
}
```

```text
terminal.start({
  provider: "ssh-pty",
  target: { kind: "ssh", profile: "devbox" },
  command: "htop"
})
```

2. **如果确实需要 inline target**（临时调试、一次性连接等）：

```bash
# 启用 inline SSH targets (谨慎使用)
export TERMINAL_USE_ALLOW_INLINE_SSH_TARGETS=1
```

然后：

```text
terminal.start({
  provider: "ssh-pty",
  target: {
    kind: "ssh",
    host: "192.168.1.20",
    port: 22,
    username: "hlh",
    auth: { type: "agent" },
    knownHostPolicy: "strict"
  },
  command: "htop"
})
```

> 启用 `TERMINAL_USE_ALLOW_INLINE_SSH_TARGETS` 意味着 agent 可以连接任意 SSH 主机。仅在受控环境中启用。

---

## SSH 连接意外中断

### 症状

```json
{
  "ok": false,
  "error": {
    "code": "SSH_CONNECTION_LOST",
    "message": "SSH connection to devbox lost",
    "retryable": true,
    "hint": "Reconnect by starting a new session. Use ssh-tmux provider for persistent sessions."
  }
```

### 原因

1. 网络不稳定，SSH 连接断开
2. 远程主机重启
3. 中间设备 (NAT/防火墙) 空闲超时关闭连接
4. ssh-agent 被意外清理

### 解决

1. **立即恢复**: 创建新 session 重新连接

```text
terminal.start({
  provider: "ssh-pty",
  target: { kind: "ssh", profile: "devbox" },
  command: "python3",
  cwd: "/home/hlh/dev/project"
})
```

2. **避免再次断开**: 增加 keepalive 间隔

```json
{
  "keepaliveIntervalMs": 10000
}
```

3. **改用 ssh-tmux**: 如果远程 tmux 可用，切换到 `ssh-tmux` provider。tmux session 在远程主机上运行，SSH 断开后 session 存活，重连后可 attach 恢复。

```text
terminal.start({
  provider: "ssh-tmux",
  target: { kind: "ssh", profile: "devbox" },
  command: "lazygit",
  cwd: "/home/hlh/dev/project"
})
```

4. **检查 ssh-agent 状态**:

```bash
ssh-add -l
# 如果显示 "The agent has no identities"，重新添加密钥
ssh-add ~/.ssh/id_ed25519
```

---

## 远程命令被拒绝

### 症状

```json
{
  "ok": false,
  "error": {
    "code": "REMOTE_COMMAND_DENIED",
    "message": "Command 'sudo' is denied on remote target",
    "retryable": false,
    "hint": "Command deny list applies to remote sessions as well"
  }
}
```

### 原因

远程 session 同样受 command deny list 限制。`sudo`、`rm`、`ssh`、`curl` 等命令在启动时被拒绝。

### 解决

1. **使用不在 deny list 中的命令**。大部分开发工具不在列表里：`python3`、`node`、`lazygit`、`htop`、`vim` 等默认允许。

2. **临时允许特定命令**（谨慎）：

```bash
export TERMINAL_USE_ALLOW_COMMANDS=curl,wget
```

3. **使用 ask 模式**（返回 `CONFIRMATION_REQUIRED` 而非直接拒绝）：

```bash
export TERMINAL_USE_RISKY_COMMAND_MODE=ask
```

4. **注意**: command policy 只限制 `terminal.start` 的启动命令。TUI/REPL 内部执行的命令不受限。例如 Python REPL 中 `os.system("rm -rf /")` 不受 deny list 限制。
