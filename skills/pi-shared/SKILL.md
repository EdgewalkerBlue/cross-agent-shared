---
name: pi-agent-shared-tools
description: >
  共享 Pi 的能力入口：① 派发子 Agent（SubAgent，唯一的 subagent-cli 实现，不要另造）；
  ② 上传卫生（.pi/ .zcode/ AGENTS.md CODEBUDDY.md 一律不上传）；③ 无人值守执行守则
  （无人值守/自动循环/批量执行项目任务集 task_set.json 时：无人工依赖的任务全自动
  loop 执行，每轮回写后重读任务集，无可自动执行任务即暂停并输出报告）。当需要委派
  子任务、多 Agent 并行/串行协作、根因分析、需求拆解，在无人值守模式下自动执行
  任务集，或在 git 建仓、提交、推送、合并前检查"会不会把本地契约文件传上 GitHub"
  时使用本 skill。
description_en: >
  Shared entry to Pi's capabilities: dispatch subagents via the single subagent-cli
  implementation; enforce upload hygiene (.pi/, .zcode/, AGENTS.md, CODEBUDDY.md must
  never be pushed); and follow the unattended-loop protocol (auto-execute task_set.json
  items with no human dependency, re-read the task set after each round, pause and
  report when nothing auto-executable remains). Use before delegating work, when
  running task sets unattended, or before git init/push/merge.
---

# Pi 共享能力（WorkBuddy 侧调用约定）

本 skill 不实现任何逻辑，只转发到 Pi 的统一实现，避免多套平行体系（AI 代码可维护性门禁 MCG-002/004）。

## 0. 调用环境注意（本机实测，务必遵守）

- **不要设置或覆盖 `PATH`**：WorkBuddy 的 bash 依赖自身 PATH 提供 `dirname` / `cd` 等基础命令；一旦覆盖 PATH，会出现 `dirname: command not found`、`cd: null directory`，后续命令全部失效。需要指定解释器时**只换 node 路径，不动 PATH**。
- **避免经 `cmd.exe` / `powershell` 中转**：WorkBuddy 安全策略会拦截 bash → `cmd.exe` / `powershell` 的调用，因此 `.cmd` 包装器从 bash 里调可能被拦。bash 环境下使用 **sh 包装器**或**绝对路径直调 node**：
  ```bash
  ~/.pi/agent/bin/pi-subagent --list          # sh 包装：直接 exec node.exe，不经 cmd.exe
  # 等价直调：
  "$HOME/AppData/Local/pi-node/current/node.exe" "$HOME/.pi/agent/bin/subagent-cli.mjs" --list
  ```
- **stdout 抓不到时用文件中转**：若命令退出码 0 但终端工具拿不到输出，改为重定向到文件（`> out.txt`），再用文件读取工具读取，**读完删除临时文件**。
- **只用绝对路径**：不依赖 `node` / `pi` 出现在 PATH 上；`pi-subagent` / `pi-project` 包装器内部已自带 node 路径解析，无需调用方设置环境变量。
- 长任务请后台执行并轮询输出，不要阻塞单个对话轮次。

## 1. 子 Agent 派发（唯一实现：`~/.pi/agent/bin/subagent-cli.mjs`）

先看有哪些 Agent（定义来自 `~/.pi/agent/agents/*.md` 与项目 `.pi/agents/*.md`）：

```bash
# bash / git-bash（WorkBuddy 环境推荐；不经 cmd.exe）
~/.pi/agent/bin/pi-subagent --list
~/.pi/agent/bin/pi-subagent --agent coder --task "<任务描述>" --cwd "<项目路径>"

# Windows cmd / PowerShell（仅在外层终端可用时）
%USERPROFILE%\.pi\agent\bin\pi-subagent.cmd --list
```

（等价写法：`node ~/.pi/agent/bin/subagent-cli.mjs ...`；入口自身会挑对 node，不受 WorkBuddy/ZCode 自带 node 版本影响。）

要点：

- 可选参数：`--scope user|project|both`（默认 both）、`--model <id>`、`--timeout <分钟>`、`--json`（结构化输出）、`--expect <正则>`（**格式断言**）、`--allow-dangerous`（放行危险命令拦截，默认不放行）。
- 守卫参数与模型时段轮换由 Pi 侧统一配置：`~/.pi/agent/extensions/tools/subagent/{config.json,rotation.json}`；不要在 WorkBuddy 侧复制一份。
- 主模型配额/失败会自动切换到保底模型；`--json` 返回 `agent/model/exitCode/cost/text/error`。
- 典型用法：`thinker` 做需求拆解 → `coder` 实现 → `reasoner` 分析失败日志。

### 模型链（自动回退，无需手动指定）

每个 Agent 在 `~/.pi/agent/extensions/tools/subagent/rotation.json` 里有模型链，主模型 429/配额/故障时**自动按链重试**：

| Agent | 链 |
|---|---|
| thinker | `glm-5.3` → `glm-5.3-flash` → `deepseek-flash` |
| coder | `glm-5.3-flash` → `glm-5.3` → `deepseek-flash` |
| reasoner | `glm-5.3` → `glm-5.3-flash` → `deepseek-flash` |
| navigator | `glm-5.3-flash` → `deepseek-flash` |

- 查看：`~/.pi/agent/bin/pi-subagent --list`（每行显示链）；显式 `--model` 会覆盖链首。
- 结果 JSON 中 `requestedModel` 是请求值，`model`/`provider` 是**实际使用**的模型（务必看后者）。
- 模型 id 必须真实存在（以 `pi --list-models` 为准），否则会被静默回退到默认模型。

### 选型与格式约束（实测，务必遵守）

- `thinker` / `reasoner` 是**高思考型**，对“字数 / 固定措辞 / 只输出 X”这类格式约束**不敏感**；需要严格格式的产出改用 **`coder`**。
- 实测：同一任务「只输出字符串 OK 本身，不要任何其他字符」，`thinker` 返回 `好的`，`coder` 返回 `OK`。
- **不得只靠任务描述约束格式**：必须加 `--expect <正则>` 机器校验，失败（`expectPassed: false`，退出码 1）即视为该次派发失败，重试或换 agent。
- **根因**：`thinker.md` 等 system prompt 写死“唯一产出是任务拆解方案 + 固定模板”，与“只回复 N 字”直接冲突 → 模型摇摆产生格式漂移（不是链路故障）。
- **断言语义**：`--expect` 默认**整段锚定**（无 `m`）；逐行匹配用 `--expect-multiline`；**JS 无 `\A`/`\z` 锚点**（写了恒不匹配）；未传 `--expect` 时 `expectPassed` 为 `null`（**不是 true**，勿读作已校验）。
- **测前固定版本**：`pi-subagent --version` 或 JSON 里的 `cli.version`（sha256 前 12 位）+ `cli.mtime`；版本变了则前后对比作废。
- 长任务请置于后台并轮询输出，不要阻塞在单个对话轮次里。

## 2. 上传卫生（GitHub 建仓 / 推送 / 合并必须遵守）

禁传清单：`.pi/`（**除 `task_set.json` 外**）、`.zcode/`、`AGENTS.md`、`CODEBUDDY.md`。
例外：`.pi/task_set.json` 随项目分发（与项目绑定）**应上传**，忽略规则为 `.pi/*` + `!.pi/task_set.json`。

```bash
# 检查暂存区是否含禁传文件（含 → exit 1）
~/.pi/agent/bin/pi-project "<项目路径>" --guard-staged

# 把已被 git 跟踪的禁传文件移出索引（本地文件保留，下次提交即从仓库移除）
~/.pi/agent/bin/pi-project "<项目路径>" --untrack-forbidden
```

- 保障机制已自动安装：全局 `core.excludesFile`、每个仓库 `<git-dir>/info/exclude`、全局 pre-commit 拦截。
- **建仓 / 首次推送 / 合并到主分支前，必须先跑 `--untrack-forbidden`**：仅靠 ignore 挡不住已被跟踪的文件。

## 3. 项目契约

项目根 `AGENTS.md`（或 `CODEBUDDY.md`，二者内容由生成器同步）是唯一项目契约，改动前先读；缺失时执行：

```bash
node ~/.pi/agent/bin/project-init.mjs "<项目路径>" --ensure --refresh
```

## 4. 无人值守执行守则（unattended_loop）

> 源：`~/.pi/agent/templates/global-agents-shared.md`「无人值守执行守则」章节；以模板源为准，本节为其 WorkBuddy 镜像，勿单独演化。

- **适用**：WorkBuddy 在无人值守模式下执行项目任务集（`.pi/task_set.json`）时。
- **可自动执行判据**：任务不依赖人工测试、人工审核、人工加需求（无任何人类输入依赖），且其验证手段（测试/类型检查/lint/构建）可由 Agent 自行运行判定。
- **人工依赖标记**：任务标题/说明含「需人工」「待人审」「人工测试」「等确认」「待加需求」等字样，或依赖外部输入（账号、密钥、采购、业务决策）→ 一律视为**不可自动执行**。
- **循环协议**：
  1. 每轮任务执行完成并回写 `.pi/task_set.json` 后，**重新读取回流后的 task_set.json**（不得凭内存判断剩余任务）；
  2. 筛出可自动执行任务 → 按 P 级从高到低取下一项执行，完成后回到步骤 1；
  3. 无可自动执行任务 → **立即暂停循环**，转终止报告。
- **全完成后终审**：循环结束时审核**最终回流后的 task_set.json**——确认无遗漏可自动执行项、剩余项均已标注人工依赖类型、回写内容与实际结果一致。
- **终止报告**（无人值守会话结束前必须输出）：
  1. 已自动完成任务清单（每项含验证结果 / verification gaps）；
  2. 被熔断/截断任务（触发原因、恢复状态、遗留问题）；
  3. 未完成待人审清单（每项注明卡在哪类人工依赖：人工测试 / 人工审核 / 人工加需求 / 其他输入）。
- **安全约束**：
  1. loop 内每项任务仍须走完整 MCG 状态机（门禁与验证不得因无人值守而跳过或削弱）；
  2. 熔断兜底：单项累计修改超 20 处仍未完成、或连续 5 次编译/构建/测试失败 → 停止该项、标记「已截断/待人工处理」、跳下一项；
  3. 危险/不可逆操作（删除数据、强制推送、对外发布、生产环境变更）**禁止**在无人值守下自动执行，一律标记待人审。
