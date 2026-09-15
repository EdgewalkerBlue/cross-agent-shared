# {{PROJECT_NAME}} — 项目指令

> 会话档案：`.pi/session-archive.md`（机器自动维护，勿手改）｜ 任务集：`.pi/task_set.json`
> 本文件由 `node ~/.pi/agent/bin/project-init.mjs` 生成骨架：`<!-- pi:auto -->` 区自动刷新，其余区人工/Agent 填写。
> 全局门禁见 `~/.pi/agent/AGENTS.md`（AI 代码可维护性门禁）；**本文件只写项目事实，不抄全局原则。**
> 注意：WorkBuddy 对项目指令有 8000 字符硬截断 → 关键信息前置，勿在本文件堆放长清单。

## 项目定位与范围
<!-- TODO(项目定位): 一句话说清：做什么 / 不做什么 / 当前阶段与退出条件。 -->

## 共享抽象与复用清单（改前先看，MCG-002/004）
<!-- TODO(复用清单): 列出既有工具/组件/校验器/适配器的位置；并写明"禁止平行实现什么"。 -->

## 验证命令（完成前必跑，MCG-007）
<!-- pi:auto:begin verify -->
<!-- pi:auto:end -->

## 项目特有错误处理与禁区
<!-- TODO(禁区): 项目化实例，例：不得吞 XXX 异常；不得禁用 YYY 测试；不得绕过 ZZZ 校验。 -->

## 关键接口与调用方（MCG-006）
<!-- TODO(接口): 改动影响面：关键接口、外部契约、调用方清单。 -->

## 任务集回写要点（MCG-008）
- 任务完成/整理时回写 `.pi/task_set.json`：**删除已完成项**、补充未完成项、按 `P0>P1>P2>P3>P4` 排序。
- 每项任务写入 `maintainability_check` 字段（模板：`.pi/maintainability_check.json`）与 `agent_result`（模板：`.pi/agent_result.json`）。

## 结构快照（自动）
<!-- pi:auto:begin layout -->
<!-- pi:auto:end -->
