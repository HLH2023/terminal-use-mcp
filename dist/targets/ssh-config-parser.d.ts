/**
 * OpenSSH ~/.ssh/config 解析器
 *
 * 读取系统 OpenSSH config 文件，根据 Host 别名解析出连接参数：
 * HostName, Port, User, IdentityFile, ProxyJump 等。
 *
 * 设计原则：
 * - 只读解析，不修改 ~/.ssh/config
 * - 支持常见指令（HostName/Port/User/IdentityFile/ProxyJump/StrictHostKeyChecking/UserKnownHostsFile）
 * - 不支持 Match/Include 等高级指令——graceful fallback
 * - 解析失败不阻塞——返回 partial 结果 + 警告
 *
 * 与 @yawlabs/ssh-mcp 方案对比：
 * - @yawlabs 用 `ssh -G <host>` 做 runtime 解析，最准确但依赖系统 ssh
 * - 本解析器是纯 JS 实现，不依赖子进程，对常见 config 足够准确
 * - 如果需要 100% 准确，用户可显式在 overlay 中写连接参数（覆盖解析结果）
 */
/** OpenSSH config 解析结果 */
export type SshConfigEntry = {
    /** Host 别名（config 中的 Host 指令值） */
    host: string;
    /** 实际主机名（HostName 指令）—— 未设置时等同 host */
    hostName: string;
    /** SSH 端口（Port 指令）—— 默认 22 */
    port: number;
    /** 登录用户名（User 指令） */
    username?: string;
    /** 密钥文件路径（IdentityFile 指令）—— 可多个 */
    identityFiles: string[];
    /** ProxyJump 跳板（ProxyJump 指令） */
    proxyJump?: string;
    /** known_hosts 文件路径（UserKnownHostsFile 指令） */
    userKnownHostsFile?: string;
    /** 是否严格 host key 校验——解析后只用于判断，本工具始终 strict */
    strictHostKeyChecking?: string;
};
/**
 * 解析 ~/.ssh/config 文件，返回所有 Host 块的解析结果。
 *
 * 返回 Map<hostPattern, SshConfigEntry>，key 是 Host 指令的值（可含通配符）。
 */
export declare function parseSshConfig(configPath?: string): Promise<Map<string, SshConfigEntry>>;
/**
 * 根据 Host 别名查找 SSH config 中匹配的条目。
 *
 * 匹配规则（简化版，不处理通配符优先级）：
 * 1. 精确匹配：Host devbox → 查 "devbox"
 * 2. 通配符匹配：Host *.example.com → 查 "dev.example.com"
 * 3. 多个匹配时，取第一个（OpenSSH 行为是取最后匹配，但 profile 场景一般不会有歧义）
 */
export declare function findSshConfigEntry(hostAlias: string, entries: Map<string, SshConfigEntry>): SshConfigEntry | undefined;
/** 获取默认 SSH config 路径 */
export declare function getDefaultSshConfigPath(): string;
