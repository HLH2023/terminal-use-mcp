/**
 * 终端等待算法。
 *
 * 本文件只包含纯函数：调用者负责提供当前屏幕状态、维护轮询循环和处理超时。
 * 这样可以让 native-pty / tmux / SSH Provider 复用同一套判定逻辑。
 */

import { validateRegexSafety, createSafeRegex } from "./command-safety.js"

/** waitForText 选项 */
export type WaitForTextOptions = {
  /** 要匹配的文本 */
  text: string
  /** 是否作为正则匹配 (默认 false, 纯 substring) */
  regex?: boolean
  /** 超时毫秒数 (默认 10000) */
  timeoutMs?: number
  /** 是否区分大小写 (默认 true) */
  caseSensitive?: boolean
}

/** waitStable 选项 */
export type WaitStableOptions = {
  /** 屏幕无变化判定周期 (ms, 默认 500) */
  idleMs?: number
  /** 超时毫秒数 (tool 层默认 5000) */
  timeoutMs?: number
  /**
   * 超时后是否返回当前快照。
   *
   * 注意：本纯算法文件不读取该字段；它只定义跨 Provider 的等待语义，
   * 实际"返回快照或抛错"的分支由 Provider 轮询循环处理。
   */
  snapshotOnTimeout?: boolean
  /** 轮询间隔 (ms, 默认 min(100, idleMs/4)) */
  pollIntervalMs?: number
  /**
   * 跳过 idle 时间检查，仅要求连续两次 screenHash 相同即视为稳定。
   *
   * alt buffer（全屏 TUI）下 Ink spinner 等持续更新会使 lastWriteAt 不断刷新，
   * 导致 idle 检查永远不满足。此时只需内容 hash 稳定即可判定。
   */
  skipIdleCheck?: boolean
}

/** 当前屏幕状态 (由调用者提供) */
export type ScreenState = {
  /** 屏幕完整文本 */
  screen: string
  /** 屏幕内容 hash (用于快速变更检测) */
  screenHash: string
  /** 最后数据写入时间 (ms) */
  lastWriteAt: number
  /** 当前时间 (ms) */
  now: number
}

const DEFAULT_IDLE_MS = 500
const MIN_POLL_INTERVAL_MS = 20
const MAX_DEFAULT_POLL_INTERVAL_MS = 100

/**
 * 检查屏幕是否包含指定文本。
 *
 * - 普通模式使用 substring 匹配，避免正则转义问题。
 * - 正则模式由调用者显式开启，正则语法错误会向上抛出，便于工具层返回结构化错误。
 *
 * @returns matchInfo: { matched: true } 或 { matched: false, reason: string }
 */
export function checkTextMatch(
  screen: string,
  options: WaitForTextOptions,
): { matched: true } | { matched: false; reason: string } {
  const caseSensitive = options.caseSensitive ?? true

  if (options.regex === true) {
    const validation = validateRegexSafety(options.text)
    if (!validation.ok) {
      return { matched: false, reason: validation.reason }
    }
    const flags = caseSensitive ? "" : "i"
    const matched = createSafeRegex(options.text, flags).test(screen)
    return matched
      ? { matched: true }
      : { matched: false, reason: `屏幕未匹配正则: ${options.text}` }
  }

  const targetScreen = caseSensitive ? screen : screen.toLowerCase()
  const targetText = caseSensitive ? options.text : options.text.toLowerCase()
  const matched = targetScreen.includes(targetText)

  return matched
    ? { matched: true }
    : { matched: false, reason: `屏幕未包含文本: ${options.text}` }
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
export function checkScreenStable(
  currentState: ScreenState,
  previousState: ScreenState | null,
  options: WaitStableOptions,
): { stable: true } | { stable: false; reason: string } {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS

  if (previousState === null) {
    return { stable: false, reason: "首次轮询没有前次状态可对比" }
  }

  if (currentState.screenHash !== previousState.screenHash) {
    return { stable: false, reason: "屏幕内容仍在变化" }
  }

  if (options.skipIdleCheck === true) {
    return { stable: true }
  }

  const idleForMs = currentState.now - currentState.lastWriteAt
  if (idleForMs < idleMs) {
    return { stable: false, reason: `距离最后写入仅 ${idleForMs}ms，未达到 ${idleMs}ms` }
  }

  return { stable: true }
}

/**
 * 计算下次轮询的等待时间。
 *
 * 默认值取 `min(100, idleMs / 4)`，让 waitStable 在短 idle 窗口中至少有数次采样；
 * 同时设置 20ms 下限，避免过于频繁的轮询占用 CPU。
 */
export function calculatePollDelay(options: WaitStableOptions): number {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS
  const configuredDelay = options.pollIntervalMs ?? Math.min(MAX_DEFAULT_POLL_INTERVAL_MS, idleMs / 4)
  return Math.max(MIN_POLL_INTERVAL_MS, configuredDelay)
}

/**
 * 生成屏幕内容 hash。
 *
 * 使用 djb2 风格字符串 hash。它不是加密 hash，仅用于快速检测屏幕内容是否变化。
 */
export function hashScreen(screen: string): string {
  let hash = 5381
  for (let i = 0; i < screen.length; i += 1) {
    hash = ((hash << 5) + hash) + screen.charCodeAt(i)
  }
  return hash.toString(36)
}
