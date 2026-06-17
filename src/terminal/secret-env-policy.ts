/**
 * Secret environment variable policy
 *
 * 检测 input.env 和 profile.env 中的疑似 secret key，
 * 根据 secretEnvPolicy (deny/warn/allow) 决定行为。
 *
 * deny:  拒绝启动（fail-closed）
 * warn:  允许但记录 warning
 * allow: 允许
 */

import { logger } from "../logger.js"
import type { SecretEnvPolicy } from "../config.js"

/** 疑似 secret env key 的检测模式 */
const SECRET_KEY_PATTERNS: readonly RegExp[] = [
  /TOKEN$/iu,
  /SECRET$/iu,
  /PASSWORD$/iu,
  /PASS$/iu,
  /API_KEY$/iu,
  /PRIVATE_KEY$/iu,
  /ACCESS_KEY$/iu,
  /^AWS_SECRET_ACCESS_KEY$/u,
  /^OPENAI_API_KEY$/u,
  /^ANTHROPIC_API_KEY$/u,
  /^GITHUB_TOKEN$/u,
  /^GITLAB_TOKEN$/u,
  /^NPM_TOKEN$/u,
]

/** 检测单个 key 是否疑似 secret */
export function isSuspectedSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key))
}

/** 扫描 env 对象，返回所有疑似 secret 的 key */
export function findSuspectedSecretKeys(env: Record<string, string>): string[] {
  return Object.keys(env).filter(isSuspectedSecretKey)
}

/** Secret policy 检查结果 */
export type SecretEnvCheckResult =
  | { allowed: true; warningKeys: string[] }
  | { allowed: false; deniedKeys: string[] }

/**
 * 根据 secretEnvPolicy 检查 env 对象。
 *
 * deny:  有疑似 secret key → 拒绝
 * warn:  有疑似 secret key → 允许但返回 warningKeys
 * allow: 允许，不检查
 */
export function checkSecretEnvPolicy(
  env: Record<string, string>,
  policy: SecretEnvPolicy,
): SecretEnvCheckResult {
  if (policy === "allow") {
    return { allowed: true, warningKeys: [] }
  }

  const suspected = findSuspectedSecretKeys(env)
  if (suspected.length === 0) {
    return { allowed: true, warningKeys: [] }
  }

  if (policy === "warn") {
    logger.warn("Suspected secret environment variables detected", { keys: suspected })
    return { allowed: true, warningKeys: suspected }
  }

  // policy === "deny"
  return { allowed: false, deniedKeys: suspected }
}

/**
 * 从环境变量读取 secret env policy 设置。默认 "deny"。
 *
 * @internal 此函数绕过 config 层（config.json 支持），仅供测试和内部工具使用。
 * Provider 必须通过构造函数接收 secretEnvPolicy，不应直接调用此函数。
 */
export function getSecretEnvPolicy(): SecretEnvPolicy {
  const envValue = process.env.TERMINAL_USE_SECRET_ENV_POLICY?.trim().toLowerCase()
  if (envValue === "warn") return "warn"
  if (envValue === "allow") return "allow"
  return "deny"
}
