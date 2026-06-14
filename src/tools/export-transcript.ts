import { writeFileSync } from "node:fs"
import { join } from "node:path"

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { SessionManager } from "../session-manager.js"
import { ensureSessionArtifactDir } from "../artifacts.js"
import { TerminalUseError } from "../terminal/errors.js"
import type { TranscriptEvent, TranscriptExportFormat } from "../terminal/transcript.js"

type ToolTextContent = { type: "text"; text: string }
type ToolErrorResult = { content: ToolTextContent[]; isError: true }

function errorToToolResult(err: unknown): ToolErrorResult {
  if (err instanceof TerminalUseError) {
    const envelope = err.toEnvelope()
    return { content: [{ type: "text", text: JSON.stringify(envelope) }], isError: true }
  }
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, error: { code: "INTERNAL_ERROR", message: String(err), retryable: false } }) }],
    isError: true,
  }
}

type ExportTranscriptOutput = {
  ok: true
  path: string
  redacted: boolean
  snapshotCount: number
  eventCount: number
}

export function registerExportTranscriptTool(server: McpServer, sm: SessionManager, artifactDir: string): void {
  server.registerTool(
    "terminal.export_transcript",
    {
      description: "Export a terminal session transcript to the artifact directory",
      inputSchema: {
        sessionId: z.string().describe("Session ID from terminal.start — use exact value"),
        redact: z.boolean().default(true),
        format: z.enum(["text", "jsonl", "markdown"]).default("text"),
        includeSnapshots: z.boolean().default(false).optional(),
      },
    },
    async (input) => {
      try {
        const session = sm.getSession(input.sessionId)
        const format: TranscriptExportFormat = input.format
        const content = session.transcript.export(format, { redact: input.redact })
        const paths = ensureSessionArtifactDir(artifactDir, session.sessionId)
        const filePath = join(paths.sessionDir, buildTranscriptFileName(format, input.redact, input.includeSnapshots === true))
        writeFileSync(filePath, content, "utf8")

        const events = session.transcript.getEvents(session.transcript.getEventCount()).events
        const output: ExportTranscriptOutput = {
          ok: true,
          path: filePath,
          redacted: input.redact,
          snapshotCount: countSnapshots(events),
          eventCount: session.transcript.getEventCount(),
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (err) {
        return errorToToolResult(err)
      }
    },
  )
}

function buildTranscriptFileName(format: TranscriptExportFormat, redacted: boolean, includeSnapshots: boolean): string {
  const redactionPart = redacted ? ".redacted" : ""
  const snapshotPart = includeSnapshots ? ".with-snapshots" : ""
  const extension = format === "markdown" ? "md" : format
  return `transcript${redactionPart}${snapshotPart}.${extension}`
}

function countSnapshots(events: TranscriptEvent[]): number {
  return events.filter((event) => event.type === "snapshot").length
}
