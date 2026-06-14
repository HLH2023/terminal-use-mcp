/**
 * 确认/危险提示检测
 *
 * 扫描终端屏幕文本，识别需要用户注意的风险信号。
 */
export type RiskSignal = {
    type: "confirmation_prompt" | "credential_prompt" | "destructive_prompt" | "external_agent_permission";
    text: string;
    severity: "low" | "medium" | "high";
};
/**
 * 扫描终端屏幕文本，检测风险信号
 * @returns RiskSignal 数组, 无风险则返回空数组
 */
export declare function detectRiskSignals(screen: string): RiskSignal[];
