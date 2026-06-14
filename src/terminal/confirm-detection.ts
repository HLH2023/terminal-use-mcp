/**
 * 确认/危险提示检测
 *
 * 扫描终端屏幕文本，识别需要用户注意的风险信号。
 */


export type RiskSignal = {
  type: "confirmation_prompt" | "credential_prompt" | "destructive_prompt" | "external_agent_permission"
  text: string
  severity: "low" | "medium" | "high"
}

// 按类别分组的检测模式
const PATTERNS: Array<{
  type: RiskSignal["type"]
  severity: RiskSignal["severity"]
  pattern: RegExp
}> = [
  // credential_prompt (high severity)
  { type: "credential_prompt", severity: "high", pattern: /\bpassword\b/i },
  { type: "credential_prompt", severity: "high", pattern: /\btoken\b/i },
  { type: "credential_prompt", severity: "high", pattern: /\bcredential\b/i },
  { type: "credential_prompt", severity: "high", pattern: /\bsend token\b/i },
  { type: "credential_prompt", severity: "high", pattern: /\bAPI key\b/i },
  { type: "credential_prompt", severity: "high", pattern: /\bprivate key\b/i },

  // destructive_prompt (high severity)
  { type: "destructive_prompt", severity: "high", pattern: /\bdelete\b/i },
  { type: "destructive_prompt", severity: "high", pattern: /\bremove\b/i },
  { type: "destructive_prompt", severity: "high", pattern: /\boverwrite\b/i },
  { type: "destructive_prompt", severity: "high", pattern: /\bdrop\b.*\btable\b/i },

  // confirmation_prompt (medium severity)
  { type: "confirmation_prompt", severity: "medium", pattern: /\bapprov[ei]\b/i },
  { type: "confirmation_prompt", severity: "medium", pattern: /\ballow\b/i },
  { type: "confirmation_prompt", severity: "medium", pattern: /\bconfirm\b/i },
  { type: "confirmation_prompt", severity: "medium", pattern: /\bproceed\b/i },
  { type: "confirmation_prompt", severity: "medium", pattern: /\bcontinue\??\b/i },
  { type: "confirmation_prompt", severity: "medium", pattern: /\bAre you sure\b/i },
  { type: "confirmation_prompt", severity: "medium", pattern: /\bDo you want to\b/i },
  { type: "confirmation_prompt", severity: "medium", pattern: /\[y\/n\]/i },
  { type: "confirmation_prompt", severity: "medium", pattern: /\[Y\/n\]/i },
  { type: "confirmation_prompt", severity: "medium", pattern: /\[Y\/N\]/i },
  { type: "confirmation_prompt", severity: "medium", pattern: /\bApply changes\??/i },

  // external_agent_permission (high severity)
  { type: "external_agent_permission", severity: "high", pattern: /\bAllow command\??/i },
  { type: "external_agent_permission", severity: "high", pattern: /\bRun command\??/i },
  { type: "external_agent_permission", severity: "high", pattern: /\bTool permission\b/i },
  { type: "external_agent_permission", severity: "high", pattern: /\bAllow this action\??/i },
]

/**
 * 扫描终端屏幕文本，检测风险信号
 * @returns RiskSignal 数组, 无风险则返回空数组
 */
export function detectRiskSignals(screen: string): RiskSignal[] {
  const signals: RiskSignal[] = []
  const seen = new Set<string>()

  for (const { type, severity, pattern } of PATTERNS) {
    const match = pattern.exec(screen)
    if (match) {
      // 去重: 同一匹配文本不重复
      const text = match[0]
      const key = `${type}:${text}`
      if (!seen.has(key)) {
        seen.add(key)
        signals.push({ type, text, severity })
      }
    }
    pattern.lastIndex = 0 // 重置
  }

  return signals
}
