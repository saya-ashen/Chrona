# P2 规格：模块数据与连续性

状态：已实现（2026-10-20）。背景见 [platform-upgrade-plan](platform-upgrade-plan.md) §4.3、§4.5、P2；P1 契约见 [platform-p1-spec](platform-p1-spec.md)。
本文件是 P2 的契约；实现与本文冲突时以本文为准，需要改契约先改本文。

## 1. 范围

做：清单声明数据 schema 与迁移入口；build 时在**活数据副本**上执行迁移与连续性检查；启用时快照 + 迁移 + 原子切换；跨 schema 回滚只能恢复快照，且需用户批准。

不做：反向迁移脚本（以后需要再加）、ModuleEffect 表、网页模块管理页、轨迹回放（P3）。

要解决的真实问题：pilot F2 —— 新版本隔离测试全绿，却接不住旧版本留下的数据。P1 的测试只在空数据目录上跑，发现不了。

## 2. 清单

```ts
data: z.object({
  schema: z.number().int().min(1),
  migrate: z.string().regex(/^[A-Za-z0-9_-]+\.(ts|py|sh)$/).optional(),
}).strict().default({ schema: 1 }),
```

- `migrate` 文件必须存在于模块目录（与 entry、tests 同样校验）。
- 语言由扩展名推断，与 entry 相同。

## 3. 数据状态与存储

```
<dataDir>/platform/data/<moduleId>/                 活数据（P1 已有）
<dataDir>/platform/data-next/<moduleId>/            启用时迁移用的临时副本
<dataDir>/platform/snapshots/<moduleId>/schema-<N>/ 迁移前的快照，每个 N 只保留最新一份
<dataDir>/platform/snapshots/<moduleId>/before-rollback-<iso>/  恢复快照前的当前数据，保留最近 3 份
```

- `Module.dataSchema Int?`：活数据当前的 schema；`null` 表示从未有过数据。**以数据库为准**，不在数据目录里放标记文件（模块可写 `/data`）。
- 数据目录"为空"= 不存在或没有任何条目。
- `Module.status` 增加 `migrating`；执行器对非 `active` 模块一律跳过（与 `paused` 相同处理）。
- 复制数据目录一律拒绝符号链接；上限 50 MiB / 5000 个文件。

## 4. 迁移进程协议

与模块进程相同的沙箱（§P1-4），代码目录只读 `/module`，`/data` 挂载**副本**，**不联网**。

stdin：`{ "migrate": { "from": <int>, "to": <int> }, "now": "<iso>" }`。退出码 0 为成功；stdout 不解析，仅截断后作为公开输出写入报告。超时与输出上限同 `RUN_LIMITS.jobTimeoutMs` / `jobOutputBytes`。

## 5. Build 阶段（在 P1 §7.1 第 6 步测试通过之后）

设 `S = Module.dataSchema`，`T = manifest.data.schema`，活数据是否为空为 `E`。

1. `S != null` 且 `T < S` → `rejected`，原因"schema 不能降低；降级只能经回滚"。
2. `T > S`、`E` 为否且无 `migrate` → `rejected`，原因"schema 升级需要 migrate"。
3. **连续性检查**（模块有 `activeHash` 且 `E` 为否时执行，否则记 `skipped: "no data"`）：
   1. 把活数据复制到临时目录；超出上限 → 记 `skipped: "data too large"`，继续走审批。
   2. `T > S` 时在副本上运行 `migrate`（from `S`，to `T`）；失败 → `rejected`。
   3. 在副本上运行新版本 entry 一次：`trigger` 取清单第一个 trigger，`kind: "schedule"`，`firedAt = now`；参数同正式触发。退出码非 0、输出不是合法 `moduleOutput` → `rejected`。
   4. **解析出的 effects 不执行**，只写入报告。
   5. 删除临时目录。活数据在整个过程中不被修改。
4. 报告 `report.continuity = { status: "passed" | "failed" | "skipped", reason?, fromSchema, toSchema, migrated, effects }`，其中 `effects` 为第 3.3 步解析出的列表（失败时省略）。
5. 连续性失败与测试失败同样处理：只含公开输出；Provider 来源时排修复 wake（P1 §7.1 第 8 步，计入同一失败连续计数）。
6. 审批预览新增一节：schema 变化（`S → T`，是否需要迁移）、连续性结果、"按当前数据新版本会产生的 effects"（截断规则同代码差异）。

## 6. 启用（`onApproved`，替代 P1 §7.2）

1. 校验同 P1（`pending_review`、hash 匹配）。
2. 不需要迁移（`E` 为是，或 `T == S`）→ 与 P1 相同，事务内同时写 `dataSchema = T`（`E` 为是时也写）。
3. 需要迁移（`T > S` 且 `E` 为否）：
   1. 事务内：`Module.status = migrating`，写 audit `module_migration_started`（记 hash、from、to）。
   2. 复制活数据 → `snapshots/<moduleId>/schema-<S>/`（覆盖旧的同名快照）；再复制到 `data-next/<moduleId>/`。
   3. 在 `data-next` 上运行 `migrate`。
   4. 成功：`data` 改名为临时名 → `data-next` 改名为 `data` → 删除临时名；然后事务内执行 P1 启用步骤并写 `dataSchema = T`、`status = active`。
   5. 失败（含超限、超时）：删除 `data-next`；事务内 `status` 恢复 `active`（旧 `activeHash` 不变、旧调度不变）、该版本置 `rejected` 并在报告中记录迁移失败的公开输出；发一条 `now` 级通知"模块 <name> 新版本未启用：数据迁移失败"。审批记录保持 `approved`，不重试。
4. **中断恢复**：tick 中发现 `migrating` 超过 15 分钟的模块（以 audit 时间为准）→ 删除 `data-next`；若 `data` 不存在但临时名存在则改回；`status` 恢复 `active`，旧版本继续。活数据要么是迁移前的、要么是已完整切换的。

## 7. 回滚（替代 P1 §7.3）

`chrona_module_rollback({ moduleId, hash })`，目标版本 schema 记为 `T`：

| 情况 | 行为 |
|---|---|
| `E` 为是，或 `T == S` | 与 P1 相同，直接切换，不需审批 |
| `T > S`（例如回滚后再前滚） | 按 §6 第 3 步迁移（失败则保持当前版本），不需审批——该版本及其迁移曾被批准 |
| `T < S`，存在 `schema-<T>` 快照 | **不立即执行**。创建 `activate_module` 审批，payload 增加 `restore: { schema: T, snapshotAt }`；工具返回 `{ status: "pending_approval", approvalId }` |
| `T < S`，无快照 | 返回错误"没有 schema <T> 的数据快照，无法回滚到该版本"，不做任何改动 |

恢复快照的审批：

- 预览写明：将恢复 `<snapshotAt>` 的数据，此后写入的数据会丢失；当前数据会另存为 `before-rollback-<iso>`。
- 批准后：`status = migrating` → 当前数据复制到 `before-rollback-<iso>` → 用快照副本替换 `data`（同 §6 第 3.4 步的改名方式）→ 事务内 P1 启用步骤（Generation reason `rollback`）、`dataSchema = T`、`status = active`。
- Provider 不能替用户选择丢数据；`chrona_module_rollback` 不接受任何"强制恢复"参数。

## 8. 契约与数据库

- `packages/contracts/src/steward/index.ts`：清单 `data.migrate`；`chrona_module_rollback` 描述与返回说明（可能返回 `pending_approval`）；`activate_module` payload 可选 `restore`；模块状态枚举（如有）加 `migrating`。
- 迁移 `0006_module_data`：`Module.dataSchema Int?`。
- `Generation.modules` 不变。

## 9. 验收（引擎层测试，假沙箱或真实 bwrap，不可用时跳过）

1. v1 写入数据；v2（同 schema）提案 → 连续性在副本上运行并通过，活数据字节不变，预览含"按当前数据会产生的 effects"。
2. v2 读旧数据会崩溃 → `rejected`，无审批，Provider 收到含公开输出的修复 wake。
3. schema 1→2 带 `migrate`：build 只在副本上迁移；批准后存在 `schema-1` 快照，活数据已迁移，`dataSchema = 2`，下一次触发读到迁移后的数据。
4. schema 升级但无 `migrate`：数据非空 → `rejected`；数据为空 → 正常进入审批，启用后 `dataSchema = 2`。
5. build 后活数据变化导致启用时迁移失败 → 旧版本继续运行、活数据不变、新版本 `rejected`、有 `now` 级通知。
6. 提案 schema 低于 `dataSchema` → `rejected`。
7. 同 schema 回滚直接生效；跨 schema 回滚有快照 → 只建审批，批准前什么都不变；批准后数据恢复、`before-rollback-*` 存在、`dataSchema` 降低；无快照 → 明确错误且无改动。
8. `migrating` 状态的模块不被执行器触发；超过 15 分钟的 `migrating` 被 tick 恢复为旧版本，数据完整。
9. 活数据超过上限 → 连续性 `skipped: "data too large"`，预览中可见。

## 10. 已知限制

- 不支持反向迁移脚本。
- 启用开始时仍在运行的模块可能继续写入；这些写入不一定包含在快照或迁移中。
- 活数据超过 50 MiB / 5000 个文件时，连续性检查会跳过，并在预览中显示。
- 中断恢复仅用模拟文件系统状态测试，未验证真实进程被强制终止的情形。
