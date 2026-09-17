# 跨Agent共用共享 | Cross-Agent Shared Core

[English](README.md) | **简体中文**

---

## 这是什么

跨 Agent 共用共享的开源分发仓：把 Pi 体系下可跨 harness 复用的资产（SubAgent 定义、派发 CLI、项目初始化/全局同步工具、共享指令模板、WorkBuddy skill）集中为一个可一键部署的包。所有 Agent 消费**同一份实现**，禁止任何 harness 另造平行体系。

## 分层架构

| 层 | 成员 | 职责 |
|---|---|---|
| **主体层（Primary）** | **Pi coding agent** | 唯一实现源：SubAgent 定义（`agents/`）、派发 CLI（`bin/subagent-cli.mjs`）、守卫与模型轮换配置（`extensions/tools/subagent/`）、共享指令模板（`templates/global-agents-shared.md`）、全局同步工具（`bin/project-init.mjs`） |
| **共用层（Shared）** | ZCode、WorkBuddy 及其他 harness/agent | 只消费主体层实现，不复制、不另建平行抽象 |

## 特殊 Agent 的接入实现方式

| Agent | 实现方式 |
|---|---|
| **ZCode** | 直接渲染：`node bin/project-init.mjs --sync-global` 把 `templates/global-agents-shared.md` 渲染进 `~/.zcode/AGENTS.md` 的 `pi:shared` 共享区块（各文件手工区保留，见 `templates/gate-policy.json` 的 `global_targets`） |
| **WorkBuddy** | Skill 镜像：无全局指令文件通道（人格文件不承载门禁，gate-policy 中 `workbuddy.path = null`），走 user-level skill `pi-agent-shared-tools`——`skills/pi-shared/SKILL.md` 部署到 `~/.workbuddy/skills/pi-shared/`，内容为守则镜像 + 转发 Pi 统一实现（pi-subagent / pi-project） |
| **项目级（全部 Agent）** | `bin/project-init.mjs "<项目>"` 生成项目契约 `AGENTS.md` + `.pi/task_set.json`；存在 WorkBuddy 时由生成器同步写入等价 `CODEBUDDY.md` |
| **Claude Code** | 不读项目 AGENTS.md——全局走 `~/.claude/CLAUDE.md` 标记块（刻意不用 `~/.claude/rules/`，Grok Build 兼容加载该目录会双重加载）；项目级由 project-init（`claude_sync` 开关）自动生成一行 `@AGENTS.md` 导入指针的 CLAUDE.md（已有 CLAUDE.md 一律不动），CLAUDE.md 已纳入禁传清单 |
| **Aider** | 不自动加载任何文件——渲染到 `~/.aider/CONVENTIONS.md` 后仍需在 `~/.aider.conf.yml` 写 `read: <本文件绝对路径>` 才生效（待实际安装后接线） |
| **Qwen Code** | 渲染到 `~/.qwen/AGENTS.md`——QWEN.md 与 AGENTS.md 均自动加载，选 AGENTS.md 把 QWEN.md 留给用户个人记忆 |
| **OpenHands** | 渲染到 `~/.agents/skills/pi-shared.md`——无触发器的纯 .md 全文常载；勿用 `~/.openhands/skills`（会覆盖公共 skills 缓存） |
| **Grok Build** | 渲染到 `~/.grok/rules/pi-shared.md`——勿放进其兼容加载的 `~/.claude/rules` / `~/.cursor/rules` |
| **Goose** | Windows 全局落点 `%APPDATA%\Block\goose\config\AGENTS.md`（不在 home 目录） |
| **Cline** | 全局规则为 `~/Documents/Cline/Rules/` 目录型；Documents 被重定向的机器需把 path 改为真实 Documents 下的路径 |
| **收敛位取舍** | 跨工具收敛点 `~/.agents/AGENTS.md` 故意不用——Goose/Cline 等多工具同时消费，单点渲染会造成上下文重复 |

## 仓库结构

```
agents/                    # SubAgent 定义：thinker / coder / reasoner / navigator
bin/                       # subagent-cli.mjs(+包装器)、project-init.mjs(+包装器)、newapi-models.mjs
templates/                 # global-agents-shared.md(共享指令模板源)、gate-policy.json 等 6 件
extensions/tools/          # Pi 扩展套件：subagent/(agents-core/models-core/rotation/config) + weather-map
skills/pi-shared/SKILL.md  # WorkBuddy 共用通道
deploy.mjs                 # 一键部署
.pi/task_set.json          # 项目任务集（含未来规划）
```

## 一键部署

```bash
git clone https://github.com/EdgewalkerBlue/cross-agent-shared.git && cd cross-agent-shared
node deploy.mjs            # 部署到 ~/.pi/agent 与 ~/.workbuddy/skills，随后自动 sync-global
node deploy.mjs --dry-run  # 仅查看将执行的动作
```

部署动作：覆盖前自动备份到 `~/.pi/agent/backup-deploy-<时间戳>/` → 复制资产 → `--sync-global` 渲染全部已接入 harness 的全局指令（Pi / ZCode / Codex / Claude Code 等 15 处，清单见 `templates/gate-policy.json` 的 `global_targets`） → 自检（`subagent-cli --list` 含 4 个 agent、两个全局指令文件含「无人值守执行守则」、WorkBuddy skill 与仓库一致）。

## 未来规划（Roadmap）

共用层扩展进展（调研结论与决策记录见 `docs/harness-injection-research.md`，任务登记于 `.pi/task_set.json`）：

1. **已完成**：全局渲染目标已覆盖 13 个外部 harness——①原生 AGENTS.md：Codex、OpenCode、Qwen Code、Goose、Aider、DeepSeek Harness、Antigravity；②自有指令文件：Claude Code、Cline、Roo Code、Kilo Code、OpenHands、Grok Build——由 `templates/gate-policy.json` 的 `global_targets` 统一驱动，`node deploy.mjs` 后自动渲染；其中偏离「直接加渲染目标」模式的例外见上表「特殊 Agent 的接入实现方式」；
2. **待人工**：Aider 的 `~/.aider.conf.yml` read 接线（渲染文件已就位，待实际安装后补）；
3. **暂缓**：SWE-agent（C 级，无文件级注入点，仅 YAML 模板内嵌）。

## 许可证

[MIT](LICENSE) © 2026 EdgewalkerBlue。代码、模板与 prompt 定义均按同一许可证提供；「禁止平行实现」是面向接入方的工作流约定（见 `templates/global-agents-shared.md`），不构成许可证义务。
