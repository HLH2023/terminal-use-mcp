/**
 * SshPtyProvider
 *
 * 通过 ssh2 建立远程 SSH 连接，并在远端打开带 PTY 的 exec channel。
 * 它与 NativePtyProvider 保持同一观察/输入模型：远端 channel 输出写入
 * XtermAdapter，再复用 snapshot / wait / transcript / paste 安全检查。
 *
 * 安全边界：
 * - 默认只接受 SSH profile；inline target 仍由 resolveSshTarget 的环境变量闸门控制。
 * - host key 必须通过 pinned fingerprint 或 known_hosts 与实际握手 key 严格匹配。
 * - 认证仅支持 ssh-agent 与 key-file；不提供 password / keyboard-interactive 回退。
 * - key-file 只在连接前以 Buffer 读入本地内存，不写入日志、metadata 或 artifact。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "ssh2";
import { detectRiskSignals } from "../terminal/confirm-detection.js";
import { LargePasteRefusedError, ProcessExitedError, ProviderCapabilityUnsupportedError, SecretDetectedError, SessionNotFoundError, SessionTimeoutError, SshAuthFailedError, SshConnectTimeoutError, SshConnectionLostError, SshHostKeyMismatchError, SshHostKeyUnknownError, TerminalUseError, } from "../terminal/errors.js";
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
import { computeHostFingerprint, verifyPinnedFingerprint } from "../targets/host-fingerprint.js";
import { parseKnownHosts } from "../targets/known-hosts.js";
import { createRemoteCwdPolicy, resolveRemoteCwd } from "../targets/remote-cwd-policy.js";
import { remoteCapabilityCache } from "../targets/remote-capability-cache.js";
import { loadHostsConfig } from "../targets/ssh-host-config.js";
import { resolveSshAuth } from "../targets/ssh-auth.js";
import { resolveSshTarget } from "../targets/ssh-profile-loader.js";
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_KEEPALIVE_INTERVAL_MS = 15_000;
const LINE_BY_LINE_PASTE_DELAY_MS = 10;
const PASTE_SOFT_LIMIT = 2_000;
const PASTE_HARD_LIMIT = 10_000;
const SSH_TERM = "xterm-256color";
const DEFAULT_PIXEL_WIDTH = 0;
const DEFAULT_PIXEL_HEIGHT = 0;
const SSH_PTY_CAPABILITIES = {
    provider: "ssh-pty",
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
/**
 * 远端输出脏标记。
 *
 * 抽成小类是为了让单元测试在不建立 SSH 连接的情况下覆盖
 * markDirty / markClean / lastDataAt 语义。
 */
export class SshPtyDirtyTracker {
    dirty = false;
    lastDataAtMs = 0;
    lastDataAtIso;
    markDirty(now = new Date()) {
        this.dirty = true;
        this.lastDataAtMs = now.getTime();
        this.lastDataAtIso = now.toISOString();
    }
    markClean() {
        this.dirty = false;
    }
    isDirty() {
        return this.dirty;
    }
    getLastDataAtMs() {
        return this.lastDataAtMs;
    }
    getLastDataAtIso() {
        return this.lastDataAtIso;
    }
}
export class SshPtyProvider {
    name = "ssh-pty";
    capabilities = SSH_PTY_CAPABILITIES;
    sessions;
    logger;
    options;
    capabilityCache;
    constructor(logger, options) {
        this.sessions = new Map();
        this.logger = logger;
        this.options = options ?? {};
        this.capabilityCache = this.options.capabilityCache ?? remoteCapabilityCache;
    }
    /** ssh2 是 package dependency，安装后即可用；无 native addon 动态失败路径。 */
    async isAvailable() {
        return true;
    }
    async start(input) {
        const resolvedTarget = await this.resolveStartTarget(input.target ?? { kind: "local" });
        const cwd = resolveRemoteCwd(createRemoteCwdPolicy(resolvedTarget), input.cwd);
        const auth = await resolveSshPtyAuthConnectConfig(resolvedTarget.auth);
        const sessionId = generateSessionId();
        const providerSessionId = `sshpty_${sessionId}`;
        const createdAt = new Date().toISOString();
        const xtermAdapter = new XtermAdapter(input.cols, input.rows);
        const transcript = new TranscriptRecorder(sessionId);
        const dirtyTracker = new SshPtyDirtyTracker();
        let hostKeyError;
        let verifiedFingerprint;
        const hostVerifier = (key, verify) => {
            if (verify === undefined) {
                // ssh2 同步 verifier 分支不会被本 Provider 主动使用；fail-closed。
                return false;
            }
            void verifyPresentedHostKey(resolvedTarget, key)
                .then((fingerprint) => {
                verifiedFingerprint = fingerprint;
                verify(true);
            })
                .catch((error) => {
                hostKeyError = normalizeHostKeyError(resolvedTarget, error);
                verify(false);
            });
            return undefined;
        };
        const connectConfig = buildSshConnectConfig(resolvedTarget, auth, hostVerifier);
        const client = new Client();
        try {
            await connectSshClient(client, connectConfig, resolvedTarget, () => hostKeyError);
            const profileName = remoteCapabilityProfileName(resolvedTarget);
            const caps = await this.capabilityCache.probe(client, profileName);
            this.logger.info("Remote capabilities", { profile: profileName, caps });
            const channel = await openRemotePtyExecChannel(client, {
                command: input.command,
                args: input.args,
                cwd,
                cols: input.cols,
                rows: input.rows,
                env: { ...(resolvedTarget.env ?? {}), ...(input.env ?? {}) },
                capabilities: caps,
            });
            const metadata = createSshSessionMetadata(resolvedTarget, auth.authType, cwd, input, verifiedFingerprint, createdAt);
            const session = {
                sessionId,
                providerSessionId,
                command: input.command,
                args: input.args,
                cwd,
                status: "starting",
                exitCode: null,
                cols: input.cols,
                rows: input.rows,
                label: input.label,
                createdAt,
                lastActivityAt: createdAt,
                ttlMs: input.ttlMs ?? DEFAULT_TTL_MS,
                host: resolvedTarget.host,
                client,
                channel,
                xtermAdapter,
                transcript,
                dirtyTracker,
                lastSnapshotScreen: "",
                lastSnapshotTime: 0,
                metadata,
            };
            this.wireClientEvents(session);
            this.wireChannelEvents(session);
            session.status = "running";
            // Map key = providerSessionId ("sshpty_xxx")，与 snapshot/kill 等查询参数一致
            this.sessions.set(providerSessionId, session);
            this.logger.info("ssh-pty session started", {
                sessionId,
                profile: resolvedTarget.profile,
                host: resolvedTarget.host,
                port: resolvedTarget.port,
                username: resolvedTarget.username,
                command: input.command,
                cwd,
                authType: auth.authType,
            });
            return this.toTerminalSession(session);
        }
        catch (error) {
            xtermAdapter.dispose();
            client.end();
            throw mapSshStartError(resolvedTarget, error);
        }
    }
    async snapshot(sessionId) {
        const session = this.getSession(sessionId);
        const screen = session.xtermAdapter.readScreen();
        const highlights = session.xtermAdapter.detectHighlights();
        const screenText = screen.lines.map((line) => line.text).join("\n");
        const screenHash = hashScreen(screenText);
        const changed = session.dirtyTracker.isDirty() || session.lastSnapshotScreen !== screenHash;
        const riskSignals = detectRiskSignals(screenText);
        const snapshot = createSnapshot({
            sessionId: session.sessionId,
            screen: screenText,
            cursor: screen.cursor,
            cols: screen.cols,
            rows: screen.rows,
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
        session.dirtyTracker.markClean();
        session.xtermAdapter.markClean();
        session.lastActivityAt = snapshot.timestamp;
        session.transcript.recordSnapshot(snapshot.screen);
        return snapshot;
    }
    async waitForText(sessionId, text, options) {
        const startedAt = Date.now();
        while (true) {
            const session = this.getSession(sessionId);
            const snapshot = await this.snapshot(sessionId);
            const match = checkTextMatch(snapshot.screen, { ...options, text });
            if (match.matched) {
                return snapshot;
            }
            if (Date.now() - startedAt > options.timeoutMs) {
                throw new SessionTimeoutError(sessionId, options.timeoutMs, `等待 SSH 远程文本超时: ${text}`);
            }
            await delay(calculatePollDelay({ idleMs: Math.max(20, Math.floor(options.timeoutMs / 10)), timeoutMs: options.timeoutMs }));
            if (session.status === "exited" || session.status === "killed" || session.status === "error") {
                throw new ProcessExitedError(sessionId, session.exitCode);
            }
        }
    }
    async waitStable(sessionId, options) {
        const startedAt = Date.now();
        let previousState = null;
        while (true) {
            const session = this.getSession(sessionId);
            const snapshot = await this.snapshot(sessionId);
            const now = Date.now();
            const currentState = {
                screen: snapshot.screen,
                screenHash: hashScreen(snapshot.screen),
                lastWriteAt: Math.max(session.xtermAdapter.getLastWriteAt(), session.dirtyTracker.getLastDataAtMs()),
                now,
            };
            const stable = checkScreenStable(currentState, previousState, options);
            if (stable.stable) {
                return snapshot;
            }
            if (now - startedAt > options.timeoutMs) {
                throw new SessionTimeoutError(sessionId, options.timeoutMs, "等待 SSH 远程屏幕稳定超时");
            }
            previousState = currentState;
            await delay(calculatePollDelay(options));
        }
    }
    async type(sessionId, text) {
        const session = this.getWritableSession(sessionId);
        session.channel.write(text);
        session.transcript.recordInput(text);
        session.lastActivityAt = new Date().toISOString();
    }
    async press(sessionId, keyExpr, parsed) {
        const sequence = parsedKeyToAnsiSequence(parsed);
        const session = this.getWritableSession(sessionId);
        session.channel.write(sequence);
        session.transcript.recordInput(`<${keyExpr}>`);
        session.lastActivityAt = new Date().toISOString();
    }
    async paste(sessionId, text, mode) {
        this.assertPasteSafe(text);
        const session = this.getWritableSession(sessionId);
        const effectiveMode = mode ?? "bracketed";
        if (effectiveMode === "bracketed") {
            session.channel.write(`\x1b[200~${text}\x1b[201~`);
            session.transcript.recordInput("<paste:bracketed>");
            session.lastActivityAt = new Date().toISOString();
            return;
        }
        if (effectiveMode === "line-by-line") {
            const lines = text.split(/\r?\n/u);
            for (const line of lines) {
                session.channel.write(`${line}\r`);
                await delay(LINE_BY_LINE_PASTE_DELAY_MS);
            }
            session.transcript.recordInput("<paste:line-by-line>");
            session.lastActivityAt = new Date().toISOString();
            return;
        }
        session.channel.write(text);
        session.transcript.recordInput("<paste:raw>");
        session.lastActivityAt = new Date().toISOString();
    }
    async find(sessionId, pattern, regex, includeScrollback) {
        const snapshot = await this.snapshot(sessionId);
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
            this.logger.debug("ssh-pty find includeScrollback handled as best-effort active-buffer search", { sessionId });
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
        session.channel.write(sequence);
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
        session.channel.write(sequence);
        session.transcript.recordInput(`<mouse:scroll:${input.direction}@${input.col},${input.row}>`);
        session.lastActivityAt = new Date().toISOString();
    }
    async resize(sessionId, cols, rows) {
        const session = this.getWritableSession(sessionId);
        session.channel.setWindow(rows, cols, DEFAULT_PIXEL_HEIGHT, DEFAULT_PIXEL_WIDTH);
        session.xtermAdapter.resize(cols, rows);
        session.cols = cols;
        session.rows = rows;
        session.dirtyTracker.markDirty();
        session.metadata.remote.pty.cols = cols;
        session.metadata.remote.pty.rows = rows;
        session.lastActivityAt = new Date().toISOString();
        session.transcript.recordResize(cols, rows);
    }
    async rename() {
        throw new ProviderCapabilityUnsupportedError(this.name, "rename");
    }
    async kill(sessionId) {
        const session = this.getSession(sessionId);
        await safeCleanup([
            {
                name: "channel.close",
                fn: () => {
                    const channel = session.channel;
                    session.channel = null;
                    if (channel !== null) {
                        channel.close();
                    }
                },
            },
            {
                name: "client.end",
                fn: () => {
                    const client = session.client;
                    session.client = null;
                    if (client !== null) {
                        client.end();
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
        this.logger.info("ssh-pty session killed", { sessionId: session.sessionId, host: session.host });
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
    async list() {
        return Array.from(this.sessions.values()).map((session) => this.toTerminalSession(session));
    }
    async resolveStartTarget(target) {
        const hostsConfig = this.options.hostsConfig ?? await loadHostsConfig(this.options.hostsConfigPath);
        const resolved = resolveSshTarget(target, hostsConfig);
        if (resolved.kind !== "ssh") {
            throw new ProviderCapabilityUnsupportedError(this.name, "target.kind=ssh");
        }
        this.logger.info("ssh-pty resolved target", {
            host: resolved.host,
            port: resolved.port,
            username: resolved.username,
            knownHosts: resolved.knownHosts,
            authType: resolved.auth.type,
        });
        return resolved;
    }
    wireClientEvents(session) {
        const client = session.client;
        if (client === null)
            return;
        client.on("error", (error) => {
            if (session.status !== "killed") {
                session.status = "error";
                session.lastActivityAt = new Date().toISOString();
                this.logger.error("ssh-pty client error", { sessionId: session.sessionId, error: error.message });
            }
        });
        client.on("close", () => {
            if (session.status === "running") {
                session.status = "exited";
                session.lastActivityAt = new Date().toISOString();
            }
        });
    }
    wireChannelEvents(session) {
        const channel = session.channel;
        if (channel === null)
            return;
        channel.on("data", (chunk) => {
            void this.handleChannelOutput(session, chunk, "stdout");
        });
        channel.stderr.on("data", (chunk) => {
            void this.handleChannelOutput(session, chunk, "stderr");
        });
        channel.on("exit", (code, signal) => {
            session.exitCode = code;
            session.exitSignal = signal;
            session.lastActivityAt = new Date().toISOString();
        });
        channel.on("close", () => {
            if (session.status !== "killed") {
                session.status = "exited";
                session.transcript.recordExit(session.exitCode, session.exitSignal);
            }
            session.channel = null;
            session.client?.end();
            session.client = null;
            session.lastActivityAt = new Date().toISOString();
            this.logger.info("ssh-pty channel closed", { sessionId: session.sessionId, exitCode: session.exitCode });
        });
        channel.on("error", (error) => {
            session.status = "error";
            session.lastActivityAt = new Date().toISOString();
            this.logger.error("ssh-pty channel error", { sessionId: session.sessionId, error: error.message });
        });
    }
    handleChannelOutput(session, chunk, streamName) {
        try {
            const data = normalizeChannelData(chunk);
            session.xtermAdapter.write(data);
            const now = new Date();
            session.dirtyTracker.markDirty(now);
            session.lastActivityAt = now.toISOString();
            session.metadata.ssh.lastDataAt = session.dirtyTracker.getLastDataAtIso();
            session.transcript.recordOutput(data);
        }
        catch (error) {
            session.status = "error";
            this.logger.error("ssh-pty output parse failed", {
                sessionId: session.sessionId,
                stream: streamName,
                error: stringifyUnknownError(error),
            });
        }
    }
    getSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session === undefined) {
            throw new SessionNotFoundError(sessionId);
        }
        return session;
    }
    getWritableSession(sessionId) {
        const session = this.getSession(sessionId);
        if (session.channel === null || session.client === null || session.status === "exited" || session.status === "killed" || session.status === "error") {
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
            metadata: session.metadata,
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
}
/** 将 target 解析为 ssh-pty 可启动的远程 profile；local target 必须 fail-closed。 */
export function resolveSshPtyTarget(target, hostsConfig) {
    const resolved = resolveSshTarget(target, hostsConfig);
    if (resolved.kind !== "ssh") {
        throw new ProviderCapabilityUnsupportedError("ssh-pty", "target.kind=ssh");
    }
    return resolved;
}
/**
 * 读取 SSH 认证材料并转成 ssh2 ConnectConfig 字段。
 *
 * 注意：key-file 模式必须读取私钥 Buffer 才能交给 ssh2，但不会输出、缓存或写入 artifact。
 */
export async function resolveSshPtyAuthConnectConfig(auth) {
    const resolved = await resolveSshAuth(auth);
    if (resolved.type === "agent") {
        return {
            authType: "agent",
            connectConfig: { agent: resolved.socket },
            redactedSummary: { type: "agent", socket: resolved.socket },
        };
    }
    const privateKey = await readFile(resolved.path);
    const passphrase = auth.type === "key-file" && auth.passphraseEnv !== undefined
        ? process.env[auth.passphraseEnv]
        : undefined;
    return {
        authType: "key-file",
        connectConfig: passphrase === undefined ? { privateKey } : { privateKey, passphrase },
        redactedSummary: {
            type: "key-file",
            path: resolved.path,
            passphraseConfigured: passphrase !== undefined,
        },
    };
}
/** 构造 ssh2 ConnectConfig；认证方式显式限制为 agent 或 publickey，禁止 password 回退。 */
export function buildSshConnectConfig(target, auth, hostVerifier) {
    return {
        host: target.host,
        port: target.port,
        username: target.username,
        ...auth.connectConfig,
        hostVerifier,
        readyTimeout: target.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
        keepaliveInterval: target.keepaliveIntervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS,
        strictVendor: true,
        tryKeyboard: false,
        authHandler: auth.authType === "agent" ? ["agent"] : ["publickey"],
    };
}
/**
 * 校验 SSH 握手阶段服务器实际提供的 host key。
 * pinned fingerprint 优先；否则使用 known_hosts 中同 host/port 的公开 key 指纹比对。
 */
export async function verifyPresentedHostKey(profile, offeredKey) {
    const actualFingerprint = computeHostFingerprint(offeredKey.toString("base64"), "sha256");
    if (profile.pinnedHostFingerprint !== undefined) {
        const result = verifyPinnedFingerprint(profile.pinnedHostFingerprint, actualFingerprint);
        if (!result.ok) {
            throw new SshHostKeyUnknownError(profile.host, result);
        }
        if (!result.matches) {
            throw new SshHostKeyMismatchError(profile.host, result);
        }
        return result.fingerprint;
    }
    if (profile.knownHosts === undefined) {
        throw new SshHostKeyUnknownError(profile.host, {
            reason: "no_trust_source",
            detail: "Neither knownHosts nor pinnedHostFingerprint is configured",
        });
    }
    const entries = await parseKnownHosts(profile.knownHosts);
    const hostEntries = entries.filter((entry) => knownHostEntryMatchesTarget(entry, profile.host, profile.port));
    if (hostEntries.length === 0) {
        throw new SshHostKeyUnknownError(profile.host, {
            reason: "host_not_found",
            detail: `Host ${profile.host}:${profile.port} was not found in known_hosts`,
        });
    }
    const matchedEntry = hostEntries.find((entry) => {
        try {
            const expectedFingerprint = computeHostFingerprint(entry.publicKey, "sha256");
            const result = verifyPinnedFingerprint(expectedFingerprint, actualFingerprint);
            return result.ok === true && result.matches === true;
        }
        catch {
            return false;
        }
    });
    if (matchedEntry === undefined) {
        throw new SshHostKeyMismatchError(profile.host, {
            reason: "key_mismatch",
            actualFingerprint,
            knownHostCount: hostEntries.length,
        });
    }
    return computeHostFingerprint(matchedEntry.publicKey, "sha256");
}
/** 使用 POSIX shell 单引号转义远端 exec 字符串，避免未转义拼接命令/参数。 */
export function shellQuote(value) {
    return `'${value.replace(/'/gu, `'\\''`)}'`;
}
export function buildShellExecCommand(command, args) {
    return `exec ${[command, ...args].map(shellQuote).join(" ")}`;
}
/**
 * ssh2 exec request 只能发送 command string；这里用严格转义构造：
 * Unix: exec <remote-shell> -l -ic 'cd <cwd> && exec <command> <args...>'
 * Windows: <remote-shell> /c "cd <cwd> && <command> <args...>"
 */
export function buildRemoteExecCommand(command, args, cwd, capabilities = { os: "Unknown", shell: "/bin/sh" }) {
    if (isWindowsRemoteOs(capabilities.os)) {
        return buildWindowsRemoteExecCommand(command, args, cwd, capabilities.shell);
    }
    const innerCommand = `cd ${shellQuote(cwd)} && ${buildShellExecCommand(command, args)}`;
    return `exec ${shellQuote(capabilities.shell)} -l -ic ${shellQuote(innerCommand)}`;
}
function connectSshClient(client, config, target, getHostKeyError) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timeoutMs = config.readyTimeout ?? DEFAULT_CONNECT_TIMEOUT_MS;
        const finish = (error) => {
            if (settled)
                return;
            settled = true;
            client.removeListener("ready", onReady);
            client.removeListener("error", onError);
            client.removeListener("timeout", onTimeout);
            if (error === undefined) {
                resolve();
            }
            else {
                reject(error);
            }
        };
        const onReady = () => finish();
        const onTimeout = () => finish(new SshConnectTimeoutError(formatTargetHost(target), timeoutMs));
        const onError = (error) => finish(getHostKeyError() ?? mapSshClientError(target, error, timeoutMs));
        client.once("ready", onReady);
        client.once("error", onError);
        client.once("timeout", onTimeout);
        try {
            client.connect(config);
        }
        catch (error) {
            finish(error);
        }
    });
}
function openRemotePtyExecChannel(client, options) {
    return new Promise((resolve, reject) => {
        const pty = {
            term: SSH_TERM,
            cols: options.cols,
            rows: options.rows,
            width: DEFAULT_PIXEL_WIDTH,
            height: DEFAULT_PIXEL_HEIGHT,
        };
        const command = buildRemoteExecCommand(options.command, options.args, options.cwd, options.capabilities);
        client.exec(command, { pty, env: options.env }, (error, channel) => {
            if (error !== undefined) {
                reject(error);
                return;
            }
            resolve(channel);
        });
    });
}
function createSshSessionMetadata(target, authType, cwd, input, hostFingerprint, connectedAt) {
    return {
        target: {
            kind: "ssh",
            profile: target.profile,
            host: target.host,
            port: target.port,
            username: target.username,
            hostFingerprint,
        },
        ssh: {
            authType,
            knownHostPolicy: "strict",
            connectedAt,
        },
        remote: {
            cwd,
            command: input.command,
            args: [...input.args],
            pty: {
                term: SSH_TERM,
                cols: input.cols,
                rows: input.rows,
            },
        },
    };
}
function knownHostEntryMatchesTarget(entry, host, port) {
    const expected = new Set([host, `${host}:${port}`, `[${host}]:${port}`]);
    if (port === 22) {
        expected.add(host);
    }
    return expected.has(entry.host);
}
function normalizeHostKeyError(target, error) {
    if (error instanceof TerminalUseError) {
        return error;
    }
    return new SshHostKeyUnknownError(formatTargetHost(target), stringifyUnknownError(error));
}
function mapSshStartError(target, error) {
    if (error instanceof TerminalUseError) {
        return error;
    }
    return new SshConnectionLostError(formatTargetHost(target), stringifyUnknownError(error));
}
function mapSshClientError(target, error, timeoutMs) {
    const message = error.message.toLowerCase();
    if (message.includes("timed out") || message.includes("timeout")) {
        return new SshConnectTimeoutError(formatTargetHost(target), timeoutMs);
    }
    if (message.includes("authentication") || message.includes("all configured authentication methods failed")) {
        return new SshAuthFailedError(formatTargetHost(target), error.message);
    }
    return new SshConnectionLostError(formatTargetHost(target), error.message);
}
function formatTargetHost(target) {
    return `${target.username}@${target.host}:${target.port}`;
}
function remoteCapabilityProfileName(target) {
    return target.profile ?? target.name;
}
function isWindowsRemoteOs(os) {
    return /^(Windows|Windows_NT)/iu.test(os) || /(?:MINGW|MSYS|CYGWIN)/iu.test(os);
}
function buildWindowsRemoteExecCommand(command, args, cwd, shell) {
    const quotedShell = quoteWindowsPath(shell);
    if (isPowerShell(shell)) {
        const commandLine = `Set-Location -LiteralPath ${powerShellSingleQuote(cwd)}; & ${[command, ...args].map(powerShellSingleQuote).join(" ")}`;
        return `${quotedShell} -NoProfile -Command ${windowsCmdQuote(commandLine)}`;
    }
    const commandLine = `cd ${windowsCmdQuote(cwd)} && ${[command, ...args].map(windowsCmdQuote).join(" ")}`;
    return `${quotedShell} /c ${windowsCmdQuote(commandLine)}`;
}
/** Quote a Windows executable path when it contains spaces. */
export function quoteWindowsPath(path) {
    return path.includes(" ") ? `"${path}"` : path;
}
function isPowerShell(shell) {
    const winBase = path.win32.basename(shell).toLowerCase();
    const posixBase = path.posix.basename(shell).toLowerCase();
    return [winBase, posixBase].some((base) => base === "powershell.exe" || base === "pwsh.exe");
}
function windowsCmdQuote(value) {
    if (/^[A-Za-z0-9_@%+=:,./\\-]+$/u.test(value))
        return value;
    return `"${value.replace(/["^&|<>%]/gu, (char) => `^${char}`)}"`;
}
function powerShellSingleQuote(value) {
    return `'${value.replace(/'/gu, "''")}'`;
}
function normalizeChannelData(chunk) {
    return typeof chunk === "string" ? chunk : chunk.toString("utf8");
}
function stringifyUnknownError(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
