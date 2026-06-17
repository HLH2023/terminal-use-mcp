/**
 * POSIX shell 单引号转义。
 *
 * 将字符串包裹在单引号中，内部单引号替换为 '\''。
 * 这是防范命令注入的基础工具——所有远程命令构造必须使用此函数。
 */

/** POSIX shell 单引号转义：将值包裹在单引号中，内部单引号替换为 '\'' */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}
