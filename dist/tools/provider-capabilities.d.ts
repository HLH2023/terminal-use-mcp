import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProviderName, TerminalProvider } from "../providers/provider.js";
export declare function registerProviderCapabilitiesTool(server: McpServer, providers: Map<ProviderName, TerminalProvider>): void;
