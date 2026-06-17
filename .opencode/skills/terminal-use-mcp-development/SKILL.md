---
name: terminal-use-mcp-development
description: Use when 开发 terminal-use-mcp 本身（非使用它），涵盖提交流程、版本管理、npm publish 流程、分支策略。此 skill 与 terminal-use-operations（使用工具）互补。
compatibility: opencode
triggers:
  - terminal-use-mcp 开发
  - terminal-use-mcp 提交
  - terminal-use-mcp 发布
  - terminal-use-mcp publish
---

# terminal-use-mcp 开发 Skill

## 核心定位

此 skill 专门面向 **terminal-use-mcp 项目本身的开发、提交与发布流程**。
- `terminal-use-operations` → 管理/使用 terminal-use-mcp 的 MCP 工具（用户视角）
- **本 skill** → terminal-use-mcp 的提交流程、分支策略、发布工作流

## 仓库架构

| 项目 | 值 |
|------|-----|
| **GitHub 仓库** | `https://github.com/HLH2023/terminal-use-mcp.git` |
| **本地路径** | `~/dev/terminal-use-mcp/` |
| **认证方式** | `gh` CLI (HTTPS, keyring token) |
| **主分支** | `main` (稳定，只接受 PR) |
| **开发分支** | `dev` (公开但受保护，外部贡献者通过 PR 合并) |

**数据流**: 本地修改 → `dev` 分支 → PR → `main` 分支 → npm publish

## 分支策略

```
main  ← 稳定发布分支，只接受来自 dev 的 PR
  ↑
dev   ← 开发分支，日常开发在此分支进行
  ↑
feature/* ← 功能分支，从 dev 创建，完成后 PR 合并到 dev
```

- `main`: 稳定分支，对应已发布版本
- `dev`: 开发分支，日常开发在此进行
- `feature/*`: 功能分支，从 dev 创建，完成后通过 PR 合并回 dev
- 外部贡献者: fork → 修改 → PR 到 `dev`

## 提交流程（每次变更必须执行）

### Step 1: 验证

```bash
cd ~/dev/terminal-use-mcp
npx tsc --noEmit    # 必须零错误
npm test            # 必须全部通过
```

**不通过则不得提交。** 先修复再提交。

### Step 2: 构建

```bash
cd ~/dev/terminal-use-mcp
npm run build
```

仅在代码变更时需要构建。纯文档变更可跳过。

### Step 3: 提交

```bash
cd ~/dev/terminal-use-mcp
git add -A
git commit -m "<type>: <description>"
git push origin dev
```

**Commit message 格式**（遵循 Conventional Commits）：
- `feat:` 新功能
- `fix:` 修复
- `docs:` 文档
- `refactor:` 重构
- `test:` 测试
- `chore:` 构建/配置/依赖

### Step 4: 合并到 main（版本发布时）

```bash
# 通过 GitHub PR: dev → main
gh pr create --base main --head dev --title "release: v<version>" --body "Release v<version>"
```

合并后打 tag 并发布。

## npm Publish 流程

### ⛔ 硬性约束

**未经用户审核确认，绝不执行 `npm publish`。** 必须先完成所有验证，等待用户审核后再发布。

### Step 1: 预发布验证

```bash
cd ~/dev/terminal-use-mcp

# 完整检查
npm run check    # typecheck + test

# 构建
npm run build

# 确认 dist/ 产物
ls dist/ | head -20
```

### Step 2: 版本号更新

在 `src/version.ts` 中更新 `VERSION` 字符串，然后运行：

```bash
# 同步版本号到所有位置
# 1. src/version.ts → VERSION = "X.Y.Z"
# 2. src/index.ts → import { VERSION }
# 3. package.json → "version"
# 4. skills/terminal-use/SKILL.md → 版本头
# 5. skills/terminal-use-setup/SKILL.md → 版本头
# 6. README.md / README_zh.md → npx pin 示例
```

遵循 SemVer：
- `patch` (0.1.x): 修复 bug、安全补丁
- `minor` (0.x.0): 新功能（向后兼容）
- `major` (x.0.0): 破坏性变更

**版本号更新后必须提交推送。**

### Step 3: 发布前最终验证

```bash
cd ~/dev/terminal-use-mcp

# 确认 package.json 内容正确
cat package.json | grep -E '"name"|"version"|"main"|"bin"|"files"|"license"'

# 确认 dist/ 包含入口文件
ls dist/index.js dist/index.d.ts

# 确认 files 字段只包含必要文件
# 当前: ["dist", "README.md", "README_zh.md", "LICENSE"]

# dry-run 验证打包内容
npm pack --dry-run
```

### Step 4: 通知用户审核

**到此为止，停止。向用户报告：**

```
terminal-use-mcp v<version> 发布准备完成：

✅ tsc --noEmit 零错误
✅ npm test 全部通过 (<N> tests)
✅ npm run build 成功
✅ 已推送到 GitHub (dev + main)
✅ npm pack --dry-run 产物确认

待审核后执行：
  cd ~/dev/terminal-use-mcp && npm publish --access public
```

**等待用户明确确认后才执行发布。**

### Step 5: 发布（用户确认后）

```bash
cd ~/dev/terminal-use-mcp
npm publish --access public
```

### Step 6: 发布后——打 tag + 推送 + GitHub Release

```bash
cd ~/dev/terminal-use-mcp
git tag -a "v<version>" -m "v<version>"
git push origin main --tags

# 创建 GitHub Release
gh release create "v<version>" --repo HLH2023/terminal-use-mcp \
  --title "v<version>" \
  --notes "## v<version>

### 新增
-

### 修复
-

### 变更
-"
```

## package.json 关键字段

```jsonc
{
  "name": "terminal-use-mcp",
  "version": "0.2.0",            // 发布前更新
  "type": "module",              // ESM
  "main": "dist/index.js",
  "bin": { "terminal-use-mcp": "dist/index.js" },
  "files": ["dist", "README.md", "README_zh.md", "LICENSE"],  // npm 包只含 dist+文档
  "types": "dist/index.d.ts",
  "publishConfig": { "access": "public" },
  "optionalDependencies": {
    "node-pty": "^1.1.0",       // 可选：本地 PTY
    "re2": "^1.21.0"            // 可选：ReDoS 防护
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/HLH2023/terminal-use-mcp.git"
  }
}
```

**npm 包只发布 dist/ + README + LICENSE**。文档、tests、skills、examples 通过 GitHub 绝对 URL 在 README 中链接。

## 当前测试基线

| 指标 | 值 |
|------|-----|
| tsc --noEmit | 零错误 |
| npm test | 688 tests |
| npm run build | clean |

**任何变更后必须确认这些基线不被破坏。** 测试数变化时更新本 skill。

## 常见场景

### 场景 A：代码修改后提交

1. 修改源码
2. `tsc --noEmit` + `npm test`
3. `npm run build`（如有代码变更）
4. `git add -A && git commit && git push origin dev`

### 场景 B：安全修复后提交

与场景 A 相同流程，但 commit message 用 `fix(security):` 前缀。

### 场景 C：准备新版本发布

1. 更新 `src/version.ts` version + 所有引用位置
2. 完整提交流程（场景 A）
3. PR: dev → main
4. 合并后 `npm pack --dry-run` 确认打包内容
5. 通知用户审核
6. 用户确认后 `npm publish --access public`
7. 打 tag + GitHub Release

### 场景 D：紧急 hotfix

1. 从 main 创建 hotfix 分支
2. 修复代码
3. 更新 `src/version.ts` version（patch 递增）
4. 完整提交流程
5. PR: hotfix → main
6. **仍然需要用户审核** 才能 npm publish（无例外）
7. 同步 hotfix 到 dev 分支

### 场景 E：仅文档变更

1. 修改文档（README、docs/、skills/ 等）
2. 仍需 `tsc --noEmit`（确认无破坏）
3. 不需要 `npm run build`（无代码变更）
4. `git add -A && git commit && git push origin dev`

## 检查清单

每次提交前确认：

- [ ] `tsc --noEmit` 零错误
- [ ] `npm test` 全部通过
- [ ] 代码变更 → `npm run build` 成功
- [ ] `git push origin dev` 成功
- [ ] commit message 格式正确

npm publish 前额外确认：

- [ ] 用户已审核并确认发布
- [ ] `src/version.ts` version 已更新 + 所有引用同步
- [ ] dev 已合并到 main
- [ ] `npm pack --dry-run` 产物正确
- [ ] 发布后 tag 已打 + GitHub Release 已创建

## 禁止事项

| 禁止 | 原因 |
|------|------|
| 未经用户确认执行 `npm publish` | 必须经过审核 |
| 跳过 `tsc --noEmit` / `npm test` | 必须验证基线不被破坏 |
| 直接推送到 main | 必须通过 PR 合并 |
| 修改 `apps/*` 或 `packages/*` | terminal-use-mcp 是独立项目，不修改其他项目 |
| 忘记版本号多位置同步 | version.ts, package.json, skills 等必须一致 |
