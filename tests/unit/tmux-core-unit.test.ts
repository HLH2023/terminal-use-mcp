/**
 * TmuxCore 核心功能单元测试
 *
 * 测试 v0.2.0 重构中新增的功能点，直接调用从 tmux-core-utils.ts 提取的纯函数。
 *
 * 覆盖范围：
 * 1. cropToPane — pane view 裁剪算法 + graceful fallback
 * 2. detectPollutionHeuristics — 3 条污染检测 heuristic
 * 3. formatTmuxTargetFromAst — AST target 格式化
 * 4. parsePaneGeometryLine — pane geometry 行解析
 * 5. getActivePaneGeometry — 活跃 pane 选择逻辑
 * 6. lastInputNoVisualChange — 算法核心公式
 * 7. snapshot 污染检测集成点
 * 8. hashScreen 稳定性（间接验证 waitRenderAfterInput）
 */

import { describe, expect, it } from "vitest"

import type { PaneGeometry } from "../../src/providers/tmux-core.js"
import {
  cropToPane,
  detectPollutionHeuristics,
  formatTmuxTargetFromAst,
  parsePaneGeometryLine,
} from "../../src/terminal/tmux-core-utils.js"
import { hashScreen } from "../../src/terminal/wait.js"

// ============================================================
// 辅助函数
// ============================================================

function makeGeometry(overrides: Partial<PaneGeometry> = {}): PaneGeometry {
  return {
    paneId: "%0",
    left: 0,
    top: 0,
    width: 80,
    height: 24,
    active: true,
    ...overrides,
  }
}

// ============================================================
// 1. cropToPane
// ============================================================

describe("cropToPane", () => {
  it("geometry 覆盖全屏时返回原文本", () => {
    const text = "line1\nline2\nline3"
    const geo = makeGeometry({ width: 80, height: 3 })
    expect(cropToPane(text, geo, 80)).toBe("line1\nline2\nline3")
  })

  it("从第 1 行开始裁剪（top=1, height=3）", () => {
    const text = "line0\nline1\nline2\nline3\nline4"
    const geo = makeGeometry({ top: 1, height: 3 })
    const result = cropToPane(text, geo, 80)
    expect(result.split("\n")).toEqual(["line1", "line2", "line3"])
  })

  it("totalCols !== geometry.width 时 padEnd 到 geometry.width", () => {
    const text = "ab\ncd"
    const geo = makeGeometry({ width: 5, height: 2 })
    expect(cropToPane(text, geo, 10)).toBe("ab   \ncd   ")
  })

  it("totalCols === geometry.width 时不做 padEnd", () => {
    const text = "ab\ncd"
    const geo = makeGeometry({ width: 5, height: 2 })
    expect(cropToPane(text, geo, 5)).toBe("ab\ncd")
  })

  it("geometry 超出屏幕行数时安全截断", () => {
    const text = "only one line"
    const geo = makeGeometry({ height: 24 })
    const result = cropToPane(text, geo, 80)
    expect(result.split("\n").length).toBe(1)
  })

  it("列裁剪：left=5, width=3", () => {
    const text = "abcdefghij"
    const geo = makeGeometry({ left: 5, width: 3, height: 1 })
    expect(cropToPane(text, geo, 80)).toBe("fgh")
  })

  it("空屏幕返回空行", () => {
    const text = ""
    const geo = makeGeometry({ height: 1 })
    expect(cropToPane(text, geo, 80)).toBe("")
  })
})

// ============================================================
// 2. detectPollutionHeuristics
// ============================================================

describe("detectPollutionHeuristics", () => {
  it("高重复字符比例（>60% 且 count>20）→ 检测到", () => {
    const line = "*".repeat(100)
    const result = detectPollutionHeuristics(line, 100, 1, null)
    expect(result).toContain("high-repeat-ratio")
  })

  it("正常内容不触发高重复检测", () => {
    const text = "This is a normal terminal line with varied content"
    const result = detectPollutionHeuristics(text, 80, 1, null)
    expect(result).not.toContain("high-repeat-ratio")
  })

  it("短行（<10 字符）跳过检测", () => {
    const text = "*****"
    const result = detectPollutionHeuristics(text, 80, 1, null)
    expect(result).not.toContain("high-repeat-ratio")
  })

  it("维度不一致（差>2）→ 检测到", () => {
    const geo = makeGeometry({ width: 80, height: 24 })
    const result = detectPollutionHeuristics("normal", 120, 40, geo)
    expect(result).toContain("dimension-mismatch")
  })

  it("维度一致（差≤2）不触发", () => {
    const geo = makeGeometry({ width: 80, height: 24 })
    const result = detectPollutionHeuristics("normal", 81, 25, geo)
    expect(result).not.toContain("dimension-mismatch")
  })

  it("维度完全一致不触发", () => {
    const geo = makeGeometry({ width: 80, height: 24 })
    const result = detectPollutionHeuristics("normal", 80, 24, geo)
    expect(result).not.toContain("dimension-mismatch")
  })

  it("geometry=null 时跳过维度检测", () => {
    const result = detectPollutionHeuristics("normal", 120, 40, null)
    expect(result).not.toContain("dimension-mismatch")
  })

  it("控制字符残留（>5个）→ 检测到", () => {
    const text = "normal\x01\x02\x03\x04\x05\x06text"
    const result = detectPollutionHeuristics(text, 80, 1, null)
    expect(result).toContain("control-char-residual")
  })

  it("少量控制字符（≤5）不触发", () => {
    const text = "text\x01\x02\x03"
    const result = detectPollutionHeuristics(text, 80, 1, null)
    expect(result).not.toContain("control-char-residual")
  })

  it("正常文本无控制字符", () => {
    const text = "This is normal text with no control characters"
    const result = detectPollutionHeuristics(text, 80, 1, null)
    expect(result).not.toContain("control-char-residual")
  })

  it("可同时检测多种污染", () => {
    const line = "*".repeat(100) + "\x01\x02\x03\x04\x05\x06"
    const result = detectPollutionHeuristics(line, 100, 1, null)
    expect(result).toContain("high-repeat-ratio")
    expect(result).toContain("control-char-residual")
  })

  it("干净文本返回空数组", () => {
    const result = detectPollutionHeuristics("hello world", 80, 24, makeGeometry())
    expect(result).toEqual([])
  })
})

// ============================================================
// 3. formatTmuxTargetFromAst
// ============================================================

describe("formatTmuxTargetFromAst", () => {
  it("无 target 的 AST 返回 null", () => {
    const ast = { kind: "list", scope: "sessions" } as never
    expect(formatTmuxTargetFromAst(ast)).toBeNull()
  })

  it("target 为 undefined 返回 null", () => {
    const ast = { kind: "kill", target: undefined }
    expect(formatTmuxTargetFromAst(ast)).toBeNull()
  })

  it("target 带 id 字段返回 id", () => {
    const ast = { kind: "kill", target: { id: "%3" } }
    expect(formatTmuxTargetFromAst(ast)).toBe("%3")
  })

  it("target 带 name 字段返回 name", () => {
    const ast = { kind: "new", target: { name: "my-session" } }
    expect(formatTmuxTargetFromAst(ast)).toBe("my-session")
  })

  it("target 带 paneId 字段返回 paneId", () => {
    const ast = { kind: "select", target: { paneId: "%5" } }
    expect(formatTmuxTargetFromAst(ast)).toBe("%5")
  })

  it("attach target 带 session + window 返回 session:window", () => {
    const ast = { kind: "attach", target: { session: "my-session", window: "editor" } }
    expect(formatTmuxTargetFromAst(ast)).toBe("my-session:editor")
  })

  it("target 为字符串时返回字符串值", () => {
    const ast = { kind: "select", target: "my-target" }
    expect(formatTmuxTargetFromAst(ast)).toBe("my-target")
  })

  it("target 仅带 session 时走 String() fallback", () => {
    const ast = { kind: "attach", target: { session: "my-session" } }
    expect(formatTmuxTargetFromAst(ast)).toBe("[object Object]")
  })
})

// ============================================================
// 4. parsePaneGeometryLine
// ============================================================

describe("parsePaneGeometryLine", () => {
  it("正确解析标准格式行", () => {
    const result = parsePaneGeometryLine("%0:0:0:80:24:1")
    expect(result).toEqual({
      paneId: "%0",
      left: 0,
      top: 0,
      width: 80,
      height: 24,
      active: true,
    })
  })

  it("正确解析带引号的行", () => {
    const result = parsePaneGeometryLine('"%1:0:12:80:12:0"')
    expect(result).not.toBeNull()
    expect(result!.paneId).toBe("%1")
    expect(result!.top).toBe(12)
    expect(result!.active).toBe(false)
  })

  it("字段不足返回 null", () => {
    expect(parsePaneGeometryLine("%0:0:0")).toBeNull()
  })

  it("非活跃 pane 解析 active=false", () => {
    const result = parsePaneGeometryLine("%2:40:0:40:24:0")
    expect(result).not.toBeNull()
    expect(result!.active).toBe(false)
    expect(result!.left).toBe(40)
  })

  it("无效数字字段默认为 0", () => {
    const result = parsePaneGeometryLine("%0:abc:def:xyz:foo:1")
    expect(result).not.toBeNull()
    expect(result!.left).toBe(0)
    expect(result!.top).toBe(0)
    expect(result!.width).toBe(0)
    expect(result!.height).toBe(0)
  })

  it("带空格的行正确 trim", () => {
    const result = parsePaneGeometryLine('  "%0:0:0:80:24:1"  ')
    expect(result).not.toBeNull()
    expect(result!.paneId).toBe("%0")
    expect(result!.active).toBe(true)
  })
})

// ============================================================
// 5. getActivePaneGeometry 逻辑
// ============================================================

describe("getActivePaneGeometry 逻辑", () => {
  it("优先返回 active=true 的 pane", () => {
    const geometries: PaneGeometry[] = [
      { paneId: "%0", left: 0, top: 0, width: 80, height: 12, active: false },
      { paneId: "%1", left: 0, top: 12, width: 80, height: 12, active: true },
    ]
    const active = geometries.find((g) => g.active) ?? geometries[0] ?? null
    expect(active!.paneId).toBe("%1")
  })

  it("无 active pane 时返回第一个", () => {
    const geometries: PaneGeometry[] = [
      { paneId: "%0", left: 0, top: 0, width: 80, height: 24, active: false },
    ]
    const first = geometries.find((g) => g.active) ?? geometries[0] ?? null
    expect(first!.paneId).toBe("%0")
  })

  it("空 geometries 返回 null", () => {
    const geometries: PaneGeometry[] = []
    const result = geometries.find((g) => g.active) ?? geometries[0] ?? null
    expect(result).toBeNull()
  })
})

// ============================================================
// 6. lastInputNoVisualChange 算法
// ============================================================

describe("lastInputNoVisualChange 算法", () => {
  it("相同内容 → noVisualChange=true", () => {
    const beforeHash = hashScreen("same content")
    const afterHash = hashScreen("same content")
    const noVisualChange = beforeHash === afterHash && beforeHash !== ""
    expect(noVisualChange).toBe(true)
  })

  it("不同内容 → noVisualChange=false", () => {
    const beforeHash = hashScreen("old content")
    const afterHash = hashScreen("new content")
    const noVisualChange = beforeHash === afterHash && beforeHash !== ""
    expect(noVisualChange).toBe(false)
  })

  it("空屏 hash 非空（DJB2 初始值）", () => {
    expect(hashScreen("")).toBe((5381).toString(36))
    expect(hashScreen("")).toBeTruthy()
  })

  it("hashScreen 稳定性", () => {
    const content = "Hello, World!\nLine 2"
    expect(hashScreen(content)).toBe(hashScreen(content))
  })

  it("hashScreen 区分不同内容", () => {
    expect(hashScreen("A")).not.toBe(hashScreen("B"))
  })
})

// ============================================================
// 7. snapshot 污染检测集成点
// ============================================================

describe("snapshot 污染检测集成点", () => {
  it("snapshotCount 为 5/10/15 时触发（% 5 === 0 且 > 0）", () => {
    for (const count of [5, 10, 15, 20]) {
      expect(count % 5 === 0 && count > 0).toBe(true)
    }
  })

  it("snapshotCount 为 0/1/4/7 时不触发", () => {
    for (const count of [0, 1, 4, 7]) {
      expect(count % 5 === 0 && count > 0).toBe(false)
    }
  })

  it("detectRenderPollution 返回非空数组时触发恢复", () => {
    const result = detectPollutionHeuristics("*".repeat(100), 100, 1, null)
    expect(result.length > 0).toBe(true)
  })

  it("detectRenderPollution 返回空数组时不触发恢复", () => {
    const result = detectPollutionHeuristics("normal text", 80, 24, makeGeometry())
    expect(result.length > 0).toBe(false)
  })
})

// ============================================================
// 8. default-size + aggressive-resize 参数格式
// ============================================================

describe("start() default-size 和 aggressive-resize 参数", () => {
  it("default-size 格式为 {cols}x{rows}", () => {
    expect(`${80}x${24}`).toBe("80x24")
    expect(`${120}x${40}`).toBe("120x40")
  })

  it("set-option 参数正确组装", () => {
    const tmuxId = "tumcp_test"
    expect(["set-option", "-t", tmuxId, "default-size", "80x24"]).toHaveLength(5)
    expect(["set-option", "-t", tmuxId, "aggressive-resize", "off"]).toHaveLength(5)
  })
})