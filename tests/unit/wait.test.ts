import { describe, it, expect } from "vitest"
import {
  checkTextMatch,
  checkScreenStable,
  hashScreen,
  calculatePollDelay,
} from "../../src/terminal/wait.js"
import type { ScreenState, WaitForTextOptions, WaitStableOptions } from "../../src/terminal/wait.js"

describe("checkTextMatch", () => {
  it("精确文本匹配: 屏幕包含文本 → matched true", () => {
    const screen = "Hello World\n$ prompt> _"
    const options: WaitForTextOptions = { text: "prompt" }
    const result = checkTextMatch(screen, options)
    expect(result.matched).toBe(true)
  })

  it("精确文本不匹配: 屏幕不含文本 → matched false", () => {
    const screen = "Hello World\n$ _"
    const options: WaitForTextOptions = { text: "notfound" }
    const result = checkTextMatch(screen, options)
    expect(result.matched).toBe(false)
    if (!result.matched) {
      expect(result.reason).toContain("notfound")
    }
  })

  it("正则匹配: 模式匹配 → matched true", () => {
    const screen = "Build #42 completed in 3.5s"
    const options: WaitForTextOptions = { text: "Build #\\d+ completed", regex: true }
    const result = checkTextMatch(screen, options)
    expect(result.matched).toBe(true)
  })

  it("正则不匹配: 模式不匹配 → matched false", () => {
    const screen = "Build failed"
    const options: WaitForTextOptions = { text: "Build #\\d+ completed", regex: true }
    const result = checkTextMatch(screen, options)
    expect(result.matched).toBe(false)
    if (!result.matched) {
      expect(result.reason).toContain("正则")
    }
  })

  it("大小写不敏感: 匹配忽略大小写 → matched true", () => {
    const screen = "HELLO WORLD"
    const options: WaitForTextOptions = { text: "hello world", caseSensitive: false }
    const result = checkTextMatch(screen, options)
    expect(result.matched).toBe(true)
  })

  it("大小写敏感 (默认): 不匹配不同大小写 → matched false", () => {
    const screen = "HELLO WORLD"
    const options: WaitForTextOptions = { text: "hello world" }
    const result = checkTextMatch(screen, options)
    expect(result.matched).toBe(false)
  })

  it("大小写敏感: 完全匹配 → matched true", () => {
    const screen = "Hello World"
    const options: WaitForTextOptions = { text: "Hello World" }
    const result = checkTextMatch(screen, options)
    expect(result.matched).toBe(true)
  })

  it("正则 + 大小写不敏感组合", () => {
    const screen = "ERROR: Connection Refused"
    const options: WaitForTextOptions = { text: "error:.*refused", regex: true, caseSensitive: false }
    const result = checkTextMatch(screen, options)
    expect(result.matched).toBe(true)
  })

  it("空屏幕匹配空文本 → matched true", () => {
    const result = checkTextMatch("", { text: "" })
    expect(result.matched).toBe(true)
  })

  it("空屏幕匹配非空文本 → matched false", () => {
    const result = checkTextMatch("", { text: "something" })
    expect(result.matched).toBe(false)
  })
})

describe("checkScreenStable", () => {
  const baseOptions: WaitStableOptions = { idleMs: 500, timeoutMs: 5000 }
  const now = 10_000

  it("相同屏幕 hash 和足够 idle 时间 → stable true", () => {
    const hash = hashScreen("same content")
    const previous: ScreenState = { screen: "same content", screenHash: hash, lastWriteAt: 9_000, now: 9_500 }
    const current: ScreenState = { screen: "same content", screenHash: hash, lastWriteAt: 9_000, now }
    const result = checkScreenStable(current, previous, baseOptions)
    expect(result.stable).toBe(true)
  })

  it("不同屏幕 hash → stable false", () => {
    const previous: ScreenState = { screen: "old", screenHash: hashScreen("old"), lastWriteAt: 9_000, now: 9_500 }
    const current: ScreenState = { screen: "new", screenHash: hashScreen("new"), lastWriteAt: 9_000, now }
    const result = checkScreenStable(current, previous, baseOptions)
    expect(result.stable).toBe(false)
    if (!result.stable) {
      expect(result.reason).toContain("变化")
    }
  })

  it("previousState 为 null → stable false (首次轮询)", () => {
    const current: ScreenState = { screen: "content", screenHash: hashScreen("content"), lastWriteAt: 9_000, now }
    const result = checkScreenStable(current, null, baseOptions)
    expect(result.stable).toBe(false)
    if (!result.stable) {
      expect(result.reason).toContain("首次")
    }
  })

  it("idle 时间不够 → stable false", () => {
    const hash = hashScreen("same content")
    // lastWriteAt 距 now 仅 200ms, 小于 idleMs 500
    const previous: ScreenState = { screen: "same content", screenHash: hash, lastWriteAt: 9_800, now: 9_900 }
    const current: ScreenState = { screen: "same content", screenHash: hash, lastWriteAt: 9_800, now }
    const result = checkScreenStable(current, previous, baseOptions)
    expect(result.stable).toBe(false)
    if (!result.stable) {
      expect(result.reason).toContain("ms")
    }
  })

  it("默认 idleMs=500 时足够 idle → stable true", () => {
    const hash = hashScreen("static screen")
    const previous: ScreenState = { screen: "static screen", screenHash: hash, lastWriteAt: 8_000, now: 9_000 }
    const current: ScreenState = { screen: "static screen", screenHash: hash, lastWriteAt: 8_000, now: 10_000 }
    // idle = 10000 - 8000 = 2000ms > 500ms
    const result = checkScreenStable(current, previous, {})
    expect(result.stable).toBe(true)
  })
})

describe("hashScreen", () => {
  it("相同输入产生相同 hash", () => {
    const screen = "Hello World\nLine 2"
    expect(hashScreen(screen)).toBe(hashScreen(screen))
  })

  it("不同输入产生不同 hash", () => {
    const hash1 = hashScreen("Content A")
    const hash2 = hashScreen("Content B")
    expect(hash1).not.toBe(hash2)
  })

  it("返回字符串类型", () => {
    const hash = hashScreen("test")
    expect(typeof hash).toBe("string")
    expect(hash.length).toBeGreaterThan(0)
  })

  it("空字符串产生 hash", () => {
    const hash = hashScreen("")
    expect(typeof hash).toBe("string")
    expect(hash.length).toBeGreaterThan(0)
  })

  it("hash 一致性: 多次调用同值相同", () => {
    const screen = "multi\nline\ncontent"
    const hashes = new Array(5).fill(null).map(() => hashScreen(screen))
    expect(new Set(hashes).size).toBe(1)
  })
})

describe("calculatePollDelay", () => {
  it("默认 idleMs=500 时, 延迟为 min(100, 500/4)=125 的 clamp 结果", () => {
    const delay = calculatePollDelay({})
    // min(100, 500/4) = min(100, 125) = 100, then max(20, 100) = 100
    expect(delay).toBe(100)
  })

  it("idleMs=40 时, 延迟为 min(100, 40/4)=10, clamp 到 20", () => {
    const delay = calculatePollDelay({ idleMs: 40 })
    // min(100, 40/4) = min(100, 10) = 10, max(20, 10) = 20
    expect(delay).toBe(20)
  })

  it("指定 pollIntervalMs=200 时, 使用该值并 clamp", () => {
    const delay = calculatePollDelay({ pollIntervalMs: 200 })
    expect(delay).toBe(200)
  })

  it("指定 pollIntervalMs=5 时, clamp 到最小值 20", () => {
    const delay = calculatePollDelay({ pollIntervalMs: 5 })
    expect(delay).toBe(20)
  })

  it("idleMs=1000 时, 延迟为 min(100, 1000/4)=100", () => {
    const delay = calculatePollDelay({ idleMs: 1000 })
    expect(delay).toBe(100)
  })

  it("返回值始终 >= 20", () => {
    // 测试多种配置下都不低于 20
    const cases: WaitStableOptions[] = [
      { idleMs: 1 },
      { idleMs: 50, pollIntervalMs: 1 },
      {},
    ]
    for (const opts of cases) {
      expect(calculatePollDelay(opts)).toBeGreaterThanOrEqual(20)
    }
  })
})
