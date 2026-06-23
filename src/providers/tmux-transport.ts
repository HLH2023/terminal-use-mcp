/**
 * Tmux 三通道架构的 transport 抽象。
 *
 * 本地 tmux 和远程 SSH+tmux 的差异仅在此层体现。
 * TmuxCore 通过 TmuxTransport 接口操作，不关心底层是本地还是远程。
 *
 * 三通道架构：
 * - Render Channel: node-pty.spawn() 产生 tmux attach 的实时渲染流
 * - Control Channel: child_process.spawn() 产生 tmux -C 的控制连接
 * - CLI Fallback: execFile 执行 tmux 命令（探测、兼容性、少数无法通过 control mode 完成的操作）
 *
 * 安全边界：
 * - 本地 transport: 使用 execFile(tmuxBin, args)，禁止 shell: true
 * - 远程 transport: 使用 execFile("ssh", args)，参数通过 POSIX 单引号转义防注入
 * - 所有超时 5s，防止 tmux 命令无限挂起
 */

import { execFile } from "node:child_process"
import type { ResolvedSshTarget } from "../targets/ssh-profile-loader.js"
import { shellQuote } from "../terminal/shell-quote.js"
import type { TmuxControlChannelLike, TmuxControlNotification, TmuxControlResponse } from "./tmux-control-channel.js"

// ─── 常量 ─────────────────────────────────────────────────────────────────────

/** tmux 命令执行超时（ms） */
const TMUX_EXEC_TIMEOUT_MS = 5_000

/** tmux attach -f 默认 flags：只读、忽略尺寸差异、跟踪活动 pane、pane 销毁时不自动 detach */
const DEFAULT_ATTACH_FLAGS = "read-only,ignore-size,active-pane,no-detach-on-destroy"

/** tmux control mode attach -f flags：禁止控制模式输出、忽略尺寸、跟踪活动 pane */
const CONTROL_ATTACH_FLAGS = "no-output,ignore-size,active-pane"

// ─── 辅助类型 ─────────────────────────────────────────────────────────────────

/** Render Channel 启动参数 */
export type RenderChannelOpts = {
  /** tmux attach target (session 或 session:window.pane 格式) */
  attachTarget: string
  cols: number
  rows: number
  /** tmux attach -f flags，默认 "read-only,ignore-size,active-pane,no-detach-on-destroy" */
  flags?: string
}

/** node-pty.spawn() 需要的参数 */
export type RenderSpawnResult = {
  command: string
  args: string[]
  options: {
    name: string
    cols: number
    rows: number
    env?: Record<string, string>
    cwd?: string
  }
}

/** child_process.spawn() 需要的参数（Control Channel） */
export type ControlSpawnResult = {
  command: string
  args: string[]
  options?: {
    env?: Record<string, string>
    stdio?: "pipe"
  }
}

/** CLI 执行结果 */
export type ExecTmuxResult = {
  stdout: string
  stderr: string
  exitCode: number | null
}

export type RemoteSshTmuxCommandExecutor = (
  profile: ResolvedSshTarget,
  args: readonly string[],
  options?: { timeoutMs?: number; overrideKnownHosts?: string },
) => Promise<ExecTmuxResult>

/** 远程 SSH+tmux transport 构造参数 */
export type RemoteSshTmuxTransportOpts = {
  target?: ResolvedSshTarget
  host: string
  port?: number
  username?: string
  /** ssh-agent 认证 socket 路径 */
  authSocket?: string
  /** key-file 认证路径 */
  keyFile?: string
  /** 临时 known_hosts 文件路径 */
  knownHostsFile?: string
  /** 连接超时 ms */
  connectTimeoutMs?: number
  /** keepalive 间隔 ms */
  keepaliveIntervalMs?: number
  /** ProxyJump 配置 */
  proxyJump?: string
  commandExecutor?: RemoteSshTmuxCommandExecutor
  tmuxBin?: string
}

// ─── TmuxTransport 接口 ───────────────────────────────────────────────────────

/**
 * Tmux 三通道架构的 transport 抽象。
 *
 * 本地 tmux 和远程 SSH+tmux 的差异仅在此层体现。
 * TmuxCore 通过此接口操作，不关心底层是本地还是远程。
 */
export interface TmuxTransport {
  /** 是否为远程 transport */
  readonly remote: boolean

  /**
   * 启动 Render Channel 的 spawn 参数。
   * 用于 node-pty.spawn() 调用，产生 tmux attach 的实时渲染流。
   *
   * @returns 传给 node-pty.spawn() 的参数
   */
  getRenderSpawnArgs(opts: RenderChannelOpts): RenderSpawnResult

  /**
   * 启动 Control Channel 的 spawn 参数。
   * 用于 child_process.spawn() 调用，产生 tmux -C 的控制连接。
   *
   * @returns 传给 child_process.spawn() 的参数
   */
  getControlSpawnArgs(session: string): ControlSpawnResult

  /**
   * CLI Fallback: 执行 tmux 命令并等待结果。
   * 用于探测、兼容性和少数无法通过 control mode 完成的操作。
   */
  execTmux(args: string[]): Promise<ExecTmuxResult>

  /**
   * CLI Fallback: 执行原始 shell 命令并等待结果。
   * 用于远程 CWD preflight (cd <cwd> && pwd -P) 等场景。
   */
  execRaw(command: string): Promise<ExecTmuxResult>

  /**
   * 获取 tmux 二进制路径。
   * 本地: 从 TERMINAL_USE_TMUX_PATH 或 "tmux"
   * 远程: 固定为 "tmux"（在远程主机上执行）
   */
  readonly tmuxBin: string

  /** transport 描述（用于日志） */
  readonly description: string
}

export interface InProcessControlTmuxTransport extends TmuxTransport {
  createControlChannel(): TmuxControlChannelLike
}

export function hasInProcessControl(transport: TmuxTransport): transport is InProcessControlTmuxTransport {
  return typeof (transport as unknown as InProcessControlTmuxTransport).createControlChannel === "function"
}

class ExecutorTmuxControlChannel implements TmuxControlChannelLike {
  private connected = false

  constructor(private readonly execTmuxCommand: (args: string[]) => Promise<ExecTmuxResult>) {}

  async start(_spawnArgs: ControlSpawnResult): Promise<void> {
    this.connected = true
  }

  async execute(args: string[]): Promise<TmuxControlResponse> {
    const result = await this.execTmuxCommand(args)
    const output = result.stdout
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
    const exitCode = result.exitCode ?? 1
    return {
      ok: exitCode === 0,
      exitCode,
      output,
      errorMessage: exitCode === 0 ? undefined : result.stderr,
      commandNumber: 0,
    }
  }

  onNotification(_handler: (notification: TmuxControlNotification) => void): void {}

  close(): void {
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }
}

// ─── LocalTmuxTransport ───────────────────────────────────────────────────────

/**
 * 本地 tmux transport。
 * 直接在本地执行 tmux 命令。
 */
export class LocalTmuxTransport implements TmuxTransport {
  readonly remote = false
  readonly tmuxBin: string
  readonly description: string

  constructor() {
    this.tmuxBin = process.env.TERMINAL_USE_TMUX_PATH ?? "tmux"
    this.description = "local-tmux"
  }

  getRenderSpawnArgs(opts: RenderChannelOpts): RenderSpawnResult {
    const flags = opts.flags ?? DEFAULT_ATTACH_FLAGS
    return {
      command: this.tmuxBin,
      args: ["attach-session", "-t", opts.attachTarget, "-f", flags],
      options: {
        name: "xterm-256color",
        cols: opts.cols,
        rows: opts.rows,
        env: { TERM: "xterm-256color" },
      },
    }
  }

  getControlSpawnArgs(session: string): ControlSpawnResult {
    return {
      command: this.tmuxBin,
      args: ["-C", "attach-session", "-t", session, "-f", CONTROL_ATTACH_FLAGS],
    }
  }

  async execTmux(args: string[]): Promise<ExecTmuxResult> {
    return new Promise<ExecTmuxResult>((resolve) => {
      execFile(this.tmuxBin, args, { timeout: TMUX_EXEC_TIMEOUT_MS }, (error, stdout, stderr) => {
        if (error) {
          const exitCode = typeof error.code === "number" ? error.code : null
          resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode })
          return
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 })
      })
    })
  }

  async execRaw(command: string): Promise<ExecTmuxResult> {
    return new Promise<ExecTmuxResult>((resolve) => {
      execFile("/bin/sh", ["-c", command], { timeout: TMUX_EXEC_TIMEOUT_MS }, (error, stdout, stderr) => {
        if (error) {
          const exitCode = typeof error.code === "number" ? error.code : null
          resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode })
          return
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 })
      })
    })
  }
}

// ─── RemoteSshTmuxTransport ───────────────────────────────────────────────────

/**
 * 远程 SSH+tmux transport。
 * 通过 system ssh 在远程主机执行 tmux 命令。
 *
 * 安全措施：
 * - 强制 StrictHostKeyChecking=yes
 * - 强制 PreferredAuthentications=publickey + PubkeyAuthentication=yes
 * - 禁止密码认证
 * - 所有远程参数通过 POSIX 单引号转义防注入
 */
export class RemoteSshTmuxTransport implements TmuxTransport {
  readonly remote = true
  tmuxBin: string
  readonly description: string

  /** SSH 连接参数（不含命令部分） */
  private readonly sshArgs: string[]
  /** 远程目标 (user@host 或 host) */
  private readonly remoteTarget: string
  /** 已知主机文件路径 */
  private readonly knownHostsFile?: string
  /** 连接超时 ms */
  private readonly connectTimeoutMs: number
  private readonly commandExecutor?: RemoteSshTmuxCommandExecutor
  private readonly executorTarget?: ResolvedSshTarget
  readonly createControlChannel?: () => TmuxControlChannelLike

  constructor(opts: RemoteSshTmuxTransportOpts) {
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 10_000
    this.knownHostsFile = opts.knownHostsFile
    this.commandExecutor = opts.commandExecutor
    this.executorTarget = opts.target
    this.tmuxBin = opts.tmuxBin ?? "tmux"
    if (this.commandExecutor !== undefined && this.executorTarget !== undefined) {
      this.createControlChannel = () => new ExecutorTmuxControlChannel((args) => this.execTmux(args))
    }

    // 构造远程目标标识
    this.remoteTarget = opts.username !== undefined
      ? `${opts.username}@${opts.host}`
      : opts.host

    // 构造严格 SSH 参数
    this.sshArgs = buildStrictSshArgs(opts, this.connectTimeoutMs)

    this.description = `ssh-tmux:${opts.host}`
  }

  getRenderSpawnArgs(opts: RenderChannelOpts): RenderSpawnResult {
    const flags = opts.flags ?? DEFAULT_ATTACH_FLAGS
    // ssh -tt <args> <remote> "tmux attach-session -t <target> -f <flags>"
    const remoteCmd = quoteRemoteCommand(this.tmuxBin, [
      "attach-session", "-t", opts.attachTarget, "-f", flags,
    ])
    return {
      command: "ssh",
      args: [...this.sshArgs, "-tt", this.remoteTarget, remoteCmd],
      options: {
        name: "xterm-256color",
        cols: opts.cols,
        rows: opts.rows,
        env: { TERM: "xterm-256color" },
      },
    }
  }

  getControlSpawnArgs(session: string): ControlSpawnResult {
    // ssh -T <args> <remote> "tmux -C attach-session -t <session> -f no-output,ignore-size,active-pane"
    const remoteCmd = quoteRemoteCommand(this.tmuxBin, [
      "-C", "attach-session", "-t", session, "-f", CONTROL_ATTACH_FLAGS,
    ])
    return {
      command: "ssh",
      args: [...this.sshArgs, "-T", this.remoteTarget, remoteCmd],
    }
  }

  async execTmux(args: string[]): Promise<ExecTmuxResult> {
    if (this.commandExecutor !== undefined && this.executorTarget !== undefined) {
      return this.commandExecutor(this.executorTarget, [this.tmuxBin, ...args], {
        timeoutMs: TMUX_EXEC_TIMEOUT_MS,
        overrideKnownHosts: this.knownHostsFile,
      })
    }

    // ssh <args> <remote> "tmux <args...>"
    const remoteCmd = quoteRemoteCommand(this.tmuxBin, args)
    return this.execSsh(remoteCmd)
  }

  async execRaw(command: string): Promise<ExecTmuxResult> {
    // ssh <args> <remote> "<command>"
    return this.execSsh(command)
  }

  /** 执行 SSH 命令并等待结果 */
  private execSsh(remoteCommand: string): Promise<ExecTmuxResult> {
    return new Promise<ExecTmuxResult>((resolve) => {
      const fullArgs = [...this.sshArgs, this.remoteTarget, remoteCommand]
      execFile("ssh", fullArgs, { timeout: TMUX_EXEC_TIMEOUT_MS }, (error, stdout, stderr) => {
        if (error) {
          const exitCode = typeof error.code === "number" ? error.code : null
          resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode })
          return
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 })
      })
    })
  }
}

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────

/**
 * 将 tmux 命令和参数组合为远程 shell 安全的字符串。
 * 使用 POSIX shell 单引号包裹每个参数，防止注入。
 *
 * @example
 * quoteRemoteCommand("tmux", ["attach-session", "-t", "my:0.1"])
 * // => "'tmux' 'attach-session' '-t' 'my:0.1'"
 */
function quoteRemoteCommand(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(" ")
}

/**
 * 构造严格 SSH 参数。
 *
 * 安全措施：
 * - StrictHostKeyChecking=yes: 强制 host key 校验
 * - PreferredAuthentications=publickey: 禁止密码认证
 * - PubkeyAuthentication=yes: 仅允许公钥认证
 * - BatchMode=yes: 防止交互式密码/passphrase 提示
 * - UserKnownHostsFile: 指定 known_hosts 文件
 * - ConnectTimeout: 连接超时
 * - ServerAliveInterval: keepalive 探测
 *
 * @param opts - SSH 连接参数
 * @param connectTimeoutMs - 连接超时（ms）
 * @returns SSH 参数数组（不含目标 host 和命令）
 */
function buildStrictSshArgs(opts: RemoteSshTmuxTransportOpts, connectTimeoutMs: number): string[] {
  const connectTimeoutSeconds = Math.max(1, Math.ceil(connectTimeoutMs / 1000))
  const sshArgs: string[] = []

  // key-file 认证
  if (opts.keyFile !== undefined) {
    sshArgs.push("-i", opts.keyFile)
  }

  // 端口
  if (opts.port !== undefined) {
    sshArgs.push("-p", String(opts.port))
  }

  // 严格安全选项
  sshArgs.push(
    "-o", "StrictHostKeyChecking=yes",
    "-o", `ConnectTimeout=${connectTimeoutSeconds}`,
    "-o", "PreferredAuthentications=publickey",
    "-o", "PubkeyAuthentication=yes",
    "-o", "BatchMode=yes",
  )

  // known_hosts 文件
  if (opts.knownHostsFile !== undefined && opts.knownHostsFile.trim().length > 0) {
    sshArgs.push(
      "-o", `UserKnownHostsFile=${opts.knownHostsFile.trim()}`,
      "-o", "GlobalKnownHostsFile=/dev/null",
    )
  }

  // keepalive
  if (opts.keepaliveIntervalMs !== undefined && opts.keepaliveIntervalMs > 0) {
    const keepaliveSeconds = Math.max(1, Math.ceil(opts.keepaliveIntervalMs / 1000))
    sshArgs.push("-o", `ServerAliveInterval=${keepaliveSeconds}`)
  }

  // ProxyJump
  if (opts.proxyJump !== undefined && opts.proxyJump.trim().length > 0) {
    sshArgs.push("-o", `ProxyJump=${opts.proxyJump.trim()}`)
  }

  return sshArgs
}
