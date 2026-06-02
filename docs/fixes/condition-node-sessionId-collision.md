# 条件节点 ConditionSelect 反查 run 上下文歧义修复方案

## 问题

Node 2（condition 类型, cn_mpv9awjd_2）provider run 触发 `chrona_condition_select`，但 Chrona 通过共享的 sessionId 反查 run 时命中了 Node 1 的上下文，terminal 校验将 condition_select 当作 task 节点的 tool invocation，报错 `chrona condition terminal tool cannot complete current task node`。

最终 Node 2 的执行状态变为 Blocked，错误表现为：
`Condition node cn_mpv9awjd_2 completed without a structured selectedBranch`

## 根因

所有 node 共享同一个 `mainSession.sessionKey` 作为 `runtimeSessionKey`，传给 Hermes 作为 `session_id`。多个 node run 共享同个 sessionId，导致 `findToolAuditRun` 通过 `sessionId` 反查时产生歧义（`orderBy: { updatedAt: 'desc' }` 取最新一条），命中了错误的 run 上下文。

```
Task session
 └── Main sessionKey = "task_cm_xxx"  ← 所有node共享
      ├── Node 1 run → session_id = "task_cm_xxx"
      └── Node 2 run → session_id = "task_cm_xxx"  ← 与Node 1相同
                                     ↑
                          findToolAuditRun 反查到此sessionId
                          按 updatedAt desc → 可能命中Node 1的run
```

## 关键文件

| 文件 | 作用 |
|------|------|
| `packages/engine/src/services/agent-tool-operations.service.ts:624-633` | `findToolAuditRun` — 通过 sessionId 反查 run，产生歧义 |
| `packages/engine/src/services/agent-tool-operations.service.ts:585-611` | `resolveToolAuditScope` — 构建 ToolAuditScope 上下文 |
| `packages/engine/src/modules/plan-execution/ai-runtime-invoker.ts:99-106` | sessionId 生成 → Hermes `session_id` |
| `packages/engine/src/modules/plan-execution/runtime/terminal-command.ts:58` | `validateTerminalCommand` — 抛出 "cannot complete" 错误 |
| `packages/engine/src/modules/plan-execution/node-ai-capabilities.ts:206` | `runtimeSessionKey: input.mainSession.sessionKey` — 共享根因 |
| `external-plugins/hermes/tools.py:140-167` | Hermes 插件注入 `session_id` 到 MCP 工具调用 |

## sessionId 注入机制（AI 无感知）

Hermes 插件 `tools.py:140-167` 自动从 Hermes 运行时 kwargs 提取 `session_id` 并注入到 MCP `tools/call` 的 arguments 中：

```python
# tools.py:161-167
def _inject_session_context(arguments, kwargs):
    enriched = dict(arguments)
    context = _current_session_context(kwargs)
    session_id = context.get("session_id")
    if session_id and "sessionId" not in enriched:
        enriched["sessionId"] = session_id  # ← 运行时注入，非AI填写
    ...
```

AI 只填写 `branchRef`、`summary` 等业务字段，`sessionId` 由运行时自动注入。MCP 路由 `mcp.routes.ts:21-32` 将 `sessionId` 列在 `hiddenContextKeys` 中，不在暴露给 AI 的 public schema 里。

## Hermes 传入 handler 的 kwargs

Hermes 运行时传给插件 handler 的参数有限：

```python
# 来自 smoke_test.py:125-128 的验证
handler(args,
    session_id="session-1",  # 共享的session id
    task_id="task-run-1",
    model="hermes-model",
    platform="cli",
)
```

**没有** `run_id` 或 `nodeAttemptId`。无法通过 Hermes 插件自动注入 node-attempt 上下文。

## 可选方案分析

### 方案 B（nodeId/nodeType 过滤）

在 `findToolAuditRun` 中通过 `executionSession.currentNodeId` + `taskPlanProviderRun.nodeAttemptId` 关联过滤。

- **优点：** 不改 Hermes
- **缺点：** `executionSession.currentNodeId` 可能过时；多条件链时歧义仍存在
- **复杂度：** 中

### 方案 C（Run 表加 nodeAttemptId FK）

在 Run 表增加 `nodeAttemptId` 字段，查询一步到位。

- **优点：** 查询最简单
- **缺点：** 高 schema 迁移成本；Run 和 NodeAttempt 生命周期不匹配（一个 run 可跨多次 attempt retry）

### 方案 A（编码 nodeAttemptId 到 sessionId）★ 推荐

**核心思路：** 在 Chrona 侧编码 `nodeAttemptId` 到传给 Hermes 的 `session_id` 中，在 MCP 工具调用处理时解码提取。

不改 Hermes runtime，不改 Hermes 插件。AI 无感知。向后兼容。

**实现步骤：**

#### 1. 编码端 → `ai-runtime-invoker.ts:99-106`

将传给 Hermes 的 `sessionId` 改为带 nodeAttemptId 的复合格式：

```typescript
// 现有
sessionId: input.runtimeSessionKey,
// 改为
sessionId: input.nodeAttemptId
  ? `${input.runtimeSessionKey}::node:${input.nodeAttemptId}`
  : input.runtimeSessionKey,
```

`input.nodeAttemptId` 已在调用时传入（`node-ai-capabilities.ts:211`）。

#### 2. 解码辅助函数 → `agent-tool-operations.service.ts`

```typescript
type EncodedSessionContext = {
  sessionId: string;
  nodeAttemptId?: string;
};

function decodeSessionContext(rawSessionId: string): EncodedSessionContext {
  const SEPARATOR = "::node:";
  const idx = rawSessionId.indexOf(SEPARATOR);
  if (idx === -1) {
    return { sessionId: rawSessionId };
  }
  return {
    sessionId: rawSessionId.substring(0, idx),
    nodeAttemptId: rawSessionId.substring(idx + SEPARATOR.length),
  };
}
```

#### 3. 解码端 → `resolveToolAuditScope`

利用提取出的 `nodeAttemptId` 精确定位 `TaskPlanProviderRun`：

```typescript
// 在 resolveToolAuditScope 中
const ctx = decodeSessionContext(input.sessionId);

let providerRun;
if (ctx.nodeAttemptId && input.taskId) {
  // 精确查找：nodeAttemptId → TaskPlanProviderRun
  providerRun = await db.taskPlanProviderRun.findFirst({
    where: { taskId: input.taskId, nodeAttemptId: ctx.nodeAttemptId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, planId: true, planRunId: true, nodeAttemptId: true, providerRunRef: true },
  });
}

// 向后兼容 fallback
if (!providerRun) {
  const run = await findToolAuditRun(ctx.sessionId); // 现有逻辑
  providerRun = await findToolAuditProviderRun(input.taskId, fieldValue(run, "runtimeRunRef"));
}
```

#### 4. 工具调用入参 → `executeValidatedTool`

由于 `sessionId` 编码后仍以 `runtimeSessionKey` 为前缀，现有 `resolveInputContext`（通过 `taskSession` / `run` 反查 taskId/workspaceId）不受影响。编码部分（`::node:...`）在 task session lookup 时会被忽略（匹配到 sessionKey 前缀即可）。

**注意：** `resolveInputContext` 中通过 `db.run.findFirst({ runtimeSessionRef: sessionId })` 反查的逻辑**不会**直接匹配编码后的 sessionId（因为 run 表的 `runtimeSessionRef` 存的是原始 sessionKey，不带编码后缀）。但该查找路径有 `OR` 条件且作为 fallback，正常路径应是 `db.taskSession.findFirst({ sessionKey })` → 精确匹配 sessionKey 前缀 → 成功。

为确保 `resolveInputContext` 兼容性：

```typescript
// resolveInputContext 中增加解码处理
async resolveInputContext(input: unknown) {
  const sessionId = ...; // 解析后的 sessionId（可能是编码格式）
  const sessionKey = decodeSessionContext(sessionId).sessionId; // 提取纯 sessionKey
  // 用 sessionKey 做 taskSession 查找（不受影响）
}
```

### 变更清单

| 文件 | 变更 | 风险 |
|------|------|------|
| `packages/engine/src/modules/plan-execution/ai-runtime-invoker.ts:99-106` | 编码 nodeAttemptId 到 sessionId | 低 |
| `packages/engine/src/services/agent-tool-operations.service.ts:585-611` | `resolveToolAuditScope` 添加 nodeAttemptId 优先查找 | 中 |
| `packages/engine/src/services/agent-tool-operations.service.ts:308-377` | `resolveInputContext` 兼容解码 | 低 |
| 新增：`decodeSessionContext` 辅助函数 | 编码/解码逻辑 | 低 |

### 兼容性

- **向前兼容：** 无 nodeAttemptId 的旧 sessionId（无 `::node:` 分隔符）走原有 fallback 逻辑
- **并发安全：** 每个 node attempt 有唯一定位符，多个 node 同时运行时不再混淆
- **Hermes 插件：** 无感知，session_id 仍从 kwargs 自动注入
- **AI 层面：** 无感知，sessionId 不在 public schema 中

### 验证

1. 创建包含 condition node 的 task，验证 `chrona_condition_select` 正确处理
2. 多条 condition 并发执行时不产生 run 上下文混叠
3. 旧 sessionId 格式（无 `::node:` 分隔符）继续正常工作
4. `resolveInputContext` 对编码 sessionId 仍正确解析 taskId/workspaceId
