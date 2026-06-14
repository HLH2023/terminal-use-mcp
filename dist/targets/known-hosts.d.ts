/**
 * OpenSSH known_hosts 解析与只读校验。
 *
 * 本模块只读取用户指定的 known_hosts 文件，不修改文件、不接受未知 host key、
 * 不使用 StrictHostKeyChecking=no。verify_target 不建立 SSH 连接，因此
 * verifyHostKey 的职责是确认目标 host/port 已存在于信任文件，并返回其
 * 公开 host key fingerprint，供后续 provider 连接阶段进行严格比对。
 */
/** 已知主机条目 */
export type KnownHostEntry = {
    host: string;
    keyType: string;
    publicKey: string;
    /** 原始行号，用于错误定位 */
    sourceLine?: number;
};
/** 已知主机校验结果 */
export type KnownHostVerifyResult = {
    ok: true;
    fingerprint: string;
} | {
    ok: false;
    reason: "host_not_found" | "key_mismatch" | "file_not_found" | "parse_error";
    detail: string;
};
/** 解析 OpenSSH known_hosts 文件。缺失文件按空列表处理，便于上层决定错误语义。 */
export declare function parseKnownHosts(filePath: string): Promise<KnownHostEntry[]>;
/**
 * 校验目标 host/port 是否已出现在 known_hosts 中。
 *
 * 本工具 不发起 SSH 握手，因此无法拿到“实时 host key”做最终 mismatch 判断；
 * 这里返回 known_hosts 中记录的 fingerprint，供后续 SSH provider 与
 * 实际 SSH 握手 key 进行严格比对。
 */
export declare function verifyHostKey(host: string, port: number, knownHostsPath: string): Promise<KnownHostVerifyResult>;
