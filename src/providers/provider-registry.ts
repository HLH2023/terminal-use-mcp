/**
 * Provider 注册工厂
 *
 * 负责创建所有已知 Provider 实例并注册到 SessionManager。
 * 上层 index.ts 只需调用 createAndRegisterProviders(sm, logger) 即可完成
 * 所有 provider 的实例化与注册；单个 provider 依赖缺失时不影响其他 provider。
 */

import type { Logger } from "../logger.js"
import type { SessionManager } from "../session-manager.js"
import { NativePtyProvider } from "./native-pty-provider.js"
import { SshPtyProvider } from "./ssh-pty-provider.js"
import { SshTmuxProvider } from "./ssh-tmux-provider.js"
import { TmuxProvider } from "./tmux-provider.js"

/**
 * 创建所有已知 provider 并注册到 SessionManager。
 *
 * 每个 provider 的 isAvailable() 会在首次使用时异步检测；
 * 此处只做实例化和注册，不阻塞于可用性检查。
 */
export function createAndRegisterProviders(sm: SessionManager, logger: Logger): void {
  try {
    sm.registerProvider(new NativePtyProvider(logger))
  } catch (err) {
    logger.warn("native-pty provider not available", { error: formatProviderRegisterError(err) })
  }

  sm.registerProvider(new TmuxProvider(logger))

  try {
    sm.registerProvider(new SshPtyProvider(logger))
  } catch (err) {
    logger.warn("ssh-pty provider not available", { error: formatProviderRegisterError(err) })
  }

  try {
    sm.registerProvider(new SshTmuxProvider(logger))
  } catch (err) {
    logger.warn("ssh-tmux provider not available", { error: formatProviderRegisterError(err) })
  }

  logger.info("terminal providers registered", {
    providers: Array.from(sm.getProviders().keys()),
  })
}

function formatProviderRegisterError(err: unknown): string {
  if (err instanceof Error) {
    return err.message
  }
  return String(err)
}
