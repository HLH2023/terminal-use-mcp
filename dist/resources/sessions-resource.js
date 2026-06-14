/**
 * terminal://sessions MCP Resource
 *
 * 列出所有活跃终端 session 的 JSON 数组。
 * 供 MCP client 读取当前 session 列表快照，无需调用 tool。
 */
import { sessionToPublicInfo } from "../tools/tool-helpers.js";
/** 注册 terminal://sessions 资源，返回所有活跃 session 的 JSON 列表 */
export function registerSessionsResource(server, sm) {
    server.registerResource("terminal://sessions", "terminal://sessions", {
        description: "List all active terminal sessions as a JSON array",
    }, async (uri) => {
        // 将 session 列表序列化为可公开的 JSON
        const sessions = sm.listSessions().map(sessionToPublicInfo);
        return {
            contents: [
                {
                    uri: uri.toString(),
                    mimeType: "application/json",
                    text: JSON.stringify(sessions),
                },
            ],
        };
    });
}
