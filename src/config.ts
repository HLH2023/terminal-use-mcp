/**
 * 配置管理
 *
 * 配置分层（优先级从高到低）：
 * 1. 环境变量 — 终极覆盖
 * 2. XDG config.json — 持久化配置文件
 * 3. 代码内默认值 — 兜底
 *
 * 新格式 config.json 位于 $XDG_CONFIG_HOME/terminal-use-mcp/config.json，
 * 通过 Zod RootConfigSchema 校验，支持 ${ENV_VAR} 占位符展开。
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { ProviderName } from "./providers/provider.js"
import type { CwdPolicyMode } from "./terminal/command-safety.js"
import { logger } from "./logger.js"
import { getConfigFilePath, ensureConfigDir, getDataDir } from "./targets/xdg-paths.js"
import { RootConfigSchema, expandEnvVars, expandTildeInObject } from "./targets/config-schema.js"

/** 所有已知 provider 名称，用于 enabledProviders 默认值 */
const ALL_PROVIDER_NAMES: ProviderName[] = ["native-pty", "tmux", "ssh-pty", "ssh-tmux"]

export type TerminalUseConfig = {
  workspaceRoot: string
  allowedCwdRoots: string[]
  cwdPolicyMode: CwdPolicyMode
  allowedCommands: string[]
  deniedCommands: string[]
  riskyCommandMode: "deny" | "ask" | "allow"
  sessionTtlMs: number
  cleanupIntervalMs: number
  defaultProvider: ProviderName
  defaultCols: number
  defaultRows: number
  artifactDir: string
  largePasteLimit: number
  hardPasteLimit: number
  logLevel: "debug" | "info" | "warn" | "error"
  hostsConfigPath?: string
  allowInlineSshTargets: boolean
  sshDefaults: SshDefaultsConfig
  /** 启用的 provider 白名单。未设置=全部启用 */
  enabledProviders: ProviderName[]
  /** 是否保存原始（未脱敏）transcript 文件。默认 false — 只保存脱敏版防止泄露秘密。 */
  storeRawTranscript: boolean
}

export type SshDefaultsConfig = {
  remoteDeniedCwd: string[]
  allowTmux: boolean
  connectTimeoutMs: number
  keepaliveIntervalMs: number
}

function splitCsv(value: string | undefined): string[] {
  if (!value) return []
  return value.split(",").map((s) => s.trim()).filter(Boolean)
}

const VALID_CWD_POLICY_MODES = new Set<CwdPolicyMode>(["guarded", "strict"])

/**
 * 解析 CWD 策略模式配置。
 *
 * 优先级：环境变量 > config.json > 代码默认值 ("guarded")
 * 非法环境变量值 → warn + fallback 到 "guarded"（避免拼写错误导致 server 不可用）
 */
function parseCwdPolicyMode(
  envValue: string | undefined,
  fileValue: "guarded" | "strict" | undefined,
): CwdPolicyMode {
  if (envValue !== undefined && envValue.trim().length > 0) {
    const normalized = envValue.trim().toLowerCase() as CwdPolicyMode
    if (VALID_CWD_POLICY_MODES.has(normalized)) {
      return normalized
    }
    logger.warn(`TERMINAL_USE_CWD_POLICY_MODE: invalid value "${envValue}", falling back to "guarded"`, {
      validValues: ["guarded", "strict"],
    })
    return "guarded"
  }
  return fileValue ?? "guarded"
}

/**
 * 从 XDG 路径加载 config.json（如果存在）。
 *
 * 文件不存在 → 返回 undefined（非错误）
 * 文件存在但校验失败 → warn 日志 + 返回 undefined（降级到纯环境变量模式）
 */
function loadConfigFile(configFilePath: string): RootConfigFileData | undefined {
  try {
    const raw = readFileSync(configFilePath, "utf8")
    const parsed: unknown = JSON.parse(raw)
    const expanded = expandEnvVars(parsed)
    const tildeExpanded = expandTildeInObject(expanded)

    const result = RootConfigSchema.safeParse(tildeExpanded)
    if (!result.success) {
      const errorSummary = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")
      logger.warn("config.json validation failed, falling back to env-only mode", {
        path: configFilePath,
        errors: errorSummary,
      })
      return undefined
    }

    logger.info("Loaded config.json", { path: configFilePath })
    return result.data
  } catch (error) {
    const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined
    if (code === "ENOENT" || code === "EISDIR") {
      return undefined
    }
    if (error instanceof SyntaxError) {
      logger.warn("config.json has invalid JSON, falling back to env-only mode", {
        path: configFilePath,
        error: error.message,
      })
      return undefined
    }
    logger.warn("Failed to read config.json, falling back to env-only mode", {
      path: configFilePath,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

type RootConfigFileData = {
  version?: number
  local?: {
    workspaceRoot?: string
    allowedCwdRoots?: string[]
    cwdPolicyMode?: "guarded" | "strict"
    allowedCommands?: string[]
    deniedCommands?: string[]
    riskyCommandMode?: "deny" | "ask" | "allow"
    sessionTtlMs?: number
    cleanupIntervalMs?: number
    defaultCols?: number
    defaultRows?: number
    artifactDir?: string
    logLevel?: "debug" | "info" | "warn" | "error"
    providers?: string[]
  }
  sshDefaults?: {
    remoteDeniedCwd?: string[]
    allowTmux?: boolean
    connectTimeoutMs?: number
    keepaliveIntervalMs?: number
  }
}

/**
 * splitCsv 环境变量与文件默认值合并。
 *
 * 环境变量设置了非空值 → 使用环境变量
 * 环境变量未设置或为空 → 使用文件默认值
 * 文件默认值也没有 → 使用兜底值
 */
function mergeCsvWithFileDefault(envValue: string | undefined, fileValue: string[] | undefined, fallback: string[]): string[] {
  if (envValue !== undefined && envValue.trim().length > 0) {
    return splitCsv(envValue)
  }
  return fileValue ?? fallback
}

export function loadConfig(overrides?: Partial<TerminalUseConfig>): TerminalUseConfig {
  const env = process.env

  // 确保 XDG 配置目录存在（0700）
  ensureConfigDir()

  // 加载 config.json（可选）
  const configFilePath = getConfigFilePath()
  const fileConfig = loadConfigFile(configFilePath)
  const local = fileConfig?.local
  const sshDefaults = fileConfig?.sshDefaults

  // 分层合并：文件默认值 → 环境变量覆盖
  const enabledProviders = parseEnabledProviders(
    env.TERMINAL_USE_PROVIDERS,
    local?.providers,
  )
  const config: TerminalUseConfig = {
    workspaceRoot: env.TERMINAL_USE_WORKSPACE_ROOT ?? local?.workspaceRoot ?? process.cwd(),
    allowedCwdRoots: mergeCsvWithFileDefault(env.TERMINAL_USE_ALLOWED_CWD, local?.allowedCwdRoots, []),
    cwdPolicyMode: parseCwdPolicyMode(env.TERMINAL_USE_CWD_POLICY_MODE, local?.cwdPolicyMode),
    allowedCommands: mergeCsvWithFileDefault(env.TERMINAL_USE_ALLOW_COMMANDS, local?.allowedCommands, []),
    deniedCommands: mergeCsvWithFileDefault(env.TERMINAL_USE_DENY_COMMANDS, local?.deniedCommands, []),
    riskyCommandMode: (env.TERMINAL_USE_RISKY_COMMAND_MODE as "deny" | "ask" | "allow") ?? local?.riskyCommandMode ?? "deny",
    sessionTtlMs: env.TERMINAL_USE_SESSION_TTL_MS !== undefined
      ? parseInt(env.TERMINAL_USE_SESSION_TTL_MS, 10)
      : local?.sessionTtlMs ?? 3600000,
    cleanupIntervalMs: env.TERMINAL_USE_CLEANUP_INTERVAL_MS !== undefined
      ? parseInt(env.TERMINAL_USE_CLEANUP_INTERVAL_MS, 10)
      : local?.cleanupIntervalMs ?? 60000,
    defaultProvider: (env.TERMINAL_USE_DEFAULT_PROVIDER as ProviderName) ?? "native-pty",
    defaultCols: env.TERMINAL_USE_DEFAULT_COLS !== undefined
      ? parseInt(env.TERMINAL_USE_DEFAULT_COLS, 10)
      : local?.defaultCols ?? 120,
    defaultRows: env.TERMINAL_USE_DEFAULT_ROWS !== undefined
      ? parseInt(env.TERMINAL_USE_DEFAULT_ROWS, 10)
      : local?.defaultRows ?? 30,
    artifactDir: env.TERMINAL_USE_ARTIFACT_DIR ?? local?.artifactDir ?? join(getDataDir(env), "artifacts"),
    largePasteLimit: env.TERMINAL_USE_LARGE_PASTE_LIMIT !== undefined
      ? parseInt(env.TERMINAL_USE_LARGE_PASTE_LIMIT, 10)
      : 2000,
    hardPasteLimit: env.TERMINAL_USE_HARD_PASTE_LIMIT !== undefined
      ? parseInt(env.TERMINAL_USE_HARD_PASTE_LIMIT, 10)
      : 10000,
    logLevel: (env.TERMINAL_USE_LOG_LEVEL as TerminalUseConfig["logLevel"]) ?? local?.logLevel ?? "info",
    hostsConfigPath: env.TERMINAL_USE_HOSTS_CONFIG,
    allowInlineSshTargets: env.TERMINAL_USE_ALLOW_INLINE_SSH_TARGETS === "1",
    storeRawTranscript: env.TERMINAL_USE_STORE_RAW_TRANSCRIPT === "1",
    sshDefaults: {
      remoteDeniedCwd: sshDefaults?.remoteDeniedCwd ?? ["/", "/root", "/etc", "/boot", "/proc", "/sys"],
      allowTmux: sshDefaults?.allowTmux ?? true,
      connectTimeoutMs: sshDefaults?.connectTimeoutMs ?? 10000,
      keepaliveIntervalMs: sshDefaults?.keepaliveIntervalMs ?? 15000,
    },
    enabledProviders,
  }

  return { ...config, ...overrides }
}

/**
 * 解析启用的 provider 列表。
 *
 * 优先级：环境变量 TERMINAL_USE_PROVIDERS > config.json local.providers > 全部启用
 * 环境变量格式：逗号分隔，如 "native-pty,tmux"
 * 无效名称会被过滤并输出 warn 日志
 */
function parseEnabledProviders(
  envValue: string | undefined,
  fileValue: string[] | undefined,
): ProviderName[] {
  const raw = envValue?.trim() ?? ""
  if (raw.length > 0) {
    return splitCsv(raw).filter((name): name is ProviderName => {
      if (ALL_PROVIDER_NAMES.includes(name as ProviderName)) return true
      logger.warn(`TERMINAL_USE_PROVIDERS: unknown provider "${name}", ignoring`)
      return false
    })
  }
  if (fileValue !== undefined && fileValue.length > 0) {
    return fileValue.filter((name): name is ProviderName => {
      if (ALL_PROVIDER_NAMES.includes(name as ProviderName)) return true
      logger.warn(`config.json local.providers: unknown provider "${name}", ignoring`)
      return false
    })
  }
  return [...ALL_PROVIDER_NAMES]
}
