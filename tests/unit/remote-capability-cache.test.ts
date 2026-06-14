import { describe, expect, it } from "vitest"

import { parseProbeOutput, RemoteCapabilityCache } from "../../src/targets/remote-capability-cache.js"
import type { SystemSshTransport } from "../../src/providers/system-ssh-transport.js"

describe("parseProbeOutput", () => {
  it("parses complete Linux output", () => {
    const raw = "OS=Linux\nSHELL=/bin/bash\nTMUX=/usr/bin/tmux\nTMUX_V=tmux 3.4a\nHOME=/home/user\n"
    const caps = parseProbeOutput(raw)

    expect(caps.os).toBe("Linux")
    expect(caps.shell).toBe("/bin/bash")
    expect(caps.tmuxPath).toBe("/usr/bin/tmux")
    expect(caps.tmuxVersion).toBe("tmux 3.4a")
    expect(caps.home).toBe("/home/user")
  })

  it("handles missing tmux", () => {
    const raw = "OS=Darwin\nSHELL=/bin/zsh\nTMUX=\nTMUX_V=\nHOME=/Users/dev\n"
    const caps = parseProbeOutput(raw)

    expect(caps.os).toBe("Darwin")
    expect(caps.tmuxPath).toBeNull()
    expect(caps.tmuxVersion).toBeNull()
    expect(caps.home).toBe("/Users/dev")
  })

  it("handles Windows target via MINGW", () => {
    const raw = "OS=MINGW64_NT-10.0\nSHELL=/usr/bin/bash\nTMUX=\nTMUX_V=\nHOME=/c/Users/dev\n"
    const caps = parseProbeOutput(raw)

    expect(caps.os).toBe("Windows")
    expect(caps.shell).toBe("cmd.exe")
    expect(caps.tmuxPath).toBeNull()
  })

  it("handles empty or malformed output with fallbacks", () => {
    const caps = parseProbeOutput("")

    expect(caps.os).toBe("Unknown")
    expect(caps.shell).toBe("/bin/sh")
    expect(caps.tmuxPath).toBeNull()
    expect(caps.tmuxVersion).toBeNull()
    expect(caps.home).toBe("unknown")
  })

  it("parses FreeBSD output", () => {
    const raw = "OS=FreeBSD\nSHELL=/bin/csh\nTMUX=/usr/local/bin/tmux\nTMUX_V=tmux 3.3a\nHOME=/home/admin\n"
    const caps = parseProbeOutput(raw)

    expect(caps.os).toBe("FreeBSD")
    expect(caps.shell).toBe("/bin/csh")
    expect(caps.tmuxPath).toBe("/usr/local/bin/tmux")
    expect(caps.tmuxVersion).toBe("tmux 3.3a")
  })

  it("parses macOS with Homebrew tmux", () => {
    const raw = "OS=Darwin\nSHELL=/bin/zsh\nTMUX=/opt/homebrew/bin/tmux\nTMUX_V=tmux 3.5a\nHOME=/Users/dev\n"
    const caps = parseProbeOutput(raw)

    expect(caps.os).toBe("Darwin")
    expect(caps.shell).toBe("/bin/zsh")
    expect(caps.tmuxPath).toBe("/opt/homebrew/bin/tmux")
    expect(caps.tmuxVersion).toBe("tmux 3.5a")
  })

  it("handles CYGWIN as Windows", () => {
    const raw = "OS=CYGWIN_NT-10.0\nSHELL=/bin/bash\nTMUX=\nTMUX_V=\nHOME=/home/admin\n"
    const caps = parseProbeOutput(raw)

    expect(caps.os).toBe("Windows")
    expect(caps.shell).toBe("cmd.exe") // /bin/bash not a useful Windows shell
  })

  it("handles Windows_NT directly", () => {
    const raw = "OS=Windows_NT\nSHELL=\nTMUX=\nTMUX_V=\nHOME=C:\\Users\\dev\n"
    const caps = parseProbeOutput(raw)

    expect(caps.os).toBe("Windows")
    expect(caps.shell).toBe("cmd.exe")
  })

  it("handles Windows with PowerShell as shell", () => {
    const raw = "OS=Windows_NT\nSHELL=C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\nTMUX=\nTMUX_V=\nHOME=C:\\Users\\dev\n"
    const caps = parseProbeOutput(raw)

    expect(caps.os).toBe("Windows")
    expect(caps.shell).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
  })

  it("rejects invalid tmux version format", () => {
    const raw = "OS=Linux\nSHELL=/bin/bash\nTMUX=/usr/bin/tmux\nTMUX_V=not-a-version\nHOME=/home/user\n"
    const caps = parseProbeOutput(raw)

    expect(caps.tmuxPath).toBe("/usr/bin/tmux")
    expect(caps.tmuxVersion).toBeNull() // invalid format → null
  })

  it("accepts tmux version with patch suffix", () => {
    const raw = "OS=Linux\nSHELL=/bin/bash\nTMUX=/usr/bin/tmux\nTMUX_V=tmux 3.2-rc1\nHOME=/home/user\n"
    const caps = parseProbeOutput(raw)

    expect(caps.tmuxVersion).toBe("tmux 3.2-rc1")
  })

  it("handles lines with extra equals signs in values", () => {
    // HOME path shouldn't normally have = but test robustness
    const raw = "OS=Linux\nSHELL=/bin/bash\nTMUX=\nTMUX_V=\nHOME=/home/user\nEXTRA=foo=bar\n"
    const caps = parseProbeOutput(raw)

    expect(caps.os).toBe("Linux")
    expect(caps.shell).toBe("/bin/bash")
  })

  it("handles partial output (only OS and SHELL)", () => {
    const raw = "OS=Linux\nSHELL=/bin/fish\n"
    const caps = parseProbeOutput(raw)

    expect(caps.os).toBe("Linux")
    expect(caps.shell).toBe("/bin/fish")
    expect(caps.tmuxPath).toBeNull()
    expect(caps.home).toBe("unknown")
  })

  it("handles Windows with MINGW and powershell.exe shell", () => {
    const raw = "OS=MINGW64_NT-10.0-19041\nSHELL=C:\\Program Files\\PowerShell\\7\\pwsh.exe\nTMUX=\nTMUX_V=\nHOME=C:\\Users\\dev\n"
    const caps = parseProbeOutput(raw)

    expect(caps.os).toBe("Windows")
    expect(caps.shell).toBe("C:\\Program Files\\PowerShell\\7\\pwsh.exe")
  })
})

describe("RemoteCapabilityCache", () => {
  it("caches probe results per profile", async () => {
    let calls = 0
    const transport: SystemSshTransport = {
      execRemote: async () => {
        calls += 1
        return {
          stdout: "OS=Linux\nSHELL=/bin/bash\nTMUX=/usr/bin/tmux\nTMUX_V=tmux 3.4a\nHOME=/home/user\n",
          stderr: "",
        }
      },
    }
    const cache = new RemoteCapabilityCache()

    const first = await cache.probeViaTransport(transport, "devbox")
    const second = await cache.probeViaTransport(transport, "devbox")

    expect(calls).toBe(1)
    expect(second).toBe(first)
    expect(cache.get("devbox")).toBe(first)
  })

  it("returns fallback capabilities when probe transport fails", async () => {
    const transport: SystemSshTransport = {
      execRemote: async () => {
        throw new Error("probe failed")
      },
    }
    const cache = new RemoteCapabilityCache()

    const caps = await cache.probeViaTransport(transport, "broken")

    expect(caps.shell).toBe("/bin/sh")
    expect(caps.tmuxPath).toBeNull()
  })
})
