import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { StartInput } from "../../src/providers/provider.js"
import { isCommandSafe, isCommandSafeArgv, isCwdAllowed, maybeWrapWithShell, isSubdirectory, isSubdirectoryCanonical, extractBaseCommandArgv, validateRegexSafety, createSafeRegex } from "../../src/terminal/command-safety.js"
import type { CwdPolicyMode } from "../../src/terminal/command-safety.js"

function createStartInput(overrides: Partial<StartInput> = {}): StartInput {
  return {
    command: "node",
    args: [],
    cwd: "/workspace",
    cols: 80,
    rows: 24,
    ...overrides,
  }
}

describe("isCommandSafe", () => {
  it("sudo 被拒绝", () => {
    const result = isCommandSafe("sudo rm -rf /")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("UNSAFE_COMMAND")
      expect(result.reason).toContain("sudo")
    }
  })

  it("rm 被拒绝", () => {
    const result = isCommandSafe("rm file.txt")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("UNSAFE_COMMAND")
      expect(result.reason).toContain("rm")
    }
  })

  it("ssh 被拒绝", () => {
    const result = isCommandSafe("ssh user@host")
    expect(result.ok).toBe(false)
  })

  it("sh 被拒绝", () => {
    const result = isCommandSafe("/bin/sh")
    expect(result.ok).toBe(false)
  })

  it("dd 被拒绝", () => {
    const result = isCommandSafe("dd if=/dev/zero of=/dev/sda")
    expect(result.ok).toBe(false)
  })

  it("curl 被拒绝", () => {
    const result = isCommandSafe("curl http://example.com")
    expect(result.ok).toBe(false)
  })

  it("wget 被拒绝", () => {
    const result = isCommandSafe("wget http://example.com")
    expect(result.ok).toBe(false)
  })

  it("ls 允许", () => {
    const result = isCommandSafe("ls -la")
    expect(result.ok).toBe(true)
  })

  it("node 允许", () => {
    const result = isCommandSafe("node script.js")
    expect(result.ok).toBe(true)
  })

  it("python 允许", () => {
    const result = isCommandSafe("python app.py")
    expect(result.ok).toBe(true)
  })

  it("git 允许", () => {
    const result = isCommandSafe("git status")
    expect(result.ok).toBe(true)
  })

  it("允许列表覆盖: sudo 在 allowedCommands 中时允许", () => {
    const result = isCommandSafe("sudo apt update", ["sudo"])
    expect(result.ok).toBe(true)
  })

  it("允许列表覆盖: rm 在 allowedCommands 中时允许", () => {
    const result = isCommandSafe("rm file.txt", ["rm"])
    expect(result.ok).toBe(true)
  })

  it("自定义拒绝列表: 额外命令被拒绝", () => {
    const result = isCommandSafe("docker exec -it container bash", [], ["docker"])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("UNSAFE_COMMAND")
    }
  })

  it("riskyMode='ask' 时被拒命令返回 CONFIRMATION_REQUIRED", () => {
    const result = isCommandSafe("sudo apt update", [], [], "ask")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("CONFIRMATION_REQUIRED")
    }
  })

  it("riskyMode='allow' 时所有命令允许", () => {
    const result = isCommandSafe("sudo rm -rf /", [], [], "allow")
    expect(result.ok).toBe(true)
  })

  it("riskyMode='deny' (默认) 时被拒命令返回 UNSAFE_COMMAND", () => {
    const result = isCommandSafe("sudo apt update", [], [], "deny")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("UNSAFE_COMMAND")
    }
  })

  it("提取带路径的命令基本名称", () => {
    const result = isCommandSafe("/usr/bin/sudo ls")
    // 应提取 "sudo" 作为基本命令来检查
    expect(result.ok).toBe(false)
  })

  it("提取 shell 元字符前的命令基本名称", () => {
    const result = isCommandSafe("rm;echo ok")
    expect(result.ok).toBe(false)
  })

  it("默认允许不在拒绝列表中的命令", () => {
    const result = isCommandSafe("bash")
    expect(result.ok).toBe(true)
  })
})

describe("maybeWrapWithShell", () => {
  it("args 为空且 command 包含空格时包装为 /bin/sh -c", () => {
    const input = createStartInput({ command: "whiptail --title hello", args: [] })
    const result = maybeWrapWithShell(input)

    expect(result).toEqual({
      ...input,
      command: "/bin/sh",
      args: ["-c", "whiptail --title hello"],
    })
  })

  it("args 为空且 command 包含 shell 元字符时包装", () => {
    const input = createStartInput({ command: "printf hi|cat", args: [] })
    const result = maybeWrapWithShell(input)

    expect(result.command).toBe("/bin/sh")
    expect(result.args).toEqual(["-c", "printf hi|cat"])
  })

  it("args 非空时不包装", () => {
    const input = createStartInput({ command: "whiptail --title hello", args: ["--title", "hello"] })
    const result = maybeWrapWithShell(input)

    expect(result).toBe(input)
  })

  it("command 没有空格或 shell 元字符时不包装", () => {
    const input = createStartInput({ command: "lazygit", args: [] })
    const result = maybeWrapWithShell(input)

    expect(result).toBe(input)
  })
})

describe("maybeWrapWithShell - Windows", () => {
  const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")
  const originalComSpec = process.env.ComSpec

  afterEach(() => {
    if (originalPlatformDescriptor !== undefined) {
      Object.defineProperty(process, "platform", originalPlatformDescriptor)
    }
    if (originalComSpec !== undefined) {
      process.env.ComSpec = originalComSpec
    } else {
      delete process.env.ComSpec
    }
  })

  it("uses ComSpec on win32", () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true })
    process.env.ComSpec = "C:\\Windows\\System32\\cmd.exe"

    const result = maybeWrapWithShell(createStartInput({
      command: "echo hello && echo world",
      args: [],
      cwd: "/tmp",
    }))

    expect(result.command).toBe("C:\\Windows\\System32\\cmd.exe")
    expect(result.args).toEqual(["/c", "echo hello && echo world"])
  })

  it("falls back to cmd.exe when ComSpec is empty", () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true })
    process.env.ComSpec = ""

    const result = maybeWrapWithShell(createStartInput({
      command: "echo hello && echo world",
      args: [],
      cwd: "/tmp",
    }))

    expect(result.command).toBe("cmd.exe")
  })
})

describe("isCwdAllowed", () => {
  let tempDir: string
  let workspaceRoot: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tumcp-cwd-basic-"))
    workspaceRoot = join(tempDir, "project")
    mkdirSync(workspaceRoot, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("CWD 在 workspace root 下允许", async () => {
    const srcDir = join(workspaceRoot, "src")
    mkdirSync(srcDir)
    const result = await isCwdAllowed(srcDir, workspaceRoot)
    expect(result.ok).toBe(true)
  })

  it("CWD 恰好等于 workspace root 允许", async () => {
    const result = await isCwdAllowed(workspaceRoot, workspaceRoot)
    expect(result.ok).toBe(true)
  })

  it("CWD 在 /etc 下拒绝", async () => {
    const result = await isCwdAllowed("/etc/config", workspaceRoot)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("INVALID_CWD")
    }
  })

  it("CWD 在 /usr 下拒绝", async () => {
    const result = await isCwdAllowed("/usr/local/bin", workspaceRoot)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("INVALID_CWD")
    }
  })

  it("CWD 在 /proc 下拒绝", async () => {
    const result = await isCwdAllowed("/proc/self", workspaceRoot)
    expect(result.ok).toBe(false)
  })

  it("CWD 在 /sys 下拒绝", async () => {
    const result = await isCwdAllowed("/sys/kernel", workspaceRoot)
    expect(result.ok).toBe(false)
  })

  it("CWD 包含在 allowedCwdRoots 中允许", async () => {
    const optDir = join(tempDir, "opt-workspace")
    mkdirSync(optDir)
    const result = await isCwdAllowed(optDir, workspaceRoot, [optDir])
    expect(result.ok).toBe(true)
  })

  it("CWD 在 allowedCwdRoots 子目录中允许", async () => {
    const optDir = join(tempDir, "opt-workspace")
    mkdirSync(optDir)
    const optSub = join(optDir, "project")
    mkdirSync(optSub)
    const result = await isCwdAllowed(optSub, workspaceRoot, [optDir])
    expect(result.ok).toBe(true)
  })

  it("CWD /root 拒绝", async () => {
    const result = await isCwdAllowed("/root", workspaceRoot, [])
    expect(result.ok).toBe(false)
  })

  it("相对路径基于 workspaceRoot 解析", async () => {
    const srcLib = join(workspaceRoot, "src/lib")
    mkdirSync(srcLib, { recursive: true })
    const result = await isCwdAllowed("src/lib", workspaceRoot)
    expect(result.ok).toBe(true)
  })

  it("不匹配任何拒绝规则的非 workspace 路径默认允许", async () => {
    // 使用真实存在的 /tmp 子目录
    const tmpBuild = join(tempDir, "tmp-build")
    mkdirSync(tmpBuild)
    const result = await isCwdAllowed(tmpBuild, workspaceRoot)
    expect(result.ok).toBe(true)
  })
})

describe("isCommandSafeArgv (H2 完整 argv 检查)", () => {
  it("env rm 通过 args 传入被拒绝", () => {
    const result = isCommandSafeArgv("env", ["rm"])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("UNSAFE_COMMAND")
      expect(result.reason).toContain("rm")
    }
  })

  it("env -i rm 通过 args 传入被拒绝", () => {
    const result = isCommandSafeArgv("env", ["-i", "rm"])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain("rm")
    }
  })

  it("timeout --foreground 1 rm 被拒绝", () => {
    const result = isCommandSafeArgv("timeout", ["--foreground", "1", "rm"])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain("rm")
    }
  })

  it("strace -o log rm 被拒绝", () => {
    const result = isCommandSafeArgv("strace", ["-o", "log", "rm"])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain("rm")
    }
  })

  it("nice -n 19 rm 被拒绝", () => {
    const result = isCommandSafeArgv("nice", ["-n", "19", "rm"])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain("rm")
    }
  })

  it("env NODE_ENV=prod node 允许 (env 剥除后 base 是 node)", () => {
    const result = isCommandSafeArgv("env", ["NODE_ENV=prod", "node"])
    expect(result.ok).toBe(true)
  })

  it("ls -la 允许 (args 只含选项)", () => {
    const result = isCommandSafeArgv("ls", ["-la"])
    expect(result.ok).toBe(true)
  })

  it("command 只有自身无 args 时 isCommandSafe 与 isCommandSafeArgv 行为一致", () => {
    const safeOnly = isCommandSafe("ls")
    const safeArgv = isCommandSafeArgv("ls", [])
    expect(safeOnly.ok).toBe(safeArgv.ok)

    const deniedOnly = isCommandSafe("rm file.txt")
    const deniedArgv = isCommandSafeArgv("rm", ["file.txt"])
    expect(deniedOnly.ok).toBe(false)
    expect(deniedArgv.ok).toBe(false)
  })

  it("nohup rm 被拒绝", () => {
    const result = isCommandSafeArgv("nohup", ["rm"])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain("rm")
    }
  })

  it("busybox sh 被拒绝", () => {
    const result = isCommandSafeArgv("busybox", ["sh"])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain("sh")
    }
  })

  it("unshare --user rm 被拒绝", () => {
    const result = isCommandSafeArgv("unshare", ["--user", "rm"])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain("rm")
    }
  })

  it("ltrace -o out chmod 被拒绝", () => {
    const result = isCommandSafeArgv("ltrace", ["-o", "out", "chmod"])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain("chmod")
    }
  })

  it("xargs -n1 rm 被拒绝", () => {
    const result = isCommandSafeArgv("xargs", ["-n", "1", "rm"])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain("rm")
    }
  })
})

describe("isCommandSafeArgv - Windows denylist", () => {
  it("大小写不敏感地拦截 Windows 高危命令", () => {
    expect(isCommandSafeArgv("CMD.EXE", []).ok).toBe(false)
    expect(isCommandSafeArgv("PowerShell.exe", []).ok).toBe(false)
    expect(isCommandSafeArgv("TASKKILL.EXE", []).ok).toBe(false)
  })

  it("大小写不敏感地应用 allow/deny 覆盖", () => {
    expect(isCommandSafeArgv("PowerShell.exe", [], ["POWERSHELL.EXE"]).ok).toBe(true)
    expect(isCommandSafeArgv("MyTool.EXE", [], [], ["mytool.exe"]).ok).toBe(false)
  })

  it("blocks powershell.exe", () => {
    expect(isCommandSafeArgv("powershell.exe", [])).toEqual({
      ok: false,
      reason: expect.stringContaining("powershell.exe"),
      code: "UNSAFE_COMMAND",
    })
  })

  it("blocks cmd.exe", () => {
    expect(isCommandSafeArgv("cmd.exe", [])).toEqual({
      ok: false,
      reason: expect.stringContaining("cmd.exe"),
      code: "UNSAFE_COMMAND",
    })
  })

  it("blocks diskpart", () => {
    expect(isCommandSafeArgv("diskpart", [])).toEqual({
      ok: false,
      reason: expect.stringContaining("diskpart"),
      code: "UNSAFE_COMMAND",
    })
  })
})

describe("isCommandSafeArgv - Windows denylist case-insensitive", () => {
  it("blocks CMD.EXE (uppercase)", () => {
    expect(isCommandSafeArgv("CMD.EXE", [])).toEqual({ ok: false, reason: expect.any(String), code: "UNSAFE_COMMAND" })
  })
  it("blocks PowerShell.EXE (mixed case)", () => {
    expect(isCommandSafeArgv("PowerShell.EXE", [])).toEqual({ ok: false, reason: expect.any(String), code: "UNSAFE_COMMAND" })
  })
  it("blocks TaskKill.exe (mixed case)", () => {
    expect(isCommandSafeArgv("TaskKill.exe", [])).toEqual({ ok: false, reason: expect.any(String), code: "UNSAFE_COMMAND" })
  })
  it("blocks lowercase powershell", () => {
    expect(isCommandSafeArgv("powershell", [])).toEqual({ ok: false, reason: expect.any(String), code: "UNSAFE_COMMAND" })
  })
  it("blocks lowercase cmd", () => {
    expect(isCommandSafeArgv("cmd", [])).toEqual({ ok: false, reason: expect.any(String), code: "UNSAFE_COMMAND" })
  })
  it("blocks lowercase taskkill", () => {
    expect(isCommandSafeArgv("taskkill", [])).toEqual({ ok: false, reason: expect.any(String), code: "UNSAFE_COMMAND" })
  })
})

describe("extractBaseCommandArgv", () => {
  it("无 wrapper 直接返回 base", () => {
    expect(extractBaseCommandArgv(["ls", "-la"])).toBe("ls")
  })

  it("env 剥除后返回 rm", () => {
    expect(extractBaseCommandArgv(["env", "rm"])).toBe("rm")
  })

  it("env -i VAR=1 rm 剥除后返回 rm", () => {
    expect(extractBaseCommandArgv(["env", "-i", "VAR=1", "rm"])).toBe("rm")
  })

  it("timeout --foreground 1 rm 剥除后返回 rm", () => {
    expect(extractBaseCommandArgv(["timeout", "--foreground", "1", "rm"])).toBe("rm")
  })

  it("strace -o log rm 剥除后返回 rm", () => {
    expect(extractBaseCommandArgv(["strace", "-o", "log", "rm"])).toBe("rm")
  })

  it("nice -n 19 rm 剥除后返回 rm", () => {
    expect(extractBaseCommandArgv(["nice", "-n", "19", "rm"])).toBe("rm")
  })

  it("env NODE_ENV=prod node 剥除后返回 node", () => {
    expect(extractBaseCommandArgv(["env", "NODE_ENV=prod", "node"])).toBe("node")
  })

  it("嵌套 wrapper: env nice -n 19 rm 剥除后返回 rm", () => {
    expect(extractBaseCommandArgv(["env", "nice", "-n", "19", "rm"])).toBe("rm")
  })
})

describe("extractBaseCommandArgv - Windows paths", () => {
  it("extracts basename from Windows absolute path", () => {
    expect(extractBaseCommandArgv(["C:\\Windows\\System32\\cmd.exe"])).toBe("cmd.exe")
  })

  it("extracts basename from backslash path with args", () => {
    expect(extractBaseCommandArgv(["C:\\Program Files\\PowerShell\\pwsh.exe", "-Command", "echo hi"])).toBe("pwsh.exe")
  })
})

describe("isSubdirectory trailing slash 修复", () => {
  it("parentPath 含 trailing slash 时子路径仍匹配", () => {
    expect(isSubdirectory("/repo/src", "/repo/")).toBe(true)
  })

  it("parentPath 含 trailing slash 时精确匹配", () => {
    expect(isSubdirectory("/repo", "/repo/")).toBe(true)
  })

  it("parentPath 不含 trailing slash 时行为不变", () => {
    expect(isSubdirectory("/repo/src", "/repo")).toBe(true)
  })

  it("不相关的路径不匹配", () => {
    expect(isSubdirectory("/other/src", "/repo/")).toBe(false)
  })

  it("根路径 '/' 不被 normalize 掉", () => {
    expect(isSubdirectory("/home", "/")).toBe(true)
  })
})

describe("isSubdirectoryCanonical — path.relative 子目录判断", () => {
  it("相等路径返回 true", () => {
    expect(isSubdirectoryCanonical("/a/b", "/a/b")).toBe(true)
  })

  it("子目录返回 true", () => {
    expect(isSubdirectoryCanonical("/a/b/c", "/a/b")).toBe(true)
  })

  it("非子目录返回 false", () => {
    expect(isSubdirectoryCanonical("/a/bc", "/a/b")).toBe(false)
  })

  it("父目录返回 false", () => {
    expect(isSubdirectoryCanonical("/a", "/a/b")).toBe(false)
  })
})

describe("isCwdAllowed — realpath canonicalize", () => {
  let tempDir: string
  let workspaceDir: string
  let etcSymlink: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tumcp-cwd-test-"))
    workspaceDir = join(tempDir, "workspace")
    mkdirSync(workspaceDir, { recursive: true })
    // 创建 symlink: workspace/etc-link -> /etc
    etcSymlink = join(workspaceDir, "etc-link")
    symlinkSync("/etc", etcSymlink)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("symlink 指向 /etc 时拒绝（realpath 解析到 /etc，不在 workspace 下）", async () => {
    const result = await isCwdAllowed(etcSymlink, workspaceDir)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("INVALID_CWD")
    }
  })

  it("workspace 内正常子目录允许", async () => {
    const subdir = join(workspaceDir, "src")
    mkdirSync(subdir)
    const result = await isCwdAllowed(subdir, workspaceDir)
    expect(result.ok).toBe(true)
  })

  it("不存在的路径 realpath 失败时拒绝", async () => {
    const result = await isCwdAllowed("/nonexistent/path/xyz", workspaceDir)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("INVALID_CWD")
    }
  })
})

// ============================================================
// CWD 策略模式测试 (guarded vs strict)
// ============================================================

describe("isCwdAllowed — guarded mode (default)", () => {
  let tempDir: string
  let workspaceRoot: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tumcp-cwd-guarded-"))
    workspaceRoot = join(tempDir, "project")
    mkdirSync(workspaceRoot, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("workspaceRoot 自身允许", async () => {
    const result = await isCwdAllowed(workspaceRoot, workspaceRoot, [], "guarded")
    expect(result.ok).toBe(true)
  })

  it("workspaceRoot 子目录允许", async () => {
    const srcDir = join(workspaceRoot, "src")
    mkdirSync(srcDir)
    const result = await isCwdAllowed(srcDir, workspaceRoot, [], "guarded")
    expect(result.ok).toBe(true)
  })

  it("allowedCwdRoots 子目录允许", async () => {
    const optDir = join(tempDir, "opt-workspace")
    mkdirSync(optDir)
    const optSub = join(optDir, "project")
    mkdirSync(optSub)
    const result = await isCwdAllowed(optSub, workspaceRoot, [optDir], "guarded")
    expect(result.ok).toBe(true)
  })

  it("denied root 拒绝（/etc）", async () => {
    const result = await isCwdAllowed("/etc/config", workspaceRoot, [], "guarded")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("INVALID_CWD")
    }
  })

  it("denied root 拒绝（/usr）", async () => {
    const result = await isCwdAllowed("/usr/local/bin", workspaceRoot, [], "guarded")
    expect(result.ok).toBe(false)
  })

  it("非白名单但非 denied root 的目录允许", async () => {
    const safeDir = join(tempDir, "safe-temp")
    mkdirSync(safeDir)
    const result = await isCwdAllowed(safeDir, workspaceRoot, [], "guarded")
    expect(result.ok).toBe(true)
  })

  it("不传 mode 参数时默认为 guarded 行为", async () => {
    const safeDir = join(tempDir, "safe-temp")
    mkdirSync(safeDir)
    const result = await isCwdAllowed(safeDir, workspaceRoot)
    expect(result.ok).toBe(true)
  })
})

describe("isCwdAllowed — strict mode", () => {
  let tempDir: string
  let workspaceRoot: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tumcp-cwd-strict-"))
    workspaceRoot = join(tempDir, "project")
    mkdirSync(workspaceRoot, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("workspaceRoot 自身允许", async () => {
    const result = await isCwdAllowed(workspaceRoot, workspaceRoot, [], "strict")
    expect(result.ok).toBe(true)
  })

  it("workspaceRoot 子目录允许", async () => {
    const srcDir = join(workspaceRoot, "src")
    mkdirSync(srcDir)
    const result = await isCwdAllowed(srcDir, workspaceRoot, [], "strict")
    expect(result.ok).toBe(true)
  })

  it("allowedCwdRoots 子目录允许", async () => {
    const optDir = join(tempDir, "opt-workspace")
    mkdirSync(optDir)
    const optSub = join(optDir, "project")
    mkdirSync(optSub)
    const result = await isCwdAllowed(optSub, workspaceRoot, [optDir], "strict")
    expect(result.ok).toBe(true)
  })

  it("denied root 拒绝（/etc）", async () => {
    const result = await isCwdAllowed("/etc/config", workspaceRoot, [], "strict")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("INVALID_CWD")
    }
  })

  it("非白名单但非 denied root 的目录也拒绝", async () => {
    const outsideDir = join(tempDir, "outside-project")
    mkdirSync(outsideDir)
    const result = await isCwdAllowed(outsideDir, workspaceRoot, [], "strict")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("INVALID_CWD")
      expect(result.reason).toContain("strict cwd policy")
    }
  })

  it("strict 模式拒绝 reason 包含正确描述", async () => {
    const outsideDir = join(tempDir, "somewhere-else")
    mkdirSync(outsideDir)
    const result = await isCwdAllowed(outsideDir, workspaceRoot, [], "strict")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain("outside workspaceRoot and allowedCwdRoots")
      expect(result.reason).toContain("strict cwd policy")
    }
  })

  it("/tmp 在 strict 模式下拒绝（不在白名单内）", async () => {
    const result = await isCwdAllowed("/tmp", workspaceRoot, [], "strict")
    expect(result.ok).toBe(false)
  })

  it("/tmp 在 strict + allowedCwdRoots 包含 /tmp 时允许", async () => {
    const result = await isCwdAllowed("/tmp", workspaceRoot, ["/tmp"], "strict")
    expect(result.ok).toBe(true)
  })
})

describe("isCwdAllowed — symlink defense with cwd policy mode", () => {
  let tempDir: string
  let workspaceDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tumcp-cwd-symlink-"))
    workspaceDir = join(tempDir, "workspace")
    mkdirSync(workspaceDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("strict 模式：workspace 下 symlink 指向外部目录时拒绝", async () => {
    const outsideDir = join(tempDir, "outside")
    mkdirSync(outsideDir)
    const symlinkPath = join(workspaceDir, "link-to-outside")
    symlinkSync(outsideDir, symlinkPath)

    const result = await isCwdAllowed(symlinkPath, workspaceDir, [], "strict")
    // symlink 解析到 workspace 外 — strict 拒绝
    // 但 realpath 解析后实际上 outsideDir 在 tempDir 下，不在 workspaceDir 下
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("INVALID_CWD")
    }
  })

  it("guarded 模式：workspace 下 symlink 指向 denied root 时拒绝", async () => {
    const etcSymlink = join(workspaceDir, "etc-link")
    symlinkSync("/etc", etcSymlink)

    const result = await isCwdAllowed(etcSymlink, workspaceDir, [], "guarded")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("INVALID_CWD")
    }
  })

  it("guarded 模式：workspace 下 symlink 指向非 denied root 外部目录时允许", async () => {
    const outsideDir = join(tempDir, "outside-safe")
    mkdirSync(outsideDir)
    const symlinkPath = join(workspaceDir, "link-to-safe")
    symlinkSync(outsideDir, symlinkPath)

    const result = await isCwdAllowed(symlinkPath, workspaceDir, [], "guarded")
    // realpath 解析到 tempDir/outside-safe，不在 denied roots，guarded 允许
    expect(result.ok).toBe(true)
  })

  it("strict 模式：workspace 下 symlink 指向 /etc 时拒绝", async () => {
    const etcSymlink = join(workspaceDir, "etc-link")
    symlinkSync("/etc", etcSymlink)

    const result = await isCwdAllowed(etcSymlink, workspaceDir, [], "strict")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("INVALID_CWD")
    }
  })

  it("strict 模式：workspace 内正常子目录允许", async () => {
    const subdir = join(workspaceDir, "src")
    mkdirSync(subdir)
    const result = await isCwdAllowed(subdir, workspaceDir, [], "strict")
    expect(result.ok).toBe(true)
  })
})

describe("isCommandSafeArgv - shell chain bypass prevention", () => {
  it(`echo ok; rm -rf /tmp/x 被拒绝（; 后含被拒命令 rm）`, () => {
    const result = isCommandSafeArgv("echo ok; rm -rf /tmp/x", [])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("UNSAFE_COMMAND")
      expect(result.reason).toContain("rm")
    }
  })

  it(`true && curl http://evil 被拒绝（&& 后含被拒命令 curl）`, () => {
    const result = isCommandSafeArgv("true && curl http://evil", [])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("UNSAFE_COMMAND")
      expect(result.reason).toContain("curl")
    }
  })

  it(`printf x | sh 被拒绝（| 后含被拒命令 sh）`, () => {
    const result = isCommandSafeArgv("printf x | sh", [])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("UNSAFE_COMMAND")
      expect(result.reason).toContain("sh")
    }
  })

  it(`echo hello（无 chain 操作符）仍然允许`, () => {
    const result = isCommandSafeArgv("echo hello", [])
    expect(result.ok).toBe(true)
  })

  it(`echo ok; ls -la（两个子命令均安全）仍然允许`, () => {
    const result = isCommandSafeArgv("echo ok; ls -la", [])
    expect(result.ok).toBe(true)
  })

  it(`ls || true 允许（两个子命令均安全）`, () => {
    const result = isCommandSafeArgv("ls || true", [])
    expect(result.ok).toBe(true)
  })

  it(`ls |& grep foo 允许（ls 和 grep 都安全）`, () => {
    const result = isCommandSafeArgv("ls |& grep foo", [])
    expect(result.ok).toBe(true)
  })

  it(`safe_cmd $(rm -rf /) 被拒绝（$() 中含被拒命令 rm）`, () => {
    const result = isCommandSafeArgv("safe_cmd $(rm -rf /)", [])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("UNSAFE_COMMAND")
      expect(result.reason).toContain("rm")
    }
  })

  it(`echo \`rm -rf /\` 被拒绝（反引号中含被拒命令 rm）`, () => {
    const result = isCommandSafeArgv("echo `rm -rf /`", [])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("UNSAFE_COMMAND")
      expect(result.reason).toContain("rm")
    }
  })

  it("riskyMode='ask' 时 chain 中的被拒命令返回 CONFIRMATION_REQUIRED", () => {
    const result = isCommandSafeArgv("echo ok; rm -rf /", [], [], [], "ask")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("CONFIRMATION_REQUIRED")
    }
  })

  it("riskyMode='allow' 时 chain 中的被拒命令允许通过", () => {
    const result = isCommandSafeArgv("echo ok; rm -rf /", [], [], [], "allow")
    expect(result.ok).toBe(true)
  })

  it("allowedCommands 覆盖 chain 中的被拒命令", () => {
    const result = isCommandSafeArgv("echo ok; rm -rf /", [], ["rm"])
    expect(result.ok).toBe(true)
  })
})

// ============================================================
// validateRegexSafety — ReDoS 防护测试 (RE2 + heuristic fallback)
// ============================================================

describe("validateRegexSafety", () => {
  it("正常正则表达式通过验证", () => {
    const result = validateRegexSafety("hello.*world")
    expect(result.ok).toBe(true)
  })

  it("空正则表达式通过验证", () => {
    const result = validateRegexSafety("")
    expect(result.ok).toBe(true)
  })

  it("长但安全的正则表达式通过验证（无长度限制）", () => {
    const longPattern = "a".repeat(1000)
    const result = validateRegexSafety(longPattern)
    expect(result.ok).toBe(true)
  })

  it("复杂但安全的多选正则通过验证", () => {
    const result = validateRegexSafety("(error|warn|info|debug)")
    expect(result.ok).toBe(true)
  })

  it("结果包含 warning 字段（RE2 或启发式信息）", () => {
    const result = validateRegexSafety("test")
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(typeof result.warning).toBe("string")
    }
  })

  describe("无 RE2 时（启发式 fallback）", () => {
    it("嵌套量词模式被拒绝", () => {
      const result = validateRegexSafety("(a+)+")
      // 无 RE2 时启发式拒绝嵌套量词；有 RE2 时放行（RE2 保证线性时间）
      if (result.ok) {
        // RE2 可用 — 放行是正确的
        expect(result.warning).toContain("RE2")
      } else {
        // RE2 不可用 — 启发式拒绝
        expect(result.code).toBe("UNSAFE_REGEX_PATTERN")
        expect(result.reason).toContain("nested quantifiers")
      }
    })

    it("无效正则表达式被拒绝（RE2 可用时）或交由执行时报错（无 RE2 时）", () => {
      const result = validateRegexSafety("(unclosed")
      // RE2 编译会捕获语法错误；无 RE2 时启发式不检测语法（仅检测嵌套量词），
      // 所以无效非嵌套量词正则在无 RE2 环境下会通过验证，执行时由 RegExp 抛错
      if (!result.ok) {
        expect(result.code).toBe("INVALID_REGEX")
      }
      // 无 RE2 时 result.ok === true 是合理的——语法校验属于执行层
    })
  })
})

describe("createSafeRegex", () => {
  it("返回可调用 .test() 的正则对象", () => {
    const re = createSafeRegex("hello")
    expect(typeof re.test).toBe("function")
    expect(re.test("hello world")).toBe(true)
    expect(re.test("goodbye")).toBe(false)
  })

  it("返回可调用 .exec() 的正则对象", () => {
    const re = createSafeRegex("(\\d+)")
    const match = re.exec("abc 123 def")
    expect(match).not.toBeNull()
    expect(match?.[1]).toBe("123")
  })

  it("支持 flags 参数", () => {
    const re = createSafeRegex("hello", "i")
    expect(re.test("HELLO")).toBe(true)
  })

  it("不带 flags 时创建无标志正则", () => {
    const re = createSafeRegex("hello")
    expect(re.test("HELLO")).toBe(false)
  })
})
