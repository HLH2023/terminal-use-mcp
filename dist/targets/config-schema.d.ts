/**
 * 配置 Zod Schema + 环境变量展开
 *
 * 新格式 config.json 和 profiles/*.json 的类型安全校验。
 * 所有配置值支持 ${ENV_VAR} 占位符，加载时自动展开。
 *
 * 安全原则：
 * - 禁止 password / privateKey / token / privateKeyContent 明文
 * - passphrase 只能引用环境变量名（passphraseEnv），不存值
 * - key-file 只存路径，不存私钥内容
 *
 * 配置分层：
 * 1. config.json — 全局默认值 + 本地 provider 配置
 * 2. profiles/*.json — SSH profile 增量 overlay（只写 CWD policy、tmux 开关等）
 * 3. ~/.ssh/config — SSH 连接参数（Host/Port/User/IdentityFile/ProxyJump）
 * 4. 环境变量 — 终极覆盖
 */
import { z } from "zod";
/**
 * 展开 ${ENV_VAR} 占位符。
 *
 * 递归展开字符串值中的环境变量引用：
 * - "${HOME}/dev" → "/home/user/dev"
 * - "${TERMINAL_USE_WORKSPACE_ROOT}" → 环境变量值
 * - 未设置的环境变量 → 保留原样（不替换），并输出 warn 日志
 *
 * 仅展开字符串值，对象和数组递归处理。
 */
export declare function expandEnvVars<T>(value: T, env?: NodeJS.ProcessEnv): T;
/** SSH 认证引用：agent 或 key-file，禁止 password */
export declare const SshAuthRefSchema: z.ZodEffects<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"agent">;
    /** 显式指定 ssh-agent socket 路径（可选，默认自动发现） */
    socket: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "agent";
    socket?: string | undefined;
}, {
    type: "agent";
    socket?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"key-file">;
    /** 密钥文件路径（只存路径，不存内容） */
    path: z.ZodString;
    /** passphrase 所在环境变量名（不存值） */
    passphraseEnv: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "key-file";
    path: string;
    passphraseEnv?: string | undefined;
}, {
    type: "key-file";
    path: string;
    passphraseEnv?: string | undefined;
}>]>, {
    type: "agent";
    socket?: string | undefined;
} | {
    type: "key-file";
    path: string;
    passphraseEnv?: string | undefined;
}, {
    type: "agent";
    socket?: string | undefined;
} | {
    type: "key-file";
    path: string;
    passphraseEnv?: string | undefined;
}>;
export type SshAuthRefInput = z.input<typeof SshAuthRefSchema>;
/**
 * SSH profile 增量 overlay —— 只写 terminal-use-mcp 自有扩展。
 *
 * 核心设计：SSH 连接参数（Host/Port/User/Auth）从 OpenSSH ~/.ssh/config 复用，
 * 不在此重复配置。当 overlay 有 sshConfigHost 字段时，从 SSH config 解析；
 * 否则必须在此文件中写完整连接参数（向后兼容旧 hosts.json 格式）。
 */
export declare const SshProfileOverlaySchema: z.ZodEffects<z.ZodObject<{
    /** 指向 ~/.ssh/config 中的 Host 别名 —— SSH 连接参数从该处解析 */
    sshConfigHost: z.ZodOptional<z.ZodString>;
    host: z.ZodOptional<z.ZodString>;
    port: z.ZodOptional<z.ZodNumber>;
    username: z.ZodOptional<z.ZodString>;
    auth: z.ZodOptional<z.ZodEffects<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"agent">;
        /** 显式指定 ssh-agent socket 路径（可选，默认自动发现） */
        socket: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "agent";
        socket?: string | undefined;
    }, {
        type: "agent";
        socket?: string | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"key-file">;
        /** 密钥文件路径（只存路径，不存内容） */
        path: z.ZodString;
        /** passphrase 所在环境变量名（不存值） */
        passphraseEnv: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "key-file";
        path: string;
        passphraseEnv?: string | undefined;
    }, {
        type: "key-file";
        path: string;
        passphraseEnv?: string | undefined;
    }>]>, {
        type: "agent";
        socket?: string | undefined;
    } | {
        type: "key-file";
        path: string;
        passphraseEnv?: string | undefined;
    }, {
        type: "agent";
        socket?: string | undefined;
    } | {
        type: "key-file";
        path: string;
        passphraseEnv?: string | undefined;
    }>>;
    knownHosts: z.ZodOptional<z.ZodString>;
    pinnedHostFingerprint: z.ZodOptional<z.ZodString>;
    proxyJump: z.ZodOptional<z.ZodString>;
    defaultCwd: z.ZodOptional<z.ZodString>;
    /** 远程允许的工作目录范围（必须非空） */
    remoteAllowedCwd: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    /** 远程禁止的工作目录范围 */
    remoteDeniedCwd: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    /** 是否允许 ssh-tmux provider */
    allowTmux: z.ZodOptional<z.ZodBoolean>;
    /** 远程环境变量 */
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    /** SSH 连接超时（毫秒） */
    connectTimeoutMs: z.ZodOptional<z.ZodNumber>;
    /** SSH keepalive 间隔（毫秒） */
    keepaliveIntervalMs: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    sshConfigHost?: string | undefined;
    host?: string | undefined;
    port?: number | undefined;
    username?: string | undefined;
    auth?: {
        type: "agent";
        socket?: string | undefined;
    } | {
        type: "key-file";
        path: string;
        passphraseEnv?: string | undefined;
    } | undefined;
    knownHosts?: string | undefined;
    pinnedHostFingerprint?: string | undefined;
    proxyJump?: string | undefined;
    defaultCwd?: string | undefined;
    remoteAllowedCwd?: string[] | undefined;
    remoteDeniedCwd?: string[] | undefined;
    allowTmux?: boolean | undefined;
    env?: Record<string, string> | undefined;
    connectTimeoutMs?: number | undefined;
    keepaliveIntervalMs?: number | undefined;
}, {
    sshConfigHost?: string | undefined;
    host?: string | undefined;
    port?: number | undefined;
    username?: string | undefined;
    auth?: {
        type: "agent";
        socket?: string | undefined;
    } | {
        type: "key-file";
        path: string;
        passphraseEnv?: string | undefined;
    } | undefined;
    knownHosts?: string | undefined;
    pinnedHostFingerprint?: string | undefined;
    proxyJump?: string | undefined;
    defaultCwd?: string | undefined;
    remoteAllowedCwd?: string[] | undefined;
    remoteDeniedCwd?: string[] | undefined;
    allowTmux?: boolean | undefined;
    env?: Record<string, string> | undefined;
    connectTimeoutMs?: number | undefined;
    keepaliveIntervalMs?: number | undefined;
}>, {
    sshConfigHost?: string | undefined;
    host?: string | undefined;
    port?: number | undefined;
    username?: string | undefined;
    auth?: {
        type: "agent";
        socket?: string | undefined;
    } | {
        type: "key-file";
        path: string;
        passphraseEnv?: string | undefined;
    } | undefined;
    knownHosts?: string | undefined;
    pinnedHostFingerprint?: string | undefined;
    proxyJump?: string | undefined;
    defaultCwd?: string | undefined;
    remoteAllowedCwd?: string[] | undefined;
    remoteDeniedCwd?: string[] | undefined;
    allowTmux?: boolean | undefined;
    env?: Record<string, string> | undefined;
    connectTimeoutMs?: number | undefined;
    keepaliveIntervalMs?: number | undefined;
}, {
    sshConfigHost?: string | undefined;
    host?: string | undefined;
    port?: number | undefined;
    username?: string | undefined;
    auth?: {
        type: "agent";
        socket?: string | undefined;
    } | {
        type: "key-file";
        path: string;
        passphraseEnv?: string | undefined;
    } | undefined;
    knownHosts?: string | undefined;
    pinnedHostFingerprint?: string | undefined;
    proxyJump?: string | undefined;
    defaultCwd?: string | undefined;
    remoteAllowedCwd?: string[] | undefined;
    remoteDeniedCwd?: string[] | undefined;
    allowTmux?: boolean | undefined;
    env?: Record<string, string> | undefined;
    connectTimeoutMs?: number | undefined;
    keepaliveIntervalMs?: number | undefined;
}>;
export type SshProfileOverlayInput = z.input<typeof SshProfileOverlaySchema>;
/**
 * 完整 SSH host profile —— 兼容旧 hosts.json 格式。
 * 新格式 profiles/*.json 不需要写这么多字段。
 */
export declare const SshHostProfileSchema: z.ZodEffects<z.ZodObject<{
    name: z.ZodString;
    /** 指向 ~/.ssh/config 中的 Host 别名（可选，新字段） */
    sshConfigHost: z.ZodOptional<z.ZodString>;
    host: z.ZodString;
    port: z.ZodNumber;
    username: z.ZodString;
    auth: z.ZodEffects<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"agent">;
        /** 显式指定 ssh-agent socket 路径（可选，默认自动发现） */
        socket: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "agent";
        socket?: string | undefined;
    }, {
        type: "agent";
        socket?: string | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"key-file">;
        /** 密钥文件路径（只存路径，不存内容） */
        path: z.ZodString;
        /** passphrase 所在环境变量名（不存值） */
        passphraseEnv: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "key-file";
        path: string;
        passphraseEnv?: string | undefined;
    }, {
        type: "key-file";
        path: string;
        passphraseEnv?: string | undefined;
    }>]>, {
        type: "agent";
        socket?: string | undefined;
    } | {
        type: "key-file";
        path: string;
        passphraseEnv?: string | undefined;
    }, {
        type: "agent";
        socket?: string | undefined;
    } | {
        type: "key-file";
        path: string;
        passphraseEnv?: string | undefined;
    }>;
    knownHosts: z.ZodOptional<z.ZodString>;
    pinnedHostFingerprint: z.ZodOptional<z.ZodString>;
    proxyJump: z.ZodOptional<z.ZodString>;
    defaultCwd: z.ZodOptional<z.ZodString>;
    /** 远程允许的工作目录范围（必须非空） */
    remoteAllowedCwd: z.ZodArray<z.ZodString, "many">;
    /** 远程禁止的工作目录范围 */
    remoteDeniedCwd: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    allowTmux: z.ZodOptional<z.ZodBoolean>;
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    connectTimeoutMs: z.ZodOptional<z.ZodNumber>;
    keepaliveIntervalMs: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    host: string;
    port: number;
    username: string;
    auth: {
        type: "agent";
        socket?: string | undefined;
    } | {
        type: "key-file";
        path: string;
        passphraseEnv?: string | undefined;
    };
    remoteAllowedCwd: string[];
    name: string;
    sshConfigHost?: string | undefined;
    knownHosts?: string | undefined;
    pinnedHostFingerprint?: string | undefined;
    proxyJump?: string | undefined;
    defaultCwd?: string | undefined;
    remoteDeniedCwd?: string[] | undefined;
    allowTmux?: boolean | undefined;
    env?: Record<string, string> | undefined;
    connectTimeoutMs?: number | undefined;
    keepaliveIntervalMs?: number | undefined;
}, {
    host: string;
    port: number;
    username: string;
    auth: {
        type: "agent";
        socket?: string | undefined;
    } | {
        type: "key-file";
        path: string;
        passphraseEnv?: string | undefined;
    };
    remoteAllowedCwd: string[];
    name: string;
    sshConfigHost?: string | undefined;
    knownHosts?: string | undefined;
    pinnedHostFingerprint?: string | undefined;
    proxyJump?: string | undefined;
    defaultCwd?: string | undefined;
    remoteDeniedCwd?: string[] | undefined;
    allowTmux?: boolean | undefined;
    env?: Record<string, string> | undefined;
    connectTimeoutMs?: number | undefined;
    keepaliveIntervalMs?: number | undefined;
}>, {
    host: string;
    port: number;
    username: string;
    auth: {
        type: "agent";
        socket?: string | undefined;
    } | {
        type: "key-file";
        path: string;
        passphraseEnv?: string | undefined;
    };
    remoteAllowedCwd: string[];
    name: string;
    sshConfigHost?: string | undefined;
    knownHosts?: string | undefined;
    pinnedHostFingerprint?: string | undefined;
    proxyJump?: string | undefined;
    defaultCwd?: string | undefined;
    remoteDeniedCwd?: string[] | undefined;
    allowTmux?: boolean | undefined;
    env?: Record<string, string> | undefined;
    connectTimeoutMs?: number | undefined;
    keepaliveIntervalMs?: number | undefined;
}, {
    host: string;
    port: number;
    username: string;
    auth: {
        type: "agent";
        socket?: string | undefined;
    } | {
        type: "key-file";
        path: string;
        passphraseEnv?: string | undefined;
    };
    remoteAllowedCwd: string[];
    name: string;
    sshConfigHost?: string | undefined;
    knownHosts?: string | undefined;
    pinnedHostFingerprint?: string | undefined;
    proxyJump?: string | undefined;
    defaultCwd?: string | undefined;
    remoteDeniedCwd?: string[] | undefined;
    allowTmux?: boolean | undefined;
    env?: Record<string, string> | undefined;
    connectTimeoutMs?: number | undefined;
    keepaliveIntervalMs?: number | undefined;
}>;
export type SshHostProfileInput = z.input<typeof SshHostProfileSchema>;
/** 旧格式 hosts.json 顶层结构（继续支持向后兼容） */
export declare const SshHostsConfigSchema: z.ZodObject<{
    hosts: z.ZodRecord<z.ZodString, z.ZodEffects<z.ZodObject<{
        name: z.ZodString;
        /** 指向 ~/.ssh/config 中的 Host 别名（可选，新字段） */
        sshConfigHost: z.ZodOptional<z.ZodString>;
        host: z.ZodString;
        port: z.ZodNumber;
        username: z.ZodString;
        auth: z.ZodEffects<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"agent">;
            /** 显式指定 ssh-agent socket 路径（可选，默认自动发现） */
            socket: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "agent";
            socket?: string | undefined;
        }, {
            type: "agent";
            socket?: string | undefined;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"key-file">;
            /** 密钥文件路径（只存路径，不存内容） */
            path: z.ZodString;
            /** passphrase 所在环境变量名（不存值） */
            passphraseEnv: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "key-file";
            path: string;
            passphraseEnv?: string | undefined;
        }, {
            type: "key-file";
            path: string;
            passphraseEnv?: string | undefined;
        }>]>, {
            type: "agent";
            socket?: string | undefined;
        } | {
            type: "key-file";
            path: string;
            passphraseEnv?: string | undefined;
        }, {
            type: "agent";
            socket?: string | undefined;
        } | {
            type: "key-file";
            path: string;
            passphraseEnv?: string | undefined;
        }>;
        knownHosts: z.ZodOptional<z.ZodString>;
        pinnedHostFingerprint: z.ZodOptional<z.ZodString>;
        proxyJump: z.ZodOptional<z.ZodString>;
        defaultCwd: z.ZodOptional<z.ZodString>;
        /** 远程允许的工作目录范围（必须非空） */
        remoteAllowedCwd: z.ZodArray<z.ZodString, "many">;
        /** 远程禁止的工作目录范围 */
        remoteDeniedCwd: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        allowTmux: z.ZodOptional<z.ZodBoolean>;
        env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        connectTimeoutMs: z.ZodOptional<z.ZodNumber>;
        keepaliveIntervalMs: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        host: string;
        port: number;
        username: string;
        auth: {
            type: "agent";
            socket?: string | undefined;
        } | {
            type: "key-file";
            path: string;
            passphraseEnv?: string | undefined;
        };
        remoteAllowedCwd: string[];
        name: string;
        sshConfigHost?: string | undefined;
        knownHosts?: string | undefined;
        pinnedHostFingerprint?: string | undefined;
        proxyJump?: string | undefined;
        defaultCwd?: string | undefined;
        remoteDeniedCwd?: string[] | undefined;
        allowTmux?: boolean | undefined;
        env?: Record<string, string> | undefined;
        connectTimeoutMs?: number | undefined;
        keepaliveIntervalMs?: number | undefined;
    }, {
        host: string;
        port: number;
        username: string;
        auth: {
            type: "agent";
            socket?: string | undefined;
        } | {
            type: "key-file";
            path: string;
            passphraseEnv?: string | undefined;
        };
        remoteAllowedCwd: string[];
        name: string;
        sshConfigHost?: string | undefined;
        knownHosts?: string | undefined;
        pinnedHostFingerprint?: string | undefined;
        proxyJump?: string | undefined;
        defaultCwd?: string | undefined;
        remoteDeniedCwd?: string[] | undefined;
        allowTmux?: boolean | undefined;
        env?: Record<string, string> | undefined;
        connectTimeoutMs?: number | undefined;
        keepaliveIntervalMs?: number | undefined;
    }>, {
        host: string;
        port: number;
        username: string;
        auth: {
            type: "agent";
            socket?: string | undefined;
        } | {
            type: "key-file";
            path: string;
            passphraseEnv?: string | undefined;
        };
        remoteAllowedCwd: string[];
        name: string;
        sshConfigHost?: string | undefined;
        knownHosts?: string | undefined;
        pinnedHostFingerprint?: string | undefined;
        proxyJump?: string | undefined;
        defaultCwd?: string | undefined;
        remoteDeniedCwd?: string[] | undefined;
        allowTmux?: boolean | undefined;
        env?: Record<string, string> | undefined;
        connectTimeoutMs?: number | undefined;
        keepaliveIntervalMs?: number | undefined;
    }, {
        host: string;
        port: number;
        username: string;
        auth: {
            type: "agent";
            socket?: string | undefined;
        } | {
            type: "key-file";
            path: string;
            passphraseEnv?: string | undefined;
        };
        remoteAllowedCwd: string[];
        name: string;
        sshConfigHost?: string | undefined;
        knownHosts?: string | undefined;
        pinnedHostFingerprint?: string | undefined;
        proxyJump?: string | undefined;
        defaultCwd?: string | undefined;
        remoteDeniedCwd?: string[] | undefined;
        allowTmux?: boolean | undefined;
        env?: Record<string, string> | undefined;
        connectTimeoutMs?: number | undefined;
        keepaliveIntervalMs?: number | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    hosts: Record<string, {
        host: string;
        port: number;
        username: string;
        auth: {
            type: "agent";
            socket?: string | undefined;
        } | {
            type: "key-file";
            path: string;
            passphraseEnv?: string | undefined;
        };
        remoteAllowedCwd: string[];
        name: string;
        sshConfigHost?: string | undefined;
        knownHosts?: string | undefined;
        pinnedHostFingerprint?: string | undefined;
        proxyJump?: string | undefined;
        defaultCwd?: string | undefined;
        remoteDeniedCwd?: string[] | undefined;
        allowTmux?: boolean | undefined;
        env?: Record<string, string> | undefined;
        connectTimeoutMs?: number | undefined;
        keepaliveIntervalMs?: number | undefined;
    }>;
}, {
    hosts: Record<string, {
        host: string;
        port: number;
        username: string;
        auth: {
            type: "agent";
            socket?: string | undefined;
        } | {
            type: "key-file";
            path: string;
            passphraseEnv?: string | undefined;
        };
        remoteAllowedCwd: string[];
        name: string;
        sshConfigHost?: string | undefined;
        knownHosts?: string | undefined;
        pinnedHostFingerprint?: string | undefined;
        proxyJump?: string | undefined;
        defaultCwd?: string | undefined;
        remoteDeniedCwd?: string[] | undefined;
        allowTmux?: boolean | undefined;
        env?: Record<string, string> | undefined;
        connectTimeoutMs?: number | undefined;
        keepaliveIntervalMs?: number | undefined;
    }>;
}>;
export type SshHostsConfigInput = z.input<typeof SshHostsConfigSchema>;
/** 本地 provider 配置项——减少对环境变量的依赖 */
export declare const LocalConfigSchema: z.ZodObject<{
    /** 工作区根目录（对应 TERMINAL_USE_WORKSPACE_ROOT） */
    workspaceRoot: z.ZodOptional<z.ZodString>;
    /** 额外允许的 CWD 路径 */
    allowedCwdRoots: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    /** 额外允许的启动命令 */
    allowedCommands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    /** 额外拒绝的启动命令 */
    deniedCommands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    /** 危险命令处理模式 */
    riskyCommandMode: z.ZodOptional<z.ZodEnum<["deny", "ask", "allow"]>>;
    /** Session TTL（毫秒） */
    sessionTtlMs: z.ZodOptional<z.ZodNumber>;
    /** 清理检查间隔（毫秒） */
    cleanupIntervalMs: z.ZodOptional<z.ZodNumber>;
    /** 默认终端列数 */
    defaultCols: z.ZodOptional<z.ZodNumber>;
    /** 默认终端行数 */
    defaultRows: z.ZodOptional<z.ZodNumber>;
    /** artifact 输出目录 */
    artifactDir: z.ZodOptional<z.ZodString>;
    /** 日志级别 */
    logLevel: z.ZodOptional<z.ZodEnum<["debug", "info", "warn", "error"]>>;
    /** 启用的 provider 列表（对应 TERMINAL_USE_PROVIDERS） */
    providers: z.ZodOptional<z.ZodArray<z.ZodEnum<["native-pty", "tmux", "ssh-pty", "ssh-tmux"]>, "many">>;
}, "strip", z.ZodTypeAny, {
    workspaceRoot?: string | undefined;
    allowedCwdRoots?: string[] | undefined;
    allowedCommands?: string[] | undefined;
    deniedCommands?: string[] | undefined;
    riskyCommandMode?: "deny" | "ask" | "allow" | undefined;
    sessionTtlMs?: number | undefined;
    cleanupIntervalMs?: number | undefined;
    defaultCols?: number | undefined;
    defaultRows?: number | undefined;
    artifactDir?: string | undefined;
    logLevel?: "error" | "debug" | "info" | "warn" | undefined;
    providers?: ("native-pty" | "tmux" | "ssh-pty" | "ssh-tmux")[] | undefined;
}, {
    workspaceRoot?: string | undefined;
    allowedCwdRoots?: string[] | undefined;
    allowedCommands?: string[] | undefined;
    deniedCommands?: string[] | undefined;
    riskyCommandMode?: "deny" | "ask" | "allow" | undefined;
    sessionTtlMs?: number | undefined;
    cleanupIntervalMs?: number | undefined;
    defaultCols?: number | undefined;
    defaultRows?: number | undefined;
    artifactDir?: string | undefined;
    logLevel?: "error" | "debug" | "info" | "warn" | undefined;
    providers?: ("native-pty" | "tmux" | "ssh-pty" | "ssh-tmux")[] | undefined;
}>;
export type LocalConfigInput = z.input<typeof LocalConfigSchema>;
/** SSH 全局默认值——所有 profile 共享的默认远程安全策略 */
export declare const SshDefaultsSchema: z.ZodObject<{
    /** 全局远程禁止目录（profile 可覆盖） */
    remoteDeniedCwd: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    /** 全局远程默认是否允许 tmux */
    allowTmux: z.ZodOptional<z.ZodBoolean>;
    /** 全局 SSH 连接超时（毫秒） */
    connectTimeoutMs: z.ZodOptional<z.ZodNumber>;
    /** 全局 keepalive 间隔（毫秒） */
    keepaliveIntervalMs: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    remoteDeniedCwd?: string[] | undefined;
    allowTmux?: boolean | undefined;
    connectTimeoutMs?: number | undefined;
    keepaliveIntervalMs?: number | undefined;
}, {
    remoteDeniedCwd?: string[] | undefined;
    allowTmux?: boolean | undefined;
    connectTimeoutMs?: number | undefined;
    keepaliveIntervalMs?: number | undefined;
}>;
export type SshDefaultsInput = z.input<typeof SshDefaultsSchema>;
/**
 * 新格式 config.json 顶层结构。
 *
 * 文件位置：$XDG_CONFIG_HOME/terminal-use-mcp/config.json
 * 示例：
 * ```json
 * {
 *   "version": 1,
 *   "local": { "workspaceRoot": "${TERMINAL_USE_WORKSPACE_ROOT}" },
 *   "sshDefaults": { "remoteDeniedCwd": ["/", "/root", "/etc"] }
 * }
 * ```
 */
export declare const RootConfigSchema: z.ZodObject<{
    /** 配置版本号——用于未来格式迁移 */
    version: z.ZodOptional<z.ZodNumber>;
    /** 本地 provider 配置 */
    local: z.ZodOptional<z.ZodObject<{
        /** 工作区根目录（对应 TERMINAL_USE_WORKSPACE_ROOT） */
        workspaceRoot: z.ZodOptional<z.ZodString>;
        /** 额外允许的 CWD 路径 */
        allowedCwdRoots: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        /** 额外允许的启动命令 */
        allowedCommands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        /** 额外拒绝的启动命令 */
        deniedCommands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        /** 危险命令处理模式 */
        riskyCommandMode: z.ZodOptional<z.ZodEnum<["deny", "ask", "allow"]>>;
        /** Session TTL（毫秒） */
        sessionTtlMs: z.ZodOptional<z.ZodNumber>;
        /** 清理检查间隔（毫秒） */
        cleanupIntervalMs: z.ZodOptional<z.ZodNumber>;
        /** 默认终端列数 */
        defaultCols: z.ZodOptional<z.ZodNumber>;
        /** 默认终端行数 */
        defaultRows: z.ZodOptional<z.ZodNumber>;
        /** artifact 输出目录 */
        artifactDir: z.ZodOptional<z.ZodString>;
        /** 日志级别 */
        logLevel: z.ZodOptional<z.ZodEnum<["debug", "info", "warn", "error"]>>;
        /** 启用的 provider 列表（对应 TERMINAL_USE_PROVIDERS） */
        providers: z.ZodOptional<z.ZodArray<z.ZodEnum<["native-pty", "tmux", "ssh-pty", "ssh-tmux"]>, "many">>;
    }, "strip", z.ZodTypeAny, {
        workspaceRoot?: string | undefined;
        allowedCwdRoots?: string[] | undefined;
        allowedCommands?: string[] | undefined;
        deniedCommands?: string[] | undefined;
        riskyCommandMode?: "deny" | "ask" | "allow" | undefined;
        sessionTtlMs?: number | undefined;
        cleanupIntervalMs?: number | undefined;
        defaultCols?: number | undefined;
        defaultRows?: number | undefined;
        artifactDir?: string | undefined;
        logLevel?: "error" | "debug" | "info" | "warn" | undefined;
        providers?: ("native-pty" | "tmux" | "ssh-pty" | "ssh-tmux")[] | undefined;
    }, {
        workspaceRoot?: string | undefined;
        allowedCwdRoots?: string[] | undefined;
        allowedCommands?: string[] | undefined;
        deniedCommands?: string[] | undefined;
        riskyCommandMode?: "deny" | "ask" | "allow" | undefined;
        sessionTtlMs?: number | undefined;
        cleanupIntervalMs?: number | undefined;
        defaultCols?: number | undefined;
        defaultRows?: number | undefined;
        artifactDir?: string | undefined;
        logLevel?: "error" | "debug" | "info" | "warn" | undefined;
        providers?: ("native-pty" | "tmux" | "ssh-pty" | "ssh-tmux")[] | undefined;
    }>>;
    /** SSH 全局默认值 */
    sshDefaults: z.ZodOptional<z.ZodObject<{
        /** 全局远程禁止目录（profile 可覆盖） */
        remoteDeniedCwd: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        /** 全局远程默认是否允许 tmux */
        allowTmux: z.ZodOptional<z.ZodBoolean>;
        /** 全局 SSH 连接超时（毫秒） */
        connectTimeoutMs: z.ZodOptional<z.ZodNumber>;
        /** 全局 keepalive 间隔（毫秒） */
        keepaliveIntervalMs: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        remoteDeniedCwd?: string[] | undefined;
        allowTmux?: boolean | undefined;
        connectTimeoutMs?: number | undefined;
        keepaliveIntervalMs?: number | undefined;
    }, {
        remoteDeniedCwd?: string[] | undefined;
        allowTmux?: boolean | undefined;
        connectTimeoutMs?: number | undefined;
        keepaliveIntervalMs?: number | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    local?: {
        workspaceRoot?: string | undefined;
        allowedCwdRoots?: string[] | undefined;
        allowedCommands?: string[] | undefined;
        deniedCommands?: string[] | undefined;
        riskyCommandMode?: "deny" | "ask" | "allow" | undefined;
        sessionTtlMs?: number | undefined;
        cleanupIntervalMs?: number | undefined;
        defaultCols?: number | undefined;
        defaultRows?: number | undefined;
        artifactDir?: string | undefined;
        logLevel?: "error" | "debug" | "info" | "warn" | undefined;
        providers?: ("native-pty" | "tmux" | "ssh-pty" | "ssh-tmux")[] | undefined;
    } | undefined;
    version?: number | undefined;
    sshDefaults?: {
        remoteDeniedCwd?: string[] | undefined;
        allowTmux?: boolean | undefined;
        connectTimeoutMs?: number | undefined;
        keepaliveIntervalMs?: number | undefined;
    } | undefined;
}, {
    local?: {
        workspaceRoot?: string | undefined;
        allowedCwdRoots?: string[] | undefined;
        allowedCommands?: string[] | undefined;
        deniedCommands?: string[] | undefined;
        riskyCommandMode?: "deny" | "ask" | "allow" | undefined;
        sessionTtlMs?: number | undefined;
        cleanupIntervalMs?: number | undefined;
        defaultCols?: number | undefined;
        defaultRows?: number | undefined;
        artifactDir?: string | undefined;
        logLevel?: "error" | "debug" | "info" | "warn" | undefined;
        providers?: ("native-pty" | "tmux" | "ssh-pty" | "ssh-tmux")[] | undefined;
    } | undefined;
    version?: number | undefined;
    sshDefaults?: {
        remoteDeniedCwd?: string[] | undefined;
        allowTmux?: boolean | undefined;
        connectTimeoutMs?: number | undefined;
        keepaliveIntervalMs?: number | undefined;
    } | undefined;
}>;
export type RootConfigInput = z.input<typeof RootConfigSchema>;
/**
 * 单个 profile overlay 文件格式。
 *
 * 文件位置：$XDG_CONFIG_HOME/terminal-use-mcp/profiles/<name>.json
 * 示例：
 * ```json
 * {
 *   "sshConfigHost": "devbox",
 *   "defaultCwd": "/home/hlh/dev",
 *   "remoteAllowedCwd": ["/home/hlh/dev", "/tmp"],
 *   "allowTmux": true
 * }
 * ```
 */
export declare const ProfileOverlayFileSchema: z.ZodEffects<z.ZodObject<{
    /** 指向 ~/.ssh/config 中的 Host 别名 —— SSH 连接参数从该处解析 */
    sshConfigHost: z.ZodOptional<z.ZodString>;
    host: z.ZodOptional<z.ZodString>;
    port: z.ZodOptional<z.ZodNumber>;
    username: z.ZodOptional<z.ZodString>;
    auth: z.ZodOptional<z.ZodEffects<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"agent">;
        /** 显式指定 ssh-agent socket 路径（可选，默认自动发现） */
        socket: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "agent";
        socket?: string | undefined;
    }, {
        type: "agent";
        socket?: string | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"key-file">;
        /** 密钥文件路径（只存路径，不存内容） */
        path: z.ZodString;
        /** passphrase 所在环境变量名（不存值） */
        passphraseEnv: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "key-file";
        path: string;
        passphraseEnv?: string | undefined;
    }, {
        type: "key-file";
        path: string;
        passphraseEnv?: string | undefined;
    }>]>, {
        type: "agent";
        socket?: string | undefined;
    } | {
        type: "key-file";
        path: string;
        passphraseEnv?: string | undefined;
    }, {
        type: "agent";
        socket?: string | undefined;
    } | {
        type: "key-file";
        path: string;
        passphraseEnv?: string | undefined;
    }>>;
    knownHosts: z.ZodOptional<z.ZodString>;
    pinnedHostFingerprint: z.ZodOptional<z.ZodString>;
    proxyJump: z.ZodOptional<z.ZodString>;
    defaultCwd: z.ZodOptional<z.ZodString>;
    /** 远程允许的工作目录范围（必须非空） */
    remoteAllowedCwd: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    /** 远程禁止的工作目录范围 */
    remoteDeniedCwd: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    /** 是否允许 ssh-tmux provider */
    allowTmux: z.ZodOptional<z.ZodBoolean>;
    /** 远程环境变量 */
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    /** SSH 连接超时（毫秒） */
    connectTimeoutMs: z.ZodOptional<z.ZodNumber>;
    /** SSH keepalive 间隔（毫秒） */
    keepaliveIntervalMs: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    sshConfigHost?: string | undefined;
    host?: string | undefined;
    port?: number | undefined;
    username?: string | undefined;
    auth?: {
        type: "agent";
        socket?: string | undefined;
    } | {
        type: "key-file";
        path: string;
        passphraseEnv?: string | undefined;
    } | undefined;
    knownHosts?: string | undefined;
    pinnedHostFingerprint?: string | undefined;
    proxyJump?: string | undefined;
    defaultCwd?: string | undefined;
    remoteAllowedCwd?: string[] | undefined;
    remoteDeniedCwd?: string[] | undefined;
    allowTmux?: boolean | undefined;
    env?: Record<string, string> | undefined;
    connectTimeoutMs?: number | undefined;
    keepaliveIntervalMs?: number | undefined;
}, {
    sshConfigHost?: string | undefined;
    host?: string | undefined;
    port?: number | undefined;
    username?: string | undefined;
    auth?: {
        type: "agent";
        socket?: string | undefined;
    } | {
        type: "key-file";
        path: string;
        passphraseEnv?: string | undefined;
    } | undefined;
    knownHosts?: string | undefined;
    pinnedHostFingerprint?: string | undefined;
    proxyJump?: string | undefined;
    defaultCwd?: string | undefined;
    remoteAllowedCwd?: string[] | undefined;
    remoteDeniedCwd?: string[] | undefined;
    allowTmux?: boolean | undefined;
    env?: Record<string, string> | undefined;
    connectTimeoutMs?: number | undefined;
    keepaliveIntervalMs?: number | undefined;
}>, {
    sshConfigHost?: string | undefined;
    host?: string | undefined;
    port?: number | undefined;
    username?: string | undefined;
    auth?: {
        type: "agent";
        socket?: string | undefined;
    } | {
        type: "key-file";
        path: string;
        passphraseEnv?: string | undefined;
    } | undefined;
    knownHosts?: string | undefined;
    pinnedHostFingerprint?: string | undefined;
    proxyJump?: string | undefined;
    defaultCwd?: string | undefined;
    remoteAllowedCwd?: string[] | undefined;
    remoteDeniedCwd?: string[] | undefined;
    allowTmux?: boolean | undefined;
    env?: Record<string, string> | undefined;
    connectTimeoutMs?: number | undefined;
    keepaliveIntervalMs?: number | undefined;
}, {
    sshConfigHost?: string | undefined;
    host?: string | undefined;
    port?: number | undefined;
    username?: string | undefined;
    auth?: {
        type: "agent";
        socket?: string | undefined;
    } | {
        type: "key-file";
        path: string;
        passphraseEnv?: string | undefined;
    } | undefined;
    knownHosts?: string | undefined;
    pinnedHostFingerprint?: string | undefined;
    proxyJump?: string | undefined;
    defaultCwd?: string | undefined;
    remoteAllowedCwd?: string[] | undefined;
    remoteDeniedCwd?: string[] | undefined;
    allowTmux?: boolean | undefined;
    env?: Record<string, string> | undefined;
    connectTimeoutMs?: number | undefined;
    keepaliveIntervalMs?: number | undefined;
}>;
export type ProfileOverlayFileInput = z.input<typeof ProfileOverlayFileSchema>;
/** 展开路径中的 ~ 为 os.homedir() */
export declare function expandTildeInPath(value: string): string;
/** 递归展开对象中所有路径值的 ~ */
export declare function expandTildeInObject<T>(value: T): T;
