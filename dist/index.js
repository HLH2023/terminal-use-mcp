#!/usr/bin/env node
/**
 * terminal-use-mcp: Local MCP Server for Terminal Computer Use
 *
 * 通过 MCP 协议让开发 agent 控制交互式终端程序。
 * 独立于 HomeLab 主业务，纯本地开发工具。
 *
 * Usage: npx tsx src/index.ts
 * Transport: stdio (stdout = MCP protocol, stderr = logs)
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { SessionManager } from "./session-manager.js";
import { createAndRegisterProviders } from "./providers/provider-registry.js";
import { createMcpServer } from "./mcp-server.js";
import { loadHostsConfig } from "./targets/ssh-host-config.js";
async function main() {
    const config = loadConfig();
    const logger = createLogger(config.logLevel);
    logger.info("terminal-use-mcp starting", {
        version: "0.1.0",
        workspaceRoot: config.workspaceRoot,
        defaultProvider: config.defaultProvider,
    });
    const hostsConfig = await loadHostsConfig(config.hostsConfigPath);
    logger.info("SSH hosts config loaded", {
        profiles: hostsConfig.size,
        customPathConfigured: config.hostsConfigPath !== undefined,
    });
    /* 创建 SessionManager 并注册所有已知 provider；
     * 各 provider 的 isAvailable() 会在首次使用时异步检测。 */
    const sm = new SessionManager(config, logger);
    createAndRegisterProviders(sm, logger, config.enabledProviders);
    if (sm.getProviders().size === 0) {
        logger.error("no terminal providers available");
        process.exit(1);
    }
    /* 启动 TTL 过期清理定时器 */
    sm.startTtlCleanup();
    /* 创建已注册全部 tools/resources/prompts 的 MCP Server */
    const server = createMcpServer(sm, config, hostsConfig, logger);
    /* 连接 stdio transport */
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("terminal-use-mcp server started", {
        transport: "stdio",
        artifactDir: config.artifactDir,
    });
    /* ── 优雅退出 ──
     * SIGINT/SIGTERM → killAllSessions → 停止 TTL → 关闭 MCP → exit(0)
     * 双次信号强制退出：第一次进入清理，第二次立即终止。 */
    let shuttingDown = false;
    const shutdown = async () => {
        if (shuttingDown) {
            process.stderr.write("[terminal-use-mcp] Forced exit (second signal)\n");
            process.exit(1);
        }
        shuttingDown = true;
        logger.info("terminal-use-mcp shutting down");
        try {
            await sm.killAllSessions();
            sm.stopTtlCleanup();
            await server.close();
        }
        catch (err) {
            logger.error("shutdown error", { error: err instanceof Error ? err.message : String(err) });
        }
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    process.on("unhandledRejection", (reason) => {
        logger.error("UNHANDLED REJECTION", { reason: String(reason) });
    });
}
main().catch((err) => {
    process.stderr.write(`[terminal-use-mcp] FATAL: ${err}\n`);
    process.exit(1);
});
