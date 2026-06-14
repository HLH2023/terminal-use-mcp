/**
 * Secret redaction — 检测和替换文本中的敏感信息
 */

interface SecretPattern {
  name: string
  pattern: RegExp
  replacement: string
}

// 所有 secret 模式定义
const SECRET_PATTERNS: SecretPattern[] = [
  { name: "github_token", pattern: /ghp_[0-9a-zA-Z]{36}/g, replacement: "<REDACTED_github_token>" },
  { name: "github_oauth", pattern: /gho_[0-9a-zA-Z]{36}/g, replacement: "<REDACTED_github_oauth>" },
  { name: "github_user", pattern: /ghu_[0-9a-zA-Z]{36}/g, replacement: "<REDACTED_github_user>" },
  { name: "github_app", pattern: /ghs_[0-9a-zA-Z]{36}/g, replacement: "<REDACTED_github_app>" },
  { name: "openai_key", pattern: /sk-[a-zA-Z0-9]{20}T3BlbkFJ[a-zA-Z0-9]{20}/g, replacement: "<REDACTED_openai_key>" },
  { name: "openai_proj_key", pattern: /sk-proj-[a-zA-Z0-9-]+/g, replacement: "<REDACTED_openai_proj_key>" },
  { name: "anthropic_key", pattern: /sk-ant-[a-zA-Z0-9-]+/g, replacement: "<REDACTED_anthropic_key>" },
  { name: "aws_access_key", pattern: /(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}/g, replacement: "<REDACTED_aws_access_key>" },
  { name: "bearer_token", pattern: /Bearer\s+[a-zA-Z0-9\-._~+/]+=*/g, replacement: "<REDACTED_bearer_token>" },
  { name: "private_key", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, replacement: "<REDACTED_private_key>" },
  { name: "x_api_key", pattern: /x-api-key[:\s=]+[a-zA-Z0-9\-_]+/gi, replacement: "<REDACTED_x_api_key>" },
]

// .env 行级别模式 (逐行匹配)
const ENV_SECRET_PATTERN = /^(\s*(?:password|secret|token|api_key|apikey|api-key|access_key|private_key|privatekey)\s*=\s*)\S.*$/gim

/**
 * 替换文本中的所有 secret
 */
export function redactSecrets(text: string): string {
  let result = text
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    // 重置 lastIndex (因为很多 pattern 带 g flag)
    pattern.lastIndex = 0
    result = result.replace(pattern, replacement)
  }
  // .env 行级别替换
  result = result.replace(ENV_SECRET_PATTERN, "$1<REDACTED_env_secret>")
  return result
}

/**
 * 检测文本是否包含 secret
 */
export function containsSecrets(text: string): boolean {
  return getDetectedSecretTypes(text).length > 0
}

/**
 * 返回检测到的 secret 类型名列表
 */
export function getDetectedSecretTypes(text: string): string[] {
  const found: string[] = []

  for (const { name, pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0
    if (pattern.test(text)) {
      found.push(name)
    }
  }

  // 检查 .env 风格
  ENV_SECRET_PATTERN.lastIndex = 0
  if (ENV_SECRET_PATTERN.test(text)) {
    found.push("env_secret")
  }

  return found
}
