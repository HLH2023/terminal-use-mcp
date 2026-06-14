/**
 * OpenSSH known_hosts 解析与只读校验。
 *
 * 本模块只读取用户指定的 known_hosts 文件，不修改文件、不接受未知 host key、
 * 不使用 StrictHostKeyChecking=no。verify_target 不建立 SSH 连接，因此
 * verifyHostKey 的职责是确认目标 host/port 已存在于信任文件，并返回其
 * 公开 host key fingerprint，供后续 provider 连接阶段进行严格比对。
 */

import { promises as fs, constants as fsConstants } from "node:fs"

import { computeHostFingerprint } from "./host-fingerprint.js"
import { expandUserPath } from "./ssh-host-config.js"

/** 已知主机条目 */
export type KnownHostEntry = {
  host: string
  keyType: string
  publicKey: string
  /** 原始行号，用于错误定位 */
  sourceLine?: number
}

/** 已知主机校验结果 */
export type KnownHostVerifyResult =
  | { ok: true; fingerprint: string }
  | { ok: false; reason: "host_not_found" | "key_mismatch" | "file_not_found" | "parse_error"; detail: string }

/** 解析 OpenSSH known_hosts 文件。缺失文件按空列表处理，便于上层决定错误语义。 */
export async function parseKnownHosts(filePath: string): Promise<KnownHostEntry[]> {
  const expandedPath = expandUserPath(filePath)
  let content: string
  try {
    content = await fs.readFile(expandedPath, "utf8")
  } catch (err) {
    if (isNodeErrorWithCode(err, "ENOENT")) {
      return []
    }
    throw err
  }

  const entries: KnownHostEntry[] = []
  const lines = content.split(/\r?\n/u)
  lines.forEach((line, index) => {
    const parsed = parseKnownHostLine(line, index + 1)
    entries.push(...parsed)
  })
  return entries
}

/**
 * 校验目标 host/port 是否已出现在 known_hosts 中。
 *
 * 本工具 不发起 SSH 握手，因此无法拿到“实时 host key”做最终 mismatch 判断；
 * 这里返回 known_hosts 中记录的 fingerprint，供后续 SSH provider 与
 * 实际 SSH 握手 key 进行严格比对。
 */
export async function verifyHostKey(host: string, port: number, knownHostsPath: string): Promise<KnownHostVerifyResult> {
  const expandedPath = expandUserPath(knownHostsPath)
  try {
    await fs.access(expandedPath, fsConstants.R_OK)
  } catch (err) {
    if (isNodeErrorWithCode(err, "ENOENT")) {
      return { ok: false, reason: "file_not_found", detail: `known_hosts file not found: ${expandedPath}` }
    }
    return { ok: false, reason: "parse_error", detail: formatUnknownError(err) }
  }

  let entries: KnownHostEntry[]
  try {
    entries = await parseKnownHosts(expandedPath)
  } catch (err) {
    return { ok: false, reason: "parse_error", detail: formatUnknownError(err) }
  }

  const expectedHosts = buildExpectedHostPatterns(host, port)
  const matched = entries.find((entry) => expectedHosts.has(entry.host))
  if (matched === undefined) {
    return {
      ok: false,
      reason: "host_not_found",
      detail: `Host ${formatHostPort(host, port)} was not found in ${expandedPath}`,
    }
  }

  try {
    return { ok: true, fingerprint: computeHostFingerprint(matched.publicKey, "sha256") }
  } catch (err) {
    return {
      ok: false,
      reason: "key_mismatch",
      detail: `Known host entry at line ${matched.sourceLine ?? "unknown"} contains an invalid public key: ${formatUnknownError(err)}`,
    }
  }
}

function parseKnownHostLine(line: string, sourceLine: number): KnownHostEntry[] {
  const trimmed = line.trim()
  if (trimmed.length === 0 || trimmed.startsWith("#")) {
    return []
  }

  const fields = trimmed.split(/\s+/u)
  const hasMarker = fields[0]?.startsWith("@") === true
  const marker = hasMarker ? fields[0] : undefined

  // @revoked 表示该 host key 已被撤销，不能作为可信条目参与校验。
  if (marker === "@revoked") {
    return []
  }

  const hostField = hasMarker ? fields[1] : fields[0]
  const keyType = hasMarker ? fields[2] : fields[1]
  const publicKey = hasMarker ? fields[3] : fields[2]

  if (hostField === undefined || keyType === undefined || publicKey === undefined) {
    return []
  }
  if (!isLikelyPublicKey(publicKey)) {
    return []
  }

  return hostField
    .split(",")
    .map((hostPattern): KnownHostEntry | undefined => {
      const normalizedHost = normalizeKnownHostPattern(hostPattern)
      if (normalizedHost.length === 0) {
        return undefined
      }
      return { host: normalizedHost, keyType, publicKey, sourceLine }
    })
    .filter((entry): entry is KnownHostEntry => entry !== undefined)
}

function normalizeKnownHostPattern(hostPattern: string): string {
  const trimmed = hostPattern.trim()
  const bracketed = /^\[([^\]]+)\]:(\d+)$/u.exec(trimmed)
  if (bracketed !== null) {
    return `${bracketed[1]}:${bracketed[2]}`
  }
  return trimmed
}

function buildExpectedHostPatterns(host: string, port: number): Set<string> {
  const patterns = new Set<string>([host, `${host}:${port}`, `[${host}]:${port}`])
  if (port === 22) {
    patterns.add(host)
  }
  return patterns
}

function formatHostPort(host: string, port: number): string {
  return port === 22 ? host : `${host}:${port}`
}

function isLikelyPublicKey(publicKey: string): boolean {
  if (publicKey.length === 0) {
    return false
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(publicKey)) {
    return false
  }
  try {
    return Buffer.from(publicKey, "base64").length > 0
  } catch {
    return false
  }
}

function isNodeErrorWithCode(err: unknown, code: string): boolean {
  return err instanceof Error && "code" in err && (err as { code?: unknown }).code === code
}

function formatUnknownError(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`
  }
  return String(err)
}
