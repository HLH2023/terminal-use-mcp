/**
 * MCP Stdio Smoke Test — 最小化验证服务器启动和基本协议响应
 *
 * 通过 child_process.spawn 启动服务器进程，
 * 验证 stdout 只包含 MCP 协议消息、initialize 响应正确、
 * shutdown 处理优雅、stderr 包含日志。
 */

import { describe, it, expect } from "vitest"
import { spawn, type ChildProcess } from "node:child_process"

// ── Server 启动辅助 ────────────────────────────────────────

/** 启动 MCP server 子进程 */
function spawnServer(): ChildProcess {
  return spawn("npx", ["tsx", "src/index.ts"], {
    cwd: "/home/hlh/dev/homelab-terminal-use/tools/local/terminal-use-mcp",
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      TERMINAL_USE_WORKSPACE_ROOT: "/tmp",
      TERMINAL_USE_LOG_LEVEL: "info",
      TERMINAL_USE_ARTIFACT_DIR: "/tmp/terminal-use-mcp-test-artifacts",
      TERMINAL_USE_HOSTS_CONFIG: "/tmp/terminal-use-mcp-test-empty-hosts.json",
    },
  })
}

/** 从 stdout 读取一行 JSON-RPC 响应 */
function readLineFromStdout(server: ChildProcess, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = ""
    const timer = setTimeout(() => {
      server.stdout!.removeListener("data", onData)
      reject(new Error(`Timeout. Buffer: ${buffer}`))
    }, timeoutMs)

    function onData(chunk: Buffer): void {
      buffer += chunk.toString()
      const lines = buffer.split("\n").filter(Boolean)
      if (lines.length > 0) {
        // 返回第一个完整行
        clearTimeout(timer)
        server.stdout!.removeListener("data", onData)
        // 移除后续 listener 避免泄漏
        resolve(lines[0])
      }
    }

    server.stdout!.on("data", onData)
  })
}

/** 收集 stderr 输出 */
function collectStderr(server: ChildProcess, durationMs = 2_000): Promise<string> {
  return new Promise((resolve) => {
    let buffer = ""
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString()
    }
    server.stderr!.on("data", onData)

    setTimeout(() => {
      server.stderr!.removeListener("data", onData)
      resolve(buffer)
    }, durationMs)
  })
}

/** 发送 JSON-RPC 请求并等待响应 */
async function sendRequest(
  server: ChildProcess,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  const request = JSON.stringify({
    jsonrpc: "2.0",
    id: Date.now(),
    method,
    params,
  }) + "\n"

  const responsePromise = readLineFromStdout(server, timeoutMs)
  server.stdin!.write(request)
  const line = await responsePromise
  return JSON.parse(line) as Record<string, unknown>
}

// ════════════════════════════════════════════════════════════
// 测试套件
// ════════════════════════════════════════════════════════════

describe("MCP Stdio Smoke", () => {
  it("服务器启动后 stdout 只输出 MCP 协议消息（不污染）", async () => {
    const server = spawnServer()
    // 等待短时间，检查 stdout 没有非 MCP 输出
    const stdoutPromise = new Promise<string>((resolve) => {
      let data = ""
      const timer = setTimeout(() => {
        server.stdout!.removeListener("data", onData)
        resolve(data)
      }, 1_500)

      function onData(chunk: Buffer): void {
        data += chunk.toString()
        // 如果收到内容，检查是否为合法 JSON
        if (data.trim().length > 0) {
          clearTimeout(timer)
          server.stdout!.removeListener("data", onData)
          resolve(data)
        }
      }

      server.stdout!.on("data", onData)
    })

    // 发送 initialize 以触发服务器响应
    await new Promise<void>((resolve) => setTimeout(resolve, 500))
    const response = await sendRequest(server, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "0.1.0" },
    })

    // stdout 输出应该是合法 JSON-RPC 响应
    const stdoutData = await stdoutPromise
    if (stdoutData.trim().length > 0) {
      // 所有 stdout 行都应可解析为 JSON
      const lines = stdoutData.trim().split("\n").filter(Boolean)
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow()
      }
    }

    // initialize 响应本身必须是合法 JSON-RPC
    expect(response.jsonrpc).toBe("2.0")
    expect(response.result).toBeDefined()

    server.kill("SIGTERM")
  })

  it("服务器对 initialize 请求返回正确的 protocol version", async () => {
    const server = spawnServer()
    await new Promise<void>((resolve) => setTimeout(resolve, 500))

    const response = await sendRequest(server, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "0.1.0" },
    })

    expect(response.error).toBeUndefined()
    const result = response.result as Record<string, unknown>
    expect(result).toBeDefined()
    // MCP SDK 返回协议版本
    expect(result.protocolVersion).toBeDefined()
    // 服务器信息包含 name 和 version
    const serverInfo = result.serverInfo as Record<string, string>
    expect(serverInfo.name).toBe("terminal-use-mcp")
    expect(serverInfo.version).toBe("0.2.0")

    server.kill("SIGTERM")
  })

  it("服务器通过 SIGTERM 优雅退出", async () => {
    const server = spawnServer()
    await new Promise<void>((resolve) => setTimeout(resolve, 500))

    // 先 initialize 确认服务器正常运行
    const response = await sendRequest(server, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "0.1.0" },
    })
    expect(response.error).toBeUndefined()

    // 发送 SIGTERM
    server.kill("SIGTERM")

    // 进程应正常退出 (code 0 或 null 被信号杀死)
    const exitCode = await new Promise<number | null>((resolve) => {
      server.on("exit", (code) => resolve(code))
      setTimeout(() => {
        server.kill("SIGKILL")
        resolve(-1)
      }, 5_000)
    })

    // exit code 0 = 正常退出; null = 被信号终止也是可接受的
    expect(exitCode === 0 || exitCode === null).toBe(true)
  })

  it("stderr 包含日志输出", async () => {
    const server = spawnServer()
    await new Promise<void>((resolve) => setTimeout(resolve, 500))

    // 触发 initialize 让服务器输出日志
    await sendRequest(server, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "0.1.0" },
    })

    // 收集 stderr
    const stderrOutput = await collectStderr(server, 2_000)

    // stderr 应包含日志级别标记
    expect(stderrOutput.length).toBeGreaterThan(0)
    // 至少应包含 INFO 或 terminal-use-mcp 相关文本
    expect(stderrOutput.toLowerCase()).toMatch(/info|starting|terminal-use-mcp/)

    server.kill("SIGTERM")
  })
})
