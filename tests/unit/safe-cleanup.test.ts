import { describe, expect, it, vi } from "vitest"

import { safeCleanup } from "../../src/terminal/safe-cleanup.js"
import type { Logger } from "../../src/logger.js"

/** 创建 mock logger，捕获 warn 调用 */
function createMockLogger(): Logger & { warns: Array<{ msg: string; data?: Record<string, unknown> }> } {
  const warns: Array<{ msg: string; data?: Record<string, unknown> }> = []
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: (msg: string, data?: Record<string, unknown>) => warns.push({ msg, data }),
    error: vi.fn(),
    setLevel: vi.fn(),
    warns,
  }
}

describe("safeCleanup", () => {
  it("正常情况所有步骤按顺序执行", async () => {
    const order: number[] = []

    await safeCleanup([
      { name: "step1", fn: () => { order.push(1) } },
      { name: "step2", fn: () => { order.push(2) } },
      { name: "step3", fn: () => { order.push(3) } },
    ])

    expect(order).toEqual([1, 2, 3])
  })

  it("异步步骤正确等待完成", async () => {
    const order: number[] = []

    await safeCleanup([
      { name: "async1", fn: async () => { await Promise.resolve(); order.push(1) } },
      { name: "sync2", fn: () => { order.push(2) } },
    ])

    expect(order).toEqual([1, 2])
  })

  it("某步骤抛错不阻断后续步骤", async () => {
    const order: number[] = []
    const logger = createMockLogger()

    await safeCleanup([
      { name: "step1", fn: () => { order.push(1) } },
      { name: "failing", fn: () => { throw new Error("boom") } },
      { name: "step3", fn: () => { order.push(3) } },
    ], logger)

    expect(order).toEqual([1, 3])
    expect(logger.warns).toHaveLength(1)
    expect(logger.warns[0].msg).toBe("safeCleanup step failed")
    expect(logger.warns[0].data?.step).toBe("failing")
  })

  it("最后一步 sessions.delete 总是执行", async () => {
    const deleted: boolean[] = []
    const logger = createMockLogger()

    await safeCleanup([
      { name: "failing-first", fn: () => { throw new Error("first fails") } },
      { name: "failing-second", fn: () => { throw new Error("second fails") } },
      { name: "sessions.delete", fn: () => { deleted.push(true) } },
    ], logger)

    expect(deleted).toEqual([true])
    expect(logger.warns).toHaveLength(2)
  })

  it("中间步骤异步抛错也不阻断后续", async () => {
    const order: number[] = []
    const logger = createMockLogger()

    await safeCleanup([
      { name: "step1", fn: () => { order.push(1) } },
      { name: "asyncFailing", fn: async () => { throw new Error("async boom") } },
      { name: "step3", fn: () => { order.push(3) } },
    ], logger)

    expect(order).toEqual([1, 3])
    expect(logger.warns).toHaveLength(1)
  })

  it("无 logger 时失败步骤静默跳过", async () => {
    const order: number[] = []

    await safeCleanup([
      { name: "failing", fn: () => { throw new Error("no logger") } },
      { name: "step2", fn: () => { order.push(2) } },
    ])

    expect(order).toEqual([2])
  })

  it("错误信息包含 Error 类名和消息", async () => {
    const logger = createMockLogger()

    await safeCleanup([
      { name: "typeError", fn: () => { throw new TypeError("not a function") } },
    ], logger)

    expect(logger.warns[0].data?.error).toBe("TypeError: not a function")
  })

  it("非 Error 类型抛出值被转为字符串", async () => {
    const logger = createMockLogger()

    await safeCleanup([
      { name: "stringThrow", fn: () => { throw "raw string" } },
    ], logger)

    expect(logger.warns[0].data?.error).toBe("raw string")
  })
})
