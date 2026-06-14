/**
 * 鼠标事件编码单元测试
 *
 * 覆盖: SGR-1006 序列生成、X10 legacy 序列、tmux 序列、坐标校验
 */

import { describe, expect, it } from "vitest"
import {
  mouseClickToSgrSequence,
  mouseScrollToSgrSequence,
  mouseClickToX10Sequence,
  mouseScrollToX10Sequence,
  mouseClickToFullSgrSequence,
  mouseClickToTmuxSequence,
  mouseScrollToTmuxSequence,
  validateMouseCoords,
  InvalidMouseCoordsError,
} from "../../src/terminal/mouse.js"
import type { MouseClickEvent, MouseScrollEvent } from "../../src/terminal/mouse.js"

// ============================================================
// SGR-1006 鼠标点击编码
// ============================================================

describe("mouseClickToSgrSequence", () => {
  it("左键点击 (press) — (1,1)", () => {
    const seq = mouseClickToSgrSequence({ col: 1, row: 1, button: "left", action: "press" })
    // ESC [ < 0 ; 1 ; 1 M
    expect(seq).toBe("\x1b[<0;1;1M")
  })

  it("左键点击 (release) — (1,1)", () => {
    const seq = mouseClickToSgrSequence({ col: 1, row: 1, button: "left", action: "release" })
    expect(seq).toBe("\x1b[<0;1;1m")
  })

  it("右键点击 (press) — (40,12)", () => {
    const seq = mouseClickToSgrSequence({ col: 40, row: 12, button: "right", action: "press" })
    expect(seq).toBe("\x1b[<2;40;12M")
  })

  it("中键点击 (press) — (80,24)", () => {
    const seq = mouseClickToSgrSequence({ col: 80, row: 24, button: "middle", action: "press" })
    expect(seq).toBe("\x1b[<1;80;24M")
  })

  it("shift+左键 — 修饰键掩码 shift=4", () => {
    const seq = mouseClickToSgrSequence({ col: 10, row: 5, button: "left", action: "press", shift: true })
    // Cb = 0 (left) + 4 (shift) = 4
    expect(seq).toBe("\x1b[<4;10;5M")
  })

  it("alt+右键 — 修饰键掩码 alt=8", () => {
    const seq = mouseClickToSgrSequence({ col: 10, row: 5, button: "right", action: "press", alt: true })
    // Cb = 2 (right) + 8 (alt) = 10
    expect(seq).toBe("\x1b[<10;10;5M")
  })

  it("ctrl+shift+中键 — 修饰键掩码 ctrl=16+shift=4=20", () => {
    const seq = mouseClickToSgrSequence({ col: 10, row: 5, button: "middle", action: "press", shift: true, ctrl: true })
    // Cb = 1 (middle) + 4 (shift) + 16 (ctrl) = 21
    expect(seq).toBe("\x1b[<21;10;5M")
  })
})

// ============================================================
// SGR-1006 鼠标滚轮编码
// ============================================================

describe("mouseScrollToSgrSequence", () => {
  it("滚轮上 — (40,12)", () => {
    const seq = mouseScrollToSgrSequence({ col: 40, row: 12, direction: "up" })
    // Cb = 64 (scroll up)
    expect(seq).toBe("\x1b[<64;40;12M")
  })

  it("滚轮下 — (40,12)", () => {
    const seq = mouseScrollToSgrSequence({ col: 40, row: 12, direction: "down" })
    // Cb = 65 (scroll down)
    expect(seq).toBe("\x1b[<65;40;12M")
  })

  it("shift+滚轮上 — 快速滚动", () => {
    const seq = mouseScrollToSgrSequence({ col: 1, row: 1, direction: "up", shift: true })
    // Cb = 64 + 4 (shift) = 68
    expect(seq).toBe("\x1b[<68;1;1M")
  })

  it("ctrl+滚轮下", () => {
    const seq = mouseScrollToSgrSequence({ col: 1, row: 1, direction: "down", ctrl: true })
    // Cb = 65 + 16 (ctrl) = 81
    expect(seq).toBe("\x1b[<81;1;1M")
  })
})

// ============================================================
// X10 legacy 鼠标编码
// ============================================================

describe("mouseClickToX10Sequence", () => {
  it("左键点击 — (1,1)", () => {
    const seq = mouseClickToX10Sequence({ col: 1, row: 1, button: "left", action: "press" })
    // Cb = 0 + 32 = 32 (space), Cx = 1+32 = 33 (!), Cy = 1+32 = 33 (!)
    expect(seq).toBe("\x1b[M !!")
  })

  it("右键点击 — (10,5)", () => {
    const seq = mouseClickToX10Sequence({ col: 10, row: 5, button: "right", action: "press" })
    // Cb = 2 + 32 = 34 ("), Cx = 10+32 = 42 ("*"), Cy = 5+32 = 37 ("%")
    expect(seq).toBe("\x1b[M\"*%")
  })
})

describe("mouseScrollToX10Sequence", () => {
  it("滚轮上 — (1,1)", () => {
    const seq = mouseScrollToX10Sequence({ col: 1, row: 1, direction: "up" })
    // button 4 + 32 = 96 ("`"), Cx = 33 ("!"), Cy = 33 ("!")
    expect(seq).toBe("\x1b[M`!!")
  })

  it("滚轮下 — (1,1)", () => {
    const seq = mouseScrollToX10Sequence({ col: 1, row: 1, direction: "down" })
    // button 5 + 32 = 97 ("a"), Cx = 33 ("!"), Cy = 33 ("!")
    expect(seq).toBe("\x1b[Ma!!")
  })
})

// ============================================================
// 完整点击序列 (press + release)
// ============================================================

describe("mouseClickToFullSgrSequence", () => {
  it("左键点击生成 press+release 配对", () => {
    const seq = mouseClickToFullSgrSequence({ col: 10, row: 5, button: "left" })
    // press: ESC [ < 0 ; 10 ; 5 M
    // release: ESC [ < 0 ; 10 ; 5 m
    expect(seq).toBe("\x1b[<0;10;5M\x1b[<0;10;5m")
  })

  it("带修饰键的点击也配对", () => {
    const seq = mouseClickToFullSgrSequence({ col: 3, row: 7, button: "right", shift: true })
    expect(seq).toBe("\x1b[<6;3;7M\x1b[<6;3;7m")
  })
})

// ============================================================
// tmux 鼠标序列
// ============================================================

describe("mouseClickToTmuxSequence", () => {
  it("tmux 点击 = SGR full click", () => {
    const seq = mouseClickToTmuxSequence({ col: 20, row: 10, button: "left" })
    expect(seq).toBe("\x1b[<0;20;10M\x1b[<0;20;10m")
  })
})

describe("mouseScrollToTmuxSequence", () => {
  it("tmux 滚轮上 = SGR scroll up", () => {
    const seq = mouseScrollToTmuxSequence({ col: 20, row: 10, direction: "up" })
    expect(seq).toBe("\x1b[<64;20;10M")
  })
})

// ============================================================
// 坐标校验
// ============================================================

describe("validateMouseCoords", () => {
  it("有效坐标不抛错", () => {
    expect(() => validateMouseCoords(1, 1, 80, 24)).not.toThrow()
    expect(() => validateMouseCoords(80, 24, 80, 24)).not.toThrow()
  })

  it("坐标 < 1 抛 InvalidMouseCoordsError", () => {
    expect(() => validateMouseCoords(0, 1, 80, 24)).toThrow(InvalidMouseCoordsError)
    expect(() => validateMouseCoords(1, 0, 80, 24)).toThrow(InvalidMouseCoordsError)
  })

  it("坐标超出终端范围抛错", () => {
    expect(() => validateMouseCoords(81, 24, 80, 24)).toThrow(InvalidMouseCoordsError)
    expect(() => validateMouseCoords(80, 25, 80, 24)).toThrow(InvalidMouseCoordsError)
  })
})
