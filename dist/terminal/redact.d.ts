/**
 * Secret redaction — 检测和替换文本中的敏感信息
 */
/**
 * 替换文本中的所有 secret
 */
export declare function redactSecrets(text: string): string;
/**
 * 检测文本是否包含 secret
 */
export declare function containsSecrets(text: string): boolean;
/**
 * 返回检测到的 secret 类型名列表
 */
export declare function getDetectedSecretTypes(text: string): string[];
