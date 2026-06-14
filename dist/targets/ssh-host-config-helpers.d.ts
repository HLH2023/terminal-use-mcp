/**
 * SSH host config 辅助工具
 *
 * 从 ssh-host-config.ts 分离出的纯工具函数，
 * 避免循环依赖：ssh-auth.ts 和其他模块需要 expandTildePath 但不依赖完整加载器。
 */
/** 将配置中的 `~` 展开为 os.homedir()，不依赖 `$HOME` 环境变量。 */
export declare function expandTildePath(value: string): string;
/** 预检模块旧命名兼容：语义等同 expandTildePath。 */
export declare function expandUserPath(value: string): string;
