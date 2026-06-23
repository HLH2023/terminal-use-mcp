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
import { resolveProvidersFromPreset } from "./capability-preset.js"

/** 所有已知 provider 名称，用于 enabledProviders 默认值 */
const ALL_PROVIDER_NAMES: ProviderName[] = ["native-pty", "tmux", "ssh-pty", "ssh-tmux"]

/** 能力预设：控制 provider/tool 自动组合 */
export type CapabilityPreset = "local" | "remote" | "persistent" | "remote-persistent" | "full" | "custom"
/** 工具配置预设：控制注册的工具集 */
export type ToolProfile = "auto" | "minimal" | "local-tui" | "remote-tui" | "persistent-tui" | "full" | "custom"
/** SSH agent socket 发现模式 */
export type SshAgentDiscoveryMode = "env-only" | "xdg" | "scan"
/** 秘密环境变量策略 */
export type SecretEnvPolicy = "deny" | "warn" | "allow"
/** Session ID 匹配模式 */
export type SessionIdMatchMode = "strict" | "lenient"

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
  /** 能力预设 */
  capabilityPreset: CapabilityPreset
  /** 工具配置预设 */
  toolProfile: ToolProfile
  /** 显式启用的工具列表 */
  enabledTools: string[]
  /** 额外追加的工具列表 */
  extraTools: string[]
  /** 禁用的工具列表 */
  disabledTools: string[]
  /** SSH agent socket 发现模式 */
  sshAgentDiscoveryMode: SshAgentDiscoveryMode
  /** 秘密环境变量策略 */
  secretEnvPolicy: SecretEnvPolicy
  /** Session ID 匹配模式 */
  sessionIdMatchMode: SessionIdMatchMode
  /** 是否启用审计日志 */
  auditLogEnabled: boolean
  /** wait_for_text 默认超时（毫秒），AI 可通过 timeoutMs 参数覆盖 */
  defaultWaitForTextTimeoutMs: number
  /** wait_stable 默认超时（毫秒），AI 可通过 timeoutMs 参数覆盖 */
  defaultWaitStableTimeoutMs: number
  /** wait_stable 默认 idle 窗口（毫秒），AI 可通过 idleMs 参数覆盖 */
  defaultWaitStableIdleMs: number
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
    capabilityPreset?: CapabilityPreset
    toolProfile?: ToolProfile
    tools?: string[]
    extraTools?: string[]
    disabledTools?: string[]
    sshAgentDiscoveryMode?: SshAgentDiscoveryMode
    secretEnvPolicy?: SecretEnvPolicy
    sessionIdMatchMode?: SessionIdMatchMode
    auditLogEnabled?: boolean
    defaultWaitForTextTimeoutMs?: number
    defaultWaitStableTimeoutMs?: number
    defaultWaitStableIdleMs?: number
  }
  sshDefaults?: {
    remoteDeniedCwd?: string[]
    allowTmux?: boolean
    connectTimeoutMs?: number
    keepaliveIntervalMs?: number
    agentDiscoveryMode?: SshAgentDiscoveryMode
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

const VALID_CAPABILITY_PRESETS = new Set<CapabilityPreset>(["local", "remote", "persistent", "remote-persistent", "full", "custom"])
const VALID_TOOL_PROFILES = new Set<ToolProfile>(["auto", "minimal", "local-tui", "remote-tui", "persistent-tui", "full", "custom"])
const VALID_SSH_AGENT_DISCOVERY_MODES = new Set<SshAgentDiscoveryMode>(["env-only", "xdg", "scan"])
const VALID_SECRET_ENV_POLICIES = new Set<SecretEnvPolicy>(["deny", "warn", "allow"])
const VALID_SESSION_ID_MATCH_MODES = new Set<SessionIdMatchMode>(["strict", "lenient"])

/**
 * 通用枚举配置解析：环境变量 > 配置文件 > 默认值。
 *
 * 环境变量做大小写无关归一化，非法值 warn 并 fallback。
 */
function parseEnumWithFallback<T extends string>(
  envValue: string | undefined,
  fileValue: T | undefined,
  validValues: ReadonlySet<T>,
  fallback: T,
  envVarName: string,
): T {
  if (envValue !== undefined && envValue.trim().length > 0) {
    const normalized = envValue.trim().toLowerCase() as T
    if (validValues.has(normalized)) return normalized
    logger.warn(`${envVarName}: invalid value "${envValue}", falling back to "${fallback}"`, { validValues: Array.from(validValues) })
    return fallback
  }
  if (fileValue !== undefined && validValues.has(fileValue)) return fileValue
  return fallback
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

  // 解析 capabilityPreset（需要在 enabledProviders 之前，因为 preset 影响 provider 选择）
  // 区分「未显式设置」与「显式设置为 local」：未设置时 preset=undefined，保留全量 provider 的向后兼容行为
  const envPresetRaw = env.TERMINAL_USE_CAPABILITY_PRESET?.trim() ?? ""
  const isCapabilityPresetExplicit = envPresetRaw.length > 0 || local?.capabilityPreset !== undefined
  const capabilityPreset = parseEnumWithFallback(
    env.TERMINAL_USE_CAPABILITY_PRESET,
    local?.capabilityPreset,
    VALID_CAPABILITY_PRESETS,
    "local",
    "TERMINAL_USE_CAPABILITY_PRESET",
  )
  const capabilityPresetForProviders = isCapabilityPresetExplicit ? capabilityPreset : undefined

  // 同理：toolProfile 未显式设置时，向后兼容=全部 tools
  const envToolProfileRaw = env.TERMINAL_USE_TOOL_PROFILE?.trim() ?? ""
  const isToolProfileExplicit = envToolProfileRaw.length > 0 || local?.toolProfile !== undefined
  const toolProfile = parseEnumWithFallback(
    env.TERMINAL_USE_TOOL_PROFILE,
    local?.toolProfile,
    VALID_TOOL_PROFILES,
    "auto",
    "TERMINAL_USE_TOOL_PROFILE",
  )
  const toolProfileForRegistry = isToolProfileExplicit ? toolProfile : "full"

  // 分层合并：文件默认值 → 环境变量覆盖
  const enabledProviders = parseEnabledProviders(
    env.TERMINAL_USE_PROVIDERS,
    local?.providers,
    capabilityPresetForProviders,
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
    capabilityPreset,
    toolProfile: toolProfileForRegistry,
    enabledTools: splitCsv(env.TERMINAL_USE_TOOLS).length > 0 ? splitCsv(env.TERMINAL_USE_TOOLS) : local?.tools ?? [],
    extraTools: splitCsv(env.TERMINAL_USE_EXTRA_TOOLS).length > 0 ? splitCsv(env.TERMINAL_USE_EXTRA_TOOLS) : local?.extraTools ?? [],
    disabledTools: splitCsv(env.TERMINAL_USE_DISABLED_TOOLS).length > 0 ? splitCsv(env.TERMINAL_USE_DISABLED_TOOLS) : local?.disabledTools ?? [],
    sshAgentDiscoveryMode: parseEnumWithFallback(env.TERMINAL_USE_SSH_AGENT_DISCOVERY, sshDefaults?.agentDiscoveryMode ?? local?.sshAgentDiscoveryMode, VALID_SSH_AGENT_DISCOVERY_MODES, "xdg", "TERMINAL_USE_SSH_AGENT_DISCOVERY"),
    secretEnvPolicy: parseEnumWithFallback(env.TERMINAL_USE_SECRET_ENV_POLICY, local?.secretEnvPolicy, VALID_SECRET_ENV_POLICIES, "deny", "TERMINAL_USE_SECRET_ENV_POLICY"),
    sessionIdMatchMode: parseEnumWithFallback(env.TERMINAL_USE_SESSION_ID_MATCH, local?.sessionIdMatchMode, VALID_SESSION_ID_MATCH_MODES, "lenient", "TERMINAL_USE_SESSION_ID_MATCH"),
    auditLogEnabled: env.TERMINAL_USE_AUDIT_LOG !== undefined ? env.TERMINAL_USE_AUDIT_LOG === "1" : local?.auditLogEnabled ?? true,
    defaultWaitForTextTimeoutMs: env.TERMINAL_USE_DEFAULT_WAIT_FOR_TEXT_TIMEOUT_MS !== undefined
      ? parseInt(env.TERMINAL_USE_DEFAULT_WAIT_FOR_TEXT_TIMEOUT_MS, 10)
      : local?.defaultWaitForTextTimeoutMs ?? 10_000,
    defaultWaitStableTimeoutMs: env.TERMINAL_USE_DEFAULT_WAIT_STABLE_TIMEOUT_MS !== undefined
      ? parseInt(env.TERMINAL_USE_DEFAULT_WAIT_STABLE_TIMEOUT_MS, 10)
      : local?.defaultWaitStableTimeoutMs ?? 5_000,
    defaultWaitStableIdleMs: env.TERMINAL_USE_DEFAULT_WAIT_STABLE_IDLE_MS !== undefined
      ? parseInt(env.TERMINAL_USE_DEFAULT_WAIT_STABLE_IDLE_MS, 10)
      : local?.defaultWaitStableIdleMs ?? 500,
  }

  return { ...config, ...overrides }
}

/**
 * 解析启用的 provider 列表。
 *
 * 优先级：环境变量 TERMINAL_USE_PROVIDERS > config.json local.providers > capabilityPreset > 全部启用
 * 环境变量格式：逗号分隔，如 "native-pty,tmux"
 * 无效名称会被过滤并输出 warn 日志
 */
function parseEnabledProviders(
  envValue: string | undefined,
  fileValue: string[] | undefined,
  preset?: CapabilityPreset,
): ProviderName[] {
  // 1. TERMINAL_USE_PROVIDERS 显式设置 → 最高优先级
  const raw = envValue?.trim() ?? ""
  if (raw.length > 0) {
    return splitCsv(raw).filter((name): name is ProviderName => {
      if (ALL_PROVIDER_NAMES.includes(name as ProviderName)) return true
      logger.warn(`TERMINAL_USE_PROVIDERS: unknown provider "${name}", ignoring`)
      return false
    })
  }
  // 2. config.json local.providers
  if (fileValue !== undefined && fileValue.length > 0) {
    return fileValue.filter((name): name is ProviderName => {
      if (ALL_PROVIDER_NAMES.includes(name as ProviderName)) return true
      logger.warn(`config.json local.providers: unknown provider "${name}", ignoring`)
      return false
    })
  }
  // 3. Capability preset 映射
  if (preset && preset !== "custom") {
    return resolveProvidersFromPreset(preset)
  }
  // 4. 默认全部启用
  return [...ALL_PROVIDER_NAMES]
}
