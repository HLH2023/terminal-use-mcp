import { describe, expect, it } from "vitest"

import { computeHostFingerprint, parseFingerprint, verifyPinnedFingerprint } from "../../src/targets/host-fingerprint.js"

const PUBLIC_KEY = Buffer.from("terminal-use-host-fingerprint-key").toString("base64")

describe("parseFingerprint", () => {
  it("解析 SHA256 fingerprint", () => {
    expect(parseFingerprint("SHA256:abcDEF123+/=")).toEqual({ algorithm: "SHA256", hash: "abcDEF123+/" })
  })

  it("解析 MD5 fingerprint", () => {
    expect(parseFingerprint("MD5:aa:BB:01:ff")).toEqual({ algorithm: "MD5", hash: "aa:bb:01:ff" })
  })

  it("解析无效 fingerprint 返回 null", () => {
    expect(parseFingerprint("not-a-fingerprint")).toBeNull()
  })
})

describe("verifyPinnedFingerprint", () => {
  it("匹配 fingerprint 时 matches=true", () => {
    const actual = computeHostFingerprint(PUBLIC_KEY, "sha256")

    const result = verifyPinnedFingerprint(actual, actual)

    expect(result).toMatchObject({ ok: true, matches: true, algorithm: "SHA256", fingerprint: actual })
  })

  it("fingerprint 不匹配时 matches=false", () => {
    const actual = computeHostFingerprint(PUBLIC_KEY, "sha256")

    const result = verifyPinnedFingerprint("SHA256:AAAAAAAAAAAAAAAAAAAA", actual)

    expect(result).toMatchObject({ ok: true, matches: false, algorithm: "SHA256", actualFingerprint: actual })
  })

  it("未提供 pinned fingerprint 时返回 no_fingerprint_provided", () => {
    const actual = computeHostFingerprint(PUBLIC_KEY, "sha256")

    const result = verifyPinnedFingerprint("", actual)

    expect(result).toEqual({ ok: false, reason: "no_fingerprint_provided", detail: "No pinned host fingerprint was provided" })
  })
})
