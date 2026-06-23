import { describe, it, expect } from "vitest"
import {
  ALL_TOOL_NAMES,
  TOOL_CATEGORIES,
  MINIMAL_TOOLS,
  LOCAL_TUI_TOOLS,
  REMOTE_TUI_TOOLS,
  PERSISTENT_TUI_TOOLS,
  FULL_TOOLS,
  ALWAYS_REGISTERED_TOOLS,
  resolveAutoProfile,
  resolveEnabledTools,
} from "../../src/tools/tool-registry.js"
import type { ToolCategory } from "../../src/tools/tool-registry.js"
import type { CapabilityPreset, ToolProfile } from "../../src/config.js"

describe("ALL_TOOL_NAMES", () => {
  it("包含恰好 30 个工具名称", () => {
    expect(ALL_TOOL_NAMES).toHaveLength(30)
  })

  it("所有名称以 terminal. 开头", () => {
    for (const name of ALL_TOOL_NAMES) {
      expect(name).toMatch(/^terminal\./)
    }
  })
})

describe("TOOL_CATEGORIES", () => {
  it("每个已知工具都有分类映射", () => {
    for (const name of ALL_TOOL_NAMES) {
      expect(TOOL_CATEGORIES[name]).toBeDefined()
    }
  })

  it("分类值均为合法 ToolCategory", () => {
    const validCategories = new Set<ToolCategory>([
      "session", "observation", "input", "meta", "remote", "tmux",
    ])
    for (const name of ALL_TOOL_NAMES) {
      expect(validCategories.has(TOOL_CATEGORIES[name]!)).toBe(true)
    }
  })

  it("session 分类包含 7 个工具", () => {
    const sessionTools = ALL_TOOL_NAMES.filter((n) => TOOL_CATEGORIES[n] === "session")
    expect(sessionTools).toHaveLength(7)
  })

  it("observation 分类包含 5 个工具", () => {
    const obsTools = ALL_TOOL_NAMES.filter((n) => TOOL_CATEGORIES[n] === "observation")
    expect(obsTools).toHaveLength(5)
  })

  it("input 分类包含 5 个工具", () => {
    const inputTools = ALL_TOOL_NAMES.filter((n) => TOOL_CATEGORIES[n] === "input")
    expect(inputTools).toHaveLength(5)
  })

  it("meta 分类包含 7 个工具", () => {
    const metaTools = ALL_TOOL_NAMES.filter((n) => TOOL_CATEGORIES[n] === "meta")
    expect(metaTools).toHaveLength(7)
  })

  it("remote 分类包含 3 个工具", () => {
    const remoteTools = ALL_TOOL_NAMES.filter((n) => TOOL_CATEGORIES[n] === "remote")
    expect(remoteTools).toHaveLength(3)
  })

  it("tmux 分类包含 3 个工具", () => {
    const tmuxTools = ALL_TOOL_NAMES.filter((n) => TOOL_CATEGORIES[n] === "tmux")
    expect(tmuxTools).toHaveLength(3)
  })
})

describe("Profile tool sets", () => {
  it("MINIMAL_TOOLS 是最小集合", () => {
    expect(MINIMAL_TOOLS.size).toBeLessThan(LOCAL_TUI_TOOLS.size)
    // minimal 的所有工具都包含在 local-tui 中
    for (const tool of MINIMAL_TOOLS) {
      expect(LOCAL_TUI_TOOLS.has(tool)).toBe(true)
    }
  })

  it("LOCAL_TUI_TOOLS 是 minimal 的超集", () => {
    for (const tool of MINIMAL_TOOLS) {
      expect(LOCAL_TUI_TOOLS.has(tool)).toBe(true)
    }
  })

  it("REMOTE_TUI_TOOLS 是 local-tui 的超集", () => {
    for (const tool of LOCAL_TUI_TOOLS) {
      expect(REMOTE_TUI_TOOLS.has(tool)).toBe(true)
    }
  })

  it("PERSISTENT_TUI_TOOLS 是 local-tui 的超集", () => {
    for (const tool of LOCAL_TUI_TOOLS) {
      expect(PERSISTENT_TUI_TOOLS.has(tool)).toBe(true)
    }
  })

  it("FULL_TOOLS 包含所有 30 个工具", () => {
    expect(FULL_TOOLS.size).toBe(30)
  })

  it("ALWAYS_REGISTERED_TOOLS 包含 terminal.health", () => {
    expect(ALWAYS_REGISTERED_TOOLS.has("terminal.health")).toBe(true)
  })
})

describe("resolveAutoProfile", () => {
  it("local → LOCAL_TUI_TOOLS", () => {
    const result = resolveAutoProfile("local" as CapabilityPreset)
    expect(result).toEqual(LOCAL_TUI_TOOLS)
  })

  it("remote → REMOTE_TUI_TOOLS", () => {
    const result = resolveAutoProfile("remote" as CapabilityPreset)
    expect(result).toEqual(REMOTE_TUI_TOOLS)
  })

  it("persistent → PERSISTENT_TUI_TOOLS", () => {
    const result = resolveAutoProfile("persistent" as CapabilityPreset)
    expect(result).toEqual(PERSISTENT_TUI_TOOLS)
  })

  it("remote-persistent → remote-tui ∪ persistent-tui", () => {
    const result = resolveAutoProfile("remote-persistent" as CapabilityPreset)
    // 应包含 remote-tui 和 persistent-tui 的所有工具
    for (const tool of REMOTE_TUI_TOOLS) {
      expect(result.has(tool)).toBe(true)
    }
    for (const tool of PERSISTENT_TUI_TOOLS) {
      expect(result.has(tool)).toBe(true)
    }
    // full = 30, 并集应等于 full（因为两者互补覆盖所有工具）
    expect(result.size).toBe(30)
  })

  it("full → FULL_TOOLS", () => {
    const result = resolveAutoProfile("full" as CapabilityPreset)
    expect(result).toEqual(FULL_TOOLS)
  })

  it("custom → MINIMAL_TOOLS", () => {
    const result = resolveAutoProfile("custom" as CapabilityPreset)
    expect(result).toEqual(MINIMAL_TOOLS)
  })
})

describe("resolveEnabledTools", () => {
  const baseOpts = {
    capabilityPreset: "local" as CapabilityPreset,
    enabledTools: [] as string[],
    extraTools: [] as string[],
    disabledTools: [] as string[],
  }

  it("profile=full 返回所有 30 个工具", () => {
    const result = resolveEnabledTools({ ...baseOpts, toolProfile: "full" as ToolProfile })
    expect(result.registeredTools).toHaveLength(30)
    expect(result.disabledTools).toHaveLength(0)
  })

  it("profile=minimal 返回最小工具集", () => {
    const result = resolveEnabledTools({ ...baseOpts, toolProfile: "minimal" as ToolProfile })
    // minimal 工具 + terminal.health（始终包含）
    expect(result.registeredTools.length).toBe(MINIMAL_TOOLS.size)
    for (const tool of MINIMAL_TOOLS) {
      expect(result.registeredTools).toContain(tool)
    }
  })

  it("profile=auto 委托给 resolveAutoProfile", () => {
    const result = resolveEnabledTools({
      ...baseOpts,
      toolProfile: "auto" as ToolProfile,
      capabilityPreset: "full" as CapabilityPreset,
    })
    expect(result.registeredTools).toHaveLength(30)
  })

  it("extraTools 追加工具到 profile", () => {
    const result = resolveEnabledTools({
      ...baseOpts,
      toolProfile: "minimal" as ToolProfile,
      extraTools: ["terminal.paste"],
    })
    expect(result.registeredTools).toContain("terminal.paste")
  })

  it("disabledTools 从 profile 中移除工具", () => {
    const result = resolveEnabledTools({
      ...baseOpts,
      toolProfile: "local-tui" as ToolProfile,
      disabledTools: ["terminal.paste"],
    })
    expect(result.registeredTools).not.toContain("terminal.paste")
    expect(result.disabledTools).toContain("terminal.paste")
  })

  it("extraTools 中的无效工具名生成 configWarnings", () => {
    const result = resolveEnabledTools({
      ...baseOpts,
      toolProfile: "minimal" as ToolProfile,
      extraTools: ["terminal.nonexistent"],
    })
    expect(result.configWarnings.length).toBeGreaterThan(0)
    expect(result.configWarnings[0]).toContain("terminal.nonexistent")
  })

  it("disabledTools 中的无效工具名生成 configWarnings", () => {
    const result = resolveEnabledTools({
      ...baseOpts,
      toolProfile: "minimal" as ToolProfile,
      disabledTools: ["terminal.imaginary"],
    })
    expect(result.configWarnings.length).toBeGreaterThan(0)
    expect(result.configWarnings[0]).toContain("terminal.imaginary")
  })

  it("terminal.health 始终包含（不可禁用）", () => {
    const result = resolveEnabledTools({
      ...baseOpts,
      toolProfile: "full" as ToolProfile,
      disabledTools: ["terminal.health"],
    })
    // health 被加入 disabledTools，但 Step 5 会重新添加
    // 实际上 disabledTools 先删除，然后 Step 5 再加回
    expect(result.registeredTools).toContain("terminal.health")
  })

  it("enabledTools 覆盖基础集合（非 auto/custom profile）", () => {
    const result = resolveEnabledTools({
      ...baseOpts,
      toolProfile: "full" as ToolProfile,
      enabledTools: ["terminal.start", "terminal.kill"],
    })
    // enabledTools 覆盖后只有 start + kill + health（health 始终包含）
    expect(result.registeredTools).toContain("terminal.start")
    expect(result.registeredTools).toContain("terminal.kill")
    expect(result.registeredTools).toContain("terminal.health")
    // 不应包含 full profile 的其他工具
    expect(result.registeredTools).not.toContain("terminal.paste")
  })

  it("enabledTools 中的无效工具名生成 configWarnings", () => {
    const result = resolveEnabledTools({
      ...baseOpts,
      toolProfile: "minimal" as ToolProfile,
      enabledTools: ["terminal.start", "terminal.invalid_tool"],
    })
    // 注意：auto/custom profile 下 enabledTools 不走覆盖逻辑，但仍然检查无效名称
    // 这里用 non-auto/custom profile
    const result2 = resolveEnabledTools({
      ...baseOpts,
      toolProfile: "local-tui" as ToolProfile,
      enabledTools: ["terminal.start", "terminal.invalid_tool"],
    })
    expect(result2.configWarnings.some((w) => w.includes("terminal.invalid_tool"))).toBe(true)
  })

  it("profile=custom 且 enabledTools 为空时使用 MINIMAL_TOOLS", () => {
    const result = resolveEnabledTools({
      ...baseOpts,
      toolProfile: "custom" as ToolProfile,
      enabledTools: [],
    })
    expect(result.registeredTools.length).toBe(MINIMAL_TOOLS.size)
  })

  it("profile=custom 且 enabledTools 非空时使用 enabledTools", () => {
    const result = resolveEnabledTools({
      ...baseOpts,
      toolProfile: "custom" as ToolProfile,
      enabledTools: ["terminal.start", "terminal.snapshot"],
    })
    expect(result.registeredTools).toContain("terminal.start")
    expect(result.registeredTools).toContain("terminal.snapshot")
    expect(result.registeredTools).toContain("terminal.health")
  })
})
