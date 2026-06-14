/**
 * ssh-keyscan 预验证：为 ssh-tmux provider 提供 pinnedHostFingerprint 等价校验。
 *
 * ssh-pty provider 通过 ssh2 的 hostVerifier 在握手阶段直接比对 fingerprint；
 * ssh-tmux provider 使用系统 ssh 命令，没有对等的内建机制。
 * 本模块在 SSH 连接前调用 ssh-keyscan 获取远端 host key，
 * 计算其 fingerprint 与 profile.pinnedHostFingerprint 比对，
 * 匹配则生成临时 known_hosts 供后续 SSH 连接使用。
 *
 * 安全边界：
 * - 只使用 execFile("ssh-keyscan", args)，不使用 exec/shell 拼接。
 * - 只使用 execFile("ssh-keygen", args) 计算 fingerprint。
 * - 临时 known_hosts 文件权限 0600，session 结束时清理。
 * - 验证失败 fail-closed：抛 SshHostKeyMismatchError。
 */

import { execFile } from "node:child_process"
import { closeSync, openSync, writeSync, unlinkSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomBytes } from "node:crypto"

import type { ResolvedSshTarget } from "./ssh-profile-loader.js"
import { verifyPinnedFingerprint } from "./host-fingerprint.js"
import { SshHostKeyMismatchError, SshHostKeyUnknownError } from "../terminal/errors.js"

/** ssh-keyscan 命令超时（秒），防止远端不可达时无限挂起。 */
const SSH_KEYSCAN_TIMEOUT_SECONDS = 5

/** ssh-keygen 指纹计算命令超时（毫秒）。 */
const SSH_KEYGEN_TIMEOUT_MS = 5_000

/** 支持的 host key 类型；优先级：ed25519 > ecdsa > rsa。 */
const KEYSCAN_KEY_TYPES = ["ssh-ed25519", "ecdsa-sha2-nistp256", "rsa"] as const

export type KeyscanVerifySuccess = {
  verified: true
  /** 临时 known_hosts 文件路径；供 SSH 连接使用，session 结束时需清理。 */
  tempKnownHostsPath: string
  /** 匹配到的 fingerprint（用于日志/metadata）。 */
  matchedFingerprint: string
}

export type KeyscanVerifyFailure = {
  verified: false
  error: string
}

export type KeyscanVerifyResult = KeyscanVerifySuccess | KeyscanVerifyFailure

/**
 * 通过 ssh-keyscan 预验证 pinnedHostFingerprint。
 *
 * 流程：
 * 1. ssh-keyscan -p <port> -T <timeout> -t <keyTypes> <host>
 * 2. 解析输出提取 host key 行
 * 3. 将 key 行写入临时 known_hosts 文件（0600）
 * 4. 用 ssh-keygen -lf <tempFile> 逐行计算 fingerprint
 * 5. 与 profile.pinnedHostFingerprint 比对
 * 6. 匹配 → 返回 tempKnownHostsPath 供连接使用
 * 7. 不匹配 → 清理临时文件，返回失败
 */
export async function verifyPinnedFingerprintViaKeyscan(
  profile: ResolvedSshTarget,
): Promise<KeyscanVerifyResult> {
  const pinned = profile.pinnedHostFingerprint
  if (pinned === undefined) {
    return { verified: false, error: "No pinnedHostFingerprint configured" }
  }

  // 1. 执行 ssh-keyscan
  const keyscanOutput = await runSshKeyscan(profile.host, profile.port)
  if (keyscanOutput.trim().length === 0) {
    return { verified: false, error: `ssh-keyscan returned no host keys for ${profile.host}:${profile.port}` }
  }

  // 2. 解析 host key 行
  const keyLines = parseKeyscanOutput(keyscanOutput, profile.host, profile.port)
  if (keyLines.length === 0) {
    return { verified: false, error: `ssh-keyscan output contains no valid host key lines for ${profile.host}:${profile.port}` }
  }

  // 3. 写入临时 known_hosts 文件
  const tempPath = writeTempKnownHosts(keyLines)

  try {
    // 4. 用 ssh-keygen 计算每行 fingerprint 并比对
    const fingerprints = await computeFingerprints(tempPath)

    for (const fingerprint of fingerprints) {
      const result = verifyPinnedFingerprint(pinned, fingerprint)
      if (result.ok && result.matches) {
        return {
          verified: true,
          tempKnownHostsPath: tempPath,
          matchedFingerprint: result.fingerprint,
        }
      }
    }

    // 5. 没有匹配的 fingerprint
    unlinkSync(tempPath)
    const foundFingerprints = fingerprints.length > 0 ? fingerprints.join(", ") : "(none)"
    return {
      verified: false,
      error: `No host key from ssh-keyscan matches pinnedHostFingerprint. Found: ${foundFingerprints}`,
    }
  } catch (error) {
    // ssh-keygen 失败时清理临时文件
    try { unlinkSync(tempPath) } catch { /* 最佳努力清理 */ }
    const message = error instanceof Error ? error.message : String(error)
    return { verified: false, error: `ssh-keygen fingerprint computation failed: ${message}` }
  }
}

/**
 * 便捷入口：验证 fingerprint 并在失败时直接抛错。
 * 成功时返回临时 known_hosts 路径。
 */
export async function verifyPinnedFingerprintOrThrow(
  profile: ResolvedSshTarget,
): Promise<{ tempKnownHostsPath: string; matchedFingerprint: string }> {
  const result = await verifyPinnedFingerprintViaKeyscan(profile)

  if (result.verified) {
    return {
      tempKnownHostsPath: result.tempKnownHostsPath,
      matchedFingerprint: result.matchedFingerprint,
    }
  }

  const hostLabel = `${profile.username}@${profile.host}:${profile.port}`
  // 区分"远端无 key"（unknown）和"fingerprint 不匹配"（mismatch）
  if (result.error.includes("no host keys") || result.error.includes("no valid host key")) {
    throw new SshHostKeyUnknownError(hostLabel, {
      reason: "keyscan_empty",
      detail: result.error,
    })
  }

  throw new SshHostKeyMismatchError(hostLabel, {
    reason: "fingerprint_mismatch_via_keyscan",
    detail: result.error,
    pinnedHostFingerprint: profile.pinnedHostFingerprint,
  })
}

/** 清理临时 known_hosts 文件；传入 undefined 时为 no-op。 */
export function cleanupTempKnownHosts(path: string | undefined): void {
  if (path !== undefined && path.length > 0) {
    try {
      if (existsSync(path)) {
        unlinkSync(path)
      }
    } catch {
      // 最佳努力清理，不抛错
    }
  }
}

// ---- 内部实现 ----

/**
 * 执行 ssh-keyscan 获取远端 host key。
 * 使用 execFile（参数数组），禁止 shell 字符串拼接。
 */
async function runSshKeyscan(host: string, port: number): Promise<string> {
  const args = [
    "-p", String(port),
    "-T", String(SSH_KEYSCAN_TIMEOUT_SECONDS),
    "-t", KEYSCAN_KEY_TYPES.join(","),
    host,
  ]

  return new Promise<string>((resolve) => {
    execFile("ssh-keyscan", args, { timeout: SSH_KEYSCAN_TIMEOUT_SECONDS * 1000 + 1000 }, (error, stdout) => {
      // ssh-keyscan 对无响应 host 返回非零 exit code + 空 stdout；
      // 部分 key 类型不可用也可能返回部分输出 + 错误。
      // 我们只关心 stdout 中实际获得的 key 行。
      resolve(stdout ?? "")
    })
  })
}

/**
 * 解析 ssh-keyscan 输出，提取匹配目标 host:port 的 known_hosts 格式行。
 *
 * ssh-keyscan 输出格式：
 *   <host> <keyType> <publicKeyBase64>
 * 非 standard port 时 host 格式可能为 [<host>]:port
 */
function parseKeyscanOutput(output: string, host: string, port: number): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (line.length === 0 || line.startsWith("#")) return false
      // 确保行来自目标 host（ssh-keyscan 只扫描一个 host，但也做防御性检查）
      const hostPart = line.split(/\s+/u)[0] ?? ""
      return hostMatchesKeyscanLine(hostPart, host, port)
    })
}

/**
 * 检查 known_hosts 行的 host 标识是否与目标匹配。
 * openSSH known_hosts 格式：
 * - standard port: <hostname> 或 <hostname>,<ip>
 * - non-standard port: [<hostname>]:<port>
 */
function hostMatchesKeyscanLine(hostPart: string, host: string, port: number): boolean {
  // 直接匹配
  if (hostPart === host) return true
  // 带 port 的格式 [<host>]:<port>
  if (hostPart === `[${host}]:${port}`) return true
  // 逗号分隔的 host,ip 格式
  if (hostPart.startsWith(host + ",")) return true
  return false
}

/**
 * 将 host key 行写入临时 known_hosts 文件。
 * 文件权限 0600（仅 owner 可读写）。
 */
function writeTempKnownHosts(keyLines: string[]): string {
  const suffix = randomBytes(8).toString("hex")
  const tempPath = join(tmpdir(), `terminal-use-keyscan-${suffix}`)

  const fd = openSync(tempPath, "w", 0o600)
  try {
    for (const line of keyLines) {
      writeSync(fd, `${line}\n`)
    }
  } finally {
    closeSync(fd)
  }

  return tempPath
}

/**
 * 用 ssh-keygen -lf 计算临时 known_hosts 文件中每行 key 的 fingerprint。
 *
 * ssh-keygen -lf 输出格式：
 *   <size> <fingerprint> (<keyType>)
 * 例：256 SHA256:ABC123... (ECDSA P-256)
 *
 * 我们提取 SHA256:xxx 或 MD5:xxx 格式的 fingerprint。
 */
async function computeFingerprints(tempKnownHostsPath: string): Promise<string[]> {
  return new Promise<string[]>((resolve) => {
    execFile("ssh-keygen", ["-lf", tempKnownHostsPath], { timeout: SSH_KEYGEN_TIMEOUT_MS }, (error, stdout) => {
      if (error !== null || stdout === undefined || stdout.trim().length === 0) {
        resolve([])
        return
      }

      const fingerprints: string[] = []
      for (const line of stdout.split("\n")) {
        const fingerprint = extractFingerprintFromKeygenLine(line.trim())
        if (fingerprint !== undefined) {
          fingerprints.push(fingerprint)
        }
      }
      resolve(fingerprints)
    })
  })
}

/**
 * 从 ssh-keygen -lf 的单行输出中提取 fingerprint。
 *
 * 行格式：256 SHA256:ABC123... (ED25519) 或 2048 MD5:ab:cd:ef... (RSA)
 * fingerprint 可能在 SHA256: 或 MD5: 前缀后。
 */
function extractFingerprintFromKeygenLine(line: string): string | undefined {
  if (line.length === 0) return undefined

  // SHA256:xxx 格式
  const sha256Match = /\b(SHA256:[A-Za-z0-9+/=]+)\b/u.exec(line)
  if (sha256Match !== null) {
    return sha256Match[1]
  }

  // MD5:xx:xx:xx... 格式
  const md5Match = /\b(MD5:[0-9a-f]{2}(?::[0-9a-f]{2})+)\b/iu.exec(line)
  if (md5Match !== null) {
    return md5Match[1]
  }

  return undefined
}
