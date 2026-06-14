/**
 * 终端目标与 SSH Profile 类型
 *
 * 这里仅定义"在哪里运行"的目标与远程 profile 契约，不做任何真实 SSH 连接。
 * 安全原则：认证只允许引用 agent 或 key-file 路径，禁止密码与私钥内容进入配置。
 *
 * 配置扩展：
 * - sshConfigHost：指向 OpenSSH ~/.ssh/config 中的 Host 别名，
 *   SSH 连接参数（Host/Port/User/IdentityFile）从该处解析，不重复配置。
 * - SshAuthRef agent 的 socket 支持自动发现链。
 */
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
 * 类型守卫：ssh-agent 认证引用。
 * 只接受可选 socket 字符串，不读取 SSH_AUTH_SOCK 的值。
 */
export function isSshAgentAuthRef(value) {
    if (!isRecord(value) || value.type !== "agent")
        return false;
    return value.socket === undefined || typeof value.socket === "string";
}
/**
 * 类型守卫：key-file 认证引用。
 * 只允许保存密钥文件路径和 passphraseEnv 名称，禁止保存 passphrase 明文。
 */
export function isSshKeyFileAuthRef(value) {
    if (!isRecord(value) || value.type !== "key-file")
        return false;
    if (typeof value.path !== "string" || value.path.trim().length === 0)
        return false;
    return value.passphraseEnv === undefined || (typeof value.passphraseEnv === "string" && value.passphraseEnv.trim().length > 0);
}
/** 类型守卫：任一安全 SSH 认证引用。 */
export function isSshAuthRef(value) {
    return isSshAgentAuthRef(value) || isSshKeyFileAuthRef(value);
}
