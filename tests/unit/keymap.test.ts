import { describe, it, expect } from "vitest"
import {
  parseKeyExpr,
  parsedKeyToAnsiSequence,
  parsedKeyToTmuxKey,
  parsedKeyToTuiUseKey,
  keyExprToAnsiSequence,
  keyExprToTmuxKey,
  keyExprToTuiUseKey,
  isValidKey,
  SUPPORTED_KEYS,
  InvalidKeyExprError,
} from "../../src/terminal/keymap.js"

// ============================================================
// parseKeyExpr — 按键表达式解析
// ============================================================

describe("parseKeyExpr", () => {
  describe("基础按键 (无修饰)", () => {
    it("enter", () => {
      const parsed = parseKeyExpr("enter")
      expect(parsed).toEqual({ modifiers: [], key: "enter" })
    })

    it("tab", () => {
      expect(parseKeyExpr("tab")).toEqual({ modifiers: [], key: "tab" })
    })

    it("escape", () => {
      expect(parseKeyExpr("escape")).toEqual({ modifiers: [], key: "escape" })
    })

    it("up", () => {
      expect(parseKeyExpr("up")).toEqual({ modifiers: [], key: "up" })
    })

    it("f1", () => {
      expect(parseKeyExpr("f1")).toEqual({ modifiers: [], key: "f1" })
    })

    it("f12", () => {
      expect(parseKeyExpr("f12")).toEqual({ modifiers: [], key: "f12" })
    })

    it("单字母 a", () => {
      expect(parseKeyExpr("a")).toEqual({ modifiers: [], key: "a" })
    })

    it("单字母 z", () => {
      expect(parseKeyExpr("z")).toEqual({ modifiers: [], key: "z" })
    })
  })

  describe("ctrl + 字母 (新格式 ctrl+X)", () => {
    it("ctrl+a", () => {
      expect(parseKeyExpr("ctrl+a")).toEqual({ modifiers: ["ctrl"], key: "a" })
    })

    it("ctrl+z", () => {
      expect(parseKeyExpr("ctrl+z")).toEqual({ modifiers: ["ctrl"], key: "z" })
    })

    it("ctrl+p", () => {
      expect(parseKeyExpr("ctrl+p")).toEqual({ modifiers: ["ctrl"], key: "p" })
    })

    it("ctrl+f", () => {
      expect(parseKeyExpr("ctrl+f")).toEqual({ modifiers: ["ctrl"], key: "f" })
    })
  })

  describe("ctrl + 字母 (旧连字符格式 ctrl-X)", () => {
    it("ctrl-c 向后兼容", () => {
      expect(parseKeyExpr("ctrl-c")).toEqual({ modifiers: ["ctrl"], key: "c" })
    })

    it("ctrl-d 向后兼容", () => {
      expect(parseKeyExpr("ctrl-d")).toEqual({ modifiers: ["ctrl"], key: "d" })
    })

    it("ctrl-l 向后兼容", () => {
      expect(parseKeyExpr("ctrl-l")).toEqual({ modifiers: ["ctrl"], key: "l" })
    })
  })

  describe("alt 组合", () => {
    it("alt+enter", () => {
      expect(parseKeyExpr("alt+enter")).toEqual({ modifiers: ["alt"], key: "enter" })
    })

    it("alt+tab", () => {
      expect(parseKeyExpr("alt+tab")).toEqual({ modifiers: ["alt"], key: "tab" })
    })

    it("alt+up", () => {
      expect(parseKeyExpr("alt+up")).toEqual({ modifiers: ["alt"], key: "up" })
    })
  })

  describe("shift 组合", () => {
    it("shift+tab", () => {
      expect(parseKeyExpr("shift+tab")).toEqual({ modifiers: ["shift"], key: "tab" })
    })

    it("shift+up", () => {
      expect(parseKeyExpr("shift+up")).toEqual({ modifiers: ["shift"], key: "up" })
    })
  })

  describe("多修饰键", () => {
    it("ctrl+shift+f", () => {
      expect(parseKeyExpr("ctrl+shift+f")).toEqual({ modifiers: ["ctrl", "shift"], key: "f" })
    })

    it("ctrl+alt+enter", () => {
      // 修饰键排序: ctrl → alt → shift
      expect(parseKeyExpr("ctrl+alt+enter")).toEqual({ modifiers: ["ctrl", "alt"], key: "enter" })
    })

    it("alt+ctrl+tab 修饰键自动排序", () => {
      expect(parseKeyExpr("alt+ctrl+tab")).toEqual({ modifiers: ["ctrl", "alt"], key: "tab" })
    })

    it("ctrl+shift+f1", () => {
      expect(parseKeyExpr("ctrl+shift+f1")).toEqual({ modifiers: ["ctrl", "shift"], key: "f1" })
    })
  })

  describe("功能键 + 修饰", () => {
    it("ctrl+f1", () => {
      expect(parseKeyExpr("ctrl+f1")).toEqual({ modifiers: ["ctrl"], key: "f1" })
    })

    it("alt+f5", () => {
      expect(parseKeyExpr("alt+f5")).toEqual({ modifiers: ["alt"], key: "f5" })
    })

    it("ctrl+f12", () => {
      expect(parseKeyExpr("ctrl+f12")).toEqual({ modifiers: ["ctrl"], key: "f12" })
    })
  })

  describe("错误处理", () => {
    it("空表达式抛错", () => {
      expect(() => parseKeyExpr("")).toThrow(InvalidKeyExprError)
    })

    it("空格表达式抛错", () => {
      expect(() => parseKeyExpr("   ")).toThrow(InvalidKeyExprError)
    })

    it("未知修饰键抛错", () => {
      expect(() => parseKeyExpr("meta+a")).toThrow(InvalidKeyExprError)
    })

    it("未知基础按键抛错", () => {
      expect(() => parseKeyExpr("unknownkey")).toThrow(InvalidKeyExprError)
    })

    it("f13 超出范围抛错", () => {
      expect(() => parseKeyExpr("f13")).toThrow(InvalidKeyExprError)
    })

    it("f0 无效抛错", () => {
      expect(() => parseKeyExpr("f0")).toThrow(InvalidKeyExprError)
    })

    it("重复修饰键抛错", () => {
      expect(() => parseKeyExpr("ctrl+ctrl+a")).toThrow(InvalidKeyExprError)
    })
  })

  describe("大小写不敏感", () => {
    it("Ctrl+A 大写修饰键", () => {
      expect(parseKeyExpr("Ctrl+A")).toEqual({ modifiers: ["ctrl"], key: "a" })
    })

    it("CTRL+F 全大写", () => {
      expect(parseKeyExpr("CTRL+F")).toEqual({ modifiers: ["ctrl"], key: "f" })
    })

    it("ALT+Enter 混合大小写", () => {
      expect(parseKeyExpr("ALT+Enter")).toEqual({ modifiers: ["alt"], key: "enter" })
    })
  })
})

// ============================================================
// parsedKeyToAnsiSequence — ANSI 编码
// ============================================================

describe("parsedKeyToAnsiSequence", () => {
  describe("基础按键", () => {
    it("enter → \\r", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("enter"))).toBe("\r")
    })

    it("tab → \\t", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("tab"))).toBe("\t")
    })

    it("escape → \\x1b", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("escape"))).toBe("\x1b")
    })

    it("backspace → \\x7f", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("backspace"))).toBe("\x7f")
    })

    it("delete → \\x1b[3~", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("delete"))).toBe("\x1b[3~")
    })

    it("up → \\x1b[A", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("up"))).toBe("\x1b[A")
    })

    it("down → \\x1b[B", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("down"))).toBe("\x1b[B")
    })

    it("home → \\x1b[H", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("home"))).toBe("\x1b[H")
    })

    it("end → \\x1b[F", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("end"))).toBe("\x1b[F")
    })

    it("pageup → \\x1b[5~", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("pageup"))).toBe("\x1b[5~")
    })

    it("pagedown → \\x1b[6~", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("pagedown"))).toBe("\x1b[6~")
    })

    it("space → 空格字符", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("space"))).toBe(" ")
    })

    it("insert → \\x1b[2~", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("insert"))).toBe("\x1b[2~")
    })
  })

  describe("ctrl + 字母 → C0 控制码", () => {
    it("ctrl+a → \\x01", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("ctrl+a"))).toBe("\x01")
    })

    it("ctrl+c → \\x03", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("ctrl+c"))).toBe("\x03")
    })

    it("ctrl+d → \\x04", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("ctrl+d"))).toBe("\x04")
    })

    it("ctrl+f → \\x06", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("ctrl+f"))).toBe("\x06")
    })

    it("ctrl+l → \\x0c", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("ctrl+l"))).toBe("\x0c")
    })

    it("ctrl+p → \\x10", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("ctrl+p"))).toBe("\x10")
    })

    it("ctrl+z → \\x1a", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("ctrl+z"))).toBe("\x1a")
    })

    it("向后兼容: ctrl-c 连字符格式 → \\x03", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("ctrl-c"))).toBe("\x03")
    })
  })

  describe("功能键", () => {
    it("f1 → \\x1bOP", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("f1"))).toBe("\x1bOP")
    })

    it("f4 → \\x1bOS", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("f4"))).toBe("\x1bOS")
    })

    it("f5 → \\x1b[15~", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("f5"))).toBe("\x1b[15~")
    })

    it("f10 → \\x1b[21~", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("f10"))).toBe("\x1b[21~")
    })

    it("f11 → \\x1b[23~", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("f11"))).toBe("\x1b[23~")
    })

    it("f12 → \\x1b[24~", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("f12"))).toBe("\x1b[24~")
    })
  })

  describe("alt 修饰", () => {
    it("alt+单字母 → ESC + 字符", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("alt+a"))).toBe("\x1ba")
    })

    it("alt+enter → SGR 修饰编码", () => {
      // alt → modifier=3 (shift=1, alt=2, so 1+2=3)
      // enter base is \r, 修饰版本用 SGR: ESC [ 13 ; 3 ~
      expect(parsedKeyToAnsiSequence(parseKeyExpr("alt+enter"))).toBe("\x1b[13;3~")
    })

    it("alt+up → SGR 编码", () => {
      // up base: ESC[A → SGR: ESC[1;3A
      expect(parsedKeyToAnsiSequence(parseKeyExpr("alt+up"))).toBe("\x1b[1;3A")
    })
  })

  describe("shift 修饰", () => {
    it("shift+a → 大写 A", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("shift+a"))).toBe("A")
    })

    it("shift+tab → SGR 编码 (包含 ;2 修饰符)", () => {
      // shift 修饰符 = 1, SGR 1-based = 2, 所以编码应包含 ";2"
      // tab base → C0 (\t), 走 C0_TO_CSI_EQUIV: tab → ESC[9~, 再加修饰符 → ESC[9;2~
      const result = parsedKeyToAnsiSequence(parseKeyExpr("shift+tab"))
      expect(result).toContain(";2")
      expect(result).toContain("\x1b[")
    })

    it("shift+up → SGR 编码", () => {
      // up base: ESC[A → SGR: ESC[1;2A
      expect(parsedKeyToAnsiSequence(parseKeyExpr("shift+up"))).toBe("\x1b[1;2A")
    })
  })

  describe("ctrl + 功能键 修饰", () => {
    it("ctrl+f1 → SS3 修饰编码", () => {
      // f1 base: ESC OP → ctrl 修饰: ESC O 5 P
      expect(parsedKeyToAnsiSequence(parseKeyExpr("ctrl+f1"))).toBe("\x1bO5P")
    })

    it("ctrl+f5 → CSI 修饰编码", () => {
      // f5 base: ESC[15~ → ctrl 修饰: ESC[15;5~
      expect(parsedKeyToAnsiSequence(parseKeyExpr("ctrl+f5"))).toBe("\x1b[15;5~")
    })

    it("ctrl+f12 → SGR 编码", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("ctrl+f12"))).toBe("\x1b[24;5~")
    })
  })

  describe("ctrl + alt + 字母", () => {
    it("ctrl+alt+a → ESC + C0", () => {
      // ctrl+a → \x01, 再加 alt 前缀 ESC → \x1b\x01
      expect(parsedKeyToAnsiSequence(parseKeyExpr("ctrl+alt+a"))).toBe("\x1b\x01")
    })
  })

  describe("单字母无修饰", () => {
    it("a → 原字符", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("a"))).toBe("a")
    })

    it("f → f 字符", () => {
      expect(parsedKeyToAnsiSequence(parseKeyExpr("f"))).toBe("f")
    })
  })
})

// ============================================================
// keyExprToAnsiSequence — 便捷入口
// ============================================================

describe("keyExprToAnsiSequence", () => {
  it("ctrl+p → \\x10", () => {
    expect(keyExprToAnsiSequence("ctrl+p")).toBe("\x10")
  })

  it("f7 → \\x1b[18~", () => {
    expect(keyExprToAnsiSequence("f7")).toBe("\x1b[18~")
  })

  it("alt+enter", () => {
    expect(keyExprToAnsiSequence("alt+enter")).toBe("\x1b[13;3~")
  })
})

// ============================================================
// parsedKeyToTmuxKey — tmux 键名映射
// ============================================================

describe("parsedKeyToTmuxKey", () => {
  it("enter → Enter", () => {
    expect(parsedKeyToTmuxKey(parseKeyExpr("enter"))).toBe("Enter")
  })

  it("tab → Tab", () => {
    expect(parsedKeyToTmuxKey(parseKeyExpr("tab"))).toBe("Tab")
  })

  it("escape → Escape", () => {
    expect(parsedKeyToTmuxKey(parseKeyExpr("escape"))).toBe("Escape")
  })

  it("ctrl+a → C-a", () => {
    expect(parsedKeyToTmuxKey(parseKeyExpr("ctrl+a"))).toBe("C-a")
  })

  it("ctrl+c → C-c", () => {
    expect(parsedKeyToTmuxKey(parseKeyExpr("ctrl+c"))).toBe("C-c")
  })

  it("ctrl+p → C-p", () => {
    expect(parsedKeyToTmuxKey(parseKeyExpr("ctrl+p"))).toBe("C-p")
  })

  it("alt+enter → M-Enter", () => {
    expect(parsedKeyToTmuxKey(parseKeyExpr("alt+enter"))).toBe("M-Enter")
  })

  it("shift+tab → S-Tab", () => {
    expect(parsedKeyToTmuxKey(parseKeyExpr("shift+tab"))).toBe("S-Tab")
  })

  it("ctrl+shift+a → C-S-a", () => {
    expect(parsedKeyToTmuxKey(parseKeyExpr("ctrl+shift+a"))).toBe("C-S-a")
  })

  it("f1 → F1", () => {
    expect(parsedKeyToTmuxKey(parseKeyExpr("f1"))).toBe("F1")
  })

  it("ctrl+f1 → C-F1", () => {
    expect(parsedKeyToTmuxKey(parseKeyExpr("ctrl+f1"))).toBe("C-F1")
  })

  it("up → Up", () => {
    expect(parsedKeyToTmuxKey(parseKeyExpr("up"))).toBe("Up")
  })

  it("backspace → BSpace", () => {
    expect(parsedKeyToTmuxKey(parseKeyExpr("backspace"))).toBe("BSpace")
  })

  it("space → Space", () => {
    expect(parsedKeyToTmuxKey(parseKeyExpr("space"))).toBe("Space")
  })
})

// ============================================================
// parsedKeyToTuiUseKey — tui-use 键名映射
// ============================================================

describe("parsedKeyToTuiUseKey", () => {
  it("enter → enter", () => {
    expect(parsedKeyToTuiUseKey(parseKeyExpr("enter"))).toBe("enter")
  })

  it("ctrl+a → ctrl+a", () => {
    expect(parsedKeyToTuiUseKey(parseKeyExpr("ctrl+a"))).toBe("ctrl+a")
  })

  it("ctrl+c → ctrl+c", () => {
    // 新格式加号: ctrl+c
    expect(parsedKeyToTuiUseKey(parseKeyExpr("ctrl+c"))).toBe("ctrl+c")
  })

  it("alt+enter → alt+enter", () => {
    expect(parsedKeyToTuiUseKey(parseKeyExpr("alt+enter"))).toBe("alt+enter")
  })

  it("shift+tab → shift+tab", () => {
    expect(parsedKeyToTuiUseKey(parseKeyExpr("shift+tab"))).toBe("shift+tab")
  })

  it("up → arrow_up", () => {
    expect(parsedKeyToTuiUseKey(parseKeyExpr("up"))).toBe("arrow_up")
  })

  it("down → arrow_down", () => {
    expect(parsedKeyToTuiUseKey(parseKeyExpr("down"))).toBe("arrow_down")
  })

  it("pageup → page_up", () => {
    expect(parsedKeyToTuiUseKey(parseKeyExpr("pageup"))).toBe("page_up")
  })

  it("f1 → f1", () => {
    expect(parsedKeyToTuiUseKey(parseKeyExpr("f1"))).toBe("f1")
  })

  it("ctrl+f1 → ctrl+f1", () => {
    expect(parsedKeyToTuiUseKey(parseKeyExpr("ctrl+f1"))).toBe("ctrl+f1")
  })

  it("a → a (单字母)", () => {
    expect(parsedKeyToTuiUseKey(parseKeyExpr("a"))).toBe("a")
  })

  it("alt+up → alt+arrow_up", () => {
    expect(parsedKeyToTuiUseKey(parseKeyExpr("alt+up"))).toBe("alt+arrow_up")
  })

  it("shift+down → shift+arrow_down", () => {
    expect(parsedKeyToTuiUseKey(parseKeyExpr("shift+down"))).toBe("shift+arrow_down")
  })
})

// ============================================================
// isValidKey — 校验函数
// ============================================================

describe("isValidKey", () => {
  it("向后兼容: 旧白名单按键仍然有效", () => {
    expect(isValidKey("enter")).toBe(true)
    expect(isValidKey("ctrl-c")).toBe(true)  // 旧连字符格式
    expect(isValidKey("up")).toBe(true)
    expect(isValidKey("tab")).toBe(true)
  })

  it("新格式: ctrl+a ~ ctrl+z 有效", () => {
    expect(isValidKey("ctrl+a")).toBe(true)
    expect(isValidKey("ctrl+p")).toBe(true)
    expect(isValidKey("ctrl+f")).toBe(true)
  })

  it("新格式: 功能键有效", () => {
    expect(isValidKey("f1")).toBe(true)
    expect(isValidKey("f12")).toBe(true)
  })

  it("新格式: alt/shift 组合有效", () => {
    expect(isValidKey("alt+enter")).toBe(true)
    expect(isValidKey("shift+tab")).toBe(true)
  })

  it("新格式: 多修饰组合有效", () => {
    expect(isValidKey("ctrl+shift+f")).toBe(true)
    expect(isValidKey("ctrl+alt+enter")).toBe(true)
  })

  it("新格式: ctrl+功能键有效", () => {
    expect(isValidKey("ctrl+f1")).toBe(true)
    expect(isValidKey("ctrl+f12")).toBe(true)
  })

  it("无效按键返回 false", () => {
    expect(isValidKey("invalid")).toBe(false)
    expect(isValidKey("")).toBe(false)
    expect(isValidKey("f13")).toBe(false)
    expect(isValidKey("meta+a")).toBe(false)
  })
})

// ============================================================
// SUPPORTED_KEYS — 向后兼容列表
// ============================================================

describe("SUPPORTED_KEYS", () => {
  it("包含所有旧版本按键", () => {
    const oldKeys = [
      "enter", "tab", "escape", "backspace", "delete",
      "ctrl-c", "ctrl-d", "ctrl-l",
      "up", "down", "left", "right",
      "home", "end", "pageup", "pagedown", "space",
    ]
    for (const key of oldKeys) {
      expect(SUPPORTED_KEYS).toContain(key)
    }
  })

  it("包含 ctrl+a ~ ctrl+z", () => {
    for (let i = 0; i < 26; i++) {
      const letter = String.fromCharCode(97 + i) // a-z
      expect(SUPPORTED_KEYS).toContain(`ctrl-${letter}`)
    }
  })

  it("包含 f1 ~ f12", () => {
    for (let i = 1; i <= 12; i++) {
      expect(SUPPORTED_KEYS).toContain(`f${i}`)
    }
  })

  it("包含常见修饰组合", () => {
    expect(SUPPORTED_KEYS).toContain("alt+enter")
    expect(SUPPORTED_KEYS).toContain("shift+tab")
    expect(SUPPORTED_KEYS).toContain("ctrl+f1")
  })
})

// ============================================================
// keyExprToTmuxKey / keyExprToTuiUseKey — 便捷入口
// ============================================================

describe("keyExprToTmuxKey", () => {
  it("ctrl+p → C-p", () => {
    expect(keyExprToTmuxKey("ctrl+p")).toBe("C-p")
  })

  it("f1 → F1", () => {
    expect(keyExprToTmuxKey("f1")).toBe("F1")
  })
})

describe("keyExprToTuiUseKey", () => {
  it("ctrl+a → ctrl+a", () => {
    expect(keyExprToTuiUseKey("ctrl+a")).toBe("ctrl+a")
  })

  it("alt+enter → alt+enter", () => {
    expect(keyExprToTuiUseKey("alt+enter")).toBe("alt+enter")
  })
})

// ============================================================
// 边界输入 — 表驱动测试
// ============================================================

describe("边界输入 (表驱动)", () => {
  const edgeCases = [
    { input: "ctrl+shift+tab", desc: "三键组合", expectValid: true },
    { input: "alt+shift+f1", desc: "alt+shift+功能键", expectValid: true },
    { input: "  enter  ", desc: "前后空格", expectValid: true },
    { input: "ctrl+ctrl+a", desc: "重复修饰键", expectValid: false },
    { input: "ctrl+", desc: "缺少键名", expectValid: false },
    { input: "+enter", desc: "缺少修饰键", expectValid: false },
    { input: "unknown_key", desc: "未知键名", expectValid: false },
  ]

  describe("parseKeyExpr 边界", () => {
    for (const { input, desc, expectValid } of edgeCases) {
      const should = expectValid ? "正常解析" : "抛出 InvalidKeyExprError"
      it(`${desc}: "${input}" → ${should}`, () => {
        if (expectValid) {
          const parsed = parseKeyExpr(input)
          expect(parsed).toBeDefined()
          expect(parsed.key).toBeDefined()
        } else {
          expect(() => parseKeyExpr(input)).toThrow(InvalidKeyExprError)
        }
      })
    }
  })

  describe("keyExprToAnsiSequence 边界", () => {
    it("ctrl+shift+tab 编码包含 ;6 修饰符 (ctrl=4+shift=1=5 → 1-based=6)", () => {
      const seq = keyExprToAnsiSequence("ctrl+shift+tab")
      // ctrl(4)+shift(1)=5, SGR 1-based = 6
      expect(seq).toContain(";6")
    })

    it("alt+shift+f1 编码包含 SS3 修饰符", () => {
      const seq = keyExprToAnsiSequence("alt+shift+f1")
      // f1 是 SS3 (ESC OP), 修饰键: alt(2)+shift(1)=3, 1-based=4
      // 格式: ESC O 4 P
      expect(seq).toMatch(/^\x1bO\d+P$/)
    })

    it("前后空格的 enter 正常编码为 \\r", () => {
      expect(keyExprToAnsiSequence("  enter  ")).toBe("\r")
    })
  })
})
