/**
 * OpenSSH ~/.ssh/config 解析器
 *
 * 读取系统 OpenSSH config 文件，根据 Host 别名解析出连接参数：
 * HostName, Port, User, IdentityFile, ProxyJump 等。
 *
 * 设计原则：
 * - 只读解析，不修改 ~/.ssh/config
 * - 支持常见指令（HostName/Port/User/IdentityFile/ProxyJump/StrictHostKeyChecking/UserKnownHostsFile）
 * - 不支持 Match/Include 等高级指令——graceful fallback
 * - 解析失败不阻塞——返回 partial 结果 + 警告
 *
 * 与 @yawlabs/ssh-mcp 方案对比：
 * - @yawlabs 用 `ssh -G <host>` 做 runtime 解析，最准确但依赖系统 ssh
 * - 本解析器是纯 JS 实现，不依赖子进程，对常见 config 足够准确
 * - 如果需要 100% 准确，用户可显式在 overlay 中写连接参数（覆盖解析结果）
 */

import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { logger } from "../logger.js"

/** OpenSSH config 解析结果 */
export type SshConfigEntry = {
  /** Host 别名（config 中的 Host 指令值） */
  host: string
  /** 实际主机名（HostName 指令）—— 未设置时等同 host */
  hostName: string
  /** SSH 端口（Port 指令）—— 默认 22 */
  port: number
  /** 登录用户名（User 指令） */
  username?: string
  /** 密钥文件路径（IdentityFile 指令）—— 可多个 */
  identityFiles: string[]
  /** ProxyJump 跳板（ProxyJump 指令） */
  proxyJump?: string
  /** known_hosts 文件路径（UserKnownHostsFile 指令） */
  userKnownHostsFile?: string
  /** 是否严格 host key 校验——解析后只用于判断，本工具始终 strict */
  strictHostKeyChecking?: string
}

/**
 * 解析 ~/.ssh/config 文件，返回所有 Host 块的解析结果。
 *
 * 返回 Map<hostPattern, SshConfigEntry>，key 是 Host 指令的值（可含通配符）。
 */
export async function parseSshConfig(
  configPath: string = getDefaultSshConfigPath(),
): Promise<Map<string, SshConfigEntry>> {
  const expandedPath = expandTildePath(configPath)

  if (!existsSync(expandedPath)) {
    logger.warn("OpenSSH config file not found", { path: expandedPath })
    return new Map()
  }

  let content: string
  try {
    content = await readFile(expandedPath, "utf8")
  } catch (error) {
    logger.warn("Failed to read OpenSSH config", {
      path: expandedPath,
      error: error instanceof Error ? error.message : String(error),
    })
    return new Map()
  }

  return parseSshConfigContent(content)
}

/**
 * 根据 Host 别名查找 SSH config 中匹配的条目。
 *
 * 匹配规则（简化版，不处理通配符优先级）：
 * 1. 精确匹配：Host devbox → 查 "devbox"
 * 2. 通配符匹配：Host *.example.com → 查 "dev.example.com"
 * 3. 多个匹配时，取第一个（OpenSSH 行为是取最后匹配，但 profile 场景一般不会有歧义）
 */
export function findSshConfigEntry(
  hostAlias: string,
  entries: Map<string, SshConfigEntry>,
): SshConfigEntry | undefined {
  // 精确匹配
  const exact = entries.get(hostAlias)
  if (exact !== undefined) return exact

  // 通配符匹配
  for (const [pattern, entry] of entries) {
    if (isWildcardMatch(hostAlias, pattern)) {
      return entry
    }
  }

  return undefined
}

/** 获取默认 SSH config 路径 */
export function getDefaultSshConfigPath(): string {
  return join(homedir(), ".ssh", "config")
}

// ── 内部实现 ──────────────────────────────────────────────────

/**
 * 解析 SSH config 文件内容。
 *
 * OpenSSH config 格式：
 * - 每行一个指令：`Keyword value`
 * - Host 块以 `Host <pattern>` 开始，到下一个 Host 块或文件结尾
 * - # 开头为注释
 * - 空行忽略
 * - 指令不区分大小写
 */
function parseSshConfigContent(content: string): Map<string, SshConfigEntry> {
  const result = new Map<string, SshConfigEntry>()
  const lines = content.split(/\r?\n/u)

  let currentHost: string | null = null
  let currentEntry: PartialEntry | null = null

  for (const rawLine of lines) {
    // 去注释：行内 # 前有空白时截断
    const commentIndex = rawLine.indexOf("#")
    const line = (commentIndex >= 0 ? rawLine.slice(0, commentIndex) : rawLine).trim()
    if (line.length === 0) continue

    const tokens = line.split(/\s+/u)
    const keyword = tokens[0]?.toLowerCase()
    const value = tokens.slice(1).join(" ")

    if (keyword === "host") {
      // 保存前一个 Host 块
      if (currentHost !== null && currentEntry !== null) {
        const entry = finalizeEntry(currentHost, currentEntry)
        if (entry !== undefined) {
          // Host 可匹配多个模式（空格分隔），每个都注册
          for (const pattern of currentHost.split(/\s+/u)) {
            result.set(pattern, entry)
          }
        }
      }
      // 开始新块
      currentHost = value
      currentEntry = { host: value, identityFiles: [] }
      continue
    }

    // 块外指令（不含 Match）忽略——只处理 Host 块内
    if (currentEntry === null || currentHost === null) continue

    switch (keyword) {
      case "hostname":
        currentEntry.hostName = value
        break
      case "port":
        currentEntry.port = parseInt(value, 10)
        if (!Number.isInteger(currentEntry.port) || currentEntry.port < 1 || currentEntry.port > 65535) {
          currentEntry.port = undefined
        }
        break
      case "user":
        currentEntry.username = value
        break
      case "identityfile":
        currentEntry.identityFiles = currentEntry.identityFiles ?? []
        currentEntry.identityFiles.push(expandTildePath(value))
        break
      case "proxyjump":
        currentEntry.proxyJump = value
        break
      case "userknownhostsfile":
        currentEntry.userKnownHostsFile = expandTildePath(value)
        break
      case "stricthostkeychecking":
        currentEntry.strictHostKeyChecking = value.toLowerCase()
        break
      // 忽略不处理的指令
      default:
        break
    }
  }

  // 保存最后一个块
  if (currentHost !== null && currentEntry !== null) {
    const entry = finalizeEntry(currentHost, currentEntry)
    if (entry !== undefined) {
      for (const pattern of currentHost.split(/\s+/u)) {
        result.set(pattern, entry)
      }
    }
  }

  return result
}

type PartialEntry = {
  host: string
  hostName?: string
  port?: number
  username?: string
  identityFiles: string[]
  proxyJump?: string
  userKnownHostsFile?: string
  strictHostKeyChecking?: string
}

function finalizeEntry(hostAlias: string, partial: PartialEntry): SshConfigEntry {
  return {
    host: hostAlias,
    hostName: partial.hostName ?? hostAlias,
    port: partial.port ?? 22,
    username: partial.username,
    identityFiles: partial.identityFiles ?? [],
    proxyJump: partial.proxyJump,
    userKnownHostsFile: partial.userKnownHostsFile,
    strictHostKeyChecking: partial.strictHostKeyChecking,
  }
}

/**
 * 通配符匹配——OpenSSH 支持的 * 和 ? 通配符。
 * 简化实现：* 匹配任意字符串，? 匹配单字符。
 */
function isWildcardMatch(candidate: string, pattern: string): boolean {
  // 无通配符时已经精确匹配过了
  if (!pattern.includes("*") && !pattern.includes("?")) return false

  // 将通配符转为正则
  const regexStr = pattern
    .split(/([*?])/u)
    .map((segment, index, arr) => {
      if (segment === "*") return ".*"
      if (segment === "?") return "."
      // 转义正则特殊字符
      return segment.replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    })
    .join("")

  try {
    return new RegExp(`^${regexStr}$`, "u").test(candidate)
  } catch {
    return false
  }
}

/** 展开 ~ 为 os.homedir() */
function expandTildePath(value: string): string {
  if (value === "~") return homedir()
  if (value.startsWith("~/")) return join(homedir(), value.slice(2))
  return value
}
