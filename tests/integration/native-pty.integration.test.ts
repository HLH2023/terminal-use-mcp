/**
 * 运行时集成测试 — NativePtyProvider
 *
 * 真实环境验证: node-pty spawn → type → snapshot → kill 全生命周期
 * 依赖: node-pty native 编译产物
 *
 * @module tests/integration/native-pty.integration
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { tmpdir } from "node:os";
import type { TerminalSession } from "../../src/providers/provider.js";

/** 检测 node-pty native 编译产物是否存在 */
function isNodePtyAvailable(): boolean {
  try { require("node-pty"); return true; } catch { return false; }
}

/**
 * 条件轮询：反复 snapshot 直到屏幕包含预期文本
 * 比固定 sleep 更可靠，不会因环境慢而过早断言
 */
async function waitForScreenText(
  provider: import("../../src/providers/native-pty-provider.js").NativePtyProvider,
  sessionId: string,
  expected: string,
  timeoutMs = 5000,
  intervalMs = 200,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const snapshot = await provider.snapshot(sessionId);
    if (snapshot.screen.includes(expected)) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  // 超时后做一次最终断言，让 vitest 报告实际屏幕内容
  const finalSnap = await provider.snapshot(sessionId);
  expect(finalSnap.screen).toContain(expected);
}

const describe_skipIfNoPty = isNodePtyAvailable() ? describe : describe.skip;

describe_skipIfNoPty("NativePtyProvider 集成测试", () => {
  let provider: import("../../src/providers/native-pty-provider.js").NativePtyProvider;

  beforeAll(async () => {
    const [{ NativePtyProvider }, { createLogger }, { loadConfig }, { SessionManager }] =
      await Promise.all([
        import("../../src/providers/native-pty-provider.js"),
        import("../../src/logger.js"),
        import("../../src/config.js"),
        import("../../src/session-manager.js"),
      ]);
    const config = loadConfig();
    const logger = createLogger();
    const sm = new SessionManager(config, logger);
    provider = new NativePtyProvider(logger);
    sm.registerProvider(provider);
  });

  afterEach(async () => {
    for (const sid of provider.listActiveSessionIds()) {
      try { await provider.kill(sid); } catch { /* 已退出 */ }
    }
  });

  it("provider.isAvailable() 返回 true", async () => {
    expect(await provider.isAvailable()).toBe(true);
  });

  it("provider.name === 'native-pty'", () => {
    expect(provider.name).toBe("native-pty");
  });

  it("start → 创建 bash 会话并返回 TerminalSession", async () => {
    const session: TerminalSession = await provider.start({
      command: "/bin/bash",
      args: ["--norc", "--noprofile"],
      cwd: tmpdir(),
      cols: 80,
      rows: 24,
      env: {},
    });

    expect(session.sessionId).toBeTruthy();
    expect(session.providerName).toBe("native-pty");
    expect(session.status).toBe("running");

    await provider.kill(session.providerSessionId);
  });

  it("start 后 provider.hasSession() 返回 true, kill 后返回 false", async () => {
    const session = await provider.start({
      command: "/bin/bash",
      args: ["--norc", "--noprofile"],
      cwd: tmpdir(),
      cols: 80,
      rows: 24,
      env: {},
    });

    expect(provider.hasSession(session.providerSessionId)).toBe(true);
    await provider.kill(session.providerSessionId);
    expect(provider.hasSession(session.providerSessionId)).toBe(false);
  });

  it("type(echo) → snapshot 能捕获输出", async () => {
    const session = await provider.start({
      command: "/bin/bash",
      args: ["--norc", "--noprofile"],
      cwd: tmpdir(),
      cols: 80,
      rows: 24,
      env: {},
    });

    // 等待 shell 就绪 — 用 waitForText 替代固定 sleep
    await provider.waitForText(session.providerSessionId, "$", {
      text: "$",
      timeoutMs: 5000,
    });

    await provider.type(session.providerSessionId, "echo HELLO_PTY_INT\n");
    await waitForScreenText(provider, session.providerSessionId, "HELLO_PTY_INT");

    await provider.kill(session.providerSessionId);
  });

  it("press(ctrl+c) → 中断前台进程", async () => {
    const session = await provider.start({
      command: "/bin/bash",
      args: ["--norc", "--noprofile"],
      cwd: tmpdir(),
      cols: 80,
      rows: 24,
      env: {},
    });

    // 等待 shell 就绪
    await provider.waitForText(session.providerSessionId, "$", {
      text: "$",
      timeoutMs: 5000,
    });

    await provider.type(session.providerSessionId, "cat\n");
    // 等待 cat 启动 — 用 waitForText 检测 cat 的输入等待状态
    await provider.waitForText(session.providerSessionId, "cat", {
      text: "cat",
      timeoutMs: 3000,
    });

    await provider.press(session.providerSessionId, "ctrl+c", { modifiers: ["ctrl"], key: "c" });
    // ctrl+c 后应回到 shell prompt — 检测 shell 提示符重新出现
    await provider.waitForText(session.providerSessionId, "$", {
      text: "$",
      timeoutMs: 3000,
    });

    const snapshot = await provider.snapshot(session.providerSessionId);
    expect(snapshot.screen).toBeTruthy();

    await provider.kill(session.providerSessionId);
  });

  it("resize → 改变终端尺寸", async () => {
    const session = await provider.start({
      command: "/bin/bash",
      args: ["--norc", "--noprofile"],
      cwd: tmpdir(),
      cols: 80,
      rows: 24,
      env: {},
    });

    // 等待 shell 就绪
    await provider.waitForText(session.providerSessionId, "$", {
      text: "$",
      timeoutMs: 5000,
    });

    await expect(provider.resize(session.providerSessionId, 120, 40)).resolves.toBeUndefined();

    await provider.kill(session.providerSessionId);
  });

  it("kill → 终止会话", async () => {
    const session = await provider.start({
      command: "/bin/bash",
      args: ["--norc", "--noprofile"],
      cwd: tmpdir(),
      cols: 80,
      rows: 24,
      env: {},
    });

    // 等待 shell 就绪
    await provider.waitForText(session.providerSessionId, "$", {
      text: "$",
      timeoutMs: 5000,
    });

    await provider.kill(session.providerSessionId);
  });

  it("snapshot → 不存在的 sessionId 抛出错误", async () => {
    await expect(provider.snapshot("nonexistent-id")).rejects.toThrow();
  });
});
