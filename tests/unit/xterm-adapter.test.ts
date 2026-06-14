import { describe, expect, it } from "vitest"

import { XtermAdapter } from "../../src/terminal/xterm-adapter.js"
import { TerminalUseError } from "../../src/terminal/errors.js"

// ============================================================
// readScreen — 屏幕读取
// ============================================================

describe("XtermAdapter.readScreen", () => {
  it("默认 viewport 只返回可见行，full 返回完整缓冲", async () => {
    const adapter = new XtermAdapter(20, 3, 10)

    try {
      await adapter.write("alpha\r\nbeta\r\ngamma\r\ndelta\r\nepsilon")

      const viewport = adapter.readScreen()
      const full = adapter.readScreen("full")

      expect(viewport.lines.length).toBeLessThanOrEqual(3)
      expect(full.lines.length).toBeGreaterThan(viewport.lines.length)
      expect(full.lines.some((line) => line.text.includes("alpha"))).toBe(true)
      expect(viewport.lines.some((line) => line.text.includes("alpha"))).toBe(false)
      expect(viewport.scrollbackLineCount).toBeGreaterThan(0)
      expect(full.scrollbackLineCount).toBe(viewport.scrollbackLineCount)
    } finally {
      adapter.dispose()
    }
  })
})

// ============================================================
// write + readScreen — 基本写入-读出往返
// ============================================================

describe("XtermAdapter.write + readScreen", () => {
  it("写入纯文本后能通过 readScreen 读出", async () => {
    const adapter = new XtermAdapter(40, 5, 0)

    try {
      await adapter.write("Hello World")

      const screen = adapter.readScreen()
      // 第一行应包含写入的文本
      expect(screen.lines.some((line) => line.text.includes("Hello World"))).toBe(true)
      expect(screen.cols).toBe(40)
      expect(screen.rows).toBe(5)
    } finally {
      adapter.dispose()
    }
  })

  it("写入多行后 readScreen 能逐行读出", async () => {
    const adapter = new XtermAdapter(40, 5, 0)

    try {
      await adapter.write("line1\r\nline2\r\nline3")

      const screen = adapter.readScreen()
      const texts = screen.lines.map((l) => l.text.trim()).filter(Boolean)
      expect(texts).toContain("line1")
      expect(texts).toContain("line2")
      expect(texts).toContain("line3")
    } finally {
      adapter.dispose()
    }
  })

  it("readScreen 返回的光标位置合理", async () => {
    const adapter = new XtermAdapter(40, 5, 0)

    try {
      await adapter.write("abc")

      const screen = adapter.readScreen()
      // 写入 "abc" 后光标应在第 3 列 (0-based)
      expect(screen.cursor.x).toBeGreaterThanOrEqual(3)
      expect(screen.cursor.y).toBeGreaterThanOrEqual(0)
    } finally {
      adapter.dispose()
    }
  })
})

// ============================================================
// detectHighlights — 高亮区域检测
// ============================================================

describe("XtermAdapter.detectHighlights", () => {
  it("普通文本无高亮区域", async () => {
    const adapter = new XtermAdapter(40, 5, 0)

    try {
      await adapter.write("plain text")

      const highlights = adapter.detectHighlights()
      expect(highlights).toEqual([])
    } finally {
      adapter.dispose()
    }
  })

  it("反色文本产生 inverse 高亮", async () => {
    const adapter = new XtermAdapter(40, 5, 0)

    try {
      // ESC[7m 开启反色, ESC[27m 关闭反色
      await adapter.write("normal\x1b[7mINVERTED\x1b[27m normal")

      const highlights = adapter.detectHighlights()
      // 应至少检测到一个 inverse 类型的 highlight
      expect(highlights.length).toBeGreaterThanOrEqual(1)
      const inverseHighlights = highlights.filter((h) => h.kind === "inverse")
      expect(inverseHighlights.length).toBeGreaterThanOrEqual(1)
      expect(inverseHighlights[0].text).toContain("INVERTED")
    } finally {
      adapter.dispose()
    }
  })

  it("高亮结构包含正确的行/列信息", async () => {
    const adapter = new XtermAdapter(40, 5, 0)

    try {
      await adapter.write("\x1b[7mHI\x1b[27m")

      const highlights = adapter.detectHighlights()
      expect(highlights.length).toBeGreaterThanOrEqual(1)
      const h = highlights[0]
      // 行号和列号应是非负整数
      expect(h.row).toBeGreaterThanOrEqual(0)
      expect(h.colStart).toBeGreaterThanOrEqual(0)
      expect(h.colEnd).toBeGreaterThan(h.colStart)
      expect(typeof h.text).toBe("string")
    } finally {
      adapter.dispose()
    }
  })
})

// ============================================================
// resize — 终端尺寸调整
// ============================================================

describe("XtermAdapter.resize", () => {
  it("resize 后 readScreen 返回新的维度", async () => {
    const adapter = new XtermAdapter(40, 5, 0)

    try {
      await adapter.write("test")
      adapter.resize(80, 24)

      const screen = adapter.readScreen()
      expect(screen.cols).toBe(80)
      expect(screen.rows).toBe(24)
    } finally {
      adapter.dispose()
    }
  })

  it("resize 为更小尺寸后内容仍可读", async () => {
    const adapter = new XtermAdapter(80, 24, 10)

    try {
      await adapter.write("A".repeat(60))
      adapter.resize(20, 3)

      const screen = adapter.readScreen()
      expect(screen.cols).toBe(20)
      expect(screen.rows).toBe(3)
      // 文本应仍存在于缓冲中 (可能被重排到多行)
      const full = adapter.readScreen("full")
      expect(full.lines.some((l) => l.text.includes("A"))).toBe(true)
    } finally {
      adapter.dispose()
    }
  })

  it("多次 resize 后维度始终与最后一次一致", async () => {
    const adapter = new XtermAdapter(40, 5, 0)

    try {
      adapter.resize(60, 10)
      adapter.resize(100, 30)
      adapter.resize(50, 12)

      const screen = adapter.readScreen()
      expect(screen.cols).toBe(50)
      expect(screen.rows).toBe(12)
    } finally {
      adapter.dispose()
    }
  })
})

// ============================================================
// dispose — 销毁逻辑
// ============================================================

describe("XtermAdapter.dispose", () => {
  it("dispose 后再次调用不抛错 (幂等)", () => {
    const adapter = new XtermAdapter(40, 5, 0)

    // 第一次 dispose 正常
    adapter.dispose()
    // 第二次 dispose 也不抛错
    expect(() => adapter.dispose()).not.toThrow()
  })

  it("dispose 后 write 返回的 Promise 仍然 resolve 而非永久挂起", async () => {
    const adapter = new XtermAdapter(40, 5, 0)

    // 先写入, 然后销毁; writeParsedResolvers 应被释放
    const writePromise = adapter.write("before dispose")
    adapter.dispose()

    // Promise 应该 resolve (dispose 时释放了 resolvers), 不应永久挂起
    await expect(writePromise).resolves.toBeUndefined()
  })

  it("dispose 后 readScreen 抛 TerminalUseError", () => {
    const adapter = new XtermAdapter(40, 5, 0)
    adapter.dispose()

    expect(() => adapter.readScreen()).toThrow(TerminalUseError)
    const error = (() => {
      try { adapter.readScreen() } catch (e) { return e }
    })() as TerminalUseError
    expect(error.code).toBe("INTERNAL_ERROR")
    expect(error.retryable).toBe(false)
  })

  it("dispose 后 detectHighlights 抛 TerminalUseError", () => {
    const adapter = new XtermAdapter(40, 5, 0)
    adapter.dispose()

    expect(() => adapter.detectHighlights()).toThrow(TerminalUseError)
    const error = (() => {
      try { adapter.detectHighlights() } catch (e) { return e }
    })() as TerminalUseError
    expect(error.code).toBe("INTERNAL_ERROR")
  })
})

// ============================================================
// getLastWriteAt — 最后写入时间戳
// ============================================================

describe("XtermAdapter.getLastWriteAt", () => {
  it("初始值为 0", () => {
    const adapter = new XtermAdapter(40, 5, 0)

    try {
      expect(adapter.getLastWriteAt()).toBe(0)
    } finally {
      adapter.dispose()
    }
  })

  it("write 后返回非零时间戳", async () => {
    const adapter = new XtermAdapter(40, 5, 0)

    try {
      const before = Date.now()
      await adapter.write("timestamp test")

      const lastWriteAt = adapter.getLastWriteAt()
      expect(lastWriteAt).toBeGreaterThanOrEqual(before)
      expect(lastWriteAt).toBeLessThanOrEqual(Date.now())
    } finally {
      adapter.dispose()
    }
  })

  it("多次 write 后时间戳更新为最近一次", async () => {
    const adapter = new XtermAdapter(40, 5, 0)

    try {
      await adapter.write("first")
      // 小延时确保时间戳不同
      await new Promise((r) => setTimeout(r, 5))
      await adapter.write("second")

      const lastWriteAt = adapter.getLastWriteAt()
      expect(lastWriteAt).toBeGreaterThan(0)
    } finally {
      adapter.dispose()
    }
  })
})

// ============================================================
// markClean + isDirty — 脏标记逻辑
// ============================================================

describe("XtermAdapter.markClean + isDirty", () => {
  it("新建时 isDirty 为 false (无写入)", () => {
    const adapter = new XtermAdapter(40, 5, 0)

    try {
      expect(adapter.isDirty()).toBe(false)
    } finally {
      adapter.dispose()
    }
  })

  it("write 后 isDirty 为 true", async () => {
    const adapter = new XtermAdapter(40, 5, 0)

    try {
      await adapter.write("dirty test")
      expect(adapter.isDirty()).toBe(true)
    } finally {
      adapter.dispose()
    }
  })

  it("markClean 后 isDirty 变为 false", async () => {
    const adapter = new XtermAdapter(40, 5, 0)

    try {
      await adapter.write("before clean")
      expect(adapter.isDirty()).toBe(true)

      adapter.markClean()
      expect(adapter.isDirty()).toBe(false)
    } finally {
      adapter.dispose()
    }
  })

  it("markClean 后再 write, isDirty 再次变为 true", async () => {
    const adapter = new XtermAdapter(40, 5, 0)

    try {
      await adapter.write("first")
      adapter.markClean()
      expect(adapter.isDirty()).toBe(false)

      await adapter.write("second")
      expect(adapter.isDirty()).toBe(true)
    } finally {
      adapter.dispose()
    }
  })
})
