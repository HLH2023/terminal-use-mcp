/**
 * SSH host config 辅助工具
 *
 * 从 ssh-host-config.ts 分离出的纯工具函数，
 * 避免循环依赖：ssh-auth.ts 和其他模块需要 expandTildePath 但不依赖完整加载器。
 */

import { homedir } from "node:os"
import { join } from "node:path"

/** 将配置中的 `~` 展开为 os.homedir()，不依赖 `$HOME` 环境变量。 */
export function expandTildePath(value: string): string {
  if (value === "~") return homedir()
  if (value.startsWith("~/")) return join(homedir(), value.slice(2))
  return value
}

/** 预检模块旧命名兼容：语义等同 expandTildePath。 */
export function expandUserPath(value: string): string {
  return expandTildePath(value)
}
