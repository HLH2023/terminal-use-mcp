/**
 * 终端等待算法。
 *
 * 本文件只包含纯函数：调用者负责提供当前屏幕状态、维护轮询循环和处理超时。
 * 这样可以让 native-pty / tmux / SSH Provider 复用同一套判定逻辑。
 */
const DEFAULT_IDLE_MS = 500;
const MIN_POLL_INTERVAL_MS = 20;
const MAX_DEFAULT_POLL_INTERVAL_MS = 100;
/**
 * 检查屏幕是否包含指定文本。
 *
 * - 普通模式使用 substring 匹配，避免正则转义问题。
 * - 正则模式由调用者显式开启，正则语法错误会向上抛出，便于工具层返回结构化错误。
 *
 * @returns matchInfo: { matched: true } 或 { matched: false, reason: string }
 */
export function checkTextMatch(screen, options) {
    const caseSensitive = options.caseSensitive ?? true;
    if (options.regex === true) {
        const flags = caseSensitive ? "" : "i";
        const matched = new RegExp(options.text, flags).test(screen);
        return matched
            ? { matched: true }
            : { matched: false, reason: `屏幕未匹配正则: ${options.text}` };
    }
    const targetScreen = caseSensitive ? screen : screen.toLowerCase();
    const targetText = caseSensitive ? options.text : options.text.toLowerCase();
    const matched = targetScreen.includes(targetText);
    return matched
        ? { matched: true }
        : { matched: false, reason: `屏幕未包含文本: ${options.text}` };
}
/**
 * 检查屏幕是否处于稳定状态。
 *
 * 稳定的定义同时满足：
 * 1. 不是首次轮询，存在可对比的前一次状态。
 * 2. 当前屏幕 hash 与前一次屏幕 hash 一致。
 * 3. 距离最后一次写入已经达到 idleMs。
 *
 * @returns stableInfo: { stable: true } 或 { stable: false, reason: string }
 */
export function checkScreenStable(currentState, previousState, options) {
    const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    if (previousState === null) {
        return { stable: false, reason: "首次轮询没有前次状态可对比" };
    }
    if (currentState.screenHash !== previousState.screenHash) {
        return { stable: false, reason: "屏幕内容仍在变化" };
    }
    const idleForMs = currentState.now - currentState.lastWriteAt;
    if (idleForMs < idleMs) {
        return { stable: false, reason: `距离最后写入仅 ${idleForMs}ms，未达到 ${idleMs}ms` };
    }
    return { stable: true };
}
/**
 * 计算下次轮询的等待时间。
 *
 * 默认值取 `min(100, idleMs / 4)`，让 waitStable 在短 idle 窗口中至少有数次采样；
 * 同时设置 20ms 下限，避免过于频繁的轮询占用 CPU。
 */
export function calculatePollDelay(options) {
    const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    const configuredDelay = options.pollIntervalMs ?? Math.min(MAX_DEFAULT_POLL_INTERVAL_MS, idleMs / 4);
    return Math.max(MIN_POLL_INTERVAL_MS, configuredDelay);
}
/**
 * 生成屏幕内容 hash。
 *
 * 使用 djb2 风格字符串 hash。它不是加密 hash，仅用于快速检测屏幕内容是否变化。
 */
export function hashScreen(screen) {
    let hash = 5381;
    for (let i = 0; i < screen.length; i += 1) {
        hash = ((hash << 5) + hash) + screen.charCodeAt(i);
    }
    return hash.toString(36);
}
