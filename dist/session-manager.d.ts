/**
 * SessionManager：负责 session 生命周期、同 session 操作串行化、TTL 清理与 artifact 落盘。
 *
 * 该层是 MCP tools 的直接依赖；所有 provider 操作必须经由 ManagedSession.queue 串行化，
 * 避免同一终端同时执行输入、观察和 resize 等互相干扰的操作。
 */
import type { ProviderCapabilities, ProviderName, StartInput, TerminalProvider, TerminalSession } from "./providers/provider.js";
import type { TerminalSnapshot } from "./terminal/terminal-snapshot.js";
import type { TerminalUseConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { TranscriptRecorder } from "./terminal/transcript.js";
/** PromiseQueue — 同一 session 操作串行化 */
export declare class PromiseQueue {
    private queue;
    private running;
    /** 入队一个异步操作，串行执行 */
    enqueue<T>(fn: () => Promise<T>): Promise<T>;
    /** 顺序取出并执行队列中的操作；不同 session 的队列互不阻塞。 */
    private processQueue;
}
/** ManagedSession — SessionManager 内部管理的 session 全状态 */
export type ManagedSession = {
    sessionId: string;
    providerName: ProviderName;
    providerSessionId: string;
    command: string;
    args: string[];
    cwd: string;
    label?: string;
    status: "starting" | "running" | "exited" | "killed" | "error";
    exitCode?: number | null;
    createdAt: Date;
    lastActivityAt: Date;
    ttlMs: number;
    queue: PromiseQueue;
    transcript: TranscriptRecorder;
    lastSnapshot?: TerminalSnapshot;
    capabilities: ProviderCapabilities;
    metadata?: TerminalSession["metadata"];
};
export declare class SessionManager {
    private sessions;
    private providers;
    private config;
    private logger;
    private cleanupTimer;
    constructor(config: TerminalUseConfig, logger: Logger);
    /** 返回已注册 providers 的只读引用，供 mcp-server.ts 构建 ProviderExecutor。 */
    getProviders(): ReadonlyMap<ProviderName, TerminalProvider>;
    /** 注册 provider */
    registerProvider(provider: TerminalProvider): void;
    /** 启动新 session */
    start(input: StartInput & {
        provider?: ProviderName;
    }): Promise<ManagedSession>;
    /** 附加到已有 session (如 tmux session) */
    attach(sessionIdOrName: string, providerName?: ProviderName): Promise<ManagedSession>;
    /**
     * LLM agent 可能在 sessionId 前拼接 provider name 前缀（如 "native_term_xxx"），
     * 或产生其他非标准变形。此方法先精确匹配，失败后依次尝试：
     * 1. 剥离已知 provider 前缀（native_|sshpty_|tumcup_|tmux_）
     * 2. 模糊后缀匹配：在所有活跃 session 中查找后缀一致的 key
     */
    static stripProviderPrefix(id: string): string;
    /** 获取 session (不存在时抛 SessionNotFoundError) */
    getSession(sessionId: string): ManagedSession;
    /** 列出所有 session */
    listSessions(): ManagedSession[];
    /** 删除 session (不 kill 进程，只从 map 移除) */
    removeSession(sessionId: string): void;
    /** Kill session */
    kill(sessionId: string): Promise<void>;
    /** Kill 所有 session */
    killAllSessions(): Promise<void>;
    /** 重命名 session label */
    rename(sessionId: string, label: string): Promise<void>;
    /** 启动 TTL cleanup 定时器 */
    startTtlCleanup(): void;
    /** 停止 TTL cleanup 定时器 */
    stopTtlCleanup(): void;
    /** 更新 session lastActivityAt */
    touchSession(sessionId: string): void;
    /** 清理过期 session */
    private cleanupExpiredSessions;
    /** 选择 provider (按优先级或用户指定) */
    private selectProvider;
    /** TTL 超时处理：记录 SIGTERM/SIGKILL 语义，并用当前 provider.kill 做资源释放兜底。 */
    private cleanupExpiredSession;
    /** 将 provider 返回的公开 session 记录转换为 manager 内部状态。 */
    private createManagedSession;
    /** 命令安全检查：接受 command + args 完整 argv，只覆盖 terminal.start 的启动命令，不声称完整沙箱。 */
    private assertCommandAllowed;
    /** CWD 安全检查限制 session 初始工作目录。使用 realpath canonicalize 防御 symlink 绕过。 */
    private assertCwdAllowed;
    /** 根据默认 provider 和固定优先级构造去重后的选择列表。 */
    private buildProviderPriorityList;
    /** 取已注册 provider；用于已存在 session 的后续操作。 */
    private getRegisteredProvider;
    /** 写入 session 元数据、transcript 和事件摘要；失败只记日志，不影响主流程。 */
    private persistSessionArtifacts;
    /** artifact 错误单独落盘到 session errors.log，仍保持 best-effort。 */
    private persistArtifactError;
    /** artifact 写入不应让 session 生命周期失败。 */
    private runBestEffortArtifactWrite;
    /** 转为 provider.ts 中公开的 TerminalSession，可安全 JSON 序列化。 */
    private toTerminalSession;
    /** provider 时间戳异常时使用当前时间，避免无效 Date 污染 artifact。 */
    private parseDate;
    /** 标准化未知错误，避免日志和 errors.log 写入不可读对象。 */
    private formatError;
    /** Promise 包装的 timeout，供 TTL soft/hard kill 间隔复用。 */
    private delay;
}
