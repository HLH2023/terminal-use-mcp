/**
 * SSH hosts 配置加载器（V2 配置改造版）
 *
 * 支持三种配置来源（按优先级）：
 * 1. 旧格式 hosts.json —— 一次性包含所有 SSH profile（向后兼容）
 * 2. 新格式 profiles/<name>.json —— 每个 host 一份增量 overlay
 * 3. OpenSSH ~/.ssh/config —— SSH 连接参数复用（通过 sshConfigHost 字段引用）
 *
 * 文件发现：
 * - 环境变量 TERMINAL_USE_HOSTS_CONFIG → 旧格式文件路径（最高优先覆盖）
 * - 环境变量 TERMINAL_USE_CONFIG_DIR → XDG 配置目录
 * - $XDG_CONFIG_HOME/terminal-use-mcp/ → 新格式配置根目录
 * - ~/.config/terminal-use-mcp/ → Linux 默认
 *
 * 安全原则：
 * - 禁止读取私钥内容、密码、token 或 .env 明文
 * - key-file 只保存路径，passphrase 只引用环境变量名
 * - 配置目录权限 0700，配置文件权限 0600
 */

import { readFile, readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

import { logger } from "../logger.js"
import type { SshAuthRef, SshHostProfile } from "./target-types.js"
import { expandTildePath, expandUserPath } from "./ssh-host-config-helpers.js"
import { getConfigDir, getProfilesDir } from "./xdg-paths.js"
import { SshHostProfileSchema, SshProfileOverlaySchema, expandEnvVars, expandTildeInObject } from "./config-schema.js"
import { parseSshConfig, findSshConfigEntry } from "./ssh-config-parser.js"

// 重新导出辅助函数，保持向后兼容（其他模块从本文件导入 expandTildePath/expandUserPath）
export { expandTildePath, expandUserPath } from "./ssh-host-config-helpers.js"

const FORBIDDEN_SECRET_KEYS = new Set(["password", "privateKey", "privateKeyContent", "token"])

let cachedConfigPath: string | null = null
let cachedProfiles: Map<string, SshHostProfile> | null = null

/** hosts.json 顶层结构，保留给外部模块共享。 */
export type SshHostsConfig = {
  hosts: Record<string, SshHostProfile>
}

/** 测试和显式重新加载时使用：清空 singleton cache。 */
export function clearHostsConfigCache(): void {
  cachedConfigPath = null
  cachedProfiles = null
}

/**
 * 当前配置路径：环境变量优先，否则使用 XDG 默认路径。
 *
 * TERMINAL_USE_HOSTS_CONFIG → 旧格式 paths.json 兼容
 * TERMINAL_USE_CONFIG_DIR → 新格式 XDG 配置目录
 * 默认 → $XDG_CONFIG_HOME/terminal-use-mcp/
 */
export function getHostsConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  // 旧格式环境变量兼容（hosts.json 路径）
  const hostsConfig = env.TERMINAL_USE_HOSTS_CONFIG
  if (hostsConfig !== undefined && hostsConfig.trim().length > 0) {
    return expandTildePath(hostsConfig.trim())
  }

  // 新格式：XDG 配置目录下的 profiles/ 不再是单文件，但返回目录路径
  // 上层 loadHostsConfig 会自动检测文件 vs 目录模式
  const configDir = getConfigDir(env)
  return configDir
}

/**
 * 加载 SSH profiles（主入口）。
 *
 * 加载流程：
 * 1. 如果指定了旧格式 hosts.json 路径（TERMINAL_USE_HOSTS_CONFIG）→ 直接加载
 * 2. 否则尝试 XDG 配置目录：
 *    a. profiles/<name>.json → 新格式 overlay 文件
 *    b. hosts.json → 旧格式兼容文件（如果 profiles/ 目录为空）
 * 3. 对含 sshConfigHost 的 profile，从 OpenSSH config 解析连接参数
 * 4. 对所有路径值做 ~ 展开和 ${ENV_VAR} 展开
 */
export async function loadHostsConfig(configPath?: string, env: NodeJS.ProcessEnv = process.env): Promise<Map<string, SshHostProfile>> {
  const resolvedPath = expandTildePath(configPath ?? getHostsConfigPath(env))

  // 缓存只按最终路径命中；环境变量切换到不同路径时会自动 bust
  if (cachedConfigPath === resolvedPath && cachedProfiles !== null) {
    return cloneProfileMap(cachedProfiles)
  }

  let profiles: Map<string, SshHostProfile>

  // 判断是旧格式文件路径还是新格式目录路径
  const isLegacyFilePath = resolvedPath.endsWith(".json")
  if (isLegacyFilePath) {
    profiles = await loadLegacyHostsJson(resolvedPath, env)
  } else {
    profiles = await loadXdgConfigDir(resolvedPath, env)
  }

  // 对含 sshConfigHost 的 profile，从 OpenSSH config 合并连接参数
  const sshConfig = await parseSshConfig()
  profiles = mergeSshConfigProfiles(profiles, sshConfig)

  // 统一为缺少 knownHosts 的 profile 填充平台默认值 ~/.ssh/known_hosts
  applyKnownHostsDefault(profiles)

  cachedConfigPath = resolvedPath
  cachedProfiles = profiles
  return cloneProfileMap(profiles)
}

/**
 * 加载旧格式 hosts.json 文件（向后兼容）。
 * 支持两种顶层格式：{ hosts: { name: profile } } 和 { name: profile }（直接 record）。
 */
async function loadLegacyHostsJson(filePath: string, env: NodeJS.ProcessEnv): Promise<Map<string, SshHostProfile>> {
  let raw: string
  try {
    raw = await readFile(filePath, "utf8")
  } catch (error) {
    if (hasNodeErrorCode(error, "ENOENT")) {
      logger.warn("SSH hosts config not found; continuing with empty profile map", { path: filePath })
      return new Map()
    }
    throw new Error(`Failed to read SSH hosts config at ${filePath}: ${formatUnknownError(error)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Invalid hosts config JSON at ${filePath}: ${formatUnknownError(error)}`)
  }

  // 展开 ${ENV_VAR} 占位符和 ~ 路径
  const expanded = expandEnvVars(parsed, env)
  const tildeExpanded = expandTildeInObject(expanded)

  return parseHostsConfig(tildeExpanded, filePath)
}

/**
 * 加载新格式 XDG 配置目录下的所有 profiles。
 *
 * 1. 扫描 profiles/<name>.json → overlay 文件
 * 2. 如果 profiles/ 为空，fallback 到同目录下的 hosts.json
 */
async function loadXdgConfigDir(configDir: string, env: NodeJS.ProcessEnv): Promise<Map<string, SshHostProfile>> {
  const profilesDir = join(configDir, "profiles")

  // 尝试加载 profiles/*.json overlay 文件
  const overlayProfiles = await loadProfileOverlays(profilesDir, env)
  if (overlayProfiles.size > 0) {
    logger.info("Loaded SSH profiles from overlay files", {
      profilesDir,
      count: overlayProfiles.size,
    })
    return overlayProfiles
  }

  // Fallback：profiles/ 目录为空或不存在，尝试旧格式 hosts.json
  const hostsJsonPath = join(configDir, "hosts.json")
  if (existsSync(hostsJsonPath)) {
    logger.info("Falling back to legacy hosts.json", { path: hostsJsonPath })
    return loadLegacyHostsJson(hostsJsonPath, env)
  }

  // 都没有 → 空配置
  logger.info("No SSH profiles found in XDG config dir", { configDir })
  return new Map()
}

/**
 * 加载 profiles/ 目录下的所有 JSON overlay 文件。
 *
 * 每个文件名（去掉 .json 后缀）作为 profile name。
 * 文件内容是 SshProfileOverlaySchema 格式（增量 overlay）。
 * 如果 overlay 缺少 host/port/username/auth（使用 sshConfigHost 模式时正常），
 * 则保留为空/默认值——后续 mergeSshConfigProfiles 会填充。
 */
async function loadProfileOverlays(profilesDir: string, env: NodeJS.ProcessEnv): Promise<Map<string, SshHostProfile>> {
  if (!existsSync(profilesDir)) {
    return new Map()
  }

  let entries: string[]
  try {
    entries = await readdir(profilesDir)
  } catch {
    return new Map()
  }

  const jsonFiles = entries.filter((name) => name.endsWith(".json"))
  const result = new Map<string, SshHostProfile>()

  for (const fileName of jsonFiles) {
    const profileName = fileName.slice(0, -5) // 去掉 .json
    const filePath = join(profilesDir, fileName)

    let raw: string
    try {
      raw = await readFile(filePath, "utf8")
    } catch (error) {
      logger.warn("Failed to read profile overlay", { path: filePath, error: formatUnknownError(error) })
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      logger.warn("Invalid profile overlay JSON", { path: filePath, error: formatUnknownError(error) })
      continue
    }

    const expanded = expandEnvVars(parsed, env)
    const tildeExpanded = expandTildeInObject(expanded)

    const validationResult = SshProfileOverlaySchema.safeParse(tildeExpanded)
    if (!validationResult.success) {
      logger.warn("Profile overlay validation failed", {
        path: filePath,
        errors: validationResult.error.errors.map((e) => e.message).join("; "),
      })
      continue
    }

    const overlay = validationResult.data
    const profile = overlayToProfile(profileName, overlay)
    result.set(profileName, profile)
  }

  return result
}

/**
 * 将 overlay 转换为完整 SshHostProfile。
 *
 * overlay 模式下，host/port/username/auth 可能为空（靠 sshConfigHost 填充）。
 * 这里先填默认值，后续 mergeSshConfigProfiles 会用 SSH config 覆盖。
 */
function overlayToProfile(name: string, overlay: Record<string, unknown>): SshHostProfile {
  const auth = parseAuthFromOverlay(overlay.auth, name)

  return {
    name,
    sshConfigHost: typeof overlay.sshConfigHost === "string" ? overlay.sshConfigHost : undefined,
    host: typeof overlay.host === "string" ? overlay.host : "",
    port: typeof overlay.port === "number" ? overlay.port : 0,
    username: typeof overlay.username === "string" ? overlay.username : "",
    auth,
    knownHosts: typeof overlay.knownHosts === "string" ? overlay.knownHosts : undefined,
    pinnedHostFingerprint: typeof overlay.pinnedHostFingerprint === "string" ? overlay.pinnedHostFingerprint : undefined,
    defaultCwd: typeof overlay.defaultCwd === "string" ? overlay.defaultCwd : undefined,
    remoteAllowedCwd: Array.isArray(overlay.remoteAllowedCwd)
      ? overlay.remoteAllowedCwd.filter((v: unknown) => typeof v === "string") as string[]
      : [],
    remoteDeniedCwd: Array.isArray(overlay.remoteDeniedCwd)
      ? overlay.remoteDeniedCwd.filter((v: unknown) => typeof v === "string") as string[]
      : undefined,
    allowTmux: typeof overlay.allowTmux === "boolean" ? overlay.allowTmux : undefined,
    env: isStringRecord(overlay.env) ? overlay.env : undefined,
    connectTimeoutMs: typeof overlay.connectTimeoutMs === "number" ? overlay.connectTimeoutMs : undefined,
    keepaliveIntervalMs: typeof overlay.keepaliveIntervalMs === "number" ? overlay.keepaliveIntervalMs : undefined,
  }
}

/**
 * 从 overlay 数据中解析 auth。
 * 如果 overlay 没有 auth 字段（sshConfigHost 模式下正常），默认为 agent 自动发现。
 */
function parseAuthFromOverlay(authValue: unknown, profileName: string): SshAuthRef {
  if (!isRecord(authValue)) {
    // 无 auth → 默认 agent 自动发现
    return { type: "agent" }
  }

  if (authValue.type === "password") {
    throw new Error(`SSH profile "${profileName}" uses forbidden auth.type "password"`)
  }

  if (authValue.type === "agent") {
    return { type: "agent", socket: typeof authValue.socket === "string" ? expandTildePath(authValue.socket) : undefined }
  }

  if (authValue.type === "key-file") {
    return {
      type: "key-file",
      path: typeof authValue.path === "string" ? expandTildePath(authValue.path) : "",
      passphraseEnv: typeof authValue.passphraseEnv === "string" ? authValue.passphraseEnv : undefined,
    }
  }

  // 未知 auth type → 默认 agent
  return { type: "agent" }
}

/**
 * 将 OpenSSH config 的连接参数合并到含 sshConfigHost 的 profile。
 *
 * 当 profile 有 sshConfigHost 字段时，从 SSH config 解析 Host/Port/User/IdentityFile，
 * 覆盖 profile 中的默认值。如果 SSH config 中找不到对应 Host，保留 profile 原有值
 * （可能为空字符串——上层会拒绝不完整的 profile）。
 */
function mergeSshConfigProfiles(
  profiles: Map<string, SshHostProfile>,
  sshConfig: Map<string, import("./ssh-config-parser.js").SshConfigEntry>,
): Map<string, SshHostProfile> {
  const result = new Map<string, SshHostProfile>()

  for (const [name, profile] of profiles) {
    if (profile.sshConfigHost === undefined || profile.sshConfigHost.trim().length === 0) {
      // 无 sshConfigHost → 不合并，原样保留
      result.set(name, profile)
      continue
    }

    const sshEntry = findSshConfigEntry(profile.sshConfigHost, sshConfig)
    if (sshEntry === undefined) {
      logger.warn("SSH config host not found in ~/.ssh/config", {
        profile: name,
        sshConfigHost: profile.sshConfigHost,
      })
      result.set(name, profile)
      continue
    }

    // SSH config 覆盖空值：只有 profile 中该字段为空/0 时才从 SSH config 填充
    // knownHosts 默认值：profile > SSH config UserKnownHostsFile > ~/.ssh/known_hosts
    // 反直觉说明：knownHosts 是 SSH 安全必需字段，缺省时 ssh-pty provider 无法校验 host key，
    // 会导致 SshHostKeyUnknownError。因此必须提供平台默认值 ~/.ssh/known_hosts。
    const defaultKnownHosts = join(homedir(), ".ssh", "known_hosts")
    const merged: SshHostProfile = {
      ...profile,
      host: profile.host || sshEntry.hostName,
      port: profile.port || sshEntry.port,
      username: profile.username || sshEntry.username || "",
      knownHosts: profile.knownHosts || sshEntry.userKnownHostsFile || defaultKnownHosts,
    }

    // 如果 profile auth 是默认 agent 且 SSH config 有 IdentityFile → 改为 key-file
    if (profile.auth.type === "agent" && sshEntry.identityFiles.length > 0) {
      // 不自动改 auth —— 用户明确选了 agent 就用 agent
      // 但如果 profile host/port/username 都为空，说明是纯 overlay 模式
      if (profile.auth.type === "agent" && sshEntry.identityFiles.length > 0 && profile.host === "" && profile.port === 0) {
        // 纯 overlay + sshConfigHost 且 SSH config 有 IdentityFile → 使用 key-file
        merged.auth = {
          type: "key-file",
          path: sshEntry.identityFiles[0],
        }
      }
    }

    // 保留 SSH config 的 ProxyJump 信息（作为环境变量传递给 ssh2）
    if (sshEntry.proxyJump !== undefined && merged.env === undefined) {
      merged.env = {}
    }
    if (sshEntry.proxyJump !== undefined && merged.env !== undefined) {
      merged.env.SSH_PROXY_JUMP = sshEntry.proxyJump
    }

    result.set(name, merged)
  }

  return result
}

/** 为缺少 knownHosts 且没有 pinnedHostFingerprint 的 profile 填充 ~/.ssh/known_hosts 默认值 */
function applyKnownHostsDefault(profiles: Map<string, SshHostProfile>): void {
  const defaultPath = join(homedir(), ".ssh", "known_hosts")
  for (const [name, profile] of profiles) {
    if (profile.knownHosts === undefined && profile.pinnedHostFingerprint === undefined) {
      profile.knownHosts = defaultPath
      logger.debug("Applied default knownHosts to profile", { profile: name, path: defaultPath })
    }
  }
}

// ── 旧格式解析（保留向后兼容） ───────────────────────────────

function parseHostsConfig(value: unknown, sourcePath: string): Map<string, SshHostProfile> {
  const entries = extractProfileEntries(value, sourcePath)
  const result = new Map<string, SshHostProfile>()

  for (const entry of entries) {
    const profile = validateLegacyProfile(entry.value, entry.fallbackName, sourcePath)
    if (result.has(profile.name)) {
      throw new Error(`Duplicate SSH profile name "${profile.name}" in ${sourcePath}`)
    }
    result.set(profile.name, profile)
  }

  return result
}

type RawProfileEntry = {
  fallbackName?: string
  value: unknown
}

function extractProfileEntries(value: unknown, sourcePath: string): RawProfileEntry[] {
  if (Array.isArray(value)) {
    return value.map((item) => ({ value: item }))
  }

  if (!isRecord(value)) {
    throw new Error(`SSH hosts config at ${sourcePath} must be an array or an object with a hosts field`)
  }

  if (value.hosts === undefined) {
    const objectEntries = Object.entries(value)
    return objectEntries.length === 0 ? [] : objectEntries.map(([name, item]) => ({ fallbackName: name, value: item }))
  }

  if (Array.isArray(value.hosts)) {
    return value.hosts.map((item) => ({ value: item }))
  }

  if (isRecord(value.hosts)) {
    return Object.entries(value.hosts).map(([name, item]) => ({ fallbackName: name, value: item }))
  }

  throw new Error(`SSH hosts config at ${sourcePath} has invalid hosts field; expected array or object`)
}

function validateLegacyProfile(value: unknown, fallbackName: string | undefined, sourcePath: string): SshHostProfile {
  if (!isRecord(value)) {
    throw new Error(`Invalid SSH profile in ${sourcePath}: profile must be an object`)
  }

  ensureNoForbiddenSecretKeys(value, `profile ${fallbackName ?? "<unknown>"}`)

  // 旧格式 hosts.json 用 record key 作为 profile name（不含显式 name 字段），
  // 需要注入 fallbackName 到 value 中再传给 Zod，否则 Zod 会因 name required 报错
  const inputWithFallback = { name: fallbackName, ...value }

  // 使用 Zod schema 校验（新：类型安全 + 约束更精确）
  const result = SshHostProfileSchema.safeParse(inputWithFallback)
  if (!result.success) {
    const errorSummary = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")
    throw new Error(`SSH profile "${fallbackName ?? "<unknown>"}" validation failed in ${sourcePath}: ${errorSummary}`)
  }

  return result.data
}

function ensureNoForbiddenSecretKeys(value: Record<string, unknown>, label: string): void {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_SECRET_KEYS.has(key)) {
      throw new Error(`${label} contains forbidden credential field "${key}"`)
    }
  }
}

// ── 通用工具函数 ──────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false
  return Object.values(value).every((v) => typeof v === "string")
}

function hasNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function cloneProfileMap(input: Map<string, SshHostProfile>): Map<string, SshHostProfile> {
  return new Map([...input.entries()].map(([name, profile]) => [name, cloneProfile(profile)]))
}

function cloneAuth(auth: SshAuthRef): SshAuthRef {
  return auth.type === "agent"
    ? { type: "agent", socket: auth.socket }
    : { type: "key-file", path: auth.path, passphraseEnv: auth.passphraseEnv }
}

function cloneProfile(profile: SshHostProfile): SshHostProfile {
  return {
    ...profile,
    auth: cloneAuth(profile.auth),
    remoteAllowedCwd: [...profile.remoteAllowedCwd],
    remoteDeniedCwd: profile.remoteDeniedCwd === undefined ? undefined : [...profile.remoteDeniedCwd],
    env: profile.env === undefined ? undefined : { ...profile.env },
  }
}
