/**
 * 运行时集成测试 — TmuxProvider
 *
 * 真实环境验证: tmux new-session → send-keys → capture-pane 全生命周期
 * 依赖: tmux >= 3.0
 *
 * @module tests/integration/tmux.integration
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import type { TerminalSession } from "../../src/providers/provider.js";

/** 检测 tmux 是否可用 */
function isTmuxAvailable(): boolean {
  try { execFileSync("which", ["tmux"], { encoding: "utf-8" }); return true; } catch { return false; }
}

/**
 * 条件轮询：反复 snapshot 直到屏幕包含预期文本
 * 替代固定 sleep，在快速环境下更快完成，慢环境下更可靠
 */
async function waitForScreenText(
  provider: import("../../src/providers/tmux-provider.js").TmuxProvider,
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

const describe_skipIfNoTmux = isTmuxAvailable() ? describe : describe.skip;

describe_skipIfNoTmux("TmuxProvider 集成测试", () => {
  let provider: import("../../src/providers/tmux-provider.js").TmuxProvider;
  let createdIds: string[] = [];

  beforeAll(async () => {
    const [{ TmuxProvider }, { createLogger }, { loadConfig }, { SessionManager }] =
      await Promise.all([
        import("../../src/providers/tmux-provider.js"),
        import("../../src/logger.js"),
        import("../../src/config.js"),
        import("../../src/session-manager.js"),
      ]);
    const config = loadConfig();
    const logger = createLogger();
    const sm = new SessionManager(config, logger);
    provider = new TmuxProvider(logger);
    sm.registerProvider(provider);
  });

  afterEach(async () => {
    for (const id of createdIds) {
      try { await provider.kill(id); } catch { /* 已退出 */ }
      try { execFileSync("tmux", ["kill-session", "-t", id], { timeout: 3000 }); } catch { /* 已不存在 */ }
    }
    createdIds = [];
  });

  it("provider.isAvailable() 返回 true", async () => {
    expect(await provider.isAvailable()).toBe(true);
  });

  it("provider.name === 'tmux'", () => {
    expect(provider.name).toBe("tmux");
  });

  it("start → 创建 tmux 会话并返回 TerminalSession", async () => {
    const session: TerminalSession = await provider.start({
      command: "/bin/bash",
      args: ["--norc", "--noprofile"],
      cwd: tmpdir(),
      cols: 80,
      rows: 24,
      env: {},
    });

    createdIds.push(session.providerSessionId);
    expect(session.sessionId).toBeTruthy();
    expect(session.providerName).toBe("tmux");
    expect(session.status).toBe("running");

    // 验证 tmux session 确实存在
    const listOutput = execFileSync("tmux", ["list-sessions"], { encoding: "utf-8" });
    expect(listOutput).toContain(session.providerSessionId);
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
    createdIds.push(session.providerSessionId);

    expect(provider.hasSession(session.providerSessionId)).toBe(true);
    await provider.kill(session.providerSessionId);
    createdIds = createdIds.filter((id) => id !== session.providerSessionId);
    expect(provider.hasSession(session.providerSessionId)).toBe(false);
  });

  it("type → send-keys 写入文本到 tmux 会话", async () => {
    const session = await provider.start({
      command: "/bin/bash",
      args: ["--norc", "--noprofile"],
      cwd: tmpdir(),
      cols: 80,
      rows: 24,
      env: {},
    });
    createdIds.push(session.providerSessionId);

    // 等待 shell 就绪
    await provider.waitForText(session.providerSessionId, "$", {
      text: "$",
      timeoutMs: 5000,
    });

    await provider.type(session.providerSessionId, "echo TMUX_INT_OK\n");
    await waitForScreenText(provider, session.providerSessionId, "TMUX_INT_OK");

    // 额外通过 tmux capture-pane 交叉验证
    const capture = execFileSync("tmux", ["capture-pane", "-t", session.providerSessionId, "-p"], { encoding: "utf-8" });
    expect(capture).toContain("TMUX_INT_OK");
  });

  it("press → 发送 Ctrl+C 到 tmux 会话", async () => {
    const session = await provider.start({
      command: "/bin/bash",
      args: ["--norc", "--noprofile"],
      cwd: tmpdir(),
      cols: 80,
      rows: 24,
      env: {},
    });
    createdIds.push(session.providerSessionId);

    // 等待 shell 就绪
    await provider.waitForText(session.providerSessionId, "$", {
      text: "$",
      timeoutMs: 5000,
    });

    await provider.type(session.providerSessionId, "cat\n");
    await provider.waitForText(session.providerSessionId, "cat", {
      text: "cat",
      timeoutMs: 3000,
    });

    await provider.press(session.providerSessionId, "ctrl+c", { modifiers: ["ctrl"], key: "c" });
    // ctrl+c 后 shell prompt 重新出现
    await provider.waitForText(session.providerSessionId, "$", {
      text: "$",
      timeoutMs: 3000,
    });

    // 集成测试只需验证 provider snapshot 有内容（内部已用条件等待替代 sleep)
    const snapshot = await provider.snapshot(session.providerSessionId);
    expect(snapshot.screen.length).toBeGreaterThan(0);
  });

  it("snapshot → 从 tmux 获取屏幕内容", async () => {
    const session = await provider.start({
      command: "/bin/bash",
      args: ["--norc", "--noprofile"],
      cwd: tmpdir(),
      cols: 80,
      rows: 24,
      env: {},
    });
    createdIds.push(session.providerSessionId);

    // 等待 shell 就绪
    await provider.waitForText(session.providerSessionId, "$", {
      text: "$",
      timeoutMs: 5000,
    });

    await provider.type(session.providerSessionId, "echo SNAP_TEST\n");
    await waitForScreenText(provider, session.providerSessionId, "SNAP_TEST");

    const snapshot = await provider.snapshot(session.providerSessionId);
    expect(snapshot.screen).toContain("SNAP_TEST");
  });

  it("resize → 改变 tmux 窗口大小", async () => {
    const session = await provider.start({
      command: "/bin/bash",
      args: ["--norc", "--noprofile"],
      cwd: tmpdir(),
      cols: 80,
      rows: 24,
      env: {},
    });
    createdIds.push(session.providerSessionId);

    // 等待 shell 就绪
    await provider.waitForText(session.providerSessionId, "$", {
      text: "$",
      timeoutMs: 5000,
    });

    await expect(provider.resize(session.providerSessionId, 120, 40)).resolves.toBeUndefined();
  });

  it("kill → 退出 tmux 会话", async () => {
    const session = await provider.start({
      command: "/bin/bash",
      args: ["--norc", "--noprofile"],
      cwd: tmpdir(),
      cols: 80,
      rows: 24,
      env: {},
    });
    createdIds.push(session.providerSessionId);

    // 等待 shell 就绪
    await provider.waitForText(session.providerSessionId, "$", {
      text: "$",
      timeoutMs: 5000,
    });

    await provider.kill(session.providerSessionId);
    createdIds = createdIds.filter((id) => id !== session.providerSessionId);
  });

  it("scroll → 滚动屏幕查看历史输出", async () => {
    const session = await provider.start({
      command: "/bin/bash",
      args: ["--norc", "--noprofile"],
      cwd: tmpdir(),
      cols: 80,
      rows: 24,
      env: {},
    });
    createdIds.push(session.providerSessionId);

    // 等待 shell 就绪
    await provider.waitForText(session.providerSessionId, "$", {
      text: "$",
      timeoutMs: 5000,
    });

    for (let i = 0; i < 5; i++) {
      await provider.type(session.providerSessionId, `echo LINE_${i}\n`);
      // 每行输出用条件轮询确认出现，替代固定 sleep
      await waitForScreenText(
        provider,
        session.providerSessionId,
        `LINE_${i}`,
        3000,
        100,
      );
    }

    await expect(provider.scroll(session.providerSessionId, "up", 3)).resolves.toBeUndefined();
  });
});
