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
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "../logger.js";
import type { ProviderExecutor } from "./tool-helpers.js";
export declare function registerPressTool(server: McpServer, executor: ProviderExecutor, logger: Logger): void;
