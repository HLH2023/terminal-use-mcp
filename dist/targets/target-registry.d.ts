/**
 * Target registry
 *
 * 将 local target 与 hosts.json 中的 SSH profile 合并为可展示的安全摘要。
 * 注意：这里永远不输出 key-file 路径、passphraseEnv、password、token 或 env 明文。
 */
import type { SshHostProfile } from "./target-types.js";
export type LocalTargetInfo = {
    kind: "local";
    name: "local";
};
export type SshTargetInfo = {
    kind: "ssh";
    name: string;
    profile: string;
    host: string;
    port: number;
    username: string;
    authType: "agent" | "key-file";
    knownHostPolicy: "strict";
    defaultCwd?: string;
    allowTmux: boolean;
};
export type TargetInfo = LocalTargetInfo | SshTargetInfo;
/** 列出 local + SSH targets；SSH targets 按 profile name 排序，便于测试和输出稳定。 */
export declare function listTargets(hostsConfig: ReadonlyMap<string, SshHostProfile>): TargetInfo[];
/** 查询单个 target 的安全摘要；找不到时返回 null。 */
export declare function getTargetInfo(profileName: string, hostsConfig: ReadonlyMap<string, SshHostProfile>): TargetInfo | null;
