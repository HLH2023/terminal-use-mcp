/**
 * 终端等待算法。
 *
 * 本文件只包含纯函数：调用者负责提供当前屏幕状态、维护轮询循环和处理超时。
 * 这样可以让 native-pty / tmux / SSH Provider 复用同一套判定逻辑。
 */
/** waitForText 选项 */
export type WaitForTextOptions = {
    /** 要匹配的文本 */
    text: string;
    /** 是否作为正则匹配 (默认 false, 纯 substring) */
    regex?: boolean;
    /** 超时毫秒数 (默认 10000) */
    timeoutMs?: number;
    /** 是否区分大小写 (默认 true) */
    caseSensitive?: boolean;
};
/** waitStable 选项 */
export type WaitStableOptions = {
    /** 屏幕无变化判定周期 (ms, 默认 500) */
    idleMs?: number;
    /** 超时毫秒数 (tool 层默认 5000) */
    timeoutMs?: number;
    /**
     * 超时后是否返回当前快照。
     *
     * 注意：本纯算法文件不读取该字段；它只定义跨 Provider 的等待语义，
     * 实际“返回快照或抛错”的分支由 Provider 轮询循环处理。
     */
    snapshotOnTimeout?: boolean;
    /** 轮询间隔 (ms, 默认 min(100, idleMs/4)) */
    pollIntervalMs?: number;
};
/** 当前屏幕状态 (由调用者提供) */
export type ScreenState = {
    /** 屏幕完整文本 */
    screen: string;
    /** 屏幕内容 hash (用于快速变更检测) */
    screenHash: string;
    /** 最后数据写入时间 (ms) */
    lastWriteAt: number;
    /** 当前时间 (ms) */
    now: number;
};
/**
 * 检查屏幕是否包含指定文本。
 *
 * - 普通模式使用 substring 匹配，避免正则转义问题。
 * - 正则模式由调用者显式开启，正则语法错误会向上抛出，便于工具层返回结构化错误。
 *
 * @returns matchInfo: { matched: true } 或 { matched: false, reason: string }
 */
export declare function checkTextMatch(screen: string, options: WaitForTextOptions): {
    matched: true;
} | {
    matched: false;
    reason: string;
};
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
export declare function checkScreenStable(currentState: ScreenState, previousState: ScreenState | null, options: WaitStableOptions): {
    stable: true;
} | {
    stable: false;
    reason: string;
};
/**
 * 计算下次轮询的等待时间。
 *
 * 默认值取 `min(100, idleMs / 4)`，让 waitStable 在短 idle 窗口中至少有数次采样；
 * 同时设置 20ms 下限，避免过于频繁的轮询占用 CPU。
 */
export declare function calculatePollDelay(options: WaitStableOptions): number;
/**
 * 生成屏幕内容 hash。
 *
 * 使用 djb2 风格字符串 hash。它不是加密 hash，仅用于快速检测屏幕内容是否变化。
 */
export declare function hashScreen(screen: string): string;
