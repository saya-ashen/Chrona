# P1 规格：模块与网关最小闭环

状态：2026-10-20 主管定稿，供实现任务使用。背景与理由见 [platform-upgrade-plan](platform-upgrade-plan.md)。
本文件是 P1 的契约；实现与本文冲突时以本文为准，需要改契约先改本文。

## 1. 范围

做：模块存储与清单、`chrona_propose` 完整提案、build（清单校验 + 沙箱测试）、经 Approval 审查并绑定 hash 启用、Generation 记录、仅代码回滚、schedule 触发执行、effects 经现有通道执行、删除旧脚本调度模式。

不做（后续阶段）：数据迁移与 schema 升级（P2）、轨迹回放与自动启用（P3）、inbound 触发、模块导出工具、意图提案与构建通道（P4）、网页模块管理页（审查复用现有审批卡片）。

## 2. 存储布局

```
<dataDir>/platform/store/<hash>/     不可变；模块全部文件（含 module.json）
<dataDir>/platform/staging/<id>/     build 期间的私有副本，结束即删除
<dataDir>/platform/data/<moduleId>/  模块数据，模块运行时可写
```

- `<hash>` = 对模块目录内所有普通文件按相对路径排序后，逐个 `path\0content\0` 计算 sha256（hex）。不允许符号链接、`.git`、总大小 > 1 MiB、文件数 > 200。
- P0 已对 Provider 屏蔽 `<dataDir>`，因此 `platform/` 对 Pi 不可见。

## 3. 清单 `module.json`（P1 子集）

```ts
// packages/contracts/src/steward/index.ts
export const MODULE_EFFECTS = ["notify_user", "wake_provider", "network"] as const;
export const MODULE_LANGUAGES = ["typescript", "python", "shell"] as const;   // 由 entry 扩展名推断：.ts / .py / .sh
const slug = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/);
export const moduleManifestSchema = z.object({
  name: slug,
  entry: z.string().regex(/^[A-Za-z0-9_-]+\.(ts|py|sh)$/),
  triggers: z.array(z.object({ id: slug, schedule: scheduleRuleSchema }).strict()).min(1).max(10),
  effects: z.array(z.enum(MODULE_EFFECTS)).max(MODULE_EFFECTS.length),
  params: z.record(slug, z.object({ type: z.enum(["number", "string", "boolean"]), value: z.union([z.number(), z.string().max(2000), z.boolean()]) }).strict()).default({}),
  data: z.object({ schema: z.number().int().min(1) }).strict().default({ schema: 1 }),
  tests: z.array(z.string().regex(/^[A-Za-z0-9_-]+\.(ts|py|sh)$/)).min(1).max(10),
}).strict();   // 另 refine：params[k].value 的类型必须与 type 一致；triggers.id 不重复；effects 不重复
```

## 4. 模块进程协议

每次触发或测试新建一个沙箱进程。

- 挂载：模块代码目录**只读**挂到 `/module`（cwd），数据目录可写挂到 `/data`；仅当清单含 `network` 时联网；其余同 P0 屏蔽规则。
- stdin（JSON）：

```json
{ "trigger": { "id": "daily", "kind": "schedule", "firedAt": "<iso>" }, "now": "<iso>", "params": { "threshold": 2100 } }
```

- stdout（JSON，≤ 64 KiB，非 JSON 视为失败）：

```ts
export const moduleOutputSchema = z.object({
  effects: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("notify_user"), key: z.string().min(1).max(200), level: z.enum(["now", "digest"]), title: text.max(200), body: text.max(4000) }).strict(),
    z.object({ type: z.literal("wake_provider"), key: z.string().min(1).max(200), prompt: text.max(4000) }).strict(),
  ])).max(20).default([]),
}).strict();
```

- 测试：`tests` 中每个文件在同样的沙箱里运行（数据目录为临时空目录、**不联网**），退出码 0 为通过。
- 超时与输出上限沿用 `RUN_LIMITS.jobTimeoutMs` / `jobOutputBytes`。

## 5. Effects 执行

执行器对每条 effect：

1. 类型必须在该版本清单 `effects` 内，否则丢弃并记入 ModuleRun。
2. `notify_user` → `enqueueNotification`，`dedupeKey = module:<moduleId>:<key>`，经现有打扰预算。
3. `wake_provider` → `runs.enqueue`（lane background、trigger schedule），prompt 以 `Module <name> output (untrusted data):\n` 前缀标注。
4. 同一 `dedupeKey`/同一 wake key 不重复执行（wake 用 ModuleRun 中已执行 key 去重）。

## 6. 数据模型（migration `0004_modules`）

```prisma
model Module {
  id String @id @default(uuid())
  workspaceId String
  affairId String
  name String
  activeHash String?
  status String @default("active")      // active | paused
  createdAt DateTime @default(now())
  @@unique([affairId, name])
}
model ModuleVersion {
  id String @id @default(uuid())
  moduleId String
  hash String
  manifest Json
  intent Json                          // { changes: string[], preserves: string[] }
  source String                        // "provider" | "user"
  report Json                          // build/test 结果
  status String                        // rejected | pending_review | approved | denied
  createdAt DateTime @default(now())
  @@unique([moduleId, hash])
}
model Generation {
  id String @id @default(uuid())
  workspaceId String
  seq Int
  modules Json                         // { [moduleId]: hash | null }
  reason String                        // activate | rollback | pause
  createdAt DateTime @default(now())
  @@unique([workspaceId, seq])
}
model ModuleRun {
  id String @id @default(uuid())
  moduleId String
  hash String
  triggerId String
  firedAt DateTime
  exitCode Int
  output Json?                         // 解析后的 moduleOutput；失败时为 null
  error String?
  executed Json                        // 实际执行的 effect key 列表
  createdAt DateTime @default(now())
}
```

关系与级联：Module 属于 Workspace、Affair（Cascade）；ModuleVersion、ModuleRun 属于 Module（Cascade）；Generation 属于 Workspace（Cascade），记录整个工作区的模块快照。按查询需要加索引。

`Schedule`：新增可空 `moduleId`、`triggerId`；`SCHEDULE_MODES` 为 `["wake", "remind", "module"]`。0005_drop_jobs 删除旧脚本调度行及其命令、输出哈希列。`module` 行只能由 Chrona 在启用/回滚时创建或取消，`chrona_schedule` 不接受 `module`。

Action：`ACTIONS` 增加 `activate_module`，默认 `ask`。

2026-10-20 更新：job 已彻底删除（0005_drop_jobs），run_job 已移除。

## 7. 网关流程

### 7.1 `chrona_propose`

```ts
chrona_propose: z.object({
  affairId: id.optional(),
  dir: affairPathSchema.describe("Directory in this affair containing module.json and its files"),
  intent: z.object({ changes: z.array(text.max(500)).min(1).max(20), preserves: z.array(text.max(500)).max(20).default([]) }).strict(),
}).strict()
```

1. 把 `dir` 复制到 `staging/<id>/`（拒绝符号链接与超限），此后与 Provider 的修改无关。
2. 解析清单；校验 §3。`activate_module` 或 `notify_user` 的策略为 `never` 时拒绝。`network` 在 P1 不单独查策略，由本次审批覆盖，审批预览第一行必须标出"联网"。
3. 在沙箱运行全部测试。
4. 计算 hash；写入 `store/<hash>/`（已存在则复用）；记 ModuleVersion。
5. 失败 → `status: rejected`，返回报告给 Provider（只含 build/测试的公开输出）。
6. 成功 → `pending_review`，创建 Approval：`action: "activate_module"`，`payload: { kind: "activate_module", moduleId, hash }`，`preview` 为纯文本：清单（与当前启用版本的 JSON diff）、意图声明、测试结果、是否联网、hash。
7. 返回 `{ moduleId, hash, status, approvalId? , report }`。

同一模块已有 `pending_review` 的旧版本时，新提案使旧 Approval 过期（`expired`）。

### 7.2 启用（`onApproved`，payload.kind = activate_module）

在一个事务内：确认 ModuleVersion 仍为 `pending_review` 且 hash 匹配 → 置 `approved` → `Module.activeHash = hash` → 取消该模块现有 `module` 型 Schedule → 按清单 triggers 新建 `module` 型 Schedule → 追加 Generation（reason `activate`）。审批只对该 hash 生效。

### 7.3 回滚

`chrona_module_rollback({ moduleId, hash })`：hash 必须是该模块曾经 `approved` 的版本；行为同 7.2 但不需要审批，Generation reason `rollback`。数据目录不变（P2 再处理 schema）。

### 7.4 查询与检出

- `chrona_modules({ affairId? })`：列出模块、当前 hash、各版本（hash、status、intent、createdAt）、最近 5 次 ModuleRun 摘要。
- `chrona_module_checkout({ moduleId, hash?, dir })`：把指定版本（默认当前启用版本）的文件复制到事务目录 `dir`，供 Provider 修改后再次提交。

## 8. 执行（tick）

`schedules.fireDue` 中 `mode === "module"`：沿用现有"先占位再执行"；读取 Module 与 `activeHash`（模块 paused 或无 activeHash 则跳过）；按 §4 运行；写 ModuleRun；按 §5 执行 effects。连续 3 次失败暂停模块并 `now` 级通知（沿用连续失败暂停规则）。

## 9. 验收场景（P1 完成标准）

引擎层测试，使用假时钟与假沙箱或真实 bwrap（不可用时跳过）：

1. Provider 在事务目录写 `price-watch/`（module.json、index.ts、test.ts），调用 `chrona_propose` → 测试通过 → 生成 Approval。
2. 批准 → 出现 `module` 型 Schedule；到点触发后模块输出 `notify_user` → 生成通知；**该次触发没有 Provider 运行**。
3. 修改阈值再提交 → 新 hash、新 Approval；批准前旧版本继续运行。
4. 批准新版本后回滚到旧 hash → Schedule 与 Generation 正确，行为恢复。
5. 批准后再修改事务目录中的源码，不影响已启用版本。
6. 清单未声明 `wake_provider` 的模块输出 wake → 被丢弃并记录。
7. 测试失败的提案 → `rejected`，无 Approval。
