/**
 * Host fingerprint 解析、计算与 pinned fingerprint 比对。
 *
 * 注意：fingerprint 不是认证凭据，但它是信任锚。这里仅处理公开 host key
 * 的摘要，不接触私钥、passphrase 或 token。
 */
import { createHash } from "node:crypto";
/**
 * 解析 OpenSSH 常见 fingerprint 形式。
 *
 * 支持：
 * - `SHA256:xxxxx`
 * - `sha256-xxxxx`（兼容少量 CLI/日志中的连字符写法）
 * - `MD5:aa:bb:cc...`
 */
export function parseFingerprint(fingerprint) {
    const trimmed = fingerprint.trim();
    if (trimmed.length === 0) {
        return null;
    }
    // ssh-keygen 输出后可能带注释，这里只取第一段，避免注释影响解析。
    const token = trimmed.split(/\s+/u)[0] ?? "";
    const sha256Colon = /^SHA256:([A-Za-z0-9+/=]+)$/iu.exec(token);
    if (sha256Colon !== null) {
        return { algorithm: "SHA256", hash: stripBase64Padding(sha256Colon[1]) };
    }
    const sha256Dash = /^sha256-([A-Za-z0-9+/=]+)$/iu.exec(token);
    if (sha256Dash !== null) {
        return { algorithm: "SHA256", hash: stripBase64Padding(sha256Dash[1]) };
    }
    const md5 = /^MD5:([0-9a-f]{2}(?::[0-9a-f]{2})+)$/iu.exec(token);
    if (md5 !== null) {
        return { algorithm: "MD5", hash: md5[1].toLowerCase() };
    }
    return null;
}
/**
 * 从 known_hosts 中的 public key base64 内容计算 host fingerprint。
 *
 * OpenSSH 的 SHA256 fingerprint 去掉 base64 padding；MD5 使用冒号分隔 hex。
 */
export function computeHostFingerprint(publicKey, algorithm) {
    const keyBytes = Buffer.from(publicKey, "base64");
    if (keyBytes.length === 0) {
        throw new Error("Host public key is empty or invalid base64");
    }
    if (algorithm === "sha256") {
        const digest = createHash("sha256").update(keyBytes).digest("base64");
        return `SHA256:${stripBase64Padding(digest)}`;
    }
    const hex = createHash("md5").update(keyBytes).digest("hex");
    const pairs = hex.match(/[0-9a-f]{2}/gu) ?? [];
    return `MD5:${pairs.join(":")}`;
}
/** 比对 pinned fingerprint 与实际 fingerprint。 */
export function verifyPinnedFingerprint(pinnedFingerprint, actualFingerprint) {
    if (pinnedFingerprint.trim().length === 0) {
        return { ok: false, reason: "no_fingerprint_provided", detail: "No pinned host fingerprint was provided" };
    }
    if (actualFingerprint.trim().length === 0) {
        return { ok: false, reason: "key_unavailable", detail: "Actual host fingerprint is unavailable" };
    }
    const expected = parseFingerprint(pinnedFingerprint);
    const actual = parseFingerprint(actualFingerprint);
    if (expected === null || actual === null) {
        return {
            ok: false,
            reason: "fingerprint_format_invalid",
            detail: "Fingerprint must use SHA256:<base64> / sha256-<base64> / MD5:<hex-pairs> format",
        };
    }
    const expectedCanonical = formatParsedFingerprint(expected);
    const actualCanonical = formatParsedFingerprint(actual);
    const matches = expected.algorithm === actual.algorithm && expected.hash === actual.hash;
    if (matches) {
        return { ok: true, matches: true, algorithm: actual.algorithm, fingerprint: actualCanonical };
    }
    return {
        ok: true,
        matches: false,
        algorithm: expected.algorithm,
        expectedFingerprint: expectedCanonical,
        actualFingerprint: actualCanonical,
    };
}
function formatParsedFingerprint(fingerprint) {
    return `${fingerprint.algorithm}:${fingerprint.hash}`;
}
function stripBase64Padding(value) {
    return value.replace(/=+$/u, "");
}
