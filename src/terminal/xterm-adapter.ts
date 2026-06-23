/**
 * @xterm/headless 适配器
 *
 * 该类只负责把 PTY 原始输出喂给 xterm parser，并从 xterm 的公开
 * buffer API 中读取当前屏幕状态。上层 NativePtyProvider 不应直接持有
 * xterm 的 line/cell 引用，避免终端异步更新后出现悬空状态。
 */

import xtermModule from "@xterm/headless"
import type { IDisposable, ITerminalAddon } from "@xterm/headless"

import { TerminalUseError } from "./errors.js"

/** @xterm/headless 在 Node ESM 下只暴露 default export，Terminal 在 default 内部 */
const TerminalCtor = xtermModule.Terminal
type TerminalInstance = InstanceType<typeof TerminalCtor>
type Unicode11AddonInstance = InstanceType<typeof import("@xterm/addon-unicode11").Unicode11Addon>

import type { Highlight, TerminalSnapshotMode } from "./terminal-snapshot.js"

type ScreenLine = { text: string; hasContent: boolean }

type ScreenReadRange = { start: number; end: number }

type ScreenReadResult = {
  lines: ScreenLine[]
  cursor: { x: number; y: number }
  cols: number
  rows: number
  scrollbackLineCount: number
  isAltBuffer: boolean
  title: string | undefined
}

type HighlightKind = Highlight["kind"]

/** xterm cell 的高亮检测结果。 */
type CellHighlightKind = Exclude<HighlightKind, "selection" | "unknown"> | undefined

type ActiveHighlightKind = Exclude<CellHighlightKind, undefined>

type HighlightSpan = { kind: ActiveHighlightKind; colStart: number; colEnd: number }

export class XtermAdapter {
  /** @xterm/headless Terminal 实例 */
  private terminal: TerminalInstance
  /** 脏标记: 自上次 snapshot 后是否有新数据写入 */
  private dirty: boolean
  /** 最后写入数据的时间戳 */
  private lastWriteAt: number
  /** 终端标题 (OSC 0/2) */
  private title: string | undefined
  /** onWriteParsed 回调的 Promise resolve 队列 */
  private writeParsedResolvers: Array<() => void>

  /** 事件订阅句柄，dispose 时统一释放。 */
  private readonly disposables: IDisposable[]
  /** dispose 期间用于阻止异步 addon import 回来后继续加载到已销毁终端。 */
  private disposed: boolean
  /** Unicode addon 句柄，dispose 时主动释放，避免 fire-and-forget 加载造成生命周期泄漏。 */
  private unicodeAddon: Unicode11AddonInstance | null

  constructor(cols: number, rows: number, scrollback?: number) {
    this.terminal = new TerminalCtor({
      cols,
      rows,
      scrollback: scrollback ?? 5000,
      allowProposedApi: true,
    })
    this.dirty = false
    this.lastWriteAt = 0
    this.title = undefined
    this.writeParsedResolvers = []
    this.disposables = []
    this.disposed = false
    this.unicodeAddon = null

    // onWriteParsed 只注册一次。xterm 可能把多次 write 合并到同一帧解析，
    // 因此一次事件到达时释放当前等待队列，避免后续 Promise 永久挂起。
    this.disposables.push(
      this.terminal.onWriteParsed(() => {
        const resolvers = this.writeParsedResolvers.splice(0)
        for (const resolve of resolvers) {
          resolve()
        }
      }),
    )

    // OSC 0 / OSC 2 标题变化由 xterm parser 统一处理。
    this.disposables.push(
      this.terminal.onTitleChange((newTitle: string) => {
        this.title = newTitle
      }),
    )

    // Unicode11Addon 对 CJK/emoji 宽度更友好，但它不是硬依赖；加载失败
    // 不影响终端基础解析能力。构造函数不能 await，因此异步 best-effort。
    void this.loadUnicode11Addon()
  }

  /** 写入 PTY 输出数据到 xterm */
  write(data: string | Uint8Array): Promise<void> {
    const parsed = this.waitForParse()
    this.terminal.write(data)
    this.dirty = true
    this.lastWriteAt = Date.now()
    return parsed
  }

  /** 等待 xterm 解析完所有待处理数据 */
  private waitForParse(): Promise<void> {
    return new Promise((resolve) => {
      this.writeParsedResolvers.push(resolve)
    })
  }

  /** 读取当前屏幕缓冲区；viewport 只取可视窗口，full 才取完整 scrollback。
   *  dispose 后调用将抛出 TerminalUseError，防止调用方误用已销毁的终端数据。 */
  readScreen(mode: TerminalSnapshotMode = "viewport"): ScreenReadResult {
    if (this.disposed) {
      throw new TerminalUseError({
        code: "INTERNAL_ERROR",
        message: "Cannot read screen from disposed XtermAdapter",
        retryable: false,
        hint: "The terminal session has been killed; start a new session",
      })
    }
    const buffer = this.terminal.buffer.active
    const range = this.getScreenReadRange(buffer, mode)
    const lines: ScreenLine[] = []

    for (let y = range.start; y < range.end; y += 1) {
      const line = buffer.getLine(y)
      if (!line) {
        continue
      }

      // getLine 返回值立即转换为字符串，不把 line 引用传递到函数外。
      const text = line.translateToString(true)
      lines.push({ text, hasContent: text.trim().length > 0 })
    }

    return {
      lines,
      cursor: { x: buffer.cursorX, y: buffer.cursorY },
      cols: this.terminal.cols,
      rows: this.terminal.rows,
      scrollbackLineCount: this.countScrollbackLines(buffer),
      isAltBuffer: this.terminal.buffer.active === this.terminal.buffer.alternate,
      title: this.title,
    }
  }

  /** 检测屏幕高亮区域；行号必须与 readScreen(mode) 返回的 screen 行号保持一致。
   *  dispose 后调用将抛出 TerminalUseError。 */
  detectHighlights(mode: TerminalSnapshotMode = "viewport"): Highlight[] {
    if (this.disposed) {
      throw new TerminalUseError({
        code: "INTERNAL_ERROR",
        message: "Cannot detect highlights from disposed XtermAdapter",
        retryable: false,
        hint: "The terminal session has been killed; start a new session",
      })
    }
    const buffer = this.terminal.buffer.active
    const range = this.getScreenReadRange(buffer, mode)
    const highlights: Highlight[] = []

    for (let row = range.start; row < range.end; row += 1) {
      const line = buffer.getLine(row)
      if (!line) {
        continue
      }

      const snapshotRow = row - range.start

      let span: HighlightSpan | undefined

      for (let col = 0; col < line.length; col += 1) {
        const cell = line.getCell(col)
        if (!cell) {
          span = this.flushHighlightSpan(highlights, line, snapshotRow, span)
          continue
        }

        // 宽字符的后续占位 cell(width=0) 不单独生成高亮，避免重复列。
        const width = Math.max(cell.getWidth(), 1)
        const kind = this.detectCellHighlightKind(cell.isInverse(), cell.isBold(), cell.getFgColor())

        if (!kind) {
          span = this.flushHighlightSpan(highlights, line, snapshotRow, span)
          continue
        }

        const colEnd = col + width
        if (span && span.kind === kind && span.colEnd === col) {
          span.colEnd = colEnd
          continue
        }

        span = this.flushHighlightSpan(highlights, line, snapshotRow, span)
        span = { kind, colStart: col, colEnd }
      }

      this.flushHighlightSpan(highlights, line, snapshotRow, span)
    }

    return highlights
  }

  /** 调整终端尺寸 */
  resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows)
  }

  /** 检查自 lastSnapshotTime 后是否有新数据 */
  isDirty(): boolean {
    return this.dirty
  }

  /** 获取最后写入时间戳 (ms) */
  getLastWriteAt(): number {
    return this.lastWriteAt
  }

  /** 快速检测当前是否处于 alt buffer（全屏 TUI），无需完整 readScreen()。 */
  isAltBufferActive(): boolean {
    if (this.disposed) return false
    return this.terminal.buffer.active === this.terminal.buffer.alternate
  }

  /** 获取终端标题 */
  getTitle(): string | undefined {
    return this.title
  }

  /** 重置脏标记 (snapshot 后调用) */
  markClean(): void {
    this.dirty = false
  }

  /** 销毁 Terminal 实例 */
  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true

    // 释放仍在等待的 write Promise，避免调用方因 session 关闭永久等待。
    const resolvers = this.writeParsedResolvers.splice(0)
    for (const resolve of resolvers) {
      resolve()
    }

    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose()
    }

    if (this.unicodeAddon !== null) {
      this.unicodeAddon.dispose()
      this.unicodeAddon = null
    }
    this.terminal.dispose()
  }

  /** 尝试加载 Unicode 11 宽度规则；失败时静默降级到 xterm 默认规则。 */
  private async loadUnicode11Addon(): Promise<void> {
    if (this.disposed) {
      return
    }

    try {
      const { Unicode11Addon } = await import("@xterm/addon-unicode11")
      if (this.disposed) {
        return
      }
      const addon = new Unicode11Addon()
      this.terminal.loadAddon(addon as unknown as ITerminalAddon)
      this.unicodeAddon = addon
      this.terminal.unicode.activeVersion = "11"
    } catch {
      // best-effort：缺失 addon 或运行时不兼容都不阻断 terminal-use-mcp。
      return
    }
  }

  private getScreenReadRange(buffer: TerminalInstance["buffer"]["active"], mode: TerminalSnapshotMode): ScreenReadRange {
    if (mode === "full") {
      return { start: 0, end: buffer.length }
    }

    // viewportY 是 xterm 公开的“当前视口顶部行”。当用户或程序滚动时，
    // 它不一定等于 bottom rows 的起点；因此 viewport 模式必须以 viewportY 为准，
    // 只返回 agent 当前真实可见的 rows 行，避免默认 snapshot 携带大量 scrollback。
    const start = Math.max(0, Math.min(buffer.viewportY, buffer.length))
    const end = Math.min(buffer.length, start + this.terminal.rows)
    return { start, end }
  }

  private countScrollbackLines(buffer: TerminalInstance["buffer"]["active"]): number {
    return Math.max(0, buffer.length - this.terminal.rows)
  }

  /** 将 xterm cell 属性映射为工具层高亮类别。 */
  private detectCellHighlightKind(isInverse: number, isBold: number, fgColor: number): CellHighlightKind {
    if (isInverse !== 0) {
      return "inverse"
    }
    if (isBold !== 0 && fgColor !== 0) {
      return "active"
    }
    return undefined
  }

  /** 结束当前连续高亮片段，并把文本快照写入结果数组。 */
  private flushHighlightSpan(
    highlights: Highlight[],
    line: { translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string },
    row: number,
    span: HighlightSpan | undefined,
  ): undefined {
    if (!span) {
      return undefined
    }

    highlights.push({
      row,
      colStart: span.colStart,
      colEnd: span.colEnd,
      text: line.translateToString(false, span.colStart, span.colEnd),
      kind: span.kind,
    })
    return undefined
  }
}
