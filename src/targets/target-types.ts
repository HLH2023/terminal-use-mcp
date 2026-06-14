/**
 * 终端目标与 SSH Profile 类型
 *
 * 这里仅定义"在哪里运行"的目标与远程 profile 契约，不做任何真实 SSH 连接。
 * 安全原则：认证只允许引用 agent 或 key-file 路径，禁止密码与私钥内容进入配置。
 *
 * 配置扩展：
 * - sshConfigHost：指向 OpenSSH ~/.ssh/config 中的 Host 别名，
 *   SSH 连接参数（Host/Port/User/IdentityFile）从该处解析，不重复配置。
 * - SshAuthRef agent 的 socket 支持自动发现链。
 */

/** SSH 认证引用 — agent 或 key-file，禁止密码 */
export type SshAuthRef =
  | { type: "agent"; socket?: string }
  | { type: "key-file"; path: string; passphraseEnv?: string }

/** SSH 主机 profile 配置 */
export type SshHostProfile = {
  name: string
  /**
   * 指向 OpenSSH ~/.ssh/config 中的 Host 别名（新增）。
   * 当此字段有值时，host/port/username/auth 可从 SSH config 解析，
   * 本 profile 只存放 terminal-use-mcp 自有扩展（CWD policy、tmux 开关等）。
   * 当此字段为空时，必须在本 profile 中写完整连接参数（向后兼容）。
   */
  sshConfigHost?: string
  host: string
  port: number
  username: string
  auth: SshAuthRef
  knownHosts?: string
  pinnedHostFingerprint?: string
  defaultCwd?: string
  remoteAllowedCwd: string[]
  remoteDeniedCwd?: string[]
  allowTmux?: boolean
  env?: Record<string, string>
  connectTimeoutMs?: number
  keepaliveIntervalMs?: number
}

/** 终端运行目标 */
export type TerminalTarget =
  | { kind: "local" }
  | {
      kind: "ssh"
      profile?: string
      host?: string
      port?: number
      username?: string
      auth?: SshAuthRef
      knownHostPolicy?: "strict"
    }

/** 远程工作目录策略 */
export type RemoteCwdPolicy = {
  allowedRoots: string[]
  deniedRoots: string[]
  defaultCwd?: string
}

/** 远程 session 的 SSH 元数据 (写入 session.json) */
export type SshSessionMetadata = {
  target: {
    kind: "ssh"
    profile?: string
    host: string
    port: number
    username: string
    hostFingerprint?: string
  }
  ssh: {
    authType: "agent" | "key-file"
    knownHostPolicy: "strict"
    connectedAt: string
    lastDataAt?: string
  }
  remote: {
    cwd: string
    command: string
    args: string[]
    pty: {
      term: string
      cols: number
      rows: number
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * 类型守卫：ssh-agent 认证引用。
 * 只接受可选 socket 字符串，不读取 SSH_AUTH_SOCK 的值。
 */
export function isSshAgentAuthRef(value: unknown): value is Extract<SshAuthRef, { type: "agent" }> {
  if (!isRecord(value) || value.type !== "agent") return false
  return value.socket === undefined || typeof value.socket === "string"
}

/**
 * 类型守卫：key-file 认证引用。
 * 只允许保存密钥文件路径和 passphraseEnv 名称，禁止保存 passphrase 明文。
 */
export function isSshKeyFileAuthRef(value: unknown): value is Extract<SshAuthRef, { type: "key-file" }> {
  if (!isRecord(value) || value.type !== "key-file") return false
  if (typeof value.path !== "string" || value.path.trim().length === 0) return false
  return value.passphraseEnv === undefined || (typeof value.passphraseEnv === "string" && value.passphraseEnv.trim().length > 0)
}

/** 类型守卫：任一安全 SSH 认证引用。 */
export function isSshAuthRef(value: unknown): value is SshAuthRef {
  return isSshAgentAuthRef(value) || isSshKeyFileAuthRef(value)
}
