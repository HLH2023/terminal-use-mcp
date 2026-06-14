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
/** 系统 ssh 目标；认证材料通过 options 单独传入，避免混入 host 标识。 */
export type SystemSshTarget = {
    host: string;
    port: number;
    username: string;
    proxyJump?: string;
};
export type ExecSshCommandOptions = {
    /** key-file 认证路径；只传路径，不读取私钥内容。 */
    keyFile?: string;
    /** SSH 连接超时。OpenSSH ConnectTimeout 单位为秒，本模块会从毫秒向上取整。 */
    connectTimeoutMs?: number;
    /** 本地 execFile 总超时，防止远程 tmux 命令无限挂起。 */
    execTimeoutMs?: number;
};
export type SystemSshCommandResult = {
    stdout: string;
    stderr: string;
    exitCode: number | null;
};
export type ExecRemoteResult = {
    stdout: string;
    stderr: string;
};
/** Transport interface for raw remote SSH command execution. */
export interface SystemSshTransport {
    /** Execute an arbitrary command on the remote host via SSH. Returns stdout and stderr. */
    execRemote(command: string, timeoutMs?: number): Promise<ExecRemoteResult>;
}
/** 供测试和 Provider 复用的系统 ssh argv 构造函数。 */
export declare function buildSshCommandArgs(target: SystemSshTarget, remoteArgs: readonly string[], options?: ExecSshCommandOptions): string[];
/** Build argv for a raw remote command string executed by the remote login shell. */
export declare function buildSshRawCommandArgs(target: SystemSshTarget, command: string, options?: ExecSshCommandOptions): string[];
/**
 * POSIX shell argv 转义。
 *
 * 远端 sshd 对 exec command 通常仍经由用户 shell 解析；这里仅把“单个参数”
 * 转义成不可再拆分的 shell token。调用方禁止自行拼接未转义字符串。
 */
export declare function quoteRemoteArg(value: string): string;
/** 系统 SSH 命令执行器 — 使用参数数组，禁止 shell 字符串拼接。 */
export declare function execSshCommand(target: SystemSshTarget, remoteArgs: readonly string[], options?: ExecSshCommandOptions): Promise<SystemSshCommandResult>;
/** Execute an arbitrary raw command on the remote host via SSH. */
export declare function execRemote(target: SystemSshTarget, command: string, options?: ExecSshCommandOptions): Promise<SystemSshCommandResult>;
/** 检查系统 ssh 是否在 PATH 中可执行；不读取任何用户 SSH 配置或发起连接。 */
export declare function isSystemSshAvailable(): Promise<boolean>;
