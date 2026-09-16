# 跨Agent共用共享 | Cross-Agent Shared Core

**[中文](#中文) ｜ [English](#english)**

---

## 中文

### 这是什么

跨 Agent 共用共享的开源分发仓：把 Pi 体系下可跨 harness 复用的资产（SubAgent 定义、派发 CLI、项目初始化/全局同步工具、共享指令模板、WorkBuddy skill）集中为一个可一键部署的包。所有 Agent 消费**同一份实现**，禁止任何 harness 另造平行体系。

### 分层架构

| 层 | 成员 | 职责 |
|---|---|---|
| **主体层（Primary）** | **Pi coding agent** | 唯一实现源：SubAgent 定义（`agents/`）、派发 CLI（`bin/subagent-cli.mjs`）、守卫与模型轮换配置（`extensions/tools/subagent/`）、共享指令模板（`templates/global-agents-shared.md`）、全局同步工具（`bin/project-init.mjs`） |
| **共用层（Shared）** | ZCode、WorkBuddy 及其他 harness/agent | 只消费主体层实现，不复制、不另建平行抽象 |

### 特殊 Agent 的接入实现方式

| Agent | 实现方式 |
|---|---|
| **ZCode** | 直接渲染：`node bin/project-init.mjs --sync-global` 把 `templates/global-agents-shared.md` 渲染进 `~/.zcode/AGENTS.md` 的 `pi:shared` 共享区块（各文件手工区保留，见 `templates/gate-policy.json` 的 `global_targets`） |
| **WorkBuddy** | Skill 镜像：无全局指令文件通道（人格文件不承载门禁，gate-policy 中 `workbuddy.path = null`），走 user-level skill `pi-agent-shared-tools`——`skills/pi-shared/SKILL.md` 部署到 `~/.workbuddy/skills/pi-shared/`，内容为守则镜像 + 转发 Pi 统一实现（pi-subagent / pi-project） |
| **项目级（全部 Agent）** | `bin/project-init.mjs "<项目>"` 生成项目契约 `AGENTS.md` + `.pi/task_set.json`；存在 WorkBuddy 时由生成器同步写入等价 `CODEBUDDY.md` |

### 仓库结构

```
agents/                    # SubAgent 定义：thinker / coder / reasoner / navigator
bin/                       # subagent-cli.mjs(+包装器)、project-init.mjs(+包装器)、newapi-models.mjs
templates/                 # global-agents-shared.md(共享指令模板源)、gate-policy.json 等 6 件
extensions/tools/          # Pi 扩展套件：subagent/(agents-core/models-core/rotation/config) + weather-map
skills/pi-shared/SKILL.md  # WorkBuddy 共用通道
deploy.mjs                 # 一键部署
.pi/task_set.json          # 项目任务集（含未来规划）
```

### 一键部署

```bash
git clone https://github.com/EdgewalkerBlue/cross-agent-shared.git && cd cross-agent-shared
node deploy.mjs            # 部署到 ~/.pi/agent 与 ~/.workbuddy/skills，随后自动 sync-global
node deploy.mjs --dry-run  # 仅查看将执行的动作
```

部署动作：覆盖前自动备份到 `~/.pi/agent/backup-deploy-<时间戳>/` → 复制资产 → `--sync-global` 渲染全部已接入 harness 的全局指令（Pi / ZCode / Codex / Claude Code 等 15 处，清单见 `templates/gate-policy.json` 的 `global_targets`） → 自检（`subagent-cli --list` 含 4 个 agent、两个全局指令文件含「无人值守执行守则」、WorkBuddy skill 与仓库一致）。

### 未来规划（Roadmap）

共用层扩展进展（调研结论与决策记录见 `docs/harness-injection-research.md`，任务登记于 `.pi/task_set.json`）：

1. **已完成**：全局渲染目标已覆盖 13 个外部 harness——①原生 AGENTS.md：Codex、OpenCode、Qwen Code、Goose、Aider、DeepSeek Harness、Antigravity；②自有指令文件：Claude Code（全局 CLAUDE.md）、Cline、Roo Code、Kilo Code、OpenHands（`~/.agents/skills/`）、Grok Build（`~/.grok/rules/`）——由 `templates/gate-policy.json` 的 `global_targets` 统一驱动，`node deploy.mjs` 后自动渲染；项目级由 project-init 自动生成 Claude Code 的 `@AGENTS.md` 指针 CLAUDE.md，CLAUDE.md 已纳入禁传清单；
2. **待人工**：Aider 的 `~/.aider.conf.yml` read 接线（渲染文件已就位，待实际安装后补）；
3. **暂缓**：SWE-agent（C 级，无文件级注入点，仅 YAML 模板内嵌）。

### 许可证

[MIT](LICENSE) © 2026 EdgewalkerBlue。代码、模板与 prompt 定义均按同一许可证提供；「禁止平行实现」是面向接入方的工作流约定（见 `templates/global-agents-shared.md`），不构成许可证义务。

---

## English

### What is this

An open-source distribution repo for cross-agent shared assets: SubAgent definitions, the dispatch CLI, project-init / global-sync tooling, the shared instruction template, and the WorkBuddy skill — packaged for one-shot deployment. All agents consume **the single implementation**; parallel per-harness re-implementations are forbidden.

### Layered architecture

| Layer | Members | Responsibility |
|---|---|---|
| **Primary** | **Pi coding agent** | Single source of implementation: SubAgent definitions (`agents/`), dispatch CLI (`bin/subagent-cli.mjs`), guard & model-rotation config (`extensions/tools/subagent/`), shared instruction template (`templates/global-agents-shared.md`), global sync tooling (`bin/project-init.mjs`) |
| **Shared** | ZCode, WorkBuddy and other harnesses/agents | Consume the primary implementation only — no copies, no parallel abstractions |

### Harness-specific integration

| Agent | How it integrates |
|---|---|
| **ZCode** | Direct rendering: `node bin/project-init.mjs --sync-global` renders `templates/global-agents-shared.md` into the `pi:shared` block of `~/.zcode/AGENTS.md` (manual sections preserved; targets defined in `templates/gate-policy.json`) |
| **WorkBuddy** | Skill mirror: no global-instruction file channel (persona files carry no gates; `workbuddy.path = null` in gate-policy). Uses the user-level skill `pi-agent-shared-tools` — `skills/pi-shared/SKILL.md` deployed to `~/.workbuddy/skills/pi-shared/`, mirroring the protocol and forwarding to Pi's unified implementation (pi-subagent / pi-project) |
| **Project level (all agents)** | `bin/project-init.mjs "<project>"` scaffolds the project contract `AGENTS.md` + `.pi/task_set.json`; an equivalent `CODEBUDDY.md` is written for WorkBuddy |

### Repository layout

```
agents/                    # SubAgent definitions: thinker / coder / reasoner / navigator
bin/                       # subagent-cli.mjs(+wrappers), project-init.mjs(+wrappers), newapi-models.mjs
templates/                 # global-agents-shared.md (shared template source), gate-policy.json, etc.
extensions/tools/          # Pi extension suite: subagent/(agents-core/models-core/rotation/config) + weather-map
skills/pi-shared/SKILL.md  # WorkBuddy channel
deploy.mjs                 # one-shot deployer
.pi/task_set.json          # project task set (incl. roadmap)
```

### One-shot deploy

```bash
git clone https://github.com/EdgewalkerBlue/cross-agent-shared.git && cd cross-agent-shared
node deploy.mjs            # install into ~/.pi/agent and ~/.workbuddy/skills, then auto sync-global
node deploy.mjs --dry-run  # list actions only
```

Deploy flow: back up overwritten files to `~/.pi/agent/backup-deploy-<timestamp>/` → copy assets → `--sync-global` renders global instructions for all wired harnesses (Pi / ZCode / Codex / Claude Code etc., 15 targets — see `global_targets` in `templates/gate-policy.json`) → self-check (`subagent-cli --list` contains the 4 agents; both global instruction files contain the unattended-loop protocol; WorkBuddy skill matches the repo).

### Roadmap

Shared-layer expansion status (research findings & decisions: `docs/harness-injection-research.md`; tasks tracked in `.pi/task_set.json`):

1. **Done**: global render targets now cover 13 external harnesses — native AGENTS.md readers (Codex, OpenCode, Qwen Code, Goose, Aider, DeepSeek Harness, Antigravity) and own-rule-file tools (Claude Code global CLAUDE.md, Cline, Roo Code, Kilo Code, OpenHands `~/.agents/skills/`, Grok Build `~/.grok/rules/`) — all driven by `global_targets` in `templates/gate-policy.json` and rendered automatically by `node deploy.mjs`. Project-level, project-init generates a one-line `@AGENTS.md` pointer CLAUDE.md for Claude Code, and CLAUDE.md is on the forbidden-upload list;
2. **Manual**: Aider's `~/.aider.conf.yml` read wiring (render target file in place; waits for an actual install);
3. **Deferred**: SWE-agent (grade C, no file-level injection point — YAML template embedding only).

### License

[MIT](LICENSE) © 2026 EdgewalkerBlue. Code, templates and prompt definitions are all provided under the same license. The "no parallel implementations" rule is a workflow convention for adopters (see `templates/global-agents-shared.md`), not a license obligation.
