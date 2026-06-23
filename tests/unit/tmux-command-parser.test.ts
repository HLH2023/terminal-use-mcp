/**
 * tmux-command-parser.ts 单元测试
 *
 * 覆盖：基本解析、target 解析、注入检测、禁止命令、
 * 别名合并（copy mode/scroll, send keys）、错误处理
 */

import { describe, it, expect } from "vitest"
import {
  parseTmuxCommand,
  containsInjection,
  parseTarget,
  parseAttachTarget,
} from "../../src/terminal/tmux-command-parser.js"
import type { TmuxCommandParseResult } from "../../src/terminal/tmux-command-parser.js"

// ============================================================
// 辅助：断言 ok=true 的结果并提取 AST
// ============================================================

/** 断言解析成功，返回 AST */
function assertOk(result: TmuxCommandParseResult) {
  expect(result.ok).toBe(true)
  if (result.ok) return result.ast
  // vitest 不会执行到这里，但帮助类型收窄
  throw new Error("Unexpected parse failure")
}

// ============================================================
// containsInjection
// ============================================================

describe("containsInjection", () => {
  it("allows clean input", () => {
    expect(containsInjection("list tree")).toBe(false)
    expect(containsInjection("attach pane %3")).toBe(false)
  })

  it("detects semicolon", () => {
    expect(containsInjection("list tree; kill session main")).toBe(true)
  })

  it("detects pipe", () => {
    expect(containsInjection("list tree | cat /etc/passwd")).toBe(true)
  })

  it("detects ampersand", () => {
    expect(containsInjection("list tree &")).toBe(true)
  })

  it("detects redirect >", () => {
    expect(containsInjection("list tree > /tmp/out")).toBe(true)
  })

  it("detects backtick", () => {
    expect(containsInjection("list `rm -rf /`")).toBe(true)
  })

  it("detects $() subshell", () => {
    expect(containsInjection("list $(whoami)")).toBe(true)
  })

  it("detects -- (double dash)", () => {
    expect(containsInjection("list --help")).toBe(true)
  })

  it("detects newline", () => {
    expect(containsInjection("list tree\nkill session main")).toBe(true)
  })
})

// ============================================================
// parseTarget
// ============================================================

describe("parseTarget", () => {
  it("parses pane target %3", () => {
    expect(parseTarget("%3")).toEqual({ type: "pane", id: "%3" })
  })

  it("parses window target @2", () => {
    expect(parseTarget("@2")).toEqual({ type: "window", id: "@2" })
  })

  it("parses session target (plain name)", () => {
    expect(parseTarget("dev")).toEqual({ type: "session", name: "dev" })
  })
})

// ============================================================
// parseAttachTarget
// ============================================================

describe("parseAttachTarget", () => {
  it("parses session name", () => {
    expect(parseAttachTarget("dev")).toEqual({ type: "session", name: "dev" })
  })

  it("parses session:window format", () => {
    expect(parseAttachTarget("dev:1")).toEqual({
      type: "window",
      session: "dev",
      window: "1",
    })
  })

  it("parses pane ID", () => {
    expect(parseAttachTarget("%3")).toEqual({ type: "pane", paneId: "%3" })
  })
})

// ============================================================
// parseTmuxCommand — 基本解析
// ============================================================

describe("parseTmuxCommand", () => {
  // ---- list ----
  it("parses 'list tree'", () => {
    const ast = assertOk(parseTmuxCommand("list tree"))
    expect(ast.kind).toBe("list")
    if (ast.kind === "list") {
      expect(ast.scope).toBe("tree")
    }
  })

  it("parses 'list sessions'", () => {
    const ast = assertOk(parseTmuxCommand("list sessions"))
    expect(ast.kind).toBe("list")
    if (ast.kind === "list") {
      expect(ast.scope).toBe("sessions")
    }
  })

  it("parses 'list windows'", () => {
    const ast = assertOk(parseTmuxCommand("list windows"))
    expect(ast.kind).toBe("list")
    if (ast.kind === "list") {
      expect(ast.scope).toBe("windows")
    }
  })

  it("parses 'list panes'", () => {
    const ast = assertOk(parseTmuxCommand("list panes"))
    expect(ast.kind).toBe("list")
    if (ast.kind === "list") {
      expect(ast.scope).toBe("panes")
    }
  })

  it("parses 'list session dev' (alias + target)", () => {
    const ast = assertOk(parseTmuxCommand("list session dev"))
    expect(ast.kind).toBe("list")
    if (ast.kind === "list") {
      expect(ast.scope).toBe("sessions")
      expect(ast.target).toEqual({ type: "session", name: "dev" })
    }
  })

  it("parses 'list sessions search myproject'", () => {
    const ast = assertOk(parseTmuxCommand("list sessions search myproject"))
    expect(ast.kind).toBe("list")
    if (ast.kind === "list") {
      expect(ast.scope).toBe("sessions")
      expect(ast.search).toBe("myproject")
    }
  })

  // ---- search (list 快捷方式) ----
  it("parses 'search dev' as list sessions with search", () => {
    const ast = assertOk(parseTmuxCommand("search dev"))
    expect(ast.kind).toBe("list")
    if (ast.kind === "list") {
      expect(ast.scope).toBe("sessions")
      expect(ast.search).toBe("dev")
    }
  })

  it("parses 'search sessions dev' with explicit scope", () => {
    const ast = assertOk(parseTmuxCommand("search sessions dev"))
    expect(ast.kind).toBe("list")
    if (ast.kind === "list") {
      expect(ast.scope).toBe("sessions")
      expect(ast.search).toBe("dev")
    }
  })

  // ---- attach ----
  it("parses 'attach session dev'", () => {
    const ast = assertOk(parseTmuxCommand("attach session dev"))
    expect(ast.kind).toBe("attach")
    if (ast.kind === "attach") {
      expect(ast.target).toEqual({ type: "session", name: "dev" })
    }
  })

  it("parses 'attach window dev:1'", () => {
    const ast = assertOk(parseTmuxCommand("attach window dev:1"))
    expect(ast.kind).toBe("attach")
    if (ast.kind === "attach") {
      expect(ast.target).toEqual({
        type: "window",
        session: "dev",
        window: "1",
      })
    }
  })

  it("parses 'attach pane %3'", () => {
    const ast = assertOk(parseTmuxCommand("attach pane %3"))
    expect(ast.kind).toBe("attach")
    if (ast.kind === "attach") {
      expect(ast.target).toEqual({ type: "pane", paneId: "%3" })
    }
  })

  // ---- new ----
  it("parses 'new session dev'", () => {
    const ast = assertOk(parseTmuxCommand("new session dev"))
    expect(ast.kind).toBe("new")
    if (ast.kind === "new") {
      expect(ast.entity).toBe("session")
      expect(ast.name).toBe("dev")
    }
  })

  it("parses 'new window editor'", () => {
    const ast = assertOk(parseTmuxCommand("new window editor"))
    expect(ast.kind).toBe("new")
    if (ast.kind === "new") {
      expect(ast.entity).toBe("window")
      expect(ast.name).toBe("editor")
    }
  })

  it("parses 'new window editor in dev'", () => {
    const ast = assertOk(parseTmuxCommand("new window editor in dev"))
    expect(ast.kind).toBe("new")
    if (ast.kind === "new" && ast.entity === "window") {
      expect(ast.name).toBe("editor")
      expect(ast.target).toEqual({ type: "session", name: "dev" })
    }
  })

  it("parses 'new window editor with vim'", () => {
    const ast = assertOk(parseTmuxCommand("new window editor with vim"))
    expect(ast.kind).toBe("new")
    if (ast.kind === "new" && ast.entity === "window") {
      expect(ast.name).toBe("editor")
      expect(ast.command).toBe("vim")
    }
  })

  it("parses 'new pane split horizontal'", () => {
    const ast = assertOk(parseTmuxCommand("new pane split horizontal"))
    expect(ast.kind).toBe("new")
    if (ast.kind === "new" && ast.entity === "pane") {
      expect(ast.splitDirection).toBe("horizontal")
    }
  })

  it("parses 'new pane split vertical in %3'", () => {
    const ast = assertOk(parseTmuxCommand("new pane split vertical in %3"))
    expect(ast.kind).toBe("new")
    if (ast.kind === "new" && ast.entity === "pane") {
      expect(ast.splitDirection).toBe("vertical")
      expect(ast.target).toEqual({ type: "pane", id: "%3" })
    }
  })

  // ---- kill ----
  it("parses 'kill session dev'", () => {
    const ast = assertOk(parseTmuxCommand("kill session dev"))
    expect(ast.kind).toBe("kill")
    if (ast.kind === "kill") {
      expect(ast.entity).toBe("session")
      expect(ast.target).toEqual({ type: "session", name: "dev" })
    }
  })

  it("parses 'kill pane %3'", () => {
    const ast = assertOk(parseTmuxCommand("kill pane %3"))
    expect(ast.kind).toBe("kill")
    if (ast.kind === "kill") {
      expect(ast.entity).toBe("pane")
      expect(ast.target).toEqual({ type: "pane", id: "%3" })
    }
  })

  it("parses 'kill window @2'", () => {
    const ast = assertOk(parseTmuxCommand("kill window @2"))
    expect(ast.kind).toBe("kill")
    if (ast.kind === "kill") {
      expect(ast.entity).toBe("window")
      expect(ast.target).toEqual({ type: "window", id: "@2" })
    }
  })

  // ---- rename ----
  it("parses 'rename window @2 editor'", () => {
    const ast = assertOk(parseTmuxCommand("rename window @2 editor"))
    expect(ast.kind).toBe("rename")
    if (ast.kind === "rename") {
      expect(ast.entity).toBe("window")
      expect(ast.target).toEqual({ type: "window", id: "@2" })
      expect(ast.newName).toBe("editor")
    }
  })

  it("parses 'rename session dev newdev'", () => {
    const ast = assertOk(parseTmuxCommand("rename session dev newdev"))
    expect(ast.kind).toBe("rename")
    if (ast.kind === "rename") {
      expect(ast.entity).toBe("session")
      expect(ast.newName).toBe("newdev")
    }
  })

  // ---- select ----
  it("parses 'select pane %4'", () => {
    const ast = assertOk(parseTmuxCommand("select pane %4"))
    expect(ast.kind).toBe("select")
    if (ast.kind === "select") {
      expect(ast.entity).toBe("pane")
      expect(ast.target).toEqual({ type: "pane", id: "%4" })
    }
  })

  it("parses 'select window @2'", () => {
    const ast = assertOk(parseTmuxCommand("select window @2"))
    expect(ast.kind).toBe("select")
    if (ast.kind === "select") {
      expect(ast.entity).toBe("window")
      expect(ast.target).toEqual({ type: "window", id: "@2" })
    }
  })

  // ---- resize ----
  it("parses 'resize pane %3 -x 80 -y 24'", () => {
    const ast = assertOk(parseTmuxCommand("resize pane %3 -x 80 -y 24"))
    expect(ast.kind).toBe("resize")
    if (ast.kind === "resize") {
      expect(ast.entity).toBe("pane")
      expect(ast.target).toEqual({ type: "pane", id: "%3" })
      expect(ast.width).toBe(80)
      expect(ast.height).toBe(24)
    }
  })

  it("parses 'resize window @2 120x40' (WxH format)", () => {
    const ast = assertOk(parseTmuxCommand("resize window @2 120x40"))
    expect(ast.kind).toBe("resize")
    if (ast.kind === "resize") {
      expect(ast.entity).toBe("window")
      expect(ast.width).toBe(120)
      expect(ast.height).toBe(40)
    }
  })

  it("parses 'resize pane %3 -w 160 -h 50' (-w/-h aliases)", () => {
    const ast = assertOk(parseTmuxCommand("resize pane %3 -w 160 -h 50"))
    expect(ast.kind).toBe("resize")
    if (ast.kind === "resize") {
      expect(ast.width).toBe(160)
      expect(ast.height).toBe(50)
    }
  })

  // ---- copy-mode ----
  it("parses 'copy-mode %3'", () => {
    const ast = assertOk(parseTmuxCommand("copy-mode %3"))
    expect(ast.kind).toBe("copy-mode")
    if (ast.kind === "copy-mode") {
      expect(ast.target).toEqual({ type: "pane", id: "%3" })
    }
  })

  it("parses 'copy mode %3' (two-word alias)", () => {
    const ast = assertOk(parseTmuxCommand("copy mode %3"))
    expect(ast.kind).toBe("copy-mode")
  })

  // ---- copy-scroll ----
  it("parses 'copy-scroll %3 up 10'", () => {
    const ast = assertOk(parseTmuxCommand("copy-scroll %3 up 10"))
    expect(ast.kind).toBe("copy-scroll")
    if (ast.kind === "copy-scroll") {
      expect(ast.target).toEqual({ type: "pane", id: "%3" })
      expect(ast.direction).toBe("up")
      expect(ast.lines).toBe(10)
    }
  })

  it("parses 'copy scroll %3 down 5' (two-word alias)", () => {
    const ast = assertOk(parseTmuxCommand("copy scroll %3 down 5"))
    expect(ast.kind).toBe("copy-scroll")
    if (ast.kind === "copy-scroll") {
      expect(ast.direction).toBe("down")
      expect(ast.lines).toBe(5)
    }
  })

  // ---- send-keys ----
  it("parses 'send-keys %3 C-c'", () => {
    const ast = assertOk(parseTmuxCommand("send-keys %3 C-c"))
    expect(ast.kind).toBe("send-keys")
    if (ast.kind === "send-keys") {
      expect(ast.target).toEqual({ type: "pane", id: "%3" })
      expect(ast.keys).toBe("C-c")
      expect(ast.literal).toBe(false)
    }
  })

  it("parses 'send-keys %3 hello -l' (literal mode)", () => {
    const ast = assertOk(parseTmuxCommand("send-keys %3 hello -l"))
    expect(ast.kind).toBe("send-keys")
    if (ast.kind === "send-keys") {
      expect(ast.keys).toBe("hello")
      expect(ast.literal).toBe(true)
    }
  })

  it("parses 'send keys %3 Enter' (two-word alias)", () => {
    const ast = assertOk(parseTmuxCommand("send keys %3 Enter"))
    expect(ast.kind).toBe("send-keys")
    if (ast.kind === "send-keys") {
      expect(ast.keys).toBe("Enter")
    }
  })

  // ---- paste ----
  it("parses 'paste %3 hello world'", () => {
    const ast = assertOk(parseTmuxCommand("paste %3 hello world"))
    expect(ast.kind).toBe("paste")
    if (ast.kind === "paste") {
      expect(ast.target).toEqual({ type: "pane", id: "%3" })
      expect(ast.text).toBe("hello world")
    }
  })

  // ---- show-info ----
  it("parses 'show-info'", () => {
    const ast = assertOk(parseTmuxCommand("show-info"))
    expect(ast.kind).toBe("show-info")
  })

  // ---- 拒绝无效命令 ----
  it("rejects invalid command", () => {
    const result = parseTmuxCommand("invalid-command foo")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("Unknown command")
    }
  })

  it("rejects empty command", () => {
    const result = parseTmuxCommand("")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("Empty")
    }
  })

  it("rejects whitespace-only command", () => {
    const result = parseTmuxCommand("   ")
    expect(result.ok).toBe(false)
  })

  // ---- 注入检测 ----
  it("rejects semicolon injection", () => {
    const result = parseTmuxCommand("list tree; kill session main")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("disallowed characters")
    }
  })

  it("rejects pipe injection", () => {
    const result = parseTmuxCommand("list tree | cat /etc/passwd")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("disallowed characters")
    }
  })

  it("rejects backtick injection", () => {
    const result = parseTmuxCommand("list `whoami`")
    expect(result.ok).toBe(false)
  })

  it("rejects $() subshell injection", () => {
    const result = parseTmuxCommand("list $(whoami)")
    expect(result.ok).toBe(false)
  })

  it("rejects && injection", () => {
    const result = parseTmuxCommand("list tree && kill session main")
    expect(result.ok).toBe(false)
  })

  it("rejects newline injection", () => {
    const result = parseTmuxCommand("list tree\nkill session dev")
    expect(result.ok).toBe(false)
  })

  // ---- 禁止命令（在解析层被 UNKNOWN_COMMAND 拒绝） ----
  // 注意：run-shell/if-shell/pipe-pane/source-file 不会被 COMMAND_DISPATCH 匹配
  // 因此它们会报 "Unknown command" 而不是特定的禁止消息
  it("rejects run-shell (unknown command)", () => {
    const result = parseTmuxCommand("run-shell 'rm -rf /'")
    // run-shell 含有 ' 和 -- ，可能被注入检测拦截；也可能走 unknown command
    expect(result.ok).toBe(false)
  })

  it("rejects if-shell (unknown command)", () => {
    const result = parseTmuxCommand("if-shell 'true' 'echo hi'")
    expect(result.ok).toBe(false)
  })

  it("rejects pipe-pane (unknown command)", () => {
    const result = parseTmuxCommand("pipe-pane 'cat'")
    expect(result.ok).toBe(false)
  })

  it("rejects source-file (unknown command)", () => {
    const result = parseTmuxCommand("source-file ~/.tmux.conf")
    expect(result.ok).toBe(false)
  })

  // ---- 参数不足错误 ----
  it("rejects 'list' without scope", () => {
    const result = parseTmuxCommand("list")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("scope")
    }
  })

  it("rejects 'attach' without entity and target", () => {
    const result = parseTmuxCommand("attach")
    expect(result.ok).toBe(false)
  })

  it("rejects 'new' without entity", () => {
    const result = parseTmuxCommand("new")
    expect(result.ok).toBe(false)
  })

  it("rejects 'new session' without name", () => {
    const result = parseTmuxCommand("new session")
    expect(result.ok).toBe(false)
  })

  it("rejects 'new window' without name", () => {
    const result = parseTmuxCommand("new window")
    expect(result.ok).toBe(false)
  })

  it("rejects 'kill' without entity and target", () => {
    const result = parseTmuxCommand("kill")
    expect(result.ok).toBe(false)
  })

  it("rejects 'rename' without enough args", () => {
    const result = parseTmuxCommand("rename session dev")
    expect(result.ok).toBe(false)
  })

  it("rejects 'select' without enough args", () => {
    const result = parseTmuxCommand("select")
    expect(result.ok).toBe(false)
  })

  it("rejects 'resize' without enough args", () => {
    const result = parseTmuxCommand("resize")
    expect(result.ok).toBe(false)
  })

  it("rejects 'copy-mode' without target", () => {
    const result = parseTmuxCommand("copy-mode")
    expect(result.ok).toBe(false)
  })

  it("rejects 'copy-scroll' without enough args", () => {
    const result = parseTmuxCommand("copy-scroll %3")
    expect(result.ok).toBe(false)
  })

  it("rejects 'copy-scroll' with invalid direction", () => {
    const result = parseTmuxCommand("copy-scroll %3 sideways 5")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("direction")
    }
  })

  it("rejects 'copy-scroll' with zero lines", () => {
    const result = parseTmuxCommand("copy-scroll %3 up 0")
    expect(result.ok).toBe(false)
  })

  it("rejects 'send-keys' without target and keys", () => {
    const result = parseTmuxCommand("send-keys")
    expect(result.ok).toBe(false)
  })

  it("rejects 'send-keys' with target but no keys", () => {
    const result = parseTmuxCommand("send-keys %3")
    expect(result.ok).toBe(false)
  })

  it("rejects 'paste' without target and text", () => {
    const result = parseTmuxCommand("paste")
    expect(result.ok).toBe(false)
  })

  // ---- attach entity/target 类型不匹配 ----
  it("rejects 'attach session %3' (type mismatch)", () => {
    const result = parseTmuxCommand("attach session %3")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("session")
    }
  })

  it("rejects 'attach window %3' (type mismatch)", () => {
    const result = parseTmuxCommand("attach window %3")
    expect(result.ok).toBe(false)
  })

  it("rejects 'attach pane dev' (type mismatch)", () => {
    const result = parseTmuxCommand("attach pane dev")
    expect(result.ok).toBe(false)
  })

  // ---- select 只允许 window/pane ----
  it("rejects 'select session dev' (invalid entity)", () => {
    const result = parseTmuxCommand("select session dev")
    expect(result.ok).toBe(false)
  })
})
