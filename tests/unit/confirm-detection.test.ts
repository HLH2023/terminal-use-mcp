import { describe, it, expect } from "vitest"
import { detectRiskSignals } from "../../src/terminal/confirm-detection.js"
import type { RiskSignal } from "../../src/terminal/confirm-detection.js"

describe("detectRiskSignals", () => {
  it("检测 [y/n] 确认提示", () => {
    const screen = "Do you want to continue? [y/n]"
    const signals = detectRiskSignals(screen)
    expect(signals.length).toBeGreaterThanOrEqual(1)
    const ynSignal = signals.find((s) => s.text.includes("[y/n]"))
    expect(ynSignal).toBeDefined()
    expect(ynSignal!.type).toBe("confirmation_prompt")
    expect(ynSignal!.severity).toBe("medium")
  })

  it("检测 Password 凭据提示", () => {
    const screen = "Password:"
    const signals = detectRiskSignals(screen)
    expect(signals.length).toBeGreaterThanOrEqual(1)
    const pwSignal = signals.find((s) => s.type === "credential_prompt")
    expect(pwSignal).toBeDefined()
    expect(pwSignal!.severity).toBe("high")
  })

  it("检测 'Allow command?' 外部 agent 权限提示", () => {
    const screen = "Allow command? rm -rf /tmp"
    const signals = detectRiskSignals(screen)
    const allowSignal = signals.find((s) => s.type === "external_agent_permission")
    expect(allowSignal).toBeDefined()
    expect(allowSignal!.severity).toBe("high")
  })

  it("检测 'Are you sure' 确认提示", () => {
    const screen = "Are you sure you want to proceed?"
    const signals = detectRiskSignals(screen)
    const sureSignal = signals.find((s) => s.type === "confirmation_prompt" && s.text.includes("Are you sure"))
    expect(sureSignal).toBeDefined()
    expect(sureSignal!.severity).toBe("medium")
  })

  it("检测 destructive prompt (overwrite)", () => {
    const screen = "File exists. overwrite? [y/n]"
    const signals = detectRiskSignals(screen)
    const destructiveSignal = signals.find((s) => s.type === "destructive_prompt" && s.text.toLowerCase() === "overwrite")
    expect(destructiveSignal).toBeDefined()
    expect(destructiveSignal!.severity).toBe("high")
  })

  it("检测 destructive prompt (delete)", () => {
    const screen = "delete this file?"
    const signals = detectRiskSignals(screen)
    const deleteSignal = signals.find((s) => s.type === "destructive_prompt" && s.text === "delete")
    expect(deleteSignal).toBeDefined()
    expect(deleteSignal!.severity).toBe("high")
  })

  it("检测 destructive prompt (drop table)", () => {
    const screen = "drop table users;"
    const signals = detectRiskSignals(screen)
    const dropSignal = signals.find((s) => s.type === "destructive_prompt")
    expect(dropSignal).toBeDefined()
    expect(dropSignal!.severity).toBe("high")
  })

  it("无风险信号时返回空数组", () => {
    const screen = "Installation complete. All dependencies are up to date."
    const signals = detectRiskSignals(screen)
    expect(signals).toEqual([])
  })

  it("去重: 同一匹配文本不重复", () => {
    // "allow" 同时匹配 confirmation_prompt 和可能的其他类别
    const screen = "Allow this action?"
    const signals = detectRiskSignals(screen)
    // 不应出现重复的 type:text key
    const keys = signals.map((s: RiskSignal) => `${s.type}:${s.text}`)
    const uniqueKeys = new Set(keys)
    expect(uniqueKeys.size).toBe(keys.length)
  })

  it("检测 token 凭据提示", () => {
    const screen = "Enter your token:"
    const signals = detectRiskSignals(screen)
    const tokenSignal = signals.find((s) => s.type === "credential_prompt" && s.text === "token")
    expect(tokenSignal).toBeDefined()
    expect(tokenSignal!.severity).toBe("high")
  })

  it("检测 API key 凭据提示", () => {
    const screen = "Please enter your API key:"
    const signals = detectRiskSignals(screen)
    const apiSignal = signals.find((s) => s.type === "credential_prompt" && s.text === "API key")
    expect(apiSignal).toBeDefined()
  })

  it("检测 private key 凭据提示", () => {
    const screen = "Paste your private key here"
    const signals = detectRiskSignals(screen)
    const pkSignal = signals.find((s) => s.type === "credential_prompt" && s.text === "private key")
    expect(pkSignal).toBeDefined()
  })

  it("检测 [Y/n] 确认提示", () => {
    const screen = "Apply changes? [Y/n]"
    const signals = detectRiskSignals(screen)
    const ySignal = signals.find((s) => s.text.includes("[Y/n]"))
    expect(ySignal).toBeDefined()
    expect(ySignal!.type).toBe("confirmation_prompt")
  })
})
