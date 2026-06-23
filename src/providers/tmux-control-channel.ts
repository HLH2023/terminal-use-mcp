/**
 * tmux -C 控制通道协议解析器。
 *
 * 管理与 tmux control mode 的持久连接：
 * - 解析 tmux 输出的 % 通知（%begin/%end/%error/%output 等）
 * - 通过 FIFO 顺序匹配请求和响应（tmux 命令编号在 parse error 时不递增，不可靠）
 * - 发射布局/窗口/session 变化事件
 *
 * tmux control mode 协议规范（tmux 3.2+，tmux 3.4 验证）：
 * - %begin <timestamp> <last-fd-mtime> <n>    命令开始
 * - %end <timestamp> <last-fd-mtime> <n> <code> 命令成功结束
 * - %error <timestamp> <last-fd-mtime> <n> <msg> 命令错误
 * - %output <pane> <text>                     pane 输出
 * - %extended-output <pane> <text>            扩展 pane 输出
 * - %layout-change <win> <info>               布局变化
 * - %window-add <win>                         窗口新增
 * - %window-close <win>                       窗口关闭
 * - %window-renamed <win> <name>              窗口重命名
 * - %window-pane-changed <win> <pane>         窗口活动 pane 变化
 * - %session-changed <sess> <name>            session 变化
 * - %session-window-changed <sess> <win>     session 活动窗口变化
 * - %sessions-changed                        session 列表变化
 * - %client-detached                         客户端断开
 * - %exit [<reason>]                         退出
 * - %message <text>                          消息
 * - %pause                                   暂停
 * - %continue                                继续
 *
 * 重要：即使 control channel 使用 no-output flag，
 * 也要兼容 %output 和 %extended-output，防止某些版本或配置仍输出。
 *
 * 命令编号匹配策略（FIFO）：
 * tmux 在 parse error 时不递增命令编号计数器，
 * 导致我们的 nextCommandNumber 与 tmux 的内部编号不同步。
 * 因此采用 FIFO 队列：%begin/%end/%error 按到达顺序
 * 匹配最早入队的 pending command。
 */

import { spawn, type ChildProcess } from "node:child_process"
import { logger } from "../logger.js"
import { TmuxControlError } from "../terminal/errors.js"
import type { ControlSpawnResult } from "./tmux-transport.js"

/**
 * 判断 tmux 命令参数是否需要引号包裹。
 *
 * tmux 控制模式命令解析器与 shell 类似：空格、单引号、双引号、
 * 分号、管道等特殊字符会被解析为分隔符或操作符。
 * 仅包含"安全"字符的参数不需要引号。
 *
 * 安全字符：字母、数字、._-/:@%+#^!~ 和方括号。
 * 所有其他字符（空格、引号、分号等）触发引号包裹。
 */
function needsTmuxQuoting(arg: string): boolean {
  return !/^[a-zA-Z0-9._\-/:@%+#^!~\[\]]+$/.test(arg)
}

/**
 * 对 tmux 命令参数进行引号包裹。
 *
 * - 不需要引号的参数原样返回
 * - 需要引号的参数用单引号包裹，内部单引号用 `'\''` 转义
 *
 * 例如：
 * - `%3` → `%3`（安全字符，无需引号）
 * - `echo hello` → `'echo hello'`（含空格，需要引号）
 * - `it's` → `'it'\''s'`（含单引号，需要转义）
 */
export function quoteTmuxArg(arg: string): string {
  if (!needsTmuxQuoting(arg)) return arg
  // 单引号内所有字符为字面量，用 `'\''` 模式转义内部单引号
  return `'${arg.replace(/'/g, "'\\''")}'`
}

// ─── 常量 ─────────────────────────────────────────────────────────────────────

/** 命令执行超时（ms） */
const COMMAND_TIMEOUT_MS = 10_000

/** 启动就绪超时（ms） */
const START_READY_TIMEOUT_MS = 5_000

// ─── 通知消息类型 ─────────────────────────────────────────────────────────────

/** tmux -C 控制通道通知消息类型 */
export type TmuxControlNotification =
  | { type: "begin"; commandNumber: number }
  | { type: "end"; commandNumber: number; exitCode: number }
  | { type: "error"; commandNumber: number; message: string }
  | { type: "output"; paneId: string; text: string }
  | { type: "extended-output"; paneId: string; text: string }
  | { type: "layout-change"; windowId: string; layoutInfo: string }
  | { type: "window-add"; windowId: string }
  | { type: "window-close"; windowId: string }
  | { type: "window-renamed"; windowId: string; newName: string }
  | { type: "window-pane-changed"; windowId: string; paneId: string }
  | { type: "session-changed"; sessionId: string; sessionName: string }
  | { type: "session-window-changed"; sessionId: string; windowId: string }
  | { type: "sessions-changed" }
  | { type: "client-detached" }
  | { type: "exit"; reason?: string }
  | { type: "message"; text: string }
  | { type: "pause" }
  | { type: "continue" }
  | { type: "unknown"; raw: string }

// ─── 执行结果类型 ─────────────────────────────────────────────────────────────

/** 控制通道命令执行结果 */
export type TmuxControlResponse = {
  /** 是否成功 */
  ok: boolean
  /** 退出码（%end 时为 0，%error 时非 0） */
  exitCode: number
  /** %begin 和 %end 之间的输出行 */
  output: string[]
  /** 错误消息（%error 时有值） */
  errorMessage?: string
  /** 命令编号 */
  commandNumber: number
}

export interface TmuxControlChannelLike {
  start(spawnArgs: ControlSpawnResult): Promise<void>
  execute(args: string[]): Promise<TmuxControlResponse>
  onNotification(handler: (notification: TmuxControlNotification) => void): void
  close(): void
  isConnected(): boolean
}

// ─── Pending command 内部类型 ─────────────────────────────────────────────────

/** 等待响应的命令条目 */
type PendingCommand = {
  resolve: (response: TmuxControlResponse) => void
  reject: (error: Error) => void
  /** %begin 和 %end 之间收集的输出行 */
  output: string[]
  /** 超时定时器 ID */
  timer: ReturnType<typeof setTimeout>
  /** 入队顺序 ID，用于超时时从队列中移除 */
  queueId: number
}

// ─── 辅助解析函数 ─────────────────────────────────────────────────────────────

/**
 * 安全解析 %begin/%end/%error 的 command number。
 *
 * tmux -C 协议格式（tmux 3.2+）：
 *   %begin <timestamp> <last-fd-mtime> <command-number>
 *   %end <timestamp> <last-fd-mtime> <command-number> <exit-code>
 *   %error <timestamp> <last-fd-mtime> <command-number> <message...>
 *
 * parts = content.split(" ") 后：
 *   parts[0] = 通知类型（如 "begin"/"end"/"error"）
 *   parts[1] = timestamp
 *   parts[2] = last-fd-mtime
 *   parts[3] = command number
 *
 * @param parts - 通知行按空格分割后的部分（不含前导 %）
 * @returns command number，解析失败返回 null
 */
function parseCommandNumber(parts: string[]): number | null {
  if (parts.length < 4) return null
  const n = Number.parseInt(parts[3], 10)
  return Number.isNaN(n) ? null : n
}

/**
 * 解析 tmux -C 通知行。
 *
 * 将以 % 开头的行解析为结构化的通知对象。
 * 无法识别的通知类型返回 `{ type: "unknown", raw }`。
 * 非 % 开头的行返回 null。
 *
 * @param line - 已 trim 的一行 tmux 输出
 * @returns 通知对象，或 null（非通知行）
 */
function parseNotificationLine(line: string): TmuxControlNotification | null {
  if (!line.startsWith("%")) return null

  // 去掉前导 %，按空格分割
  const content = line.slice(1)
  const spaceIdx = content.indexOf(" ")

  // 无参数的通知（如 %sessions-changed、%client-detached、%pause、%continue）
  if (spaceIdx === -1) {
    const tag = content
    switch (tag) {
      case "sessions-changed":
        return { type: "sessions-changed" }
      case "client-detached":
        return { type: "client-detached" }
      case "pause":
        return { type: "pause" }
      case "continue":
        return { type: "continue" }
      default:
        // %exit 可能无参数
        if (tag === "exit") return { type: "exit" }
        return { type: "unknown", raw: line }
    }
  }

  const tag = content.slice(0, spaceIdx)
  const rest = content.slice(spaceIdx + 1)
  const parts = content.split(" ")

  switch (tag) {
    case "begin": {
      const commandNumber = parseCommandNumber(parts)
      if (commandNumber === null) return { type: "unknown", raw: line }
      return { type: "begin", commandNumber }
    }

    case "end": {
      // %end <timestamp> <last-fd-mtime> <command-number> <exit-code>
      const commandNumber = parseCommandNumber(parts)
      if (commandNumber === null) return { type: "unknown", raw: line }
      const exitCode = parts.length >= 5 ? Number.parseInt(parts[4], 10) : 0
      return { type: "end", commandNumber, exitCode: Number.isNaN(exitCode) ? 0 : exitCode }
    }

    case "error": {
      // %error <timestamp> <last-fd-mtime> <command-number> <message...>
      const commandNumber = parseCommandNumber(parts)
      if (commandNumber === null) return { type: "unknown", raw: line }
      // 消息从 parts[4] 开始，可能包含空格
      const message = parts.length >= 5 ? parts.slice(4).join(" ") : ""
      return { type: "error", commandNumber, message }
    }

    case "output": {
      // %output <pane_id> <text...>
      const paneId = parts[1]
      if (paneId === undefined) return { type: "unknown", raw: line }
      // text 可能包含空格
      const textStart = rest.indexOf(" ") + 1
      const text = textStart > 0 ? rest.slice(textStart) : ""
      return { type: "output", paneId, text }
    }

    case "extended-output": {
      // %extended-output <pane_id> <text...>
      const paneId = parts[1]
      if (paneId === undefined) return { type: "unknown", raw: line }
      const textStart = rest.indexOf(" ") + 1
      const text = textStart > 0 ? rest.slice(textStart) : ""
      return { type: "extended-output", paneId, text }
    }

    case "layout-change": {
      // %layout-change <window_id> <layout_info...>
      const windowId = parts[1]
      if (windowId === undefined) return { type: "unknown", raw: line }
      const layoutStart = rest.indexOf(" ") + 1
      const layoutInfo = layoutStart > 0 ? rest.slice(layoutStart) : ""
      return { type: "layout-change", windowId, layoutInfo }
    }

    case "window-add": {
      // %window-add <window_id>
      const windowId = parts[1]
      if (windowId === undefined) return { type: "unknown", raw: line }
      return { type: "window-add", windowId }
    }

    case "window-close": {
      // %window-close <window_id>
      const windowId = parts[1]
      if (windowId === undefined) return { type: "unknown", raw: line }
      return { type: "window-close", windowId }
    }

    case "window-renamed": {
      // %window-renamed <window_id> <new_name>
      const windowId = parts[1]
      if (windowId === undefined) return { type: "unknown", raw: line }
      const nameStart = rest.indexOf(" ") + 1
      const newName = nameStart > 0 ? rest.slice(nameStart) : ""
      return { type: "window-renamed", windowId, newName }
    }

    case "window-pane-changed": {
      // %window-pane-changed <window_id> <pane_id>
      const windowId = parts[1]
      const paneId = parts[2]
      if (windowId === undefined || paneId === undefined) return { type: "unknown", raw: line }
      return { type: "window-pane-changed", windowId, paneId }
    }

    case "session-changed": {
      // %session-changed <session_id> <session_name>
      const sessionId = parts[1]
      if (sessionId === undefined) return { type: "unknown", raw: line }
      const nameStart = rest.indexOf(" ") + 1
      const sessionName = nameStart > 0 ? rest.slice(nameStart) : ""
      return { type: "session-changed", sessionId, sessionName }
    }

    case "session-window-changed": {
      // %session-window-changed <session_id> <window_id>
      const sessionId = parts[1]
      const windowId = parts[2]
      if (sessionId === undefined || windowId === undefined) return { type: "unknown", raw: line }
      return { type: "session-window-changed", sessionId, windowId }
    }

    case "exit": {
      // %exit [<reason>]
      return { type: "exit", reason: rest || undefined }
    }

    case "message": {
      // %message <text...>
      return { type: "message", text: rest }
    }

    default:
      return { type: "unknown", raw: line }
  }
}

// ─── TmuxControlChannel ───────────────────────────────────────────────────────

/**
 * tmux -C 控制通道客户端。
 *
 * 管理与 tmux control mode 的持久连接：
 * - 解析 tmux 输出的 % 通知
 * - 通过 command number 关联请求和响应
 * - 发射布局/窗口/session 变化事件
 *
 * 使用方式：
 * 1. 调用 start() 启动 control channel 子进程
 * 2. 调用 execute() 发送命令并等待响应
 * 3. 通过 onNotification() 订阅异步事件
 * 4. 使用完毕后调用 close() 清理资源
 */
export class TmuxControlChannel implements TmuxControlChannelLike {
  /** 底层 child process */
  private process: ChildProcess | null = null

  /** 行缓冲（tmux 输出可能跨多个 onData chunk） */
  private lineBuffer = ""

  /** 自增队列 ID，用于超时时从 FIFO 队列中定位条目 */
  private nextQueueId = 1

  /** 等待响应的命令 FIFO 队列（按入队顺序匹配 %begin/%end/%error） */
  private pendingQueue: PendingCommand[] = []

  /** 当前活跃的 pending command（在 %begin 和 %end/%error 之间，收集 output） */
  private activePending: PendingCommand | null = null

  /** 事件处理器 */
  private eventHandlers = new Set<(notification: TmuxControlNotification) => void>()

  /** 是否已连接 */
  private connected = false

  /**
   * control channel 保活定时器。
   *
   * tmux -C 在空闲约 20 秒后可能主动发送 %exit，定期 refresh-client
   * 可以保持客户端活跃。此定时器不参与命令 FIFO 队列，避免污染正常响应匹配。
   */
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null

  /** keepalive 间隔：10 秒，低于 tmux -C 约 20 秒的空闲退出窗口 */
  private keepaliveIntervalMs = 10_000

  /** 启动 Promise 的 resolve 回调 */
  private startResolve: (() => void) | null = null

  /** 启动 Promise 的 reject 回调 */
  private startReject: ((error: Error) => void) | null = null

  /**
   * 启动控制通道。
   *
   * 使用 TmuxTransport.getControlSpawnArgs() 返回的参数 spawn 子进程，
   * 建立与 tmux control mode 的连接。
   *
   * @param spawnArgs - 来自 TmuxTransport.getControlSpawnArgs() 的结果
   * @throws TmuxControlError 如果进程启动失败
   */
  async start(spawnArgs: ControlSpawnResult): Promise<void> {
    if (this.connected) {
      throw new TmuxControlError("Control channel already started")
    }

    const child = spawn(spawnArgs.command, spawnArgs.args, {
      stdio: ["pipe", "pipe", "pipe"],
      ...spawnArgs.options,
    })

    // 检查 stdio 是否成功创建
    if (child.stdin === null || child.stdout === null || child.stderr === null) {
      child.kill()
      throw new TmuxControlError("Failed to create stdio pipes for tmux -C process")
    }

    this.process = child

    // 监听 stdout 数据
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8")
      this.handleData(text)
    })

    // 监听 stderr（tmux 偶尔输出警告到 stderr）
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8").trim()
      if (text.length > 0) {
        this.emitNotification({ type: "message", text })
      }
    })

    // 监听进程退出
    child.on("exit", (code: number | null, signal: string | null) => {
      this.handleProcessExit(code, signal)
    })

    // 监听进程错误
    child.on("error", (err: Error) => {
      this.handleProcessError(err)
    })

    // 等待进程就绪（收到首个通知或短暂等待）
    await new Promise<void>((resolve, reject) => {
      this.startResolve = resolve
      this.startReject = reject

      // 超时保护：如果 tmux -C 正常启动，会很快有输出
      // 某些场景下 tmux -C attach 后不立即输出，超时后只要进程活着就认为就绪
      const timer = setTimeout(() => {
        if (this.process !== null && !this.connected) {
          resolve()
        }
      }, START_READY_TIMEOUT_MS)

      // 包装 resolve/reject 以清理 timer
      const originalResolve = resolve
      const originalReject = reject
      this.startResolve = () => {
        clearTimeout(timer)
        originalResolve()
      }
      this.startReject = (err: Error) => {
        clearTimeout(timer)
        originalReject(err)
      }
    })

    this.connected = true

    // 如果在 await 期间收到 %exit，parseLine 已经将 connected 设为 false，
    // 但本行的 this.connected = true 会覆盖它。需要再次检查进程状态。
    if (this.process === null || this.process.exitCode !== null || this.process.signalCode !== null) {
      this.connected = false
      throw new TmuxControlError("Control channel process exited during startup")
    }

    this.startKeepalive()
  }

  /**
   * 执行 tmux 命令并等待响应。
   *
   * 通过 stdin 发送命令，等待 %begin/%end 或 %error 配对。
   * 命令编号自动递增，用于关联请求和响应。
   *
   * @param args - tmux 命令参数（如 ["send-keys", "-t", "%3", "C-c"]）
   * @returns 命令执行结果
   * @throws TmuxControlError 如果通道未连接或命令超时
   */
  async execute(args: string[]): Promise<TmuxControlResponse> {
    if (!this.connected || this.process === null || this.process.stdin === null) {
      throw new TmuxControlError("Control channel not connected")
    }

    const command = args.map(quoteTmuxArg).join(" ")

    // 防御：tmux -C 协议用换行符分隔命令，参数中不能包含 0x0A/0x0D。
    // 否则 tmux 会将其解释为命令分隔符，产生空行导致 %exit。
    if (command.includes("\n") || command.includes("\r")) {
      throw new TmuxControlError(
        "Control channel command must not contain newline characters (0x0A/0x0D). "
        + "Split multi-line input into separate send-keys commands at the TmuxCore layer.",
        { details: { args, commandPreview: command.substring(0, 100) } },
      )
    }

    const queueId = this.nextQueueId++

    return new Promise<TmuxControlResponse>((resolve, reject) => {
      const pending: PendingCommand = { resolve, reject, output: [], timer: null as unknown as ReturnType<typeof setTimeout>, queueId }

      // 超时保护
      pending.timer = setTimeout(() => {
        const idx = this.pendingQueue.findIndex(p => p.queueId === queueId)
        if (idx !== -1) {
          this.pendingQueue.splice(idx, 1)
          reject(new TmuxControlError(
            `Command timeout: ${command}`,
            { details: { queueId, args } },
          ))
        }
      }, COMMAND_TIMEOUT_MS)

      this.pendingQueue.push(pending)

      try {
        this.process!.stdin!.write(`${command}\n`)
      } catch (err) {
        clearTimeout(pending.timer)
        const idx = this.pendingQueue.findIndex(p => p.queueId === queueId)
        if (idx !== -1) this.pendingQueue.splice(idx, 1)
        throw new TmuxControlError(
          `Failed to write command to tmux -C stdin`,
          { details: { queueId, args, error: err } },
        )
      }
    })
  }

  /**
   * 订阅控制通道事件通知。
   *
   * 通知类型包括：
   * - layout-change: 布局变化
   * - window-add/close/renamed: 窗口生命周期
   * - session-changed: session 变化
   * - output/extended-output: pane 输出（即使 no-output flag 也可能收到）
   * - client-detached/exit: 连接状态
   *
   * @param handler - 通知处理回调
   */
  onNotification(handler: (notification: TmuxControlNotification) => void): void {
    this.eventHandlers.add(handler)
  }

  /**
   * 取消订阅事件通知。
   *
   * @param handler - 之前通过 onNotification 注册的回调
   */
  offNotification(handler: (notification: TmuxControlNotification) => void): void {
    this.eventHandlers.delete(handler)
  }

  /**
   * 关闭控制通道。
   *
   * 关闭 stdin，杀死进程，清理所有 pending commands。
   * 可安全重复调用。
   */
  close(): void {
    this.stopKeepalive()

    if (!this.connected && this.process === null) return
    this.connected = false

    // 关闭 stdin，通知 tmux 退出
    try {
      this.process?.stdin?.end()
    } catch {
      // stdin 可能已关闭
    }

    // 杀死子进程
    try {
      this.process?.kill()
    } catch {
      // 进程可能已退出
    }

    this.rejectAllPending(new TmuxControlError("Control channel closed"))
    this.process = null

    // 清理启动 Promise（如果还在等待）
    this.startReject?.(new TmuxControlError("Control channel closed during startup"))
    this.startResolve = null
    this.startReject = null
  }

  /**
   * 是否已连接。
   *
   * @returns true 表示控制通道正在运行
   */
  isConnected(): boolean {
    return this.connected
  }

  // ─── 内部方法 ─────────────────────────────────────────────────────────────

  /**
   * 启动 control channel keepalive。
   *
   * refresh-client 是 tmux control mode 的轻量保活命令，不需要等待
   * %begin/%end 响应，因此直接写 stdin，不走 execute()，避免把保活命令加入
   * pendingQueue 后干扰业务命令的 FIFO 匹配顺序。
   */
  private startKeepalive(): void {
    if (this.keepaliveTimer !== null) return

    this.keepaliveTimer = setInterval(() => {
      const child = this.process

      // 进程或 stdin 已不存在/不可写时直接跳过本轮。
      // close()/exit/error 会负责停止定时器，这里只做额外防御，避免保活影响主流程。
      if (
        child === null
        || child.stdin === null
        || child.stdin.destroyed
        || child.stdin.writableEnded
        || !child.stdin.writable
      ) {
        return
      }

      try {
        child.stdin.write("refresh-client\n", (error?: Error | null) => {
          if (error === undefined || error === null) return

          // keepalive 失败只记录日志，不拒绝 pending command，也不改变连接状态。
          logger.warn("tmux -C keepalive refresh-client failed", { error: error.message })
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        // 写入失败同样只记录日志；后续 exit/error 事件会按原有流程清理连接。
        logger.warn("tmux -C keepalive refresh-client write failed", { error: message })
      }
    }, this.keepaliveIntervalMs)
  }

  /**
   * 停止 control channel keepalive。
   *
   * 该方法只负责清理 interval，不访问进程 stdin；因此即使进程已退出、stdin 已关闭
   * 或 close()/exit/error 重复触发，也可以安全重复调用。
   */
  private stopKeepalive(): void {
    if (this.keepaliveTimer === null) return

    clearInterval(this.keepaliveTimer)
    this.keepaliveTimer = null
  }

  /**
   * 处理 tmux stdout 的原始数据。
   *
   * 使用行缓冲策略：tmux 输出可能一次跨多个 chunk 到达，
   * 也可能一次包含多行。此方法将数据按 \n 分割为完整行，
   * 最后一行（不完整）保留在缓冲区等待下次拼接。
   *
   * @param data - stdout 原始文本 chunk
   */
  private handleData(data: string): void {
    this.lineBuffer += data

    // 按换行符分割，最后一个元素可能是不完整行
    const lines = this.lineBuffer.split("\n")
    this.lineBuffer = lines.pop() ?? ""

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      this.parseLine(trimmed)
    }
  }

  /**
   * 解析 tmux -C 输出的一行。
   *
   * 解析策略：
   * 1. 以 % 开头的行 → 解析为通知或命令边界标记
   * 2. 非 % 开头且在 %begin/%end 之间 → 追加到当前命令的 output
   *
   * %begin 和 %end 之间的行是命令输出，不属于通知。
   *
   * @param line - 已 trim 的一行 tmux 输出
   */
  private parseLine(line: string): void {
    // 非 % 开头的行：如果在命令输出范围内，追加到 activePending 的 output
    if (!line.startsWith("%")) {
      if (this.activePending !== null) {
        this.activePending.output.push(line)
      }
      return
    }

    const notification = parseNotificationLine(line)
    if (notification === null) return

    switch (notification.type) {
      case "begin": {
        // %begin 标记当前活跃命令，取 FIFO 队列头部作为此命令的 pending
        this.activePending = this.pendingQueue[0] ?? null
        break
      }

      case "end": {
        // FIFO 匹配：%end 对应队列头部（与 %begin 相同的条目）
        const pending = this.pendingQueue.shift()
        if (pending !== undefined) {
          clearTimeout(pending.timer)
          pending.resolve({
            ok: notification.exitCode === 0,
            exitCode: notification.exitCode,
            output: pending.output,
            commandNumber: notification.commandNumber,
          })
        }
        this.activePending = null
        break
      }

      case "error": {
        // FIFO 匹配：%error 对应队列头部
        const pending = this.pendingQueue.shift()
        if (pending !== undefined) {
          clearTimeout(pending.timer)
          pending.resolve({
            ok: false,
            exitCode: 1,
            output: pending.output,
            errorMessage: notification.message,
            commandNumber: notification.commandNumber,
          })
        }
        this.activePending = null
        break
      }

      case "exit": {
        this.connected = false
        this.rejectAllPending(new TmuxControlError(
          notification.reason !== undefined
            ? `Control channel exited: ${notification.reason}`
            : "Control channel exited",
        ))
        break
      }

      case "client-detached": {
        this.connected = false
        this.rejectAllPending(new TmuxControlError("Client detached from tmux session"))
        break
      }

      default:
        break
    }

    // 所有通知都发射给事件订阅者
    this.emitNotification(notification)

    // 收到第一个有效通知时标记启动完成
    this.startResolve?.()
    this.startResolve = null
    this.startReject = null
  }

  /**
   * 向所有事件订阅者发射通知。
   *
   * @param notification - 解析后的通知对象
   */
  private emitNotification(notification: TmuxControlNotification): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(notification)
      } catch {
        // 事件处理器不应影响主流程
      }
    }
  }

  /**
   * 拒绝所有 pending commands 并清理。
   *
   * 在通道关闭或断开时调用。
   *
   * @param error - 拒绝原因
   */
  private rejectAllPending(error: Error): void {
    for (const pending of this.pendingQueue) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pendingQueue = []
    this.activePending = null
  }

  /**
   * 处理子进程退出。
   */
  private handleProcessExit(code: number | null, signal: string | null): void {
    this.connected = false
    this.stopKeepalive()

    // Reject 所有等待中的命令
    this.rejectAllPending(new TmuxControlError(
      `tmux -C process exited (code=${code}, signal=${signal})`,
      { details: { code, signal } },
    ))

    this.process = null

    // 如果启动期间进程退出，reject 启动 Promise
    this.startReject?.(new TmuxControlError(
      `tmux -C process exited during startup (code=${code}, signal=${signal})`,
      { details: { code, signal } },
    ))
    this.startResolve = null
    this.startReject = null
  }

  /**
   * 处理子进程错误。
   */
  private handleProcessError(err: Error): void {
    this.connected = false
    this.stopKeepalive()

    // Reject 所有等待中的命令
    this.rejectAllPending(new TmuxControlError(
      `tmux -C process error: ${err.message}`,
      { details: { error: err.message } },
    ))

    this.process = null

    // 如果启动期间进程错误，reject 启动 Promise
    this.startReject?.(new TmuxControlError(
      `tmux -C process error during startup: ${err.message}`,
      { details: { error: err.message } },
    ))
    this.startResolve = null
    this.startReject = null
  }
}
