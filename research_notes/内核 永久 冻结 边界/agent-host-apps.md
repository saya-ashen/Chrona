# Agent、内核与本机宿主边界研究

研究基线：`/home/saya/workspace/Chrona`，HEAD `cf19ceb704800e5c53e0784aff4558883f6afa9b`。工作区无未提交改动。本报告只读取本地源码；没有修改文件、运行测试、访问数据库、调用模型或网络。

以下将**代码现状**与**冻结建议**分开。现有接口、现有文件位置、已导出的 schema 均不构成永久保留理由。

## 1. 永久冻结的边界应该是什么？

### Takeaway

**永久冻结的是最小内核的治理职责及必要契约，不是当前 Agent 的 21 个工具，也不是所有已经放进 engine/contracts 的实现。**

产品只分两类：

- **内核**：真实身份、授权、生命周期、调用路由、共享资源预算、运行准入与撤销、实际停止证据，以及这些机制必要的持久化。
- **模块**：Agent、Web、Notify、Coding 等应用。Agent 是具有特殊可信宿主绑定的 builtin 模块，但其应用 API 不是内核公共 API。

`runtime-callback` 和 `workspace-local` 是**内核内部实现登记**，不是第三类产品，不应因为能通过 router 调用就获得独立应用身份。

### Cited Findings

#### 1.1 当前代码已经在部分地方承认这个区别

`moduleInterfaces()` 把 system registrations 和 local registrations 都标记为 `origin: "kernel"`：

```ts
const entries = [...listSystemModules(), ...localCapabilities()].map(module => ({
  origin: "kernel" as const,
  ...
}));
```

来源：`packages/engine/src/modules/steward/system-apps.ts:20-24`。

当前名称清单则分为：

```ts
KERNEL_MODULE_NAMES = ["modules", "schedules", "approvals", "settings", "secrets", "activity"]
LOCAL_CAPABILITY_NAMES = ["runtime-callback", "workspace-local"]
BUILTIN_MODULE_NAMES = ["web", "notify", "agent"]
```

来源：`packages/contracts/src/steward/module-lifecycle.ts:4-8`。

**因此 local registration 是实现组织方式，不是必须再建立一套产品分类的证据。**

#### 1.2 Agent 的可信性来自实际发行身份，而不是工具名称或参数

签名：

```ts
export async function isAgentApplication(
  ports: StewardPorts,
  caller: { moduleId: string; hash: string },
  workspaceId: string
)
```

验证：

- 同一 workspace；
- 数据库中的 `name: "agent"`；
- `builtin: true`；
- `status: "active"`；
- `activeHash === caller.hash`；
- 对应版本 `source === "builtin"` 且 `status === "approved"`。

来源：`packages/engine/src/modules/steward/agent-application.ts:11-16`。

Supervisor 再次验证后，才提供特殊宿主：

```ts
private async agentHost(instance: Instance) {
  if (!this.ports.agentApplication || instance.manifest.name !== "agent") return undefined;
  if (!await isAgentApplication(this.ports, instance, instance.scope.workspaceId)) return undefined;
  return this.ports.agentApplication;
}
```

来源：`packages/engine/src/modules/steward/module-supervisor.ts:201-205`。

这不是普通模块声明一种 manifest capability 就可以取得的权限。

#### 1.3 Pi 已经在 Agent 进程中实例化，不在内核中实例化

```ts
const provider = configuration?.backend === "pi"
  ? createPiProvider(...)
  : undefined;
```

来源：`packages/engine/src/modules/steward/builtin/agent/runtime.ts:14-19`。

服务组合层创建的是 `createAgentClient()`，通过 routed calls 转发，而不是直接创建 Pi：

来源：

- `apps/server/src/steward-runtime.ts:55-66`
- `packages/engine/src/modules/steward/agent-client.ts:6-19`

特殊宿主配置由 `createAgentApplicationHost(options: { port: number; dataDir?: string })` 建立，包含 Pi executable、profile、extension、执行模式及浏览器配置。

来源：`packages/integrations/src/steward/agent-application-host.ts:6-29`。

### Inferences

#### 永久冻结决策矩阵

| 事项 | 最终归属 | 是否应成为冻结的内核职责 |
|---|---|---|
| 调用者 moduleId/hash、workspace、实际调用链 | 内核 | 是；不能允许模块自报身份 |
| Agent 特殊宿主绑定的发行身份校验 | 内核 | 是；保护信任根 |
| Run 准入、统一队列、共享预算、取消与撤权 | 内核 | 是；不能由各应用自行裁决共享资源 |
| 实际停止证据与未知停止占用资源 | 内核 | 是；取消请求不等于已停止 |
| 本机目录授权、物理身份核验及锁 | 内核的本机宿主实现 | 是，保留安全语义；不冻结当前 registration 的产品名称 |
| Provider/Pi 启动、RPC、进程管理、transcript 适配 | Agent | 否，不是内核公共 API |
| 模型 completion 的执行与结果 receipt | Agent | 否；预算 reservation/settlement 仍在内核 |
| 对话标题、journal、用户等待与交付体验 | 入口应用 | 否 |
| Coding 的 work/group/dependency/results/accept | Coding | 否 |
| Web 页面、聚合、导航、renderer、应用页面登记 | Web 应用 | 否 |
| 通知 wording、级别、quiet hours、digest、渠道选择与交付 | Notify 应用 | 否 |
| 内核有限事实及选定消费者、ACK、撤回约束 | 内核 | 是，但应清理其中夹带的通知产品策略 |

**Agent 只保留一个可信 builtin Provider 所有者。** 当前只有 Pi；将来有真实第二种 Provider 需求时，在 Agent 内登记与接入。现在不需要多个 builtin Agent，也不需要先实现 Provider 插件注册框架。

冻结前允许删除重复 API、拆出业务策略；冻结后不应以“兼容旧 API”为理由把今天的重复设计永远保留。

### Gaps

- 本报告没有研究全部六组内核接口的逐方法冻结清单，结论限于 Agent、本机宿主、Web/Notify 及其直接依赖。
- 当前工具环境没有提供 Hindsight/CodeGraph 调用工具；结论来自当前源码，不以自动检索的历史记忆作为证据。

## 2. Agent 的全部 21 个工具：哪些是应用契约，哪些是私有宿主契约，哪些重复？

### Takeaway

当前 Agent 的工具名称包含 **9 个 runtime/operation 工具 + 12 个 primitives = 21 个**。但是同一个工具名对 `kernel` 与 `module` caller 使用不同参数和结果，因此**21 个名称不等于 21 个单一契约**。

应保留真实应用所用的 Agent 能力，把 kernel-only Provider 控制作为私有宿主协议；删除没有真实生产调用者的重复模块入口。不要把 `start/status/inject/abort/...` 和 `run/get/write/interrupt/...` 两套执行 API 一起永久冻结。

### Cited Findings

#### 2.1 双重契约的实际分派

```ts
if (caller?.kind === "kernel")
  return { result: await kernelTool(trigger.id, trigger.args.input) };

if (caller?.kind !== "module" || !trigger.call?.id)
  throw new ModelError("forbidden", "Agent tools require an admitted caller");

if (isAgentPrimitive(trigger.id))
  return { result: await primitive(trigger.id, trigger.args, trigger.call.id) };

return {
  result: await moduleOperations.handle(
    trigger.id as ModuleAgentTool,
    trigger.args,
    caller,
    trigger.call.id
  )
};
```

来源：`packages/engine/src/modules/steward/builtin/agent/runtime.ts:98-107`。

- Kernel 输入由 `agentInput()` 解析，包括 host cwd、sessionDir、Run token 等。
- Module 输入由 `moduleAgentInput()` 或 `primitiveInput()` 解析，不接受这些宿主权限参数。

来源：

- `packages/engine/src/modules/steward/builtin/agent/contracts.ts:3-16`
- `packages/engine/src/modules/steward/builtin/agent/module-contracts.ts:3-24`
- `packages/engine/src/modules/steward/builtin/agent/primitives.ts:9-37`

#### 2.2 逐项清单与冻结建议

下表的“应用”均指 **Agent 应用 API，不是内核公共 API**。

| # | 工具 | 当前真实用途／生产调用者 | 分类与建议 |
|---:|---|---|---|
| 1 | `health` | `createAgentClient().health`、`runtimeHealth()`；Agent 也用 Provider health 上报 readiness | **Agent 诊断契约**；内核可以私下查询其必要事实，不应冻结 Pi 健康结果为内核业务 API |
| 2 | `context` | Web/QQ/MCP 入口创建连续上下文；SDK wake 路径也依赖 context/run | **应用契约**；上下文身份及授权由内核保存，不把应用对话 journal 放进内核 |
| 3 | `run` | 入口应用提交上下文轮次；Coding 提交 execution | **应用契约**；内核只执行必要的授权、预算与入队 |
| 4 | `get` | 入口轮询状态；Coding 获取 execution | **应用契约**；结果事实由内核证据支持 |
| 5 | `lookup` | Coding 按 request key 恢复不确定的 start receipt | **应用契约**；保留幂等恢复目的，不新增全局业务目录 |
| 6 | `stream` | 入口读取 transcript/interactions；Coding 读取 execution events | **应用契约**；当前两个模式需要有意区分，不冻结混合 schema 为内核 API |
| 7 | `write` | 入口补充消息；Coding send | **应用契约**；授权和幂等 receipt 在内核，实际 inject 在 Agent |
| 8 | `interrupt` | 入口停止；Coding cancel | **应用契约**；内核记取消/撤权，Agent 实际停止，内核确认停止证据 |
| 9 | `respond` | 入口及 Coding 回答运行中的 question | **应用契约**；交互归属与权限校验留在内核 |
| 10 | `inspect` | Coding 取得 snapshot 和 result source | **Agent 的 execution 应用契约**；可由应用组织 inspection 结果，不把 Coding 验收策略放内核 |
| 11 | `placement` | Coding 读取已绑定执行位置 | **应用契约**；底层位置授权事实属于内核 |
| 12 | `locations` | Coding 查询可用执行位置 | **应用契约**；不得变成任意主机路径目录 |
| 13 | `cleanup` | Coding 发起 workspace preview/confirm | **应用契约 + 内核私有宿主执行**；不能让应用自行绕过停止证据清理目录 |
| 14 | `start` | Kernel `startLocalProvider()` 启动实际 Provider；模块分支另包一层 execution receipt | **Kernel 私有宿主契约**；模块 `start` 与 `run` 重复，未发现生产应用使用该模块入口，建议删除模块分支 |
| 15 | `status` | Kernel 轮询实际 Provider outcome；模块分支再查 execution | **Kernel 私有宿主契约**；模块分支与 `get` 重复，建议删除 |
| 16 | `inject` | Kernel 控制实际 Provider handle；模块分支转为 execution send | **Kernel 私有宿主契约**；模块分支与 `write` 重复，建议删除 |
| 17 | `abort` | Kernel 控制 Provider handle；模块分支转为 cancel | **Kernel 私有宿主契约**；模块分支与 `interrupt` 重复，建议删除 |
| 18 | `release` | Kernel 释放 Agent 活跃内存 handle，但保留防重放 receipt | **Kernel 私有宿主契约**；模块 execution release 仅标记 operation 已释放，与实际运行停止不是同一动作；建议删除无生产调用的模块入口 |
| 19 | `complete` | SDK `chrona.model()` 发起无工具的模型 completion；Kernel 分支接受已选定 model/timeout | **保留应用契约**；Kernel 分支是私有执行协议，不可允许普通模块自选模型绕过预算 |
| 20 | `completion` | SDK 查询 module completion receipt；Kernel 等待私有 completion | **保留应用契约及私有实现**；目前不能当“重复 status”直接删除 |
| 21 | `transcript` | Kernel 读指定宿主 sessionDir；模块分支实际读 execution events | **Kernel 私有 transcript 契约**；模块分支与 `stream` 重复且并非同一种 transcript，建议删除模块分支 |

工具声明来源：

- 9 个 runtime 名称：`packages/engine/src/modules/steward/builtin/agent/contracts.ts:4-12`
- 12 个 primitives：`packages/engine/src/modules/steward/builtin/agent/primitives.ts:9-37`

实际调用来源：

- 入口 context/run/get/stream：`packages/engine/src/modules/steward/entry-app/conversations.ts:92-108`
- 入口 write/interrupt/respond：`packages/engine/src/modules/steward/entry-app/conversations.ts:167`、`packages/engine/src/modules/steward/entry-app/conversations.ts:276-281`
- Coding 全部适配：`packages/engine/src/modules/steward/external/coding/agent.ts:12-40`
- Kernel start/status/release/inject/abort：`packages/engine/src/modules/steward/local-runtime.ts:35-58`
- Kernel health/complete/transcript client：`packages/engine/src/modules/steward/agent-client.ts:6-19`
- runtime health：`packages/engine/src/modules/steward/runtime-health.ts:12`
- SDK complete/completion：`packages/integrations/src/steward/module-sdk/sdk.ts:213-232`
- Kernel transcript：`packages/engine/src/modules/steward/transcript.ts:13`

#### 2.3 `release` 的确切含义不是“确认停止”

实际 Provider operations 的 release：

```ts
if (!row.outcome)
  throw new AgentError("conflict", "Agent completion remains unconfirmed");

rows.delete(args.operationId);
// Retain the receipt so a repeated start cannot launch the same Run again.
```

来源：`packages/engine/src/modules/steward/builtin/agent/operations.ts:59-64`。

模块 operation release 则是查询内核之后把 private receipt 标记为 `released`：

来源：`packages/engine/src/modules/steward/builtin/agent/module-operations.ts:65-72`。

这两者不可混为一种公共“释放运行”能力。

#### 2.4 completion 的生产消费者不能漏掉 SDK

`chrona.model()` 当前已经使用：

```ts
chrona.call("agent.complete", { ... })
chrona.call("agent.completion", { "operation-id": started.operationId })
```

来源：`packages/integrations/src/steward/module-sdk/sdk.ts:213-232`。

另一方面，旧的：

```ts
export async function completeForModule(
  ports: StewardPorts,
  scope: CallScope,
  params: ModelParams
)
```

仍在 `module-model.ts` 中完成 reserve → kernel completion → settle，但本次源码搜索没有发现它的生产调用者。

来源：`packages/engine/src/modules/steward/module-model.ts:24-32`。

### Inferences

- **删除的是重复的 module-facing execution operation 包装，不是实际 Provider 启停协议。**
- `complete/completion` 有 SDK 生产调用者，不属于可以直接删除的冗余。
- 当前共享名字同时承担两套信任等级，容易误读契约；应在冻结前明确区分应用入口与私有 host transport。无须因此新建一个“runtime 产品模块”。
- `module-model.ts` 属于优先核实删除的旧路径，不应因为它现在还存在而冻结第二条 completion 预算编排路径。

### Gaps

- “没有生产调用者”指本仓库生产 TypeScript 路径的搜索结果，不覆盖用户自行编写的未入库应用。用户明确不 grandfather 现有 API，因此这不构成保留重复入口的理由。
- 本报告不建议现在为未来 Providers 添加登记协议或扩展字段。

## 3. 真实身份、准入、项目绑定、预算、取消与停止证据必须在哪里执行？

### Takeaway

**Agent 调用内核，不意味着内核可以相信 Agent 参数中的原始调用者身份。** 必须从尚存活的 routed call 恢复真实原始调用者、原始参数和工作空间，再进行授权。

同时，Agent 负责证明其管理的 Provider 实际发生了什么；内核负责决定该证据是否足以改变共享治理状态。本机宿主负责物理目录事实，内核负责把物理事实绑定到已经授权的那一次运行。

### Cited Findings

#### 3.1 原始身份不能从 `args` 中取

签名：

```ts
export function retainAgentCaller(
  ports: StewardPorts,
  id: string,
  origin: Context,
  name: string,
  args: Record<string, unknown>
)
```

仅对真正的 module caller 保存原始 origin、操作名称与参数，返回释放函数：

来源：`packages/engine/src/modules/steward/agent-caller-context.ts:9-17`。

调用路由在 delivery 周期保存该上下文：

来源：`packages/engine/src/modules/steward/module-calls.ts:363-370`。

Agent delegate 的验证顺序：

1. 验证当前回调者是真实 builtin Agent；
2. 按 `callId` 找到 live caller context；
3. 验证 workspace 与 operation 一致；
4. 从 `context.origin.caller` 建立 `ExecutionPrincipal`；
5. 再校验该 principal。

```ts
const context = agentCaller(ports, String(args.callId));
if (!context)
  throw new CallError("forbidden", "Agent caller context expired or mismatched");

const { caller: original } = context.origin;
const principal: ExecutionPrincipal = {
  workspaceId,
  ownerId: "owner",
  caller: {
    kind: "module",
    moduleId: original.moduleId,
    hash: original.hash
  }
};
await assertExecutionPrincipal(ports.db, principal);
```

来源：`packages/engine/src/modules/steward/agent-delegation.ts:50-66`。

**关键点：准入使用 `context.args`，不是 Agent 转述的业务参数。**

来源：`packages/engine/src/modules/steward/agent-delegation.ts:65-71`。

#### 3.2 `runtime-callback` 三种方法的分类

| 方法 | 当前调用者与功能 | 冻结结论 |
|---|---|---|
| `event` | Agent 回传 progress、usage、resources、question、interrupt、detail；Kernel 为运行保留 callback | 内核私有宿主契约；不是任意模块可用的事件总线 |
| `agent-admit` | Agent 为 live routed module call 请求 context/execution/model admission；部分控制还有 settlement | 内核私有授权委托；不要冻结其当前枚举，把重复 operation 清理后再定边界 |
| `agent-settle` | Agent 在 completion 结束后结算之前的 reservation | 内核私有预算结算；允许异步结果晚于原始 routed call 生命周期到达，但须保留可信 Agent 身份与 reservation 约束 |

声明来源：`packages/engine/src/modules/steward/agent-delegation-port.ts:7-8`。

`event` 只接受 Kernel 或经验证的 builtin Agent；callback 绑定 workspace，并在运行结束释放：

来源：`packages/engine/src/modules/steward/local-provider.ts:15-22`、`packages/engine/src/modules/steward/local-provider.ts:42-50`。

当前 `agent-settle` 在 Agent 身份校验后，按 workspace 内已有 reservation 结算；没有重新要求 live 原始 call。这是异步 completion 的实际机制，不是允许应用自报一次消费。

来源：`packages/engine/src/modules/steward/agent-delegation.ts:50-55`；`packages/engine/src/modules/steward/module-model-budget.ts:43-52`。

#### 3.3 模型预算不能迁入 Agent 的私有文件自行裁决

`reserveCompletion()` 从可信 caller manifest、workspace model settings 和当前事件取得限制：

- 必须声明 `manifest.model`；
- tier 必须由 owner 配置；
- event call cap；
- module/global daily cap；
- output token cap；
- 创建持久化 pending reservation；
- 返回内核选定的 model/thinking/timeout。

来源：`packages/engine/src/modules/steward/module-model-budget.ts:16-40`。

Agent 执行时使用 reservation 返回的 model，而不是模块传入 model：

来源：`packages/engine/src/modules/steward/builtin/agent/module-operations.ts:31-39`。

**归属：模型请求执行在 Agent；共享预算 reservation/settlement 在内核。** completion 不需要被强行包装成 Coding work 或带工具 Run。

#### 3.4 Kernel 启动 Provider 也必须绑定已经 claim 的 Run

`authorizeAgentRequest()` 对 kernel `start` 做以下绑定：

- token 属于当前 Run；
- workspace 一致；
- `input.runId`、`operationId` 与 Run 一致；
- cwd、lane 一致；
- deadline 不超过已授权 deadline；
- 以 `local-provider-start:${run.id}` 写防重放 digest。

来源：`packages/engine/src/modules/steward/agent-application.ts:25-39`。

关键代码：

```ts
if ([
  authenticated.workspaceId !== workspaceId,
  run.id !== input.runId,
  input.operationId !== run.id,
  run.cwd !== input.cwd,
  run.lane !== input.lane,
  !run.deadlineAt,
  run.deadlineAt ? new Date(input.deadline) > run.deadlineAt : true
].some(Boolean))
  throw new StewardError("forbidden", "Agent start exceeds the claimed Run");
```

来源：`packages/engine/src/modules/steward/agent-application.ts:28-31`。

#### 3.5 项目 binding 必须跨 admission → queue → claim → launch 重验

不是每一层重复解析同一个内部值，而是在**可以发生授权变化的异步边界**重验：

- admission 从可信 resolver 获取项目，不相信 goal 文本中的路径；旧路径还验证 canonical realpath 和目录类型。  
  来源：`packages/engine/src/modules/steward/execution.ts:17-25`、`packages/engine/src/modules/steward/execution.ts:62-77`。
- queue claim 重新验证 grant、mapping revision、directory identity、executor generation、baseline。  
  来源：`packages/engine/src/modules/steward/execution-claim.ts:22-46`。
- 宿主准备绑定完整授权 request，返回 `bindingDigest` 和物理目录身份。  
  来源：`apps/server/src/execution-server-workspace.ts:8-25`。
- 内核验证 request digest、workspaceRef、mode、baseline、source receipt，以及 5 秒 freshness。  
  来源：`packages/engine/src/modules/steward/execution-server-workspace.ts:19-43`。
- 最终 writer transaction 确认准备结果仍对应相同 queued attempt，并持有物理锁。  
  来源：`packages/engine/src/modules/steward/execution-claim.ts:95-110`。
- launch 前再验证 principal、grant、resolved cwd 与 capability 未撤销。  
  来源：`packages/engine/src/modules/steward/execution-context.ts:18-29`、`packages/engine/src/modules/steward/execution-context.ts:73-81`。

宿主实际检查：

```ts
realpathSync(mapping.canonicalPath) !== mapping.canonicalPath
localDirectoryIdentity(mapping.canonicalPath) !== mapping.directoryIdentity
```

来源：`packages/integrations/src/executor/workspaces.ts:22`。

宿主锁明确采用保守恢复语义，不依据 PID/timeout 猜测偷锁：

来源：`packages/integrations/src/executor/workspaces.ts:158-194`。

#### 3.6 取消、实际停止、业务完成必须是三件事

Agent `abort` 只返回 requested，后台执行 handle abort：

来源：`packages/engine/src/modules/steward/builtin/agent/operations.ts:67-68`。

Pi 的 `done` 只在真实 process exit 后 resolve：

来源：`packages/integrations/src/steward/pi-provider.ts:231-249`。

内核只在实际 handle 完成后传入停止证据：

```ts
await runs.finish(run.id, outcome, { stopEvidence: "provider_exited" });
```

handle completion reject 分支不附加这种证据：

来源：`packages/engine/src/modules/steward/tick.ts:34-50`。

内核完成执行时，只有存在停止证据才写 `stopConfirmedAt` 并释放 `heldDirectory`：

```ts
...(evidence ? {
  stopConfirmedAt: now,
  stopEvidence: ...,
  heldDirectory: null
} : {})
```

来源：`packages/engine/src/modules/steward/execution-state.ts:49-59`。

未知停止继续占用 capacity：

```ts
const occupied = {
  stopConfirmedAt: null,
  run: { startedAt: { not: null } }
};
```

来源：`packages/engine/src/modules/steward/execution-claim.ts:32-38`。

此外，Provider 的 detail event 不能自行宣告 stop confirmed；内核覆盖其 state payload：

```ts
stopConfirmed: false
```

来源：`packages/engine/src/modules/steward/execution-context.ts:38-41`。

#### 3.7 `workspace-local` 六个方法全部是私有内核宿主操作

六者全部声明 `visibility: ["kernel"]`。

来源：`packages/engine/src/modules/steward/local-workspace.ts:51-61`。

| 方法 | 实际生产调用者 | 必要职责 |
|---|---|---|
| `prepare` | `prepareLocalWorkspace()`，被 execution admission/claim 使用 | 授权请求到物理 cwd、identity、lock 的转换 |
| `release` | `prepareLocalWorkspace()` 返回的 release | 释放此次 preparation 的锁，不是释放未知运行 |
| `cleanup` | execution v2 cleanup 路径 | 受治理的 preview/confirm 清理 |
| `capture` | `finalizeProvider()` 在 actual done 后调用 | 捕获已停止执行的结果 |
| `capture-file` | Provider reply 工具路径 | 从真实 Run cwd 捕获文件进入真实接收应用的 content |
| `result` | execution `resultSource()` | 读取已捕获结果，而不是重新从当前目录推导历史结果 |

来源：

- prepare/release 包装：`packages/engine/src/modules/steward/local-workspace.ts:70-74`
- admission：`packages/engine/src/modules/steward/execution-admission.ts:75`
- claim：`packages/engine/src/modules/steward/execution-claim.ts:123`
- cleanup：`packages/engine/src/modules/steward/execution-v2-tools.ts:55`
- capture：`packages/engine/src/modules/steward/tick.ts:40-45`
- capture-file：`packages/engine/src/modules/steward/tools.ts:19`
- result：`packages/engine/src/modules/steward/execution.ts:101`

### Inferences

#### 必须保留的 enforcement 位置

| 约束 | 执行位置 | 为什么不能仅交给应用 |
|---|---|---|
| 原始 caller 身份与当前版本 | 内核 router / admission | Agent 参数不能产生原始 caller 权限 |
| project grant、mapping、运行 scope | 内核 | 应用不能自行选择未授权 host path |
| realpath、inode/physical identity、锁 | 本机宿主实现 | 这些是真实 OS 状态，应用描述不是事实 |
| global/module/event 预算与运行资源占用 | 内核 | 多应用共享资源，需要统一裁决 |
| Provider inject/abort/process exit | Agent | Agent 拥有实际 Provider handle |
| stop evidence 是否足以释放资源 | 内核 | 不能由展示状态、cancel ACK 或租约到期替代 |
| Coding 完成、成果发布、人类 accept | Coding | 这是业务生命周期，不是 OS 停止事实 |

**不能把“代码从 engine 移到 Agent”当成完成解耦。** 如果仍要保护共享预算、队列和实际停止证据，就必须保留窄的内核 enforcement；如果只是把原函数换个模块名字却保留业务策略，则没有完成最小化。

### Gaps

- 未执行竞态或 crash 测试；上述结论依据生产控制流。
- `reserveCompletion()` 的并发隔离细节未在本报告中独立审计，不将源码注释等同于已重新验证的并发保证。

## 4. 当前 Execution/Work/event schema 是否把 Coding 策略泄漏进内核？

### Takeaway

**共享 schema 文件中确实混放了 Agent execution、Coding work、editor transport、结果验收等不同层的契约。文件位置不是产品归属。**

当前运行时也确实有 Coding 专项策略留在内核。永久冻结前应把业务策略迁出，但不能连同目录授权、资源上限和停止证据一起删除。

### Cited Findings

#### 4.1 Coding 的业务编排已经主要在应用中

`callAgent()` 明确将 Coding operation 转为 Agent primitives：

```ts
"lookup-start" → "lookup"
send → "write"
cancel → "interrupt"
events → "stream"
```

`snapshot` 与 `result-source` 都由 `agent.inspect` 取回，再由 Coding 拆分。

来源：`packages/engine/src/modules/steward/external/coding/agent.ts:12-40`。

Coding 的 list 来自自己的 private registry，再逐个向 Agent 取运行事实，不是 Agent-wide business list：

来源：`packages/engine/src/modules/steward/external/coding/agent.ts:44-60`。

Coding 向 prompt 添加每轮原生读取 `AGENTS.md` 的指令：

来源：`packages/engine/src/modules/steward/external/coding/index.ts:17`。

这是正确的应用所有权实例。

#### 4.2 Work/group/dependency/accept 不是最小内核契约

共享文件包含：

- group children、DAG cycle 校验；
- parent/dependency/blockedBy；
- dependencyResults；
- results；
- owner accept；
- editor request/response envelope；
- `/api/editor/v1/commands` transport。

来源：

- `packages/contracts/src/steward/execution-v2.ts:14-35`
- `packages/contracts/src/steward/execution-v2.ts:38-64`
- `packages/contracts/src/steward/execution.ts:43-46`
- `packages/contracts/src/steward/execution.ts:69-73`

但内核的 v2 start 已经刻意只接受 leaf：

```ts
export const executionStartV2Schema =
  workLeafStartSchema.omit({
    parentWorkId: true,
    dependsOnWorkIds: true
  });
```

来源：`packages/contracts/src/steward/execution-v2.ts:117-118`。

**不能因为 `work*` 被 exports 了，就把整个 Work 协议一起冻结为内核功能。**

#### 4.3 当前确实存在 Coding 特化的内核策略

包括：

- `codingCapacity()`；
- `EXECUTOR_LIMITS.codingGlobal / codingEnvironment / codingApplication`；
- ordinary 与 execution 两类 launch loop；
- execution 固定 background lane；
- `EXECUTION_SYSTEM_PROMPT`；
- minimal resources；
- `extraTools: []`、`searchTools: false`；
- 固定的 execution goal/prompt 包装。

来源：

- `packages/engine/src/modules/steward/execution-claim.ts:32-38`
- `packages/engine/src/modules/steward/tick.ts:130-140`
- `packages/engine/src/modules/steward/execution-context.ts:3-4`
- `packages/engine/src/modules/steward/execution-context.ts:63-70`

事件 schema 还混合了消息、工具展示、questions、snapshot/finalMessage 与运行控制状态：

来源：`packages/contracts/src/steward/execution-events.ts:26-43`。

### Inferences

#### 应拆分的不是名称，而是决定权

| 当前内容 | 冻结前归属建议 |
|---|---|
| Coding 的默认项目、规则读取、prompt 包装、任务依赖、成果验收 | Coding |
| Provider 的 execution profile、transcript/message/tool 适配 | Agent |
| Editor 协议与页面 projection | Editor/Coding/Web |
| timeout/tool/resource 硬上限、capacity 占用、Run token、取消撤权 | 内核 |
| 消息流展示格式、finalMessage 摘取方式 | Agent/消费应用 |
| sequence、身份绑定、bounded storage、敏感信息边界、停止事实 | 保留在必要的内核或可信宿主边界 |

内核可以保留**已经有真实消费者需要的执行资源控制**，但不应永久冻结：

- “编码运行固定在 background”的业务选择；
- Coding 特定 system prompt；
- Coding group/dependency policy；
- 结果是否“验收完成”的定义。

同样，不应现在为消除这些硬编码而建立一个无限可扩展的 profile/plugin framework。先让现有 Agent/Coding 承担它们已经拥有的真实策略。

### Gaps

- 本报告未给出事件存储 schema 的完整迁移设计。
- 不能仅凭 `coding*` 命名就删除容量检查；需要保留它目前保护的共享资源和未知停止约束，再迁出业务专属参数与默认值。

## 5. Web/Notify 是否需要 builtin？怎样成为普通可移除、可替换的预装应用？

### Takeaway

**Web 和 Notify 不需要可信 builtin 身份。** 当前它们不能移除，主要来自 builtin identity、seed 和通用 entry removal guard；它们的业务工作已大多通过普通 routed calls 实现。

但“改成 external”本身不够：必须同时去掉自动补装行为、处理真实应用依赖，并让替换走现有 lifecycle、HTTP listen 和 fact-consumer selection，不能另建一套并行平台。

### Cited Findings

#### 5.1 当前禁止移除来自身份规则，不是功能必须

```ts
remove: external && options.removable !== false
```

来源：`packages/engine/src/modules/steward/module-identity.ts:17-23`。

动态 guard 对 builtin 的 remove/install 一律拒绝；Agent 另外禁止所有动态代码生命周期：

来源：`packages/engine/src/modules/steward/module-identity.ts:30-33`。

所以当前：

- Agent 不可动态替换；
- Web/Notify 可以走 checked build/propose/update 等流程；
- Web/Notify 仍不可删除。

这些是现状，不是本次目标要求保留的最终产品边界。

#### 5.2 Seed 会重建缺失的 builtin，不能只解除删除按钮

`registerBuiltins()` 对 `BUILTIN_MODULE_NAMES` 循环：

```ts
if (current?.activeHash) continue;
...
module.upsert(...)
...
activateBuiltinReleaseIn(...)
```

来源：`packages/engine/src/modules/steward/module-builtin.ts:99-125`。

因此如果 Web/Notify 仍留在 builtin seed 列表，删除后还可能被后续注册重新 seed。

现有代码已有把 `mcp/files/events` 从 builtin 分类转为普通应用且不覆盖代码/数据的先例：

来源：`packages/engine/src/modules/steward/module-builtin.ts:94-96`。

#### 5.3 普通 entry 也有独立 removal guard

```ts
if (manifest && isEntryModule(manifest) && !isRemovableMcp(module))
  throw new StewardError(
    "conflict",
    `${module.name} 是入口应用，不能删除；可以停用`
  );
```

来源：`packages/engine/src/modules/steward/module-remove.ts:24-30`。

所以 Web 即使不再 builtin，仍会因为 entry guard 不能移除。

删除还要保留：

- execution idle / unknown-stop guard；
- active dependent manifests；
- active sessions；
- queued/running work；
- unknown invocations；
- unhandled replies；
- 一次性 delete-data approval；
- 删除前 backup；
- approval transaction 中再次验证。

来源：`packages/engine/src/modules/steward/module-remove.ts:24-66`、`packages/engine/src/modules/steward/module-remove.ts:69-110`。

这不是要求取消删除审批，而是要求**不再以“它是入口应用”作为永久不可删除的充分理由**。

#### 5.4 Web 的 HTTP 路径已是通用 `listen`，不需要特权 Web host

Server 将未被内核处理的 `/api/...` 路由代理到对应 module listener，页面请求代理到声明 `listen: "/"` 的模块。

来源：`apps/server/src/app.ts:133-142`。

模块不可用时返回：

```ts
Response.json({ code: "MODULE_UNAVAILABLE" }, { status: 503 })
```

来源：`apps/server/src/app.ts:35-46`。

因此 Web 替换可以复用：

1. 现有应用安装/更新；
2. 现有 listen 声明；
3. 现有受控生命周期。

不需要给新 Web 再增加专属内核 HTTP 分发机制。

#### 5.5 Notify 的内核事实消费已经不依赖名字

默认 consumer 仅由发行安装 seed：

来源：`packages/engine/src/modules/steward/module-builtin.ts:90-92`。

```ts
seedFactConsumer(...)
// upsert update: {}
```

显式 null 和后续选择不会被覆盖：

来源：`packages/engine/src/modules/steward/notification-facts.ts:54-61`。

切换要求：

- 先暂停前一个 active consumer；
- 新 consumer 是 active 且有 activeHash 的应用；
- 持久化新的 revision；
- 已 ACK 的事实不会重放。

来源：`packages/engine/src/modules/steward/notification-facts.ts:62-71`。

facts/ACK/withdrawals 验证的是被选中的真实 moduleId、activeHash 与 revision，不是 `name === "notify"`：

来源：`packages/engine/src/modules/steward/notification-facts.ts:73-108`。

这已经是 kernel-independent replacement 所需的机制主体。

#### 5.6 真实依赖必须处理，不能宣称换名后所有应用自动跟随

现有依赖包括：

| 应用 | 对 Web/Notify 的实际依赖 |
|---|---|
| QQ | `notify.channel` 注册交付渠道；异步结果通过 `notify.send` |
| Remind | `notify.send`；`web.page-set` |
| Files | `web.page-set` |
| Coding | `web.page-set` |
| Mind | `web.today`；`web.page-set` |
| MCP | `web.today` 提供 owner 的 today 聚合 |
| 入口 Agent tool selection | 默认工具列表含 `notify.send` |

来源：

- `packages/engine/src/modules/steward/external/qq/index.ts:40`、`packages/engine/src/modules/steward/external/qq/index.ts:65`
- `packages/engine/src/modules/steward/external/remind/index.ts:6-15`
- `packages/engine/src/modules/steward/external/files/index.ts:9`
- `packages/engine/src/modules/steward/external/coding/index.ts:36`
- `packages/engine/src/modules/steward/external/mind/index.ts:196`、`packages/engine/src/modules/steward/external/mind/index.ts:367`
- `packages/engine/src/modules/steward/external/mcp/index.ts:38`
- `packages/engine/src/modules/steward/external/mcp/agent-conversations.ts:80`

删除检查会拒绝仍被 active manifest `uses` 依赖的模块：

来源：`packages/engine/src/modules/steward/module-remove.ts:34-40`。

### Inferences

#### 不引入平行机制的最小替换路径

**Web：**

- 从 trusted builtin seed/不可移除身份规则中移出，改为普通预装应用；
- 保留现有 checked lifecycle；
- 允许在满足 in-flight/unknown-stop/dependency/data-approval 等检查后移除入口应用；
- 用现有 `listen` 接管页面；
- 更新仍调用旧 Web 的应用，或者在旧 Web 普通应用身份下发布兼容现有工具的新实现。

**Notify：**

- 从 builtin seed 与不可移除身份规则中移出；
- Kernel 继续只保存事实，不主动选择渠道或调用 `notify.send`；
- 使用现有 `activity.consumer` 选择替代事实消费者；
- 应用到应用的 `notify.send/channel` 依赖，通过更新调用应用或普通模块版本替换处理；
- 不新增 kernel notification router，也不把业务通知别名提升为永久内核接口。

**重要区别：**

- Kernel fact consumer selection 只解决**谁消费内核事实**；
- 它不会自动把应用的 `notify.send` 改成 `other-notifier.send`；
- HTTP listener 解决**谁服务路径**；
- 它不会自动把应用的 `web.page-set` 改成另一个名字。

当前没有必要为此新增 provider-like 泛化能力注册框架。现有应用生命周期与普通调用足够承载第一步替换。

#### 冻结前还应清理内核事实中的通知策略泄漏

当前内核 `noticeSchema` 仍包含：

```ts
level: z.enum(["now", "digest", "web"])
```

来源：`packages/engine/src/modules/steward/notification-facts.ts:22`。

这把 Notify 的交付分类写进了内核事实契约。若目标是永久冻结最小内核，应让内核记录必要事实，由消费者决定是否 now/digest/web；不能仅因已经存在就永久保留。

### Gaps

- 未研究全部 official package seed/安装 receipt 实现，因此本报告给出的是复用既有生命周期的边界方向，不是完整安装迁移补丁。
- 同名应用替换也必须经过现有代码、数据 schema、凭据、迁移和 approval 检查；“可替换”不等于任意代码可直接冒充旧身份。

## 6. Notify 非选定消费者无法交付应用通知的问题是否真实？最小修复是什么？

### Takeaway

**问题真实存在，源码可以直接证明：Notify 的全部交付 tick 被内核事实摄取成功与否绑住了。** 当 Notify 不再是选定 fact consumer 时，`activity.facts` 返回 forbidden，普通应用调用 `notify.send` 新增的通知也不会进入正常交付 tick。

但“捕获错误后无条件执行全部 `notify.tick()`”不是完整安全修复：它可能使旧内核通知绕过撤回 reconciliation 后继续交付。

### Cited Findings

#### 6.1 现有错误链

Notify 主 tick：

```ts
if (
  await ingestKernelFacts(
    store,
    notify,
    (target, args) => chrona.call(target, args),
    now
  )
) await notify.tick(now);
```

外层 catch 仅记录 `tick_failed`：

来源：`packages/engine/src/modules/steward/builtin/notify/index.ts:15-28`。

摄取第一步：

```ts
const page = await call("activity.facts", {}) as Page;
```

来源：`packages/engine/src/modules/steward/builtin/notify/facts.ts:15-18`。

内核：

```ts
if (caller.kind !== "module" || caller.moduleId !== selected.moduleId)
  throw new CallError(
    "forbidden",
    "Only the selected application consumes kernel facts"
  );
```

来源：`packages/engine/src/modules/steward/notification-facts.ts:73-79`。

因此：

```text
consumer = null 或其他应用
→ Notify activity.facts forbidden
→ ingestKernelFacts reject
→ notify.tick 不执行
→ recover / digest / deliverDue 全部不执行
```

`notify.tick()` 的具体内容：

```ts
async tick(now: Date) {
  await this.refresh();
  await this.recover(now);
  this.digest(now);
  await this.deliverDue(now);
}
```

来源：`packages/engine/src/modules/steward/builtin/notify/notify.ts:309`。

而普通应用 `send` 确实仍会把通知写入私有队列，并请求 tick：

来源：

- `packages/engine/src/modules/steward/builtin/notify/notify.ts:108-121`
- `packages/engine/src/modules/steward/builtin/notify/index.ts:35-38`

#### 6.2 为什么不能无条件忽略事实失败？

`ingestKernelFacts()` 刻意要求：

- durable ingest 后再 ACK；
- ACK 后再交付；
- 未读完撤回 backlog 不交付；
- 空页后 reconcile 已存在 queued/folded 通知的撤回；
- lost ACK reply 使用 staged receipt 恢复。

来源：`packages/engine/src/modules/steward/builtin/notify/facts.ts:14-40`、`packages/engine/src/modules/steward/builtin/notify/facts.ts:43-61`。

当前通用 delivery loop 查询所有 queued rows，不区分该 row 是否来自内核事实：

来源：`packages/engine/src/modules/steward/builtin/notify/notify.ts:152-165`。

digest 同样从全部 folded rows 取材：

来源：`packages/engine/src/modules/steward/builtin/notify/notify.ts:184-195`。

### Inferences

#### 最小正确修复的行为边界

修复应只改 Notify 应用，不改内核 fact admission：

1. **把普通应用通知交付与内核事实摄取的成败解耦。**
2. 不被选中时，Notify 仍可正常处理普通应用通过 `notify.send` 提交的通知。
3. 内核事实来源的 pending 通知，只能在成功完成相应摄取、ACK 与 withdrawal reconciliation 后交付。
4. 非选定状态、事实读取错误或分页未完成时，继续阻止这部分内核通知；不能把失败当作“没有事实”。
5. digest 必须遵守相同来源边界，不能通过摘要把被阻止的内核内容重新发送。
6. 已发出的异步调用仍按原 call receipt 恢复，不因消费者切换自动重发。

现有 module-origin send key 使用 `module:${caller.moduleId}:...` 命名空间，可作为识别普通应用来源的现有线索：

来源：`packages/engine/src/modules/steward/builtin/notify/notify.ts:96-100`。

但最终补丁仍须覆盖 staged facts 与 digest 来源，不能只用一个 `catch` 绕过整条安全门。

**不需要的修复：**

- 让所有 Notify 实例都能读内核 facts；
- Kernel 自动 fallback 回 Notify；
- 把 Notify 强制保持 selected；
- 在 Kernel 新建第二条通知发送路径。

这些都会破坏现有“单个 owner-selected consumer”边界，而不是修复 Notify 应用内部的过度耦合。

### Gaps

- 本报告没有实施修复，也没有运行回归测试。
- 最小回归验收应包含：consumer=null、切到另一 consumer、普通通知仍交付、旧内核通知不误交付、withdrawal backlog、digest 混合来源、lost ACK reply。这里仅列验收范围，不宣称已经通过。

## 7. UI 的“运行能力”应如何分组，才不制造伪模块？

### Takeaway

当前 UI 把两个内核内部 registration 单独显示为“运行能力”，虽然 backend 已将它们标记为 kernel。应把它们并回**内核内部实现信息**，而不是改名字后继续作为一类可管理的应用。

### Cited Findings

当前两项恰好是：

- `runtime-callback`
- `workspace-local`

`localCapabilities()` 注册这两项，再读取 local registry；排除测试/注入场景中的 `agent`：

来源：`packages/engine/src/modules/steward/local-capability-view.ts:11-18`。

Backend：

```ts
origin: "kernel"
```

来源：`packages/engine/src/modules/steward/system-apps.ts:20-24`。

UI 却按有无 `runtime` 字段分开：

```ts
apps.filter(app => app.runtime)
system.filter(app => !app.runtime)
```

来源：`packages/engine/src/modules/steward/builtin/web/src/system/apps.ts:69-75`、`packages/engine/src/modules/steward/builtin/web/src/system/apps.ts:92-96`。

当前还分别展示“内置应用”“外置应用”，并写着内置应用不能删除：

来源：`packages/engine/src/modules/steward/builtin/web/src/system/apps.ts:64-67`。

### Inferences

最终产品分类应是：

- **应用**
  - Web、Notify：普通预装、可移除、可替换；
  - Agent：可信 builtin 应用，有明确不可动态替换的安全属性；
  - 其他安装应用。
- **内核**
  - 公共治理接口；
  - 必要时在诊断详情中显示 callback/workspace 这类内部实现信息。

可以显示“预装”“可信 builtin”等属性，但不要把它们变成第三类产品能力或另一套生命周期。

**不是完成条件：**

- 将“运行能力”改名为“宿主模块”；
- 给 `runtime-callback`/`workspace-local` 补上 app 卡片和 enable/remove；
- 为它们创建空 SDK 包装，只为了看起来“全部模块化”。

**真正的完成条件：**

- 应用目录不再把内核 registration 当成独立产品；
- 它们仍由内核维护真实授权和停止边界；
- Agent 的应用 API 与私有宿主协议有明确范围；
- Web/Notify 的普通应用身份不再被 seed 和 removal guard 暗中推翻。

### Gaps

未启动浏览器；UI 结论来自声明式页面源码，不包含视觉验收。

---

**最终建议：先清理，再冻结。** 保留一个可信 Agent，把 Provider 执行留在 Agent；把 Web/Notify 变成真正普通的预装应用；把两个 local registrations 收回内核实现视图；删除 Agent 重复的模块 execution 操作；把 Coding、通知和展示策略从永久内核契约中剥离。真实身份、项目授权绑定、共享预算与队列、取消撤权、实际停止证据不能随业务代码一起迁走。

未运行测试或修改源码。最需要避免的风险是：把取消当停止、把注册名称当产品边界，以及用无条件 Notify tick 绕过内核事实撤回保护。