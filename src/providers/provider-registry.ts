/**
 * Provider 注册工厂
 *
 * 根据 enabledProviders 白名单，创建并注册 Provider 到 SessionManager。
 * 未在白名单中的 provider 不注册，也不参与 provider 选择。
 */

import type { CapabilityPreset, SecretEnvPolicy } from "../config.js"
import { resolveProvidersFromPreset } from "../capability-preset.js"
import type { Logger } from "../logger.js"
import type { SessionManager } from "../session-manager.js"
import type { ProviderName, TerminalProvider } from "./provider.js"
import { NativePtyProvider } from "./native-pty-provider.js"
import { SshPtyProvider } from "./ssh-pty-provider.js"
import { SshTmuxProvider } from "./ssh-tmux-provider.js"
import { TmuxProvider } from "./tmux-provider.js"

type ProviderEntry = {
  name: ProviderName
  create: (logger: Logger, secretEnvPolicy: SecretEnvPolicy) => TerminalProvider
  optional: boolean
}

const PROVIDER_ENTRIES: ProviderEntry[] = [
  { name: "native-pty", create: (logger, secretEnvPolicy) => new NativePtyProvider(logger, { secretEnvPolicy }), optional: true },
  { name: "tmux", create: (logger, secretEnvPolicy) => new TmuxProvider(logger, { secretEnvPolicy }), optional: false },
  { name: "ssh-pty", create: (logger, secretEnvPolicy) => new SshPtyProvider(logger, { secretEnvPolicy }), optional: true },
  { name: "ssh-tmux", create: (logger, secretEnvPolicy) => new SshTmuxProvider(logger, { secretEnvPolicy }), optional: true },
]

/**
 * 创建并注册 provider 到 SessionManager。
 *
 * @param sm                SessionManager 实例
 * @param logger            日志记录器
 * @param enabledProviders  显式启用的 provider 白名单。空数组=全部启用（向后兼容）
 * @param capabilityPreset  能力预设（仅在 enabledProviders 未显式设置时生效）
 * @param secretEnvPolicy   秘密环境变量策略（统一从 config 层传入，避免 provider 直读 process.env）
 */
export function createAndRegisterProviders(
  sm: SessionManager,
  logger: Logger,
  enabledProviders: ProviderName[] = [],
  capabilityPreset?: CapabilityPreset,
  secretEnvPolicy: SecretEnvPolicy = "deny",
): void {
  // 如果 enabledProviders 非空，使用显式白名单；否则根据 preset 推导，最后 fallback 到全部启用
  const providersToEnable = enabledProviders.length > 0
    ? enabledProviders
    : capabilityPreset && capabilityPreset !== "custom"
      ? resolveProvidersFromPreset(capabilityPreset)
      : Array.from(PROVIDER_ENTRIES.map((e) => e.name))

  const enabledSet = providersToEnable.length === PROVIDER_ENTRIES.length
    ? null // 全部启用，不需要 filter
    : new Set(providersToEnable)

  const disabled: ProviderName[] = []

  for (const entry of PROVIDER_ENTRIES) {
    if (enabledSet !== null && !enabledSet.has(entry.name)) {
      disabled.push(entry.name)
      logger.info("provider disabled by config", { provider: entry.name })
      continue
    }

    try {
      sm.registerProvider(entry.create(logger, secretEnvPolicy))
    } catch (err) {
      if (entry.optional) {
        logger.warn("provider not available", {
          provider: entry.name,
          error: formatProviderRegisterError(err),
        })
      } else {
        throw err
      }
    }
  }

  logger.info("terminal providers registered", {
    providers: Array.from(sm.getProviders().keys()),
    disabled,
  })
}

function formatProviderRegisterError(err: unknown): string {
  if (err instanceof Error) {
    return err.message
  }
  return String(err)
}
