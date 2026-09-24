# Harness 指令注入点调研（14 项路线图 · 2026-09-16 基线 / 2026-09-24 复查）

> 结论支撑 `.pi/task_set.json` ROAD-01～ROAD-14 的落地与后续接线任务。
> 调研方式：官方文档 + 源码交叉核对（三个并行调研通道，截至 2026-09 最新版本）。
> 2026-09-24 复查（窗口 09-10 → 09-24）结论见文末专节：Claude Code 已新增 AGENTS.md 原生回退支持、Roo Code 官方归档由 Zoo Code 接续、Grok Build 两处语义变化；15 个渲染目标零变更。
> 共享块形态：`<!-- pi:shared:begin -->…<!-- pi:shared:end -->` 标记块，由 `project-init.mjs --sync-global` 按 `templates/gate-policy.json` 的 `global_targets` 幂等渲染。

## 落地总览

| 类别 | 工具 | 全局渲染目标（已入 gate-policy） | 状态 |
|---|---|---|---|
| ① | Codex | `~/.codex/AGENTS.md` | ✅ 已渲染 |
| ① | OpenCode | `~/.config/opencode/AGENTS.md`（全平台统一 `~/.config`，非 %APPDATA%） | ✅ 已渲染 |
| ① | Qwen Code | `~/.qwen/AGENTS.md`（QWEN.md 与 AGENTS.md 均自动加载，选 AGENTS.md 留 QWEN.md 给个人记忆） | ✅ 已渲染 |
| ① | Goose | `~/AppData/Roaming/Block/goose/config/AGENTS.md` | ✅ 已渲染 |
| ① | Aider | `~/.aider/CONVENTIONS.md`（**需接线**：`~/.aider.conf.yml` 写 `read: <绝对路径>`） | ✅ 已渲染，接线待安装 Aider |
| ② | Claude Code | `~/.claude/CLAUDE.md`（标记块；不用 `~/.claude/rules/` 以免被 Grok Build 兼容通道重复加载） | ✅ 已渲染 |
| ② | Cline | `~/Documents/Cline/Rules/pi-shared.md`（目录型；**Documents 被重定向的机器需改实际路径**） | ✅ 已渲染 |
| ② | Roo Code | `~/.roo/rules/pi-shared.md`（目录型整文件，天然幂等；官方 2026-05 归档，Zoo Code 分叉接续、路径不变） | ✅ 已渲染 |
| ② | Kilo Code | `~/.config/kilo/AGENTS.md`（标记块单文件） | ✅ 已渲染 |
| ③ | DeepSeek Harness | `~/.dsh/AGENTS.md` | ✅ 已渲染 |
| ③ | OpenHands | `~/.agents/skills/pi-shared.md`（纯 .md 无触发器即全文常载） | ✅ 已渲染 |
| ③ | Antigravity | `~/.gemini/GEMINI.md`（CLI 另读 `~/.gemini/AGENTS.md`） | ✅ 已渲染 |
| ③ | Grok Build | `~/.grok/rules/pi-shared.md`（目录型） | ✅ 已渲染 |
| ③ | SWE-agent | 无文件级注入点（仅 YAML 模板内嵌 + `--config`） | C 级，暂缓 |

项目级补齐：Claude Code 旧版不读项目 AGENTS.md（**2.1.277（2026-09-18）起新增原生回退支持**，见文末复查节），`project-init.mjs` bootstrap（`claude_sync` 开关）自动生成一行 `@AGENTS.md` 导入指针的 CLAUDE.md（已有 CLAUDE.md 一律不动；指针方案保留——兼容旧版、免配置、不受 /config 模式影响），CLAUDE.md 已纳入 git 禁传清单与全局/仓库 excludes。

## 一、①类：原生读取 AGENTS.md（gate-policy 增渲染目标即可）

### Codex CLI
- 全局：`~/.codex/AGENTS.md`（`CODEX_HOME` 可重定向；`AGENTS.override.md` 优先级更高）。层级：全局 → repo 根 → cwd，逐层合并，深层优先；全局上下文上限 32 KiB，超限截断。旧名 `instructions.md` 已废弃。
- 源码 `codex-rs/codex-home/src/instructions/mod.rs`：自动探测 `AGENTS.override.md` → `AGENTS.md`，无需 config 注册，空文件跳过。

### OpenCode
- 全局：`~/.config/opencode/AGENTS.md`。Windows 落点注意：源码用 `xdg-basedir`，全平台统一回退 `os.homedir()/.config`，**不是 %APPDATA%**。优先级：目录向上遍历的本地规则 > 全局文件 > `~/.claude/CLAUDE.md` 兜底。

### Qwen Code
- 最新版（≥0.22）默认上下文文件名数组 = `["QWEN.md", "AGENTS.md"]`（`memory-constants.ts`），全局层对每个名字各探测一次 `~/.qwen/<名>`，两个文件都自动加载；官方明示已有 AGENTS.md 的仓库无需重复。历史「只认 QWEN.md」的认知已过时。

### Goose
- 全局 hints：`%APPDATA%\Block\goose\config\.goosehints`（Windows 配置目录经 etcetera 解析）。源码 `load_hints.rs`：`CONTEXT_FILE_NAMES = [".goosehints", "AGENTS.md"]`，全局层自动加载 `<config_dir>/.goosehints`、`<config_dir>/AGENTS.md`、`~/.agents/AGENTS.md` 三处；项目层从 cwd 到 git root 逐级加载。需 Developer 扩展（默认启用），会话启动时加载，注入带 "### Global Hints" 标头。
- 注意：`~/.agents/AGENTS.md` 是 Goose/Cline 等多工具共同消费的「跨工具收敛位」，本仓**不选它**做渲染目标——否则 Cline 会同时加载自己的规则和该文件造成内容重复。

### Aider（异类：无自动全局指令）
- 无任何自动加载的全局指令文件。Conventions 经 `/read`、`--read` 或配置 `read:` 键加载；全局配置 `~/.aider.conf.yml`（搜索顺序 home → git 根 → cwd，后者优先）。
- **接线要点**：`read:` 必须写**绝对路径**——源码 `abs_root_path` 把相对路径解析到 git 根/cwd。渲染目标文件已就位（`~/.aider/CONVENTIONS.md`），接线动作：`~/.aider.conf.yml` 增 `read: C:\Users\<user>\.aider\CONVENTIONS.md`。

## 二、②类：自有指令文件（文件名映射渲染）

### Claude Code
- 全局：`~/.claude/CLAUDE.md`（单文件，官方机制未变）；另有官方 user-level rules 目录 `~/.claude/rules/*.md`。各层拼接不覆盖，项目规则优先。
- **AGENTS.md 原生支持（2026-09-18，2.1.277 新增；旧结论「不原生读取 AGENTS.md」作废）**：默认模式 `claude-md-or-agents-md` **纯回退、不合并**——仅当工作目录及所有父目录均无 CLAUDE.md / `.claude/CLAUDE.md` / CLAUDE.local.md 时才读项目 AGENTS.md；user 级 `~/.claude/CLAUDE.md`、managed 策略文件、`~/.claude/rules/` 不参与该判断、始终照常加载。`/config` → "Project instructions"（settings `pluginConfigs` 的 `agents-md@builtin`）可改 `claude-md-and-agents-md`（两者都读、CLAUDE.md 优先）/ `claude-md` / `managed-only`。不读 AGENTS.local.md、AGENTS.override.md、`.agents/` 目录；Bedrock/Vertex/Foundry 暂不支持（2.1.281 修复 Bedrock 加载）。
- 项目级映射（project-init 生成一行 `@AGENTS.md` 导入指针的 CLAUDE.md + CLAUDE.md 纳入禁传清单，已实现）**保留**：兼容 2.1.277 以下版本、免用户配置、不受 /config 模式影响，且默认纯回退语义下指针方案最稳。
- 目标选型：用 `~/.claude/CLAUDE.md` 标记块而**不用** `~/.claude/rules/`——Grok Build 会兼容加载 `~/.claude/rules/`，目录型会造成 Grok 侧双重加载。

### Cline
- 全局：`%USERPROFILE%\Documents\Cline\Rules\`（目录，递归读所有 .md/.txt，任意自命名文件自动加载）；同时读取跨工具位 `~/.agents/AGENTS.md`。项目级 `.clinerules\` 目录为主格式（3.7.0+）。
- **已原生读取 AGENTS.md**（项目根 + 全局 `~/.agents/AGENTS.md`），并自动探测 `.cursorrules`/`.windsurfrules`。Workspace 规则 > 全局规则。
- 注意：Windows 的 Documents 可能被重定向（本机为 `D:\Documents`），gate-policy 里用可移植的 `~/Documents/...` 并在 header 注明重定向机器需改实际路径。

### Roo Code
- 全局：`~/.roo/rules\`（+ 模式级 `rules-{modeSlug}`），目录递归、自命名 .md 自动加载。项目级目录 `.roo/rules/` 优先，`.roorules` 单文件仅在目录缺失/空时回退（勿写回退文件以免互斥）。
- **已原生读取 AGENTS.md**（工作区根，`roo-cline.useAgentRules` 可关）。所有适用目录全部加载，全局先、workspace 冲突优先。
- **官方仓库 2026-05-15 归档，社区分叉 Zoo Code 接续**（沿用 `~/.roo/` 全部路径与机制，详见文末复查节）——渲染目标不变，消费方由 Roo 自动变为 Zoo。

### Kilo Code
- 全局：`~/.config/kilo/AGENTS.md`（单文件标记块）；`kilo.jsonc` 的 `instructions` 数组可指向路径/glob/URL。
- **AGENTS.md 就是其首选机制**（项目根 + 父目录 findUp + 子目录按需注入），还兼容读 CLAUDE.md、CONTEXT.md；`.kilocode/rules/` 向后兼容自动包含。项目级完全免映射。

## 三、③类：平台/框架型（调研结论）

### DeepSeek Harness（`dsh`，官方开源，2026-08-13 v0.1 MIT）— A 级
- 全局：`~/.dsh/AGENTS.md`（`$DSH_HOME` / `dshHome` 可覆盖），agent-instructions 插件会话启动注入。项目级：项目根→cwd 的 AGENTS.md/CLAUDE.md 链 + `*.local.md` 覆盖层；预算 `maxBytes` 65,536。
- 配置键：`instructionFileCandidates`（默认 `['AGENTS.md','CLAUDE.md']`）、`projectRootMarkers` 等。

### OpenHands — A 级
- 全局：`~/.agents/skills/`（官方文档："place skills in ~/.agents/skills and OpenHands will always load them"；无触发器的纯 .md 全文常载）。**勿用 `~/.openhands/skills`**（会覆盖公共 skills 缓存）；Docker 需 `SANDBOX_VOLUMES` 挂载。
- 项目级：`<repo>/AGENTS.md` 全量进初始 system prompt（亦识别 CLAUDE/GEMINI.md）；`.agents/skills/<name>/SKILL.md`（frontmatter name+description 必填）；旧 `.openhands/microagents/` 仍兼容。

### SWE-agent — C 级（无文件级注入点）
- 唯一入口是 YAML 配置 + `--config`（可多个，嵌套合并）。系统提示是 `agent.templates.system_template` 等 **Jinja2 内联字符串**，不是文件指针；`TemplateConfig` 里仅 `demonstrations` 接受文件路径。
- 无用户级全局指令文件、无 per-repo 指令文件机制；对官方仓库 code search `AGENTS.md` 0 命中。接入只能把共享块内嵌进 YAML 模板文本，每次运行带 `--config`——性价比低，暂缓。

### Antigravity（Google）— A 级
- 全局：`~/.gemini/GEMINI.md`（Windows `%USERPROFILE%\.gemini`，CLI 明确 `~` 解析到 %USERPROFILE%），每会话全目录加载；CLI 亦加载 `~/.gemini/AGENTS.md`。全局 workflows 在 `~/.gemini/config/global_workflows/`。
- 项目级：`.agents/rules/*.md`（Always on / Glob / Model decision / Manual，单文件约 12k 字符上限，支持 `@file` 内联）；项目根 AGENTS.md/GEMINI.md 自动解析。

### Grok Build（xAI `grok` CLI，开源）— A 级
- 全局：`$GROK_HOME/rules/`（默认 `~/.grok/rules/`）下所有 `*.md`（不递归）任何项目恒载；兼容源 `~/.claude/rules/`、`~/.cursor/rules/`；`config.toml [paths] extra_rule_dirs` 可加目录；会话级 `--rules`/`--append-system-prompt`。
- 项目级：文档页名即 "Project Rules (AGENTS.md)"，根→cwd 逐级链（含 Agents.md/AGENT.md/CLAUDE.md 变体），每目录可加 `.grok/rules/`；遵循 .gitignore。`grok inspect` 可验证加载。

## 跨工具横切结论

1. **`~/.agents/` 是新兴跨工具收敛位**（Goose 全局 AGENTS.md、Cline 全局 AGENTS.md、OpenHands 全局 skills），但多工具同时消费同一文件会造成上下文重复——本仓坚持 per-tool 独立落点，收敛位仅作记录。
2. **Claude 系目录会被竞品兼容加载**（Grok 读 `~/.claude/rules/`），Claude 目标因此选 CLAUDE.md 单文件标记块。
3. **不读项目 AGENTS.md 的只剩 Aider**（走显式 `read:` 机制）。Claude Code 自 2.1.277（2026-09-18）起默认回退读项目 AGENTS.md（无 CLAUDE.md 时，纯回退不合并不二选），project-init 的 `@AGENTS.md` 导入指针仍保留（兼容旧版、免配置、不受 /config 模式影响）。
4. 接线新目标的标准动作：`gate-policy.json` 的 `global_targets` 增一项（path + create_if_missing + header）→ `project-init.mjs --sync-global` → 复跑一次确认「无变化」（幂等）。

## 2026-09-24 复查（窗口 2026-09-10 → 09-24，三通道并行）

> 总结论：**15 个全局渲染目标零变更，gate-policy 本轮无需修改**。有实质变动 3 家（Claude Code / Roo 归档接续 / Grok Build），小幅跟进 4 家，其余复核无变化。

### 有实质变动

**Claude Code（重大）**
- 2.1.277（2026-09-18，npm）新增 **AGENTS.md 原生支持**：默认 `claude-md-or-agents-md` 纯回退不合并——工作目录及所有父目录均无 CLAUDE.md / `.claude/CLAUDE.md` / CLAUDE.local.md 时才读项目 AGENTS.md；user 级 `~/.claude/CLAUDE.md`、managed 策略文件、`~/.claude/rules/` 不参与该判断、始终照常加载。
- `/config` → "Project instructions"（settings `pluginConfigs` 的 `agents-md@builtin`）可改 `claude-md-and-agents-md`（两者都读、CLAUDE.md 优先）/ `claude-md` / `managed-only`；不读 AGENTS.local.md、AGENTS.override.md、`.agents/` 目录；经 AGENTS.md 加载时 `InstructionsLoaded` hook 不触发、`--add-dir` 目录不加载、外部 `@` 导入需预批准；Bedrock/Vertex/Foundry 暂不支持（2.1.281 修复 Bedrock 加载，另修复 headless/SDK 会话 CLAUDE.md 与 rules 重复发送）。
- **对本仓的影响**：全局目标 `~/.claude/CLAUDE.md` 不变；project-init 的 `@AGENTS.md` 指针方案保留；正文旧表述已就地更正。

**Roo Code → Zoo Code（项目接续，机制未变）**
- 官方 RooCodeInc/Roo-Code 于 **2026-05-15 归档只读**（基线调研遗漏此事实，非窗口期变动）；社区分叉 **Zoo-Code-Org/Zoo-Code**（2026-04-23 创建，最新 v3.82.2 2026-09-18）接续，"same features, same settings, same license"，版本号延续 3.8x 序列。
- Zoo Code 仍用 `~/.roo/rules/`（未改 `.zoo`，全局规则目录位置固定不可自定义）；项目级 `.roo/rules/` 优先、`.roorules` 仅目录缺失/空时回退；工作区根 AGENTS.md（或 AGENT.md 单数）经 `useAgentRules` 启用（默认 true）。
- **对本仓的影响**：gate-policy `roo` 目标无需任何改动，消费方由 Roo 自动变为 Zoo。
- 备注：规则目录支持递归子目录约自 v3.38.3（第三方 changelog，未证实）；另有 `.clinerules` legacy 回退。

**Grok Build**
- 09-19（commit 4247f661）：文档化**嵌套 AGENTS.md**（子目录级 AGENTS.md、两遍处理；新增 `agents_md_tracker.rs` 解析追踪）——超出基线「项目级仅根→cwd 链」的范围。
- 09-22（commit 07e35a3）：**内置引导改经 user rules 通道注入**（"Route built-in guidance through user rules" + startup user rule）——全局 rules 的组合行为有变。
- `$GROK_HOME/rules/` 全局目标维持；`~/.claude/rules`、`~/.cursor/rules` 兼容加载与 rules 非递归两点本轮未复核，列入下次复查。

### 小幅跟进（机制不变，记录备查）

- **Cline**：v4.1.20（09-22，PR #14207）VSCode/Desktop/SDK 统一规则路径解析器，修复 Windows OneDrive「已知文件夹移动」重定向 Documents 时 Desktop/SDK 找不到全局规则——gate-policy cline 目标的重定向备注仍适用。另有全局别名 `~/.cline/rules`、`~/Cline/Rules` 与项目级 `.cline/rules/`（窗口期前已存在，基线未覆盖）。
- **Antigravity**：2.11.0（9 月）AGENTS.md 与规则文件新增 `@path/to/file` 内联引用语法（可绕 12k 单文件上限）——来源为 releasebot.io / gradually.ai 二手，官方 changelog 原文待证。
- **Kilo Code**：仓库改名 `Kilo-Org/kilocode`（旧址 404）、域名 kilocode.ai 308 → kilo.ai；v7.6.0（09-10）新增 opt-in 一次性 Claude Code Migration 导入。加载机制不变。
- **Codex**：官方文档迁 developers.openai.com/codex/agents-md（仓库 `docs/config.md` 成跳转页）；加载机制不变。
- **dsh**：v0.1.5 → v0.1.7-rc.1（09-23）高频迭代；插件管理器支持运行时装卸、settings 迁入 Profile——外围变动，`~/.dsh/AGENTS.md` 加载语义不变，升 v0.1.7 正式版时回归验证。
- **OpenHands**：仓库更名 `OpenHands/OpenHands`（原 All-Hands-AI 重定向）、文档站迁 docs.openhands.dev 并重构目录；`~/.agents/skills/` 与 AGENTS.md 机制不变。

### 无变化（复核确认）

- ①类 5 工具：Codex 0.156.1（09-23）、OpenCode v1.18.32（09-21）、Qwen Code v0.24.4（09-22）、Goose v1.52.0（09-23；goosehints 相关最近变动为 v1.46.0（08-12）/ v1.49.0（09-03），均在基线内）、Aider（窗口期零发布，仍无 AGENTS.md/自动加载，feature request #4363 仍 open → **ROAD-20 维持待人工**）。
- Gemini CLI：v0.59.0 → v0.62.0-preview 全部 release notes 无 GEMINI.md/AGENTS.md 相关条目（release notes 层面核实，文档页未逐页复核）。
- **SWE-agent**：v1.1.0（2025-05-22）后全年无 release、main 分支 09-10 后零提交、AGENTS.md 相关 issue 0 命中 → **ROAD-21 维持暂缓**；下次复查点设在其下一 minor release 或 maintainer 相关 RFC 出现时。
- 生态扫描：Ona 现身 agents.md 官网采纳列表（采纳时间未证）；Cursor CLI / Crush / Forge / Continue / Trae 未见新支持信号（搜索受限流影响，未见信号 ≠ 无变动）。

### 来源（2026-09-24 复查新增）

- Claude Code: github.com/anthropics/claude-code `CHANGELOG.md`（2.1.277 / 2.1.281）· code.claude.com/docs/en/memory · registry.npmjs.org/@anthropic-ai/claude-code · github.com/anthropics/claude-code/issues/6235
- Roo/Zoo: api.github.com/repos/RooCodeInc/Roo-Code（archived:true，pushed_at 2026-05-15）· github.com/Zoo-Code-Org/Zoo-Code/releases · docs.zoocode.dev/features/custom-instructions · zoocode.dev
- Grok Build: api.github.com/repos/xai-org/grok-build/commits（4247f661 = 09-19、07e35a3 = 09-22）· docs.x.ai/build/settings
- Cline: github.com/cline/cline `CHANGELOG.md` · docs.cline.bot/features/cline-rules · github.com/cline/cline/pull/14207
- Antigravity: antigravity.google（2.11.0 @path 内联为二手来源：releasebot.io、gradually.ai）
- Kilo: api.github.com/repos/Kilo-Org/kilocode（及 /releases）· kilo.ai/docs/features/custom-instructions
- Codex: github.com/openai/codex/releases · developers.openai.com/codex/agents-md（learn.chatgpt.com 镜像）
- dsh: api.github.com/repos/deepseek-ai/deepseek-harness/releases · 其 master `docs/config-catalog.md`
- OpenHands: docs.openhands.dev/overview/skills · api.github.com/repos/All-Hands-AI/OpenHands/releases
- SWE-agent: api.github.com/repos/SWE-agent/SWE-agent（releases / commits?since=2026-09-10 / issue 搜索 AGENTS.md 0 命中）
- 生态: agents.md · ona.com/docs/ona/agents-md

## 来源（节选）

- Codex: developers.openai.com/codex/guides/agents-md · github.com/openai/codex `docs/agents_md.md`、`codex-rs/codex-home/src/instructions/mod.rs`
- OpenCode: opencode.ai/docs/rules · github.com/anomalyco/opencode `packages/core/src/global.ts` · github.com/sindresorhus/xdg-basedir
- Qwen Code: qwenlm.github.io/qwen-code-docs/en/users/features/memory · github.com/QwenLM/qwen-code `memory-constants.ts`、`memoryDiscovery.ts`
- Goose: block.github.io/goose/docs/guides/context-engineering/using-goosehints · docs/guides/config-files · github.com/block/goose `load_hints.rs`、`paths.rs`
- Aider: aider.chat/docs/usage/conventions.html · docs/config/aider_conf.html · github.com/Aider-AI/aider `base_coder.py`
- Claude Code: code.claude.com/docs/en/memory · docs/en/claude-directory
- Cline: docs.cline.bot/customization/cline-rules（经 github.com/cline/cline 文档源码逐字核实）
- Roo Code: roocodeinc.github.io/Roo-Code/features/custom-instructions（docs.roocode.com 现址）
- Kilo Code: kilo.ai/docs/customize/custom-rules · custom-instructions · custom-modes
- DeepSeek Harness: deepseek.com/harness/en · github.com/deepseek-ai/deepseek-harness（`packages/context/agent-instructions`）
- OpenHands: docs.openhands.dev/overview/skills（org / repo）
- SWE-agent: swe-agent.com/latest/config/config · reference/template_config · github.com/SWE-agent/SWE-agent
- Antigravity: antigravity.google/docs/rules-workflows · docs/cli/configuration · docs/cli/gcli-migration（多源交叉验证）
- Grok Build: github.com/xai-org/grok-build（user-guide 05-configuration、12-project-rules）· docs.x.ai/build/overview
