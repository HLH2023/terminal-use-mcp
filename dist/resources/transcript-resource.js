/**
 * terminal://sessions/{sessionId}/transcript MCP Resource
 *
 * 返回指定 session 的 transcript 文本（自动脱敏）。
 * URI 模板: terminal://sessions/<sessionId>/transcript
 */
/** 从 URI 中提取 sessionId，格式: terminal://sessions/<id>/transcript */
function extractSessionId(uri) {
    // 去除 scheme，拆分路径段
    const withoutScheme = uri.replace(/^terminal:\/\//, "");
    const parts = withoutScheme.split("/");
    // 期望: ["sessions", "<sessionId>", "transcript"]
    if (parts.length === 3 && parts[0] === "sessions" && parts[2] === "transcript") {
        return parts[1];
    }
    return null;
}
/** 注册 terminal://sessions/{sessionId}/transcript 资源模板，返回脱敏 transcript */
export function registerTranscriptResource(server, sm) {
    server.registerResource("terminal://sessions/{sessionId}/transcript", "terminal://sessions/{sessionId}/transcript", {
        description: "Get the transcript for a specific terminal session (redacted)",
    }, async (uri) => {
        const uriStr = uri.toString();
        const sessionId = extractSessionId(uriStr);
        // URI 格式不合法，返回错误提示
        if (sessionId === null) {
            return {
                contents: [
                    {
                        uri: uriStr,
                        mimeType: "text/plain",
                        text: `Error: Invalid transcript URI format. Expected terminal://sessions/<sessionId>/transcript, got: ${uriStr}`,
                    },
                ],
            };
        }
        try {
            const session = sm.getSession(sessionId);
            // 导出脱敏后的 transcript 文本
            const transcriptText = session.transcript.export("text", { redact: true });
            return {
                contents: [
                    {
                        uri: uriStr,
                        mimeType: "text/plain",
                        text: transcriptText,
                    },
                ],
            };
        }
        catch (err) {
            // session 不存在或其他错误
            const message = err instanceof Error ? err.message : String(err);
            return {
                contents: [
                    {
                        uri: uriStr,
                        mimeType: "text/plain",
                        text: `Error: ${message}`,
                    },
                ],
            };
        }
    });
}
