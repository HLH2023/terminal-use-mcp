export type {
  RemoteCwdPolicy,
  SshAuthRef,
  SshHostProfile,
  SshSessionMetadata,
  TerminalTarget,
} from "./target-types.js"
export { isSshAgentAuthRef, isSshAuthRef, isSshKeyFileAuthRef } from "./target-types.js"

export {
  clearHostsConfigCache,
  expandTildePath,
  getHostsConfigPath,
  loadHostsConfig,
} from "./ssh-host-config.js"

export type { ResolvedLocalTarget, ResolvedSshTarget, ResolvedTerminalTarget } from "./ssh-profile-loader.js"
export { isInlineSshTargetAllowed, resolveSshTarget } from "./ssh-profile-loader.js"

export type { RemoteCwdSafetyResult } from "./remote-cwd-policy.js"
export {
  assertRemoteCwdAllowed,
  createRemoteCwdPolicy,
  isRemoteCwdAllowed,
  normalizeRemotePath,
  resolveRemoteCwd,
} from "./remote-cwd-policy.js"

export type { LocalTargetInfo, SshTargetInfo, TargetInfo } from "./target-registry.js"
export { getTargetInfo, listTargets } from "./target-registry.js"

// ── 新增：XDG 路径发现 ────────────────────────────────────────
export {
  getConfigDir,
  getConfigFilePath,
  getDataDir,
  getProfilesDir,
  ensureConfigDir,
} from "./xdg-paths.js"

// ── 新增：Zod Schema + 环境变量展开 ───────────────────────────
export type {
  SshAuthRefInput,
  SshHostProfileInput,
  SshHostsConfigInput,
  SshProfileOverlayInput,
  LocalConfigInput,
  SshDefaultsInput,
  RootConfigInput,
  ProfileOverlayFileInput,
} from "./config-schema.js"
export {
  SshAuthRefSchema,
  SshHostProfileSchema,
  SshHostsConfigSchema,
  SshProfileOverlaySchema,
  LocalConfigSchema,
  SshDefaultsSchema,
  RootConfigSchema,
  ProfileOverlayFileSchema,
  expandEnvVars,
  expandTildeInPath,
  expandTildeInObject,
} from "./config-schema.js"

// ── 新增：OpenSSH config 解析器 ───────────────────────────────
export type { SshConfigEntry } from "./ssh-config-parser.js"
export { parseSshConfig, findSshConfigEntry } from "./ssh-config-parser.js"
