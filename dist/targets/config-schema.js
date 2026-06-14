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
import { homedir } from "node:os";
import { join } from "node:path";
// ── 环境变量展开 ──────────────────────────────────────────────
/** ${VAR_NAME} 占位符正则：匹配 ${...} 形式的环境变量引用 */
const ENV_VAR_PLACEHOLDER = /\$\{([^}]+)\}/g;
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
export function expandEnvVars(value, env = process.env) {
    if (typeof value === "string") {
        return expandStringEnvVars(value, env);
    }
    if (Array.isArray(value)) {
        return value.map((item) => expandEnvVars(item, env));
    }
    if (value !== null && typeof value === "object") {
        const result = {};
        for (const [key, val] of Object.entries(value)) {
            result[key] = expandEnvVars(val, env);
        }
        return result;
    }
    return value;
}
function expandStringEnvVars(value, env) {
    return value.replace(ENV_VAR_PLACEHOLDER, (match, varName) => {
        const envValue = env[varName];
        if (envValue !== undefined && envValue.length > 0) {
            return envValue;
        }
        // 特殊变量：HOME 总是可用
        if (varName === "HOME") {
            return homedir();
        }
        // 未设置的环境变量 → 保留原样占位符
        return match;
    });
}
// ── 禁止秘密键 ──────────────────────────────────────────────
/** 配置文件中禁止出现的键名——任何包含这些键的对象都是非法的 */
const FORBIDDEN_SECRET_KEYS = new Set([
    "password", "privateKey", "privateKeyContent", "token", "apiKey", "secret",
]);
/**
 * Zod refine：确保对象不包含禁止的秘密键。
 * 用于检测配置文件中的意外明文凭据。
 */
function noForbiddenSecretKeys(data, label) {
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
        return true;
    }
    const record = data;
    for (const key of Object.keys(record)) {
        if (FORBIDDEN_SECRET_KEYS.has(key)) {
            throw new Error(`${label} contains forbidden credential field "${key}"`);
        }
        // 递归检查嵌套对象（但不递归进入数组内部的对象——太深无意义）
        const val = record[key];
        if (val !== null && typeof val === "object" && !Array.isArray(val)) {
            noForbiddenSecretKeys(val, `${label}.${key}`);
        }
    }
    return true;
}
// ── SshAuthRef Schema ────────────────────────────────────────
/** SSH 认证引用：agent 或 key-file，禁止 password */
export const SshAuthRefSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("agent"),
        /** 显式指定 ssh-agent socket 路径（可选，默认自动发现） */
        socket: z.string().min(1).optional(),
    }),
    z.object({
        type: z.literal("key-file"),
        /** 密钥文件路径（只存路径，不存内容） */
        path: z.string().min(1),
        /** passphrase 所在环境变量名（不存值） */
        passphraseEnv: z.string().min(1).optional(),
    }),
]).refine((auth) => {
    noForbiddenSecretKeys(auth, "SSH auth");
    return true;
}, { message: "SSH auth contains forbidden credential fields" });
// ── SSH Profile Overlay Schema ───────────────────────────────
/**
 * SSH profile 增量 overlay —— 只写 terminal-use-mcp 自有扩展。
 *
 * 核心设计：SSH 连接参数（Host/Port/User/Auth）从 OpenSSH ~/.ssh/config 复用，
 * 不在此重复配置。当 overlay 有 sshConfigHost 字段时，从 SSH config 解析；
 * 否则必须在此文件中写完整连接参数（向后兼容旧 hosts.json 格式）。
 */
export const SshProfileOverlaySchema = z.object({
    /** 指向 ~/.ssh/config 中的 Host 别名 —— SSH 连接参数从该处解析 */
    sshConfigHost: z.string().min(1).optional(),
    // ── 以下字段仅在无 sshConfigHost 时必填（完整自描述模式） ──
    host: z.string().min(1).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    username: z.string().min(1).optional(),
    auth: SshAuthRefSchema.optional(),
    knownHosts: z.string().min(1).optional(),
    pinnedHostFingerprint: z.string().min(1).optional(),
    proxyJump: z.string().min(1).optional(),
    // ── terminal-use-mcp 自有扩展（overlay 模式下主要写这些） ──
    defaultCwd: z.string().min(1).optional(),
    /** 远程允许的工作目录范围（必须非空） */
    remoteAllowedCwd: z.array(z.string().min(1)).optional(),
    /** 远程禁止的工作目录范围 */
    remoteDeniedCwd: z.array(z.string().min(1)).optional(),
    /** 是否允许 ssh-tmux provider */
    allowTmux: z.boolean().optional(),
    /** 远程环境变量 */
    env: z.record(z.string(), z.string()).optional(),
    /** SSH 连接超时（毫秒） */
    connectTimeoutMs: z.number().int().positive().optional(),
    /** SSH keepalive 间隔（毫秒） */
    keepaliveIntervalMs: z.number().int().positive().optional(),
}).refine((data) => {
    noForbiddenSecretKeys(data, "SSH profile overlay");
    return true;
}, { message: "SSH profile overlay contains forbidden credential fields" });
// ── SshHostProfile Schema（完整 profile，向后兼容旧格式） ────
/**
 * 完整 SSH host profile —— 兼容旧 hosts.json 格式。
 * 新格式 profiles/*.json 不需要写这么多字段。
 */
export const SshHostProfileSchema = z.object({
    name: z.string().min(1),
    /** 指向 ~/.ssh/config 中的 Host 别名（可选，新字段） */
    sshConfigHost: z.string().min(1).optional(),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    username: z.string().min(1),
    auth: SshAuthRefSchema,
    knownHosts: z.string().min(1).optional(),
    pinnedHostFingerprint: z.string().min(1).optional(),
    proxyJump: z.string().min(1).optional(),
    defaultCwd: z.string().min(1).optional(),
    /** 远程允许的工作目录范围（必须非空） */
    remoteAllowedCwd: z.array(z.string().min(1)).min(1),
    /** 远程禁止的工作目录范围 */
    remoteDeniedCwd: z.array(z.string().min(1)).optional(),
    allowTmux: z.boolean().optional(),
    env: z.record(z.string(), z.string()).optional(),
    connectTimeoutMs: z.number().int().positive().optional(),
    keepaliveIntervalMs: z.number().int().positive().optional(),
}).refine((data) => {
    noForbiddenSecretKeys(data, "SSH host profile");
    return true;
}, { message: "SSH host profile contains forbidden credential fields" });
// ── 旧格式 hosts.json Schema ────────────────────────────────
/** 旧格式 hosts.json 顶层结构（继续支持向后兼容） */
export const SshHostsConfigSchema = z.object({
    hosts: z.record(z.string(), SshHostProfileSchema),
});
// ── 本地 Provider 配置 Schema ───────────────────────────────
/** 本地 provider 配置项——减少对环境变量的依赖 */
export const LocalConfigSchema = z.object({
    /** 工作区根目录（对应 TERMINAL_USE_WORKSPACE_ROOT） */
    workspaceRoot: z.string().min(1).optional(),
    /** 额外允许的 CWD 路径 */
    allowedCwdRoots: z.array(z.string().min(1)).optional(),
    /** 额外允许的启动命令 */
    allowedCommands: z.array(z.string().min(1)).optional(),
    /** 额外拒绝的启动命令 */
    deniedCommands: z.array(z.string().min(1)).optional(),
    /** 危险命令处理模式 */
    riskyCommandMode: z.enum(["deny", "ask", "allow"]).optional(),
    /** Session TTL（毫秒） */
    sessionTtlMs: z.number().int().positive().optional(),
    /** 清理检查间隔（毫秒） */
    cleanupIntervalMs: z.number().int().positive().optional(),
    /** 默认终端列数 */
    defaultCols: z.number().int().positive().optional(),
    /** 默认终端行数 */
    defaultRows: z.number().int().positive().optional(),
    /** artifact 输出目录 */
    artifactDir: z.string().min(1).optional(),
    /** 日志级别 */
    logLevel: z.enum(["debug", "info", "warn", "error"]).optional(),
    /** 启用的 provider 列表（对应 TERMINAL_USE_PROVIDERS） */
    providers: z.array(z.enum(["native-pty", "tmux", "ssh-pty", "ssh-tmux"])).optional(),
});
// ── SSH 全局默认值 Schema ─────────────────────────────────────
/** SSH 全局默认值——所有 profile 共享的默认远程安全策略 */
export const SshDefaultsSchema = z.object({
    /** 全局远程禁止目录（profile 可覆盖） */
    remoteDeniedCwd: z.array(z.string().min(1)).optional(),
    /** 全局远程默认是否允许 tmux */
    allowTmux: z.boolean().optional(),
    /** 全局 SSH 连接超时（毫秒） */
    connectTimeoutMs: z.number().int().positive().optional(),
    /** 全局 keepalive 间隔（毫秒） */
    keepaliveIntervalMs: z.number().int().positive().optional(),
});
// ── 根配置 Schema（新格式 config.json） ───────────────────────
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
export const RootConfigSchema = z.object({
    /** 配置版本号——用于未来格式迁移 */
    version: z.number().int().positive().optional(),
    /** 本地 provider 配置 */
    local: LocalConfigSchema.optional(),
    /** SSH 全局默认值 */
    sshDefaults: SshDefaultsSchema.optional(),
});
// ── Profile Overlay 文件（profiles/*.json）顶层 Schema ──────
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
export const ProfileOverlayFileSchema = SshProfileOverlaySchema;
// ── 辅助：路径展开 ───────────────────────────────────────────
/** 展开路径中的 ~ 为 os.homedir() */
export function expandTildeInPath(value) {
    if (value === "~")
        return homedir();
    if (value.startsWith("~/"))
        return join(homedir(), value.slice(2));
    return value;
}
/** 递归展开对象中所有路径值的 ~ */
export function expandTildeInObject(value) {
    if (typeof value === "string") {
        return expandTildeInPath(value);
    }
    if (Array.isArray(value)) {
        return value.map((item) => expandTildeInObject(item));
    }
    if (value !== null && typeof value === "object") {
        const result = {};
        for (const [key, val] of Object.entries(value)) {
            result[key] = expandTildeInObject(val);
        }
        return result;
    }
    return value;
}
