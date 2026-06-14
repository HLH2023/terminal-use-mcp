---
name: terminal-use-mcp-development
description: Use when 开发 terminal-use-mcp 本身（非使用它），涵盖双 Git 仓库提交/同步、版本管理、npm publish 流程。此 skill 与 terminal-use-operations（使用工具）和 local-tool-development（通用本地工具范式）互补。
compatibility: opencode
triggers:
  - terminal-use-mcp 开发
  - terminal-use-mcp 提交
  - terminal-use-mcp 发布
  - terminal-use-mcp publish
  - dual repo push
  - 双仓库提交
---

# terminal-use-mcp 开发 Skill

## 核心定位

此 skill 专门面向 **terminal-use-mcp 项目本身的开发、提交与发布流程**。
- `terminal-use-operations` → 管理/使用 terminal-use-mcp 的 MCP 工具（用户视角）
- `local-tool-development` → 通用本地工具开发范式（规划、目录、验收）
- **本 skill** → terminal-use-mcp 的双仓库同步、提交、发布工作流

## 双仓库架构

terminal-use-mcp 维护在两个独立 Git 仓库中，变更必须同步到两端：

| 仓库 | 路径 | Remote | 分支 | 定位 |
|------|------|--------|------|------|
| **GitLab Monorepo** | `/home/hlh/dev/homelab-terminal-use/` | `ssh://git@gitlab.greatbox.top:2424/cool/homelab.git` | `feature/terminal-use-mcp` | 源代码存放处（作为 monorepo 子目录） |
| **GitHub Standalone** | `/tmp/terminal-use-mcp/` | `https://github.com/HLH2023/terminal-use-mcp.git` | `main` | 独立发布仓库（npm publish 源） |

**源代码位置**：`/home/hlh/dev/homelab-terminal-use/tools/local/terminal-use-mcp/`

**数据流方向**：GitLab 源码 → rsync → GitHub 仓库 → npm publish

## 提交流程（每次变更必须执行）

### Step 1: 验证

```bash
cd /home/hlh/dev/homelab-terminal-use/tools/local/terminal-use-mcp
npx tsc --noEmit    # 必须零错误
npm test            # 必须全部通过
```

**不通过则不得提交。** 先修复再提交。

### Step 2: 构建 + 同步到 GitHub 仓库

```bash
# 构建
cd /home/hlh/dev/homelab-terminal-use/tools/local/terminal-use-mcp
npm run build

# 同步源码到 GitHub 仓库（排除构建产物和依赖）
rsync -av --delete \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='.git/' \
  --exclude='.config/' \
  --exclude='artifacts/' \
  /home/hlh/dev/homelab-terminal-use/tools/local/terminal-use-mcp/ \
  /tmp/terminal-use-mcp/

# 在 GitHub 仓库内构建（确保 dist/ 一致）
cd /tmp/terminal-use-mcp
npm run build
```

**rsync 排除项说明**：
- `node_modules/`：各仓库独立安装，不同步
- `dist/`：GitHub 仓库需自行构建以确保一致性
- `.git/`：各仓库独立 Git 历史
- `.config/`、`artifacts/`：运行时产物，不属于源码
- rsync 使用 `--delete` 删除目标中源端不存在的文件，保持完全同步

### Step 3: 提交到 GitHub 仓库

```bash
cd /tmp/terminal-use-mcp
git add -A
git commit -m "<type>: <description>"
git push origin main
```

**Commit message 格式**（遵循 Conventional Commits）：
- `feat:` 新功能
- `fix:` 修复
- `docs:` 文档
- `refactor:` 重构
- `test:` 测试
- `chore:` 构建/配置/依赖

### Step 4: 提交到 GitLab Monorepo

```bash
cd /home/hlh/dev/homelab-terminal-use
git add tools/local/terminal-use-mcp/
git commit -m "feat(terminal-use-mcp): <description>"
git push origin feature/terminal-use-mcp
```

**Commit message 格式**：`feat(terminal-use-mcp): <description>`（带 scope 前缀，符合 monorepo 约定）

### 执行顺序

**GitHub 先行，GitLab 后行。** 原因：
1. GitHub 是 npm publish 的源仓库，优先确保发布端正确
2. GitLab monorepo 只需记录源码变更，万一失败可重试

## npm Publish 流程

### ⛔ 硬性约束

**未经用户审核确认，绝不执行 `npm publish`。** 必须先提交到两个仓库，等待用户审核后再发布。

### Step 1: 预发布验证

```bash
cd /home/hlh/dev/homelab-terminal-use/tools/local/terminal-use-mcp

# 完整检查
npm run check    # typecheck + test

# 构建
npm run build

# 确认 dist/ 产物
ls dist/ | head -20
```

### Step 2: 版本号更新

```bash
# 在 package.json 中手动更新 version
# 遵循 SemVer：
#   patch (0.1.x): 修复 bug、安全补丁
#   minor (0.x.0): 新功能（向后兼容）
#   major (x.0.0): 破坏性变更
```

**版本号更新后必须双仓库提交**。

### Step 3: 同步 + 构建到 GitHub 仓库

```bash
# 同步源码
rsync -av --delete \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='.git/' \
  --exclude='.config/' \
  --exclude='artifacts/' \
  /home/hlh/dev/homelab-terminal-use/tools/local/terminal-use-mcp/ \
  /tmp/terminal-use-mcp/

# 在 GitHub 仓库构建
cd /tmp/terminal-use-mcp
npm install
npm run build
npm run check
```

### Step 4: 发布前最终验证

```bash
cd /tmp/terminal-use-mcp

# 确认 package.json 内容正确
cat package.json | grep -E '"name"|"version"|"main"|"bin"|"files"|"license"'

# 确认 dist/ 包含入口文件
ls dist/index.js dist/index.d.ts

# 确认 files 字段只包含必要文件
# 当前: ["dist", "README.md", "README_zh.md", "LICENSE"]

# dry-run 验证打包内容
npm pack --dry-run
```

### Step 5: 通知用户审核

**到此为止，停止。向用户报告：**

```
terminal-use-mcp v<version> 发布准备完成：

✅ tsc --noEmit 零错误
✅ npm test 全部通过 (<N> tests)
✅ npm run build 成功
✅ 双仓库已推送 (GitHub: <sha>, GitLab: <sha>)
✅ npm pack --dry-run 产物确认

待审核后执行：
  cd /tmp/terminal-use-mcp && npm publish --access public
```

**等待用户明确确认后才执行发布。**

### Step 6: 发布（用户确认后）

```bash
cd /tmp/terminal-use-mcp
npm publish --access public
```

### Step 7: 发布后——打 tag + 推送

```bash
cd /tmp/terminal-use-mcp
git tag -a "v<version>" -m "v<version>"
git push origin main --tags
```

同时在 GitLab monorepo 也打 tag 并提交推送：

```bash
cd /home/hlh/dev/homelab-terminal-use
git tag -a "terminal-use-mcp-v<version>" -m "terminal-use-mcp v<version>"
git push origin feature/terminal-use-mcp --tags
```

**Tag 命名区别**：
- GitHub：`v<version>`（如 `v0.2.0`）
- GitLab monorepo：`terminal-use-mcp-v<version>`（如 `terminal-use-mcp-v0.2.0`，避免与 monorepo 其他组件 tag 冲突）

## package.json 关键字段

```jsonc
{
  "name": "terminal-use-mcp",
  "version": "0.1.0",           // 发布前更新
  "type": "module",             // ESM
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
| npm test | 31 files / 660 tests |
| npm run build | clean |

**任何变更后必须确认这些基线不被破坏。** 测试数变化时更新本 skill。

## 常见场景

### 场景 A：代码修改后提交

1. 修改源码
2. `tsc --noEmit` + `npm test`
3. `npm run build`
4. rsync → GitHub 仓库
5. GitHub: `git add -A && git commit && git push origin main`
6. GitLab: `git add tools/local/terminal-use-mcp/ && git commit && git push origin feature/terminal-use-mcp`

### 场景 B：安全修复后提交

与场景 A 相同流程，但 commit message 用 `fix(security):` 前缀。

### 场景 C：准备新版本发布

1. 更新 package.json version
2. 完整提交流程（场景 A）
3. `npm pack --dry-run` 确认打包内容
4. 通知用户审核
5. 用户确认后 `npm publish --access public`
6. 打 tag + 推送两仓库

### 场景 D：紧急 hotfix

1. 修复代码
2. 更新 package.json version（patch 递增）
3. 完整提交流程
4. **仍然需要用户审核** 才能 npm publish（无例外）

### 场景 E：仅文档变更

1. 修改文档（README、docs/、skills/ 等）
2. 仍需 rsync + 双仓库提交
3. 不需要 `npm run build`（无代码变更）
4. 但仍需 `tsc --noEmit`（确认无破坏）

## 检查清单

每次提交前确认：

- [ ] `tsc --noEmit` 零错误
- [ ] `npm test` 全部通过
- [ ] 代码变更 → `npm run build` 成功
- [ ] rsync 已同步到 `/tmp/terminal-use-mcp/`
- [ ] GitHub 仓库已 commit + push
- [ ] GitLab monorepo 已 commit + push（`tools/local/terminal-use-mcp/` 路径下）
- [ ] commit message 格式正确

npm publish 前额外确认：

- [ ] 用户已审核并确认发布
- [ ] package.json version 已更新
- [ ] `npm pack --dry-run` 产物正确
- [ ] 发布后 tag 已打并推送两仓库

## 禁止事项

| 禁止 | 原因 |
|------|------|
| 未经用户确认执行 `npm publish` | 必须经过审核 |
| 只推一个仓库 | 两个仓库必须同步 |
| 跳过 `tsc --noEmit` / `npm test` | 必须验证基线不被破坏 |
| rsync 不带 `--delete` | 会留下已删除的陈旧文件 |
| 修改 `apps/*` 或 `packages/*` | terminal-use-mcp 是独立工具，不修改主业务 |
| 忘记在 GitHub 仓库 `npm run build` | dist/ 必须在 GitHub 仓库内重新构建 |
