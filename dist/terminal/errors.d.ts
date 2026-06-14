/**
 * terminal-use-mcp 错误体系
 *
 * 所有 tool 错误通过 TerminalUseError 子类抛出，
 * 由统一 handler 序列化为结构化 error envelope。
 */
export type TerminalUseErrorCode = "SESSION_NOT_FOUND" | "PROVIDER_NOT_AVAILABLE" | "PROVIDER_CAPABILITY_UNSUPPORTED" | "SESSION_TIMEOUT" | "UNSAFE_COMMAND" | "LARGE_PASTE_REFUSED" | "SECRET_DETECTED" | "CONFIRMATION_REQUIRED" | "SESSION_BUSY" | "PROCESS_EXITED" | "DEPENDENCY_MISSING" | "INVALID_CWD" | "INVALID_MOUSE_COORDS" | "INVALID_KEY" | "INTERNAL_ERROR" | "SSH_PROFILE_NOT_FOUND" | "SSH_HOST_KEY_MISMATCH" | "SSH_HOST_KEY_UNKNOWN" | "SSH_AUTH_FAILED" | "SSH_CONNECT_TIMEOUT" | "SSH_CONNECTION_LOST" | "SSH_INLINE_TARGET_DENIED" | "REMOTE_CWD_DENIED" | "REMOTE_TMUX_NOT_AVAILABLE" | "REMOTE_COMMAND_DENIED";
export type ErrorEnvelope = {
    ok: false;
    error: {
        code: TerminalUseErrorCode;
        message: string;
        provider?: string;
        sessionId?: string;
        retryable: boolean;
        hint?: string;
        details?: unknown;
    };
};
export declare class TerminalUseError extends Error {
    readonly code: TerminalUseErrorCode;
    readonly retryable: boolean;
    readonly hint?: string;
    readonly details?: unknown;
    readonly provider?: string;
    readonly sessionId?: string;
    constructor(opts: {
        code: TerminalUseErrorCode;
        message: string;
        retryable?: boolean;
        hint?: string;
        details?: unknown;
        provider?: string;
        sessionId?: string;
    });
    toEnvelope(): ErrorEnvelope;
}
export declare class SessionNotFoundError extends TerminalUseError {
    constructor(sessionId: string);
}
export declare class ProviderNotAvailableError extends TerminalUseError {
    constructor(provider: string, hint?: string);
}
export declare class ProviderCapabilityUnsupportedError extends TerminalUseError {
    constructor(provider: string, capability: string);
}
export declare class SessionTimeoutError extends TerminalUseError {
    constructor(sessionId: string, timeoutMs: number, hint?: string);
}
export declare class UnsafeCommandError extends TerminalUseError {
    constructor(command: string, hint?: string);
}
export declare class LargePasteRefusedError extends TerminalUseError {
    constructor(length: number, limit: number, hard?: boolean);
}
export declare class SecretDetectedError extends TerminalUseError {
    constructor(types: string[]);
}
export declare class ConfirmationRequiredError extends TerminalUseError {
    constructor(command: string);
}
export declare class SessionBusyError extends TerminalUseError {
    constructor(sessionId: string);
}
export declare class ProcessExitedError extends TerminalUseError {
    constructor(sessionId: string, exitCode: number | null);
}
export declare class DependencyMissingError extends TerminalUseError {
    constructor(dependency: string, hint?: string);
}
export declare class InvalidCwdError extends TerminalUseError {
    constructor(cwd: string, reason: string);
}
export declare class InvalidMouseCoordsError extends TerminalUseError {
    constructor(col: number, row: number, reason: string);
}
export declare class InvalidKeyError extends TerminalUseError {
    constructor(key: string);
}
export declare class InternalError extends TerminalUseError {
    constructor(message: string, details?: unknown);
}
export declare class SshProfileNotFoundError extends TerminalUseError {
    constructor(profile: string);
}
export declare class SshHostKeyMismatchError extends TerminalUseError {
    constructor(host: string, details?: unknown);
}
export declare class SshHostKeyUnknownError extends TerminalUseError {
    constructor(host: string, details?: unknown);
}
export declare class SshAuthFailedError extends TerminalUseError {
    constructor(host: string, details?: unknown);
}
export declare class SshConnectTimeoutError extends TerminalUseError {
    constructor(host: string, timeoutMs: number);
}
export declare class SshConnectionLostError extends TerminalUseError {
    constructor(host: string, details?: unknown);
}
export declare class SshInlineTargetDeniedError extends TerminalUseError {
    constructor();
}
export declare class RemoteCwdDeniedError extends TerminalUseError {
    constructor(cwd: string, reason: string);
}
export declare class RemoteTmuxNotAvailableError extends TerminalUseError {
    constructor(profile: string);
}
export declare class RemoteCommandDeniedError extends TerminalUseError {
    constructor(command: string, reason: string);
}
