/**
 * terminal-use-mcp 错误体系
 *
 * 所有 tool 错误通过 TerminalUseError 子类抛出，
 * 由统一 handler 序列化为结构化 error envelope。
 */
export class TerminalUseError extends Error {
    code;
    retryable;
    hint;
    details;
    provider;
    sessionId;
    constructor(opts) {
        super(opts.message);
        this.name = "TerminalUseError";
        this.code = opts.code;
        this.retryable = opts.retryable ?? false;
        this.hint = opts.hint;
        this.details = opts.details;
        this.provider = opts.provider;
        this.sessionId = opts.sessionId;
    }
    toEnvelope() {
        return {
            ok: false,
            error: {
                code: this.code,
                message: this.message,
                provider: this.provider,
                sessionId: this.sessionId,
                retryable: this.retryable,
                hint: this.hint,
                details: this.details,
            },
        };
    }
}
// 便捷子类 — 每个 error code 一个
export class SessionNotFoundError extends TerminalUseError {
    constructor(sessionId) {
        super({ code: "SESSION_NOT_FOUND", message: `Session not found: ${sessionId}`, sessionId, retryable: false });
    }
}
export class ProviderNotAvailableError extends TerminalUseError {
    constructor(provider, hint) {
        super({ code: "PROVIDER_NOT_AVAILABLE", message: `Provider not available: ${provider}`, provider, retryable: false, hint });
    }
}
export class ProviderCapabilityUnsupportedError extends TerminalUseError {
    constructor(provider, capability) {
        super({ code: "PROVIDER_CAPABILITY_UNSUPPORTED", message: `Provider ${provider} does not support: ${capability}`, provider, retryable: false });
    }
}
export class SessionTimeoutError extends TerminalUseError {
    constructor(sessionId, timeoutMs, hint) {
        super({ code: "SESSION_TIMEOUT", message: `Session ${sessionId} timed out after ${timeoutMs}ms`, sessionId, retryable: true, hint });
    }
}
export class UnsafeCommandError extends TerminalUseError {
    constructor(command, hint) {
        super({ code: "UNSAFE_COMMAND", message: `Command blocked by safety policy: ${command}`, retryable: false, hint });
    }
}
export class LargePasteRefusedError extends TerminalUseError {
    constructor(length, limit, hard) {
        super({
            code: "LARGE_PASTE_REFUSED",
            message: hard
                ? `Paste length ${length} exceeds hard limit ${limit}`
                : `Paste length ${length} exceeds soft limit ${limit}; set confirmLargePaste=true to proceed`,
            retryable: false,
            hint: hard ? "Reduce paste content length" : "Set confirmLargePaste=true",
            details: { length, limit, hard },
        });
    }
}
export class SecretDetectedError extends TerminalUseError {
    constructor(types) {
        super({ code: "SECRET_DETECTED", message: `Paste contains detected secrets: ${types.join(", ")}`, retryable: false, hint: "Remove secrets from paste content", details: { types } });
    }
}
export class ConfirmationRequiredError extends TerminalUseError {
    constructor(command) {
        super({ code: "CONFIRMATION_REQUIRED", message: `Command requires user confirmation: ${command}`, retryable: true, hint: "Ask user for confirmation before proceeding" });
    }
}
export class SessionBusyError extends TerminalUseError {
    constructor(sessionId) {
        super({ code: "SESSION_BUSY", message: `Session ${sessionId} is busy (operation in progress)`, sessionId, retryable: true });
    }
}
export class ProcessExitedError extends TerminalUseError {
    constructor(sessionId, exitCode) {
        super({ code: "PROCESS_EXITED", message: `Process in session ${sessionId} has exited (code: ${exitCode})`, sessionId, retryable: false, details: { exitCode } });
    }
}
export class DependencyMissingError extends TerminalUseError {
    constructor(dependency, hint) {
        super({ code: "DEPENDENCY_MISSING", message: `Required dependency missing: ${dependency}`, retryable: false, hint });
    }
}
export class InvalidCwdError extends TerminalUseError {
    constructor(cwd, reason) {
        super({ code: "INVALID_CWD", message: `Invalid working directory: ${cwd} (${reason})`, retryable: false, hint: "Use a directory within the allowed workspace" });
    }
}
export class InvalidMouseCoordsError extends TerminalUseError {
    constructor(col, row, reason) {
        super({
            code: "INVALID_MOUSE_COORDS",
            message: `Invalid mouse coordinates (${col}, ${row}): ${reason}`,
            retryable: false,
            hint: "Coordinates must be >= 1 and within terminal dimensions",
            details: { col, row, reason },
        });
    }
}
export class InvalidKeyError extends TerminalUseError {
    constructor(key) {
        super({
            code: "INVALID_KEY",
            message: `Unsupported key expression: "${key}"`,
            retryable: false,
            hint: 'Supported formats: "enter", "ctrl+a", "alt+enter", "shift+tab", "f1", "ctrl+f1". Use terminal.keys to see common key names.',
        });
    }
}
export class InternalError extends TerminalUseError {
    constructor(message, details) {
        super({ code: "INTERNAL_ERROR", message, retryable: false, details });
    }
}
// SSH 错误 — 只表达配置/连接边界，verify_target 不建立真实 SSH 连接。
export class SshProfileNotFoundError extends TerminalUseError {
    constructor(profile) {
        super({
            code: "SSH_PROFILE_NOT_FOUND",
            message: `SSH profile not found: ${profile}`,
            retryable: false,
            hint: "Run terminal.targets to list configured SSH profiles",
            details: { profile },
        });
    }
}
export class SshHostKeyMismatchError extends TerminalUseError {
    constructor(host, details) {
        super({ code: "SSH_HOST_KEY_MISMATCH", message: `SSH host key mismatch: ${host}`, retryable: false, hint: "Verify known_hosts or pinnedHostFingerprint before reconnecting", details });
    }
}
export class SshHostKeyUnknownError extends TerminalUseError {
    constructor(host, details) {
        super({ code: "SSH_HOST_KEY_UNKNOWN", message: `SSH host key unknown: ${host}`, retryable: false, hint: "Configure knownHosts or pinnedHostFingerprint; do not disable host key checking", details });
    }
}
export class SshAuthFailedError extends TerminalUseError {
    constructor(host, details) {
        super({ code: "SSH_AUTH_FAILED", message: `SSH authentication failed: ${host}`, retryable: false, hint: "Check ssh-agent or key-file profile configuration", details });
    }
}
export class SshConnectTimeoutError extends TerminalUseError {
    constructor(host, timeoutMs) {
        super({ code: "SSH_CONNECT_TIMEOUT", message: `SSH connection to ${host} timed out after ${timeoutMs}ms`, retryable: true, hint: "Check network reachability and connectTimeoutMs", details: { host, timeoutMs } });
    }
}
export class SshConnectionLostError extends TerminalUseError {
    constructor(host, details) {
        super({ code: "SSH_CONNECTION_LOST", message: `SSH connection lost: ${host}`, retryable: true, hint: "Reconnect or use ssh-tmux for long-running sessions", details });
    }
}
export class SshInlineTargetDeniedError extends TerminalUseError {
    constructor() {
        super({
            code: "SSH_INLINE_TARGET_DENIED",
            message: "Inline SSH targets are disabled by default",
            retryable: false,
            hint: "Use a named SSH profile, or set TERMINAL_USE_ALLOW_INLINE_SSH_TARGETS=1 explicitly",
        });
    }
}
export class RemoteCwdDeniedError extends TerminalUseError {
    constructor(cwd, reason) {
        super({ code: "REMOTE_CWD_DENIED", message: `Remote CWD denied: ${cwd} (${reason})`, retryable: false, hint: "Use a directory under remoteAllowedCwd and outside remoteDeniedCwd", details: { cwd, reason } });
    }
}
export class RemoteTmuxNotAvailableError extends TerminalUseError {
    constructor(profile) {
        super({ code: "REMOTE_TMUX_NOT_AVAILABLE", message: `Remote tmux is not available for profile: ${profile}`, retryable: false, hint: "Install tmux on the remote host or use ssh-pty", details: { profile } });
    }
}
export class RemoteCommandDeniedError extends TerminalUseError {
    constructor(command, reason) {
        super({ code: "REMOTE_COMMAND_DENIED", message: `Remote command denied: ${command} (${reason})`, retryable: false, hint: "Remote command policy only gates terminal.start; ask the user before high-risk actions", details: { command, reason } });
    }
}
