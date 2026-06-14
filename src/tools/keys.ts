/**
 * terminal.keys — 列出可用按键表达式 (按类别)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import { SUPPORTED_KEYS } from "../terminal/keymap.js"
import { TerminalUseError } from "../terminal/errors.js"

type ToolTextContent = { type: "text"; text: string }
type ToolErrorResult = { content: ToolTextContent[]; isError: true }

/** 按键分类输出 */
type KeyCategoriesOutput = {
  ok: true
  /** 所有已知按键名 (向后兼容) */
  keys: string[]
  /** 按类别分组 */
  categories: {
    basic: string[]
    ctrl_alpha: string[]
    function_keys: string[]
    alt_combos: string[]
    shift_combos: string[]
    ctrl_fn_combos: string[]
  }
  /** 自定义组合表达式格式说明 */
  expression_format: string
}

function errorToToolResult(err: unknown): ToolErrorResult {
  if (err instanceof TerminalUseError) {
    const envelope = err.toEnvelope()
    return { content: [{ type: "text", text: JSON.stringify(envelope) }], isError: true }
  }
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, error: { code: "INTERNAL_ERROR", message: String(err), retryable: false } }) }],
    isError: true,
  }
}

/** 基础按键 */
const BASIC_KEYS = [
  "enter", "tab", "escape", "backspace", "delete",
  "up", "down", "left", "right",
  "home", "end", "pageup", "pagedown", "insert", "space",
]

/** ctrl + 字母 */
const CTRL_ALPHA_KEYS = Array.from({ length: 26 }, (_, i) => `ctrl+${String.fromCharCode(97 + i)}`)

/** 功能键 */
const FN_KEYS = Array.from({ length: 12 }, (_, i) => `f${i + 1}`)

/** 常见 alt 组合 */
const ALT_COMBOS = [
  "alt+enter", "alt+tab",
  "alt+up", "alt+down", "alt+left", "alt+right",
  "alt+a", "alt+b", "alt+f", "alt+d", "alt+p", "alt+n",
]

/** 常见 shift 组合 */
const SHIFT_COMBOS = [
  "shift+tab",
  "shift+up", "shift+down", "shift+left", "shift+right",
]

/** ctrl + 功能键 */
const CTRL_FN_COMBOS = Array.from({ length: 12 }, (_, i) => `ctrl+f${i + 1}`)

const EXPRESSION_FORMAT = [
  'Key expression format: "key" or "modifier+key" or "modifier1+modifier2+key"',
  'Modifiers: ctrl, alt, shift',
  'Examples: "ctrl+a", "ctrl+p", "alt+enter", "shift+tab", "ctrl+shift+f", "f1", "ctrl+f1"',
  'Legacy format (hyphen): "ctrl-c" still works as "ctrl+c"',
  'Single letters "a" through "z" also accepted',
].join(". ")

export function registerKeysTool(server: McpServer): void {
  server.registerTool(
    "terminal.keys",
    {
      description: "List available key expressions for terminal.press, grouped by category. Supports arbitrary modifier+key combinations.",
      inputSchema: {},
    },
    async () => {
      try {
        const output: KeyCategoriesOutput = {
          ok: true,
          keys: [...SUPPORTED_KEYS],
          categories: {
            basic: BASIC_KEYS,
            ctrl_alpha: CTRL_ALPHA_KEYS,
            function_keys: FN_KEYS,
            alt_combos: ALT_COMBOS,
            shift_combos: SHIFT_COMBOS,
            ctrl_fn_combos: CTRL_FN_COMBOS,
          },
          expression_format: EXPRESSION_FORMAT,
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (err) {
        return errorToToolResult(err)
      }
    },
  )
}
