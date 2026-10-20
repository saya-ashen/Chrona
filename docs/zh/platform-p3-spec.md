# P3 规格：并行模拟与自动启用

状态：已实现（2026-10-21）。背景见 [platform-upgrade-plan](platform-upgrade-plan.md) §4.3、§4.4、P3；前置契约见 [P1](platform-p1-spec.md)、[P2](platform-p2-spec.md)。
本文件是 P3 的契约；实现与本文冲突时以本文为准，需要改契约先改本文。

## 1. 范围与取舍

做：build 时让新旧版本从同一份数据副本出发，在相同的未来触发序列上各跑一遍，逐步比较 effects；在用户已授权的事务内，"无新增 effects、无迁移、模拟零差异"的新版本自动启用并做完告知。

与原方案的差异：原方案写"轨迹回放：用过去的触发记录"。模块有状态，而 ModuleRun 只记录触发时间、不记录当时的数据，历史无法复现；schedule 触发的输入只有时间和参数，历史记录也不提供额外信息。因此改为**从当前数据出发的并行模拟**。inbound 触发（P4）出现后，再把真实的历史输入加入模拟序列。

"差异是否被意图 `changes` 解释"是语义判断，不由代码裁决：**任何差异都阻止自动启用**，并在审批卡片里与意图并排展示，由用户判断。

不做：变形测试、独立模型审查（P5）、inbound 触发（P4）。

## 2. 模拟（build 阶段，在 P2 连续性检查之后）

仅当模块有 `activeHash` 时执行；否则 `replay = { status: "skipped", reason: "first version" }`。

1. 以下情况记 `skipped`（原因如括号）并继续进入审批：旧或新清单含 `network`（"network"）；新旧清单 triggers 的 id 集合或任一 schedule 不同（"triggers changed"）；活数据超过 P2 复制上限（"data too large"）；连续性检查本身失败时不执行（构建已被拒绝）。
2. 触发序列：按**旧版本**清单的 triggers，用 `nextOccurrence` 从 `now` 起合并取最早的 10 个时刻（同一时刻按 trigger 在清单中的顺序）。
3. 数据：把活数据复制两份（`old`、`new`）；数据为空则两份都是空目录。需要迁移时，在 `new` 上先运行新版本 `migrate`（与连续性相同的输入）。
4. 逐步：对每个时刻 `t`，分别运行旧版本（`store/<activeHash>`、旧清单参数）于 `old` 和新版本（staging、新清单参数）于 `new`，输入 `{ trigger: { id, kind: "schedule", firedAt: t }, now: t, params }`，不联网，限制同正式触发。effects **不执行**。
5. 每步比较：双方是否都成功（退出码 0 且输出合法）；都成功时比较 `effects` 数组的规范化 JSON（对象键排序，数组顺序保留）。不一致即为一处差异。
6. 总时长上限 5 分钟；超出则 `skipped`（"time budget"）。无论结果都删除两份副本。
7. 报告 `report.replay = { status: "identical" | "different" | "skipped", reason?, steps, diffs }`；`diffs` 最多保留前 5 处，每处 `{ step, triggerId, firedAt, old: { ok, effects? }, new: { ok, effects? } }`；`steps` 为实际执行的步数。
8. 模拟结果**不拒绝构建**：新版本在某步失败而旧版本成功，也只算差异。

## 3. 审批预览

在 P2 的连续性一节后增加"并行模拟"一节：状态与原因、步数、每处差异（时刻、旧 effects、新 effects），截断规则沿用现有预览（超长时截断并注明，失败关闭规则不变）。差异紧邻意图展示。

## 4. 自动启用

构建成功后，满足**全部**条件则自动启用，否则照常创建审批卡片：

1. 模块有 `activeHash`；
2. `activate_module` 对该事务的有效策略为 `auto`、`notify_after` 或 `preapproved`（即用户曾以"在这件事里允许"批准过，或手工创建了授权）；`once` 授权不算；
3. 新清单 `effects` ⊆ 当前启用版本清单 `effects`；
4. 不需要数据迁移（`T == S`，或活数据为空）；
5. 连续性 `passed` 或 `skipped: "no data"`；
6. 模拟 `identical`，且 `steps == 10`。

自动启用的执行：

- 创建一条 `activate_module` Approval，直接为 `approved`，`grantId` 为所用授权（`auto`/`notify_after` 无授权时为空），payload 与人工审批相同，预览同审批卡片；随后走与人工批准**同一条**启用路径（P1 §7.2 / P2 §6）。
- 写 audit `module_auto_activated`（versionId、hash、grantId）。
- 发一条 `digest` 级通知"模块 <name> 已自动更新"，正文含意图 `changes` 摘要与"可在模块历史中回滚"，经现有打扰预算。
- 自动启用失败（例如启用路径抛错）→ 不重试，退回为普通的 `pending_review` 审批卡片。

## 5. 契约与数据库

不改数据库。报告是 JSON。`chrona_propose` 描述补充一句：已授权事务内，无新增 effects、无迁移、并行模拟零差异的版本会自动启用。

## 6. 验收（引擎层测试，假沙箱）

1. 新版本悄悄加了一条规则（如"再降 200 才通知"），在某个模拟步骤输出不同 → `replay.status = "different"`，预览列出该步新旧 effects；即使有 `preapproved` 授权也只建审批卡片。
2. 纯重构（输出完全一致）+ 事务级 `preapproved` 授权 → 自动启用：Approval 为 `approved` 且带 grantId、Generation `activate`、audit、digest 通知；无授权时只建审批卡片。
3. 新增 effect（如 `wake_provider`）→ 不自动启用。
4. 需要迁移 → 不自动启用（模拟仍执行并展示）。
5. 含 `network`、triggers 改变 → `skipped` 且不自动启用。
6. 有状态模块：新旧版本各自在自己的数据副本上累积状态，活数据字节不变。
7. `once` 授权不触发自动启用。
8. 首个版本不模拟、不自动启用。
