# Chrona 永久冻结研究：approvals / settings / schedules / secrets / activity / projects

## 1. 结论与冻结边界

### Takeaway

**不应把这六组现有 API 原样宣布为永久接口。** 当前共有 **29 个工具**；其中既有不可移走的信任边界，也有应用业务、Pi 细节、宿主文件系统操作和已无生产调用者的旧策略设施。

永久冻结应发生在裁剪、迁移和权限补齐之后。冻结后的公开 API 只允许增加，因此现在保留的每个字段都意味着长期兼容责任。本报告不把“当前存在”“已有 UI 调用”当作不可删除的理由。

### Cited Findings

- 基线为 `/home/saya/workspace/Chrona`，`HEAD cf19ceb7`；`git status --short`、`git diff --stat` 均无改动输出。本次只读源码和文档，未运行应用、测试、数据库、模型或网络操作。
- 当前工具注册确实仍区分 system/local/application，而非只有 kernel/modules：`packages/engine/src/modules/steward/module-registry.ts:4-27`；应用路由解析还特判 builtin Agent：`packages/engine/src/modules/steward/module-calls.ts:133-158`。本报告按用户要求的目标模型分类，不认可这些现状为永久分类。
- SDK 已把真实调用者交给应用工具，包含 `module/moduleId/hash`，不需要发明第二套应用间 RPC：`packages/integrations/src/steward/module-sdk/sdk.ts:9-17`；实际投递经既有 supervisor 和 caller fence：`packages/engine/src/modules/steward/module-calls.ts:305-310`。
- 原子 Run admission、取消、实际停止证据仍是内核执行边界。队列明确把 `"Execution stop is unconfirmed"` 和未确认停止的 execution 当作占用：`packages/engine/src/modules/steward/runs.ts:137-145`。这些不能随业务 API 移出而消失。

### Inferences

分类含义：

| 分类 | 本报告含义 |
|---|---|
| **FREEZE** | 保留最小公开内核语义；**不等于冻结当前全部字段** |
| **PRIVATE** | 内核或宿主必须执行，但没有必要成为稳定的模块公开接口 |
| **MOVE** | 移交应用，包括可信 builtin Agent；执行侧约束仍留在必要信任边界 |
| **DELETE** | 删除死代码、重复接口或离线历史兼容；不代表删除用户历史数据 |

建议总体边界：

1. **内核保留**真实身份、路由权限、版本/activation fence、执行资源 admission、原子预算占用、取消/未知停止、生命周期审批绑定、有限审计事实。
2. **Agent 接管**模型选择、Pi thinking、模型层级及其配置展示；未来 provider 接入属于 Agent。此次不设计或实现注册框架。
3. **普通模块接管**日历规则、提醒、业务审批工作流、通知措辞/级别/渠道、配置表单和页面聚合。
4. **宿主私有能力保留**安全项目目录创建、canonical path/目录身份、凭据安全存储。业务模块不因拿到某个字符串而自行取得这类能力。
5. Web、Notify 作为普通预装模块，不应靠 builtin 身份或名字取得权限。首次安装选中 Notify 是安装行为，不是内核运行时依赖。

### Gaps / blockers

- **当前公开权限不足以直接冻结**：`entry(caller)` 只检查 `caller.kind === "module"`，并不验证 entry manifest；默认工具 visibility 是 `["modules"]`。见 `packages/engine/src/modules/steward/system/shared.ts:6-12`。路由对这种 visibility 直接允许模块调用，`uses` 不参与一般运行时 admission：`packages/engine/src/modules/steward/module-calls.ts:160-168`。
- 因此 `approvals.resolve`、`approvals.revoke-grant`、`settings.update`、`schedules.update` 不能仅凭描述中的“用户决定后”“entry modules”被视为 owner-only。冻结前必须明确并落实真实 owner/授权入口边界。
- 未提供手工结果文件路径；本报告作为最终 Markdown 返回，由委派环境自动保存。未自行写文件。
- 可用工具中没有 Hindsight/CodeGraph；结论全部基于本地源码和文档，不采用注入记忆作为事实来源。

## 2. 全部 29 个工具：输入、输出、生产调用者与去向

### Takeaway

**应冻结的是最小权限与持久事实语义，不是六个 namespace 的当前形状。** 下表覆盖全部 29 个工具。标为“未发现生产调用”的接口，搜索范围为 `packages/`、`apps/` 中非测试源码，排除生成 bundle；这不证明仓库外没有调用者。

### Cited Findings

#### 2.1 公共输出形状

以下简写用于工具表；不是拟议新类型。

| 简写 | 当前完整字段 / 证据 |
|---|---|
| `Approval` | `id, action, moduleId, title, detail, preview, status, createdAt, resolvedAt`；`packages/contracts/src/steward/index.ts:415-423` |
| `Grant` | `id, action, mode, scope, once, consumedAt, expiresAt, createdAt, revokedAt`；scope 为 global 或 moduleId；`packages/contracts/src/steward/index.ts:424-431` |
| `Settings` | `timezone, modelUsage[{module,calls,inputTokens,outputTokens}], moduleModel`；`packages/contracts/src/steward/index.ts:481-487` |
| `Schedule` | `id,mode,rule,text,originSessionId,moduleId,until,status,nextAt,lastAt,lastResult,label,createdBy,createdAt`；**不包含 triggerId，也不包含 payload**；`packages/contracts/src/steward/index.ts:366-380` |
| `Project` | `{projectRef,path,label}`；`packages/engine/src/modules/steward/system/projects.ts:6` |
| `RunView` | `id,sessionId,sessionTitle,active,status,progress,usage,resources,interactions,updatedAt`；progress 为 phase/tool；usage 含 run/session scope、token/cache/cost/context；resources 含 version/skills/extensions；`packages/contracts/src/steward/provider.ts:6-34` |
| `Runtime` | `at,provider{name,available,sandboxed,lastError},moduleSandbox,queuedRuns,runningRuns,failedRunsToday,dueSchedules,lastTickAt`；不含通知计数；`packages/engine/src/modules/steward/system-outputs.ts:11`、`packages/engine/src/modules/steward/runtime-health.ts:8-26` |

除 activity/projects 的显式设置外，这些工具默认 module-visible；工具输出绑定集中于 `packages/engine/src/modules/steward/system-outputs.ts:18-21`、`packages/engine/src/modules/steward/system-outputs.ts:74-88`。

#### 2.2 approvals：6 个

定义与入口：`packages/engine/src/modules/steward/system/approvals.ts:30-60`。

| 工具 | 当前输入 → 输出 | 实际生产调用者 | 分类与最小语义 |
|---|---|---|---|
| `approvals.grants` | `{}` → `Grant[]`，活跃与历史 | Web 设置聚合：`packages/engine/src/modules/steward/builtin/web/settings.ts:10-14` | **PRIVATE / DELETE 公共旧投影**。当前通用策略执行链无生产调用，不能因设置页存在而永久冻结动作枚举和历史 grant 形状 |
| `approvals.revoke-grant` | `{grant}` → `Grant` | Web POST：`packages/engine/src/modules/steward/builtin/web/index.ts:92` | **PRIVATE**，保留撤销真实有效授权的机制；只有确定仍实际生效的授权才需要公开管理入口，不冻结旧 action grant 结构 |
| `approvals.list` | `{status?}`，默认 open → `Approval[]` | Web 今日：`packages/engine/src/modules/steward/builtin/web/today.ts:21`；QQ：`packages/engine/src/modules/steward/external/qq/relay.ts:43`；MCP：`packages/engine/src/modules/steward/external/mcp/index.ts:60` | **FREEZE，裁剪后**。授权入口读取待决定的内核操作；不应承诺所有业务审批均进入内核 |
| `approvals.resolve` | `{approval,decision:approve\|deny,scope?:once\|always}` → `Approval` | Web：`packages/engine/src/modules/steward/builtin/web/index.ts:88`；QQ：`packages/engine/src/modules/steward/external/qq/relay.ts:47`；MCP：`packages/engine/src/modules/steward/external/mcp/index.ts:63` | **FREEZE，裁剪后**。真实 owner 决定精确绑定的操作；生命周期决定仅一次；不能冻结“批准任意 action 自动产生长期 grant” |
| `approvals.request` | `{title,detail?,preview?}`，必须 async → `{approval,decision:approved\|denied}` | 未发现预装应用直接生产调用；存在协议/测试用途 | **MOVE**业务决定到发起应用/入口。它当前只是通用人工工作流，不应伪装为 `modify_external` 内核授权。移走前保存 waiting-call 的幂等与结果绑定 |
| `approvals.status` | `{approval}` → `{approval,status,hash,resolvedAt}` | 未发现预装应用直接生产调用 | **MOVE**，随业务请求状态归属应用；不公开内核审批 DB 作为通用工作流存储 |

补充宿主调用：救援 HTTP 直接调用 service 的 list/resolve，`apps/server/src/rescue.ts:44-45`；CLI 直接调用同一 service，`packages/cli/src/admin.ts:57-59`。它们不是模块工具调用，但必须保留为内核授权恢复途径。

#### 2.3 settings：2 个

定义：`packages/engine/src/modules/steward/system/settings.ts:8-21`。

| 工具 | 当前输入 → 输出 | 实际生产调用者 | 分类与最小语义 |
|---|---|---|---|
| `settings.get` | `{}` → `Settings` | Web：`packages/engine/src/modules/steward/builtin/web/settings.ts:10-15` | **MOVE**模型配置与模型用量展示到 Agent；内核执行预算数据保持私有或经必要的窄投影提供。没有必要冻结通用 `settings` namespace |
| `settings.update` | `{settings:string(JSON)}`；内层仅 `timezone?,moduleModel?` → `Settings` | Web：`packages/engine/src/modules/steward/builtin/web/settings.ts:25-30` | **MOVE**模型策略配置到可信 Agent 的 owner 入口；内核资源治理参数仍由内核验证/执行。不能让普通模块直接抬高自己预算 |

`moduleModel` 的全部字段：`models`、`maxCallsPerEvent`、`maxOutputTokens`、`dailyCalls`、`timeoutMs`、`moduleDailyCalls?`。`models` 取值为 model 字符串或 `{model,thinking?}`；`thinking` 使用 Pi 的固定枚举。见 `packages/contracts/src/steward/index.ts:445-467`。

#### 2.4 schedules：5 个

定义：`packages/engine/src/modules/steward/system/schedules.ts:12-34`。

| 工具 | 当前输入 → 输出 | 实际生产调用者 | 分类与最小语义 |
|---|---|---|---|
| `schedules.list` | `{timers?:boolean}` → `Schedule[]`；全状态、创建时间倒序 | Web 今日：`packages/engine/src/modules/steward/builtin/web/today.ts:21`；设置：`packages/engine/src/modules/steward/builtin/web/settings.ts:12` | **MOVE**日程目录/聚合到调度应用；内核没有“全体业务日程页面”职责 |
| `schedules.update` | `{schedule,status:active\|paused\|cancelled}` → `Schedule` | Web：`packages/engine/src/modules/steward/builtin/web/index.ts:94` | **MOVE**日程管理；取消排队执行仍必须在内核 invocation 边界生效，不能只改应用 UI 状态 |
| `schedules.create` | `{key,rule:string(JSON),payload:string(JSON),label,until?}` → `Schedule` | Remind：`packages/engine/src/modules/steward/external/remind/index.ts:23`；Coding 每 5 分钟检查：`packages/engine/src/modules/steward/external/coding/index.ts:37` | **MOVE**规则与持久 timer 服务；现有可靠投递内核机制暂 **PRIVATE**。若选择保留内核 timer，只证明了最小定点唤醒的需要，未证明 daily/weekly/label 等必须永久公开 |
| `schedules.cancel` | `{key}` → `{cancelled:boolean}` | Remind：`packages/engine/src/modules/steward/external/remind/index.ts:30` | **MOVE**；保留 timer 所有权和已排队 occurrence 取消，不把取消等同于已运行效果撤销 |
| `schedules.mine` | `{}` → `(Schedule & {key,payload})[]`，active/paused，nextAt 顺序 | Remind：`packages/engine/src/modules/steward/external/remind/index.ts:27` | **MOVE**应用私有 timer 列表 |

Mind 给 Agent 的工具集合还列出三种 timer 能力：`packages/engine/src/modules/steward/external/mind/execution.ts:8`。这是生产间接使用路径，不是 Mind 本身直接调用。

#### 2.5 secrets：6 个

定义及 dispatch：`packages/engine/src/modules/steward/system/secrets.ts:33-64`。

| 工具 | 当前输入 → 输出 | 实际生产调用者 | 分类与最小语义 |
|---|---|---|---|
| `secrets.get` | `{name}` → `{value:Record<string,string>}`，过滤受管隐藏字段 | QQ `qq_bot`：`packages/engine/src/modules/steward/external/qq/index.ts:50`；Mind：`packages/engine/src/modules/steward/external/mind/index.ts:263`；memory-local：`packages/engine/src/modules/steward/external/memory-local/index.ts:19`；SDK shorthand：`packages/integrations/src/steward/module-sdk/sdk.ts:137` | **FREEZE，裁剪后**。真实当前调用模块只能领取已批准声明的凭据；敏感输入输出不可记录。存储格式、QQ 环境特例、OAuth 字段不属于永久语义 |
| `secrets.set` | `{name,value:string(JSON),merge?:boolean}` → `{name,configured:true}` | Web：`packages/engine/src/modules/steward/builtin/web/index.ts:101` | **PRIVATE**凭据写入/owner 管理边界；表单与字段说明 **MOVE**应用。需要一个受保护写入途径，不等于需要所有模块永久知道此工具 |
| `secrets.remove` | `{name,field?}` → `{name,configured:boolean}` | Web：`packages/engine/src/modules/steward/builtin/web/index.ts:102` | **PRIVATE**删除与失效机制；保留并发 refresh 不得复活已删除凭据 |
| `secrets.list` | `{}` → `[{name,configured,updatedAt,modules}]`，不返回值 | Web credentials：`packages/engine/src/modules/steward/builtin/web/index.ts:161`；设置聚合：`packages/engine/src/modules/steward/builtin/web/settings.ts:12` | **PRIVATE**保管状态与声明查询；应用组合 UI，不冻结全局凭据管理业务结构 |
| `secrets.authorize` | `{name,provider,scopes,account?}` → `{url,redirectUri,expiresAt}` | Web：`packages/engine/src/modules/steward/builtin/web/index.ts:104`；SDK/生成模块可调用 | **MOVE**OAuth 协议服务；批准定义、凭据领取及隐私处理保持必要边界。不得冻结 Google/Microsoft 为内核 provider 枚举 |
| `secrets.token` | `{name,provider,account?}` → `{accessToken,expiresAt}` | SDK shorthand/child token injection：`packages/integrations/src/steward/module-sdk/sdk.ts:139-155`；未发现预装业务模块直接调用 | **MOVE**OAuth token 服务；短期令牌交付仍走不可记录的受控调用。不可直接替换成普通、会持久化结果的应用工具 |

`get/set/authorize/token` 当前列入 `unrecorded`，`packages/engine/src/modules/steward/system/secrets.ts:36`；路由拒绝这类工具 async 调用，`packages/engine/src/modules/steward/module-calls.ts:389`。

#### 2.6 activity：7 个

定义：`packages/engine/src/modules/steward/system/activity.ts:28-54`。

| 工具 | 当前输入 → 输出 | 实际生产调用者 | 分类与最小语义 |
|---|---|---|---|
| `activity.runtime` | `{}` → `Runtime` | Web 今日：`packages/engine/src/modules/steward/builtin/web/today.ts:21` | **FREEZE 裁剪后的内核运行事实**；provider health **MOVE** Agent，日汇总/日程数由应用组合。不是冻结当前 mixed runtime shape |
| `activity.runs` | `{session?}` → `RunView[]` | Web runs：`packages/engine/src/modules/steward/builtin/web/index.ts:155`；MCP：`packages/engine/src/modules/steward/external/mcp/index.ts:64`；Mind：`packages/engine/src/modules/steward/external/mind/index.ts:196` | **MOVE**Agent progress/usage/resources/questions；内核 Run 状态事实可保留窄只读投影。不是把取消或回答权限随列表下放 |
| `activity.records` | `{before?:ISO}` → `{rows:[{id,at,kind,subject,module,hash,approvalTitle,details}],before}`；最多 200 | Notify 活动投影：`packages/engine/src/modules/steward/builtin/notify/activity.ts:102` | **FREEZE，裁剪后**受控审计元数据；通知文案/业务聚合不进入内核 |
| `activity.consumer` | `{module?:string\|null}`；省略读选择 → `{moduleId,revision}` | 安装器直接 seed：`packages/engine/src/modules/steward/module-builtin.ts:90-92`；未发现 UI 显式切换调用 | **FREEZE**单个授权事实消费者选择；身份按模块 ID，不按 notify 名称；暂停旧消费者、revision 隔离、显式 null 保留 |
| `activity.facts` | `{}` → `{revision,facts:[{id,at,type,data}]}`，最多 50 | Notify：`packages/engine/src/modules/steward/builtin/notify/facts.ts:18` | **FREEZE**有界、有限、事务内产生的内核事实；删除通知 DTO 与 configure 过渡类型 |
| `activity.withdrawals` | `{revision,keys:string[1..100]}` → `{withdrawn:string[]}` | Notify：`packages/engine/src/modules/steward/builtin/notify/facts.ts:48` | **FREEZE 最小失效对账语义**；“notification key”是当前表示方式，不是内核应永久了解通知领域的理由 |
| `activity.ack` | `{revision,ids:string[1..100]}` → `{acknowledged:string[]}` | Notify：`packages/engine/src/modules/steward/builtin/notify/facts.ts:55` | **FREEZE**私有持久接收确认；不代表发送完成，不释放未知执行资源，不产生新的动作授权 |

#### 2.7 projects：3 个

定义：`packages/engine/src/modules/steward/system/projects.ts:8-29`。

| 工具 | 当前输入 → 输出 | 实际生产调用者 | 分类与最小语义 |
|---|---|---|---|
| `projects.list` | `{}` → `{projects:Project[<=100]}` | Coding：`packages/engine/src/modules/steward/external/coding/index.ts:23`；workbench：`packages/engine/src/modules/steward/external/coding/workbench.ts:22` | **MOVE**项目目录选择/展示到 Coding/Agent；宿主授权引用查询 **PRIVATE**。不冻结 host path 向普通模块回传 |
| `projects.register` | `{path:absolute host path,max4096}` → `Project` | Coding 命令：`packages/engine/src/modules/steward/external/coding/conversation-commands.ts:113`；workbench：`packages/engine/src/modules/steward/external/coding/workbench.ts:58` | **PRIVATE host**路径授权；应用发起用户需求，但不能自行把任意 path 变成执行授权 |
| `projects.create` | `{name:/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/}` → `Project` | Coding default-space：`packages/engine/src/modules/steward/external/coding/workbench.ts:58` | **PRIVATE host**安全创建；默认空间、命名和何时创建 **MOVE** Coding。不冻结“内核项目产品” |

### Inferences

- 上表标为 PRIVATE 的能力仍可能需要一个受授权的应用访问入口；其含义是**不把当前业务接口永久发布**，不是简单删掉调用后让用户无法配置、授权或恢复。
- 如果冻结方案决定继续把部分宿主能力公开，必须逐个证明它不能由已有 Agent/host 边界承接；不能用现有 Coding 调用数量代替这个论证。

### Gaps

- API 更名、迁移后的最终名称未在本研究中设计；这是为了避免用“统一 capability framework”替代当前业务耦合。
- 仓库外安装模块、第三方 SDK 使用者需要在冻结前另行盘点；当前没有证据支持“可直接无损删除”。

## 3. 审批、grants 与权限：实际执行链不能和动作枚举混为一谈

### Takeaway

**审批的不可移除部分是一次真实决定与精确操作/版本/数据风险的绑定。当前 `ACTIONS` 则含有大量没有生产执行链的业务分类。** 同时，当前代码的 deterministic grant policy 主要停留在服务/导出层，不能据文档宣称所有这些动作仍实际经过策略门。

### Cited Findings

#### 动作枚举与实际生产

`packages/contracts/src/steward/index.ts:48-60` 的 13 个 action：

```ts
"notify_user", "schedule", "activate_module", "read_source", "connect_source",
"send_external_message", "modify_external", "delete_data", "share_third_party",
"purchase", "change_credentials", "access_host_path", "change_policy"
```

实际审批创建者：

| 生产者 | action / payload | 证据 |
|---|---|---|
| 受检版本迁移、新凭据、分组待审 | `activate_module`，绑定 moduleId/hash | `packages/engine/src/modules/steward/module-build.ts:123-144` |
| 分组启用 | `activate_module`，绑定全部版本 | `packages/engine/src/modules/steward/module-group.ts:103` |
| 回滚恢复数据快照 | `activate_module`，payload 包含 restore；preview 明示后续写入会丢失 | `packages/engine/src/modules/steward/module-activation.ts:86` |
| 应用删除 | `delete_data` / `module_remove` | `packages/engine/src/modules/steward/module-remove.ts:72` |
| 模块人工请求 | 固定借用 `modify_external` / `module_request{hash,call}` | `packages/engine/src/modules/steward/system/approvals.ts:15-20` |

**当前直接 `db.approval.create` 生产写入点只有审批服务**：`packages/engine/src/modules/steward/approvals.ts:72`；上述生产者均委托它。未发现其他生产 `create/createMany/upsert` 审批写入点。

这纠正了阶段文档的旧说法：`docs/zh/kernel-notification-facts.md:11` 仍写“审批服务和工具策略事务两个实际入口”，但当前源码仅找到上述一个直接写入点。

#### 决定与执行绑定

- 审批 payload 不允许 null；activation 校验 module version 与动态操作规则；删除校验 removal payload 与模块身份：`packages/engine/src/modules/steward/approvals.ts:60-71`。
- activation、remove 和 module request 不能批准为 standing；module request 不创建 grant：`packages/engine/src/modules/steward/approvals.ts:23-35`。
- resolve 事务内仅允许 open → approved/denied，CAS 防重复；同时写 withdrawal，settle waiting call：`packages/engine/src/modules/steward/approvals.ts:77-91`。
- 模块请求按真实 moduleId、call ID 查重，但只扫描最近 200 条：`packages/engine/src/modules/steward/system/approvals.ts:15-17`。这不是可以无条件承诺的无限期幂等索引。
- `isModuleRequest` 类型谓词检查 kind/call，并未完整验证 hash：`packages/engine/src/modules/steward/approvals.ts:37-38`。冻结时不能把类型注解当成持久数据完整验证。

#### Policy 的真实状态

确定性函数：

```ts
decidePolicy(
  action: Action,
  target: { moduleId?: string },
  grants: readonly Grant[],
  now: Date
): PolicyDecision
```

- module scope 优先 global；同 scope once 优先 standing，否则 ask 优先 allow；过滤 revoked、consumed、expired。见 `packages/domain/src/steward/policy.ts:9-54`。
- `consumeOnce` 通过带 revoked/expiry/consumed 条件的 updateMany 原子消费：`packages/engine/src/modules/steward/grants.ts:9-16`。
- 但生产搜索中，`effectivePolicyIn` 仅由 `createGrants.effectivePolicy` 包装，`hostPathsFor` 没有找到生产调用者；`consumeOnce` 的内部生产调用仅来自这个未接入的 hostPaths helper。见 `packages/engine/src/modules/steward/grants.ts:18-20`、`packages/engine/src/modules/steward/grants.ts:42-60`；导出位于 `packages/engine/src/modules/steward/index.ts:14`。
- projects 的实际授权不依赖 `access_host_path` grant，而依赖显式 manifest capability 和 execution principal：`packages/engine/src/modules/steward/system/projects.ts:17-23`。

### Inferences

1. **DELETE / PRIVATE 旧 action taxonomy**，而不是冻结 purchase/share/read_source 等为内核永久业务。
2. 保留当前真正需要的生命周期操作批准、数据丢失确认、撤销、原子一次性授权机制；不能改成应用返回一个 `{approved:true}` 就让内核执行。
3. `approvals.request` 是业务流程，不是具体外部操作执行门；当前固定 `modify_external` 尤其不应永久冻结。
4. 冻结前必须补齐 owner 决定边界。工具描述“only after the user decided”不能代替校验。
5. 不建议新造一套“任意动作注册与策略插件框架”；先删除无调用执行链，保留现有真正 enforce 的窄路径。

### Gaps

- 未验证仓库外导出 API 使用者；不能把“本仓库无 caller”写成“该导出绝无使用”。
- 这里仅追审批生产与绑定，不展开 `system/modules.ts` 生命周期工具清单。

## 4. 预算、模型命名空间与 timezone

### Takeaway

**预算必须在不可绕过的资源消费边界强制执行；预算配置、模型名和日界策略不必都成为内核公共 API。** 普通应用可以管理业务预算，但不能充当最终执行许可的唯一证明。

### Cited Findings

当前模型 admission：

```ts
reserveCompletion(
  ports: StewardPorts,
  scope: CallScope,
  params: { system?: string; prompt: string; maxOutputTokens: number },
  now: Date
)
```

- 校验 manifest.model、配置 tier、provider complete 可用性、每 event 调用数、全局日调用数、单模块日调用数、output token 上限：`packages/engine/src/modules/steward/module-model-budget.ts:16-29`。
- 在 SQLite 事务内创建 pending/rejected reservation，再进行外部模型工作：`packages/engine/src/modules/steward/module-model-budget.ts:30-41`。
- 可信 Agent 调用内核委托 admission 时，内核从 live routed caller context 读取真实 manifest/moduleId/hash/event，而非接受模块参数中的身份：`packages/engine/src/modules/steward/agent-delegation.ts:16-22`、`packages/engine/src/modules/steward/agent-delegation.ts:50-68`。
- 只有当前 builtin Agent 能请求这条委托：`packages/engine/src/modules/steward/agent-delegation.ts:50-51`。
- `finishCompletion` 只结算 pending reservation，记录 token usage/error：`packages/engine/src/modules/steward/module-model-budget.ts:43-53`。
- `moduleDailyCalls` 配置按模块 **name** 查找，计数按 moduleId：`packages/engine/src/modules/steward/module-model-budget.ts:16-18`。模型名、tier 名、模块名不是同一个身份空间。
- 模型 targets 支持 Pi 的 `model:thinking` shorthand；固定 thinking 枚举以及 tier 配置位于 `packages/contracts/src/steward/index.ts:445-467`。
- `budgetTimezone` 仍兼容读取旧 `notifications.timezone`，默认 `"Asia/Shanghai"`：`packages/engine/src/modules/steward/settings.ts:15-18`。
- 同一 timezone 被日程和 runtime 日统计复用：`packages/engine/src/modules/steward/schedules.ts:24`、`packages/engine/src/modules/steward/runtime-health.ts:9`。
- Build 日限额按 source `"build"` 的 session 计数，48 小时查询后按 localDayKey 过滤：`packages/engine/src/modules/steward/settings.ts:21-26`；build admission 真正使用它：`packages/engine/src/modules/steward/module-build-session.ts:245`。
- Run claim 时读取预算并检查取消、会话、日上限；明确保持一条队列和执行占用：`packages/engine/src/modules/steward/runs.ts:78-87`、`packages/engine/src/modules/steward/runs.ts:147-168`。

### Inferences

- **MOVE Agent**：model tiers、Pi thinking、模型选择、模型用量展示。将来 provider 注册也在 Agent，不是给内核增加 provider registry。
- **PRIVATE kernel**：Run 预算/租约/超时/并发/实际停止 enforcement；模型费用工作的原子 reservation 在完成可靠移交前也必须留在现有边界。
- **应用预算可以成立**：例如 Notify 的 daily cap、业务报告频率、工作量限制。它们控制业务策略，不取代执行端硬限额。
- **可信 Agent 可以承接模型策略甚至模型预算服务，但并非当前已完成**：移交必须确保所有模型路径都经过它，普通模块不能直接调用绕过，并保留真实 caller 和原子占用/结算。不能仅把 `reserveCompletion` 移成普通模块工具后宣布完成。
- timezone 至少应区分：**资源预算日界**与**日历墙钟时间**。不应因为当前共享一个字段就永久绑在一起。
- DELETE 运行时对旧 `notifications.timezone` 的兼容读取需要先做明确离线迁移；不能静默重置用户时区或日限额。
- Build 限额虽由 modules API 配置，但实际 execution timeout/admission 是执行机制；不应把全部 build 商业策略放进不可变内核公开 settings。

### Gaps / blockers

- 当前 output token 控制还存在字符截断近似：`packages/engine/src/modules/steward/module-model.ts:18-19`。不能把它描述为精确费用上限。
- 拒绝模型调用也创建 method=`"model"` 记录；预算查询包含这些记录，而设置页 modelUsage 排除 rejected，见 `packages/engine/src/modules/steward/module-model-budget.ts:23-26` 与 `packages/engine/src/modules/steward/settings.ts:35`。冻结前需明确“attempt/accepted call/paid call”计数语义，不能永久固化含糊的 `calls`。

## 5. 调度：可以是应用服务；当前可靠投递机制不能丢

### Takeaway

**日历规则不是内核信任根。** 当前真正需要保留的是可靠投递、真实目标身份、版本/activation fence、取消、未知结果不自动重放；这些已经位于路由与 supervisor 的执行边界。把调度变成应用服务可行，但不是把现有 DB 查询简单搬走即可。

### Cited Findings

当前规则：

```ts
{kind:"at",at}
| {kind:"daily",time}
| {kind:"weekly",days,time}
| {kind:"every",minutes}
```

- every 为 5–10080 分钟；weekly days 为 0–6；`packages/contracts/src/steward/index.ts:90-95`。
- owner timezone；payload 为 JSON object，序列化最多 4000 字符；key 最长 128；label 最长 80；`packages/contracts/src/steward/index.ts:520-524`。
- 每模块最多 500 active/paused timers；同 key 替换 rule/payload，并取消此前未交付 queued occurrence：`packages/engine/src/modules/steward/schedules.ts:145-163`。
- 已过去的 `at` 在动态 create 中改为 `now`，而 `nextOccurrence` 本身严格返回 after 之后：`packages/engine/src/modules/steward/schedules.ts:141-145`；`packages/domain/src/steward/schedule-rule.ts:8-18`。
- DST 不存在的墙钟时间跳过、重复墙钟时间可各发生一次；every 是 elapsed time：`packages/domain/src/steward/schedule-rule.ts:8-10`。
- fireDue 按当前 now 计算下一次，不回放所有漏掉的周期；schedule advance 与 occurrence enqueue 原子提交；同 schedule 有 queued/running 时不继续排：`packages/engine/src/modules/steward/schedules.ts:40-64`。
- enqueue 绑定 moduleId、hash、activationId、原始 firedAt 与 payload：`packages/engine/src/modules/steward/schedule-delivery.ts:8-18`。
- 投递前重验 hash/activation/status；版本或 activation 改变则取消，不重放：`packages/engine/src/modules/steward/schedule-delivery.ts:39-55`。
- unavailable 有最多 6 次退避；丢失/未知结果不重试；租约过期转 unknown：`packages/engine/src/modules/steward/schedule-delivery.ts:65-80`、`packages/engine/src/modules/steward/schedule-delivery.ts:85-96`。
- legacy wake 在 update/fireDue 中拒绝运行：`packages/engine/src/modules/steward/schedules.ts:29-30`、`packages/engine/src/modules/steward/schedules.ts:43`。
- wake 转换是明确 stopped-service 操作，校验未结束/unknown work、真实 entry owner、批准 hash、数量和 payload bounds：`packages/engine/src/modules/steward/schedules.ts:92-123`。

### Inferences

- **MOVE** daily/weekly/every 规则、时区、label、payload 业务、用户日程列表到普通持久调度模块。`keepAlive` 模块已有长期进程机制；到期工作可以使用现有 routed calls，无需增加“通用触发器总线”。
- **PRIVATE** 当前 static trigger 与 schedule-event 注入机制，直到所有当前消费者完成迁移；不能提前删除导致 Remind、Coding 或 manifest polling 消失。
- 可靠 occurrence 状态不是业务日历；应用迁移后继续复用内核 invocation admission 和未知结果处理，不能自己再实现一套跨模块 execution runtime。
- 如果决定保留内核 timer，则最小可证明语义是“某个真实模块持久登记一个到期唤醒并可取消”；**不能从这个需要推出 current rule union、wake mode、originSessionId、createdBy 等都必须永久公开**。
- DELETE 公开 `wake` legacy mode/字段与旧解释；保留明确离线转换或退出机制，不自动迁移真实数据。

### Gaps / blockers

- 当前没有普通调度应用实现同等 durable timer 行为；“可移出”是架构判断，不是已完成能力。
- 替换协议必须明确 paused、missed occurrences、到期时版本更替、重启和 cancellation 边界，否则不应冻结。

## 6. 凭据与 OAuth：保密交付是根，固定 OAuth provider 不是根

### Takeaway

**凭据保管/最小交付可以由受控服务承接，但当前的“不记录调用结果”与批准定义绑定必须在内核或等价可信边界保持。** 普通应用工具默认记录结果，因此不能把 `secrets.token` 原样搬成普通 routed tool。

### Cited Findings

- 安全存储使用 0700 目录、0600 文件、`O_NOFOLLOW`、单链接检查、1 MiB 上限、临时文件 fsync + rename：`packages/engine/src/modules/steward/secrets.ts:7-43`。
- `secrets.get` 只允许 manifest 声明；QQ 凭据额外要求 entry，并来自 service environment：`packages/engine/src/modules/steward/system/secrets.ts:71-79`。
- set/remove/list 显式检查 `isEntryModule(manifest)`，区别于仅 kind-check 的通用 `entry()`：`packages/engine/src/modules/steward/system/secrets.ts:57-62`。
- 定义 schema 的 provider 固定为 Google/Microsoft，但 authorization/token URL 是应用声明的 HTTPS endpoint，且禁止 query/hash/userinfo；并非代码内置两个 provider URL：`packages/contracts/src/steward/index.ts:154-173`。
- OAuth identity 对 name、provider、URLs、排序去重 scopes、accounts、authorizationParams 做 canonical hash：`packages/engine/src/modules/steward/oauth-definition.ts:18-22`。
- `resolveOAuthDefinition` 只接受当前 active、approved 版本；同 secret/provider 必须得到唯一 definition identity：`packages/engine/src/modules/steward/oauth-definition.ts:40-51`。
- 新增/变更 OAuth definition 进入既有 activation approval gate，而非第二套审批：`packages/engine/src/modules/steward/oauth-definition.ts:33-36`。
- authorize 使用 10 分钟一次性 state、PKCE S256；最多 20 pending；scope 使用已批准全部 scopes，而请求值只能是它们子集：`packages/engine/src/modules/steward/oauth.ts:8`、`packages/engine/src/modules/steward/oauth.ts:42-69`。
- callback 在交换前和保存时重验 client/definition/fingerprint；锁内重新读取，避免覆盖更换/删除后的凭据：`packages/engine/src/modules/steward/oauth.ts:81-101`。
- refresh 按 secret/account/definition 去重；返回前重新检查当前调用者批准定义：`packages/engine/src/modules/steward/oauth.ts:107-116`。
- 隐藏 binding、account refresh token 及受管 clientSecret/refreshToken：`packages/engine/src/modules/steward/oauth.ts:14-16`。
- merge 修改 clientId/clientSecret 会清除受管 OAuth 字段；字段删除与 refresh 共用锁：`packages/engine/src/modules/steward/system/secrets.ts:82-88`、`packages/engine/src/modules/steward/system/secrets.ts:100-109`。
- secret 更改后刷新声明应用的 readiness：`packages/engine/src/modules/steward/system/secrets.ts:62-69`。

### Inferences

- FREEZE 最小 credential claim：**当前真实批准调用者 + 明确声明 + 不记录敏感值**。
- PRIVATE 存储、权限、原子替换、锁、删除/轮换 fence；这不是必须公开给所有模块的“凭据产品 API”。
- MOVE OAuth authorization/token 协议到应用服务，删除固定 provider enum 对内核的约束；不实现未来 OAuth adapter registry。
- 若 OAuth 服务能领取 refresh token，它本身属于用户明确委托的敏感服务，不能因“是普通模块”就默认得到所有凭据。路由身份和 manifest 批准关系仍必须可信。
- **当前普通应用调用缺少相同 unrecorded 保证**：quiet 判断仅为 Agent 或 system tool 的 unrecorded，`packages/engine/src/modules/steward/module-calls.ts:358`。迁移方案必须先解决这个实际缺口，而不是把 refresh/access token 写进 invocation output。
- QQ 的 `qq_bot` 环境例外应成为宿主启动/官方 QQ 应用的私有绑定，不是永久公共 secret-name 特权。

### Gaps / blockers

- 当前预装业务模块未找到实际 OAuth token 使用者；但 SDK 公共 token helper 与 Web authorize 路径存在，不能按“没有预装 caller”直接认定整个 OAuth 功能无用。
- replacement set 仍允许部分 refresh-token字段，而 merge 更严格，见 `packages/engine/src/modules/steward/system/secrets.ts:119-127`。冻结前应统一“用户可写字段”和“服务受管字段”语义。

## 7. 有限事实、保留与通知耦合

### Takeaway

**事实机制值得保留，但当前 fact schema 尚未达到永久内核契约的纯度。** 有限表示“类型和单条大小有限”，不表示存储容量有限。当前没有 TTL 或自动清理。

### Cited Findings

- 类型 union 仍有 `notice/lifecycle/withdraw/approval/configure`：`packages/engine/src/modules/steward/notification-facts.ts:24-30`。
- notice 中仍包含 `title/body/level(now|digest|web)/scoped/urgent/responds/recipient/app/approval/module/session`：`packages/engine/src/modules/steward/notification-facts.ts:22-23`。
- lifecycle 包含 `background-result{title,body}`、`reflection-retired{reflection,mind,healthFixes}` 等业务/历史类型：`packages/engine/src/modules/steward/notification-facts.ts:10-19`。
- configure 是 `daily-cap/timezone/digest-at/quiet-start/quiet-end` 通知配置快照：`packages/engine/src/modules/steward/notification-facts.ts:30`。未发现当前生产写入者。
- `reflection-retired` 仍由运行时代码产生，不是单纯死 schema：`packages/engine/src/modules/steward/reflection-retirement.ts:73-82`。
- 当前 notice 的生产源至少还有 provider question，直接决定 `level:"now"` 和 body：`packages/engine/src/modules/steward/provider-channel.ts:68-74`。
- fact 身份为 workspace/type/key hash；upsert 的 update 为空，不重开 consumed；写入前统一脱敏和限长：`packages/engine/src/modules/steward/notification-facts.ts:35-46`。
- consumer seed 仅首次写入，explicit null 不覆盖；切换要求旧消费者不再 active，revision 改变：`packages/engine/src/modules/steward/notification-facts.ts:55-72`。
- facts/ack/withdrawals 重新检查选中 moduleId、active hash 和 revision：`packages/engine/src/modules/steward/notification-facts.ts:75-82`。
- withdrawals 同时查询 pending/consumed，跨消费者继续有效：`packages/engine/src/modules/steward/notification-facts.ts:93-101`。
- ACK 只返回本消费者真正接收的 IDs，重复 ACK 可返回，同一记录不会交给另一消费者再次接收：`packages/engine/src/modules/steward/notification-facts.ts:103-111`。
- Notify 先私有事务持久化 staged，再 ACK，再允许发送；恢复时检查全部 queued/folded 的 withdrawals：`packages/engine/src/modules/steward/builtin/notify/facts.ts:14-65`。
- 明确文档写无 TTL、未确认不自动删除、确认审计也无自动清理：`docs/zh/kernel-notification-facts.md:5-6`；当前实现没有相反清理路径。
- `activity.records` 是 allowlist metadata 投影，不返回 raw audit details；每页 200：`packages/engine/src/modules/steward/activity.ts:7-18`、`packages/engine/src/modules/steward/activity.ts:37-49`。

### Inferences

冻结前必须裁剪：

| 字段/类型 | 建议 |
|---|---|
| `notice.level/urgent/recipient/scoped/responds` | **MOVE Notify**。内核发事实，不选择提醒策略和收件业务 |
| 内核自己拼出的 `title/body` | 对 provider question 保留问题本身的安全事实；通知措辞 **MOVE** 应用 |
| `configure` 通知设置快照 | **DELETE 运行时公开类型**；历史事实需显式转换/读旧格式，不能忽略未消费行 |
| `reflection-retired` | **MOVE/DELETE**旧 runtime 迁移业务；不能只删 schema 留旧 producer |
| `background-result{title,body}` | 结果内容属于产生应用/Agent；内核只保留必要执行状态事实 |
| module activation/build/migration/schedule failure | 保留对应内核机制实际拥有的状态事实；业务解释和下一步措辞归应用 |
| withdrawal | 保留失效事实与持久 tombstone，避免切回旧消费者复活过期问题 |
| consumer | 保留单消费权与 revision；不绑定 Notify builtin 身份 |

保留策略不能简化为统一 TTL：

1. 未 ACK 事实不得因年龄自动丢弃。
2. 已 ACK 的事实/幂等身份不能随意清除，否则重写同 key 可再次变 pending。
3. withdrawal tombstone 不能在旧消费者仍可能有 queued 通知时删除。
4. execution 实际停止、数据丢失恢复所依赖证据必须独立保护。
5. 当前没有安全清理协议；**不建议为永久冻结新造通用 retention framework**。先声明当前无自动清理及其空间增长边界。

### Gaps / blockers

- `activity.records` 用时间戳作为 before，SQL 过滤 `< createdAt`，虽排序还含 id，cursor 却不含 id：`packages/engine/src/modules/steward/activity.ts:39-40`、`packages/engine/src/modules/steward/activity.ts:48`。超过 200 条同时间记录可能被下一页跳过；冻结前需修正分页语义，不能永久承诺当前 cursor。
- 删除 fact 类型前必须清点已持久化 pending/consumed 数据；本任务禁止 DB 访问，因此没有做真实数据规模或积压验证。

## 8. Host projects、readiness 与最终冻结阻塞项

### Takeaway

**项目目录的安全创建与执行授权属于 host 信任边界；“项目”“默认空间”属于应用。readiness 则是模块自报业务事实，不能变成批准、预算或实际恢复证明。**

### Cited Findings

#### 项目引用和主机路径

- `resolveExecutionPrincipal` 验证 active module/hash；`uses:["*"]` 会映射为 owner principal，因此不再是单个 module scope：`packages/engine/src/modules/steward/execution-principal.ts:16-26`。
- registry 按 workspaceId/ownerId/callerKey 隔离，返回 `projectRef/path/label`；module callerKey 是 `module:<id>`，owner 是 `"owner"`：`apps/server/src/config/execution-project-registry.ts:12-19`。
- register canonicalizes path，检查目录读写执行权限，记录 dev/ino 身份；不匹配身份拒绝：`apps/server/src/config/execution-project-registry.ts:20-27`、`apps/server/src/config/execution-project-registry.ts:66-80`。
- create 在 dataDir 同级 `workspaces/<scope-hash>/<name>`，限制单段 name；逐级检查非 symlink/canonical directory；目录 0700：`apps/server/src/config/execution-project-registry.ts:47-50`、`apps/server/src/config/execution-project-registry.ts:94-115`。
- resolve 会再次检查目录身份；Git commit baseline 或 snapshot provenance 均由 host 生成：`apps/server/src/config/execution-project-registry.ts:29-44`、`apps/server/src/config/execution-project-registry.ts:117-122`。
- snapshot marker 明确不是任意文件备份：`apps/server/src/config/execution-project-registry.ts:29`。
- host registry 总量 100，不是每个模块 100：`apps/server/src/config/execution-project-registry.ts:75`。
- registry 还兼容丢弃旧 defaults 指针：`apps/server/src/config/execution-project-registry.ts:13-14`。

#### Readiness 链

- report 字段为 `status:ready|needs_configuration|degraded|unknown,summary,nextAction?,validForSeconds`，TTL 1–3600 秒、默认 300：`packages/engine/src/modules/steward/module-readiness.ts:4-9`。
- 无报告、过期或进程不可用都投影 unknown；不等于安装失败：`packages/engine/src/modules/steward/module-readiness.ts:12-17`。
- 启动后 optional refresh；healthCheck manifest opt-in 才投递 health event：`packages/engine/src/modules/steward/module-supervisor.ts:300-310`。
- report 必须来自当前 hash 的 live connected、非 retiring process；内容脱敏截断后只保存在 instance：`packages/engine/src/modules/steward/module-supervisor.ts:471-483`。
- health trigger 不是成功恢复证据：`packages/engine/src/modules/steward/module-supervisor.ts:408`。
- credentials 更新触发消费者 refresh；缺配置不能通过发送消息/付费调用来“自检”：前者见 `packages/engine/src/modules/steward/system/secrets.ts:62-69`；后者是 SDK health 事件契约，`packages/integrations/src/steward/module-sdk/sdk.ts:22-23`。

### Inferences

#### 项目建议

- **保留 PRIVATE host** canonical path、目录身份检查、安全 mkdir、execution project mapping 和实际执行时 recheck。
- **MOVE 应用**默认空间、项目展示、命名、选择和工作分组。
- 不应永久冻结 host path 回传为公共 `Project` 的必填字段；执行应以受 host 绑定的引用为依据，而不是模块自己提供 cwd。
- 不能把 register 搬到普通 Coding 模块后，让 Coding 返回任意 `projectRef/path` 就被执行端信任。
- `uses:["*"]` owner 映射是明确权限语义，不是“所有项目永远 caller-scoped”；冻结时必须决定并清晰保留/调整，不能文案声称单模块隔离而实际共享 owner scope。

#### Readiness 建议

- 运行时观测与真实业务 readiness 分开是正确边界。
- 模块自己的 summary/nextAction 属于应用表述；内核只需要归属、当前身份、时间和失效机制。
- 不应把 `ready` 当作生命周期审批、credential 可读取、预算扩大或未知执行已停止的依据。
- SDK 的 diagnostic-only 注释不能被描述为完整强制副作用隔离；本研究未找到 health event 专用的通用路由禁写门。

#### 冻结前的必要阻塞清单

1. **权限门补齐**：明确 owner 管理工具；修正 `entry()` 名称与实际检查不符，不让 ordinary module 因 module-visible 直接改预算/解决审批。
2. **动作枚举去业务化**：删除无实际执行链的 action 与 grants 公共包袱；保留真实 deterministic 权限和一次性操作绑定。
3. **模型策略迁移**：Pi thinking、model namespace、tier 配置进 Agent；原子预算与执行总限额不得出现旁路。
4. **调度迁移闭环**：Remind、Coding、static triggers、重启/漏期/取消/unknown 行为全部有归属后再删内核业务接口。
5. **敏感应用调用路径**：在 OAuth/凭据服务移出前证明不持久化敏感 args/results；不能用普通工具调用默认路径替代 `unrecorded`。
6. **有限 fact schema 清理**：删除 configure、reflection-retired 与 notice 投递策略字段，同时处理已有持久数据和生产者。
7. **保留/分页语义清楚**：不承诺 TTL；修正 timestamp-only cursor；保护 ACK 幂等身份与 withdrawal tombstone。
8. **Host project 边界不降级**：opaque reference 不能由应用自授，canonical identity/symlink/actual execution checks 留在 host。
9. **文档更新依据源码**：阶段事实文档仍含已不存在的第二个审批 producer、过渡 configure 计划；不能作为永久冻结依据。
10. **最后才宣布只增不删**：先完成上述裁剪和消费者切换，再锁公开 API；不 grandfather 当前 29 个工具及所有字段。

### Gaps

- 未执行任何 runtime/tests/DB 操作；这些是源码研究结论，不是迁移后的验收证据。
- `system/modules.ts` 生命周期工具清单按任务要求排除；仅引用其周边真实审批生产者和 readiness 机制，供另一研究者衔接。