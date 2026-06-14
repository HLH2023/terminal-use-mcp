/**
 * Provider 注册工厂
 *
 * 根据 enabledProviders 白名单，创建并注册 Provider 到 SessionManager。
 * 未在白名单中的 provider 不注册，也不参与 provider 选择。
 */

import type { Logger } from "../logger.js"
import type { SessionManager } from "../session-manager.js"
import type { ProviderName, TerminalProvider } from "./provider.js"
import { NativePtyProvider } from "./native-pty-provider.js"
import { SshPtyProvider } from "./ssh-pty-provider.js"
import { SshTmuxProvider } from "./ssh-tmux-provider.js"
import { TmuxProvider } from "./tmux-provider.js"

type ProviderEntry = {
  name: ProviderName
  create: (logger: Logger) => TerminalProvider
  optional: boolean
}

const PROVIDER_ENTRIES: ProviderEntry[] = [
  { name: "native-pty", create: (logger) => new NativePtyProvider(logger), optional: true },
  { name: "tmux", create: (logger) => new TmuxProvider(logger), optional: false },
  { name: "ssh-pty", create: (logger) => new SshPtyProvider(logger), optional: true },
  { name: "ssh-tmux", create: (logger) => new SshTmuxProvider(logger), optional: true },
]

/**
 * 创建并注册 provider 到 SessionManager。
 *
 * @param enabledProviders 白名单。空数组=全部启用。
 */
export function createAndRegisterProviders(
  sm: SessionManager,
  logger: Logger,
  enabledProviders: ProviderName[] = [],
): void {
  const enabledSet = enabledProviders.length > 0
    ? new Set(enabledProviders)
    : null

  const disabled: ProviderName[] = []

  for (const entry of PROVIDER_ENTRIES) {
    if (enabledSet !== null && !enabledSet.has(entry.name)) {
      disabled.push(entry.name)
      logger.info("provider disabled by config", { provider: entry.name })
      continue
    }

    try {
      sm.registerProvider(entry.create(logger))
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
