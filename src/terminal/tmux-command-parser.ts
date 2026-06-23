/**
 * tmux 命令 DSL 解析器 — 将 Agent 自然语言命令解析为结构化 AST
 *
 * 解析流程:
 *  1. 安全校验 (注入检测)
 *  2. 按空格分词
 *  3. 第一个 token 确定 command kind
 *  4. 按位置 + 关键字解析 target 和选项
 *  5. 返回结构化 AST 或错误
 *
 * 这是纯算法模块，不依赖任何 provider，不抛异常。
 */

// ============================================================
// 1. AST 类型定义
// ============================================================

/** tmux 目标标识 */
export type TmuxTarget =
  | { type: "pane"; id: string }       // %3
  | { type: "window"; id: string }     // @2
  | { type: "session"; name: string }  // dev
  | { type: "fuzzy"; name: string }    // 模糊名称

/** attach 目标 */
export type TmuxAttachTarget =
  | { type: "session"; name: string }
  | { type: "window"; session: string; window: string }
  | { type: "pane"; paneId: string }

/** tmux 命令 AST */
export type TmuxCommandAst =
  | { kind: "list"; scope: "sessions" | "tree" | "windows" | "panes"; target?: TmuxTarget; search?: string }
  | { kind: "attach"; target: TmuxAttachTarget }
  | { kind: "new"; entity: "session" | "window" | "pane"; name?: string; target?: TmuxTarget; splitDirection?: "horizontal" | "vertical"; command?: string }
  | { kind: "kill"; entity: "session" | "window" | "pane"; target: TmuxTarget }
  | { kind: "rename"; entity: "session" | "window" | "pane"; target: TmuxTarget; newName: string }
  | { kind: "select"; entity: "window" | "pane"; target: TmuxTarget }
  | { kind: "resize"; entity: "window" | "pane"; target: TmuxTarget; width?: number; height?: number }
  | { kind: "copy-mode"; target: TmuxTarget }
  | { kind: "copy-scroll"; target: TmuxTarget; direction: "up" | "down"; lines: number }
  | { kind: "send-keys"; target: TmuxTarget; keys: string; literal: boolean }
  | { kind: "paste"; target: TmuxTarget; text: string }
  | { kind: "show-info" }

/** 解析结果 */
export type TmuxCommandParseResult =
  | { ok: true; ast: TmuxCommandAst }
  | { ok: false; error: string; hint?: string }

// ============================================================
// 2. 安全校验
// ============================================================

/** 注入字符正则：分号、管道、&、重定向、反引号、$()、换行、连续 -- */
const INJECTION_RE = /[;|&>`$\n\r]|--/

/**
 * 检查输入是否包含注入字符。
 *
 * 拒绝：; | & > >> < ` $() \n \r 以及连续的 --
 *
 * @param input - 待检查的原始输入
 * @returns true 表示检测到注入字符
 */
export function containsInjection(input: string): boolean {
  // 连续 -- 检测（允许单个 -，拒绝 --）
  if (/--/.test(input)) return true
  // 其余注入字符
  if (INJECTION_RE.test(input)) return true
  // $() 子 shell
  if (/\$\(/.test(input)) return true
  return false
}

// ============================================================
// 3. Target 解析
// ============================================================

/**
 * 解析 tmux target 标识符。
 *
 * %3 → { type: "pane", id: "%3" }
 * @2 → { type: "window", id: "@2" }
 * dev → { type: "session", name: "dev" }
 *
 * @param token - 单个 token 字符串
 * @returns 解析后的 TmuxTarget
 */
export function parseTarget(token: string): TmuxTarget {
  if (token.startsWith("%")) {
    return { type: "pane", id: token }
  }
  if (token.startsWith("@")) {
    return { type: "window", id: token }
  }
  return { type: "session", name: token }
}

/**
 * 解析 attach target。
 *
 * "dev"       → { type: "session", name: "dev" }
 * "dev:1"     → { type: "window", session: "dev", window: "1" }
 * "%3"        → { type: "pane", paneId: "%3" }
 *
 * @param token - attach target token
 * @returns 解析后的 TmuxAttachTarget
 */
export function parseAttachTarget(token: string): TmuxAttachTarget {
  if (token.startsWith("%")) {
    return { type: "pane", paneId: token }
  }
  // 检查 session:window 格式
  const colonIdx = token.indexOf(":")
  if (colonIdx > 0) {
    const session = token.slice(0, colonIdx)
    const window = token.slice(colonIdx + 1)
    return { type: "window", session, window }
  }
  return { type: "session", name: token }
}

// ============================================================
// 4. 辅助函数
// ============================================================

/** 已知的 list scope 值 */
const LIST_SCOPES = new Set(["sessions", "tree", "windows", "panes"])

/** entity 联合类型 */
type TmuxEntity = "session" | "window" | "pane"

/** 已知的 entity 值 */
const ENTITIES = new Set<TmuxEntity>(["session", "window", "pane"])

/** split 方向关键词 */
const SPLIT_DIRECTIONS = new Set(["horizontal", "vertical"])

/** 有效的 list scope 别名映射 */
const LIST_SCOPE_ALIASES: Record<string, "sessions" | "tree" | "windows" | "panes"> = {
  sessions: "sessions",
  session: "sessions",
  tree: "tree",
  windows: "windows",
  window: "windows",
  panes: "panes",
  pane: "panes",
}

/**
 * 查找 "with" 关键字在 tokens 中的位置。
 * 只查找第一个 "with"，后续所有 token 合并为 command。
 *
 * @param tokens - token 数组
 * @param startIdx - 开始搜索的位置
 * @returns "with" 的索引，未找到返回 -1
 */
function findWithKeyword(tokens: string[], startIdx: number): number {
  for (let i = startIdx; i < tokens.length; i++) {
    if (tokens[i] === "with") return i
  }
  return -1
}

/**
 * 查找 "in" 关键字在 tokens 中的位置。
 *
 * @param tokens - token 数组
 * @param startIdx - 开始搜索的位置
 * @returns "in" 的索引，未找到返回 -1
 */
function findInKeyword(tokens: string[], startIdx: number): number {
  for (let i = startIdx; i < tokens.length; i++) {
    if (tokens[i] === "in") return i
  }
  return -1
}

// ============================================================
// 5. 各命令解析器
// ============================================================

/**
 * 解析 list 命令。
 *
 * 格式: list [scope] [target] [search <term>]
 * 示例: list sessions / list tree / list session dev / list panes / search dev
 */
function parseList(tokens: string[]): TmuxCommandParseResult {
  if (tokens.length < 1) {
    return { ok: false, error: "list requires a scope", hint: 'Use: list sessions|tree|windows|panes [target]' }
  }

  const scopeToken = tokens[0]!.toLowerCase()
  const scope = LIST_SCOPE_ALIASES[scopeToken]
  if (!scope) {
    return { ok: false, error: `Unknown list scope: "${scopeToken}"`, hint: "Valid scopes: sessions, tree, windows, panes" }
  }

  // 剩余 tokens 可选：target 和 search
  let target: TmuxTarget | undefined
  let search: string | undefined
  const rest = tokens.slice(1)

  for (let i = 0; i < rest.length; i++) {
    const t = rest[i]!
    if (t === "search" && i + 1 < rest.length) {
      // search 后面的所有 token 合并为搜索词
      search = rest.slice(i + 1).join(" ")
      break
    }
    // 不是关键字，视为 target
    if (t !== "in" && t !== "with" && t !== "search") {
      target = parseTarget(t)
    }
  }

  return { ok: true, ast: { kind: "list", scope, target, search } }
}

/**
 * 解析 search 命令（list 的快捷方式）。
 *
 * 格式: search <scope> <term> 或 search <term>
 */
function parseSearch(tokens: string[]): TmuxCommandParseResult {
  if (tokens.length < 1) {
    return { ok: false, error: "search requires a search term", hint: 'Use: search <term> or search <scope> <term>' }
  }

  // 检查第一个 token 是否是 scope
  const scopeToken = tokens[0]!.toLowerCase()
  const scope = LIST_SCOPE_ALIASES[scopeToken]

  if (scope && tokens.length > 1) {
    // search <scope> <term...>
    const search = tokens.slice(1).join(" ")
    return { ok: true, ast: { kind: "list", scope, search } }
  }

  // search <term...> — 默认在 sessions 中搜索
  const search = tokens.join(" ")
  return { ok: true, ast: { kind: "list", scope: "sessions", search } }
}

/**
 * 解析 attach 命令。
 *
 * 格式: attach session <name> / attach window <session:window> / attach pane <paneId>
 */
function parseAttach(tokens: string[]): TmuxCommandParseResult {
  if (tokens.length < 2) {
    return { ok: false, error: "attach requires entity and target", hint: 'Use: attach session <name> | attach window <session:window> | attach pane <paneId>' }
  }

  const entityRaw = tokens[0]!.toLowerCase()
  if (!ENTITIES.has(entityRaw as TmuxEntity)) {
    return { ok: false, error: `Unknown attach entity: "${entityRaw}"`, hint: "Valid entities: session, window, pane" }
  }
  const entity = entityRaw as TmuxEntity

  const targetToken = tokens[1]!
  const target = parseAttachTarget(targetToken)

  // 验证 entity 和 target 类型匹配
  if (entity === "session" && target.type !== "session") {
    return { ok: false, error: `attach session expects a session name, got "${targetToken}"` }
  }
  if (entity === "window" && target.type !== "window") {
    return { ok: false, error: `attach window expects session:window format, got "${targetToken}"`, hint: 'Use format: attach window dev:1' }
  }
  if (entity === "pane" && target.type !== "pane") {
    return { ok: false, error: `attach pane expects a pane ID (%N), got "${targetToken}"` }
  }

  return { ok: true, ast: { kind: "attach", target } }
}

/**
 * 解析 new 命令。
 *
 * 格式: new session <name> / new window <name> [in <target>] [with <command>] / new pane [split <direction>]
 */
function parseNew(tokens: string[]): TmuxCommandParseResult {
  if (tokens.length < 1) {
    return { ok: false, error: "new requires an entity", hint: 'Use: new session <name> | new window <name> [in <target>] [with <command>]' }
  }

  const entityRaw = tokens[0]!.toLowerCase()
  if (!ENTITIES.has(entityRaw as TmuxEntity)) {
    return { ok: false, error: `Unknown new entity: "${entityRaw}"`, hint: "Valid entities: session, window, pane" }
  }
  const entity = entityRaw as TmuxEntity

  // 对于 session: new session <name>
  if (entity === "session") {
    if (tokens.length < 2) {
      return { ok: false, error: "new session requires a name", hint: 'Use: new session <name>' }
    }
    const name = tokens[1]!
    return { ok: true, ast: { kind: "new", entity: "session", name } }
  }

  // 对于 window: new window <name> [in <target>] [with <command>]
  if (entity === "window") {
    if (tokens.length < 2) {
      return { ok: false, error: "new window requires a name", hint: 'Use: new window <name> [in <session>] [with <command>]' }
    }

    const name = tokens[1]!
    let target: TmuxTarget | undefined
    let command: string | undefined

    // 查找 "in" 关键字
    const inIdx = findInKeyword(tokens, 2)
    if (inIdx >= 0 && inIdx + 1 < tokens.length) {
      target = parseTarget(tokens[inIdx + 1]!)
    }

    // 查找 "with" 关键字
    const withIdx = findWithKeyword(tokens, 2)
    if (withIdx >= 0 && withIdx + 1 < tokens.length) {
      command = tokens.slice(withIdx + 1).join(" ")
    }

    return { ok: true, ast: { kind: "new", entity: "window", name, target, command } }
  }

  // 对于 pane: new pane [split <direction>] [in <target>]
  if (entity === "pane") {
    let splitDirection: "horizontal" | "vertical" | undefined
    let target: TmuxTarget | undefined

    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i]!
      if (t === "split" && i + 1 < tokens.length) {
        const dir = tokens[i + 1]!.toLowerCase()
        if (SPLIT_DIRECTIONS.has(dir)) {
          splitDirection = dir as "horizontal" | "vertical"
          i++ // 跳过 direction token
        }
      } else if (t === "in" && i + 1 < tokens.length) {
        target = parseTarget(tokens[i + 1]!)
        i++ // 跳过 target token
      }
    }

    return { ok: true, ast: { kind: "new", entity: "pane", target, splitDirection } }
  }

  // 不可能到达这里，TypeScript 需要这行保证穷尽
  return { ok: false, error: `Unhandled new entity: "${entity}"` }
}

/**
 * 解析 kill 命令。
 *
 * 格式: kill session <name> / kill window <id> / kill pane <id>
 */
function parseKill(tokens: string[]): TmuxCommandParseResult {
  if (tokens.length < 2) {
    return { ok: false, error: "kill requires entity and target", hint: 'Use: kill session <name> | kill window <@N> | kill pane <%N>' }
  }

  const entityRaw = tokens[0]!.toLowerCase()
  if (!ENTITIES.has(entityRaw as TmuxEntity)) {
    return { ok: false, error: `Unknown kill entity: "${entityRaw}"`, hint: "Valid entities: session, window, pane" }
  }
  const entity = entityRaw as TmuxEntity

  const target = parseTarget(tokens[1]!)
  return { ok: true, ast: { kind: "kill", entity, target } }
}

/**
 * 解析 rename 命令。
 *
 * 格式: rename session <name> <newName> / rename window <@N> <newName> / rename pane <%N> <newName>
 */
function parseRename(tokens: string[]): TmuxCommandParseResult {
  if (tokens.length < 3) {
    return { ok: false, error: "rename requires entity, target and newName", hint: 'Use: rename session <name> <newName>' }
  }

  const entityRaw = tokens[0]!.toLowerCase()
  if (!ENTITIES.has(entityRaw as TmuxEntity)) {
    return { ok: false, error: `Unknown rename entity: "${entityRaw}"`, hint: "Valid entities: session, window, pane" }
  }
  const entity = entityRaw as TmuxEntity

  const target = parseTarget(tokens[1]!)
  const newName = tokens[2]!
  return { ok: true, ast: { kind: "rename", entity, target, newName } }
}

/**
 * 解析 select 命令。
 *
 * 格式: select window <@N> / select pane <%N>
 */
function parseSelect(tokens: string[]): TmuxCommandParseResult {
  if (tokens.length < 2) {
    return { ok: false, error: "select requires entity and target", hint: 'Use: select window <@N> | select pane <%N>' }
  }

  const entity = tokens[0]!.toLowerCase()
  if (entity !== "window" && entity !== "pane") {
    return { ok: false, error: `Unknown select entity: "${entity}"`, hint: "Valid entities: window, pane" }
  }

  const target = parseTarget(tokens[1]!)
  return { ok: true, ast: { kind: "select", entity, target } }
}

/**
 * 解析 resize 命令。
 *
 * 格式: resize window <@N> WxH / resize pane <%N> -x W -y H
 */
function parseResize(tokens: string[]): TmuxCommandParseResult {
  if (tokens.length < 2) {
    return { ok: false, error: "resize requires entity and target", hint: 'Use: resize window <@N> WxH | resize pane <%N> -x W -y H' }
  }

  const entity = tokens[0]!.toLowerCase()
  if (entity !== "window" && entity !== "pane") {
    return { ok: false, error: `Unknown resize entity: "${entity}"`, hint: "Valid entities: window, pane" }
  }

  const target = parseTarget(tokens[1]!)
  let width: number | undefined
  let height: number | undefined

  const rest = tokens.slice(2)

  // 检查 WxH 格式
  if (rest.length >= 1) {
    const dimToken = rest[0]!
    const dimMatch = /^(\d+)x(\d+)$/i.exec(dimToken)
    if (dimMatch) {
      width = parseInt(dimMatch[1]!, 10)
      height = parseInt(dimMatch[2]!, 10)
    }
  }

  // 检查 -x / -y 格式
  if (width === undefined && height === undefined) {
    for (let i = 0; i < rest.length; i++) {
      const t = rest[i]!
      if ((t === "-x" || t === "-w") && i + 1 < rest.length) {
        width = parseInt(rest[i + 1]!, 10)
        if (isNaN(width)) return { ok: false, error: `Invalid width: "${rest[i + 1]}"` }
        i++
      }
      if ((t === "-y" || t === "-h") && i + 1 < rest.length) {
        height = parseInt(rest[i + 1]!, 10)
        if (isNaN(height)) return { ok: false, error: `Invalid height: "${rest[i + 1]}"` }
        i++
      }
    }
  }

  return { ok: true, ast: { kind: "resize", entity, target, width, height } }
}

/**
 * 解析 copy-mode 命令。
 *
 * 格式: copy-mode <target>
 */
function parseCopyMode(tokens: string[]): TmuxCommandParseResult {
  if (tokens.length < 1) {
    return { ok: false, error: "copy-mode requires a target", hint: 'Use: copy-mode <%N>' }
  }

  const target = parseTarget(tokens[0]!)
  return { ok: true, ast: { kind: "copy-mode", target } }
}

/**
 * 解析 copy-scroll 命令。
 *
 * 格式: copy-scroll <target> up|down <lines>
 */
function parseCopyScroll(tokens: string[]): TmuxCommandParseResult {
  if (tokens.length < 3) {
    return { ok: false, error: "copy-scroll requires target, direction and lines", hint: 'Use: copy-scroll <%N> up|down <N>' }
  }

  const target = parseTarget(tokens[0]!)
  const direction = tokens[1]!.toLowerCase()
  if (direction !== "up" && direction !== "down") {
    return { ok: false, error: `Invalid scroll direction: "${direction}"`, hint: "Use: up or down" }
  }

  const lines = parseInt(tokens[2]!, 10)
  if (isNaN(lines) || lines <= 0) {
    return { ok: false, error: `Invalid line count: "${tokens[2]}"`, hint: "Lines must be a positive integer" }
  }

  return { ok: true, ast: { kind: "copy-scroll", target, direction, lines } }
}

/**
 * 解析 send-keys 命令。
 *
 * 格式: send-keys <target> <keys> [-l]
 */
function parseSendKeys(tokens: string[]): TmuxCommandParseResult {
  if (tokens.length < 2) {
    return { ok: false, error: "send-keys requires target and keys", hint: 'Use: send-keys <target> <keys> [-l]' }
  }

  const target = parseTarget(tokens[0]!)
  const literal = tokens[tokens.length - 1] === "-l"

  // keys 是除 target 和可选 -l 之外的所有 token
  const keysEnd = literal ? tokens.length - 1 : tokens.length
  const keys = tokens.slice(1, keysEnd).join(" ")

  if (!keys) {
    return { ok: false, error: "send-keys requires keys after target", hint: 'Use: send-keys <target> <keys> [-l]' }
  }

  return { ok: true, ast: { kind: "send-keys", target, keys, literal } }
}

/**
 * 解析 paste 命令。
 *
 * 格式: paste <target> <text...>
 */
function parsePaste(tokens: string[]): TmuxCommandParseResult {
  if (tokens.length < 2) {
    return { ok: false, error: "paste requires target and text", hint: 'Use: paste <target> <text>' }
  }

  const target = parseTarget(tokens[0]!)
  const text = tokens.slice(1).join(" ")

  return { ok: true, ast: { kind: "paste", target, text } }
}

// ============================================================
// 6. 主解析函数
// ============================================================

/** 命令 kind 分发表 */
const COMMAND_DISPATCH: Record<string, (tokens: string[]) => TmuxCommandParseResult> = {
  list: parseList,
  search: parseSearch,
  attach: parseAttach,
  new: parseNew,
  kill: parseKill,
  rename: parseRename,
  select: parseSelect,
  resize: parseResize,
  "copy-mode": parseCopyMode,
  "copy-scroll": parseCopyScroll,
  "send-keys": parseSendKeys,
  paste: parsePaste,
}

/**
 * 解析 tmux 命令 DSL 字符串为 AST。
 *
 * 解析流程：
 * 1. 安全校验 (注入检测)
 * 2. 按空格分词
 * 3. 第一个 token 确定 command kind
 * 4. 按位置 + 关键字解析 target 和选项
 * 5. 返回结构化 AST 或错误
 *
 * 安全：
 * - 拒绝分号注入（"list sessions; kill session dev"）
 * - 拒绝换行注入
 * - 拒绝反引号注入
 * - 拒绝 $() 子shell
 * - 拒绝管道 |
 * - 拒绝重定向 > >>
 *
 * @param input - Agent 输入的自然语言命令字符串
 * @returns 解析结果：成功返回 AST，失败返回错误信息
 */
export function parseTmuxCommand(input: string): TmuxCommandParseResult {
  // 空输入检查
  const trimmed = input.trim()
  if (!trimmed) {
    return { ok: false, error: "Empty command" }
  }

  // 安全校验
  if (containsInjection(trimmed)) {
    return { ok: false, error: "Command contains disallowed characters", hint: "Semicolons, pipes, redirects, backticks, $() and newlines are not allowed" }
  }

  // 分词：按空格分割，多个连续空格视为一个分隔符
  const tokens = trimmed.split(/\s+/)
  if (tokens.length === 0 || !tokens[0]) {
    return { ok: false, error: "Empty command" }
  }

  // 特殊命令：show-info（无参数）
  if (tokens[0]!.toLowerCase() === "show-info") {
    return { ok: true, ast: { kind: "show-info" } }
  }

  // 处理 copy-mode / copy-scroll（带连字符的命令）
  // tokens[0] 可能是 "copy-mode" 或 "copy"，tokens[1] 可能是 "mode" 或 "scroll"
  let command = tokens[0]!.toLowerCase()
  let argsStart = 1

  // 合并 "copy mode" → "copy-mode"，"copy scroll" → "copy-scroll"
  if (command === "copy" && tokens.length > 1) {
    const sub = tokens[1]!.toLowerCase()
    if (sub === "mode") {
      command = "copy-mode"
      argsStart = 2
    } else if (sub === "scroll") {
      command = "copy-scroll"
      argsStart = 2
    }
  }

  // 合并 "send keys" → "send-keys"
  if (command === "send" && tokens.length > 1 && tokens[1]!.toLowerCase() === "keys") {
    command = "send-keys"
    argsStart = 2
  }

  // 查找分发函数
  const dispatchFn = COMMAND_DISPATCH[command]
  if (!dispatchFn) {
    return { ok: false, error: `Unknown command: "${command}"`, hint: "Valid commands: list, search, attach, new, kill, rename, select, resize, copy-mode, copy-scroll, send-keys, paste, show-info" }
  }

  return dispatchFn(tokens.slice(argsStart))
}
