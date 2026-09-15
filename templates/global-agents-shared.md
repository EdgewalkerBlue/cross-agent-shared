<!-- pi:shared:begin -->
<!-- 本区块由 `node ~/.pi/agent/bin/project-init.mjs --sync-global` 渲染到各 Agent 的全局指令文件；请勿手改本区块内部，改动一律改模板源：~/.pi/agent/templates/global-agents-shared.md -->

# AI 代码可维护性门禁（全局，适用于 Pi / ZCode / WorkBuddy 等全部 Agent）

## 定位与适用范围

- **目的**：AI 高频生成代码会持续积累技术债（重复实现、平行抽象、错误掩盖）。本门禁强制"先理解、先复用、不藏错、后验证"。
- **适用**：Pi Agent、ZCode Agent、WorkBuddy（CodeBuddy 内核）、以及任何 SubAgent。会话仍保持**永久隔离**；共享上下文为 `AGENTS.md` + 项目 `.pi/task_set.json`。
- **依据**：GitClear 2026 Maintainability Gap（重构/搬移代码占比下降、复制与错误掩盖上升）。仅作为门禁依据，**不作为运行时指标或因果结论**。

## 六条原则

1. **Understand Before Modify** — 改前先读懂现有实现与调用关系。
2. **Reuse Before Create** — 能复用不复刻。
3. **Extend Before Duplicate** — 能扩展不另起一套。
4. **Refactor When Scope Requires** — 在任务范围内改造，而非平行实现。
5. **Do Not Hide Failures** — 绝不隐藏错误、弱化校验、绕过检查来制造"绿"。
6. **Verify Before Complete** — 未验证不得宣布完成。

## 强制工作流（状态机）

```
discovery → reuse_decision → implementation → maintainability_gate → verification → completion
```

**转移规则**：只有 `maintainability_gate` 与 `verification` 全部通过，任务才可进入 `completion`。

### MCG-001 现有实现检索（discovery，P0）
- 定位相关文件、模块、接口。
- 检索是否存在等价或相近行为的既有实现。
- 检视相关调用方、依赖、共享工具。
- **实现前必须先读适用的 `AGENTS.md`。**

### MCG-002 复用决策（reuse_decision，P0）
决策顺序**不可颠倒**：`reuse_existing` → `extend_existing` → `refactor_existing` → `create_new`。
若选择新建，必须记录"为何不能复用/扩展/重构"。

### MCG-003 最小必要变更（implementation，P0）
- 变更限定在任务范围内。
- 优先沿用项目既有抽象与约定。
- 已有可复用逻辑时禁止复制粘贴。
- 不做与任务无关的大范围清理。

### MCG-004 重复代码检查（maintainability_gate，P0）
- 检索本次新增逻辑是否与既有代码重叠。
- 检查是否重复造了工具函数、校验器、解析器、组件、服务、适配器。
- 检查新代码是否绕过了既有共享抽象。
- 若**故意**重复，必须记录理由。

### MCG-005 错误掩盖门禁（maintainability_gate，P0）
**绝对禁止**（forbidden_patterns）：
`swallow_exceptions`、`empty_catch_blocks`、`silent_failure`、`disabled_tests`、
`bypassed_type_checks`、`weakened_validation_for_green_build`、`suppressed_meaningful_errors`。

- 检视本次改动的错误处理路径。
- 失败必须保持**可观测**（除非项目规则明确另有定义）。
- 确认测试/检查**不是**为了通过而被禁用或削弱。

### MCG-006 依赖与接口一致性（maintainability_gate，P1）
- 检视受影响的调用方与消费方。
- 验证接口/API 兼容性。
- 确认新实现正确接入既有模块。
- 检查是否产生不必要的平行 API。

### MCG-007 验证（verification，P0）
必须执行（项目适用时）：相关测试、类型检查、lint/静态分析、构建/打包、**最终 diff 复查**、新增重复代码复查。
- **缺工具算 verification gap，不等于通过**，必须显式记录。

### MCG-008 结果回写（completion，P0）
把结果写入本项目 `.pi/task_set.json`，字段见下方 `agent_result_schema`。

## 完成策略（completion_policy）

- **must_pass**：`existing_code_searched`、`reuse_considered`、`final_diff_reviewed`。
- **must_not_be_true**：`error_suppression_introduced`。
- **conditional_checks**：`tests_passed` / `typecheck_passed` / `lint_passed` / `build_passed` —— 项目提供或被改代码使其适用时**必须**执行；缺工具记 gap，不得自动视为通过。

## 统一回报结构（agent_result_schema）

```json
{
  "changed_components": [], "reused_components": [], "refactored_components": [],
  "new_abstractions": [], "intentional_duplications": [],
  "verification": { "tests": [], "typecheck": null, "lint": null, "build": null, "other_checks": [] },
  "risks": [], "technical_debt": [], "final_status": "pending"
}
```

`maintainability_check` 字段（写入任务项）：
`existing_code_searched` / `reuse_considered` / `reuse_decision` / `duplicate_logic_introduced` /
`intentional_duplication(+_reason)` / `error_suppression_introduced` / `dependency_check_completed` /
`final_diff_reviewed` / `tests_passed` / `typecheck_passed` / `lint_passed` / `build_passed` /
`verification_gaps` / `technical_debt` / `unresolved_risks`。
模板：`~/.pi/agent/templates/maintainability_check.json`、`~/.pi/agent/templates/agent_result.json`。

## 非目标（non_goals）

- 不因任务改动了既有代码就**强制重构**。
- 不做无关清理。
- 不为"代码行数更少"牺牲清晰度或正确性。
- 不把 GitClear 研究当作运行时命令或普适因果律。

---

# 无人值守执行守则（unattended_loop，全局强制）

- **适用**：任何 Agent 在无人值守模式下执行项目任务集（`.pi/task_set.json`）时。
- **可自动执行判据**：任务不依赖人工测试、人工审核、人工加需求（无任何人类输入依赖），且其验证手段（测试/类型检查/lint/构建）可由 Agent 自行运行判定。
- **人工依赖标记**：任务标题/说明含「需人工」「待人审」「人工测试」「等确认」「待加需求」等字样，或依赖外部输入（账号、密钥、采购、业务决策）→ 一律视为**不可自动执行**。
- **循环协议**：
  1. 每轮任务执行完成并按 MCG-008 回写 `.pi/task_set.json` 后，**重新读取回流后的 task_set.json**（不得凭内存判断剩余任务）；
  2. 筛出可自动执行任务 → 按 P 级从高到低取下一项执行，完成后回到步骤 1；
  3. 无可自动执行任务 → **立即暂停循环**，转终止报告。
- **全完成后终审**：循环结束时审核**最终回流后的 task_set.json**——确认无遗漏可自动执行项、剩余项均已标注人工依赖类型、回写内容与实际结果一致。
- **终止报告**（无人值守会话结束前必须输出）：
  1. 已自动完成任务清单（每项含验证结果 / verification gaps）；
  2. 被熔断/截断任务（触发原因、恢复状态、遗留问题）；
  3. 未完成待人审清单（每项注明卡在哪类人工依赖：人工测试 / 人工审核 / 人工加需求 / 其他输入）。
- **安全约束**：
  1. loop 内每项任务仍须走完整 MCG 状态机，门禁与验证不得因无人值守而跳过或削弱；
  2. 熔断兜底：单项累计修改超 20 处仍未完成、或连续 5 次编译/构建/测试失败 → 停止该项、标记「已截断/待人工处理」、跳下一项；
  3. 危险/不可逆操作（删除数据、强制推送、对外发布、生产环境变更）**禁止**在无人值守下自动执行，一律标记待人审。

---

# 项目 AGENTS.md 强制（新建项目必做）

- **任何新建项目，项目根必须有 `AGENTS.md`**，与 `.pi/task_set.json` 一同创建（首次落地代码之前）。
- **创建方式（全自动）**：
  ```bash
  node ~/.pi/agent/bin/project-init.mjs "<项目路径>"
  ```
  或依赖全局 git hook / Pi 扩展自动触发；新建项目探测后自动生成骨架。
- **必含 6 项**：
  1. 项目定位与范围
  2. 目录/模块地图（≤15 行，自动区）
  3. 共享抽象与复用清单（含"禁止平行实现什么"）
  4. 验证命令（test / typecheck / lint / build 实际命令行，自动区）
  5. 项目特有错误处理与禁区
  6. 任务集回写要点
- 内容**从标准骨架派生，只填项目事实**，不得照抄本全局通用原则。
- **缺失即视为 MCG-001 未通过**，不得进入 `implementation`。
- **跨 Agent 一致性**：`AGENTS.md` 为唯一项目契约。WorkBuddy 读取顺序为 `CODEBUDDY.md` → `.codebuddy/CODEBUDDY.md` → `AGENTS.md`（命中即止、不合并），故存在 `CODEBUDDY.md` 的项目由生成器**同步写入**（保持内容一致）。WorkBuddy 对项目指令有 **8000 字符硬截断**，因此关键区必须前置。
- **门禁自检**（任何 Agent 可执行）：
  ```bash
  node ~/.pi/agent/bin/project-init.mjs --check "<项目路径>"   # 严格模式违反 → exit 1
  ```
  规则见 `~/.pi/agent/templates/gate-policy.json`。

---

# SubAgent 共用（跨 Agent，唯一实现）

- **唯一实现**：Pi 的子 Agent 定义（`~/.pi/agent/agents/*.md` + 项目 `.pi/agents/*.md`）。
- **ZCode / WorkBuddy / 其他 Agent 不得另造 SubAgent 体系**，一律调用同一个入口（PATH 无关，推荐）：
  ```bash
  ~/.pi/agent/bin/pi-subagent --list
  ~/.pi/agent/bin/pi-subagent --agent coder --task "<任务>" --cwd "<项目路径>"
  ```
  Windows `cmd` 下用 `%USERPROFILE%\\.pi\\agent\\bin\\pi-subagent.cmd`；等价于 `node ~/.pi/agent/bin/subagent-cli.mjs`。
- 共用同一份：agent 定义、模型时段轮换（`extensions/tools/subagent/rotation.json`）、守卫参数（`extensions/tools/subagent/config.json`：成本上限 / 超时 / 禁用工具 / 危险命令拦截）。
- 主模型失败自动切保底模型；`--json` 输出结构化结果（agent / model / exitCode / cost / text / error）。
- Agent 发现逻辑在 `extensions/tools/subagent/agents-core.mjs`（纯 Node ESM），Pi 扩展与 CLI **共用同一模块**，禁止各自实现遍历。

## Agent 选型与格式约束（实测）

| Agent | 定位 | 适用 | 不适用 |
|---|---|---|---|
| `thinker` | 高思考·需求拆解 | 拆 DAG、方案设计 | **格式严格的产出** |
| `reasoner` | 高思考·根因分析 | 失败日志定位、修复建议 | 格式严格的产出 |
| `coder` | 执行型 | 代码修改、**严格格式化执行** | — |
| `navigator` | 工具型 | 路线/地理数据 | — |

**硬结论（实测）**：同一任务「只输出字符串 OK 本身，不要任何其他字符」，`thinker` 返回 `好的`（格式漂移），`coder` 返回 `OK`。高思考型 agent 对“字数 / 固定措辞”这类格式约束**不敏感**，只靠任务描述约束不可靠。

**强制做法**：任何格式要求必须用 `--expect <正则>` 做机器校验（不匹配 → exit 1），不得只靠提示词：

```bash
pi-subagent --agent coder --task "只输出字符串 OK 本身，不要任何其他字符" --expect '^OK$' --json
```

断言失败（`expectPassed: false`，退出码 1）即该次派发失败，应重试或换 agent；**不得把“看起来对”当作通过**（MCG-007）。

**根因（已定位）**：高思考型 agent 的 system prompt 自带强制格式（如 `agents/thinker.md`：“你的唯一产出是任务拆解方案”+ 固定 markdown 模板），与“只回复 N 个字”直接冲突，模型在两条指令间摇摆 → 这就是格式漂移的来源，**不是链路故障**。因此严格格式任务必须换 `coder`，并始终加机器断言。

**断言语义（避坑）**：

- `--expect` **默认整段锚定**（正则不带 `m`）：`^OK$` 要求**整段输出**就是 `OK`；需要逐行匹配时才加 `--expect-multiline`。
- **JS 正则没有 `\A` / `\z` 锚点**：写成 `\AOK\z` 会被当字面量→**恒不匹配**（不是“更严格”，而是“永远失败”）。要整段严格相等就用 `^...$`（不加 `-multiline`）。
- **未传 `--expect` 时 `expectPassed` 为 `null`（不是 `true`）**：不得把 `null` 读作“已校验通过”。

**测试必须固定版本**（否则前后结果不可比）：

```bash
pi-subagent --version        # 输出 version(文件 sha256 前 12 位) + mtime
pi-subagent --list --json    # JSON 里带 cli.version / cli.mtime
```

派发结果的 JSON 也包含 `cli` 字段；记录它再做前后对比。测试期间若 CLI 版本变了，该组对比作废。

## 共用自检（怎么测，任何 Agent 可照做）

**三步自检**（把下面命令交给 ZCode / WorkBuddy 执行；它们 PATH 与 Pi 不同，**一律用绝对路径**）：

```bash
1) 全局指令是否加载：让它读本文件（~/.pi/agent/AGENTS.md 或 ~/.zcode/AGENTS.md），原样答出“SubAgent 共用”章节的命令。
2) 入口是否可用（无需 API）： %USERPROFILE%\.pi\agent\bin\pi-subagent.cmd --list
3) 真实派发（验完整链路）： %USERPROFILE%\.pi\agent\bin\pi-subagent.cmd --agent thinker --task "只回复四个字：链路已通" --json
```

预期：步骤 2 列出 `coder / navigator / reasoner / thinker`（各 Agent 输出**完全一致**）；步骤 3 返回 `"exitCode": 0` 且 `text` 为预期内容，`cost` 有值。

**判定共用成立的 4 个标准**：

| 检查点 | 通过标准 |
|---|---|
| 同一份 Agent 定义 | 各 Agent 的 `--list` 输出完全一致 |
| 同一份守卫与轮换 | 改 `extensions/tools/subagent/config.json`（如超时）后，各 Agent 行为同时变化 |
| 不另造体系 | ZCode / WorkBuddy 内搜不到自建的 subagent 实现 |
| 项目级 Agent 可见 | `--cwd "<含 .pi/agents 的项目>" --list --json` 的 `projectAgentsDir` 有值 |

**失败排查**：

| 现象 | 处理 |
|---|---|
| `node 不是内部或外部命令` | 用了裸 `node`；改用 `pi-subagent.cmd` / `pi-subagent` 绝对路径 |
| `--list` 为空 | 确认 `~/.pi/agent/agents/*.md` 存在；或加 `--scope user` |
| 429 / 配额报错 | 已自动切保底模型；仍失败看 `extensions/tools/subagent/rotation.json` |
| 派发卡住 | `--timeout 5` 缩短超时；成本上限见 `config.json` 的 `costLimitPerTask` |
| WorkBuddy bash 报 `dirname: command not found` / `cd: null directory` | **不要覆盖 `PATH`**（会丢核心命令）；只换 node 绝对路径 |
| WorkBuddy 中 bash 调 `cmd.exe` / `powershell` 被安全策略拦截 | 改用 sh 包装器 `~/.pi/agent/bin/pi-subagent`，或绝对路径直调 `$HOME/AppData/Local/pi-node/current/node.exe` |
| WorkBuddy 终端退出码 0 但拿不到 stdout | 重定向到文件再读（`> out.txt`），读完删临时文件 |
| WorkBuddy 看不到 skill | 在设置 → Skills 启用 user-level skill `pi-agent-shared-tools`（`~/.workbuddy/skills/pi-shared/SKILL.md`），必要时重启应用 |
| ZCode 原生子代理不读项目契约 | 在 ZCode 子代理设置里勾选 `injectAgentsMd` |

---

# 模型链与主模型回退

## 子 Agent（per-agent 模型链）

- 配置：`~/.pi/agent/extensions/tools/subagent/rotation.json` → `agents.<name> = [模型1, 模型2, …]`（从高到低）。
- 行为：主模型 429/配额/服务异常 → **按链依次自动重试**，直到成功或用尽；链的解析在 `subagent/models-core.mjs`，Pi 的 subagent 扩展与 `pi-subagent` CLI **共用同一实现**。
- 查看：`pi-subagent --list`（列出每个 Agent 的链）或 `/rotation`。
- 当前链：thinker `glm-5.3 → glm-5.3-flash → deepseek-flash`；coder `glm-5.3-flash → glm-5.3 → deepseek-flash`；reasoner `glm-5.3 → glm-5.3-flash → deepseek-flash`；navigator `glm-5.3-flash → deepseek-flash`。

## 主会话（启动模型 + 故障回退）

- 启动模型：`~/.pi/agent/settings.json` 的 `defaultProvider` / `defaultModel`（当前 `zai-coding-cn` / `glm-5.3-flash`）。
- 自动回退：扩展 `automation/model-fallback.ts`，配置 `automation/model-fallback.json`：
  - `after_provider_response` 命中 `triggerStatuses`（429/5xx）→ 按 `chain` 切到下一个模型；
  - `session_start` 冷却结束后回到 `primary`（**仅当上次是本扩展切走的状态**，绝不覆盖 `--model` 显式选择）；
  - 命令：`/model-fallback` 查看，`/model-fallback next` 手动切下一个，`/model-fallback reset` 回主模型。

## 避坑（血泪教训）

- **模型 id 必须真实存在**：以 `pi --list-models` 为准（如 `deepseek/deepseek-flash`）。请求一个不存在的 id（如 `deepseek/deepseek-v4.1-flash-expires-on-0910`）会被**静默回退**到默认模型，报错表现成默认模型的错误，极易误判为“配额用完”。
- **`aliases`**：rotation.json 支持简写映射（`deepseek-flash` → `deepseek/deepseek-flash`），避免各处写全 id。
- **别在 session_start 无条件切模型**：会抹掉调用方（subagent `--model`、CLI `--model`）的显式选择；回退扩展必须基于状态判断。
- **报告要分“请求模型”与“实际模型”**：子 Agent 结果里 `requestedModel` 与 `model`/`provider` 分开，否则会把“跑在另一个模型上”误判成“请求成功”。

# 上传卫生（GitHub 建仓 / 推送 / 合并，强制）

- **禁传清单**：`.pi/`（**除 `task_set.json` 外**）、`.zcode/`、`AGENTS.md`、`CODEBUDDY.md`（本地契约 + 私有数据，不入库、不推送）。
- **例外**：`.pi/task_set.json` 随项目分发（与项目绑定）**必须上传**；因此忽略规则写成 `.pi/*` + `!.pi/task_set.json`（**不能**写 `.pi/`，父目录被排除后无法再包含子文件）。
- **三重保障**（由 `project-init.mjs` 自动安装，勿手工拆除）：
  1. 全局 `core.excludesFile` → `~/.pi/agent/templates/git-exclude-global.txt`（对所有仓库生效）；
  2. 各仓库 `<git-dir>/info/exclude` 同名区块（本地生效、不入库）；
  3. 全局 `pre-commit` 拦截暂存区（防 `git add -f` 绕过），`pre-push` 拦截已被跟踪的禁传文件（防推送）。
- **自检与修复**（任何 Agent 可执行；`pi-project` 等价于 `node ~/.pi/agent/bin/project-init.mjs`）：
  ```bash
  ~/.pi/agent/bin/pi-project "<项目>" --guard-staged        # 暂存区有禁传文件 → exit 1
  ~/.pi/agent/bin/pi-project "<项目>" --guard-push          # 有被跟踪的禁传文件 → exit 1（推送前）
  ~/.pi/agent/bin/pi-project "<项目>" --untrack-forbidden   # 已跟踪的禁传文件移出索引（本地文件保留）
  ```
- **建仓 / 首次推送 / 合并到主分支前，必须先跑一次 `--untrack-forbidden`**：仅靠 ignore 无法阻止已被跟踪的文件上传。

<!-- pi:shared:end -->
