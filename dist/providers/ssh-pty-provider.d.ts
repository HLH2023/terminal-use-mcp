/**
 * SshPtyProvider
 *
 * 通过 ssh2 建立远程 SSH 连接，并在远端打开带 PTY 的 exec channel。
 * 它与 NativePtyProvider 保持同一观察/输入模型：远端 channel 输出写入
 * XtermAdapter，再复用 snapshot / wait / transcript / paste 安全检查。
 *
 * 安全边界：
 * - 默认只接受 SSH profile；inline target 仍由 resolveSshTarget 的环境变量闸门控制。
 * - host key 必须通过 pinned fingerprint 或 known_hosts 与实际握手 key 严格匹配。
 * - 认证仅支持 ssh-agent 与 key-file；不提供 password / keyboard-interactive 回退。
 * - key-file 只在连接前以 Buffer 读入本地内存，不写入日志、metadata 或 artifact。
 */
import type { ConnectConfig } from "ssh2";
import type { ExportOptions, FindResult, MouseClickInput, MouseScrollInput, ProviderCapabilities, ProviderName, ScrollDirection, StartInput, TerminalProvider, TerminalSession, TranscriptExport, WaitOptions, WaitStableOptions } from "./provider.js";
import type { Logger } from "../logger.js";
import type { ParsedKeyExpr } from "../terminal/keymap.js";
import type { TerminalSnapshot } from "../terminal/terminal-snapshot.js";
import { type ResolvedSshTarget } from "../targets/ssh-profile-loader.js";
import type { SshAuthRef, SshHostProfile, TerminalTarget } from "../targets/target-types.js";
export type SshPtyProviderOptions = {
    /** 单元测试可直接注入 hostsConfig，避免读取用户真实配置。 */
    hostsConfig?: ReadonlyMap<string, SshHostProfile>;
    /** 生产路径默认从 TERMINAL_USE_HOSTS_CONFIG / XDG 位置读取。 */
    hostsConfigPath?: string;
};
export type SshPtyAuthConnectConfig = {
    authType: "agent";
    connectConfig: Pick<ConnectConfig, "agent">;
    redactedSummary: {
        type: "agent";
        socket: string;
    };
} | {
    authType: "key-file";
    connectConfig: Pick<ConnectConfig, "privateKey" | "passphrase">;
    redactedSummary: {
        type: "key-file";
        path: string;
        passphraseConfigured: boolean;
    };
};
/**
 * 远端输出脏标记。
 *
 * 抽成小类是为了让单元测试在不建立 SSH 连接的情况下覆盖
 * markDirty / markClean / lastDataAt 语义。
 */
export declare class SshPtyDirtyTracker {
    private dirty;
    private lastDataAtMs;
    private lastDataAtIso;
    markDirty(now?: Date): void;
    markClean(): void;
    isDirty(): boolean;
    getLastDataAtMs(): number;
    getLastDataAtIso(): string | undefined;
}
export declare class SshPtyProvider implements TerminalProvider {
    readonly name: ProviderName;
    readonly capabilities: ProviderCapabilities;
    private readonly sessions;
    private readonly logger;
    private readonly options;
    constructor(logger: Logger, options?: SshPtyProviderOptions);
    /** ssh2 是 package dependency，安装后即可用；无 native addon 动态失败路径。 */
    isAvailable(): Promise<boolean>;
    start(input: StartInput): Promise<TerminalSession>;
    snapshot(sessionId: string): Promise<TerminalSnapshot>;
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
    rename(): Promise<void>;
    kill(sessionId: string): Promise<void>;
    hasSession(sessionId: string): boolean;
    listActiveSessionIds(): string[];
    exportTranscript(sessionId: string, options: ExportOptions): Promise<TranscriptExport>;
    list(): Promise<TerminalSession[]>;
    private resolveStartTarget;
    private wireClientEvents;
    private wireChannelEvents;
    private handleChannelOutput;
    private getSession;
    private getWritableSession;
    private toTerminalSession;
    private assertPasteSafe;
    private countSnapshotEvents;
}
/** 将 target 解析为 ssh-pty 可启动的远程 profile；local target 必须 fail-closed。 */
export declare function resolveSshPtyTarget(target: TerminalTarget, hostsConfig: ReadonlyMap<string, SshHostProfile>): ResolvedSshTarget;
/**
 * 读取 SSH 认证材料并转成 ssh2 ConnectConfig 字段。
 *
 * 注意：key-file 模式必须读取私钥 Buffer 才能交给 ssh2，但不会输出、缓存或写入 artifact。
 */
export declare function resolveSshPtyAuthConnectConfig(auth: SshAuthRef): Promise<SshPtyAuthConnectConfig>;
/** 构造 ssh2 ConnectConfig；认证方式显式限制为 agent 或 publickey，禁止 password 回退。 */
export declare function buildSshConnectConfig(target: ResolvedSshTarget, auth: SshPtyAuthConnectConfig, hostVerifier: NonNullable<ConnectConfig["hostVerifier"]>): ConnectConfig;
/**
 * 校验 SSH 握手阶段服务器实际提供的 host key。
 * pinned fingerprint 优先；否则使用 known_hosts 中同 host/port 的公开 key 指纹比对。
 */
export declare function verifyPresentedHostKey(profile: ResolvedSshTarget | SshHostProfile, offeredKey: Buffer): Promise<string>;
/** 使用 POSIX shell 单引号转义远端 exec 字符串，避免未转义拼接命令/参数。 */
export declare function shellQuote(value: string): string;
export declare function buildShellExecCommand(command: string, args: string[]): string;
/**
 * ssh2 exec request 只能发送 command string；这里用严格转义构造：
 * exec $SHELL -l -ic 'cd <cwd> && exec <command> <args...>'
 */
export declare function buildRemoteExecCommand(command: string, args: string[], cwd: string): string;
