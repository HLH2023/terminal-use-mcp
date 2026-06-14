/**
 * XDG Base Directory 路径发现
 *
 * 遵循 XDG Base Directory Specification 0.8.2：
 * - $XDG_CONFIG_HOME → 默认 ~/.config
 * - $XDG_DATA_HOME   → 默认 ~/.local/share
 * - macOS fallback    → ~/Library/Application Support
 *
 * 本工具所有配置文件存放于 XDG_CONFIG_HOME 下的 terminal-use-mcp/ 子目录，
 * 数据文件（artifact、session）存放于 XDG_DATA_HOME 下。
 *
 * 目录创建时强制 0700（仅 owner 可读写执行），防止其他用户窥探 SSH profile。
 */

import { mkdirSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { logger } from "../logger.js"

/** 工具名 — 用于 XDG 子目录名 */
const APP_NAME = "terminal-use-mcp"

/**
 * 获取 XDG 配置目录。
 *
 * 优先级：$XDG_CONFIG_HOME > macOS ~/Library/Application Support > ~/.config
 *
 * 环境变量 TERMINAL_USE_CONFIG_DIR 可覆盖一切（用于测试和显式指定）。
 */
export function getConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  // 最高优先：显式环境变量覆盖
  const explicitDir = env.TERMINAL_USE_CONFIG_DIR
  if (explicitDir !== undefined && explicitDir.trim().length > 0) {
    return expandTilde(explicitDir.trim())
  }

  // XDG 标准路径
  const xdgConfigHome = env.XDG_CONFIG_HOME
  if (xdgConfigHome !== undefined && xdgConfigHome.trim().length > 0) {
    return join(expandTilde(xdgConfigHome.trim()), APP_NAME)
  }

  // macOS fallback：~/Library/Application Support/terminal-use-mcp
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", APP_NAME)
  }

  // Windows fallback：%APPDATA%/terminal-use-mcp
  if (process.platform === "win32") {
    const appData = env.APPDATA
    if (appData !== undefined && appData.trim().length > 0) {
      return join(appData, APP_NAME)
    }
    return join(homedir(), "AppData", "Roaming", APP_NAME)
  }

  // 默认 Linux/其他：~/.config/terminal-use-mcp
  return join(homedir(), ".config", APP_NAME)
}

/**
 * 获取 XDG 数据目录（artifact、session 数据）。
 *
 * 优先级：$XDG_DATA_HOME > macOS ~/Library/Application Support/terminal-use-mcp/data
 * > ~/.local/share/terminal-use-mcp
 */
export function getDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicitDir = env.TERMINAL_USE_DATA_DIR
  if (explicitDir !== undefined && explicitDir.trim().length > 0) {
    return expandTilde(explicitDir.trim())
  }

  const xdgDataHome = env.XDG_DATA_HOME
  if (xdgDataHome !== undefined && xdgDataHome.trim().length > 0) {
    return join(expandTilde(xdgDataHome.trim()), APP_NAME)
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", APP_NAME, "data")
  }

  if (process.platform === "win32") {
    const localAppData = env.LOCALAPPDATA
    if (localAppData !== undefined && localAppData.trim().length > 0) {
      return join(localAppData, APP_NAME)
    }
    return join(homedir(), "AppData", "Local", APP_NAME)
  }

  return join(homedir(), ".local", "share", APP_NAME)
}

/**
 * 获取 SSH profiles overlay 目录。
 *
 * 每个远端 host 一个 JSON 文件，只存放增量策略（CWD policy、allowTmux 等）。
 * SSH 连接参数从 OpenSSH ~/.ssh/config 复用，不重复配置。
 */
export function getProfilesDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(getConfigDir(env), "profiles")
}

/**
 * 获取全局配置文件路径。
 *
 * 终端环境变量仍可用于覆盖：TERMINAL_USE_HOSTS_CONFIG 指向兼容旧格式文件，
 * TERMINAL_USE_CONFIG_FILE 指向新格式 config.json。
 */
export function getConfigFilePath(env: NodeJS.ProcessEnv = process.env): string {
  // 新格式显式路径
  const explicitFile = env.TERMINAL_USE_CONFIG_FILE
  if (explicitFile !== undefined && explicitFile.trim().length > 0) {
    return expandTilde(explicitFile.trim())
  }

  return join(getConfigDir(env), "config.json")
}

/**
 * 确保 XDG 配置目录存在且权限正确（0700）。
 *
 * 目录不存在时自动创建；已存在时检查权限是否安全。
 * 不抛异常——目录创建失败仅警告，让上层自然报错。
 */
export function ensureConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const configDir = getConfigDir(env)

  if (!existsSync(configDir)) {
    try {
      // 0700 = rwx------ ：仅 owner 可读写执行
      mkdirSync(configDir, { recursive: true, mode: 0o700 })
      logger.info("Created XDG config directory", { path: configDir, mode: "0700" })
    } catch (error) {
      logger.warn("Failed to create config directory", {
        path: configDir,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // 确保 profiles 子目录也存在
  const profilesDir = getProfilesDir(env)
  if (!existsSync(profilesDir)) {
    try {
      mkdirSync(profilesDir, { recursive: true, mode: 0o700 })
    } catch (error) {
      logger.warn("Failed to create profiles directory", {
        path: profilesDir,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return configDir
}

/** 将 `~` 开头的路径展开为 os.homedir()。 */
function expandTilde(value: string): string {
  if (value === "~") return homedir()
  if (value.startsWith("~/")) return join(homedir(), value.slice(2))
  return value
}
