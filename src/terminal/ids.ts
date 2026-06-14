/**
 * Session ID 生成
 *
 * 使用 UUIDv4 格式，遵循 MCP spec 对 opaque handle 的推荐。
 * 旧格式 "term_" + hex 曾导致 LLM 自行拼接 provider 前缀（如 "native_term_xxx"），
 * UUIDv4 格式消除了这种模式推导的可能性。
 */

import { randomUUID } from "node:crypto"

export function generateSessionId(): string {
  return randomUUID()
}
