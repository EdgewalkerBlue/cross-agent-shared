# Harness 指令注入点调研（14 项路线图 · 2026-09-16）

> 结论支撑 `.pi/task_set.json` ROAD-01～ROAD-14 的落地与后续接线任务。
> 调研方式：官方文档 + 源码交叉核对（三个并行调研通道，截至 2026-09 最新版本）。
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
| ② | Roo Code | `~/.roo/rules/pi-shared.md`（目录型整文件，天然幂等） | ✅ 已渲染 |
| ② | Kilo Code | `~/.config/kilo/AGENTS.md`（标记块单文件） | ✅ 已渲染 |
| ③ | DeepSeek Harness | `~/.dsh/AGENTS.md` | A 级，待接线 |
| ③ | OpenHands | `~/.agents/skills/pi-shared.md`（纯 .md 无触发器即全文常载） | A 级，待接线 |
| ③ | Antigravity | `~/.gemini/GEMINI.md`（CLI 另读 `~/.gemini/AGENTS.md`） | A 级，待接线 |
| ③ | Grok Build | `~/.grok/rules/pi-shared.md`（目录型） | A 级，待接线 |
| ③ | SWE-agent | 无文件级注入点（仅 YAML 模板内嵌 + `--config`） | C 级，暂缓 |

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
- **不原生读取 AGENTS.md**（官方原文 "Claude Code reads CLAUDE.md, not AGENTS.md"），workaround 是 CLAUDE.md 里写 `@AGENTS.md` 导入。→ 项目级映射（每个项目引导一行 `@AGENTS.md` 指针 CLAUDE.md + 把 CLAUDE.md 纳入禁传清单）已登记为后续任务。
- 目标选型：用 `~/.claude/CLAUDE.md` 标记块而**不用** `~/.claude/rules/`——Grok Build 会兼容加载 `~/.claude/rules/`，目录型会造成 Grok 侧双重加载。

### Cline
- 全局：`%USERPROFILE%\Documents\Cline\Rules\`（目录，递归读所有 .md/.txt，任意自命名文件自动加载）；同时读取跨工具位 `~/.agents/AGENTS.md`。项目级 `.clinerules\` 目录为主格式（3.7.0+）。
- **已原生读取 AGENTS.md**（项目根 + 全局 `~/.agents/AGENTS.md`），并自动探测 `.cursorrules`/`.windsurfrules`。Workspace 规则 > 全局规则。
- 注意：Windows 的 Documents 可能被重定向（本机为 `D:\Documents`），gate-policy 里用可移植的 `~/Documents/...` 并在 header 注明重定向机器需改实际路径。

### Roo Code
- 全局：`~/.roo/rules\`（+ 模式级 `rules-{modeSlug}`），目录递归、自命名 .md 自动加载。项目级目录 `.roo/rules/` 优先，`.roorules` 单文件仅在目录缺失/空时回退（勿写回退文件以免互斥）。
- **已原生读取 AGENTS.md**（工作区根，`roo-cline.useAgentRules` 可关）。所有适用目录全部加载，全局先、workspace 冲突优先。

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
3. **仅 Claude Code 与 Aider 不读项目 AGENTS.md**：前者用 `@AGENTS.md` 导入指针即可低成本补齐（已登记任务）；后者本来就走显式 `read:` 机制。
4. 接线新目标的标准动作：`gate-policy.json` 的 `global_targets` 增一项（path + create_if_missing + header）→ `project-init.mjs --sync-global` → 复跑一次确认「无变化」（幂等）。

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
