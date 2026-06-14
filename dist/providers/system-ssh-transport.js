/**
 * 系统 SSH 传输封装。
 *
 * 安全边界：
 * - 只使用 child_process.execFile("ssh", args)，禁止 shell: true。
 * - 本地侧始终传参数数组，不拼接可执行命令字符串。
 * - OpenSSH 会把远程命令交给远端登录 shell 解析，因此 remoteArgs 会逐项做
 *   POSIX 单引号转义，再作为 argv 交给 ssh，避免空格、分号、$() 等字符逃逸。
 * - 强制 BatchMode=yes，避免出现交互式密码/passphrase 提示。
 * - 强制 StrictHostKeyChecking=yes，未知或变化的 host key 必须失败关闭。
 */
import { execFile } from "node:child_process";
import { SshAuthFailedError, SshConnectTimeoutError, SshHostKeyMismatchError, SshHostKeyUnknownError, } from "../terminal/errors.js";
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_EXEC_TIMEOUT_MS = 15_000;
const SSH_VERSION_TIMEOUT_MS = 2_000;
const SSH_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
/** 供测试和 Provider 复用的系统 ssh argv 构造函数。 */
export function buildSshCommandArgs(target, remoteArgs, options = {}) {
    return [...buildBaseSshArgs(target, options), "--", ...remoteArgs.map(quoteRemoteArg)];
}
/** Build argv for a raw remote command string executed by the remote login shell. */
export function buildSshRawCommandArgs(target, command, options = {}) {
    return [...buildBaseSshArgs(target, options), "--", command];
}
/**
 * POSIX shell argv 转义。
 *
 * 远端 sshd 对 exec command 通常仍经由用户 shell 解析；这里仅把“单个参数”
 * 转义成不可再拆分的 shell token。调用方禁止自行拼接未转义字符串。
 */
export function quoteRemoteArg(value) {
    if (value.length === 0)
        return "''";
    if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value))
        return value;
    return `'${value.replaceAll("'", `'"'"'`)}'`;
}
/** 系统 SSH 命令执行器 — 使用参数数组，禁止 shell 字符串拼接。 */
export async function execSshCommand(target, remoteArgs, options = {}) {
    const args = buildSshCommandArgs(target, remoteArgs, options);
    const execTimeoutMs = options.execTimeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    return executeSshFile(target, args, options, execTimeoutMs);
}
/** Execute an arbitrary raw command on the remote host via SSH. */
export async function execRemote(target, command, options = {}) {
    const args = buildSshRawCommandArgs(target, command, options);
    const execTimeoutMs = options.execTimeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    return executeSshFile(target, args, options, execTimeoutMs);
}
/** 检查系统 ssh 是否在 PATH 中可执行；不读取任何用户 SSH 配置或发起连接。 */
export async function isSystemSshAvailable() {
    return new Promise((resolve) => {
        execFile("ssh", ["-V"], { timeout: SSH_VERSION_TIMEOUT_MS }, (error) => {
            resolve(error === null);
        });
    });
}
function toOpenSshTimeoutSeconds(timeoutMs) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
        return Math.ceil(DEFAULT_CONNECT_TIMEOUT_MS / 1000);
    return Math.max(1, Math.ceil(timeoutMs / 1000));
}
function buildBaseSshArgs(target, options) {
    const connectTimeoutSeconds = toOpenSshTimeoutSeconds(options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
    const sshArgs = [
        "-p",
        String(target.port),
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        `ConnectTimeout=${connectTimeoutSeconds}`,
        "-o",
        "BatchMode=yes",
        `${target.username}@${target.host}`,
    ];
    if (options.keyFile !== undefined) {
        // 与 OpenSSH 惯例一致：-i 放在 host 前，且作为独立 argv 传入。
        sshArgs.unshift("-i", options.keyFile);
    }
    return sshArgs;
}
function executeSshFile(target, args, options, execTimeoutMs) {
    return new Promise((resolve, reject) => {
        execFile("ssh", args, { timeout: execTimeoutMs, maxBuffer: SSH_MAX_BUFFER_BYTES }, (error, stdout, stderr) => {
            const normalizedStdout = stdout ?? "";
            const normalizedStderr = stderr ?? "";
            if (error === null) {
                resolve({ stdout: normalizedStdout, stderr: normalizedStderr, exitCode: 0 });
                return;
            }
            const execError = error;
            const exitCode = typeof execError.code === "number" ? execError.code : null;
            const hostLabel = formatSshTarget(target);
            if (isTimeoutError(execError, normalizedStderr)) {
                reject(new SshConnectTimeoutError(hostLabel, options.connectTimeoutMs ?? execTimeoutMs));
                return;
            }
            if (exitCode === 255 && isHostKeyMismatch(normalizedStderr)) {
                reject(new SshHostKeyMismatchError(hostLabel, { stderr: normalizedStderr }));
                return;
            }
            if (exitCode === 255 && isHostKeyUnknown(normalizedStderr)) {
                reject(new SshHostKeyUnknownError(hostLabel, { stderr: normalizedStderr }));
                return;
            }
            if (exitCode === 255 && isAuthFailure(normalizedStderr)) {
                reject(new SshAuthFailedError(hostLabel, { stderr: normalizedStderr }));
                return;
            }
            resolve({ stdout: normalizedStdout, stderr: normalizedStderr, exitCode });
        });
    });
}
function formatSshTarget(target) {
    return `${target.username}@${target.host}:${target.port}`;
}
function isTimeoutError(error, stderr) {
    if (error.killed === true || error.signal === "SIGTERM")
        return true;
    return /connection timed out|operation timed out|connect timeout/i.test(stderr);
}
function isAuthFailure(stderr) {
    return /permission denied|too many authentication failures|authentication failed|publickey/i.test(stderr);
}
function isHostKeyMismatch(stderr) {
    return /remote host identification has changed|offending .* key/i.test(stderr);
}
function isHostKeyUnknown(stderr) {
    return /host key verification failed|no .* host key is known|authenticity of host/i.test(stderr);
}
