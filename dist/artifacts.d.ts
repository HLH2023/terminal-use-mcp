/**
 * Artifact 目录管理。
 *
 * 本模块只负责构造路径、创建目录和执行最小文件写入；调用方负责决定写入内容。
 * 所有路径均为本地运行证据目录，供 session、transcript、snapshot 和联调证据复查使用。
 */
/** Artifact 目录结构结果 */
export type ArtifactPaths = {
    sessionDir: string;
    sessionFile: string;
    eventsFile: string;
    transcriptFile: string;
    transcriptRedactedFile: string;
    snapshotsDir: string;
    errorsFile: string;
};
/** Integration run artifact 结构 */
export type IntegrationArtifactPaths = {
    runDir: string;
    readmeFile: string;
    commandsFile: string;
    providerMatrixFile: string;
    mcpToolsFile: string;
    sessionsDir: string;
    transcriptsDir: string;
    snapshotsDir: string;
    eventsFile: string;
    selfCritiqueFile: string;
};
/** 确保顶级 artifacts 目录存在 */
export declare function ensureArtifactRoot(artifactDir: string): void;
/** 创建 session artifact 目录结构 */
export declare function ensureSessionArtifactDir(artifactDir: string, sessionId: string): ArtifactPaths;
/** 获取 session artifact 路径 (不创建目录) */
export declare function getSessionArtifactPaths(artifactDir: string, sessionId: string): ArtifactPaths;
/** 创建 integration run artifact 目录结构 */
export declare function ensureIntegrationArtifactDir(artifactDir: string, runId: string): IntegrationArtifactPaths;
/** 生成 integration runId，格式为 YYYYMMDD-HHmmss */
export declare function generateRunId(): string;
/** 写入 JSON 文件 */
export declare function writeJsonFile(filePath: string, data: unknown): void;
/** 追加一行到 NDJSON 文件 */
export declare function appendNdjsonLine(filePath: string, data: unknown): void;
/** 追加错误日志 */
export declare function appendErrorLog(filePath: string, error: string): void;
