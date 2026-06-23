/**
 * SshTmuxProvider — 远程 SSH+tmux TerminalProvider 接口适配层。
 *
 * 薄壳委托模式：SSH 安全前置检查、target/profile 解析和远程 transport
 * 构造保留在本文件；会话生命周期、三通道渲染、输入、搜索、滚动和
 * transcript 全部委托给 TmuxCore。
 */

import { randomBytes } from "node:crypto"

import type {
  ExportOptions,
  FindResult,
  MouseClickInput,
  MouseScrollInput,
  ProviderCapabilities,
  ProviderName,
  ScrollDirection,
  ScrollMode,
  StartInput,
  TerminalProvider,
  TerminalSession,
  TranscriptExport,
  WaitOptions,
  WaitStableOptions,
} from "./provider.js"
import type { ParsedKeyExpr } from "../terminal/keymap.js"
import type { TerminalSnapshot, TerminalSnapshotMode } from "../terminal/terminal-snapshot.js"
import type { Logger } from "../logger.js"
import type { RemoteCwdPolicy, SshHostProfile } from "../targets/target-types.js"
import type { ResolvedSshTarget } from "../targets/ssh-profile-loader.js"
import type { SystemSshCommandResult } from "./system-ssh-transport.js"
import type { RemoteCapabilities, RemoteCapabilityCache } from "../targets/remote-capability-cache.js"
import { TmuxCore } from "./tmux-core.js"
import type { TmuxCoreSession } from "./tmux-core.js"
import { RemoteSshTmuxTransport } from "./tmux-transport.js"
import type { RemoteSshTmuxCommandExecutor } from "./tmux-transport.js"
import { execSshCommand, isSystemSshAvailable } from "./system-ssh-transport.js"
import { checkSecretEnvPolicy } from "../terminal/secret-env-policy.js"
import type { SecretEnvPolicy } from "../config.js"
import { shellQuote } from "../terminal/shell-quote.js"
import { createRemoteCwdPolicy, assertRemoteCwdAllowed, validateCanonicalRemoteCwd } from "../targets/remote-cwd-policy.js"
import { remoteCapabilityCache } from "../targets/remote-capability-cache.js"
import { expandUserPath, loadHostsConfig } from "../targets/ssh-host-config.js"
import { resolveSshTarget } from "../targets/ssh-profile-loader.js"
import { cleanupTempKnownHosts, verifyPinnedFingerprintOrThrow } from "../targets/ssh-keyscan-verify.js"
import {
  DependencyMissingError,
  RemoteCommandDeniedError,
  RemoteCwdDeniedError,
  RemoteTmuxNotAvailableError,
  SecretEnvDeniedError,
  TerminalUseError,
} from "../terminal/errors.js"

const SSH_TMUX_EXEC_TIMEOUT_MS = 10_000
const DEFAULT_TTL_MS = 60 * 60 * 1000
const LIST_SEPARATOR = "\t"
const MAX_SAFE_SESSION_NAME_LENGTH = 80

const SSH_TMUX_CAPABILITIES: ProviderCapabilities = {
  provider: "ssh-tmux",
  supportsStart: true,
  supportsAttach: true,
  supportsStableWait: true,
  supportsTextWait: true,
  supportsHighlights: true,
  supportsScrollback: true,
  supportsResize: true,
  supportsTranscriptExport: true,
  supportsExitCode: true,
  supportsTitle: true,
  supportsFullscreenDetection: true,
  supportsRename: true,
  supportsScroll: true,
  supportsFind: true,
  supportsMouseClick: true,
  supportsMouseScroll: true,
}

export type ExecSshTmuxOptions = {
  timeoutMs?: number
  /** 覆盖 profile.knownHosts；用于 ssh-keyscan 验证后生成的临时 known_hosts。 */
  overrideKnownHosts?: string
}

export type SshTmuxCommandExecutor = (
  profile: ResolvedSshTarget,
  args: readonly string[],
  options?: ExecSshTmuxOptions,
) => Promise<SystemSshCommandResult>

export type SshTmuxProviderOptions = {
  hostsConfig?: ReadonlyMap<string, SshHostProfile>
  hostsConfigPath?: string
  commandExecutor?: SshTmuxCommandExecutor
  sshAvailabilityChecker?: () => Promise<boolean>
  capabilityCache?: RemoteCapabilityCache
  /** ssh-keyscan fingerprint 验证器；生产默认使用 verifyPinnedFingerprintOrThrow，测试可注入 mock。 */
  keyscanVerifier?: (profile: ResolvedSshTarget) => Promise<{ tempKnownHostsPath: string; matchedFingerprint: string }>
  /** 原始远程命令执行器；用于 canonical CWD preflight 等非 tmux 命令，默认走 RemoteSshTmuxTransport.execRaw。 */
  rawCommandExecutor?: (target: ResolvedSshTarget, command: string, options?: ExecSshTmuxOptions) => Promise<SystemSshCommandResult>
  /** 秘密环境变量策略；统一从 config 层传入，默认 "deny"。 */
  secretEnvPolicy?: SecretEnvPolicy
}

export type SshTmuxListEntry = {
  name: string
  createdAt: string
  cols: number
  rows: number
}

type SshTmuxSessionContext = {
  target: ResolvedSshTarget
  targetKey: string
  transport: RemoteSshTmuxTransport
  tempKnownHostsPath?: string
}

/** 安全的 SSH 远程 tmux 命令执行入口；底层统一走系统 ssh + execFile 参数数组。 */
export async function execSshTmux(
  profile: ResolvedSshTarget,
  args: readonly string[],
  options?: ExecSshTmuxOptions,
): Promise<SystemSshCommandResult> {
  const keyFile = profile.auth.type === "key-file" ? expandUserPath(profile.auth.path) : undefined
  const effectiveKnownHosts = options?.overrideKnownHosts
    ?? (profile.knownHosts !== undefined ? expandUserPath(profile.knownHosts) : undefined)
  return execSshCommand(profile, args, {
    keyFile,
    connectTimeoutMs: profile.connectTimeoutMs,
    execTimeoutMs: options?.timeoutMs ?? SSH_TMUX_EXEC_TIMEOUT_MS,
    knownHosts: effectiveKnownHosts,
  })
}

/** 生成远程 tmux session 名；保留给外部调用方和测试复用。 */
export function createSshTmuxSessionName(): string {
  return `rtumcp_${randomBytes(4).toString("hex")}`
}

/** 把用户可见 label 收敛成 tmux target 安全字符集，避免冒号/空白/控制符污染 target 语义。 */
export function sanitizeTmuxSessionName(input: string): string {
  const normalized = input
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")

  if (normalized.length === 0) return createSshTmuxSessionName()
  const safeHead = /^[A-Za-z0-9]/.test(normalized) ? normalized : `s_${normalized}`
  return safeHead.slice(0, MAX_SAFE_SESSION_NAME_LENGTH)
}

/** 解析 tmux list-sessions 的制表符分隔输出，供 list() 和单元测试复用。 */
export function parseTmuxListSessionsOutput(stdout: string): SshTmuxListEntry[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseTmuxListEntry)
}

export class SshTmuxProvider implements TerminalProvider {
  readonly name: ProviderName = "ssh-tmux"
  readonly capabilities: ProviderCapabilities = SSH_TMUX_CAPABILITIES

  private readonly core: TmuxCore
  private readonly logger: Logger
  private readonly hostsConfig?: ReadonlyMap<string, SshHostProfile>
  private readonly hostsConfigPath?: string
  private readonly sshAvailabilityChecker: () => Promise<boolean>
  private readonly capabilityCache: RemoteCapabilityCache
  private readonly commandExecutor?: RemoteSshTmuxCommandExecutor
  private readonly keyscanVerifier: (profile: ResolvedSshTarget) => Promise<{ tempKnownHostsPath: string; matchedFingerprint: string }>
  private readonly rawCommandExecutor?: (target: ResolvedSshTarget, command: string, options?: ExecSshTmuxOptions) => Promise<SystemSshCommandResult>
  private readonly secretEnvPolicy: SecretEnvPolicy
  private readonly sessionContexts: Map<string, SshTmuxSessionContext>
  private sshAvailable: boolean | undefined

  constructor(logger: Logger, options: SshTmuxProviderOptions = {}) {
    this.core = new TmuxCore(logger)
    this.logger = logger
    this.hostsConfig = options.hostsConfig
    this.hostsConfigPath = options.hostsConfigPath
    this.sshAvailabilityChecker = options.sshAvailabilityChecker ?? isSystemSshAvailable
    this.capabilityCache = options.capabilityCache ?? remoteCapabilityCache
    this.commandExecutor = options.commandExecutor
    this.keyscanVerifier = options.keyscanVerifier ?? verifyPinnedFingerprintOrThrow
    this.rawCommandExecutor = options.rawCommandExecutor
    this.secretEnvPolicy = options.secretEnvPolicy ?? "deny"
    this.sessionContexts = new Map()
    this.sshAvailable = undefined
  }

  /** 检查本地 ssh 命令可用性，且至少配置了一个 SSH profile。 */
  async isAvailable(): Promise<boolean> {
    if (this.sshAvailable !== undefined) return this.sshAvailable

    try {
      const profiles = await this.loadHostProfiles()
      this.sshAvailable = profiles.size > 0 && await this.sshAvailabilityChecker()
      return this.sshAvailable
    } catch {
      this.sshAvailable = false
      return false
    }
  }

  /** 解析 SSH target、执行安全 preflight，并委托 TmuxCore 启动远程 tmux session。 */
  async start(input: StartInput): Promise<TerminalSession> {
    await this.ensureSystemSshAvailable()

    const target = await this.resolveSshTmuxTarget(input)
    this.assertPublicKeyOnlyAuth(target)
    this.assertSecretEnvAllowed(input.env)
    this.assertSecretEnvAllowed(target.env)

    const verifiedKnownHosts = await this.verifyKnownHostsIfPinned(target)
    const transport = this.createTransport(target, verifiedKnownHosts)

    try {
      const capabilities = await this.discoverCapabilities(target, transport)
      ensureRemoteTmuxUsable(this.name, target, capabilities)
      transport.tmuxBin = capabilities.tmuxPath ?? transport.tmuxBin

      const policy = createRemoteCwdPolicy(target)
      const remoteCwd = assertRemoteCwdAllowed(policy, input.cwd)
      const canonicalCwd = await preflightCanonicalRemoteCwdForTmux(
        this.createRawExecutor(transport),
        target,
        remoteCwd,
        policy,
        verifiedKnownHosts,
      )

      const coreInput: StartInput = {
        ...input,
        command: buildRemoteShellCommand(capabilities, input.command, input.args),
        args: [],
        cwd: canonicalCwd,
        env: mergeRemoteEnv(target.env, input.env),
      }
      const coreSession = await this.core.start(coreInput, transport, this.name)
      const context: SshTmuxSessionContext = {
        target,
        targetKey: targetKey(target),
        transport,
        tempKnownHostsPath: verifiedKnownHosts,
      }
      this.sessionContexts.set(coreSession.sessionInfo.providerSessionId, context)

      this.logger.info("ssh-tmux session started", {
        sessionId: coreSession.sessionInfo.sessionId,
        providerSessionId: coreSession.sessionInfo.providerSessionId,
        profile: target.profile ?? target.name,
      })
      return this.coreSessionToTerminalSession(coreSession, context)
    } catch (error) {
      cleanupTempKnownHosts(verifiedKnownHosts)
      throw error
    }
  }

  /** 通过 profile:tmuxSessionName 或 ssh-tmux://profile/tmuxSessionName 附加远程 tmux session。 */
  async attach(sessionIdOrName: string): Promise<TerminalSession> {
    await this.ensureSystemSshAvailable()

    const existing = this.findTrackedSession(sessionIdOrName)
    if (existing !== undefined) return this.coreSessionToTerminalSession(existing, this.contextForCoreSession(existing))

    const attachTarget = await this.resolveAttachTarget(sessionIdOrName)
    this.assertPublicKeyOnlyAuth(attachTarget.target)

    const verifiedKnownHosts = await this.verifyKnownHostsIfPinned(attachTarget.target)
    const transport = this.createTransport(attachTarget.target, verifiedKnownHosts)

    try {
      const capabilities = await this.discoverCapabilities(attachTarget.target, transport)
      ensureRemoteTmuxUsable(this.name, attachTarget.target, capabilities)
      transport.tmuxBin = capabilities.tmuxPath ?? transport.tmuxBin

      const coreSession = await this.core.attach(attachTarget.tmuxId, transport, this.name)
      const context: SshTmuxSessionContext = {
        target: attachTarget.target,
        targetKey: targetKey(attachTarget.target),
        transport,
        tempKnownHostsPath: verifiedKnownHosts,
      }
      this.sessionContexts.set(coreSession.sessionInfo.providerSessionId, context)

      this.logger.info("ssh-tmux session attached", {
        sessionId: coreSession.sessionInfo.sessionId,
        providerSessionId: coreSession.sessionInfo.providerSessionId,
        tmuxId: attachTarget.tmuxId,
        profile: attachTarget.target.profile ?? attachTarget.target.name,
      })
      return this.coreSessionToTerminalSession(coreSession, context)
    } catch (error) {
      cleanupTempKnownHosts(verifiedKnownHosts)
      throw error
    }
  }

  async snapshot(sessionId: string, mode?: TerminalSnapshotMode): Promise<TerminalSnapshot> {
    return this.core.snapshot(sessionId, mode)
  }

  async waitForText(sessionId: string, text: string, options: WaitOptions): Promise<TerminalSnapshot> {
    return this.core.waitForText(sessionId, text, options)
  }

  async waitStable(sessionId: string, options: WaitStableOptions): Promise<TerminalSnapshot> {
    return this.core.waitStable(sessionId, options)
  }

  async type(sessionId: string, text: string): Promise<void> {
    return this.core.type(sessionId, text)
  }

  async press(sessionId: string, keyExpr: string, parsed: ParsedKeyExpr): Promise<void> {
    return this.core.press(sessionId, keyExpr, parsed)
  }

  async paste(sessionId: string, text: string, mode?: "bracketed" | "line-by-line" | "raw"): Promise<void> {
    return this.core.paste(sessionId, text, mode)
  }

  async find(sessionId: string, pattern: string, regex?: boolean, includeScrollback?: boolean): Promise<FindResult[]> {
    return this.core.find(sessionId, pattern, regex, includeScrollback)
  }

  async scroll(sessionId: string, direction: ScrollDirection, lines: number, mode?: ScrollMode): Promise<void> {
    return this.core.scroll(sessionId, direction, lines, mode ?? "program-key")
  }

  async mouseClick(sessionId: string, input: MouseClickInput): Promise<void> {
    return this.core.mouseClick(sessionId, input)
  }

  async mouseScroll(sessionId: string, input: MouseScrollInput): Promise<void> {
    return this.core.mouseScroll(sessionId, input)
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    return this.core.resize(sessionId, cols, rows)
  }

  async rename(sessionId: string, label: string): Promise<void> {
    return this.core.rename(sessionId, sanitizeTmuxSessionName(label))
  }

  /** 终止远程 tmux session，并清理 keyscan 临时 known_hosts。 */
  async kill(sessionId: string): Promise<void> {
    const contextKey = this.resolveContextKey(sessionId)
    const context = contextKey === undefined ? undefined : this.sessionContexts.get(contextKey)

    try {
      await this.core.kill(sessionId)
    } finally {
      cleanupTempKnownHosts(context?.tempKnownHostsPath)
      if (contextKey !== undefined) this.sessionContexts.delete(contextKey)
    }
  }

  async exportTranscript(sessionId: string, options: ExportOptions): Promise<TranscriptExport> {
    return this.core.exportTranscript(sessionId, options)
  }

  hasSession(sessionId: string): boolean {
    return this.core.hasSession(sessionId)
  }

  listActiveSessionIds(): string[] {
    return this.core.listActiveSessionIds()
  }

  /** 列出 TmuxCore tracked sessions，并通过对应 SSH transport 查询远程外部 tmux sessions。 */
  async list(): Promise<TerminalSession[]> {
    await this.ensureSystemSshAvailable()

    const coreSessions = this.core.listSessions()
    const trackedSessions = coreSessions.map((session) => this.coreSessionToTerminalSession(session, this.contextForCoreSession(session)))
    const externalSessions: TerminalSession[] = []

    for (const entry of this.uniqueTrackedTargets()) {
      try {
        const remoteEntries = await this.listTmuxSessionsForTarget(entry.transport)
        const trackedTmuxIds = new Set(
          coreSessions
            .filter((session) => this.contextForCoreSession(session)?.targetKey === entry.key)
            .map((session) => session.tmuxId),
        )
        externalSessions.push(...remoteEntries
          .filter((remoteEntry) => !trackedTmuxIds.has(remoteEntry.name))
          .map((remoteEntry) => this.createExternalListSession(entry.context.target, remoteEntry)))
      } catch (error) {
        this.logger.warn("ssh-tmux list-sessions failed for tracked target", {
          profile: entry.context.target.profile ?? entry.context.target.name,
          error: stringifyUnknownError(error),
        })
      }
    }

    return [...trackedSessions, ...externalSessions]
  }

  private async resolveSshTmuxTarget(input: StartInput): Promise<ResolvedSshTarget> {
    const target = input.target ?? { kind: "local" }
    const hostsConfig = await this.loadHostProfiles()
    const resolved = resolveSshTarget(target, hostsConfig)
    if (resolved.kind !== "ssh") {
      throw new RemoteCommandDeniedError(input.command, "ssh-tmux only supports target.kind=ssh")
    }
    if (resolved.allowTmux === false) {
      throw new RemoteTmuxNotAvailableError(resolved.profile ?? resolved.name)
    }
    return resolved
  }

  private async resolveAttachTarget(sessionIdOrName: string): Promise<{ target: ResolvedSshTarget; tmuxId: string }> {
    const parsed = parseAttachTarget(sessionIdOrName)
    if (parsed === undefined) {
      throw new RemoteCommandDeniedError("ssh-tmux attach", "Use profile:tmuxSessionName or ssh-tmux://profile/tmuxSessionName")
    }

    const hostsConfig = await this.loadHostProfiles()
    const resolved = resolveSshTarget({ kind: "ssh", profile: parsed.profile }, hostsConfig)
    if (resolved.kind !== "ssh") {
      throw new RemoteCommandDeniedError("ssh-tmux attach", "Resolved attach target is not SSH")
    }
    if (resolved.allowTmux === false) {
      throw new RemoteTmuxNotAvailableError(resolved.profile ?? resolved.name)
    }
    return { target: resolved, tmuxId: parsed.tmuxId }
  }

  private async loadHostProfiles(): Promise<ReadonlyMap<string, SshHostProfile>> {
    if (this.hostsConfig !== undefined) return this.hostsConfig
    return loadHostsConfig(this.hostsConfigPath)
  }

  private async ensureSystemSshAvailable(): Promise<void> {
    const available = await this.isAvailable()
    if (!available) {
      throw new DependencyMissingError("ssh", "Install OpenSSH client and configure at least one SSH profile")
    }
  }

  private async verifyKnownHostsIfPinned(target: ResolvedSshTarget): Promise<string | undefined> {
    if (target.pinnedHostFingerprint === undefined) return undefined
    const result = await this.keyscanVerifier(target)
    this.logger.info("ssh-tmux host fingerprint verified", {
      profile: target.profile ?? target.name,
      fingerprint: result.matchedFingerprint,
    })
    return result.tempKnownHostsPath
  }

  private createTransport(target: ResolvedSshTarget, overrideKnownHosts?: string): RemoteSshTmuxTransport {
    const keyFile = target.auth.type === "key-file" ? expandUserPath(target.auth.path) : undefined
    const authSocket = target.auth.type === "agent" && target.auth.socket !== undefined
      ? expandUserPath(target.auth.socket)
      : undefined
    const knownHostsFile = overrideKnownHosts
      ?? (target.knownHosts !== undefined ? expandUserPath(target.knownHosts) : undefined)

    return new RemoteSshTmuxTransport({
      target,
      host: target.host,
      port: target.port,
      username: target.username,
      authSocket,
      keyFile,
      knownHostsFile,
      connectTimeoutMs: target.connectTimeoutMs,
      keepaliveIntervalMs: target.keepaliveIntervalMs,
      proxyJump: target.proxyJump,
      commandExecutor: this.commandExecutor,
    })
  }

  private async discoverCapabilities(target: ResolvedSshTarget, transport: RemoteSshTmuxTransport): Promise<RemoteCapabilities> {
    const profileName = target.profile ?? target.name
    const capabilities = await this.capabilityCache.probeViaTransport({
      execRemote: async (command) => {
        const result = await transport.execRaw(command)
        return { stdout: result.stdout, stderr: result.stderr }
      },
    }, profileName)
    this.logger.info("Remote capabilities", { profile: profileName, caps: capabilities })
    return capabilities
  }

  private createRawExecutor(
    transport: RemoteSshTmuxTransport,
  ): (target: ResolvedSshTarget, command: string, options?: ExecSshTmuxOptions) => Promise<SystemSshCommandResult> {
    if (this.rawCommandExecutor !== undefined) return this.rawCommandExecutor
    return async (_target, command) => transport.execRaw(command)
  }

  private assertSecretEnvAllowed(env: Record<string, string> | undefined): void {
    if (env === undefined || Object.keys(env).length === 0) return
    const secretCheck = checkSecretEnvPolicy(env, this.secretEnvPolicy)
    if (!secretCheck.allowed) {
      throw new SecretEnvDeniedError(secretCheck.deniedKeys)
    }
  }

  private assertPublicKeyOnlyAuth(target: ResolvedSshTarget): void {
    if (target.auth.type === "agent" || target.auth.type === "key-file") return
    throw new RemoteCommandDeniedError("ssh-tmux", "Password authentication is not allowed")
  }

  private coreSessionToTerminalSession(coreSession: TmuxCoreSession, context?: SshTmuxSessionContext): TerminalSession {
    const info = coreSession.sessionInfo
    return {
      sessionId: info.sessionId,
      providerName: info.providerName,
      providerSessionId: info.providerSessionId,
      command: info.command,
      args: info.args,
      cwd: info.cwd,
      label: info.label,
      status: info.status,
      exitCode: info.exitCode ?? null,
      createdAt: info.createdAt,
      lastActivityAt: info.lastActivityAt,
      ttlMs: info.ttlMs,
      capabilities: this.capabilities,
      metadata: context === undefined ? undefined : createSshSessionMetadata(context.target, info, coreSession.cols, coreSession.rows),
    }
  }

  private findTrackedSession(sessionIdOrName: string): TmuxCoreSession | undefined {
    const allSessions = this.core.listSessions()
    const byProviderSessionId = allSessions.find((session) => session.sessionInfo.providerSessionId === sessionIdOrName)
    if (byProviderSessionId !== undefined) return byProviderSessionId
    return allSessions.find((session) => session.tmuxId === sessionIdOrName)
  }

  private contextForCoreSession(coreSession: TmuxCoreSession): SshTmuxSessionContext | undefined {
    return this.sessionContexts.get(coreSession.sessionInfo.providerSessionId)
  }

  private resolveContextKey(sessionId: string): string | undefined {
    if (this.sessionContexts.has(sessionId)) return sessionId
    const session = this.core.listSessions().find((candidate) => candidate.tmuxId === sessionId || candidate.sessionInfo.sessionId === sessionId)
    return session?.sessionInfo.providerSessionId
  }

  private uniqueTrackedTargets(): Array<{ key: string; context: SshTmuxSessionContext; transport: RemoteSshTmuxTransport }> {
    const result = new Map<string, SshTmuxSessionContext>()
    for (const context of this.sessionContexts.values()) {
      if (!result.has(context.targetKey)) result.set(context.targetKey, context)
    }
    return Array.from(result.entries()).map(([key, context]) => ({ key, context, transport: context.transport }))
  }

  private async listTmuxSessionsForTarget(transport: RemoteSshTmuxTransport): Promise<SshTmuxListEntry[]> {
    const format = ["#{session_name}", "#{session_created}", "#{window_width}", "#{window_height}"].join(LIST_SEPARATOR)
    const result = await transport.execTmux(["list-sessions", "-F", format])
    if (result.exitCode !== 0) {
      const output = `${result.stderr}\n${result.stdout}`.trim()
      if (isRemoteSessionMissing(output)) return []
      throw new TerminalUseError({
        code: "INTERNAL_ERROR",
        message: "Remote tmux list-sessions failed",
        provider: this.name,
        retryable: false,
        details: { exitCode: result.exitCode, stderr: result.stderr, stdout: result.stdout },
      })
    }
    return parseTmuxListSessionsOutput(result.stdout)
  }

  private createExternalListSession(target: ResolvedSshTarget, entry: SshTmuxListEntry): TerminalSession {
    const key = targetKey(target)
    return {
      sessionId: `external:ssh-tmux:${key}:${entry.name}`,
      providerName: this.name,
      providerSessionId: entry.name,
      command: "ssh-tmux-external",
      args: [key, entry.name],
      cwd: target.defaultCwd ?? "/",
      label: `${key}:${entry.name}`,
      status: "running",
      exitCode: null,
      createdAt: entry.createdAt,
      lastActivityAt: new Date().toISOString(),
      ttlMs: DEFAULT_TTL_MS,
      capabilities: this.capabilities,
    }
  }
}

function parseTmuxListEntry(line: string): SshTmuxListEntry {
  const [name = "", createdRaw = "", colsRaw = "80", rowsRaw = "24"] = line.split(LIST_SEPARATOR)
  const createdSeconds = Number(createdRaw)
  const cols = Number(colsRaw)
  const rows = Number(rowsRaw)
  return {
    name,
    createdAt: Number.isFinite(createdSeconds) ? new Date(createdSeconds * 1000).toISOString() : new Date().toISOString(),
    cols: Number.isFinite(cols) ? cols : 80,
    rows: Number.isFinite(rows) ? rows : 24,
  }
}

export function parseAttachTarget(value: string): { profile: string; tmuxId: string } | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined

  if (trimmed.startsWith("ssh-tmux://")) {
    const rest = trimmed.slice("ssh-tmux://".length)
    const slashIndex = rest.indexOf("/")
    if (slashIndex <= 0 || slashIndex === rest.length - 1) return undefined
    return { profile: rest.slice(0, slashIndex), tmuxId: rest.slice(slashIndex + 1) }
  }

  const colonIndex = trimmed.indexOf(":")
  if (colonIndex <= 0 || colonIndex === trimmed.length - 1) return undefined
  return { profile: trimmed.slice(0, colonIndex), tmuxId: trimmed.slice(colonIndex + 1) }
}

export function mergeRemoteEnv(profileEnv: Record<string, string> | undefined, inputEnv: Record<string, string> | undefined): Record<string, string> | undefined {
  if (profileEnv === undefined && inputEnv === undefined) return undefined
  return { ...(profileEnv ?? {}), ...(inputEnv ?? {}) }
}

export function buildRemoteShellCommand(capabilities: RemoteCapabilities, command: string, args: string[]): string {
  const commandLine = [command, ...args].map(shellQuote).join(" ")
  if (isWindowsRemote(capabilities.os)) {
    return `${quoteWindowsShell(capabilities.shell)} /c ${commandLine}`
  }
  return `exec ${shellQuote(capabilities.shell)} -l -ic ${shellQuote(commandLine)}`
}

export function isWindowsRemote(os: string): boolean {
  return /^(Windows|Windows_NT)/iu.test(os) || /(?:MINGW|MSYS|CYGWIN)/iu.test(os)
}

export function quoteWindowsShell(shell: string): string {
  return /\s/u.test(shell) ? `"${shell}"` : shell
}

function targetKey(target: ResolvedSshTarget): string {
  return target.profile ?? target.name
}

export function ensureRemoteTmuxUsable(provider: ProviderName, target: ResolvedSshTarget, capabilities: RemoteCapabilities): void {
  const profileName = target.profile ?? target.name
  if (capabilities.tmuxPath === null) {
    throw new TerminalUseError({
      code: "REMOTE_TMUX_NOT_AVAILABLE",
      message: `tmux is not installed on remote host ${profileName}`,
      provider,
      retryable: false,
      hint: "Install tmux on the remote host or use ssh-pty",
      details: { profile: profileName, capabilities },
    })
  }
  if (capabilities.tmuxVersion === null || !isSupportedTmuxVersion(capabilities.tmuxVersion)) {
    throw new TerminalUseError({
      code: "REMOTE_TMUX_NOT_AVAILABLE",
      message: `Remote tmux version ${capabilities.tmuxVersion ?? "unknown"} on ${profileName} is not supported; require parseable tmux >= 3.2`,
      provider,
      retryable: false,
      hint: "Upgrade tmux on the remote host to 3.2 or newer and ensure tmux -V returns a parseable version",
      details: { profile: profileName, required: "3.2", actual: capabilities.tmuxVersion, capabilities },
    })
  }
}

export function isSupportedTmuxVersion(version: string): boolean {
  const parsed = /^tmux\s+(\d+)\.(\d+)/u.exec(version)
  if (parsed === null) return false
  const major = Number(parsed[1])
  const minor = Number(parsed[2])
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return false
  return major > 3 || (major === 3 && minor >= 2)
}

export function isRemoteSessionMissing(output: string): boolean {
  return /can't find session|no server running|no such session|session not found/i.test(output)
}

function createSshSessionMetadata(
  target: ResolvedSshTarget,
  info: TmuxCoreSession["sessionInfo"],
  cols: number,
  rows: number,
): TerminalSession["metadata"] {
  return {
    target: {
      kind: "ssh",
      profile: target.profile,
      host: target.host,
      port: target.port,
      username: target.username,
      hostFingerprint: target.pinnedHostFingerprint,
    },
    ssh: {
      authType: target.auth.type,
      knownHostPolicy: "strict",
      connectedAt: info.createdAt,
      lastDataAt: info.lastActivityAt,
    },
    remote: {
      cwd: info.cwd,
      command: info.command,
      args: info.args,
      pty: {
        term: "xterm-256color",
        cols,
        rows,
      },
    },
  }
}

function stringifyUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 远程 CWD canonical preflight（ssh-tmux）：
 * 在远端执行 cd + pwd -P 获取真实路径，防止 symlink 绕过 string-based CWD 检查。
 */
async function preflightCanonicalRemoteCwdForTmux(
  rawExecutor: (target: ResolvedSshTarget, command: string, options?: ExecSshTmuxOptions) => Promise<SystemSshCommandResult>,
  target: ResolvedSshTarget,
  cwd: string,
  policy: RemoteCwdPolicy,
  overrideKnownHosts?: string,
): Promise<string> {
  const safeCwd = shellQuote(cwd)
  const command = `cd ${safeCwd} && pwd -P`

  const result = await rawExecutor(target, command, { timeoutMs: SSH_TMUX_EXEC_TIMEOUT_MS, overrideKnownHosts })

  if (result.exitCode !== 0) {
    throw new RemoteCwdDeniedError(cwd, `Canonical preflight failed (exit ${result.exitCode}): ${result.stderr}`)
  }

  const canonicalPath = result.stdout.trim()
  if (!canonicalPath.startsWith("/")) {
    throw new RemoteCwdDeniedError(cwd, `Canonical preflight returned invalid path: "${canonicalPath}"`)
  }

  return validateCanonicalRemoteCwd(policy, canonicalPath)
}
