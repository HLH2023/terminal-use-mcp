#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# terminal-use-mcp E2E SSH 环境准备脚本
# ──────────────────────────────────────────────────────────────────
# 用途：配置 localhost SSH 自测环境，让 agent 可以通过 SSH 连接本机
#       进行远程终端控制的 E2E 测试
#
# 前置条件：
#   1. sshd 已运行 (systemctl is-active sshd)
#   2. 用户有 SSH 密钥对 (id_ed25519 或 id_rsa)
#   3. 用户可以 sudo (本脚本需要安装密钥到 authorized_keys)
#
# 使用方式：
#   bash tools/local/terminal-use-mcp/.config/setup-e2e-ssh.sh
#
# 安全说明：
#   - 本脚本仅用于开发环境 E2E 测试
#   - 不修改 sshd 配置，不开放额外端口
#   - 仅将用户自己的公钥添加到 authorized_keys
#   - 仅将 localhost 添加到 known_hosts
# ──────────────────────────────────────────────────────────────────

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

# ── 1. 检查 sshd ──────────────────────────────────────────────────
if systemctl is-active --quiet sshd 2>/dev/null || systemctl is-active --quiet ssh 2>/dev/null; then
  ok "sshd 正在运行"
else
  fail "sshd 未运行。请先启动: sudo systemctl start sshd"
fi

# ── 2. 检查 SSH 密钥 ─────────────────────────────────────────────
SSH_DIR="$HOME/.ssh"
PUB_KEY=""
for keyfile in id_ed25519 id_ed25519_sk id_rsa id_ecdsa; do
  if [ -f "$SSH_DIR/$keyfile.pub" ]; then
    PUB_KEY="$SSH_DIR/$keyfile.pub"
    ok "找到公钥: $keyfile.pub"
    break
  fi
done

if [ -z "$PUB_KEY" ]; then
  warn "未找到 SSH 公钥，正在生成 ed25519 密钥对..."
  ssh-keygen -t ed25519 -f "$SSH_DIR/id_ed25519" -N "" -C "terminal-use-mcp-e2e"
  PUB_KEY="$SSH_DIR/id_ed25519.pub"
  ok "已生成新密钥对"
fi

# ── 3. 安装公钥到 authorized_keys ─────────────────────────────────
AUTH_KEYS="$SSH_DIR/authorized_keys"
mkdir -p "$SSH_DIR"
chmod 700 "$SSH_DIR"
touch "$AUTH_KEYS"
chmod 600 "$AUTH_KEYS"

PUB_CONTENT="$(cat "$PUB_KEY")"
if grep -qF "$PUB_CONTENT" "$AUTH_KEYS" 2>/dev/null; then
  ok "公钥已在 authorized_keys 中"
else
  echo "$PUB_CONTENT" >> "$AUTH_KEYS"
  ok "已将公钥添加到 authorized_keys"
fi

# ── 4. 将 localhost 添加到 known_hosts ────────────────────────────
KNOWN_HOSTS="$SSH_DIR/known_hosts"
touch "$KNOWN_HOSTS"
chmod 644 "$KNOWN_HOSTS"

if grep -q "localhost" "$KNOWN_HOSTS" 2>/dev/null; then
  ok "localhost 已在 known_hosts 中"
else
  # 仅添加 ed25519 和 ecdsa 类型的 keyscan (最常用)
  ssh-keyscan -t ed25519,ecdsa localhost >> "$KNOWN_HOSTS" 2>/dev/null
  ok "已将 localhost host key 添加到 known_hosts"
fi

# ── 5. 配置 ssh-agent ────────────────────────────────────────────
# 检查 ssh-agent 是否可用
if ssh-add -l >/dev/null 2>&1; then
  ok "ssh-agent 正在运行，已加载密钥"
else
  # 尝试启动 ssh-agent
  if [ -z "${SSH_AUTH_SOCK:-}" ]; then
    warn "SSH_AUTH_SOCK 未设置，ssh-agent 可能未运行"
    echo ""
    echo "请手动执行以下命令启动 ssh-agent 并加载密钥："
    echo ""
    echo "  eval \"\$(ssh-agent -s)\""
    echo "  ssh-add ~/.ssh/id_ed25519"
    echo ""
    echo "或者将其添加到 ~/.bashrc / ~/.zshrc 中："
    echo ""
    echo "  if [ -z \"\$SSH_AUTH_SOCK\" ]; then"
    echo "    eval \"\$(ssh-agent -s)\""
    echo "    ssh-add ~/.ssh/id_ed25519 2>/dev/null"
    echo "  fi"
  else
    # SSH_AUTH_SOCK 存在但 ssh-add 无法连接 — 尝试加载密钥
    warn "ssh-agent socket 存在但无法连接，尝试加载密钥..."
    ssh-add "$SSH_DIR/id_ed25519" 2>/dev/null && ok "已加载密钥到 ssh-agent" || warn "无法加载密钥，请手动: ssh-add ~/.ssh/id_ed25519"
  fi
fi

# ── 6. 验证 SSH 连通性 ────────────────────────────────────────────
echo ""
echo "── 验证 SSH 到 localhost ──"
if ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=yes "$(whoami)@localhost" echo "SSH_OK" 2>/dev/null; then
  ok "SSH 到 localhost 成功！E2E SSH 环境就绪"
else
  warn "SSH 到 localhost 失败。请检查："
  echo "  1. ssh-agent 是否运行且已加载密钥"
  echo "  2. known_hosts 中是否有 localhost 的 host key"
  echo "  3. authorized_keys 中是否包含你的公钥"
  echo ""
  echo "手动测试命令:"
  echo "  ssh -v -o BatchMode=yes $(whoami)@localhost echo hello"
fi

echo ""
echo "── E2E 环境摘要 ──"
echo "  hosts.json: tools/local/terminal-use-mcp/.config/hosts.json"
echo "  target:     localhost (profile name)"
echo "  user:       $(whoami)"
echo "  auth:       ssh-agent"
echo "  knownHosts: ~/.ssh/known_hosts"
