/**
 * NativePtyProvider
 *
 * 基于 node-pty + @xterm/headless 的本地终端 Provider。
 * 这里负责 PTY 生命周期、输入输出串联、屏幕快照、等待轮询和 transcript 导出；
 * 安全策略中的启动命令/cwd 校验由上层 SessionManager 负责，本层只在输入侧拒绝
 * 明显的 secret/超大 paste，避免把敏感内容写入交互式终端。
 */
import { detectRiskSignals } from "../terminal/confirm-detection.js";
import { LargePasteRefusedError, ProcessExitedError, ProviderNotAvailableError, SecretDetectedError, SessionNotFoundError, SessionTimeoutError, TerminalUseError, } from "../terminal/errors.js";
import { generateSessionId } from "../terminal/ids.js";
import { parsedKeyToAnsiSequence, parseKeyExpr } from "../terminal/keymap.js";
import { mouseClickToFullSgrSequence, mouseScrollToSgrSequence, validateMouseCoords, } from "../terminal/mouse.js";
import { containsSecrets, getDetectedSecretTypes } from "../terminal/redact.js";
import { createSnapshot } from "../terminal/terminal-snapshot.js";
import { TranscriptRecorder } from "../terminal/transcript.js";
import { calculatePollDelay, checkScreenStable, checkTextMatch, hashScreen } from "../terminal/wait.js";
import { validateRegexSafety } from "../terminal/command-safety.js";
import { XtermAdapter } from "../terminal/xterm-adapter.js";
import { safeCleanup } from "../terminal/safe-cleanup.js";
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const LINE_BY_LINE_PASTE_DELAY_MS = 10;
const PASTE_SOFT_LIMIT = 2_000;
const PASTE_HARD_LIMIT = 10_000;
let nodePty = null;
let nodePtyLoadAttempted = false;
const NATIVE_PTY_CAPABILITIES = {
    provider: "native-pty",
    supportsStart: true,
    supportsAttach: false,
    supportsStableWait: true,
    supportsTextWait: true,
    supportsHighlights: true,
    supportsScrollback: true,
    supportsResize: true,
    supportsTranscriptExport: true,
    supportsExitCode: true,
    supportsTitle: true,
    supportsFullscreenDetection: true,
    supportsRename: false,
    supportsScroll: true,
    supportsFind: true,
    supportsMouseClick: true,
    supportsMouseScroll: true,
};
export class NativePtyProvider {
    name = "native-pty";
    capabilities = NATIVE_PTY_CAPABILITIES;
    sessions;
    logger;
    constructor(logger) {
        this.sessions = new Map();
        this.logger = logger;
    }
    /**
     * node-pty 是 native addon，部分环境可能安装但运行时加载失败；
     * 可用性检查通过共享 loader 动态 import 并缓存结果，避免 server 启动阶段因顶层 import 崩溃。
     */
    async isAvailable() {
        return (await loadNodePty()) !== null;
    }
    async start(input) {
        const ptyModule = await loadNodePty();
        if (ptyModule === null) {
            throw new ProviderNotAvailableError(this.name, "node-pty not available");
        }
        const sessionId = generateSessionId();
        const providerSessionId = `native_${sessionId}`;
        const createdAt = new Date().toISOString();
        const xtermAdapter = new XtermAdapter(input.cols, input.rows);
        const transcript = new TranscriptRecorder(sessionId);
        let pty;
        try {
            pty = ptyModule.spawn(input.command, input.args.length > 0 ? input.args : [], {
                name: "xterm-256color",
                cols: input.cols,
                rows: input.rows,
                cwd: input.cwd,
                env: { ...process.env, ...input.env },
            });
        }
        catch (error) {
            // spawn 失败时 session 尚未登记，但 XtermAdapter 已创建；必须立即释放，避免泄漏 addon/事件句柄。
            xtermAdapter.dispose();
            throw error;
        }
        const session = {
            sessionId,
            providerSessionId,
            command: input.command,
            args: input.args,
            cwd: input.cwd,
            status: "starting",
            exitCode: null,
            cols: input.cols,
            rows: input.rows,
            label: input.label,
            createdAt,
            lastActivityAt: createdAt,
            ttlMs: input.ttlMs ?? DEFAULT_TTL_MS,
            pty,
            xtermAdapter,
            transcript,
            dirty: false,
            lastSnapshotScreen: "",
            lastSnapshotTime: 0,
        };
        pty.onData((data) => {
            try {
                xtermAdapter.write(data);
                session.dirty = true;
                session.lastActivityAt = new Date().toISOString();
                session.transcript.recordOutput(data);
            }
            catch (error) {
                session.status = "error";
                this.logger.error("native-pty output parse failed", { sessionId, error: this.stringifyUnknownError(error) });
            }
        });
        pty.onExit(({ exitCode, signal }) => {
            session.status = session.status === "killed" ? "killed" : "exited";
            session.exitCode = exitCode;
            session.pty = null;
            session.lastActivityAt = new Date().toISOString();
            session.transcript.recordExit(exitCode, signal === undefined ? undefined : signal.toString());
            this.logger.info("native-pty process exited", { sessionId, exitCode, signal });
        });
        session.status = "running";
        // Map key 使用 providerSessionId (如 "native_xxx")，确保 snapshot/kill 等通过 providerSessionId 查找时 key 一致
        this.sessions.set(providerSessionId, session);
        this.logger.info("native-pty session started", {
            sessionId,
            command: input.command,
            cwd: input.cwd,
            cols: input.cols,
            rows: input.rows,
        });
        return this.toTerminalSession(session);
    }
    async snapshot(sessionId, mode = "viewport") {
        const session = this.getSession(sessionId);
        const screen = session.xtermAdapter.readScreen(mode);
        const highlights = session.xtermAdapter.detectHighlights(mode);
        const screenText = screen.lines.map((line) => line.text).join("\n");
        const screenHash = hashScreen(screenText);
        const changed = session.dirty || session.lastSnapshotScreen !== screenHash;
        const riskSignals = detectRiskSignals(screenText);
        const snapshot = createSnapshot({
            sessionId: session.sessionId,
            screen: screenText,
            cursor: screen.cursor,
            cols: screen.cols,
            rows: screen.rows,
            scrollbackLineCount: screen.scrollbackLineCount,
            status: session.status,
            changed,
            exitCode: session.exitCode,
            title: screen.title,
            isFullscreen: screen.isAltBuffer,
            highlights,
            riskSignals,
        });
        session.lastSnapshotScreen = screenHash;
        session.lastSnapshotTime = Date.now();
        session.dirty = false;
        session.lastActivityAt = snapshot.timestamp;
        session.xtermAdapter.markClean();
        session.transcript.recordSnapshot(snapshot.screen);
        return snapshot;
    }
    async waitForText(sessionId, text, options) {
        const startedAt = Date.now();
        const timeoutMs = options.timeoutMs;
        while (true) {
            const session = this.getSession(sessionId);
            const snapshot = await this.snapshot(sessionId);
            const match = checkTextMatch(snapshot.screen, { ...options, text });
            if (match.matched) {
                return snapshot;
            }
            if (Date.now() - startedAt > timeoutMs) {
                throw new SessionTimeoutError(sessionId, timeoutMs, `等待文本超时: ${text}`);
            }
            await delay(calculatePollDelay({ idleMs: Math.max(20, Math.floor(timeoutMs / 10)), timeoutMs }));
            // 进程已退出且目标文本仍未出现时，继续到超时会浪费调用方时间；直接报进程退出。
            if (session.status === "exited" || session.status === "killed" || session.status === "error") {
                throw new ProcessExitedError(sessionId, session.exitCode);
            }
        }
    }
    async waitStable(sessionId, options) {
        const startedAt = Date.now();
        const snapshotOnTimeout = options.snapshotOnTimeout ?? true;
        let previousState = null;
        while (true) {
            const session = this.getSession(sessionId);
            const snapshot = await this.snapshot(sessionId);
            const now = Date.now();
            const currentState = {
                screen: snapshot.screen,
                screenHash: hashScreen(snapshot.screen),
                lastWriteAt: session.xtermAdapter.getLastWriteAt(),
                now,
            };
            const stable = checkScreenStable(currentState, previousState, options);
            if (stable.stable) {
                return snapshot;
            }
            if (now - startedAt > options.timeoutMs) {
                if (snapshotOnTimeout) {
                    // 连续刷新型 TUI 可能无法满足稳定判定；返回当前观察值比让 agent 空等到错误更有用。
                    this.logger.debug("native-pty waitStable timeout; returning current snapshot", {
                        sessionId,
                        timeoutMs: options.timeoutMs,
                    });
                    return { ...snapshot, timedOut: true };
                }
                // 严格模式保留旧行为，供测试或必须确认稳定的调用方使用。
                throw new SessionTimeoutError(sessionId, options.timeoutMs, "等待屏幕稳定超时");
            }
            previousState = currentState;
            await delay(calculatePollDelay(options));
        }
    }
    async type(sessionId, text) {
        const session = this.getWritableSession(sessionId);
        session.pty.write(text);
        session.transcript.recordInput(text);
        session.lastActivityAt = new Date().toISOString();
    }
    async press(sessionId, keyExpr, parsed) {
        const sequence = parsedKeyToAnsiSequence(parsed);
        const session = this.getWritableSession(sessionId);
        session.pty.write(sequence);
        session.transcript.recordInput(`<${keyExpr}>`);
        session.lastActivityAt = new Date().toISOString();
    }
    async paste(sessionId, text, mode) {
        this.assertPasteSafe(text);
        const session = this.getWritableSession(sessionId);
        const effectiveMode = mode ?? "bracketed";
        if (effectiveMode === "bracketed") {
            const payload = `\x1b[200~${text}\x1b[201~`;
            session.pty.write(payload);
            session.transcript.recordInput("<paste:bracketed>");
            session.lastActivityAt = new Date().toISOString();
            return;
        }
        if (effectiveMode === "line-by-line") {
            const lines = text.split(/\r?\n/);
            for (const line of lines) {
                session.pty.write(`${line}\r`);
                await delay(LINE_BY_LINE_PASTE_DELAY_MS);
            }
            session.transcript.recordInput("<paste:line-by-line>");
            session.lastActivityAt = new Date().toISOString();
            return;
        }
        session.pty.write(text);
        session.transcript.recordInput("<paste:raw>");
        session.lastActivityAt = new Date().toISOString();
    }
    async find(sessionId, pattern, regex, includeScrollback) {
        // find 的既有契约是在 active buffer 全量文本中搜索；snapshot 默认改为 viewport 后，
        // 这里必须显式使用 full，避免 find 退化为仅搜索当前可见行。
        const snapshot = await this.snapshot(sessionId, "full");
        // XtermAdapter 当前公开的是 active buffer 文本；active buffer 在常规缓冲下已包含可读范围。
        // includeScrollback 暂按 best-effort 处理，不越过 adapter 私有字段访问 xterm 实例。
        const lines = snapshot.screen.split("\n");
        const results = [];
        if (regex === true) {
            const validation = validateRegexSafety(pattern);
            if (!validation.ok) {
                throw new TerminalUseError({ code: "UNSAFE_REGEX", message: validation.reason, retryable: false });
            }
            const expression = new RegExp(pattern, "g");
            for (let row = 0; row < lines.length; row += 1) {
                for (const match of lines[row].matchAll(expression)) {
                    results.push({ row, col: match.index, line: lines[row], match: match[0] });
                }
            }
            return results;
        }
        for (let row = 0; row < lines.length; row += 1) {
            let col = lines[row].indexOf(pattern);
            while (col !== -1) {
                results.push({ row, col, line: lines[row], match: pattern });
                col = lines[row].indexOf(pattern, col + Math.max(pattern.length, 1));
            }
        }
        if (includeScrollback === true) {
            this.logger.debug("native-pty find includeScrollback handled as best-effort active-buffer search", { sessionId });
        }
        return results;
    }
    async scroll(sessionId, direction, lines) {
        const keyExpr = direction === "up" ? "pageup" : "pagedown";
        const parsed = parseKeyExpr(keyExpr);
        const count = Math.max(0, Math.floor(lines));
        for (let index = 0; index < count; index += 1) {
            await this.press(sessionId, keyExpr, parsed);
        }
    }
    async mouseClick(sessionId, input) {
        const session = this.getWritableSession(sessionId);
        validateMouseCoords(input.col, input.row, session.cols, session.rows);
        const event = {
            col: input.col,
            row: input.row,
            button: input.button,
            shift: input.shift,
            alt: input.alt,
            ctrl: input.ctrl,
        };
        const sequence = mouseClickToFullSgrSequence(event);
        session.pty.write(sequence);
        session.transcript.recordInput(`<mouse:click:${input.button}@${input.col},${input.row}>`);
        session.lastActivityAt = new Date().toISOString();
    }
    async mouseScroll(sessionId, input) {
        const session = this.getWritableSession(sessionId);
        validateMouseCoords(input.col, input.row, session.cols, session.rows);
        const event = {
            col: input.col,
            row: input.row,
            direction: input.direction,
            shift: input.shift,
            alt: input.alt,
            ctrl: input.ctrl,
        };
        const sequence = mouseScrollToSgrSequence(event);
        session.pty.write(sequence);
        session.transcript.recordInput(`<mouse:scroll:${input.direction}@${input.col},${input.row}>`);
        session.lastActivityAt = new Date().toISOString();
    }
    async resize(sessionId, cols, rows) {
        const session = this.getSession(sessionId);
        const pty = session.pty;
        if (pty === null) {
            throw new ProcessExitedError(sessionId, session.exitCode);
        }
        pty.resize(cols, rows);
        session.xtermAdapter.resize(cols, rows);
        session.cols = cols;
        session.rows = rows;
        session.dirty = true;
        session.lastActivityAt = new Date().toISOString();
        session.transcript.recordResize(cols, rows);
    }
    async kill(sessionId) {
        const session = this.getSession(sessionId);
        await safeCleanup([
            {
                name: "pty.kill",
                fn: () => {
                    if (session.pty !== null) {
                        if (process.platform === "win32") {
                            session.pty.kill();
                        }
                        else {
                            session.pty.kill("SIGTERM");
                        }
                        session.pty = null;
                    }
                },
            },
            {
                name: "markKilled+recordExit",
                fn: () => {
                    session.status = "killed";
                    session.lastActivityAt = new Date().toISOString();
                    session.transcript.recordExit(session.exitCode, "killed");
                },
            },
            {
                name: "xtermAdapter.dispose",
                fn: () => session.xtermAdapter.dispose(),
            },
            {
                name: "sessions.delete",
                fn: () => {
                    this.sessions.delete(session.providerSessionId);
                },
            },
        ], this.logger);
        this.logger.info("native-pty session killed", { sessionId });
    }
    hasSession(sessionId) {
        return this.sessions.has(sessionId);
    }
    listActiveSessionIds() {
        return Array.from(this.sessions.keys());
    }
    async exportTranscript(sessionId, options) {
        const session = this.getSession(sessionId);
        const content = session.transcript.export(options.format, { redact: options.redact });
        return {
            format: options.format,
            content,
            snapshotCount: this.countSnapshotEvents(session),
            eventCount: session.transcript.getEventCount(),
            redacted: options.redact,
        };
    }
    getSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new SessionNotFoundError(sessionId);
        }
        return session;
    }
    getWritableSession(sessionId) {
        const session = this.getSession(sessionId);
        if (session.pty === null || session.status === "exited" || session.status === "killed" || session.status === "error") {
            throw new ProcessExitedError(sessionId, session.exitCode);
        }
        return session;
    }
    toTerminalSession(session) {
        return {
            sessionId: session.sessionId,
            providerName: this.name,
            providerSessionId: session.providerSessionId,
            command: session.command,
            args: session.args,
            cwd: session.cwd,
            label: session.label,
            status: session.status,
            exitCode: session.exitCode,
            createdAt: session.createdAt,
            lastActivityAt: session.lastActivityAt,
            ttlMs: session.ttlMs,
            capabilities: this.capabilities,
        };
    }
    assertPasteSafe(text) {
        if (text.length > PASTE_HARD_LIMIT) {
            throw new LargePasteRefusedError(text.length, PASTE_HARD_LIMIT, true);
        }
        if (text.length > PASTE_SOFT_LIMIT) {
            throw new LargePasteRefusedError(text.length, PASTE_SOFT_LIMIT);
        }
        if (containsSecrets(text)) {
            throw new SecretDetectedError(getDetectedSecretTypes(text));
        }
    }
    countSnapshotEvents(session) {
        return session.transcript.getEvents(session.transcript.getEventCount()).events
            .filter((event) => event.type === "snapshot").length;
    }
    stringifyUnknownError(error) {
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }
}
async function loadNodePty() {
    if (nodePty !== null) {
        return nodePty;
    }
    if (nodePtyLoadAttempted) {
        return null;
    }
    nodePtyLoadAttempted = true;
    try {
        nodePty = await import("node-pty");
        return nodePty;
    }
    catch {
        return null;
    }
}
function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
