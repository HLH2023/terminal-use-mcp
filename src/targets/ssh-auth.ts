/**
 * SSH 认证解析。
 *
 * 安全边界：
 * - 支持 ssh-agent 与 key-file 两种方式。
 * - 不支持 password。
 * - key-file 只检查路径可读，不读取私钥内容。
 * - passphrase 只检查环境变量是否存在，不读取变量值。
 *
 * SSH_AUTH_SOCK 发现链：
 * 1. auth.socket（profile 中显式指定，最高优先）
 * 2. SSH_AUTH_SOCK 环境变量（MCP 客户端传入）
 * 3. XDG_RUNTIME_DIR/ssh-agent.socket（systemd user service）
 * 4. XDG_RUNTIME_DIR/keyring/ssh（GNOME Keyring）
 * 5. 运行时扫描 ss -x --no-header（兜底，可选）
 */

import { constants as fsConstants, existsSync } from "node:fs"
import { promises as fs } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

import type { SshAuthRef } from "./target-types.js"
import { expandTildePath } from "./ssh-host-config.js"
import { logger } from "../logger.js"
import type { SshAgentDiscoveryMode } from "../config.js"

/** 已解析的 SSH 认证配置 */
export type ResolvedSshAuth =
  | { type: "agent"; socket: string }
  | { type: "key-file"; path: string; passphraseAvailable: boolean }

/** 将 profile 中的认证引用解析为 provider 可用的具体配置。 */
export async function resolveSshAuth(
  auth: SshAuthRef,
  discoveryMode: SshAgentDiscoveryMode = "xdg",
): Promise<ResolvedSshAuth> {
  if (auth.type === "agent") {
    const socket = auth.socket !== undefined ? expandTildePath(auth.socket) : getSshAgentSocket(discoveryMode)
    if (socket === undefined || socket.trim().length === 0) {
      throw new Error("SSH agent socket not found; set SSH_AUTH_SOCK or configure auth.socket")
    }
    const socketExists = await pathExists(socket)
    if (!socketExists) {
      throw new Error(`SSH agent socket does not exist: ${socket}`)
    }
    return { type: "agent", socket }
  }

  const keyPath = expandTildePath(auth.path)
  const accessible = await isKeyFileAccessible(keyPath)
  if (!accessible) {
    throw new Error(`SSH key file is not accessible: ${keyPath}`)
  }

  const passphraseAvailable = auth.passphraseEnv !== undefined
    && Object.prototype.hasOwnProperty.call(process.env, auth.passphraseEnv)

  return { type: "key-file", path: keyPath, passphraseAvailable }
}

/**
 * 获取 ssh-agent socket — 受 discovery mode 控制的发现链。
 *
 * mode 语义：
 * - env-only: 只检查 SSH_AUTH_SOCK 环境变量
 * - xdg: SSH_AUTH_SOCK → XDG_RUNTIME_DIR 常见路径
 * - scan: SSH_AUTH_SOCK → XDG_RUNTIME_DIR → ss -x runtime scan（兜底）
 *
 * 默认建议 xdg：覆盖大多数 systemd/GNOME 环境，不做 runtime scan。
 *
 * profile 中的 auth.socket 显式传参在 resolveSshAuth 中优先于本函数。
 * 本函数只处理"没有显式指定 socket"时的自动发现。
 */
export function getSshAgentSocket(mode: SshAgentDiscoveryMode = "xdg"): string | undefined {
  // 1. SSH_AUTH_SOCK 环境变量（所有 mode 都检查）
  const envSocket = process.env.SSH_AUTH_SOCK
  if (envSocket !== undefined && envSocket.trim().length > 0) {
    return envSocket
  }

  // env-only mode: 只到这里就结束
  if (mode === "env-only") {
    return undefined
  }

  // 2+3. XDG_RUNTIME_DIR 常见路径
  const runtimeDir = process.env.XDG_RUNTIME_DIR
  const commonCandidates = runtimeDir === undefined || runtimeDir.trim().length === 0
    ? []
    : [
        path.join(runtimeDir, "ssh-agent.socket"),
        path.join(runtimeDir, "keyring", "ssh"),
      ]

  const xdgMatch = commonCandidates.find((candidate) => existsSync(candidate))
  if (xdgMatch !== undefined) {
    return xdgMatch
  }

  // xdg mode: 到这里就结束，不做 runtime scan
  if (mode === "xdg") {
    return undefined
  }

  // scan mode: 运行时扫描兜底
  const scannedSocket = scanAgentSocket()
  if (scannedSocket !== undefined) {
    logger.info("SSH agent socket found via runtime scan", { socket: scannedSocket })
    return scannedSocket
  }

  return undefined
}

/** 检查 key-file 是否存在且可读；不会读取私钥内容。 */
export async function isKeyFileAccessible(keyPath: string): Promise<boolean> {
  const expandedPath = expandTildePath(keyPath)
  try {
    await fs.access(expandedPath, fsConstants.R_OK)
    return true
  } catch {
    return false
  }
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await fs.access(candidatePath, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * 运行时扫描 ssh-agent UNIX socket（兜底发现）。
 *
 * 使用 `ss -x` 列出 UNIX domain socket，搜索含 "agent" 的路径。
 * 不会读取 socket 内容、不会发送任何数据。
 * 失败时静默返回 undefined——不抛异常、不影响主流程。
 */
function scanAgentSocket(): string | undefined {
  try {
    // ss -x = 列出 UNIX domain sockets
    // --no-header = 不输出表头
    const output = execFileSync("ss", ["-x", "--no-header"], {
      timeout: 2000,
      encoding: "utf8",
      maxBuffer: 64 * 1024,
    })

    // 输出格式：每行含 socket 路径，搜索含 "agent" 的行
    const lines = output.split(/\r?\n/u)
    for (const line of lines) {
      // ss 输出中 socket path 通常是最后一个空格分隔字段
      const fields = line.trim().split(/\s+/u)
      const lastField = fields[fields.length - 1]
      if (lastField !== undefined && lastField.includes("agent") && existsSync(lastField)) {
        return lastField
      }
    }

    return undefined
  } catch {
    // ss 不存在、超时、权限不足等——静默失败
    return undefined
  }
}
