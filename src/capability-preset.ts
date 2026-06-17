/**
 * Capability Preset — 能力预设到内部 Provider 的映射。
 *
 * 用户不需要理解 native-pty/tmux/ssh-pty/ssh-tmux 的差异，
 * 只需选择使用场景预设，系统自动映射到合适的 provider 组合。
 *
 * 配置优先级：
 * TERMINAL_USE_PROVIDERS 显式设置 > TERMINAL_USE_CAPABILITY_PRESET > 默认值
 */

import type { ProviderName } from "./providers/provider.js"
import type { CapabilityPreset } from "./config.js"

/** 能力预设 → Provider 映射 */
const PRESET_PROVIDER_MAP: Record<CapabilityPreset, ProviderName[]> = {
  local: ["native-pty", "tmux"],
  remote: ["ssh-pty", "ssh-tmux"],
  persistent: ["tmux"],
  "remote-persistent": ["ssh-tmux"],
  full: ["native-pty", "tmux", "ssh-pty", "ssh-tmux"],
  custom: ["native-pty", "tmux", "ssh-pty", "ssh-tmux"], // custom 默认全启用，由 TERMINAL_USE_PROVIDERS 精确控制
}

/**
 * 根据能力预设解析应该启用的 provider 列表。
 *
 * @param preset 能力预设
 * @returns 应该启用的 provider 名称列表
 */
export function resolveProvidersFromPreset(preset: CapabilityPreset): ProviderName[] {
  return [...(PRESET_PROVIDER_MAP[preset] ?? PRESET_PROVIDER_MAP.local)]
}

/**
 * 判断是否启用了远程能力。
 *
 * 当启用的 provider 中包含 ssh-pty 或 ssh-tmux 时，视为远程能力已启用。
 */
export function isRemoteCapabilityEnabled(enabledProviders: ProviderName[]): boolean {
  return enabledProviders.includes("ssh-pty") || enabledProviders.includes("ssh-tmux")
}
