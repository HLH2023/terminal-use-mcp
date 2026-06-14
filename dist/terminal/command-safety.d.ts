/**
 * 命令和 CWD 安全策略
 *
 * 限制 terminal.start 可启动的命令和工作目录。
 * 详见 DEV-PLAN §8.2 Command Policy 边界说明。
 *
 * H2 修复：isCommandSafeArgv 接受完整 argv [command, ...args]，
 * 递归剥除 wrapper 后对 base command 做 denylist 检查。
 * 旧 isCommandSafe(command, ...) 保留为便捷版，内部调 isCommandSafeArgv。
 *
 * CWD 安全：isCwdAllowed 使用 fs.realpath 做 canonical path 比较。
 * 纯字符串比较无法防御 symlink 攻击（workspace 内 symlink 指向 /etc
 * 时字符串仍是子路径，实际解析到了特权目录）。行业实践（MCP filesystem
 * server / paperclip / gstack / gemini-cli）均用 realpath 后再判定。
 * Fail-closed 原则：realpath 失败 = 拒绝，绝不能 fallback 到字符串比较。
 */
import type { StartInput } from "../providers/provider.js";
export type CommandSafetyResult = {
    ok: true;
} | {
    ok: false;
    reason: string;
    code: "UNSAFE_COMMAND" | "CONFIRMATION_REQUIRED";
};
export type CwdSafetyResult = {
    ok: true;
} | {
    ok: false;
    reason: string;
    code: "INVALID_CWD";
};
export declare const SHELL_METACHAR_REGEX: RegExp;
/**
 * 从 argv 数组中提取 base command 名称。
 * 递归剥除 wrapper（env/nice/nohup/timeout/strace 等）后返回实际的 base command。
 *
 * Fail-closed 原则：wrapper 选项序列遇到不认识的 pattern，立即停止剥除，
 * 把当前位置 token 当作 base command 检查。
 *
 * @param argv - 完整的参数数组 [command, ...args]
 * @returns base command 的最后路径组件名
 */
export declare function extractBaseCommandArgv(argv: string[]): string;
/**
 * 标准化路径用于比较：去除尾随 '/'（保留根路径 '/'）
 * 解决 isSubdirectory 对 trailing slash 不鲁棒的问题。
 */
declare function normalizePathForComparison(p: string): string;
/**
 * 检查 childPath 是否在 parentPath 下（含相等）。
 * 两个参数均先做 normalizePathForComparison 标准化，
 * 解决 trailing slash 不鲁棒的问题（如 parentPath="/repo/"）。
 *
 * 特殊处理根路径 '/'：当 normalizedParent 为 '/' 时，
 * 直接检查 childPath 是否以 '/' 开头（即绝对路径即可认定在 '/' 下）。
 */
declare function isSubdirectory(childPath: string, parentPath: string): boolean;
/**
 * 基于canonical path（realpath结果）的子目录判断。
 * 使用 path.relative 代替 startsWith，避免 "/a" vs "/abc" 类误判。
 * 调用方必须保证两个参数都是 realpath 返回的 canonical 绝对路径。
 */
declare function isSubdirectoryCanonical(childCanonical: string, parentCanonical: string): boolean;
/**
 * 复杂命令自动 shell 包装。
 *
 * node-pty 的 spawn(command, args) 不会像人类 shell 一样拆分字符串；如果把
 * `whiptail --title ...` 整段放进 command，底层会尝试寻找一个名为整段字符串的可执行文件，
 * 最终报 `execvp(3) failed`。因此在"用户没有显式传 args"且 command 本身包含空格或
 * shell 元字符时，内部改写为 shell -c <原始命令>（Unix: /bin/sh, Windows: cmd.exe），让 shell 负责解析复杂命令。
 *
 * 安全边界：该函数只做内部可用性包装，不做安全放行。调用方必须先用包装前的原始
 * command 做 denylist 检查，确保原始 base command（例如 `rm;echo ok` 中的 `rm`）已被拦截。
 */
export declare function maybeWrapWithShell(input: StartInput): StartInput;
/**
 * 检查命令是否安全（接受完整 argv）。
 *
 * 将 [command, ...args] 拼成完整 argv，递归剥除 wrapper 后
 * 用实际 base command 命中 allow/deny list。
 *
 * 当 args 为空且 command 含 shell 元字符时，退化为按 shell 元字符
 * 拆分命令字符串的行为（兼容旧调用模式）。
 *
 * Fail-closed 原则：wrapper 选项解析遇到不认识的 pattern，
 * 立即停止剥除，把当前位置 token 当作 base command 检查。
 * 宁可误报（拒绝合法 wrapper 用法），不可漏报（让危险命令通过）。
 *
 * @param command - 可执行文件名（等同于 argv[0]）
 * @param args - 参数数组（等同于 argv[1..N]）
 * @param allowedCommands - 额外允许的命令列表
 * @param deniedCommands - 额外拒绝的命令列表
 * @param riskyMode - 危险命令处理模式
 */
export declare function isCommandSafeArgv(command: string, args: string[], allowedCommands?: string[], deniedCommands?: string[], riskyMode?: "deny" | "ask" | "allow"): CommandSafetyResult;
/**
 * 检查命令是否安全（只接收 command 字符串）。
 *
 * 保留原签名的便捷版，内部调 isCommandSafeArgv(command, [], ...)。
 * 注意：检查前会递归剥除常见 wrapper（如 env/nice/nohup/busybox/timeout），
 * 再用实际 base command 命中 allow/deny list，避免包装命令绕过启动策略。
 */
export declare function isCommandSafe(command: string, allowedCommands?: string[], deniedCommands?: string[], riskyMode?: "deny" | "ask" | "allow"): CommandSafetyResult;
/**
 * 检查 CWD 是否在允许范围内。
 *
 * 使用 fs.realpath 将路径 canonicalize 后再做比较，防止 symlink 绕过
 * （workspace 内 symlink 指向 /etc 时字符串仍是子路径，realpath 会
 * 解析到真实目标 /etc，从而被拒绝）。
 *
 * Fail-closed：realpath 失败（ENOENT / 权限不足 / symlink 循环）直接拒绝，
 * 绝不 fallback 到字符串比较。
 */
export declare function isCwdAllowed(cwd: string, workspaceRoot?: string, allowedCwdRoots?: string[]): Promise<CwdSafetyResult>;
export { isSubdirectory, isSubdirectoryCanonical, normalizePathForComparison };
export type RegexValidationResult = {
    ok: true;
    warning?: string;
} | {
    ok: false;
    reason: string;
    code: "INVALID_REGEX" | "UNSAFE_REGEX_PATTERN";
};
/**
 * 对用户提供的正则表达式做安全验证，防止 ReDoS。
 *
 * 策略分层：
 * 1. RE2 可用时：用 RE2 编译正则，成功即安全（RE2 保证线性时间执行）。
 *    不需要任何启发式检查——RE2 在数学上不会发生灾难性回溯。
 * 2. RE2 不可用时：用嵌套量词启发式检测拒绝已知危险模式。
 *    这不是完美防护（可能误报也可能漏报），但覆盖了经典 ReDoS 攻击。
 *
 * 注意：500 字符长度限制已移除——RE2 可安全执行任意长度的正则，
 * 启发式 fallback 下嵌套量词检测比固定长度限制更精准。
 */
export declare function validateRegexSafety(pattern: string): RegexValidationResult;
/**
 * 创建安全的正则表达式对象。
 *
 * RE2 可用时返回 RE2 实例（API 兼容 RegExp，保证线性时间），
 * RE2 不可用时 fallback 到原生 RegExp。
 * RE2 对象支持 .test()、.exec()、.matchAll() 等方法，可直接替换原生 RegExp。
 *
 * @param pattern - 正则表达式模式字符串
 * @param flags - 正则标志（如 "g"、"gi" 等）
 */
export declare function createSafeRegex(pattern: string, flags?: string): RegExp;
