/**
 * 配置管理
 *
 * 配置分层（优先级从高到低）：
 * 1. 环境变量 — 终极覆盖
 * 2. XDG config.json — 持久化配置文件
 * 3. 代码内默认值 — 兜底
 *
 * 新格式 config.json 位于 $XDG_CONFIG_HOME/terminal-use-mcp/config.json，
 * 通过 Zod RootConfigSchema 校验，支持 ${ENV_VAR} 占位符展开。
 */
import type { ProviderName } from "./providers/provider.js";
export type TerminalUseConfig = {
    workspaceRoot: string;
    allowedCwdRoots: string[];
    allowedCommands: string[];
    deniedCommands: string[];
    riskyCommandMode: "deny" | "ask" | "allow";
    sessionTtlMs: number;
    cleanupIntervalMs: number;
    defaultProvider: ProviderName;
    defaultCols: number;
    defaultRows: number;
    artifactDir: string;
    largePasteLimit: number;
    hardPasteLimit: number;
    logLevel: "debug" | "info" | "warn" | "error";
    hostsConfigPath?: string;
    allowInlineSshTargets: boolean;
    sshDefaults: SshDefaultsConfig;
    /** 启用的 provider 白名单。未设置=全部启用 */
    enabledProviders: ProviderName[];
    /** 是否保存原始（未脱敏）transcript 文件。默认 false — 只保存脱敏版防止泄露秘密。 */
    storeRawTranscript: boolean;
};
export type SshDefaultsConfig = {
    remoteDeniedCwd: string[];
    allowTmux: boolean;
    connectTimeoutMs: number;
    keepaliveIntervalMs: number;
};
export declare function loadConfig(overrides?: Partial<TerminalUseConfig>): TerminalUseConfig;
