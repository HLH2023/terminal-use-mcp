/**
 * MCP tool 层通用辅助。
 *
 * 约束说明：SessionManager 当前只暴露 session 生命周期 API，provider map 是私有字段。
 * 为了不修改既有 SessionManager，本文件提供 ProviderExecutor：由后续 mcp-server.ts
 * 显式传入同一批 provider 实例，tool 层只通过 ManagedSession.queue 串行执行 provider 操作。
 */
import type { SessionManager, ManagedSession } from "../session-manager.js";
import type { FindResult, MouseClickInput, MouseScrollInput, ScrollDirection, TerminalProvider, WaitOptions, WaitStableOptions } from "../providers/provider.js";
import type { SshHostProfile, TerminalTarget } from "../targets/target-types.js";
import type { TerminalSnapshot, TerminalSnapshotMode } from "../terminal/terminal-snapshot.js";
import { type ParsedKeyExpr } from "../terminal/keymap.js";
import type { TranscriptEvent } from "../terminal/transcript.js";
import { type ErrorEnvelope } from "../terminal/errors.js";
export type TextToolContent = {
    type: "text";
    text: string;
};
export type ToolSuccessResult<T extends object> = {
    content: TextToolContent[];
    structuredContent: T;
};
export type ToolErrorResult = {
    content: TextToolContent[];
    structuredContent: ErrorEnvelope;
    isError: true;
};
/**
 * LLM 可能从 provider 名称推导前缀并拼接到 sessionId 前，
 * 因此不对外暴露 providerSessionId，防止 LLM 学习到前缀映射模式。
 * 只保留 sessionId（MCP 层面唯一标识）和 provider（纯信息字段）。
 */
export type PublicSessionInfo = {
    sessionId: string;
    provider: string;
    command: string;
    args: string[];
    cwd: string;
    label?: string;
    status: ManagedSession["status"];
    exitCode?: number | null;
    title?: string;
    cols?: number;
    rows?: number;
    capabilities: ManagedSession["capabilities"];
    createdAt: string;
    lastActivityAt: string;
    ttlMs: number;
    metadata?: ManagedSession["metadata"];
};
/** 统一构造 MCP text content，供所有 tool 注册文件复用。 */
export declare function textContent(text: string): TextToolContent;
/** 将内部 ManagedSession 转成可 JSON 序列化的公开 session 信息。 */
export declare function sessionToPublicInfo(session: ManagedSession): PublicSessionInfo;
/** 将成功结构化数据同时写入 structuredContent 和人类可读 content。 */
export declare function okToolResult<T extends object>(summary: string, structuredContent: T): ToolSuccessResult<T>;
/**
 * 统一错误转换：TerminalUseError 保留稳定 code；未知错误归一为 INTERNAL_ERROR。
 * content 只放摘要，机器可读错误以 structuredContent 为事实源。
 */
export declare function errorToToolResult(err: unknown): ToolErrorResult;
export type ProviderExecutorProviders = ReadonlyMap<string, TerminalProvider>;
export type TmuxToolTargetInput = {
    target?: TerminalTarget;
    profile?: string;
};
export type TmuxToolTargetSummary = {
    kind: "local";
} | {
    kind: "ssh";
    profile: string;
};
export type TmuxSessionInfo = {
    name: string;
    created: string;
    cols: number;
    rows: number;
    isManaged: boolean;
    windows: number;
};
export type TmuxKillPreviewResult = {
    name: string;
    target: TmuxToolTargetSummary;
    exists: boolean;
    isManaged: boolean;
    managedSessionIds: string[];
    windows: number | null;
    created: string | null;
};
export type TmuxKillExecutionResult = {
    name: string;
    target: TmuxToolTargetSummary;
    isManaged: boolean;
    cleanedSessionIds: string[];
    warning: string;
};
/**
 * ProviderExecutor 是 MCP tools 与 provider 的窄接口。
 *
 * - 不读取 SessionManager 私有字段。
 * - 所有实际 provider IO 都进入 session.queue。
 * - 使用 providerSessionId 调用 provider，避免 MCP sessionId 与 provider 内部 id 混淆。
 */
export declare class ProviderExecutor {
    private readonly sm;
    private readonly providers;
    private readonly hostsConfig?;
    constructor(sm: SessionManager, providers: ProviderExecutorProviders, hostsConfig?: ReadonlyMap<string, SshHostProfile> | undefined);
    executeTmuxList(input?: TmuxToolTargetInput): Promise<TmuxSessionInfo[]>;
    /** 预览 tmux_kill 目标 session 信息，不执行 kill。用于二次确认流程。 */
    executeTmuxKillPreview(name: string, input?: TmuxToolTargetInput): Promise<TmuxKillPreviewResult>;
    executeTmuxKill(name: string, input?: TmuxToolTargetInput): Promise<TmuxKillExecutionResult>;
    executeSnapshot(sessionId: string, mode?: TerminalSnapshotMode): Promise<TerminalSnapshot>;
    executeWaitForText(sessionId: string, text: string, options: WaitOptions): Promise<TerminalSnapshot>;
    executeWaitStable(sessionId: string, options: WaitStableOptions): Promise<TerminalSnapshot>;
    executeFind(sessionId: string, pattern: string, regex: boolean | undefined, includeScrollback: boolean | undefined): Promise<FindResult[]>;
    executeScroll(sessionId: string, direction: ScrollDirection, lines: number): Promise<void>;
    executeMouseClick(sessionId: string, input: MouseClickInput): Promise<void>;
    executeMouseScroll(sessionId: string, input: MouseScrollInput, lines: number): Promise<void>;
    executeType(sessionId: string, text: string): Promise<void>;
    executePress(sessionId: string, keyExpr: string, parsed: ParsedKeyExpr): Promise<void>;
    executePaste(sessionId: string, text: string, mode: "bracketed" | "line-by-line" | "raw" | undefined): Promise<void>;
    /** 终端尺寸变更：检查 provider 能力后通过 queue 串行执行 resize。 */
    executeResize(sessionId: string, cols: number, rows: number): Promise<void>;
    /** 读取 session transcript 事件（增量拉取，seq 递增）。 */
    getEvents(sessionId: string, limit?: number, sinceSeq?: number): {
        events: TranscriptEvent[];
        totalEvents: number;
        hasMore: boolean;
    };
    /**
     * 信号发送语义：
     * - SIGINT 等效 ctrl-c（通过 provider.press），保留 session
     * - SIGTERM/SIGKILL 调用 provider.kill 释放资源，session 从 map 移除
     */
    executeSendSignal(sessionId: string, signal: "SIGINT" | "SIGTERM" | "SIGKILL"): Promise<void>;
    private getProvider;
    private resolveTmuxToolTarget;
    private loadHostProfiles;
    private summarizeTmuxTarget;
    private assertProviderAvailable;
    private listLocalTmuxSessions;
    private listRemoteTmuxSessions;
    private killLocalTmuxSession;
    private killRemoteTmuxSession;
    private getLiveInputSession;
    private assertCapability;
    private recordSnapshot;
}
