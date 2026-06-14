import { homedir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { getConfigDir, getDataDir, getProfilesDir, getConfigFilePath } from "../../src/targets/xdg-paths.js"

const ENV_KEYS = [
  "TERMINAL_USE_CONFIG_DIR",
  "TERMINAL_USE_DATA_DIR",
  "TERMINAL_USE_CONFIG_FILE",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
] as const

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
})

describe("getConfigDir", () => {
  it("默认返回 ~/.config/terminal-use-mcp", () => {
    const result = getConfigDir()
    expect(result).toBe(join(homedir(), ".config", "terminal-use-mcp"))
  })

  it("TERMINAL_USE_CONFIG_DIR 覆盖一切", () => {
    process.env.TERMINAL_USE_CONFIG_DIR = "/custom/config"
    expect(getConfigDir()).toBe("/custom/config")
  })

  it("TERMINAL_USE_CONFIG_DIR 支持 ~ 展开", () => {
    process.env.TERMINAL_USE_CONFIG_DIR = "~/my-config"
    expect(getConfigDir()).toBe(join(homedir(), "my-config"))
  })

  it("XDG_CONFIG_HOME 生效时追加 APP_NAME 子目录", () => {
    process.env.XDG_CONFIG_HOME = "/xdg/config"
    expect(getConfigDir()).toBe(join("/xdg/config", "terminal-use-mcp"))
  })

  it("TERMINAL_USE_CONFIG_DIR 优先于 XDG_CONFIG_HOME", () => {
    process.env.XDG_CONFIG_HOME = "/xdg/config"
    process.env.TERMINAL_USE_CONFIG_DIR = "/override"
    expect(getConfigDir()).toBe("/override")
  })

  it("空字符串环境变量被忽略", () => {
    process.env.XDG_CONFIG_HOME = "  "
    expect(getConfigDir()).toBe(join(homedir(), ".config", "terminal-use-mcp"))
  })
})

describe("getDataDir", () => {
  it("默认返回 ~/.local/share/terminal-use-mcp", () => {
    expect(getDataDir()).toBe(join(homedir(), ".local", "share", "terminal-use-mcp"))
  })

  it("TERMINAL_USE_DATA_DIR 覆盖一切", () => {
    process.env.TERMINAL_USE_DATA_DIR = "/custom/data"
    expect(getDataDir()).toBe("/custom/data")
  })

  it("XDG_DATA_HOME 生效时追加 APP_NAME 子目录", () => {
    process.env.XDG_DATA_HOME = "/xdg/data"
    expect(getDataDir()).toBe(join("/xdg/data", "terminal-use-mcp"))
  })
})

describe("getProfilesDir", () => {
  it("返回 configDir 下的 profiles 子目录", () => {
    expect(getProfilesDir()).toBe(join(homedir(), ".config", "terminal-use-mcp", "profiles"))
  })

  it("随 configDir 覆盖一起变化", () => {
    process.env.TERMINAL_USE_CONFIG_DIR = "/custom"
    expect(getProfilesDir()).toBe("/custom/profiles")
  })
})

describe("getConfigFilePath", () => {
  it("默认返回 configDir/config.json", () => {
    expect(getConfigFilePath()).toBe(join(homedir(), ".config", "terminal-use-mcp", "config.json"))
  })

  it("TERMINAL_USE_CONFIG_FILE 覆盖路径", () => {
    process.env.TERMINAL_USE_CONFIG_FILE = "/etc/tumcp.json"
    expect(getConfigFilePath()).toBe("/etc/tumcp.json")
  })

  it("TERMINAL_USE_CONFIG_FILE 支持 ~ 展开", () => {
    process.env.TERMINAL_USE_CONFIG_FILE = "~/tumcp.json"
    expect(getConfigFilePath()).toBe(join(homedir(), "tumcp.json"))
  })
})
