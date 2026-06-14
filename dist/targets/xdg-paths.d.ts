/**
 * XDG Base Directory 路径发现
 *
 * 遵循 XDG Base Directory Specification 0.8.2：
 * - $XDG_CONFIG_HOME → 默认 ~/.config
 * - $XDG_DATA_HOME   → 默认 ~/.local/share
 * - macOS fallback    → ~/Library/Application Support
 *
 * 本工具所有配置文件存放于 XDG_CONFIG_HOME 下的 terminal-use-mcp/ 子目录，
 * 数据文件（artifact、session）存放于 XDG_DATA_HOME 下。
 *
 * 目录创建时强制 0700（仅 owner 可读写执行），防止其他用户窥探 SSH profile。
 */
/**
 * 获取 XDG 配置目录。
 *
 * 优先级：$XDG_CONFIG_HOME > macOS ~/Library/Application Support > ~/.config
 *
 * 环境变量 TERMINAL_USE_CONFIG_DIR 可覆盖一切（用于测试和显式指定）。
 */
export declare function getConfigDir(env?: NodeJS.ProcessEnv): string;
/**
 * 获取 XDG 数据目录（artifact、session 数据）。
 *
 * 优先级：$XDG_DATA_HOME > macOS ~/Library/Application Support/terminal-use-mcp/data
 * > ~/.local/share/terminal-use-mcp
 */
export declare function getDataDir(env?: NodeJS.ProcessEnv): string;
/**
 * 获取 SSH profiles overlay 目录。
 *
 * 每个远端 host 一个 JSON 文件，只存放增量策略（CWD policy、allowTmux 等）。
 * SSH 连接参数从 OpenSSH ~/.ssh/config 复用，不重复配置。
 */
export declare function getProfilesDir(env?: NodeJS.ProcessEnv): string;
/**
 * 获取全局配置文件路径。
 *
 * 终端环境变量仍可用于覆盖：TERMINAL_USE_HOSTS_CONFIG 指向兼容旧格式文件，
 * TERMINAL_USE_CONFIG_FILE 指向新格式 config.json。
 */
export declare function getConfigFilePath(env?: NodeJS.ProcessEnv): string;
/**
 * 确保 XDG 配置目录存在且权限正确（0700）。
 *
 * 目录不存在时自动创建；已存在时检查权限是否安全。
 * 不抛异常——目录创建失败仅警告，让上层自然报错。
 */
export declare function ensureConfigDir(env?: NodeJS.ProcessEnv): string;
