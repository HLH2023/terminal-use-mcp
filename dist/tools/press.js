/**
 * terminal.press — 发送按键到终端
 *
 * 支持任意按键表达式，格式:
 *   - 基础: "enter", "tab", "escape", "up", "down", "f1" 等
 *   - ctrl 组合: "ctrl+a" ~ "ctrl+z" (旧格式 "ctrl-a" 仍兼容)
 *   - alt 组合: "alt+enter", "alt+up"
 *   - shift 组合: "shift+tab", "shift+up"
 *   - 多修饰: "ctrl+shift+f", "alt+shift+tab"
 *   - 功能键: "f1" ~ "f12", "ctrl+f1"
 *   - 单字符: "a" ~ "z"
 */
import { z } from "zod";
import { parseKeyExpr, InvalidKeyExprError } from "../terminal/keymap.js";
import { InvalidKeyError } from "../terminal/errors.js";
import { errorToToolResult, okToolResult } from "./tool-helpers.js";
export function registerPressTool(server, executor, logger) {
    server.registerTool("terminal.press", {
        description: "Press a key or key combination in the terminal. " +
            "Supports arbitrary key expressions: basic keys (enter, tab, escape, up, down, f1-f12), " +
            "ctrl combos (ctrl+a through ctrl+z), alt combos (alt+enter), shift combos (shift+tab), " +
            "and multi-modifier combos (ctrl+shift+f). Legacy hyphenated format (ctrl-c) still works.",
        inputSchema: {
            sessionId: z.string().min(1).describe("Session ID from terminal.start — use exact value"),
            key: z.string().min(1).describe('Key expression. Examples: "enter", "ctrl+a", "ctrl+p", "alt+enter", "shift+tab", "f1", "ctrl+f1". ' +
                'Legacy format "ctrl-c" also works. Use terminal.keys to see common key names.'),
        },
    }, async (input) => {
        try {
            // 使用新解析器: 支持任意按键表达式
            let parsed;
            try {
                parsed = parseKeyExpr(input.key);
            }
            catch (err) {
                if (err instanceof InvalidKeyExprError) {
                    throw new InvalidKeyError(input.key);
                }
                throw err;
            }
            await executor.executePress(input.sessionId, input.key, parsed);
            const output = { ok: true, parsed };
            logger.debug("terminal key pressed", { sessionId: input.sessionId, key: input.key, parsed });
            return okToolResult(`Pressed ${input.key} in ${input.sessionId}`, output);
        }
        catch (err) {
            return errorToToolResult(err);
        }
    });
}
