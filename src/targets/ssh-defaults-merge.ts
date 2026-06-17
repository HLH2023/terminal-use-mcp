/**
 * sshDefaults 合并逻辑 — 将全局 SSH 默认值合并到 profile。
 *
 * 合并语义：profile 字段优先（非 undefined 时），否则使用 sshDefaults。
 * 这确保用户在 profile 中只需写覆盖项，其余自动继承全局默认值。
 */

import type { SshHostProfile } from "./target-types.js"
import type { SshDefaultsConfig } from "../config.js"

/**
 * 将 sshDefaults 合并到 profile，返回 effective profile。
 *
 * 不修改原始 profile，返回一个新对象。
 * 合并规则：
 * - remoteDeniedCwd: profile ?? sshDefaults
 * - allowTmux: profile ?? sshDefaults
 * - connectTimeoutMs: profile ?? sshDefaults
 * - keepaliveIntervalMs: profile ?? sshDefaults
 */
export function mergeSshDefaultsIntoProfile(
  profile: SshHostProfile,
  sshDefaults: SshDefaultsConfig,
): SshHostProfile {
  return {
    ...profile,
    remoteDeniedCwd: profile.remoteDeniedCwd ?? sshDefaults.remoteDeniedCwd,
    allowTmux: profile.allowTmux ?? sshDefaults.allowTmux,
    connectTimeoutMs: profile.connectTimeoutMs ?? sshDefaults.connectTimeoutMs,
    keepaliveIntervalMs: profile.keepaliveIntervalMs ?? sshDefaults.keepaliveIntervalMs,
  }
}

/**
 * 批量合并 sshDefaults 到所有 profiles。
 */
export function mergeSshDefaultsIntoAllProfiles(
  profiles: ReadonlyMap<string, SshHostProfile>,
  sshDefaults: SshDefaultsConfig,
): Map<string, SshHostProfile> {
  const result = new Map<string, SshHostProfile>()
  for (const [name, profile] of profiles) {
    result.set(name, mergeSshDefaultsIntoProfile(profile, sshDefaults))
  }
  return result
}
