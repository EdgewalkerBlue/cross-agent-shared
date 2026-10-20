# DCO Pack — 分布式认知编排（Distributed Cognition Orchestrator）

把群里那次关于「长程推理过早停机 / 高压约束指令 / 多智能体通信拓扑」的讨论，整理成一套可直接挂载的工程包。

命名前缀统一为 `dco-`（Distributed Cognition Orchestrator）。

## 文件清单（已并入 cross-agent-shared 仓）

| 文件 | 作用 |
| --- | --- |
| `docs/dco/architecture.md` | 架构说明 + Mermaid 架构图 |
| `docs/dco/architecture.svg` | 可直接预览的架构图（分层拓扑） |
| `docs/dco/task_set.json` | 任务集：触发条件、四阶段流程、交付物、验收判据 |
| `skills/dco-explicit-chain-reasoning/SKILL.md` | 长链条强制展开与中继自检（部署位 `~/.agents/skills/`） |
| `skills/dco-constraint-audit-protocol/SKILL.md` | 高约束审计指令的装配与注入 |
| `skills/dco-blackboard-orchestration/SKILL.md` | 黑板 + 中继代理 + 事件总线 |
| `skills/dco-relay-injection/SKILL.md` | 早期层微型 LoRA 中继与端侧前置路由 |

## 三个核心命题

1. **过早停机不是算力问题**：长链推导中隐藏层语义信号衰减，模型提前收敛。开源侧在早期层注入微型 LoRA 做中继放大；闭源 API 侧改用显式思维链 + 端侧前置解析补偿。
2. **高压约束之所以有效**：砍掉礼貌性冗余，语义噪音下降，注意力集中在边界条件上。合规做法是「零容错审计环境 + 硬禁止项 + 三阶段闭环」，而不是攻击性措辞。
3. **通信拓扑决定幻觉传染半径**：点对点全连接让通信复杂度二次方爆炸，并放大错误传播。改成黑板（单一事实来源）+ 中继代理（路由与摘要）+ 事件总线（结构化增量），复杂度压回线性。

## 挂载方式（跨 harness 共用，按需调用）

```text
# 正本（随本仓分发，deploy.mjs 部署 + 自检）
skills/dco-*/SKILL.md

# 部署位（Agent Skills 通用标准位，Pi / Paseo / OpenHands 等按需发现）
~/.agents/skills/dco-*/SKILL.md
```

触发判定与组合顺序见同目录 `AGENTS.md`；全局调用约定（三问门控 / 升级阶梯 L0-L4 / 卸载规则）已写入各 harness 全局指令的「DCO 分布式认知编排」节（源：`~/.pi/agent/AGENTS.md` + `templates/global-agents-shared.md`，经 `--sync-global` 渲染）。

`task_set.json` 只负责「任务定义 + 阶段 + 验收」，模型选型、token 预算、故障切换应由独立文件承担，避免职责重叠。

## 边界

- 四个 Skill 都会强制拉长输出链路，短问答、闲聊、简单事实查询不要挂载，否则延迟和成本都会明显上升。
- `relay-injection` 涉及权重改动，只适用于本地可改隐藏层的开源模型；商业 API 场景请走 `explicit-chain-reasoning` + `constraint-audit-protocol` 组合。
