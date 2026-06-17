import { describe, it, expect } from "vitest"
import { resolveProvidersFromPreset, isRemoteCapabilityEnabled } from "../../src/capability-preset.js"
import type { CapabilityPreset } from "../../src/config.js"

describe("resolveProvidersFromPreset", () => {
  it("local → [native-pty, tmux]", () => {
    const result = resolveProvidersFromPreset("local" as CapabilityPreset)
    expect(result).toEqual(["native-pty", "tmux"])
  })

  it("persistent → [tmux]", () => {
    const result = resolveProvidersFromPreset("persistent" as CapabilityPreset)
    expect(result).toEqual(["tmux"])
  })

  it("remote → [ssh-pty, ssh-tmux]", () => {
    const result = resolveProvidersFromPreset("remote" as CapabilityPreset)
    expect(result).toEqual(["ssh-pty", "ssh-tmux"])
  })

  it("remote-persistent → [ssh-tmux]", () => {
    const result = resolveProvidersFromPreset("remote-persistent" as CapabilityPreset)
    expect(result).toEqual(["ssh-tmux"])
  })

  it("full → 全部 4 个 provider", () => {
    const result = resolveProvidersFromPreset("full" as CapabilityPreset)
    expect(result).toEqual(["native-pty", "tmux", "ssh-pty", "ssh-tmux"])
  })

  it("custom → 全部 4 个 provider（由 TERMINAL_USE_PROVIDERS 精确控制）", () => {
    const result = resolveProvidersFromPreset("custom" as CapabilityPreset)
    expect(result).toEqual(["native-pty", "tmux", "ssh-pty", "ssh-tmux"])
  })

  it("返回新数组（不共享引用）", () => {
    const a = resolveProvidersFromPreset("local" as CapabilityPreset)
    const b = resolveProvidersFromPreset("local" as CapabilityPreset)
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })
})

describe("isRemoteCapabilityEnabled", () => {
  it("local providers → false", () => {
    expect(isRemoteCapabilityEnabled(["native-pty", "tmux"])).toBe(false)
  })

  it("仅 ssh-pty → true", () => {
    expect(isRemoteCapabilityEnabled(["ssh-pty"])).toBe(true)
  })

  it("仅 ssh-tmux → true", () => {
    expect(isRemoteCapabilityEnabled(["ssh-tmux"])).toBe(true)
  })

  it("全部 providers → true", () => {
    expect(isRemoteCapabilityEnabled(["native-pty", "tmux", "ssh-pty", "ssh-tmux"])).toBe(true)
  })

  it("空列表 → false", () => {
    expect(isRemoteCapabilityEnabled([])).toBe(false)
  })
})
