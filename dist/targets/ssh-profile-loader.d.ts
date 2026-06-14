/**
 * SSH target/profile 解析
 *
 * 默认只允许通过 hosts.json profile 连接远程主机；inline host 需要显式环境变量开启。
 * 本模块只做配置解析和安全闸门，不建立 SSH 连接。
 */
import type { SshHostProfile, TerminalTarget } from "./target-types.js";
export type ResolvedLocalTarget = {
    kind: "local";
};
export type ResolvedSshTarget = SshHostProfile & {
    kind: "ssh";
    profile?: string;
    knownHostPolicy: "strict";
};
export type ResolvedTerminalTarget = ResolvedLocalTarget | ResolvedSshTarget;
/** 环境变量闸门：默认拒绝 inline SSH target。 */
export declare function isInlineSshTargetAllowed(env?: NodeJS.ProcessEnv): boolean;
/** 解析 local/ssh target；local 原样返回，ssh 返回完整 profile。 */
export declare function resolveSshTarget(target: TerminalTarget, hostsConfig: ReadonlyMap<string, SshHostProfile>): ResolvedTerminalTarget;
/** 只读 SSH profile 查询入口（供 verify_target 等工具使用）。 */
export declare function getSshProfile(hostsConfig: ReadonlyMap<string, SshHostProfile>, profileName: string): SshHostProfile | undefined;
