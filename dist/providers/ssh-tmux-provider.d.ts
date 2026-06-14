import type { ExportOptions, FindResult, MouseClickInput, MouseScrollInput, ProviderCapabilities, ProviderName, ScrollDirection, StartInput, TerminalProvider, TerminalSession, TranscriptExport, WaitOptions, WaitStableOptions } from "./provider.js";
import type { ParsedKeyExpr } from "../terminal/keymap.js";
import type { TerminalSnapshot, TerminalSnapshotMode } from "../terminal/terminal-snapshot.js";
import type { Logger } from "../logger.js";
import type { SshHostProfile } from "../targets/target-types.js";
import type { ResolvedSshTarget } from "../targets/ssh-profile-loader.js";
import type { SystemSshCommandResult } from "./system-ssh-transport.js";
import { type RemoteCapabilityCache } from "../targets/remote-capability-cache.js";
export type ExecSshTmuxOptions = {
    timeoutMs?: number;
    /** 覆盖 profile.knownHosts；用于 ssh-keyscan 验证后生成的临时 known_hosts。 */
    overrideKnownHosts?: string;
};
export type SshTmuxCommandExecutor = (profile: ResolvedSshTarget, args: readonly string[], options?: ExecSshTmuxOptions) => Promise<SystemSshCommandResult>;
export type SshTmuxProviderOptions = {
    hostsConfig?: ReadonlyMap<string, SshHostProfile>;
    hostsConfigPath?: string;
    commandExecutor?: SshTmuxCommandExecutor;
    sshAvailabilityChecker?: () => Promise<boolean>;
    capabilityCache?: RemoteCapabilityCache;
    /** ssh-keyscan fingerprint 验证器；生产默认使用 verifyPinnedFingerprintOrThrow，测试可注入 mock。 */
    keyscanVerifier?: (profile: ResolvedSshTarget) => Promise<{
        tempKnownHostsPath: string;
        matchedFingerprint: string;
    }>;
};
export type SshTmuxListEntry = {
    name: string;
    createdAt: string;
    cols: number;
    rows: number;
};
/** 安全的 SSH 远程 tmux 命令执行入口；底层统一走系统 ssh + execFile 参数数组。 */
export declare function execSshTmux(profile: ResolvedSshTarget, args: readonly string[], options?: ExecSshTmuxOptions): Promise<SystemSshCommandResult>;
/** 生成远程 tmux session 名；rtumcp_ 前缀用于和本地 tumcp_ 区分。 */
export declare function createSshTmuxSessionName(): string;
/** 把用户可见 label 收敛成 tmux target 安全字符集，避免冒号/空白/控制符污染 target 语义。 */
export declare function sanitizeTmuxSessionName(input: string): string;
/** 解析 tmux list-sessions 的制表符分隔输出，供 list() 和单元测试复用。 */
export declare function parseTmuxListSessionsOutput(stdout: string): SshTmuxListEntry[];
export declare class SshTmuxProvider implements TerminalProvider {
    readonly name: ProviderName;
    readonly capabilities: ProviderCapabilities;
    private readonly sessions;
    private readonly logger;
    private readonly injectedHostsConfig?;
    private readonly hostsConfigPath?;
    private readonly commandExecutor;
    private readonly sshAvailabilityChecker;
    private readonly capabilityCache;
    private readonly keyscanVerifier;
    private sshAvailable;
    constructor(logger: Logger, options?: SshTmuxProviderOptions);
    isAvailable(): Promise<boolean>;
    start(input: StartInput): Promise<TerminalSession>;
    attach(sessionIdOrName: string): Promise<TerminalSession>;
    snapshot(sessionId: string, mode?: TerminalSnapshotMode): Promise<TerminalSnapshot>;
    waitForText(sessionId: string, text: string, options: WaitOptions): Promise<TerminalSnapshot>;
    waitStable(sessionId: string, options: WaitStableOptions): Promise<TerminalSnapshot>;
    type(sessionId: string, text: string): Promise<void>;
    press(sessionId: string, keyExpr: string, parsed: ParsedKeyExpr): Promise<void>;
    paste(sessionId: string, text: string, mode?: "bracketed" | "line-by-line" | "raw"): Promise<void>;
    find(sessionId: string, pattern: string, regex?: boolean, includeScrollback?: boolean): Promise<FindResult[]>;
    scroll(sessionId: string, direction: ScrollDirection, lines: number): Promise<void>;
    mouseClick(sessionId: string, input: MouseClickInput): Promise<void>;
    mouseScroll(sessionId: string, input: MouseScrollInput): Promise<void>;
    resize(sessionId: string, cols: number, rows: number): Promise<void>;
    rename(sessionId: string, label: string): Promise<void>;
    kill(sessionId: string): Promise<void>;
    hasSession(sessionId: string): boolean;
    listActiveSessionIds(): string[];
    exportTranscript(sessionId: string, options: ExportOptions): Promise<TranscriptExport>;
    list(): Promise<TerminalSession[]>;
    private resolveSshTmuxTarget;
    private resolveAttachTarget;
    private loadHostProfiles;
    private ensureSystemSshAvailable;
    private discoverCapabilities;
    private execRemoteTmux;
    private toRemoteTmuxError;
    private assertSessionExists;
    private getLiveSession;
    private findTrackedSession;
    private touch;
    private readTitle;
    private readPaneHistoryLineCount;
    private readDimensionsForTarget;
    private readTitleForTarget;
    private listTmuxSessionsForTarget;
    private uniqueTrackedTargets;
    private createExternalListSession;
    private delay;
    private errorMessage;
}
