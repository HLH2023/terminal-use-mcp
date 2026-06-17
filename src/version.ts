/**
 * terminal-use-mcp 版本号 — 单一事实源。
 *
 * 所有需要版本号的地方（McpServer 构造、health tool、npm publish）
 * 统一从此文件读取，避免散落在多个文件中手动同步。
 */

export const VERSION = "0.2.0"
