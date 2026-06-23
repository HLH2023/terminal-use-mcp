/**
 * tmux 命令鉴权与编译 — authorize + compile 阶段
 *
 * 解析后的 AST 经过本模块鉴权（allowlist/denylist 检查）
 * 和编译（AST → 实际 tmux 命令参数），返回结构化结果。
 *
 * 鉴权流程：kind allowlist → 破坏性检查 → denylist → shell command safety → 编译
 *
 * 这是纯算法模块，不依赖任何 provider，不抛异常（返回结构化结果）。
 */

import type { TmuxCommandAst, TmuxTarget, TmuxAttachTarget } from "./tmux-command-parser.js"

// ============================================================
// 1. 编译后的命令类型
// ============================================================

/** 编译后的 tmux 命令 */
export type TmuxCompiledCommand = {
  /** 传给 control channel execute() 的参数 */
  args: string[]
  /** 命令描述（用于 audit） */
  description: string
  /** 是否为破坏性操作 */
  destructive: boolean
  /** 原始 AST */
  ast: TmuxCommandAst
  /** 需要后续刷新 tree 吗 */
  needsTreeRefresh: boolean
  /** 需要重新 attach render channel 吗 */
  needsReattach: boolean
}

// ============================================================
// 2. 鉴权上下文
// ============================================================

/** 鉴权上下文 */
export type AuthorizationContext = {
  /** 是否允许破坏性操作（kill-session/window/pane） */
  isDestructiveAllowed: boolean
  /** 当前 session name */
  currentSession: string
  /** 已知 session 列表 */
  knownSessions: Set<string>
  /** 命令安全检查函数 */
  commandSafety: (command: string, args: string[]) => boolean
  /** 允许的 tmux 命令种类 */
  allowedCommandKinds: Set<string>
}

// ============================================================
// 3. 鉴权结果
// ============================================================

/** 鉴权并编译的结果 */
export type AuthorizationResult =
  | { allowed: true; compiled: TmuxCompiledCommand }
  | { allowed: false; reason: string; code: string }

// ============================================================
// 4. 禁止命令 denylist
// ============================================================

/** 绝对禁止的 tmux 内部命令（不可配置绕过） */
const TMUX_COMMAND_DENYLIST = [
  "run-shell", "if-shell", "pipe-pane", "display-popup",
  "command-prompt", "source-file", "bind-key", "unbind-key",
  "set-hook", "confirm-before", "load-buffer", "save-buffer",
] as const

/** 带 shell command 时需要走 command safety 闸门的命令 */
const TMUX_COMMAND_NEEDS_SAFETY_CHECK = [
  "new-session", "new-window", "split-window",
] as const

// ============================================================
// 5. 允许命令 allowlist
// ============================================================

const DEFAULT_ALLOWED_COMMAND_KINDS: ReadonlySet<string> = new Set([
  "list", "attach", "new", "kill", "rename", "select",
  "resize", "copy-mode", "copy-scroll", "send-keys", "paste",
  "show-info", "search",
])

// ============================================================
// 6. Format string 常量
// ============================================================

const SESSION_FORMAT = "#{session_name}\\t#{session_created}\\t#{session_windows}\\t#{session_width}x#{session_height}"
const WINDOW_FORMAT = "#{session_name}\\t#{window_index}\\t#{window_name}\\t#{window_width}x#{window_height}\\t#{window_id}"
const PANE_FORMAT = "#{session_name}\\t#{window_index}\\t#{pane_index}\\t#{pane_id}\\t#{pane_width}x#{pane_height}\\t#{pane_left},#{pane_top}\\t#{pane_active}\\t#{pane_current_command}"

// ============================================================
// 7. Target 格式化辅助
// ============================================================

/**
 * 将 TmuxTarget 转换为 tmux 命令行参数字符串。
 *
 * %3 → "%3"（pane 直接使用 id）
 * @2 → "@2"（window 直接使用 id）
 * dev → "dev"（session 使用 name）
 */
function formatTarget(target: TmuxTarget): string {
  switch (target.type) {
    case "pane":
      return target.id
    case "window":
      return target.id
    case "session":
      return target.name
    case "fuzzy":
      return target.name
  }
}

/**
 * 将 TmuxAttachTarget 转换为 tmux 命令行参数字符串。
 */
function formatAttachTarget(target: TmuxAttachTarget): string {
  switch (target.type) {
    case "session":
      return target.name
    case "window":
      return `${target.session}:${target.window}`
    case "pane":
      return target.paneId
  }
}

// ============================================================
// 8. 破坏性命令判断
// ============================================================

/**
 * 判断 AST kind 是否为破坏性操作（kill session/window/pane）。
 */
function isDestructiveKind(ast: TmuxCommandAst): boolean {
  return ast.kind === "kill"
}

// ============================================================
// 9. AST → tmux 命令编译
// ============================================================

/**
 * 编译 AST 为 tmux 命令参数数组。
 *
 * 每个 AST kind → tmux 命令参数的映射：
 * - list sessions → ["list-sessions", "-F", FORMAT]
 * - list tree → 多命令（返回主命令，外部循环）
 * - list windows @2 → ["list-windows", "-t", "@2", "-F", FORMAT]
 * - list panes → ["list-panes", "-a", "-F", FORMAT]
 * - attach session dev → needsReattach=true
 * - new session dev → ["new-session", "-d", "-s", "dev"]
 * - new window editor in dev → ["new-window", "-t", "dev", "-n", "editor"]
 * - new pane %3 horizontal → ["split-window", "-t", "%3", "-h"]
 * - kill session dev → ["kill-session", "-t", "dev"]
 * - kill pane %3 → ["kill-pane", "-t", "%3"]
 * - rename session dev newdev → ["rename-session", "-t", "dev", "newdev"]
 * - select window @2 → ["select-window", "-t", "@2"]
 * - resize pane %3 -x 80 -y 30 → ["resize-pane", "-t", "%3", "-x", "80", "-y", "30"]
 * - copy-mode %3 → ["copy-mode", "-t", "%3"]
 * - copy-scroll %3 up 10 → ["send-keys", "-t", "%3", "-X", "scroll-up"]
 * - send-keys → ["send-keys", "-t", target, keys, "-l"(if literal)]
 * - paste → 不直接映射 tmux 命令（通过 buffer 机制处理）
 * - show-info → ["list-sessions", "-F", FORMAT]
 *
 * @param ast - 解析后的 AST
 * @returns TmuxCompiledCommand
 */
function compileAst(ast: TmuxCommandAst): TmuxCompiledCommand {
  const destructive = isDestructiveKind(ast)

  // 绝大部分命令不需要 tree refresh 或 reattach
  let needsTreeRefresh = false
  let needsReattach = false

  switch (ast.kind) {
    // ---- list 类 ----
    case "list": {
      const description = `list ${ast.scope}${ast.target ? ` ${formatTarget(ast.target)}` : ""}${ast.search ? ` search:${ast.search}` : ""}`

      if (ast.scope === "sessions") {
        const args = ["list-sessions", "-F", SESSION_FORMAT]
        return { args, description, destructive, ast, needsTreeRefresh, needsReattach }
      }

      if (ast.scope === "tree") {
        // tree 模式：返回 list-sessions 作为主命令，
        // 外部调用方需要再执行 list-windows 和 list-panes
        const args = ["list-sessions", "-F", SESSION_FORMAT]
        return { args, description, destructive, ast, needsTreeRefresh: false, needsReattach }
      }

      if (ast.scope === "windows") {
        const targetArg = ast.target ? ["-t", formatTarget(ast.target)] : []
        const args = ["list-windows", ...targetArg, "-F", WINDOW_FORMAT]
        return { args, description, destructive, ast, needsTreeRefresh, needsReattach }
      }

      if (ast.scope === "panes") {
        // list-panes -a 列出所有 pane，-t 限定到特定 session/window
        const targetArg = ast.target ? ["-t", formatTarget(ast.target)] : ["-a"]
        const args = ["list-panes", ...targetArg, "-F", PANE_FORMAT]
        return { args, description, destructive, ast, needsTreeRefresh, needsReattach }
      }

      // 不可能到达：scope 是 "sessions" | "tree" | "windows" | "panes"
      break
    }

    // ---- attach 类 ----
    case "attach": {
      const description = `attach ${formatAttachTarget(ast.target)}`
      // attach 不产生 tmux 命令参数——它需要 reattach render channel
      needsReattach = true
      const args: string[] = []
      return { args, description, destructive, ast, needsTreeRefresh, needsReattach }
    }

    // ---- new 类 ----
    case "new": {
      needsTreeRefresh = true

      if (ast.entity === "session") {
        const name = ast.name ?? "unnamed"
        const args = ["new-session", "-d", "-s", name]
        const description = `new session ${name}`
        return { args, description, destructive, ast, needsTreeRefresh, needsReattach }
      }

      if (ast.entity === "window") {
        const name = ast.name ?? "unnamed"
        const targetArg = ast.target ? ["-t", formatTarget(ast.target)] : []
        const baseArgs = ["new-window", ...targetArg, "-n", name]
        // 有 command 时追加到参数（tmux new-window 允许尾部附带命令）
        const commandArgs = ast.command ? [ast.command] : []
        const args = [...baseArgs, ...commandArgs]
        const description = `new window ${name}${ast.target ? ` in ${formatTarget(ast.target)}` : ""}${ast.command ? ` with ${ast.command}` : ""}`
        return { args, description, destructive, ast, needsTreeRefresh, needsReattach }
      }

      if (ast.entity === "pane") {
        const targetArg = ast.target ? ["-t", formatTarget(ast.target)] : []
        const splitArg = ast.splitDirection === "horizontal" ? ["-h"] : ast.splitDirection === "vertical" ? ["-v"] : []
        // split-window 默认是垂直分割（-v），水平分割需要 -h
        // 但 tmux 语义：-h = horizontal split（左右分），-v = vertical split（上下分）
        // 注意：tmux 的 -h 实际是"水平分割"（左右），不加参数默认是垂直（上下）
        const args = ["split-window", ...targetArg, ...splitArg]
        const description = `new pane${ast.target ? ` in ${formatTarget(ast.target)}` : ""}${ast.splitDirection ? ` split ${ast.splitDirection}` : ""}`
        return { args, description, destructive, ast, needsTreeRefresh, needsReattach }
      }

      break
    }

    // ---- kill 类 ----
    case "kill": {
      needsTreeRefresh = true
      const targetStr = formatTarget(ast.target)

      if (ast.entity === "session") {
        const args = ["kill-session", "-t", targetStr]
        const description = `kill session ${targetStr}`
        return { args, description, destructive: true, ast, needsTreeRefresh, needsReattach }
      }

      if (ast.entity === "window") {
        const args = ["kill-window", "-t", targetStr]
        const description = `kill window ${targetStr}`
        return { args, description, destructive: true, ast, needsTreeRefresh, needsReattach }
      }

      if (ast.entity === "pane") {
        const args = ["kill-pane", "-t", targetStr]
        const description = `kill pane ${targetStr}`
        return { args, description, destructive: true, ast, needsTreeRefresh, needsReattach }
      }

      break
    }

    // ---- rename 类 ----
    case "rename": {
      needsTreeRefresh = true
      const targetStr = formatTarget(ast.target)

      if (ast.entity === "session") {
        const args = ["rename-session", "-t", targetStr, ast.newName]
        const description = `rename session ${targetStr} → ${ast.newName}`
        return { args, description, destructive, ast, needsTreeRefresh, needsReattach }
      }

      if (ast.entity === "window") {
        const args = ["rename-window", "-t", targetStr, ast.newName]
        const description = `rename window ${targetStr} → ${ast.newName}`
        return { args, description, destructive, ast, needsTreeRefresh, needsReattach }
      }

      // pane rename 不常用但支持
      const args = ["rename-pane", "-t", targetStr, ast.newName]
      const description = `rename pane ${targetStr} → ${ast.newName}`
      return { args, description, destructive, ast, needsTreeRefresh, needsReattach }
    }

    // ---- select 类 ----
    case "select": {
      const targetStr = formatTarget(ast.target)

      if (ast.entity === "window") {
        const args = ["select-window", "-t", targetStr]
        const description = `select window ${targetStr}`
        return { args, description, destructive, ast, needsTreeRefresh, needsReattach }
      }

      if (ast.entity === "pane") {
        const args = ["select-pane", "-t", targetStr]
        const description = `select pane ${targetStr}`
        return { args, description, destructive, ast, needsTreeRefresh, needsReattach }
      }

      break
    }

    // ---- resize 类 ----
    case "resize": {
      const targetStr = formatTarget(ast.target)
      const baseArgs = ["resize-pane", "-t", targetStr]

      if (ast.width !== undefined) {
        baseArgs.push("-x", String(ast.width))
      }
      if (ast.height !== undefined) {
        baseArgs.push("-y", String(ast.height))
      }

      const description = `resize ${ast.entity} ${targetStr}${ast.width ? ` -x ${ast.width}` : ""}${ast.height ? ` -y ${ast.height}` : ""}`
      return { args: baseArgs, description, destructive, ast, needsTreeRefresh, needsReattach }
    }

    // ---- copy-mode 类 ----
    case "copy-mode": {
      const targetStr = formatTarget(ast.target)
      const args = ["copy-mode", "-t", targetStr]
      const description = `copy-mode ${targetStr}`
      return { args, description, destructive, ast, needsTreeRefresh, needsReattach }
    }

    // ---- copy-scroll 类 ----
    case "copy-scroll": {
      const targetStr = formatTarget(ast.target)
      // copy-scroll 通过 send-keys -X 实现
      const scrollCommand = ast.direction === "up" ? "scroll-up" : "scroll-down"
      const args = ["send-keys", "-t", targetStr, "-X", scrollCommand]
      const description = `copy-scroll ${targetStr} ${ast.direction} ${ast.lines}`
      return { args, description, destructive, ast, needsTreeRefresh, needsReattach }
    }

    // ---- send-keys 类 ----
    case "send-keys": {
      const targetStr = formatTarget(ast.target)
      const literalArg = ast.literal ? ["-l"] : []
      const args = ["send-keys", "-t", targetStr, ast.keys, ...literalArg]
      const description = `send-keys ${targetStr} ${ast.keys}${ast.literal ? " (literal)" : ""}`
      return { args, description, destructive, ast, needsTreeRefresh, needsReattach }
    }

    // ---- paste 类 ----
    case "paste": {
      // paste 通过 tmux buffer 机制处理，此处编译为 set-buffer + paste-buffer
      // 实际实现可能需要两步操作，此处返回第一步
      const targetStr = formatTarget(ast.target)
      const args = ["set-buffer", ast.text]
      const description = `paste to ${targetStr}`
      return { args, description, destructive, ast, needsTreeRefresh, needsReattach }
    }

    // ---- show-info 类 ----
    case "show-info": {
      const args = ["list-sessions", "-F", SESSION_FORMAT]
      const description = "show-info"
      return { args, description, destructive, ast, needsTreeRefresh, needsReattach }
    }
  }

  // 穷尽检查：所有 kind 都应在 switch 中处理
  // 如果到达这里，说明 AST 有未知的 kind（不应发生）
  const args: string[] = []
  return {
    args,
    description: `unknown kind: ${(ast as TmuxCommandAst).kind}`,
    destructive: false,
    ast,
    needsTreeRefresh: false,
    needsReattach: false,
  }
}

// ============================================================
// 10. AST → tmux 子命令名映射（用于 denylist/safety check）
// ============================================================

/**
 * 将 AST kind + entity 映射为 tmux 子命令名（如 "kill-session", "new-window"）。
 * 用于判断是否需要 command safety 检查。
 */
function astToTmuxSubcommand(ast: TmuxCommandAst): string | undefined {
  switch (ast.kind) {
    case "new":
      if (ast.entity === "session") return "new-session"
      if (ast.entity === "window") return "new-window"
      if (ast.entity === "pane") return "split-window"
      return undefined
    default:
      return undefined
  }
}

// ============================================================
// 11. 核心鉴权 + 编译函数
// ============================================================

/**
 * 鉴权并编译 tmux 命令 AST。
 *
 * 流程：
 * 1. kind allowlist 检查：ast.kind 是否在 allowedCommandKinds 中
 * 2. denylist 检查：AST 映射的 tmux 子命令是否在 TMUX_COMMAND_DENYLIST 中
 * 3. 破坏性检查：kill 类且 isDestructiveAllowed === false → 拒绝
 * 4. shell command safety：AST 中包含 command 字段且子命令在 NEEDS_SAFETY_CHECK 中
 *    → 调用 context.commandSafety() 检查
 * 5. 编译：通过所有检查后编译为 TmuxCompiledCommand
 * 6. 参数级拒绝检查：set-option -g/-s（全局/session 级别）和 set-environment 被拒绝
 *
 * @param ast - 解析后的 AST
 * @param context - 鉴权上下文
 * @returns AuthorizationResult：允许返回编译结果，拒绝返回原因和代码
 */
export function authorizeAndCompile(
  ast: TmuxCommandAst,
  context: AuthorizationContext
): AuthorizationResult {
  // ---- 步骤 1: kind allowlist 检查 ----
  const effectiveAllowedKinds = context.allowedCommandKinds.size > 0
    ? context.allowedCommandKinds
    : DEFAULT_ALLOWED_COMMAND_KINDS

  if (!effectiveAllowedKinds.has(ast.kind)) {
    return {
      allowed: false,
      reason: `Command kind "${ast.kind}" is not in the allowed list`,
      code: "TMUX_COMMAND_DENIED",
    }
  }

  // ---- 步骤 2: denylist 检查 ----
  // 检查 AST 映射的 tmux 子命令是否在绝对禁止列表中
  const subcommand = astToTmuxSubcommand(ast)
  if (subcommand !== undefined) {
    const denySet: Set<string> = new Set(TMUX_COMMAND_DENYLIST)
    if (denySet.has(subcommand)) {
      return {
        allowed: false,
        reason: `tmux command "${subcommand}" is on the denylist and cannot be bypassed`,
        code: "TMUX_COMMAND_DENIED",
      }
    }
  }

  // ---- 步骤 3: 破坏性检查 ----
  if (isDestructiveKind(ast) && !context.isDestructiveAllowed) {
    return {
      allowed: false,
      reason: `Destructive operation "${ast.kind}" is not allowed in current context`,
      code: "TMUX_COMMAND_DENIED",
    }
  }

  // ---- 步骤 4: shell command safety 检查 ----
  // 只有 new 类命令可能携带 shell command，需要走 command safety 闸门
  if (ast.kind === "new" && ast.command !== undefined) {
    const needsCheckSet = new Set<string>(TMUX_COMMAND_NEEDS_SAFETY_CHECK)
    const subcmd = astToTmuxSubcommand(ast)

    if (subcmd !== undefined && needsCheckSet.has(subcmd)) {
      // commandSafety 接受 (command, args) 检查安全性
      const safe = context.commandSafety(ast.command, [])
      if (!safe) {
        return {
          allowed: false,
          reason: `Shell command "${ast.command}" in "${subcmd}" blocked by command safety policy`,
          code: "TMUX_COMMAND_DENIED",
        }
      }
    }
  }

  // ---- 步骤 5: 编译 ----
  const compiled = compileAst(ast)

  // ---- 步骤 6: 参数级拒绝检查 ----
  const subcmd = compiled.args[0]
  if (subcmd === "set-option" || subcmd === "set-option-window") {
    const hasGlobalFlag = compiled.args.includes("-g") || compiled.args.includes("-s")
    if (hasGlobalFlag) {
      return { allowed: false, reason: "set-option with -g/-s (global/server scope) is denied", code: "DENIED_DANGEROUS_OPTION" }
    }
  }
  if (subcmd === "set-environment") {
    return { allowed: false, reason: "set-environment is denied (risk of secret injection)", code: "DENIED_SET_ENVIRONMENT" }
  }

  return { allowed: true, compiled }
}
