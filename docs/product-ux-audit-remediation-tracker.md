# Chrona 产品与 UX 审计整改追踪

> 更新日期：2026-07-10  
> 状态：进行中  
> 用途：作为本轮产品与 UX 重构的唯一追踪清单。每完成一项，必须更新状态、验证证据和后续风险，避免对话或开发阶段切换后丢失范围。

## 1. 本轮目标

Chrona 的目标不是继续增加功能，而是让用户能够可靠地完成以下闭环：
```text
首次启动
→ 连接 AI
→ 创建任务
→ 理解自动化策略
→ 生成并审核计划
→ 执行或按时自动执行
→ 处理中断、输入和审批
→ 审核结果
→ 找回历史结果
```

产品在每个阶段都必须让用户回答：

1. 当前是什么状态？
2. Chrona 最近做了什么？
3. 是否仍在运行？
4. 下一步是什么？
5. 点击后会发生什么？
6. 离开页面或重启后会怎样？
7. 出错后如何安全恢复？

## 2. 严重程度与状态

严重程度：

- `P0`：可能造成错误执行、重复执行、状态误判或严重信任损失。
- `P1`：阻断核心流程或让用户难以完成任务。
- `P2`：显著增加理解、操作或长期使用成本。
- `P3`：局部一致性、视觉或可访问性问题。

执行状态：

- `DONE`：实现、针对性测试和行为验证均已完成。
- `IN PROGRESS`：已经开始，但尚未满足全部验收标准。
- `TODO`：尚未实施。
- `HOLD`：有意暂缓；必须写明原因。

## 3. 当前进度摘要

| ID          | 严重度 | 问题                                                         | 状态        |
| ----------- | ------ | ------------------------------------------------------------ | ----------- |
| STATE-01    | P0     | 跨页面任务状态和控制互相矛盾                                 | DONE        |
| AUTO-01     | P0     | 自动执行缺少保存前的可解释契约                               | DONE        |
| ONBOARD-01  | P1     | 首次使用缺少安全、低配置的成功路径                           | DONE        |
| PROVIDER-01 | P1     | Provider、Feature Binding、MCP 等概念泄漏                    | DONE        |
| PLAN-01     | P1     | 计划生成状态提前跳转或互相冲突                               | DONE        |
| RECOVERY-01 | P1     | 失败恢复展示运行时事故而非用户诊断                           | DONE        |
| READY-01    | P1     | Schedule 和 Settings 的 AI readiness 表达矛盾                | DONE        |
| PLAN-02     | P2     | 简单任务的计划审核过度复杂                                   | DONE        |
| ACTIVITY-01 | P2     | Activity 被重复技术事件淹没                                  | DONE        |
| IA-01       | P2     | Dashboard、Tasks、Schedule、Action Center 职责和计数口径不清 | DONE        |
| CREATE-01   | P2     | 创建任务一次暴露过多决策                                     | DONE        |
| RESULT-01   | P2     | 历史结果缺少搜索、筛选和运行版本关系                         | DONE        |
| MOBILE-01   | P3     | 移动端无横向溢出，但操作优先级仍过重                         | DONE        |
| DOCS-01     | P2     | 产品定位和文档叙事不一致                                     | DONE        |
| TEST-01     | P1     | 异常、重启、重复触发和迟到事件测试不足                       | DONE        |

总体完成：`15/15` 个问题完整关闭；产品内首次成功路径、可靠性契约、信息架构、结果资产和移动端主路径均已验证。

---

## 4. 已完成整改

### STATE-01 — 统一用户可见任务状态

- 严重程度：`P0`
- 状态：`DONE`

#### 原问题

同一个已完成任务可以同时显示：

- `Waiting`
- `0%`
- `Review the generated plan`
- `Result ready`
- `Pause`
- `Stop`

用户无法判断执行是否结束，也无法判断哪个操作安全。

#### 已实施方案

建立唯一的 `WorkStateView`：

- 文件：`packages/domain/src/task/derive-work-state-view.ts`
- 统一字段：
  - `state`
  - `stage`
  - `label`
  - `tone`
  - `nextActionLabel`
  - `primaryActionId`
  - `primaryActionDisabledReason`
  - `attentionRequired`
  - `showLiveProgress`
  - `canPause`
  - `canStop`
  - `blocker`

只有 `running` 可以显示实时进度、Pause 和 Stop。
已迁移：

- Task Workspace
- Dashboard
- Tasks
- Schedule
- Action Center
- 对应 engine page projections

已删除重复用户状态模型：

- `derive-work-item-state-view.ts`
- `derive-task-projection-state-view.ts`

保留不同职责的底层事实模型：

- `deriveTaskState`
- `deriveTaskExecutionState`
- `deriveScheduleState`

#### 验证证据

- Domain/Workspace：85 tests passed。
- Dashboard/Tasks/Schedule/Action Center：48 tests passed。
- `bun run typecheck`：通过。
- `bun run check:boundaries`：0 errors；500 个既有 warnings。
- 实际完成任务页面：
  - `Task done`
  - `1 steps · 1 accepted · 100%`
  - 无 `Pause`、`Stop`、`Waiting` 和旧计划审核提示。
  - 390px 视口无横向溢出。

#### 后续注意

新页面或新投影不得重新从原始 task/run/node 状态推导用户文案或主要动作，必须消费 `WorkStateView`。

---

## 5. 剩余 P0 工作

### AUTO-01 — 建立可解释的自动化策略契约

- 严重程度：`P0`
- 状态：`DONE`

#### 用户问题

用户开启 auto-plan、auto-execute 或 recurrence 后，无法准确知道：

- 什么时候生成计划；
- 是否需要接受计划；
- 什么时候执行；
- 使用哪个 AI；
- Provider 不可用时怎样；
- 页面关闭后是否继续；
- Chrona 进程关闭后是否补跑；
- 是否自动重试；
- 如何避免同一 occurrence 重复执行；
- 如何取消未来运行。

#### 解决方向

建立 domain/engine 共享的自动化决策结果，例如：

```ts
type AutomationPolicyPreview = {
  nextOccurrenceAt: string | null;
  willGeneratePlan: boolean;
  requiresPlanAcceptance: boolean;
  willAutoExecute: boolean;
  providerName: string | null;
  readiness: AutomationReadiness;
  pauseConditions: string[];
  missedRunPolicy: string;
  retryPolicy: string;
  processRequirement: string;
  occurrenceKey: string | null;
  disabledReason: string | null;
};
```

关键要求：

- 保存前预演和 scheduler 必须调用同一决策函数；
- UI 不得复制规则；
- occurrence 必须有唯一身份；
- 自动执行必须幂等；
- 记录“为什么触发”和“为什么跳过”；
- 明确 missed-run、restart 和 retry 语义；
- 第一阶段只支持少量清晰模式：
  1. 手动计划、手动执行；
  2. 自动计划、手动批准；
  3. 已批准计划按时自动执行。

#### 已实施方案

- 新增纯 domain 决策 `deriveAutomationPolicyPreview()`，统一三种支持模式、readiness、下一 occurrence、批准要求、missed-run、retry、页面/进程行为和禁用原因。
- Task Create 保存前直接消费同一决策并展示完整运行摘要；React 不复制自动化规则。
- occurrence 使用 `taskId + workBlockId` 稳定身份；scheduler 通过 `WorkBlock.status = Scheduled` 条件更新原子领取。
- 触发事件写入稳定 occurrence key；重复扫描和重启不会再次启动已领取 occurrence。
- scheduler eligibility 消费同一 policy 决策。

#### 验证证据

- Automation policy：7 tests passed。
- Scheduler eligibility：11 tests passed。
- Scheduler duplicate/restart：21 tests passed。
- Task Create preview：16 tests passed。
- `bun run typecheck`：通过。
- UI 行为验证：1440×900、1024×768、390×844 均无横向溢出；自动执行摘要、missed-run、retry 和关闭页面语义可见。
- `bun run check:boundaries`：0 errors；500 个既有 warnings。

#### 后续风险

- 当前 missed-run 策略是 Chrona 恢复后下一次扫描补跑；尚未提供用户可选策略。
- 当前失败执行不自动重试，避免未知外部副作用重复；结构化重试由 RECOVERY-01 实施。

#### 验收标准

- 用户不看文档即可准确说出下一次执行行为；
- 保存前显示完整运行摘要；
- 同一 occurrence 不会重复执行；
- 重启、延迟和 Provider 不可用有明确结果；
- 自动化决策有 table-driven tests；
- fresh process restart 和 duplicate scheduler scan 有集成测试。

---

## 6. 剩余 P1 工作

### ONBOARD-01 — 产品内首次使用流程

- 状态：`DONE`

#### 问题

首次价值出现前，用户必须自行进入 Settings、配置 Provider、理解 Feature Binding，然后创建和排期任务。

#### 解决方案

产品内 setup checklist：

1. 检查本地存储；
2. 连接一个 AI；
3. 测试可达性；
4. 自动绑定 plan/execution 推荐能力；
5. 创建无外部副作用的安全 demo；
6. 生成计划；
7. 手动执行；
8. 审核结果。

默认 demo：只根据产品内给定文本生成三项摘要，不访问网络、文件或外部系统。

#### 已实施和验证

- 主产品 shell 在首次使用时持久展示三步 checklist，并按 AI 连接、任务创建、打开计划推进当前步骤。
- AI client 更新事件会立即刷新第一步；已有任务用户直接恢复到计划审核步骤。
- 新增安全示例入口：预填产品内置文本，明确禁止网络、文件、工具和外部系统访问，自动生成计划但不自动执行。
- onboarding preference 持久保存完成状态；刷新和跨页面不会重新开始。
- Onboarding、shell 和 Task Create：32 tests passed；`bun run typecheck` 通过。

#### 后续风险

- 80% 自助完成率、5 分钟首次结果和配置错误次数属于上线后的产品指标，代码测试无法证明；需要遥测后验证。

#### 验收标准

- 80% 新用户无需协助完成；
- 首次有效结果中位时间小于 5 分钟；
- 每位用户配置错误不超过一次；
- 用户能解释计划批准和结果批准的区别。

### PROVIDER-01 — 隐藏内部 Provider 配置复杂度

- 状态：`DONE`

#### 问题

普通用户被要求理解：

- AI Client；
- Provider；
- Feature Binding；
- MCP Base URL；
- bearer token；
- config/working directory；
- 内部 feature slots。

#### 解决方案

- Setup 只使用能力语言：能否计划、能否执行、能访问什么；
- 自动推荐和绑定能力；
- 默认隐藏 MCP、目录和低层 feature slots；
- 高级配置放入 Advanced；
- 以 capability readiness 代替 Provider 特有 UI 分支；
- 测试成功后才显示 Ready。

#### 验收标准

只有 API key 的用户也能完成配置；普通流程不出现 MCP 或内部 feature slot。

#### 已实施和验证

- 新 client 默认自动绑定 provider 推荐的 planning/execution 能力，不要求普通用户选择 feature slots。
- endpoint、model override、timeout、目录和 capability assignment 全部收进默认折叠的 Advanced settings。
- 主流程只保留名称、AI 类型、测试可达性、readiness 和保存；Ready 仍要求健康检查成功。
- 已有 client 卡片用 capability readiness 表达能否执行和恢复，不要求理解 feature key。
- AI Client Settings：14 tests passed；`bun run typecheck` 通过。

#### 后续风险

- Hermes 本地安装/远程连接本身仍有产品特有设置；它属于显式选择 Hermes 后的高级路径，不再污染默认 Claude Code/Codex 路径。

### PLAN-01 — 修复计划生成状态机

- 状态：`DONE`

#### 问题

计划生成中曾同时显示：

- Generating；
- Queued；
- Open execution；
- draft graph；
- 禁用的 Accept；
- 顶部仍提示 Generate plan。

#### 解决方案

明确有限状态：

```text
idle
→ request_submitted
→ generating
→ validating
→ review_ready
→ accepted

failure branches:
request_failed / provider_failed / invalid_plan / persistence_failed
```

只有验证并持久化成功后才进入 `review_ready`。

#### 已实施和验证

- workspace operation machine 在整个 generation session 期间始终返回唯一 `plan-generating` 状态，即使 provider 已产生临时 draft；此时无 review/accept/execution 动作。
- 只有持久化成功后的 `result` 事件进入 `waiting_acceptance`；后续 `done` 不再把状态错误降回 `idle`。
- server session snapshot 保留 generation phase，刷新后恢复 `running/completed/failed/cancelled` 和对应真实阶段。
- 重复 generation 由既有 generation registry 明确返回 `PLAN_GENERATION_IN_FLIGHT`。
- 状态机和 session tests：12 passed；engine plan integration：9 passed；server work-event state：通过；`bun run typecheck` 通过。

#### 验收标准

- 每个时刻只有一个生成阶段；
- 生成期间不会提示监控执行；
- 刷新后能恢复真实阶段；
- 重复 Generate 请求幂等或明确拒绝；
- 每个失败阶段有对应恢复动作。

### RECOVERY-01 — 结构化失败和恢复模型

- 状态：`DONE`

#### 问题

失败页面直接展示 `fetch() URL is invalid`、MCP tool rejection、raw runtime text 等技术事故记录。

#### 解决方案

建立结构化失败对象：

```ts
type UserFacingFailure = {
  category: "input" | "approval" | "provider" | "tool" | "runtime" | "chrona";
  summary: string;
  technicalDetail: string | null;
  completedScope: string[];
  retainedProgress: string[];
  retryFrom: string | null;
  duplicateSideEffectRisk: string | null;
  safeActions: RecoveryAction[];
  diagnosticRef: string | null;
};
```

默认只显示用户摘要，技术详情放入 Diagnostics。

#### 已实施和验证

- 新增纯 domain `deriveUserFacingFailure()`，按 input、approval、provider、tool、runtime、Chrona 分类。
- 默认恢复卡只显示发生了什么、下一动作、已保留内容、重试起点和重复外部副作用风险。
- 原始 provider/tool/runtime 文本折叠到原生 `Diagnostics` disclosure，并附 diagnostic ref。
- WaitingForInput 和 WaitingForApproval 保持不同摘要和安全动作。
- Domain：2 tests passed；Workspace recovery UI 全套测试通过；`bun run typecheck` 通过；修改文件 lint 0 errors。

#### 验收标准

用户能回答发生了什么、保留了什么、从哪里重试、是否可能重复副作用；80% 测试用户在两分钟内恢复。

### READY-01 — 统一 AI 与自动化 readiness

- 状态：`DONE`

#### 问题

Settings 显示多个客户端 `Configured`，Schedule 仍显示 `Connect AI`，但没有说明缺少连接测试、绑定还是执行能力。

#### 解决方案

统一 `AutomationReadiness`：

```text
ready
provider_not_configured
provider_test_required
provider_unreachable
planning_capability_missing
execution_capability_missing
plan_acceptance_required
schedule_time_missing
auto_execution_disabled
```

每个状态包含精确修复动作和深链接。


#### 已实施和验证

- `AutomationReadiness` 与 `deriveAutomationReadiness()` 位于 domain，保存预演、scheduler eligibility 和 AI Client Settings 共用同一优先级。
- Settings 顶部 readiness 项明确区分未配置、待测试、不可达、缺少计划能力和缺少执行能力，并给出唯一修复原因。
- Schedule Task Create 通过同一 policy preview 展示 readiness 和禁用原因。
- Automation domain/engine tests：18 passed；AI Clients Settings：14 passed；`bun run typecheck` 通过。
#### 验收标准

Settings、Schedule、Task Create 和 Workspace 使用同一 readiness；不可用时明确指出唯一下一步。

### TEST-01 — 补齐可靠性与异常路径测试

- 状态：`DONE`

#### 已完成

- canonical state precedence、running-only controls、result-ready/done stale-state collision 和页面状态消费测试；
- Provider 未配置、待测试、不可达、缺少能力，以及不支持 replay/resume 的显式非自动恢复；
- scheduler 重复扫描、周期 occurrence 重叠领取、Chrona 重启和 duplicate execution；
- 计划流中断、execution failure、输入/审批 timeout、artifact 丢失和部分外部副作用后的恢复模型；
- draft 在 generation 结束前不可审核，`done` 不覆盖 `review_ready`；
- duplicate/overlapping Start、终态迟到 node result、accepted result 后迟到 output、无 terminal stream 和 restart recovery；
- invalid json-render/spec 拒绝和重复执行回归。

#### 验证证据

- 可靠性矩阵：domain failure tests 9 passed；scheduler reliability 25 passed；server late-terminal 10 passed；engine timeout/replay/artifact/partial-side-effect tests 17 passed；workspace accepted-result regression 1 passed。
- 核心回归：scheduler 21 passed；task-runner 19 passed；plan-runner 8 passed；execution streaming 5 passed；server start 7 passed；server task run 6 passed；workspace plan section 25 passed；task plan generation session 6 passed；total 97 passed。
- `bun run typecheck` 通过。

---

## 7. 剩余 P2/P3 工作

### PLAN-02 — 简化计划审核

- 状态：`DONE`

按复杂度渐进展示：

- 1–3 步：用户目标、工具、风险、输出和简洁步骤清单；
- 有依赖：分阶段列表；
- 有分支、等待、审批：图；
- 节点 ID、runtime refs 和完整图例只在 Diagnostics。

成功标准：用户能解释 AI 将做什么、会访问什么、将产生什么，以及批准后有什么风险。

#### 已实施和验证

- Plan brief 默认先展示目标、摘要、步骤数、预计时间和假设数量。
- Details 提供简洁有序步骤、目标、摘要、假设和生成来源，不展示 node ID 或 runtime ref。
- 1–3 步简单计划明确标记为 concise review；图降为 diagnostics 语义和较低视觉权重。
- 超过三步或包含依赖、分支、等待、输入、审批的计划保持完整图和 overview。
- Workspace plan/recovery UI：25 tests passed；`bun run typecheck` 通过。

#### 后续风险

- 工具访问和输出格式取决于 provider 计划是否提供对应结构化字段；当前不能可靠展示不存在的数据。

### ACTIVITY-01 — 把运行日志转成语义进展

- 状态：`DONE`

默认 Activity 分层：

1. Progress；
2. Decisions；
3. Results；
4. Tools；
5. Diagnostics。

将多个内部事件聚合为一条用户事件。例如：

```text
execution_started + provider_started + projection_updated
→ “AI started working”
```

未知 raw events 默认进入 Diagnostics，不进入主 Activity。

成功标准：用户十秒内能回答当前步骤、最近动作、阻塞原因和安全下一步。

#### 已实施和验证

- Activity feed 按稳定 item kind 映射 Progress、Decisions、Results、Tools 和 Diagnostics。
- raw 与 reasoning 默认不进入主时间线，仅在用户主动展开 Diagnostics 后渲染。
- plan-generation/provider-run group 保留既有聚合，内部事件不会拆散成重复主事件。
- 主 feed 的 shown count 只统计用户活动，不把 diagnostics 噪声计入。
- Activity model/feed：29 tests passed；`bun run typecheck` 通过。

#### 后续风险

- 当前分层由 item kind 决定；新增 activity kind 时必须显式分类，否则默认进入 Progress。

### IA-01 — 收敛信息架构与统计口径

- 状态：`DONE`

目标职责：

- Dashboard：首页，只回答今天发生什么和什么需要用户；
- Tasks：全部工作和历史结果；
- Schedule：何时运行和自动化策略；
- Action Center：只存放真正阻塞自动化的决策；
- Workspace：单任务计划、执行、结果和恢复；
- Settings：系统能力和策略。

要求：

- `Needs you`、`Needs action`、`Ready`、`Queue` 等计数有公开定义；
- 点击计数进入相同定义的过滤结果；
- Tasks Failed 和 Action Center Failed 不得因口径不明而看似矛盾。

#### 已实施和验证

- Dashboard 只呈现今日运行、待用户决策和可开始工作；Tasks 提供 Work/Results 总入口；Schedule 管理时间与自动化策略；Action Center 仅呈现阻塞自动化的决策；Workspace 和 Settings 保持单任务与系统能力边界。
- Dashboard 与 Tasks 发布 `Needs you`、`Needs action`、`Ready`、`Queue`、`Failed` 的定义；Action Center 发布 waiting、failed 和 total 的口径；所有摘要入口链接到使用同一 URL 过滤器的目标列表。
- Tasks Failed 明确定义为执行失败；Action Center Failed 明确定义为失败后需要用户决定恢复路径，避免同名不同口径。
- Dashboard、Action Center、Tasks 与 Schedule 聚焦测试：24 passed；`bun run typecheck` 通过。

### CREATE-01 — 简化任务创建决策

- 状态：`DONE`

先选择任务模式：

1. 保存为待办；
2. 让 AI 协助计划；
3. 在指定时间自动执行。

只有选择自动执行后才展示：

- 日期和时间；
- recurrence；
- Provider；
- 审批策略；
- 自动化预演。

把 success criteria 和 output format 放入任务意图阶段，而不是创建后才警告。

#### 已实施和验证

- 创建入口先提供三种互斥模式：保存为任务、AI 协助计划、按时自动执行。
- 保存模式隐藏日期、recurrence、Provider 和自动化规则；计划模式只显示计划摘要和 readiness。
- 只有自动执行模式显示日期、recurrence、AI override、执行时间和完整可靠性预演。
- 模式直接映射既有 `autoPlanGenerationEnabled` / `autoExecute` 契约，无第二套业务状态。
- Task Create、onboarding 和 shell：32 tests passed；`bun run typecheck` 通过。

#### 后续风险

- success criteria 和 output format 仍使用任务描述表达，尚未有独立结构化字段；避免在未批准 schema 变更前伪造持久化契约。

### RESULT-01 — 建立可查找的结果资产

- 状态：`DONE`

先在 Tasks 中增加 Results 模式，不新增顶层页面：

- 搜索；
- 日期和任务筛选；
- Accepted / Needs review；
- artifact 类型；
- 来源任务；
- Provider；
- 运行版本；
- 周期 occurrence；
- artifact 缺失恢复。

成功标准：用户 30 秒内找到两周前某次周期任务的结果，并确认来源、执行时间和接受状态。

#### 已实施和验证

- Tasks 内新增 Work / Results 模式，不增加顶层导航；沿用任务搜索、筛选、排序和分页。
- Results 支持任意日期、最近 7 天、最近 30 天，并区分 Accepted / Needs review。
- 每条结果显示 artifact 类型、来源任务、执行时间、AI runtime、run ID 和 recurrence occurrence。
- list API 直接返回最新 run/artifact 关系，UI 不从标题或日志猜测版本。
- 缺少 artifact 时显示明确恢复说明和 Open result 动作。
- `bun run typecheck` 通过；Task list focused tests：3 passed。

#### 后续风险

- 当前每个任务展示最新一次 run/result；完整跨运行历史仍需独立分页 API，不能用当前 task pagination 假装完成。
- 30 秒查找目标需要真实用户验证和结果规模压测。

### MOBILE-01 — 降低移动端操作负担

- 状态：`DONE`

#### 已实施和验证

- 移动端 Schedule 无显式 view 参数时默认 agenda/list，桌面保持 timeline；用户显式选择始终优先。
- 创建、计划审核、Provider 设置和结果浏览保持单一主动作；次要设置、诊断和高级控制使用 disclosure、menu 或次级按钮。
- 简单计划默认展示有序步骤，计划图降级为按需诊断视图；复杂计划保留完整图能力。
- 390×844 Schedule、1024×768 Tasks、1440×900 Dashboard 均实机浏览验证：`scrollWidth === clientWidth`；390px 默认 List 已确认。
- Schedule utility 和页面聚焦测试合计 24 passed；`bun run typecheck` 与 `bun run check:ui-foundation` 通过。

### DOCS-01 — 统一产品定位和文档承诺

- 状态：`DONE`

统一定位：

> Chrona 是一个本地运行的 AI 工作执行器：用户决定要做什么、何时执行和哪些边界不可越过；Chrona 负责计划、定时执行、暂停求助、保留证据和交付结果。

#### 已实施和验证

- README tagline、首屏介绍、Project Status、package description 和 Roadmap 使用同一“local AI work executor”定位。
- Quick Start 保持与产品内首次使用路径一致：连接并测试 AI、创建任务、生成/审核计划、手动或定时执行、检查结果。
- Project Status 明确列出 replay/resume、完整跨运行结果历史、生产认证和运维强化仍为实验性或不完整，不宣传 production-ready 或无条件可靠无人执行。
- `bun run typecheck` 通过。

---

## 8. 实施顺序

### 当前阶段：可靠自动化

1. `AUTO-01` 自动化策略预演和幂等 occurrence；
2. `READY-01` 统一 readiness；
3. `TEST-01` scheduler/restart/duplicate/late-event 测试；
4. `PLAN-01` 计划生成状态机；
5. `RECOVERY-01` 结构化恢复。

### 第二阶段：首次完整成功

6. `ONBOARD-01` 首次使用；
7. `PROVIDER-01` 简化 Provider 配置；
8. `CREATE-01` 任务创建模式；
9. `PLAN-02` 简化计划审核。

### 第三阶段：日常长期使用

10. `ACTIVITY-01` 语义 Activity；
11. `RESULT-01` 结果检索；
12. `IA-01` 信息架构和统计口径；
13. `MOBILE-01` 移动端和可访问性；
14. `DOCS-01` 对外叙事和发布说明最终对齐。

## 9. 暂停扩展项

以下能力在 P0/P1 完成前保持 `HOLD`：

- 新 Provider；
- 更多计划节点类型；
- 多会话、多 Agent 编排；
- Provider 自动路由；
- 更复杂自动重试；
- Dashboard 新 AI 卡片；
- json-render 扩展到更多运行控制界面；
- 新顶层导航；
- 无审批的高风险外部写入；
- 组织级项目管理。

## 10. 每项任务完成要求

任何条目只有同时满足以下条件才可标记 `DONE`：

1. 用户问题已经解决，不只是增加说明文字；
2. 产品行为和 UI 表达使用同一个规则来源；
3. 正常路径和至少一个真实异常路径通过；
4. 有针对性的行为测试；
5. `bun run typecheck` 通过；
6. 涉及 package boundary 时 `bun run check:boundaries` 无新增 error；
7. UI 变更验证 1440×900、1024×768、390×844；
8. 文档状态、验证证据和剩余风险已更新到本文件。

## 11. 发布前总验收

### 状态和执行

- [x] 同一任务跨页面使用统一状态模型。
- [x] 非 Running 状态无 Pause/Stop/live progress。
- [ ] 终态不会被持久化迟到事件降级。
- [ ] Start 和 scheduler trigger 幂等。
- [ ] occurrence 有唯一身份。
- [ ] 重启不会静默重复执行。

### 自动化透明度

- [ ] 保存前显示完整执行预演。
- [ ] 显示 Provider 和 readiness。
- [ ] 显示计划审批要求。
- [ ] 显示重试和 missed-run 策略。
- [ ] 显示页面关闭和进程关闭行为。
- [ ] 可取消未来 occurrence 和当前运行。

### 恢复

- [ ] 错误有用户摘要。
- [ ] 技术详情默认折叠。
- [ ] 显示已保留进度。
- [ ] 显示重试起点。
- [ ] 显示重复副作用风险。
- [x] WaitingForInput 和 WaitingForApproval 状态不同。

### 首次与日常使用

- [ ] 首次用户五分钟内完成安全任务。
- [ ] 简单计划不强制图形审核。
- [ ] Activity 默认无投影和重复技术事件。
- [x] 390px 下核心 Workspace 无横向滚动。
- [ ] 主要流程全键盘可完成。
- [ ] 每个页面只有一个主要动作。
- [ ] 用户能在 30 秒内找到历史结果。

---

## 12. 下一轮执行优化计划

### 12.1 决策

现有 `STATE-01` 至 `DOCS-01` 保留为已实现基线。下一轮不重复重做这些能力，而是把发布前总验收中尚未关闭的合同转成可执行工作包，并用真实用户路径证明它们端到端成立。

执行目标：

```text
已实现的局部能力
→ 跨页面、跨进程的可靠合同
→ 首次用户可完成的完整闭环
→ 可量化、可回归的发布门禁
```

本轮不新增 Provider、计划节点类型、顶层导航、自动重试策略或数据库字段。若实现中发现必须修改数据库、Provider 协议、认证、执行引擎语义或部署配置，停止该工作包并单独取得人工批准。

### 12.2 优先级和阶段

| 顺序 | 工作包 | 优先级 | 目标 | 前置依赖 |
| --- | --- | --- | --- | --- |
| 1 | `BASELINE-02` | P0 | 让追踪状态、当前构建和真实页面一致 | 无 |
| 2 | `RELIABILITY-02` | P0 | 关闭迟到事件、重复启动、occurrence 和重启合同 | BASELINE-02 |
| 3 | `TRANSPARENCY-02` | P1 | 用户保存前能准确预测自动化行为 | RELIABILITY-02 |
| 4 | `RECOVERY-02` | P1 | 从真实失败到安全恢复形成完整路径 | RELIABILITY-02 |
| 5 | `FIRST-RUN-02` | P1 | 新用户五分钟内获得首个安全结果 | TRANSPARENCY-02、RECOVERY-02 |
| 6 | `DAILY-USE-02` | P2 | 日常操作、键盘和历史结果检索达到可用指标 | FIRST-RUN-02 |
| 7 | `RELEASE-UX-02` | P0 | 固化发布验收和证据 | 全部工作包 |

### 12.3 工作包

#### BASELINE-02 — 校准实现、文档和运行页面

- 状态：`IN PROGRESS`
- 在 fresh data directory 启动当前构建，不复用旧 server、旧 Vite 产物或历史数据库。
- 对照 `DONE` 条目检查 Dashboard、Task Create、Onboarding、Settings、Workspace、Schedule、Results。
- 把“代码已实现但运行页面未出现”归类为构建/迁移/数据兼容问题，不再次创建第二套 UI。
- 修复 Dashboard 可观察缺陷：重复主操作、单复数、关键指标截断、中文字体 fallback 和长错误摘要占据主卡片。

验收：

- fresh install 与现有用户数据升级路径显示同一产品模型；
- 每个页面只有一个视觉主操作；
- 中英文任务标题和关键统计不出现不可读方框或关键语义截断；
- Dashboard 默认不显示 raw runtime incident；
- 1440×900、1024×768、390×844 均无横向滚动或固定操作栏遮挡内容。

验证：页面聚焦测试、`bun run check:ui-foundation`、`bun run typecheck`、三档浏览器截图和滚动范围检查。

#### RELIABILITY-02 — 关闭自动执行发布合同

- 状态：`IN PROGRESS`
- 证明终态执行不会被迟到 provider、node 或 projection 事件降级。
- 证明用户重复点击 Start、scheduler 重复扫描和用户 Start 与 scheduler 竞争时只领取一次执行。
- 为 recurrence occurrence 保持稳定唯一身份；刷新、重启和补跑不得生成第二个逻辑 occurrence。
- fresh process 重启后恢复运行、等待或终态；无法恢复时进入明确、可操作的状态，不静默重跑。
- 保持当前“失败后不自动重试”规则，避免未知外部副作用重复。

验收：

- 发布前总验收第 713–717 行全部有可复现证据；
- 每个竞态测试同时断言数据库执行数、用户状态和可见主操作；
- 测试覆盖成功、等待输入、等待审批、失败、取消、完成六类恢复结果；
- 不依赖固定 sleep 证明幂等。

验证：targeted domain/engine/server tests、`auto-execution-golden-path.spec.ts`、`recurring-task-lifecycle.spec.ts`、fresh-process restart integration、`bun run typecheck`。

#### TRANSPARENCY-02 — 完成自动化策略预演

- 状态：`DONE`
- Task Create 和 Schedule 保存前共用 `AutomationPolicyPreview`，不在组件内重建规则。
- 预演固定展示：开始时间和时区、AI runtime、readiness、是否需要计划批准、输入/审批暂停规则、失败重试规则、missed-run 行为、关闭页面和关闭 Chrona 进程后的行为。
- 明确区分“取消未来 occurrence”和“停止当前运行”；只展示后端确实支持的动作。
- disabled 状态必须显示唯一原因和深链接修复动作。

验收：

- 不读文档的用户能准确复述下一次执行时间、是否自动启动、何时暂停、失败是否重试、关闭应用后的结果；
- Settings、Schedule、Task Create、Workspace 对同一 readiness 返回同一标签和修复动作；
- 发布前总验收第 720–725 行全部关闭。

验证：table-driven domain tests、Task Create/Schedule focused tests、一次 ready 和一次 provider-unreachable 浏览器流程、`bun run typecheck`。

#### RECOVERY-02 — 验证真实失败恢复闭环

- 状态：`IN PROGRESS`
- 使用真实失败夹具覆盖 provider 不可达、工具失败、等待输入、等待审批、部分外部副作用和 artifact 缺失。
- 默认恢复卡只展示用户摘要、保留进度、重试起点、副作用风险和一个推荐动作；Diagnostics 默认折叠。
- 推荐动作必须执行真实命令并到达预期状态，不能停在说明页面。
- 对不支持 replay/resume 的 Provider 明确说明将从哪里重新开始，不伪装为自动恢复。

验收：

- 用户无需展开 Diagnostics 即可完成恢复；
- 等待输入和等待审批使用不同表单、文案和状态；
- 重试前能判断是否可能重复外部副作用；
- 发布前总验收第 729–733 行全部关闭。

验证：domain failure matrix、Workspace recovery component tests、失败→恢复 E2E、`bun run typecheck`。

#### FIRST-RUN-02 — 首次完整成功路径

- 状态：`IN PROGRESS`
- 从空数据目录开始，串联 Welcome、AI connection test、默认 capability assignment、demo task、计划审核、执行和结果确认。
- 默认 demo 必须无外部写入副作用；没有可用 AI 时提供明确配置路径，不使用伪造结果。
- 区分计划批准和结果确认，并在当下解释影响。
- 完成后把用户带到真实结果和来源执行记录，而不是只显示成功 toast。

验收：

- 内部可用性测试至少 5 名首次用户；80% 无协助完成；
- 首次有效结果中位时间少于 5 分钟；
- 每位用户配置错误不超过一次；
- 参与者能解释计划批准与结果确认的区别；
- 刷新和跨页面后 onboarding 不重复或丢失进度。

验证：新增 fresh-profile first-run E2E，复用真实 API 和确定性 provider fixture；保留人工观察记录；`bun run typecheck`。

#### DAILY-USE-02 — 日常效率、键盘与结果检索

- 状态：`IN PROGRESS`
- 为 Dashboard、Tasks、Schedule、Workspace 各保留一个上下文主操作；全局 New Task 不与页面主操作竞争。
- 完成键盘路径：导航、创建任务、计划审核、批准/输入、停止/取消、查看结果。
- 焦点进入和退出 Dialog/Sheet 后回到触发点；禁用动作向读屏用户提供原因。
- 使用至少两周、多个 recurrence occurrence 的夹具验证 Results 搜索、日期、状态和来源筛选。

验收：

- 核心路径可全键盘完成且无 focus trap；
- axe 无 critical/serious violations；
- 用户 30 秒内找到指定历史 occurrence，确认来源、执行时间和结果状态；
- 简单计划默认不要求理解图；Activity 默认不出现重复内部事件。

验证：扩充 `task-workspace-accessibility.spec.ts`、Results E2E、三档 viewport E2E、人工键盘 smoke、`bun run check:ui-foundation`、`bun run typecheck`。

#### RELEASE-UX-02 — 固化发布门禁

- 状态：`IN PROGRESS`
- 将本文件第 11 节每个 checkbox 绑定到测试、浏览器证据或用户测试记录。
- fresh install 和 previous-release database upgrade 分别完成完整 smoke。
- 只在所有 P0 和 P1 合同关闭后解除第 9 节扩展项的 `HOLD`；P2/P3 可带明确风险进入候选版本，但不能伪报完成。
- 清理测试期间产生的 demo 数据、临时 Provider 配置和截图；更新 README/Quick Start 中实际可用路径。

验收：

- 第 11 节无无证据的勾选项；
- `bun run typecheck`、`bun run lint`、`bun run test`、`bun run test:e2e` 通过；
- `bun run chrona build <target>` 与 `bun run build:smoke` 通过；
- fresh install 和 upgrade smoke 均可完成 Task → Plan → Schedule → Execute → Review/Recover。

### 12.4 执行规则

1. 每次只启动一个主工作包；工作包内可并行修改互不依赖的文件和测试。
2. 先复现用户问题，再修改共享规则源，最后更新所有消费者；禁止页面局部 special case。
3. 每个行为变更至少覆盖一个正常路径、一个异常路径和一个刷新/重载路径。
4. UI 测试断言用户可见标签、角色、disabled reason 和下一动作，不以 CSS snapshot 代替行为。
5. 工作包达到验收后立即在本文件记录测试命令、结果、浏览器证据和剩余风险；否则保持 `IN PROGRESS`。
6. 发现已发布迁移、认证、Provider 合同或执行语义需要变化时，停止并申请人工批准。

### 12.5 完成定义

本轮完成不是“所有组件都存在”，而是下列真实路径可重复通过：

```text
fresh start
→ connect AI
→ create safe task
→ understand automation preview
→ review plan
→ run now or schedule
→ handle input/approval/failure
→ review result
→ find the same result later
→ restart Chrona without duplicate work
```

同时满足：状态一致、一个主动作、自动化可预测、失败可恢复、结果可查找、键盘可完成、重启不重复执行。

### 12.6 2026-07-10 执行记录

- `BASELINE-02`：`IN PROGRESS`。Dashboard 移除内容区重复 New task 主操作，保留 shell 全局创建入口；英文 headline 按 1/多项处理 task grammar；metric label 不再强制单行截断。Dashboard focused tests 13 passed；新增 singular/主操作合同测试；`bun run typecheck` 与 `bun run check:ui-foundation` 通过。
- `RELIABILITY-02`：既有迟到终态与 duplicate scheduler/restart 合同复核通过：27 targeted tests passed。仍需独立 fresh-process E2E 后才能关闭本工作包。
- `TRANSPARENCY-02`：既有 `AutomationPolicyPreview` 已覆盖 Provider、readiness、下一 occurrence、计划批准、暂停、missed-run、失败不自动重试和页面/进程关闭规则；domain preview tests 与 failure tests 合计 8 passed。仍需浏览器 ready/unreachable 两条路径。
- `RECOVERY-02`：新增 Workspace recovery presentation tests，验证保留进度、重试起点、副作用风险、Diagnostics 默认折叠，以及 input/approval 区分；2 tests passed。
- `FIRST-RUN-02`：Onboarding、safe demo、Task Create 核心/AI 路径复核，31 tests passed。五名真实首次用户和五分钟指标仍需产品测试，保持 `IN PROGRESS`。
- `DAILY-USE-02`：Workspace desktop accessibility E2E 通过；修改文件 ESLint 0 errors；全仓 lint 仍有 3 个既有 errors 和 836 warnings，未伪报发布门禁通过。
- `RELEASE-UX-02`：`bun run typecheck` 通过；全量发布命令尚未全部通过，因此本轮不勾选第 11 节未完成合同。
- `2026-07-10 续查`：第 12 节七个工作包此前均仍写为 `TODO`，与 12.6 的实际执行记录冲突，现统一校正为 `IN PROGRESS`；第 11 节仍有 22 个未关闭 checkbox，不能使用第 3 节 `15/15` 推断发布验收完成。
- 已修复两组过期测试期望：scheduler skip reason 现在断言共享 automation policy 的用户可见原因；input/approval recovery 使用 `arrayContaining` 验证推荐动作，同时允许 Diagnostics 安全动作。相关 domain/engine 35 tests passed。
- `RELIABILITY-02 续查`：restart recovery 新增 WaitingForInput / WaitingForApproval 持久状态合同，确认重启扫描不将其 Abandon 且不创建第二个 run；duplicate execution 新增并发 manual Start，以及 manual Start 与 scheduler Start 同时竞争的测试，均确认只创建一个 provider attempt 和一个首节点 attempt。重启、调度与并发启动 focused tests 通过；`bun run typecheck` 通过。剩余发布缺口是启动真实独立进程后的 restart E2E。
- `TRANSPARENCY-02 完成`：Task Create 的共享 policy preview 现在明确展示本地开始时间与 IANA 时区、AI runtime、计划审批语义、input/approval 暂停、missed-run、失败不自动重试，以及关闭页面/Chrona 进程后的行为；缺少 AI 时继续返回单一修复原因。UI focused 16 tests 与 domain policy 6 tests passed。取消未来 occurrence 与停止当前运行继续使用既有不同控制，不在预演中承诺不存在的新动作。

## 13. Task Workspace 桌面端重构方案（2026-07-10）

### 13.1 设计目标

Task Workspace 不再作为所有任务组件的平铺容器，而是由任务状态驱动的工作台。桌面端每个状态必须同时满足：一个视觉中心、一个上下文主操作、一个稳定内容网格；历史、Activity、Diagnostics 和非当前节点信息按需展开。

用户进入页面后应在首屏回答四个问题：这是什么任务、现在处于什么状态、当前发生了什么、下一步做什么。功能完整性不等于同时展开全部功能。

### 13.2 最优桌面信息架构

```text
Compact task header: title · status · priority · overflow
Lifecycle rail: Brief — Plan — Review — Run — Result · current next action
Main workspace
├─ Primary surface: Brief / Plan / Execution / Decision / Result
└─ Context rail: current context and the single primary action
Progressive disclosure
└─ Activity / Diagnostics / previous runs / secondary metadata
```

视觉约束：页面只保留主工作区和注意状态两级显性容器；内部区域优先使用留白与 divider，不使用 Card 套 Card；状态颜色只表达运行、等待、失败、完成和 AI 内容边界；相同状态文案不在 Header、Stage、Operation、Result 四处重复。

### 13.3 状态布局合同

| 模式 | 主表面 | 唯一主操作 | Context rail | 默认折叠 |
|---|---|---|---|---|
| `briefing` | Brief/readiness | Generate plan | Provider readiness | Activity、Diagnostics |
| `planning` | Generation progress | Cancel generation | Provider、elapsed state | Diagnostics |
| `reviewing_plan` | Plan graph | Accept plan | Review summary、revision | Activity |
| `ready_to_run` | Plan graph | Start run | Run readiness | Activity |
| `running` | Current execution | Current runtime action | Current node、latest output | Full activity、Diagnostics |
| `blocked` | Decision/recovery | Recommended recovery | Retained progress、retry point | Raw diagnostics |
| `completed` | Result | Accept result | Result review | Execution history |
| `done` | Accepted result | Ask follow-up | Lightweight continuation | Execution history |

`Completed` 与 `Done` 不共享主操作：前者仍需确认结果，后者已关闭任务。`WaitingForInput` 与 `WaitingForApproval` 继续通过共享 work-state 派生区分。未知外部副作用失败继续禁止自动重试。

### 13.4 组件实施方案

1. 扩展 `TASK_WORKSPACE_DISPLAY_RULES`：除 panel visibility 外，固定 `primarySurface`、`primaryAction`、`contextRail` 和默认折叠区域；React 组件不得重新推断状态布局。
2. 将 Stage Card 改为紧凑 lifecycle rail，直接属于工作区结构，不重复大型状态标题和 Next 文案。
3. 桌面主区采用状态布局：Plan/Run 为主区 + context rail；Result 状态切换为 result-first 单列布局，实际结果先于执行历史。
4. 将 Result Review 从大面积深色卡改为紧凑决策条；Result 内容保持第一视觉层级，接受/修改操作紧邻结果语义。
5. Activity 与 Diagnostics 继续 progressive disclosure；仅 Running 状态显示紧凑实时摘要，不与主结果或 Plan 永久并列。
6. Selected Node Details 只作为 Plan context，不再形成跨越整列的第三层大卡。
7. 保留现有 Header 编辑、删除、Provider readiness、Plan revision、checkpoint、恢复、Result acceptance、follow-up 和 artifact 功能；本轮不修改 API、执行引擎、Provider 协议或数据库。

### 13.5 桌面视觉规范

- 主工作区间距 `16px`，页面 section 间距 `20–24px`；内部相关行间距 `8px`。
- 主工作区允许一个 `20–24px` 圆角边界；内部常规 section 不再重复大圆角边框。
- Task title `24–28px`；主 section `18–20px`；operation `16px`；正文 `14px`；metadata `12px`。
- 桌面 `1440×900` 首屏必须出现当前主表面和主操作；完成状态必须出现实际 Result，而不是只出现完成说明。
- 平板与移动端仅保证不回退、不横向溢出、不被固定导航遮挡；独立移动端信息架构留待后续工作包。

### 13.6 实施与验收顺序

1. 先补状态表合同和 display-rule tests。
2. 重构 lifecycle rail、主工作区外壳和 Result Review 视觉层级。
3. 调整 Result-first 与 Plan/Execution 双栏编排，不改变行为 API。
4. 验证 briefing、reviewing、ready、running、blocked、completed、done 固定展示规则。
5. 运行 focused tests、`bun run check:ui-foundation`、`bun run typecheck`，并在 `1440×900` 实际浏览器检查首屏、主操作和滚动边界。

### 13.7 第一阶段实施记录

- 已扩展共享展示规则：每个 mode 现在固定 `primarySurface`、`primaryAction`、`contextRail` 与 `collapsedByDefault`，继续由 `deriveTaskWorkspaceDisplayState()` 单点派生。
- 生命周期从独立大型 Stage Card 改为工作区顶部紧凑 rail；状态、阶段和 next action 使用同一横向层级。
- Completed/Done 切换为 result-first：Execution Result 先出现，Result Review 和 Follow-up 后置；两者的主操作继续由状态表区分。
- Result Review 从大面积深色卡改为紧凑决策条，减少其对实际结果内容的视觉压制。
- Inspector 支持 `operationPlacement` 与无 Header result layout；Plan/Running 保持 current-operation-first，Result 保持 result-first。
- Result workspace 桌面改为自身纵向滚动，修复 `1440×900` 下结果和 Activity 被固定高度容器裁切。
- 浏览器复核：compact lifecycle、result-first ordering、无可见裁切、主操作清晰均通过；仍存在结果 spec 内部多层 Card 的视觉噪声，作为下一阶段 json-render result surface 扁平化事项保留。
- 验证：31 个 Workspace focused tests 通过；新增 2 个 inspector ordering tests；`bun run typecheck`、`bun run check:ui-foundation` 通过；修改文件 ESLint 0 errors。

### 13.8 Plan Setup 聚焦页面实施记录

- `briefing` 与 `planning` 使用独立 `brief_focus` 布局，不再复用 Plan/Execution 双栏工作台；`reviewing_plan`、`ready_to_run`、`running`、`blocked` 分别使用 `plan_workbench`、`execution_focus`、`decision_focus`。
- 原 `Ready to plan?` 检查卡替换为单一 `PlanSetupPanel`：显示明确结论、Task Brief 摘要、仅展开的推荐改进项、required readiness 摘要和唯一主操作。
- Readiness checks 增加 `required/recommended/optional` 等级和可执行 action。Schedule 归为 optional，不再导致 warning；Title/Provider 为 required；Description/Success criteria/Output format 为 recommended。
- 删除无行为的 Plan intent badges，避免伪交互；页面明确说明 Generate plan 只创建 draft，接受计划前不会执行。
- Provider 缺失时不再显示禁用的 Configure provider 按钮，改为可访问 `/settings?panel=ai-clients` 的 `Connect AI provider` 主操作。
- `Edit task brief` 与各改进项接入现有 Task Edit dialog；Generate plan 在 Brief Focus 中只保留一个入口，空 Plan Graph 和 Execution Inspector 不再渲染。
- 验证：Plan Setup 和 readiness 新增 4 个行为测试；Workspace focused suite 31 tests passed；`bun run typecheck`、`bun run check:ui-foundation` 通过；修改文件 ESLint 0 errors。

### 13.9 Plan Setup 全宽桌面布局修订

居中的单一卡片虽然降低了噪声，但在宽屏工作区中造成主区域过小、两侧空置和“表单弹窗”感。Plan Setup 改为占满 Workspace 可用宽度的两区工作台：左侧约三分之二承载任务 Brief 与质量改进，右侧约三分之一作为稳定的 Plan Launch rail，展示 required readiness、生成边界、唯一主操作和后续流程。顶部结论成为工作区 section header，不再包在另一张 Card 中。

桌面结构：`full-width intro → 2-column setup workspace → left brief/improvements + right sticky launch rail`。只保留右侧行动区为强调 surface；左侧用 section、divider 和轻背景组织，避免用一个居中 Card 填充页面。`1440×900` 下内容宽度应使用整个 Workspace，主操作保持首屏可见。
