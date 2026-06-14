/**
 * 安全清理工具
 *
 * 确保每个清理步骤独立执行，一个步骤失败不阻断后续步骤。
 * 用于 provider kill/cleanup 路径，保证 sessions.delete 最终必达。
 *
 * 设计原则：
 * - 串行执行（不并行），因为步骤间可能有隐式依赖顺序
 * - async 支持：步骤可以返回 Promise
 * - 失败只记日志：调用方自行决定是否再抛
 * - 最后一步通常是 sessions.delete，必须执行
 */
/**
 * 串行执行清理步骤；每步独立 try/catch，失败只记日志不阻断后续。
 *
 * @param steps - 清理步骤数组，按顺序执行
 * @param logger - 可选日志记录器，步骤失败时通过 warn 输出
 */
export async function safeCleanup(steps, logger) {
    for (const step of steps) {
        try {
            await step.fn();
        }
        catch (error) {
            logger?.warn("safeCleanup step failed", { step: step.name, error: formatError(error) });
        }
    }
}
/** 将 unknown error 格式化为可读字符串 */
function formatError(error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
