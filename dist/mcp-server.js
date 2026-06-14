/**
 * MCP Server 工厂 — 创建 McpServer 实例并注册全部 29 tools + resources + prompts。
 *
 * 由 index.ts 调用 createMcpServer(sm, config, hostsConfig, logger)，
 * 返回已就绪的 McpServer 实例，只需连接 StdioServerTransport 即可启动。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ProviderExecutor } from "./tools/tool-helpers.js";
// ── 22 Session tools ───────────────────────────────────────────
import { registerStartTool } from "./tools/start.js";
import { registerAttachTool } from "./tools/attach.js";
import { registerListTool } from "./tools/list.js";
import { registerInfoTool } from "./tools/info.js";
import { registerRenameTool } from "./tools/rename.js";
import { registerKillTool } from "./tools/kill.js";
import { registerCleanupTool } from "./tools/cleanup.js";
import { registerSnapshotTool } from "./tools/snapshot.js";
import { registerWaitForTextTool } from "./tools/wait-for-text.js";
import { registerWaitStableTool } from "./tools/wait-stable.js";
import { registerFindTool } from "./tools/find.js";
import { registerScrollTool } from "./tools/scroll.js";
import { registerTypeTool } from "./tools/type.js";
import { registerPressTool } from "./tools/press.js";
import { registerPasteTool } from "./tools/paste.js";
import { registerMouseClickTool } from "./tools/mouse-click.js";
import { registerMouseScrollTool } from "./tools/mouse-scroll.js";
import { registerResizeTool } from "./tools/resize.js";
import { registerExportTranscriptTool } from "./tools/export-transcript.js";
import { registerHealthTool } from "./tools/health.js";
import { registerKeysTool } from "./tools/keys.js";
import { registerProviderCapabilitiesTool } from "./tools/provider-capabilities.js";
import { registerEventsTool } from "./tools/events.js";
import { registerSendSignalTool } from "./tools/send-signal.js";
// ── 3 Remote target tools ─────────────────────────────────────
import { registerTargetsTool } from "./tools/targets.js";
import { registerTargetInfoTool } from "./tools/target-info.js";
import { registerVerifyTargetTool } from "./tools/verify-target.js";
// ── 2 Tmux management tools ──────────────────────────────────
import { registerTmuxListTool } from "./tools/tmux-list.js";
import { registerTmuxKillTool } from "./tools/tmux-kill.js";
// ── 2 resources ───────────────────────────────────────────────
import { registerSessionsResource } from "./resources/sessions-resource.js";
import { registerTranscriptResource } from "./resources/transcript-resource.js";
// ── 2 prompts ─────────────────────────────────────────────────
import { registerTerminalUseWorkflowPrompt } from "./prompts/terminal-use-workflow.js";
import { registerExternalAgentControlPrompt } from "./prompts/external-agent-control.js";
/**
 * 创建并配置完整的 MCP Server 实例。
 *
 * @param sm      已完成 provider 注册的 SessionManager
 * @param config  终端配置（主要取 artifactDir）
 * @param hostsConfig SSH hosts.json 加载后的安全 profile Map
 * @param logger  stderr 日志
 */
export function createMcpServer(sm, config, hostsConfig, logger) {
    const server = new McpServer({
        name: "terminal-use-mcp",
        version: "0.1.0",
    });
    /* ── 构建 ProviderExecutor ──
     * SessionManager.getProviders() 返回 ReadonlyMap<ProviderName, TerminalProvider>，
     * ProviderExecutor 构造函数接受 ReadonlyMap<string, TerminalProvider>，
     * 二者类型兼容（ProviderName 是 string 的子类型）。 */
    const providers = sm.getProviders();
    const executor = new ProviderExecutor(sm, providers);
    /* health / provider_capabilities 需要可变 Map<ProviderName, TerminalProvider>，
     * 从 ReadonlyMap 构造一份可变副本。 */
    const mutableProviders = new Map(providers);
    const ALL_PROVIDER_NAMES = ["native-pty", "tmux", "ssh-pty", "ssh-tmux"];
    const enabledSet = config.enabledProviders.length > 0
        ? new Set(config.enabledProviders)
        : null;
    const disabledProviders = new Set(enabledSet
        ? ALL_PROVIDER_NAMES.filter((n) => !enabledSet.has(n))
        : []);
    // ── Session lifecycle (7) ──
    registerStartTool(server, sm, logger, config);
    registerAttachTool(server, sm, logger);
    registerListTool(server, sm, logger);
    registerInfoTool(server, sm, logger);
    registerRenameTool(server, sm, logger);
    registerKillTool(server, sm, logger);
    registerCleanupTool(server, sm, logger);
    // ── Observation + Input (8) ──
    registerSnapshotTool(server, executor, logger);
    registerWaitForTextTool(server, executor, logger);
    registerWaitStableTool(server, executor, logger);
    registerFindTool(server, executor, logger);
    registerScrollTool(server, executor, logger);
    registerTypeTool(server, executor, logger);
    registerPressTool(server, executor, logger);
    registerPasteTool(server, executor, logger, config);
    registerMouseClickTool(server, executor, logger);
    registerMouseScrollTool(server, executor, logger);
    // ── Meta (7) ──
    registerResizeTool(server, executor);
    registerExportTranscriptTool(server, sm, config.artifactDir);
    registerHealthTool(server, mutableProviders, disabledProviders);
    registerKeysTool(server);
    registerProviderCapabilitiesTool(server, mutableProviders);
    registerEventsTool(server, executor);
    registerSendSignalTool(server, executor);
    // ── Remote targets (3) ──
    registerTargetsTool(server, hostsConfig, logger);
    registerTargetInfoTool(server, hostsConfig, logger);
    registerVerifyTargetTool(server, sm, hostsConfig, logger);
    // ── Tmux management (2) ──
    registerTmuxListTool(server, executor, logger, hostsConfig);
    registerTmuxKillTool(server, executor, logger, hostsConfig);
    // ── Resources (2) ──
    registerSessionsResource(server, sm);
    registerTranscriptResource(server, sm);
    // ── Prompts (2) ──
    registerTerminalUseWorkflowPrompt(server);
    registerExternalAgentControlPrompt(server);
    logger.info("MCP server configured", {
        tools: 29,
        resources: 2,
        prompts: 2,
    });
    return server;
}
