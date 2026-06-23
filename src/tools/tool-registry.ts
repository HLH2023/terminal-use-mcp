/**
 * Tool Registry — 根据配置动态决定注册哪些 MCP tools。
 *
 * 用户通过 toolProfile + enabledTools/extraTools/disabledTools 控制工具集，
 * 不需要理解底层 provider。
 */

import type { ToolProfile, CapabilityPreset } from "../config.js"

/** 工具分类 */
export type ToolCategory = "session" | "observation" | "input" | "meta" | "remote" | "tmux"

/** 所有已知 MCP tool 名称（单一事实源） */
export const ALL_TOOL_NAMES = [
  // Session lifecycle (7)
  "terminal.start", "terminal.attach", "terminal.list", "terminal.info",
  "terminal.rename", "terminal.kill", "terminal.cleanup",
  // Observation (5)
  "terminal.snapshot", "terminal.wait_for_text", "terminal.wait_stable",
  "terminal.find", "terminal.scroll",
  // Input (5)
  "terminal.type", "terminal.press", "terminal.paste",
  "terminal.mouse_click", "terminal.mouse_scroll",
  // Meta (7)
  "terminal.resize", "terminal.export_transcript", "terminal.health",
  "terminal.keys", "terminal.provider_capabilities", "terminal.events",
  "terminal.send_signal",
  // Remote (3)
  "terminal.targets", "terminal.target_info", "terminal.verify_target",
  // Tmux (3)
  "terminal.tmux_list", "terminal.tmux_kill", "terminal.tmux_command",
] as const

/** Tool → Category 映射 */
export const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  "terminal.start": "session", "terminal.attach": "session", "terminal.list": "session",
  "terminal.info": "session", "terminal.rename": "session", "terminal.kill": "session",
  "terminal.cleanup": "session",
  "terminal.snapshot": "observation", "terminal.wait_for_text": "observation",
  "terminal.wait_stable": "observation", "terminal.find": "observation",
  "terminal.scroll": "observation",
  "terminal.type": "input", "terminal.press": "input", "terminal.paste": "input",
  "terminal.mouse_click": "input", "terminal.mouse_scroll": "input",
  "terminal.resize": "meta", "terminal.export_transcript": "meta",
  "terminal.health": "meta", "terminal.keys": "meta",
  "terminal.provider_capabilities": "meta", "terminal.events": "meta",
  "terminal.send_signal": "meta",
  "terminal.targets": "remote", "terminal.target_info": "remote",
  "terminal.verify_target": "remote",
  "terminal.tmux_list": "tmux", "terminal.tmux_kill": "tmux",
  "terminal.tmux_command": "tmux",
}

/** Health tool 始终注册，不可禁用 */
export const ALWAYS_REGISTERED_TOOLS = new Set(["terminal.health"])

/** minimal profile — 最小上下文，基础交互 */
export const MINIMAL_TOOLS = new Set([
  "terminal.health", "terminal.start", "terminal.snapshot",
  "terminal.wait_stable", "terminal.type", "terminal.press",
  "terminal.kill", "terminal.list",
])

/** local-tui profile — 常规本地 TUI 控制 */
export const LOCAL_TUI_TOOLS = new Set([
  ...MINIMAL_TOOLS,
  "terminal.wait_for_text", "terminal.find", "terminal.scroll",
  "terminal.paste", "terminal.resize", "terminal.keys",
  "terminal.info", "terminal.export_transcript", "terminal.events",
  "terminal.send_signal", "terminal.mouse_click", "terminal.mouse_scroll",
])

/** remote-tui profile — 远程 SSH TUI 场景 */
export const REMOTE_TUI_TOOLS = new Set([
  ...LOCAL_TUI_TOOLS,
  "terminal.targets", "terminal.target_info", "terminal.verify_target",
  "terminal.provider_capabilities",
])

/** persistent-tui profile — 可恢复 session */
export const PERSISTENT_TUI_TOOLS = new Set([
  ...LOCAL_TUI_TOOLS,
  "terminal.attach", "terminal.rename", "terminal.cleanup",
  "terminal.tmux_list", "terminal.tmux_kill", "terminal.tmux_command",
])

/** full profile — 全部 tools */
export const FULL_TOOLS = new Set(ALL_TOOL_NAMES)

/** Profile → Tool 集合映射 */
const PROFILE_TOOL_SETS: Record<Exclude<ToolProfile, "auto" | "custom">, Set<string>> = {
  minimal: MINIMAL_TOOLS,
  "local-tui": LOCAL_TUI_TOOLS,
  "remote-tui": REMOTE_TUI_TOOLS,
  "persistent-tui": PERSISTENT_TUI_TOOLS,
  full: FULL_TOOLS,
}

/**
 * 根据能力预设解析 auto 工具配置。
 *
 * auto 是默认 toolProfile，根据 capabilityPreset 自动选择最合适的工具集：
 * - local → local-tui
 * - remote → remote-tui
 * - persistent → persistent-tui
 * - remote-persistent → remote-tui + persistent-tui 的并集
 * - full → full
 * - custom → minimal（custom 下应通过 enabledTools 显式指定）
 */
export function resolveAutoProfile(preset: CapabilityPreset): Set<string> {
  switch (preset) {
    case "local": return LOCAL_TUI_TOOLS
    case "remote": return REMOTE_TUI_TOOLS
    case "persistent": return PERSISTENT_TUI_TOOLS
    case "remote-persistent": {
      // remote-tui + persistent-tui 并集
      const merged = new Set(REMOTE_TUI_TOOLS)
      for (const tool of PERSISTENT_TUI_TOOLS) merged.add(tool)
      return merged
    }
    case "full": return FULL_TOOLS
    case "custom": return MINIMAL_TOOLS
  }
}

/** Tool Registry 解析结果 */
export type ToolRegistryResult = {
  /** 最终应注册的工具集合 */
  registeredTools: string[]
  /** 被禁用的工具列表 */
  disabledTools: string[]
  /** 配置警告（不存在的工具名等） */
  configWarnings: string[]
}

/**
 * 解析最终启用的工具集合。
 *
 * 计算逻辑：
 * 1. 根据 toolProfile 选择基础集合（auto 从 capabilityPreset 推导）
 * 2. 如果 enabledTools 非空，进入严格 allowlist 模式（覆盖基础集合）
 * 3. 应用 extraTools 追加
 * 4. 应用 disabledTools 移除
 * 5. terminal.health 始终包含
 * 6. 不存在的工具名 → warn
 */
export function resolveEnabledTools(opts: {
  toolProfile: ToolProfile
  capabilityPreset: CapabilityPreset
  enabledTools: string[]
  extraTools: string[]
  disabledTools: string[]
}): ToolRegistryResult {
  const { toolProfile, capabilityPreset, enabledTools, extraTools, disabledTools } = opts
  const configWarnings: string[] = []
  const validToolSet = new Set<string>(ALL_TOOL_NAMES)

  // Step 1: 基础集合
  let baseSet: Set<string>
  if (toolProfile === "auto") {
    // auto + enabledTools：enabledTools 作为自定义 allowlist，覆盖 auto 推导结果
    if (enabledTools.length > 0) {
      baseSet = new Set(enabledTools)
      configWarnings.push("TERMINAL_USE_TOOLS is set with toolProfile=auto: using TERMINAL_USE_TOOLS as custom allowlist instead of auto-derived profile")
    } else {
      baseSet = resolveAutoProfile(capabilityPreset)
    }
  } else if (toolProfile === "custom") {
    baseSet = enabledTools.length > 0 ? new Set(enabledTools) : MINIMAL_TOOLS
  } else {
    baseSet = PROFILE_TOOL_SETS[toolProfile] ?? MINIMAL_TOOLS
  }

  // Step 2: allowlist 模式（非 auto/custom 时，如果 enabledTools 非空则覆盖）
  if (toolProfile !== "auto" && toolProfile !== "custom" && enabledTools.length > 0) {
    baseSet = new Set(enabledTools)
  }

  // 构建最终集合
  const result = new Set(baseSet)

  // Step 3: extraTools 追加
  for (const tool of extraTools) {
    if (validToolSet.has(tool)) {
      result.add(tool)
    } else {
      configWarnings.push(`TERMINAL_USE_EXTRA_TOOLS: unknown tool "${tool}", ignoring`)
    }
  }

  // Step 4: disabledTools 移除
  for (const tool of disabledTools) {
    if (validToolSet.has(tool)) {
      result.delete(tool)
    } else {
      configWarnings.push(`TERMINAL_USE_DISABLED_TOOLS: unknown tool "${tool}", ignoring`)
    }
  }

  // Step 5: health 始终包含
  result.add("terminal.health")

  // 检查 enabledTools 中的无效名称
  if (enabledTools.length > 0) {
    for (const tool of enabledTools) {
      if (!validToolSet.has(tool)) {
        configWarnings.push(`TERMINAL_USE_TOOLS: unknown tool "${tool}", ignoring`)
      }
    }
  }

  // 计算被禁用的工具
  const disabled = ALL_TOOL_NAMES.filter((name) => !result.has(name))

  return {
    registeredTools: ALL_TOOL_NAMES.filter((name) => result.has(name)),
    disabledTools: disabled,
    configWarnings,
  }
}
