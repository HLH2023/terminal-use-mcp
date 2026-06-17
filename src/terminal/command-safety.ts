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

import type { StartInput } from "../providers/provider.js"

// fs.realpath 用于将路径 canonicalize（解析所有 symlink），是防御 symlink
// 绕过的关键。失败即拒绝——不允许 fallback 到字符串比较，否则 symlink 安全
// 保证形同虚设。
import { realpath } from "node:fs/promises"
// path.relative 用于 canonical path 子目录判断，比 startsWith 更准确：
// relative("/a", "/a/b") → "b"（子目录），relative("/a", "/a") → ""（相等），
// relative("/a", "/abc") → "../bc"（非子目录，含 ".." 前缀）。
import { basename, isAbsolute, relative, resolve, sep, win32 } from "node:path"

export type CommandSafetyResult =
  | { ok: true }
  | { ok: false; reason: string; code: "UNSAFE_COMMAND" | "CONFIRMATION_REQUIRED" }

/** CWD 安全策略模式 */
export type CwdPolicyMode = "guarded" | "strict"

export type CwdSafetyResult =
  | { ok: true }
  | { ok: false; reason: string; code: "INVALID_CWD" }

const DEFAULT_DENIED_COMMANDS = [
  "sudo", "su", "sh", "ssh", "scp", "sftp", "rm", "dd", "mkfs",
  "shutdown", "reboot", "chmod", "chown", "curl", "wget",
  "nc", "ncat", "telnet",
  "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe",
  "del", "erase", "rmdir", "rd", "format", "diskpart",
  "reg", "reg.exe", "takeown", "icacls", "net", "net.exe",
  "netsh", "netsh.exe", "sc", "sc.exe", "taskkill", "taskkill.exe",
].map((command) => command.toLowerCase())

const DEFAULT_DENIED_CWD_ROOTS = process.platform === "win32"
  ? ["C:\\", "C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)", "C:\\ProgramData"]
  : ["/", "/root", "/home", "/etc", "/usr", "/var", "/sys", "/proc", "/boot"]

// shell 包装触发字符：空白字符（含空格和换行）或 POSIX shell 中会改变解析语义的元字符。
// 注意：该正则只用于判断"是否需要交给 shell 解析"，安全判定仍必须基于包装前的原始命令。
export const SHELL_METACHAR_REGEX = /[\s|;&<>()$`\\'"!]/

// Shell chain 操作符：用于将复合命令拆分为独立子命令，逐个做 denylist 检查。
// 匹配顺序：长操作符优先（|| 在 | 之前，|& 在 | 之前），避免误拆。
// 匹配项：;  &&  ||  |&  |  反引号 `  $( 
const SHELL_CHAIN_REGEX = /;|&&|\|\||\|&|\||`|\$\(/g

// 已知 shell/进程包装命令：这些命令自身不一定危险，但会把真正要执行的
// 子命令放在后续参数里。安全检查需要剥掉外层包装，避免 `env rm`、
// `busybox sh`、`nohup rm` 等形式绕过 denylist。
const KNOWN_WRAPPERS = ["env", "nice", "nohup", "xargs", "busybox", "strace", "ltrace", "timeout", "unshare"]

function isEnvironmentAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)
}

// ============================================================
// Wrapper 选项签名表
// ============================================================

// 已知 wrapper 选项签名：描述每个 wrapper 的哪些选项需要消耗参数。
// 例如 strace 的 `-o` 后面跟文件名，所以 `-o` 模式='consume-next'（消耗下一个 token）。
// 未列出的 wrapper 选项按 fail-closed 处理：遇到以 '-' 开头的未知 token 后立即停止剥除。
type WrapperOptionSpec = {
  /** 选项名（含短选项 -x 和长选项 --xxx） */
  name: string
  /** 'flag' = 不消耗后续 token; 'consume-next' = 消耗下一个 token 作为参数 */
  kind: "flag" | "consume-next"
}

// 各 wrapper 的选项签名。只列出需要 consume-next 的选项和主要 flag 选项；
// 其余以 '-' 或 '--' 开头的 token 如果不在列表中，按 fail-closed 停止剥除。
const WRAPPER_OPTION_SIGNATURES: Record<string, WrapperOptionSpec[]> = {
  timeout: [
    { name: "--foreground", kind: "flag" },
    { name: "--signal", kind: "consume-next" },
    { name: "-s", kind: "consume-next" },
    { name: "-k", kind: "consume-next" },
    { name: "--kill-after", kind: "consume-next" },
    { name: "-v", kind: "flag" },
  ],
  strace: [
    { name: "-o", kind: "consume-next" },
    { name: "-e", kind: "consume-next" },
    { name: "-p", kind: "consume-next" },
    { name: "-D", kind: "flag" },
    { name: "-f", kind: "flag" },
    { name: "-c", kind: "flag" },
    { name: "--output", kind: "consume-next" },
    { name: "--expr", kind: "consume-next" },
    { name: "--attach", kind: "consume-next" },
  ],
  ltrace: [
    { name: "-o", kind: "consume-next" },
    { name: "-e", kind: "consume-next" },
    { name: "-f", kind: "flag" },
    { name: "-c", kind: "flag" },
    { name: "--output", kind: "consume-next" },
    { name: "--expr", kind: "consume-next" },
  ],
  unshare: [
    { name: "--mount", kind: "flag" },
    { name: "--uts", kind: "flag" },
    { name: "--ipc", kind: "flag" },
    { name: "--net", kind: "flag" },
    { name: "--pid", kind: "flag" },
    { name: "--user", kind: "flag" },
    { name: "--cgroup", kind: "flag" },
    { name: "-m", kind: "flag" },
    { name: "-u", kind: "flag" },
    { name: "-i", kind: "flag" },
    { name: "-n", kind: "flag" },
    { name: "-p", kind: "flag" },
    { name: "-U", kind: "flag" },
    { name: "-C", kind: "flag" },
    { name: "--map-root-user", kind: "flag" },
    { name: "--map-current-user", kind: "flag" },
    { name: "--propagation", kind: "consume-next" },
    { name: "--setuid", kind: "consume-next" },
    { name: "--setgid", kind: "consume-next" },
    { name: "--root", kind: "consume-next" },
    { name: "--mount-proc", kind: "consume-next" },
    { name: "-r", kind: "flag" },
  ],
  xargs: [
    { name: "-I", kind: "consume-next" },
    { name: "-L", kind: "consume-next" },
    { name: "-n", kind: "consume-next" },
    { name: "-P", kind: "consume-next" },
    { name: "-t", kind: "flag" },
    { name: "-r", kind: "flag" },
    { name: "--no-run-if-empty", kind: "flag" },
    { name: "--replace", kind: "consume-next" },
    { name: "--max-lines", kind: "consume-next" },
    { name: "--max-args", kind: "consume-next" },
    { name: "--max-procs", kind: "consume-next" },
  ],
  busybox: [
    // busybox 自身没有选项，所有参数都是 applet 名 + applet 参数
  ],
}

// ============================================================
// Wrapper 选项剥除 argv 版
// ============================================================

/**
 * 递归剥除 wrapper 命令的选项和中间参数，返回底层命令的 argv 片段。
 *
 * Fail-closed 原则：当 wrapper 选项序列遇到无法识别的 token
 * （非选项、非已知参数模式），立即停止剥除，把当前位置当 base command。
 */
function stripWrapperArgumentsArgv(wrapper: string, tokens: string[]): string[] {
  // env 特殊处理：跳过以 '-' 开头的选项和 VAR=VALUE 赋值
  if (wrapper === "env") {
    let index = 0
    while (index < tokens.length) {
      const token = tokens[index] ?? ""
      if (token.startsWith("-") || isEnvironmentAssignment(token)) {
        index += 1
      } else {
        break
      }
    }
    return tokens.slice(index)
  }

  // timeout 特殊处理：支持 --foreground / --signal 等长选项，
  // 也支持数字作为 duration 参数
  if (wrapper === "timeout") {
    let index = 0
    // 标记是否已遇到 duration
    let durationConsumed = false
    const specs = WRAPPER_OPTION_SIGNATURES["timeout"] ?? []
    while (index < tokens.length) {
      const token = tokens[index] ?? ""
      // duration（纯数字 + 可选单位）：timeout 的第一个非选项参数
      if (!durationConsumed && /^\d+(?:\.\d+)?[smhd]?$/.test(token)) {
        durationConsumed = true
        index += 1
        continue
      }
      // 尝试匹配已知选项
      const matchedSpec = specs.find((s) => s.name === token)
      if (matchedSpec) {
        if (matchedSpec.kind === "consume-next") {
          index += 2 // 跳过选项名和它的参数
        } else {
          index += 1 // flag 选项只跳过自身
        }
        continue
      }
      // 未知选项（以 '-' 开头但不匹配任何已知选项）：fail-closed
      if (token.startsWith("-")) {
        break
      }
      // 非选项 token：这就是 base command
      break
    }
    return tokens.slice(index)
  }

  // nice 特殊处理：-n 后跟数字，-N 形式，--adjustment
  if (wrapper === "nice") {
    let index = 0
    while (index < tokens.length) {
      const token = tokens[index] ?? ""
      // -n <num>
      if (token === "-n" && index + 1 < tokens.length) {
        index += 2
        continue
      }
      // --adjustment=<num> 或 --adjustment <num>
      if (token.startsWith("--adjustment")) {
        if (token.includes("=")) {
          index += 1 // --adjustment=5
        } else {
          index += 2 // --adjustment 5
        }
        continue
      }
      // -N 形式（如 -19）
      if (/^-\d+$/.test(token)) {
        index += 1
        continue
      }
      // 未知选项：fail-closed
      if (token.startsWith("-")) {
        break
      }
      // 非选项 token：base command
      break
    }
    return tokens.slice(index)
  }

  // nohup：不接收任何选项，直接透传所有参数
  if (wrapper === "nohup") {
    return tokens
  }

  // busybox：没有选项，第一个 token 是 applet 名
  if (wrapper === "busybox") {
    return tokens
  }

  // 通用 wrapper 选项剥除（strace / ltrace / unshare / xargs）
  const specs = WRAPPER_OPTION_SIGNATURES[wrapper]
  if (specs && specs.length > 0) {
    let index = 0
    while (index < tokens.length) {
      const token = tokens[index] ?? ""
      const matchedSpec = specs.find((s) => s.name === token)
      if (matchedSpec) {
        if (matchedSpec.kind === "consume-next") {
          // consume-next：如果后面没有参数了，说明序列不完整，fail-closed
          if (index + 1 >= tokens.length) {
            break
          }
          index += 2
        } else {
          index += 1
        }
        continue
      }
      // 未知选项（以 '-' 开头但不在已知列表中）：fail-closed
      if (token.startsWith("-")) {
        break
      }
      // 非选项 token：base command
      break
    }
    return tokens.slice(index)
  }

  // 其他未知 wrapper：不做选项剥除，直接返回
  return tokens
}

// ============================================================
// extractBaseCommand / extractBaseCommandArgv
// ============================================================

/**
 * 从命令字符串中提取 base command 名称。
 * 递归剥除 wrapper 后取最后一个路径组件。
 *
 * 保留原签名 `extractBaseCommand(command: string)` 向后兼容。
 */
function extractBaseCommand(command: string): string {
  // 将命令字符串按 shell 元字符拆分为 token 数组
  const tokens = command.trim().split(SHELL_METACHAR_REGEX).filter((part) => part.length > 0)
  return extractBaseCommandArgv(tokens)
}

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
export function extractBaseCommandArgv(argv: string[]): string {
  let tokens = [...argv]

  while (tokens.length > 0) {
    const wrapper = tokens[0] ?? ""
    const wrapperBase = basenameCrossPlatform(wrapper).toLowerCase()
    if (!KNOWN_WRAPPERS.includes(wrapperBase)) {
      break
    }
    // 剥除 wrapper 自身
    tokens = tokens.slice(1)
    // 剥除 wrapper 的选项/参数
    tokens = stripWrapperArgumentsArgv(wrapperBase, tokens)
  }

  const base = tokens[0] ?? ""
  return basenameCrossPlatform(base)
}

function basenameCrossPlatform(pathValue: string): string {
  return win32.basename(basename(pathValue))
}

// ============================================================
// 路径比较工具
// ============================================================

/**
 * 标准化路径用于比较：去除尾随 '/'（保留根路径 '/'）
 * 解决 isSubdirectory 对 trailing slash 不鲁棒的问题。
 */
function normalizePathForComparison(p: string): string {
  // 根路径 '/' 保留；其他路径去掉尾部 '/'
  if (p.length > 1 && p.endsWith("/")) {
    return p.slice(0, -1)
  }
  return p
}

/**
 * 检查 childPath 是否在 parentPath 下（含相等）。
 * 两个参数均先做 normalizePathForComparison 标准化，
 * 解决 trailing slash 不鲁棒的问题（如 parentPath="/repo/"）。
 *
 * 特殊处理根路径 '/'：当 normalizedParent 为 '/' 时，
 * 直接检查 childPath 是否以 '/' 开头（即绝对路径即可认定在 '/' 下）。
 */
function isSubdirectory(childPath: string, parentPath: string): boolean {
  const normalizedChild = normalizePathForComparison(childPath)
  const normalizedParent = normalizePathForComparison(parentPath)
  if (normalizedChild === normalizedParent) {
    return true
  }
  // 根路径 '/' 特殊处理：任何绝对路径都在 '/' 下
  if (normalizedParent === "/") {
    return normalizedChild.startsWith("/")
  }
  return normalizedChild.startsWith(`${normalizedParent}/`)
}

/**
 * 基于canonical path（realpath结果）的子目录判断。
 * 使用 path.relative 代替 startsWith，避免 "/a" vs "/abc" 类误判。
 * 调用方必须保证两个参数都是 realpath 返回的 canonical 绝对路径。
 */
function isSubdirectoryCanonical(childCanonical: string, parentCanonical: string): boolean {
  if (childCanonical === parentCanonical) return true
  const rel = relative(parentCanonical, childCanonical)
  // rel 非空、不以 ".." 开头（不在 parent 之外）、不是绝对路径（不同挂载点/盘符）。
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel)
}

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
export function maybeWrapWithShell(input: StartInput): StartInput {
  if (input.args.length > 0) {
    return input
  }

  if (!SHELL_METACHAR_REGEX.test(input.command)) {
    return input
  }

  const shell = process.platform === "win32"
    ? (process.env.ComSpec?.trim() || "cmd.exe")
    : "/bin/sh"
  const shellArgs = process.platform === "win32"
    ? ["/c", input.command]
    : ["-c", input.command]

  return {
    ...input,
    command: shell,
    args: shellArgs,
  }
}

// ============================================================
// isCommandSafeArgv：接受完整 argv 的安全检查
// ============================================================

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
export function isCommandSafeArgv(
  command: string,
  args: string[],
  allowedCommands: string[] = [],
  deniedCommands: string[] = [],
  riskyMode: "deny" | "ask" | "allow" = "deny"
): CommandSafetyResult {
  // 当 args 为空且 command 含 shell 元字符时，走字符串拆分路径
  // （兼容 "sudo rm -rf /" 这种 command 含完整命令行的情况）
  let baseCommand: string
  if (args.length === 0 && SHELL_METACHAR_REGEX.test(command)) {
    baseCommand = extractBaseCommand(command)

    // Shell chain bypass 防御：当 command 含 chain 操作符（; && || | |& ` $() ）时，
    // 只检查第一个子命令不够——后续子命令可能含被拒命令。
    // 拆分 command 为子命令片段，逐个做 denylist 检查。
    if (SHELL_CHAIN_REGEX.test(command)) {
      // 重置 regex lastIndex（因为带 g flag）
      SHELL_CHAIN_REGEX.lastIndex = 0
      const subCommands = command.split(SHELL_CHAIN_REGEX).filter((s) => s.trim().length > 0)
      const deniedSet = buildDeniedSet(deniedCommands)
      const allowedSet = buildAllowedSet(allowedCommands)
      for (const sub of subCommands) {
        const subBase = extractBaseCommand(sub).toLowerCase()
        if (allowedSet.has(subBase)) {
          continue
        }
        if (deniedSet.has(subBase)) {
          if (riskyMode === "ask") {
            return { ok: false, reason: `Command "${subBase}" in shell chain requires user confirmation`, code: "CONFIRMATION_REQUIRED" }
          }
          if (riskyMode === "allow") {
            continue
          }
          return { ok: false, reason: `Command "${subBase}" in shell chain is blocked by safety policy`, code: "UNSAFE_COMMAND" }
        }
      }
      // chain 中所有子命令均通过 denylist 检查，直接放行
      return { ok: true }
    }
  } else {
    baseCommand = extractBaseCommandArgv([command, ...args])
  }

  const normalizedBase = baseCommand.toLowerCase()
  const allowedSet = buildAllowedSet(allowedCommands)
  const deniedSet = buildDeniedSet(deniedCommands)

  // 允许列表覆盖拒绝列表
  if (allowedSet.has(normalizedBase)) {
    return { ok: true }
  }

  if (deniedSet.has(normalizedBase)) {
    if (riskyMode === "ask") {
      return { ok: false, reason: `Command "${normalizedBase}" requires user confirmation`, code: "CONFIRMATION_REQUIRED" }
    }
    if (riskyMode === "allow") {
      return { ok: true }
    }
    return { ok: false, reason: `Command "${normalizedBase}" is blocked by safety policy`, code: "UNSAFE_COMMAND" }
  }

  return { ok: true }
}

/**
 * 检查命令是否安全（只接收 command 字符串）。
 *
 * 保留原签名的便捷版，内部调 isCommandSafeArgv(command, [], ...)。
 * 注意：检查前会递归剥除常见 wrapper（如 env/nice/nohup/busybox/timeout），
 * 再用实际 base command 命中 allow/deny list，避免包装命令绕过启动策略。
 */
export function isCommandSafe(
  command: string,
  allowedCommands: string[] = [],
  deniedCommands: string[] = [],
  riskyMode: "deny" | "ask" | "allow" = "deny"
): CommandSafetyResult {
  // 旧版走 extractBaseCommand（字符串 → token → 剥除 wrapper）
  const baseCommand = extractBaseCommand(command)
  const normalizedBase = baseCommand.toLowerCase()
  const allowedSet = buildAllowedSet(allowedCommands)
  const deniedSet = buildDeniedSet(deniedCommands)

  // 允许列表覆盖拒绝列表
  if (allowedSet.has(normalizedBase)) {
    return { ok: true }
  }

  if (deniedSet.has(normalizedBase)) {
    if (riskyMode === "ask") {
      return { ok: false, reason: `Command "${normalizedBase}" requires user confirmation`, code: "CONFIRMATION_REQUIRED" }
    }
    if (riskyMode === "allow") {
      return { ok: true }
    }
    return { ok: false, reason: `Command "${normalizedBase}" is blocked by safety policy`, code: "UNSAFE_COMMAND" }
  }

  return { ok: true }
}

function buildAllowedSet(allowedCommands: string[]): Set<string> {
  return new Set(allowedCommands.map((command) => command.toLowerCase()))
}

function buildDeniedSet(deniedCommands: string[]): Set<string> {
  return new Set([...DEFAULT_DENIED_COMMANDS, ...deniedCommands].map((command) => command.toLowerCase()))
}

// ============================================================
// CWD 安全检查
// ============================================================

/**
 * 检查 CWD 是否在允许范围内。
 *
 * 使用 fs.realpath 将路径 canonicalize 后再做比较，防止 symlink 绕过
 * （workspace 内 symlink 指向 /etc 时字符串仍是子路径，realpath 会
 * 解析到真实目标 /etc，从而被拒绝）。
 *
 * Fail-closed：realpath 失败（ENOENT / 权限不足 / symlink 循环）直接拒绝，
 * 绝不 fallback 到字符串比较。
 *
 * @param cwd - 待检查的工作目录
 * @param workspaceRoot - 工作区根目录（始终允许）
 * @param allowedCwdRoots - 额外允许的工作目录根列表
 * @param mode - CWD 策略模式：
 *   - "guarded"（默认）：允许 workspaceRoot + allowedCwdRoots，拒绝危险目录，
 *     其他目录默认允许。向后兼容。
 *   - "strict"：仅允许 workspaceRoot + allowedCwdRoots 下的目录，
 *     其他目录一律拒绝。生产推荐。
 */
export async function isCwdAllowed(
  cwd: string,
  workspaceRoot: string = process.cwd(),
  allowedCwdRoots: string[] = [],
  mode: CwdPolicyMode = "guarded"
): Promise<CwdSafetyResult> {
  const resolved = isAbsolute(cwd) ? cwd : resolve(workspaceRoot, cwd)

  // 对 CWD 做 realpath canonicalize
  let canonicalCwd: string
  try {
    canonicalCwd = await realpath(resolved)
  } catch {
    return { ok: false, reason: `CWD "${cwd}" realpath failed (path may not exist or is inaccessible)`, code: "INVALID_CWD" }
  }

  // 对 workspaceRoot 做 realpath canonicalize
  let canonicalRoot: string
  try {
    canonicalRoot = await realpath(workspaceRoot)
  } catch {
    return { ok: false, reason: `workspaceRoot "${workspaceRoot}" realpath failed`, code: "INVALID_CWD" }
  }

  // 对每个 allowedCwdRoots 做 realpath；失败则跳过（配置的 extra root 可能不存在）
  const canonicalAllowedRoots: string[] = []
  for (const root of allowedCwdRoots) {
    try {
      canonicalAllowedRoots.push(await realpath(root))
    } catch {
      // extra root 不存在时跳过，不做 fail-closed——配置可能包含未创建的路径
      continue
    }
  }

  // 允许: workspace root 及其子目录（canonical path 比较）
  if (isSubdirectoryCanonical(canonicalCwd, canonicalRoot)) {
    return { ok: true }
  }

  // 允许: 用户显式配置的额外 CWD root（canonical path 比较）
  for (const canonicalAllowedRoot of canonicalAllowedRoots) {
    if (isSubdirectoryCanonical(canonicalCwd, canonicalAllowedRoot)) {
      return { ok: true }
    }
  }

  // strict 模式：不在白名单内即拒绝
  if (mode === "strict") {
    return {
      ok: false,
      reason: `CWD "${cwd}" is outside workspaceRoot and allowedCwdRoots under strict cwd policy`,
      code: "INVALID_CWD",
    }
  }

  // guarded 模式：继续执行 denied root 检查
  // 拒绝: 特权目录
  for (const denied of DEFAULT_DENIED_CWD_ROOTS) {
    // 特殊: 如果 workspaceRoot 本身在 /home/xxx 下，允许 workspaceRoot 但拒绝整个 /home
    if (denied === "/home" && workspaceRoot.startsWith("/home/")) {
      if (canonicalCwd === "/home" || (canonicalCwd.startsWith("/home/") && !isSubdirectoryCanonical(canonicalCwd, canonicalRoot))) {
        return { ok: false, reason: `CWD "${cwd}" is outside allowed workspace (under /home but not under ${workspaceRoot})`, code: "INVALID_CWD" }
      }
      continue
    }
    // 使用 canonical path 与 denied root 比较
    const normalizedDenied = normalizePathForComparison(denied)
    const deniedBoundary = normalizedDenied.endsWith(sep) ? normalizedDenied : `${normalizedDenied}${sep}`
    if (canonicalCwd === normalizedDenied || canonicalCwd.startsWith(deniedBoundary)) {
      // workspaceRoot 本身就在该 denied root 下，已经在上面通过了
      if (isSubdirectoryCanonical(canonicalRoot, normalizedDenied)) {
        continue
      }
      return { ok: false, reason: `CWD "${cwd}" is in denied root: ${denied}`, code: "INVALID_CWD" }
    }
  }

  // guarded 模式默认允许 (不匹配任何拒绝规则)
  return { ok: true }
}

// 导出供测试使用
export { isSubdirectory, isSubdirectoryCanonical, normalizePathForComparison }

// ============================================================
// 正则表达式 ReDoS 防护
// ============================================================

/**
 * RE2 模块懒加载单例。
 *
 * 三态：undefined = 尚未尝试加载，any 非 null = 加载成功，null = 不可用。
 * 使用 require() 同步加载，因为 re2 是 native addon，
 * 在 ESM 中 require() 仍可用于加载 C++ 模块（且被 re2 官方文档推荐）。
 * 懒加载保证 re2 缺失时服务器仍能正常启动。
 */
let _re2: any = undefined

function getRe2(): any {
  if (_re2 === undefined) {
    try {
      _re2 = require("re2")
    } catch {
      _re2 = null
    }
  }
  return _re2
}

/**
 * 嵌套量词 ReDoS 启发式检测。
 *
 * 检测形如 `(…+)+`、`(…*)*`、`(…{n,m})+`、`(…+)?` 的嵌套量词模式，
 * 这是经典 ReDoS 攻击的构造方式。
 * 该检测为 conservative — 可能产生少量误报，但不允许漏过典型攻击。
 * 仅在 RE2 不可用时作为 fallback 使用。
 */
function hasNestedQuantifiers(pattern: string): boolean {
  return /\([^)]*[+*{][^)]*\)[+*{?]/.test(pattern)
}

export type RegexValidationResult =
  | { ok: true; warning?: string }
  | { ok: false; reason: string; code: "INVALID_REGEX" | "UNSAFE_REGEX_PATTERN" }

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
export function validateRegexSafety(pattern: string): RegexValidationResult {
  const re2 = getRe2()

  // RE2 可用：编译测试即可，RE2 保证线性时间
  if (re2 !== null) {
    try {
      new re2(pattern)  // eslint-disable-line no-new
      return { ok: true, warning: "RE2 engine active — linear time guaranteed" }
    } catch (e) {
      return {
        ok: false,
        reason: `Invalid regex: ${String(e)}`,
        code: "INVALID_REGEX",
      }
    }
  }

  // RE2 不可用：启发式检测嵌套量词
  if (hasNestedQuantifiers(pattern)) {
    return {
      ok: false,
      reason: "Regex contains nested quantifiers which may cause catastrophic backtracking. Install the 're2' package for guaranteed linear-time regex execution.",
      code: "UNSAFE_REGEX_PATTERN",
    }
  }

  return { ok: true, warning: "Heuristic check only (install 're2' for guaranteed protection)" }
}

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
export function createSafeRegex(pattern: string, flags?: string): RegExp {
  const re2 = getRe2()
  if (re2 !== null) {
    return flags ? new re2(pattern, flags) : new re2(pattern)
  }
  return flags ? new RegExp(pattern, flags) : new RegExp(pattern)
}
