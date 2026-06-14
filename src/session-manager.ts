/**
 * SessionManager：负责 session 生命周期、同 session 操作串行化、TTL 清理与 artifact 落盘。
 *
 * 该层是 MCP tools 的直接依赖；所有 provider 操作必须经由 ManagedSession.queue 串行化，
 * 避免同一终端同时执行输入、观察和 resize 等互相干扰的操作。
 */

import { writeFileSync } from "node:fs"

import type {
  ProviderCapabilities,
  ProviderName,
  StartInput,
  TerminalProvider,
  TerminalSession,
} from "./providers/provider.js"
import type { TerminalSnapshot } from "./terminal/terminal-snapshot.js"
import type { TerminalUseConfig } from "./config.js"
import type { Logger } from "./logger.js"
import {
  InvalidCwdError,
  ProviderNotAvailableError,
  SessionNotFoundError,
  TerminalUseError,
  UnsafeCommandError,
} from "./terminal/errors.js"
import { isCommandSafeArgv, isCwdAllowed, maybeWrapWithShell } from "./terminal/command-safety.js"
import { TranscriptRecorder } from "./terminal/transcript.js"
import { generateSessionId } from "./terminal/ids.js"
import {
  type ArtifactPaths,
  appendErrorLog,
  appendNdjsonLine,
  ensureArtifactRoot,
  ensureSessionArtifactDir,
  writeJsonFile,
} from "./artifacts.js"

const PROVIDER_PRIORITY: ProviderName[] = ["native-pty", "tmux"]
const REMOTE_PROVIDER_PRIORITY: ProviderName[] = ["ssh-pty", "ssh-tmux"]
const TTL_HARD_KILL_DELAY_MS = 3_000

/** PromiseQueue — 同一 session 操作串行化 */
export class PromiseQueue {
  private queue: Array<() => Promise<unknown>> = []
  private running = false

  /** 入队一个异步操作，串行执行 */
  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = async (): Promise<void> => {
        try {
          const result = await fn()
          resolve(result)
        } catch (err) {
          reject(err)
        }
      }

      this.queue.push(run)
      if (!this.running) {
        this.running = true
        void this.processQueue()
      }
    })
  }

  /** 顺序取出并执行队列中的操作；不同 session 的队列互不阻塞。 */
  private async processQueue(): Promise<void> {
    while (this.queue.length > 0) {
      const next = this.queue.shift()
      if (next !== undefined) {
        await next()
      }
    }
    this.running = false
  }
}

/** ManagedSession — SessionManager 内部管理的 session 全状态 */
export type ManagedSession = {
  sessionId: string
  providerName: ProviderName
  providerSessionId: string
  command: string
  args: string[]
  cwd: string
  label?: string
  status: "starting" | "running" | "exited" | "killed" | "error"
  exitCode?: number | null
  createdAt: Date
  lastActivityAt: Date
  ttlMs: number
  queue: PromiseQueue
  transcript: TranscriptRecorder
  lastSnapshot?: TerminalSnapshot
  capabilities: ProviderCapabilities
  metadata?: TerminalSession["metadata"]
}

export class SessionManager {
  private sessions: Map<string, ManagedSession>
  private providers: Map<ProviderName, TerminalProvider>
  private config: TerminalUseConfig
  private logger: Logger
  private cleanupTimer: ReturnType<typeof setInterval> | undefined

  constructor(config: TerminalUseConfig, logger: Logger) {
    this.sessions = new Map()
    this.providers = new Map()
    this.config = config
    this.logger = logger
    this.cleanupTimer = undefined

    this.runBestEffortArtifactWrite("ensure artifact root", undefined, () => {
      ensureArtifactRoot(this.config.artifactDir)
    })
  }

  /** 返回已注册 providers 的只读引用，供 mcp-server.ts 构建 ProviderExecutor。 */
  getProviders(): ReadonlyMap<ProviderName, TerminalProvider> {
    return this.providers
  }

  /** 注册 provider */
  registerProvider(provider: TerminalProvider): void {
    this.providers.set(provider.name, provider)
    this.logger.debug("terminal provider registered", { provider: provider.name })
  }

  /** 启动新 session */
  async start(input: StartInput & { provider?: ProviderName }): Promise<ManagedSession> {
    this.assertCommandAllowed(input.command, input.args)
    await this.assertCwdAllowed(input)
    const providerInput = maybeWrapWithShell(input)

    const provider = await this.selectProvider(input.provider, input.target)
    if (!provider.capabilities.supportsStart) {
      throw new ProviderNotAvailableError(provider.name, "Provider does not support starting new sessions")
    }

    const providerSession = await provider.start(providerInput)
    const session = this.createManagedSession(providerSession, provider)

    this.sessions.set(session.sessionId, session)
    this.touchSession(session.sessionId)
    this.persistSessionArtifacts(session, "start")
    this.logger.info("terminal session started", {
      sessionId: session.sessionId,
      provider: session.providerName,
      command: session.command,
    })

    return session
  }

  /** 附加到已有 session (如 tmux session) */
  async attach(sessionIdOrName: string, providerName?: ProviderName): Promise<ManagedSession> {
    const provider = await this.selectProvider(providerName)
    if (!provider.capabilities.supportsAttach || provider.attach === undefined) {
      throw new ProviderNotAvailableError(provider.name, "Provider does not support attaching to existing sessions")
    }

    const providerSession = await provider.attach(sessionIdOrName)
    const session = this.createManagedSession(providerSession, provider)

    this.sessions.set(session.sessionId, session)
    this.touchSession(session.sessionId)
    this.persistSessionArtifacts(session, "attach")
    this.logger.info("terminal session attached", { sessionId: session.sessionId, provider: session.providerName })

    return session
  }

  /**
   * LLM agent 可能在 sessionId 前拼接 provider name 前缀（如 "native_term_xxx"），
   * 或产生其他非标准变形。此方法先精确匹配，失败后依次尝试：
   * 1. 剥离已知 provider 前缀（native_|sshpty_|tumcp_|tmux_）
   * 2. 模糊后缀匹配：在所有活跃 session 中查找后缀一致的 key
   */
  static stripProviderPrefix(id: string): string {
    return id.replace(/^(native_|sshpty_|tumcp_|tmux_)/, "")
  }

  /** 获取 session (不存在时抛 SessionNotFoundError) */
  getSession(sessionId: string): ManagedSession {
    // 精确匹配
    let session = this.sessions.get(sessionId)
    if (session !== undefined) return session

    // 剥离已知 provider 前缀再试
    const stripped = SessionManager.stripProviderPrefix(sessionId)
    if (stripped !== sessionId) {
      session = this.sessions.get(stripped)
      if (session !== undefined) {
        this.logger.info("session lookup: stripped provider prefix", { original: sessionId, resolved: stripped })
        return session
      }
    }

    // 模糊后缀匹配：遍历所有活跃 session，查找 sessionId 后缀一致的
    // 防御 LLM 各种非标准变形（如添加未知前缀、混合大小写等）
    for (const [key, sess] of this.sessions) {
      if (key.endsWith(sessionId) || sessionId.endsWith(key)) {
        this.logger.warn("session lookup: fuzzy suffix match", { original: sessionId, resolved: key })
        return sess
      }
    }

    throw new SessionNotFoundError(sessionId)
  }

  /** 列出所有 session */
  listSessions(): ManagedSession[] {
    return Array.from(this.sessions.values())
  }

  /** 删除 session (不 kill 进程，只从 map 移除) */
  removeSession(sessionId: string): void {
    const session = this.getSession(sessionId)
    this.persistSessionArtifacts(session, "remove")
    this.sessions.delete(sessionId)
    this.logger.info("terminal session removed", { sessionId })
  }

  /** Kill session */
  async kill(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    const provider = this.getRegisteredProvider(session.providerName)

    await session.queue.enqueue(async () => {
      await provider.kill(session.providerSessionId)
      session.status = "killed"
      session.exitCode = null
      session.transcript.recordExit(null, "killed")
      this.touchSession(session.sessionId)
      this.persistSessionArtifacts(session, "kill")
    })

    this.sessions.delete(sessionId)
    this.logger.info("terminal session killed", { sessionId, provider: session.providerName })
  }

  /** Kill 所有 session */
  async killAllSessions(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys())
    await Promise.all(sessionIds.map(async (sessionId) => {
      try {
        await this.kill(sessionId)
      } catch (err) {
        this.logger.error("failed to kill terminal session", {
          sessionId,
          error: this.formatError(err),
        })
      }
    }))
  }

  /** 重命名 session label */
  async rename(sessionId: string, label: string): Promise<void> {
    const session = this.getSession(sessionId)
    const provider = this.getRegisteredProvider(session.providerName)

    await session.queue.enqueue(async () => {
      if (provider.rename !== undefined && provider.capabilities.supportsRename) {
        await provider.rename(session.providerSessionId, label)
      }
      session.label = label
      this.touchSession(session.sessionId)
      this.persistSessionArtifacts(session, "rename")
    })
  }

  /** 启动 TTL cleanup 定时器 */
  startTtlCleanup(): void {
    if (this.cleanupTimer !== undefined) {
      return
    }

    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpiredSessions()
    }, this.config.cleanupIntervalMs)
  }

  /** 停止 TTL cleanup 定时器 */
  stopTtlCleanup(): void {
    if (this.cleanupTimer === undefined) {
      return
    }

    clearInterval(this.cleanupTimer)
    this.cleanupTimer = undefined
  }

  /** 更新 session lastActivityAt */
  touchSession(sessionId: string): void {
    const session = this.getSession(sessionId)
    session.lastActivityAt = new Date()
  }

  /** 清理过期 session */
  private async cleanupExpiredSessions(): Promise<void> {
    const now = Date.now()
    const expiredSessions = this.listSessions().filter((session) => {
      return now - session.lastActivityAt.getTime() > session.ttlMs
    })

    await Promise.all(expiredSessions.map(async (session) => {
      await this.cleanupExpiredSession(session)
    }))
  }

  /** 选择 provider (按优先级或用户指定) */
  private async selectProvider(preferred?: ProviderName, target?: StartInput["target"]): Promise<TerminalProvider> {
    if (preferred !== undefined) {
      const provider = this.providers.get(preferred)
      if (provider === undefined) {
        throw new ProviderNotAvailableError(preferred, "Provider is not registered")
      }
      if (!(await provider.isAvailable())) {
        throw new ProviderNotAvailableError(preferred, "Provider is registered but not available on this machine")
      }
      return provider
    }

    const orderedProviderNames = this.buildProviderPriorityList(target)
    for (const providerName of orderedProviderNames) {
      const provider = this.providers.get(providerName)
      if (provider !== undefined && await provider.isAvailable()) {
        return provider
      }
    }

    throw new ProviderNotAvailableError("auto", "No registered provider is available")
  }

  /** TTL 超时处理：记录 SIGTERM/SIGKILL 语义，并用当前 provider.kill 做资源释放兜底。 */
  private async cleanupExpiredSession(session: ManagedSession): Promise<void> {
    const provider = this.getRegisteredProvider(session.providerName)
    this.logger.warn("terminal session ttl expired", { sessionId: session.sessionId, ttlMs: session.ttlMs })

    try {
      await session.queue.enqueue(async () => {
        session.status = "killed"
        session.transcript.recordExit(null, "SIGTERM")
        this.touchSession(session.sessionId)
        this.persistSessionArtifacts(session, "ttl-sigterm")

        await this.delay(TTL_HARD_KILL_DELAY_MS)

        session.transcript.recordExit(null, "SIGKILL")
      await provider.kill(session.providerSessionId)
        this.persistSessionArtifacts(session, "ttl-sigkill")
      })
    } catch (err) {
      session.status = "error"
      this.persistArtifactError(session, err)
      this.logger.error("terminal session ttl cleanup failed", {
        sessionId: session.sessionId,
        error: this.formatError(err),
      })
    } finally {
      this.sessions.delete(session.sessionId)
    }
  }

  /** 将 provider 返回的公开 session 记录转换为 manager 内部状态。 */
  private createManagedSession(providerSession: TerminalSession, provider: TerminalProvider): ManagedSession {
    const sessionId = providerSession.sessionId.length > 0 ? providerSession.sessionId : generateSessionId()
    return {
      sessionId,
      providerName: provider.name,
      providerSessionId: providerSession.providerSessionId,
      command: providerSession.command,
      args: providerSession.args,
      cwd: providerSession.cwd,
      label: providerSession.label,
      status: providerSession.status,
      exitCode: providerSession.exitCode,
      createdAt: this.parseDate(providerSession.createdAt),
      lastActivityAt: this.parseDate(providerSession.lastActivityAt),
      ttlMs: providerSession.ttlMs > 0 ? providerSession.ttlMs : this.config.sessionTtlMs,
      queue: new PromiseQueue(),
      transcript: new TranscriptRecorder(sessionId),
      capabilities: provider.capabilities,
      metadata: providerSession.metadata,
    }
  }

  /** 命令安全检查：接受 command + args 完整 argv，只覆盖 terminal.start 的启动命令，不声称完整沙箱。 */
  private assertCommandAllowed(command: string, args: string[]): void {
    const result = isCommandSafeArgv(
      command,
      args,
      this.config.allowedCommands,
      this.config.deniedCommands,
      this.config.riskyCommandMode,
    )

    if (!result.ok) {
      if (result.code === "CONFIRMATION_REQUIRED") {
        throw new TerminalUseError({
          code: "CONFIRMATION_REQUIRED",
          message: result.reason,
          retryable: true,
          hint: "Ask user for confirmation before starting this command",
        })
      }
      throw new UnsafeCommandError(command, result.reason)
    }
  }

  /** CWD 安全检查限制 session 初始工作目录。使用 realpath canonicalize 防御 symlink 绕过。 */
  private async assertCwdAllowed(input: StartInput): Promise<void> {
    if (input.target?.kind === "ssh") {
      return
    }

    const result = await isCwdAllowed(input.cwd, this.config.workspaceRoot, this.config.allowedCwdRoots)
    if (!result.ok) {
      throw new InvalidCwdError(input.cwd, result.reason)
    }
  }

  /** 根据默认 provider 和固定优先级构造去重后的选择列表。 */
  private buildProviderPriorityList(target?: StartInput["target"]): ProviderName[] {
    const priority = target?.kind === "ssh" ? REMOTE_PROVIDER_PRIORITY : PROVIDER_PRIORITY
    const defaultPriority = priority.includes(this.config.defaultProvider) ? [this.config.defaultProvider] : []
    const ordered: ProviderName[] = [...defaultPriority, ...priority]
    return ordered.filter((providerName, index) => ordered.indexOf(providerName) === index)
  }

  /** 取已注册 provider；用于已存在 session 的后续操作。 */
  private getRegisteredProvider(providerName: ProviderName): TerminalProvider {
    const provider = this.providers.get(providerName)
    if (provider === undefined) {
      throw new ProviderNotAvailableError(providerName, "Provider for this session is no longer registered")
    }
    return provider
  }

  /** 写入 session 元数据、transcript 和事件摘要；失败只记日志，不影响主流程。 */
  private persistSessionArtifacts(session: ManagedSession, eventType: string): void {
    let paths: ArtifactPaths | undefined

    this.runBestEffortArtifactWrite("persist session artifacts", session.sessionId, () => {
      paths = ensureSessionArtifactDir(this.config.artifactDir, session.sessionId)
      writeJsonFile(paths.sessionFile, this.toTerminalSession(session))
      writeFileSync(paths.transcriptFile, session.transcript.export("text"), "utf8")
      writeFileSync(paths.transcriptRedactedFile, session.transcript.export("text", { redact: true }), "utf8")
      appendNdjsonLine(paths.eventsFile, {
        timestamp: new Date().toISOString(),
        type: eventType,
        session: this.toTerminalSession(session),
      })
    })

    if (paths !== undefined) {
      return
    }
  }

  /** artifact 错误单独落盘到 session errors.log，仍保持 best-effort。 */
  private persistArtifactError(session: ManagedSession, err: unknown): void {
    this.runBestEffortArtifactWrite("persist session error", session.sessionId, () => {
      const paths = ensureSessionArtifactDir(this.config.artifactDir, session.sessionId)
      appendErrorLog(paths.errorsFile, this.formatError(err))
    })
  }

  /** artifact 写入不应让 session 生命周期失败。 */
  private runBestEffortArtifactWrite(action: string, sessionId: string | undefined, fn: () => void): void {
    try {
      fn()
    } catch (err) {
      this.logger.warn("artifact write failed", {
        action,
        sessionId,
        error: this.formatError(err),
      })
    }
  }

  /** 转为 provider.ts 中公开的 TerminalSession，可安全 JSON 序列化。 */
  private toTerminalSession(session: ManagedSession): TerminalSession {
    return {
      sessionId: session.sessionId,
      providerName: session.providerName,
      providerSessionId: session.providerSessionId,
      command: session.command,
      args: session.args,
      cwd: session.cwd,
      label: session.label,
      status: session.status,
      exitCode: session.exitCode,
      createdAt: session.createdAt.toISOString(),
      lastActivityAt: session.lastActivityAt.toISOString(),
      ttlMs: session.ttlMs,
      capabilities: session.capabilities,
      metadata: session.metadata,
    }
  }

  /** provider 时间戳异常时使用当前时间，避免无效 Date 污染 artifact。 */
  private parseDate(value: string): Date {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
      return new Date()
    }
    return parsed
  }

  /** 标准化未知错误，避免日志和 errors.log 写入不可读对象。 */
  private formatError(err: unknown): string {
    if (err instanceof Error) {
      return `${err.name}: ${err.message}`
    }
    return String(err)
  }

  /** Promise 包装的 timeout，供 TTL soft/hard kill 间隔复用。 */
  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms)
    })
  }
}
