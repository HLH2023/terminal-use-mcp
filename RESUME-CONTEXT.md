# terminal-use-mcp 开发接力上下文

> 生成时间: 2026-06-12T18:00:00+08:00
> 生成者: Sisyphus (主 agent)

## 目标
- terminal-use-mcp: Local Production MCP Server + Skill for Terminal Computer Use，让开发 agent 通过 MCP 协议控制交互式终端程序

## 当前进度
### 已完成
- Phase 0 (脚手架): package.json / tsconfig.json / npm install / artifacts/.gitignore / 入口空壳
- Phase 1 (核心类型): errors.ts / ids.ts / keymap.ts / redact.ts / confirm-detection.ts / command-safety.ts / terminal-snapshot.ts / provider.ts / config.ts / logger.ts
- Phase 11 (Test fixtures): ask-name.js / menu-app.js / confirm-app.js / spinner-app.js / secret-output.js / fullscreen-tui.js
- DEV-PLAN.md 生产级修订 (9 轮校验)
- SKILL.md (local-tool-development 范式编写完成)
- AGENTS.md 追加 (tools/local/ 规则、local-tool 分类、skill 索引、大任务豁免、独立工具验收)
- Typecheck 通过 (`npx tsc --noEmit` 零错误)

### 进行中
- (无 — 开发暂停，范式补完完毕)

### 待办 (按优先级)
1. Phase 2: Terminal 层 — xterm-adapter.ts / screen-buffer.ts / highlights.ts / wait.ts / transcript.ts
2. Phase 3: SessionManager + PromiseQueue + TTL cleanup
3. Phase 4: NativePtyProvider (node-pty + @xterm/headless)
4. Phase 5: TmuxProvider (tmux 3.2+ required)
5. Phase 6: 已取消（冗余外部 CLI provider 已删除）
6. Phase 7: 22 MCP tools 注册
7. Phase 8: MCP Resources + Prompts
8. Phase 9: MCP Server 完整入口
9. Phase 10: Unit tests
12: Phase 12: Provider contract + MCP smoke tests
10. Phase 13: SKILL.md (terminal-use-local skill，非 local-tool-development 范式)
11. Phase 14: Examples
12. Phase 15: 验证 + 最终报告

## 关键决策
- 22 tools 总数 (7 lifecycle + 5 observation + 3 input + 7 meta)，新增 terminal.events 和 terminal.send_signal
- MCP SDK 用 registerTool()，inputSchema 用 ZodRawShapeCompat，zod v3 via SDK zod-compat
- NativePtyProvider 必须实现；构建失败时才 tmux fallback，但必须输出 native-pty-blocked.md
- xterm-adapter 已临时实现后删除（违反先范式后实现原则），需重新按范式流程开发
- local-tool-development SKILL.md 补全了: 恢复流程、并行开发指导、停止/接力上下文规范、主 skills 协作表

## 关键技术笔记
- @xterm/headless v6: Terminal class，buffer.active.getLine(y).translateToString(true)，cursorX/Y，title via onTitleChange event，isAltBuffer 判断 fullscreen，onWriteParsed 用于等待解析完成
- node-pty v1.1.0: pty.spawn()，.onData，.onExit({exitCode,signal})，.resize(cols,rows)，.write()
- 内部类型: IBufferLine.getCell(x) 返回 IBufferCell，cell.isInverse()/isBold() 用于 highlight 检测
- Env: Node.js 24.14.0, npm 11.9.0, tmux 3.4 (installed), python3 available, no lazygit, tui-use not installed
- MCP SDK registerTool handler 签名: `(input, extra) => Promise<CallToolResult>`
- success 必须同时返回 content (人读) + structuredContent (机读)
- failure 必须通过 TerminalUseError 子类抛出

## 关键文件 (≤10)
- `tools/local/terminal-use-mcp/DEV-PLAN.md`: 生产级开发计划 (22 tools, 19 sections, 9 轮修订)
- `tools/local/terminal-use-mcp/PROGRESS.md`: 当前进度追踪
- `tools/local/terminal-use-mcp/src/terminal/errors.ts`: 14 error codes + TerminalUseError 体系
- `tools/local/terminal-use-mcp/src/terminal/terminal-snapshot.ts`: TerminalSnapshot 类型 + createSnapshot
- `tools/local/terminal-use-mcp/src/terminal/keymap.ts`: 17 keys, ANSI/tmux/tui-use 映射
- `tools/local/terminal-use-mcp/src/providers/provider.ts`: TerminalProvider 接口 + 全部 IO 类型
- `tools/local/terminal-use-mcp/src/config.ts`: 12 环境变量 + loadConfig()
- `tools/local/terminal-use-mcp/src/index.ts`: 骨架 MCP server (terminal.health tool)
- `.opencode/skills/local-tool-development/SKILL.md`: 独立工具开发范式 (含恢复/并行/接力)
- `AGENTS.md`: 项目级规则 (含 tools/local/ 规则 + local-tool 分类)

## 约束
- 不修改 apps/*、packages/*、冻结文档、主任务板
- 不用 any / @ts-ignore / @ts-expect-error
- 日志只写 stderr，stdout 保留给 MCP 协议
- 所有 tool 响必须返回 structuredContent + content
- 错误必须通过 TerminalUseError 子类抛出
- TypeScript ESM (type: "module")
- xterm-adapter 的 getXxx 返回值立即使用，不长期持有

## 不需要做的事
- 不修改 HomeLab 主业务代码
- 不绑定 HL-P*-T* 大任务
- 不自动安装全局依赖 (tui-use 等)
- 不做 Native Windows 支持 (v2)
- 不做 session 持久化/恢复 (v2+)
- 不做完整沙箱 (command policy 只限制 terminal.start 的启动命令)
- 已删除的 xterm-adapter.ts 不需要恢复，按范式重新实现即可
