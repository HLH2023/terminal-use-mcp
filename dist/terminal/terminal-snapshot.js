/**
 * TerminalSnapshot 类型定义
 *
 * 所有 provider 返回的统一屏幕快照格式
 */
/**
 * 创建 TerminalSnapshot 的工厂函数
 */
export function createSnapshot(partial) {
    return {
        ...partial,
        scrollbackLineCount: partial.scrollbackLineCount ?? 0,
        timestamp: new Date().toISOString(),
        observationTrust: "untrusted",
    };
}
