#!/usr/bin/env npx tsx
/**
 * terminal-use-mcp E2E 联调脚本
 *
 * 模拟一个真实 Agent 通过 stdio 协议调用 MCP Server 的完整流程：
 *   1. spawn MCP server 子进程
 *   2. MCP handshake (initialize → initialized)
 *   3. tools/list — 列出所有 tools
 *   4. terminal.start — 创建 bash 会话
 *   5. terminal.type — 输入命令
 *   6. terminal.snapshot — 获取屏幕快照
 *   7. terminal.press — 发送 Ctrl-C
 *   8. terminal.kill — 终止会话
 *
 * 使用方法:
 *   npx tsx scripts/e2e-client.ts
 *   npx tsx scripts/e2e-client.ts --provider tmux
 *
 * @module scripts/e2e-client
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ─── 配置 ──────────────────────────────────────────────────────────────────
const PROVIDER = process.argv.includes("--provider")
  ? (process.argv[process.argv.indexOf("--provider") + 1] ?? "native-pty")
  : "native-pty";

const SERVER_COMMAND = "node";
const SERVER_ARGS = ["--import", "tsx", "src/index.ts"];

/** 工具调用辅助: 发送 tools/call 并打印结果 */
async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  console.log(`\n🔧 调用 ${name}`, JSON.stringify(args));
  const result = await client.callTool({ name, arguments: args });
  // result.content 是 TextContent 数组
  const text = result.content
    ?.filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("\n");
  console.log(`📋 响应: ${text?.slice(0, 500) ?? "(empty)"}`);
  // 尝试解析 structuredContent
  if ((result as any).structuredContent) {
    console.log(
      `📊 结构化: ${JSON.stringify((result as any).structuredContent).slice(0, 500)}`
    );
  }
  return result;
}

/** 延时辅助 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── 主流程 ────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀 terminal-use-mcp E2E 联调测试 (provider: ${PROVIDER})`);
  console.log("═".repeat(60));

  // 1. 创建 transport + client
  const transport = new StdioClientTransport({
    command: SERVER_COMMAND,
    args: SERVER_ARGS,
    env: {
      ...process.env,
      TERMINAL_USE_DEFAULT_PROVIDER: PROVIDER,
      TERMINAL_USE_LOG_LEVEL: "info",
    },
  });

  const client = new Client({
    name: "e2e-test-client",
    version: "1.0.0",
  });

  // 2. 连接 (自动完成 initialize + initialized 握手)
  console.log("\n⏳ 连接 MCP server...");
  await client.connect(transport);
  console.log("✅ 连接成功");

  // 3. 列出所有 tools
  console.log("\n⏳ 列出 tools...");
  const toolsResult = await client.listTools();
  console.log(
    `✅ 共 ${toolsResult.tools.length} 个 tools: ${toolsResult.tools.map((t) => t.name).join(", ")}`
  );

  // 4. health 检查
  await callTool(client, "terminal.health");

  // 5. 创建 bash 会话
  const startResult = await callTool(client, "terminal.start", {
    command: "/bin/bash",
    args: ["--norc", "--noprofile"],
    cols: 80,
    rows: 24,
  });

  // 从响应中提取 sessionId
  const startContent = (startResult as any).content?.find(
    (c: any) => c.type === "text"
  );
  let sessionId = "";
  if (startContent?.text) {
    try {
      const parsed = JSON.parse(startContent.text);
      sessionId = parsed?.sessionId ?? parsed?.data?.sessionId ?? "";
    } catch {
      // 尝试从 structuredContent 获取
      const sc = (startResult as any).structuredContent;
      sessionId = sc?.sessionId ?? sc?.data?.sessionId ?? "";
    }
  }

  if (!sessionId) {
    console.log("\n❌ 无法获取 sessionId，跳过后续测试");
    await client.close();
    return;
  }

  console.log(`\n🆔 sessionId = ${sessionId}`);

  // 6. 等待 shell 就绪
  await sleep(800);

  // 7. 输入命令
  await callTool(client, "terminal.type", {
    sessionId,
    text: "echo E2E_INTEGRATION_TEST_PASSED\n",
  });

  await sleep(1000);

  // 8. 快照
  await callTool(client, "terminal.snapshot", { sessionId });

  // 9. 等待文本
  await callTool(client, "terminal.wait_for_text", {
    sessionId,
    text: "E2E_INTEGRATION_TEST_PASSED",
    timeoutMs: 3000,
  });

  // 10. 按键 (Ctrl-C)
  await callTool(client, "terminal.type", {
    sessionId,
    text: "cat\n",
  });
  await sleep(400);
  await callTool(client, "terminal.press", {
    sessionId,
    key: "ctrl-c",
  });
  await sleep(500);

  // 11. 列出会话
  await callTool(client, "terminal.list");

  // 12. 终止会话
  await callTool(client, "terminal.kill", { sessionId });

  // 13. 关闭连接
  console.log("\n⏳ 断开连接...");
  await client.close();
  console.log("✅ E2E 联调测试完成");
  console.log("═".repeat(60));
}

main().catch((err) => {
  console.error("❌ E2E 测试失败:", err);
  process.exit(1);
});
