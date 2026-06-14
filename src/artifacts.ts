/**
 * Artifact 目录管理。
 *
 * 本模块只负责构造路径、创建目录和执行最小文件写入；调用方负责决定写入内容。
 * 所有路径均为本地运行证据目录，供 session、transcript、snapshot 和联调证据复查使用。
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** Artifact 目录结构结果 */
export type ArtifactPaths = {
  sessionDir: string
  sessionFile: string
  eventsFile: string
  transcriptFile: string
  transcriptRedactedFile: string
  snapshotsDir: string
  errorsFile: string
}

/** Integration run artifact 结构 */
export type IntegrationArtifactPaths = {
  runDir: string
  readmeFile: string
  commandsFile: string
  providerMatrixFile: string
  mcpToolsFile: string
  sessionsDir: string
  transcriptsDir: string
  snapshotsDir: string
  eventsFile: string
  selfCritiqueFile: string
}

/** 确保顶级 artifacts 目录存在 */
export function ensureArtifactRoot(artifactDir: string): void {
  mkdirSync(artifactDir, { recursive: true })
  mkdirSync(join(artifactDir, "sessions"), { recursive: true })
}

/** 创建 session artifact 目录结构 */
export function ensureSessionArtifactDir(artifactDir: string, sessionId: string): ArtifactPaths {
  const paths = getSessionArtifactPaths(artifactDir, sessionId)
  ensureArtifactRoot(artifactDir)
  mkdirSync(paths.sessionDir, { recursive: true })
  mkdirSync(paths.snapshotsDir, { recursive: true })
  return paths
}

/** 获取 session artifact 路径 (不创建目录) */
export function getSessionArtifactPaths(artifactDir: string, sessionId: string): ArtifactPaths {
  const sessionDir = join(artifactDir, "sessions", sessionId)
  return {
    sessionDir,
    sessionFile: join(sessionDir, "session.json"),
    eventsFile: join(sessionDir, "events.jsonl"),
    transcriptFile: join(sessionDir, "transcript.txt"),
    transcriptRedactedFile: join(sessionDir, "transcript.redacted.txt"),
    snapshotsDir: join(sessionDir, "snapshots"),
    errorsFile: join(sessionDir, "errors.log"),
  }
}

/** 创建 integration run artifact 目录结构 */
export function ensureIntegrationArtifactDir(artifactDir: string, runId: string): IntegrationArtifactPaths {
  ensureArtifactRoot(artifactDir)

  const runDir = join(artifactDir, "integration", runId)
  const paths: IntegrationArtifactPaths = {
    runDir,
    readmeFile: join(runDir, "README.md"),
    commandsFile: join(runDir, "commands.md"),
    providerMatrixFile: join(runDir, "provider-matrix.json"),
    mcpToolsFile: join(runDir, "mcp-tools.json"),
    sessionsDir: join(runDir, "sessions"),
    transcriptsDir: join(runDir, "transcripts"),
    snapshotsDir: join(runDir, "snapshots"),
    eventsFile: join(runDir, "events.jsonl"),
    selfCritiqueFile: join(runDir, "self-critique.md"),
  }

  mkdirSync(paths.runDir, { recursive: true })
  mkdirSync(paths.sessionsDir, { recursive: true })
  mkdirSync(paths.transcriptsDir, { recursive: true })
  mkdirSync(paths.snapshotsDir, { recursive: true })

  return paths
}

/** 生成 integration runId，格式为 YYYYMMDD-HHmmss */
export function generateRunId(): string {
  const now = new Date()
  const year = now.getFullYear().toString().padStart(4, "0")
  const month = (now.getMonth() + 1).toString().padStart(2, "0")
  const day = now.getDate().toString().padStart(2, "0")
  const hours = now.getHours().toString().padStart(2, "0")
  const minutes = now.getMinutes().toString().padStart(2, "0")
  const seconds = now.getSeconds().toString().padStart(2, "0")
  return `${year}${month}${day}-${hours}${minutes}${seconds}`
}

/** 写入 JSON 文件 */
export function writeJsonFile(filePath: string, data: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8")
}

/** 追加一行到 NDJSON 文件 */
export function appendNdjsonLine(filePath: string, data: unknown): void {
  appendFileSync(filePath, `${JSON.stringify(data)}\n`, "utf8")
}

/** 追加错误日志 */
export function appendErrorLog(filePath: string, error: string): void {
  appendFileSync(filePath, `[${new Date().toISOString()}] ${error}\n`, "utf8")
}
