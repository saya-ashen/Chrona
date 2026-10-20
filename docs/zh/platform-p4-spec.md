# P4 规格：入站触发与模块工具

状态：已实现（2026-10-21）。背景见 [platform-upgrade-plan](platform-upgrade-plan.md) §3.1、P4；前置契约见 [P1](platform-p1-spec.md)、[P2](platform-p2-spec.md)、[P3](platform-p3-spec.md)。
本文件是 P4 的契约；实现与本文冲突时以本文为准，需要改契约先改本文。

## 1. 范围

做：P4a 模块由入站邮件触发，规则能处理的邮件不唤醒 Provider；P4b 模块导出工具，经 `/catalog` 只在模块所属事务的运行里出现。

不做：**意图提案构建通道**（原 P4 第三项）。它会让 Chrona 自主发起额外的模型运行，属于新的自动花费行为，需用户单独决定后另写规格。页面编辑触发、按主机放行网络（P5）也不做。

## 2. 清单扩展

```ts
const trigger = z.union([
  z.object({ id: slug, schedule: scheduleRuleSchema }).strict(),
  z.object({ id: slug, inbound: z.object({ connector: id, match: z.object({ from: z.string().max(200).optional(), subject: z.string().max(200).optional() }).strict().default({}) }).strict() }).strict(),
]);
tools: z.array(z.object({
  name: slug, description: z.string().min(1).max(500),
  parameters: z.object({ type: z.literal("object"), properties: z.record(slug, z.union([
    z.object({ type: z.enum(["string", "number", "boolean"]), description: z.string().max(300).optional() }).strict(),
    z.object({ type: z.literal("string"), enum: z.array(z.string().max(100)).min(1).max(20), description: z.string().max(300).optional() }).strict(),
  ])).default({}), required: z.array(slug).default([]) }).strict(),
}).strict()).max(5).default([]),
```

- triggers 仍 1–10 个，可只有 inbound；trigger id 与 tool name 各自不重复；`required` 必须是 `properties` 的键。
- `from` 为大小写不敏感的通配（`*` 匹配任意串，整串匹配）；`subject` 为大小写不敏感子串；省略即匹配全部。
- 现有只含 schedule 的清单保持有效。

## 3. 模块输出扩展

```ts
moduleOutputSchema = z.object({
  effects: …（不变）,
  handled: z.boolean().optional(),          // 仅 inbound 触发有意义
  result: z.json().optional(),              // 仅 tool 触发有意义；序列化 ≤ 16 KiB
}).strict();
```

## 4. P4a 入站触发

### 4.1 进入模块队列

`storeInboundItems` 写入新条目时，若该条目按 `.chrona/rules.json` 的处理结果为 `batch` 或 `wake_now`，且连接器所属事务中存在**状态 active、有 activeHash** 的模块，其当前版本清单有 `inbound.connector == 连接器 id` 且匹配该条目的触发器，则条目 `status = "module"`（其余字段不变）。`ignore`、`digest_only` 不进入模块。

### 4.2 执行（tick 中，位于 connectors 之后、schedules 之前）

1. 认领：`status = "module"` 且（无租约或租约过期）的条目，按 `receivedAt` 升序，每轮每工作区最多 10 条；以 `leaseToken`/`leaseUntil`（`now + jobTimeoutMs + 60s`）原子认领。
2. 重新确定匹配的模块与触发器（模块可能已变化）；无匹配或模块非 active → `status = "new"`，进入原有批处理。
3. 对每个匹配的（模块，触发器），按模块名排序依次运行，输入：
   `{ trigger: { id, kind: "inbound", firedAt: receivedAt, item: { externalId, from, subject, receivedAt, body } }, now, params }`，`body` 为条目文件正文（去掉头部），截断到 64 KiB。联网规则同 schedule。
4. 写 ModuleRun（`triggerId` = 触发器 id，`firedAt` = `receivedAt`，新增可空列 `inboundItemId`）；effects 经与 schedule 相同的执行器（同一去重与策略，`wake_provider` 同样带 untrusted 前缀）。
5. 处理结果：任一模块成功且 `handled: true` → `status = "delivered"`、`action = "module"`、`deliveredAt = now`、`ruleNote` 记 `模块 <name> 已处理`；否则 → `status = "new"`（原 `deliverAt` 不变，照常批量交给 Provider）。清除租约。
6. 失败计数：同一模块最近连续 3 次 ModuleRun（不分触发类型）失败 → 暂停模块（沿用现有暂停与 `now` 通知）。

### 4.3 数据与 P3

- 迁移中（`migrating`）的模块不运行，条目保持 `module` 等下一轮；超过 30 分钟仍未处理则回到 `new`。
- 含 inbound 触发器的模块：P3 并行模拟 `skipped`（原因 `"inbound triggers"`），因此不自动启用。

## 5. P4b 模块工具

### 5.1 目录

`catalog(token)` 在现有 Chrona 工具之后，追加该运行所属事务内**状态 active、有 activeHash** 的模块在当前版本清单中声明的工具：

- 名称 `m_<module 名中的 - 换成 _>_<tool 名中的 - 换成 _>`，总长 ≤ 64；冲突时后者不暴露。
- `inputSchema` 为清单 `parameters` 加 `additionalProperties: false`，`description` 为 `"[module <name>] <description>"`。
- 运行没有事务（根级运行）时不追加。其他事务的模块工具不可见、不可调用。

### 5.2 调用

`call(token, name, raw)` 遇到 `m_` 前缀：

1. 重新解析：运行所属事务 + 名称 → 模块与工具；找不到或模块非 active → `not_found`。
2. 按清单 `parameters` 校验参数（类型、enum、required、无多余键）；失败 → `invalid`，消息列出字段。
3. 在沙箱运行模块，输入 `{ trigger: { id: <tool name>, kind: "tool", firedAt: now, args }, now, params }`；联网规则同 schedule；超时同 `RUN_LIMITS.jobTimeoutMs`，但不得超过 50 秒（Provider 桥接 60 秒）。
4. 写 ModuleRun（`triggerId` = `tool:<tool name>`）；effects 经同一执行器执行。
5. 返回 `{ result, effects: [{ type, key, status }] }`；模块失败 → `conflict`，消息为截断后的公开 stderr（≤ 2000 字符）。
6. 计入现有运行工具调用记录与审计（与 Chrona 工具相同）。

### 5.3 P3

模块当前版本或新版本声明了 tools → 并行模拟 `skipped`（原因 `"tools"`），不自动启用（模拟不覆盖工具路径）。

## 6. 契约与数据库

- `packages/contracts/src/steward/index.ts`：§2、§3 的 schema；`chrona_propose` 描述补充 inbound 触发器与 tools 的写法（≤ 900 字符，保留现有全部规则）。
- 迁移 `0007_module_inbound`：`ModuleRun.inboundItemId String?`（无外键，便于条目清理）。

## 7. 验收（引擎层测试，假沙箱）

1. 邮件分拣：模块对 `from: *@shop.example` 处理并返回 `handled: true` → 条目 `delivered/module`、有通知、**没有 Provider 运行**；不确定的邮件返回 `handled: false` → 条目回到 `new` 并被批量交给 Provider。
2. 规则 `ignore` 的条目不进入模块；没有匹配模块的条目流程不变。
3. 模块失败 → 条目回到 `new`；连续 3 次失败暂停模块。
4. 租约：并发 tick 只处理一次；过期租约可重新认领。
5. 模块暂停/迁移中：条目不丢失，最终回到 `new` 或被处理。
6. 工具：相关事务的运行在 catalog 中看到 `m_…` 工具（带 schema），其他事务与根级运行看不到也不能调用；参数校验失败返回字段错误；成功返回 `result` 并执行 effects；模块失败返回 `conflict`。
7. P3：含 inbound 或 tools 的模块模拟 `skipped`，不自动启用。
8. 只含 schedule 的旧清单与全部现有测试不受影响。
