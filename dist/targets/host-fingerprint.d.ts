/**
 * Host fingerprint 解析、计算与 pinned fingerprint 比对。
 *
 * 注意：fingerprint 不是认证凭据，但它是信任锚。这里仅处理公开 host key
 * 的摘要，不接触私钥、passphrase 或 token。
 */
export type ParsedFingerprint = {
    algorithm: "SHA256" | "MD5";
    hash: string;
};
/** 指纹校验结果 */
export type FingerprintVerifyResult = {
    ok: true;
    matches: true;
    algorithm: string;
    fingerprint: string;
} | {
    ok: true;
    matches: false;
    algorithm: string;
    expectedFingerprint: string;
    actualFingerprint: string;
} | {
    ok: false;
    reason: "no_fingerprint_provided" | "fingerprint_format_invalid" | "key_unavailable";
    detail: string;
};
/**
 * 解析 OpenSSH 常见 fingerprint 形式。
 *
 * 支持：
 * - `SHA256:xxxxx`
 * - `sha256-xxxxx`（兼容少量 CLI/日志中的连字符写法）
 * - `MD5:aa:bb:cc...`
 */
export declare function parseFingerprint(fingerprint: string): ParsedFingerprint | null;
/**
 * 从 known_hosts 中的 public key base64 内容计算 host fingerprint。
 *
 * OpenSSH 的 SHA256 fingerprint 去掉 base64 padding；MD5 使用冒号分隔 hex。
 */
export declare function computeHostFingerprint(publicKey: string, algorithm: "sha256" | "md5"): string;
/** 比对 pinned fingerprint 与实际 fingerprint。 */
export declare function verifyPinnedFingerprint(pinnedFingerprint: string, actualFingerprint: string): FingerprintVerifyResult;
