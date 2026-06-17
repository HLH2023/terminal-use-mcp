/**
 * MCP Tools 集成测试 — 通过 JSON-RPC 与服务器进程通信
 *
 * 使用 child_process.spawn 启动 MCP server，
 * 通过 stdin/stdout 交换 JSON-RPC 2.0 消息，
 * 验证 tools/list、tools/call、resources/list、prompts/list。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { spawn, type ChildProcess } from "node:child_process"

// ── JSON-RPC 辅助 ──────────────────────────────────────────

let msgId = 0
function nextId(): number {
  return ++msgId
}

/** 构造 JSON-RPC 2.0 请求 */
function jsonRpcRequest(method: string, params: Record<string, unknown> = {}): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: nextId(),
    method,
    params,
  }) + "\n"
}

/** 从 server stdout 中读取并解析 JSON-RPC 响应 */
function readResponse(server: ChildProcess, timeoutMs = 10_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buffer = ""
    const timer = setTimeout(() => {
      server.stdout!.removeListener("data", onData)
      reject(new Error(`Timeout waiting for response. Buffer so far: ${buffer}`))
    }, timeoutMs)

    function onData(chunk: Buffer): void {
      buffer += chunk.toString()
      // 尝试 parse — MCP 协议每行一个 JSON 对象
      const lines = buffer.split("\n").filter(Boolean)
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line)
          if (parsed.id !== undefined) {
            clearTimeout(timer)
            server.stdout!.removeListener("data", onData)
            resolve(parsed as Record<string, unknown>)
            return
          }
        } catch {
          // 不完整 JSON，继续收集
        }
      }
    }

    server.stdout!.on("data", onData)
  })
}

/** 发送请求并等待响应 */
async function sendAndReceive(
  server: ChildProcess,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  const request = jsonRpcRequest(method, params)
  const responsePromise = readResponse(server, timeoutMs)
  server.stdin!.write(request)
  return responsePromise
}

// ── Server 进程管理 ────────────────────────────────────────

/** 当前测试使用的 server 进程 */
let server: ChildProcess | undefined

/** 启动 MCP server 子进程并执行 initialize 握手 */
async function startServerAndInitialize(): Promise<ChildProcess> {
  const proc = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: "/home/hlh/dev/homelab-terminal-use/tools/local/terminal-use-mcp",
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      TERMINAL_USE_WORKSPACE_ROOT: "/tmp",
      TERMINAL_USE_LOG_LEVEL: "error",
      TERMINAL_USE_ARTIFACT_DIR: "/tmp/terminal-use-mcp-test-artifacts",
      TERMINAL_USE_HOSTS_CONFIG: "/tmp/terminal-use-mcp-test-empty-hosts.json",
    },
  })

  // 等待一点让进程启动
  await new Promise<void>((resolve) => setTimeout(resolve, 500))

  // 执行 MCP initialize 握手
  const initResponse = await sendAndReceive(proc, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-client", version: "0.1.0" },
  })

  expect(initResponse.error).toBeUndefined()
  expect(initResponse.result).toBeDefined()

  // 发送 initialized 通知 (无 id, 无响应期望)
  const notification = JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  }) + "\n"
  proc.stdin!.write(notification)

  // 短暂等待让 server 处理通知
  await new Promise<void>((resolve) => setTimeout(resolve, 200))

  return proc
}

// ════════════════════════════════════════════════════════════
// 测试套件
// ════════════════════════════════════════════════════════════

describe("MCP Tools Integration", () => {
  beforeAll(async () => {
    server = await startServerAndInitialize()
  }, 30_000)

  afterAll(() => {
    if (server !== undefined) {
      server.kill("SIGTERM")
      server = undefined
    }
  })

  // ── tools/list ────────────────────────────────────────
  describe("tools/list", () => {
    it("返回 27 个 tool", async () => {
      const response = await sendAndReceive(server!, "tools/list", {})

      expect(response.error).toBeUndefined()
      const result = response.result as { tools: Array<{ name: string }> }
      expect(result.tools).toBeDefined()
      expect(result.tools.length).toBe(29)
    })

    it("tool 名称与预期列表完全匹配", async () => {
      const expectedToolNames = [
        "terminal.start",
        "terminal.attach",
        "terminal.list",
        "terminal.info",
        "terminal.rename",
        "terminal.kill",
        "terminal.cleanup",
        "terminal.snapshot",
        "terminal.wait_for_text",
        "terminal.wait_stable",
        "terminal.find",
        "terminal.scroll",
        "terminal.type",
        "terminal.press",
        "terminal.paste",
        "terminal.mouse_click",
        "terminal.mouse_scroll",
        "terminal.resize",
        "terminal.export_transcript",
        "terminal.health",
        "terminal.keys",
        "terminal.provider_capabilities",
        "terminal.events",
        "terminal.send_signal",
        "terminal.targets",
        "terminal.target_info",
        "terminal.verify_target",
        "terminal.tmux_list",
        "terminal.tmux_kill",
      ]

      const response = await sendAndReceive(server!, "tools/list", {})
      const result = response.result as { tools: Array<{ name: string }> }
      const actualNames = result.tools.map((t) => t.name).sort()
      const sortedExpected = [...expectedToolNames].sort()
      expect(actualNames).toEqual(sortedExpected)
    })
  })

  // ── tools/call: terminal.health ───────────────────────
  describe("tools/call: terminal.health", () => {
    it("返回结构化响应 with ok: true", async () => {
      const response = await sendAndReceive(server!, "tools/call", {
        name: "terminal.health",
        arguments: {},
      })

      expect(response.error).toBeUndefined()
      const result = response.result as { content: Array<{ type: string; text: string }>; structuredContent: Record<string, unknown> }
      expect(result.structuredContent).toBeDefined()
      expect(result.structuredContent.ok).toBe(true)
      expect(result.structuredContent.version).toBe("0.2.0")
      const providers = result.structuredContent.providers as Record<string, unknown>
      expect(Object.keys(providers).sort()).toEqual(["native-pty", "ssh-pty", "ssh-tmux", "tmux"])
    })
  })

  // ── tools/call: terminal.keys ──────────────────────────
  describe("tools/call: terminal.keys", () => {
    it("返回支持的按键列表", async () => {
      const response = await sendAndReceive(server!, "tools/call", {
        name: "terminal.keys",
        arguments: {},
      })

      expect(response.error).toBeUndefined()
      const result = response.result as { content: Array<{ type: string; text: string }>; structuredContent: Record<string, unknown> }
      expect(result.structuredContent).toBeDefined()
      expect(result.structuredContent.ok).toBe(true)
      const keys = result.structuredContent.keys as string[]
      expect(Array.isArray(keys)).toBe(true)
      expect(keys.length).toBeGreaterThan(0)
      expect(keys).toContain("enter")
      expect(keys).toContain("ctrl-c")
    })
  })

  // ── tools/call: terminal.list ──────────────────────────
  describe("tools/call: terminal.list", () => {
    it("返回空 sessions 数组", async () => {
      const response = await sendAndReceive(server!, "tools/call", {
        name: "terminal.list",
        arguments: {},
      })

      expect(response.error).toBeUndefined()
      const result = response.result as { structuredContent: Record<string, unknown> }
      expect(result.structuredContent).toBeDefined()
      expect(result.structuredContent.ok).toBe(true)
      const sessions = result.structuredContent.sessions as unknown[]
      expect(Array.isArray(sessions)).toBe(true)
      expect(sessions.length).toBe(0)
    })
  })

  // ── resources/list ─────────────────────────────────────
  describe("resources/list", () => {
    it("返回 2 个 resources", async () => {
      const response = await sendAndReceive(server!, "resources/list", {})

      expect(response.error).toBeUndefined()
      const result = response.result as { resources: Array<{ uri: string }> }
      expect(result.resources).toBeDefined()
      expect(result.resources.length).toBe(2)
    })

    it("包含 terminal://sessions 和 terminal://sessions/{sessionId}/transcript", async () => {
      const response = await sendAndReceive(server!, "resources/list", {})
      const result = response.result as { resources: Array<{ uri: string }> }
      const uris = result.resources.map((r) => r.uri)
      expect(uris).toContain("terminal://sessions")
      expect(uris).toContain("terminal://sessions/{sessionId}/transcript")
    })
  })

  // ── prompts/list ───────────────────────────────────────
  describe("prompts/list", () => {
    it("返回 2 个 prompts", async () => {
      const response = await sendAndReceive(server!, "prompts/list", {})

      expect(response.error).toBeUndefined()
      const result = response.result as { prompts: Array<{ name: string }> }
      expect(result.prompts).toBeDefined()
      expect(result.prompts.length).toBe(2)
    })

    it("包含 terminal-use-basic-workflow 和 external-agent-control", async () => {
      const response = await sendAndReceive(server!, "prompts/list", {})
      const result = response.result as { prompts: Array<{ name: string }> }
      const names = result.prompts.map((p) => p.name)
      expect(names).toContain("terminal-use-basic-workflow")
      expect(names).toContain("external-agent-control")
    })
  })

  // ── Error scenario: snapshot with invalid sessionId ──────
  describe("tools/call error: terminal.snapshot with invalid sessionId", () => {
    it("返回包含 SESSION_NOT_FOUND code 的错误", async () => {
      const response = await sendAndReceive(server!, "tools/call", {
        name: "terminal.snapshot",
        arguments: { sessionId: "nonexistent-session-id" },
      })

      // MCP 协议：tool 错误通过 isError 字段标记，不是 JSON-RPC error
      const result = response.result as { content: Array<{ type: string; text: string }>; isError?: boolean }
      expect(result.isError).toBe(true)
      expect(result.content).toBeDefined()
      expect(result.content.length).toBeGreaterThan(0)

      // 解析 content 中的错误信息
      const text = result.content[0].text
      expect(text).toContain("SESSION_NOT_FOUND")
    })
  })
})
