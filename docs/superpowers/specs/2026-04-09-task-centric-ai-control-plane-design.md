# Task-Centric AI Control Plane Design

> Supersedes `docs/superpowers/specs/2026-04-08-task-centric-ai-control-plane-design.md`.
> This revision promotes `Schedule` to an MVP-critical surface and tightens the role boundaries of `Schedule / Task / Work`.

## 1. 文档目的
本设计文档用于把当前已确认的产品方向、页面语义、架构边界、同步规则和恢复机制固化下来，作为后续实现计划的直接输入。

目标不是做一个传统后台，也不是做一个聊天壳，而是做一个以 `Task` 为中心、以 `Run` 为执行实例、以结构化事件为观测基础、以任务安排为关键能力的 `AI-native control plane`。

## 2. 产品定位与硬约束

### 2.1 产品定位
本项目的目标产品形态是 `Task-Centric AI Control Plane`，不是：
- 传统 admin-first 的任务后台
- conversation-first 的聊天工作台
- 单纯包装 runtime 对话日志的 UI 壳

系统必须优先暴露：
- 任务与责任
- 安排与排程
- 运行状态与阻塞
- 审批与人工介入
- 产物与执行链路

### 2.2 不可退化约束
用户已经明确选择路线 B：`Task-Centric AI Control Plane`。

这意味着：
- A 路线（传统管理后台）不是 fallback
- C 路线（聊天优先工作台）不是 fallback
- 如果后续验证发现 B 路线无法成立，项目可以停止，但不能为了“做出来”而退化成 A 或 C

### 2.3 页面语义清晰是产品要求，不是文档补丁
后续可以补 `使用说明`，但不能依赖文档来弥补页面职责本身的不清楚。

MVP 页面必须做到即使用户不看说明，也能大致理解这三类工作面：
- `Schedule`：安排任务
- `Task Page`：管理单个任务的计划与控制
- `Work Page`：观察和推进单个任务的执行

### 2.4 MVP 守门原则
如果出现以下情况，说明产品正在偏离 B：
- 用户必须先读完整对话才知道任务状态
- 审批只能在聊天中理解，不能结构化呈现
- 工具调用只能在原始日志中查看，不能形成结构化执行上下文
- 任务是否 blocked、为什么 blocked、谁该处理不能在摘要层直接看见
- 排程只剩几个日期字段，没有形成真正的任务安排能力

## 3. 技术栈结论
第一阶段采用：
- `Next.js`
- `SQLite` 作为早期开发和轻量部署数据库
- 后续平滑迁移到 `Postgres`
- `Prisma` 作为 ORM / schema 管理层
- `shadcn/ui` 作为 UI 基础组件层

选择原因：
- 对 AI 辅助开发更友好，页面、组件和后端边界清晰
- 前后端可以在一个工程内保持较短回路
- 适合 MVP 阶段快速迭代读模型、页面和 adapter contract
- 能兼顾早期 SQLite 和后期 Postgres 的演进路径

## 4. 总体架构
系统按四层划分。

### 4.1 Control Plane UI
负责呈现平台规范对象，而不是 runtime 原生对象。

主要页面：
- `Workspace Overview`
- `Schedule`
- `Task Center`
- `Task Page`
- `Work Page`
- `Inbox`
- `Memory Console`
- `Settings`

### 4.2 Application / Domain
负责平台核心领域规则与状态机。

核心职责：
- 维护 `Workspace`、`Task`、`Run`、`Approval`、`Artifact`、`Memory`、`Event`
- 维护任务安排、阻塞、恢复和审批等业务语义
- 统一处理 UI 动作对应的领域命令
- 基于运行事实推导任务状态和排程状态

### 4.3 Runtime Adapter
首发仅实现 `OpenClawAdapter`。

它是 anti-corruption layer，只负责把 OpenClaw 的运行时行为翻译成平台规范对象与事件，不能把 runtime 原生语义直接渗透到 UI 和领域层。

### 4.4 Persistence / Infra
负责持久化当前状态与事件历史。

MVP 使用 SQLite，但设计必须满足后续迁移到 Postgres 时无需改写核心领域边界。

系统既要保存：
- `current state`
- `structured event history`

不能只保留其中之一。

## 5. 建议模块边界
建议按以下职责拆分模块：
- `workspace-core`
- `task-orchestrator`
- `run-tracker`
- `approval-center`
- `artifact-registry`
- `memory-console`
- `event-timeline`
- `schedule-coordinator`
- `runtime-adapters/openclaw`
- `ui/workspace`
- `ui/schedule`
- `ui/task-detail`
- `ui/work-page`

原则是：
- UI 层按页面和读模型拆分
- Domain 层按核心对象与行为拆分
- Adapter 层按 runtime 隔离
- 不为了未来多 runtime 提前做复杂抽象，只保留明确 adapter contract

## 6. 规范领域模型

### 6.1 核心对象
- `Workspace`：任务与记忆的顶层容器
- `Task`：系统主对象，代表一个目标、责任和状态容器
- `Run`：Task 的一次执行实例，允许多次重试、恢复、重新规划
- `Event`：系统事实流，是 timeline 和投影视图的基础
- `Approval`：需要人类决策的中断点，必须关联 `Task` 与 `Run`
- `Artifact`：由某次 `Run` 产生的输出结果
- `Memory`：与 workspace/task/run 相关的可追踪记忆条目

### 6.2 任务安排字段
`Task` 至少要保留以下正式字段：
- `dueAt`
- `scheduledStartAt`
- `scheduledEndAt`
- `scheduleStatus`：如 `unscheduled / scheduled / in_progress / overdue / at_risk / interrupted`
- `scheduleSource`：如 `human / ai / system`
- `assigneeRef`

这些字段不是 UI 装饰，而是平台级任务安排能力的基础。

### 6.3 关系原则
- 一个 `Workspace` 包含多个 `Task`
- 一个 `Task` 可以有多个 `Run`
- 一个 `Run` 必须属于一个 `Task`
- `Approval` 和 `Artifact` 必须能追溯到对应 `Run`
- `Event` 作为系统事实流，反向支撑 timeline、block summary、latest run summary 和 schedule projection

### 6.4 Conversation 的地位
`Conversation` 不是顶层中心对象，而是某个 `Run` 的一个解释视图。

换句话说：
- 用户管理的是 `Task`
- 用户安排的是 `Task`
- 用户观察和推进的是 `Run`
- 对话只是执行过程的一个可读切面

### 6.5 Tool Call 的建模
`Tool Call` 不能只作为一段原始日志文本存在。

MVP 采用两层表达：
- 平台统一事件层：通过 `tool.called`、`tool.completed` 等事件进入 timeline
- 细节层：通过 `ToolCallDetail` 保留参数、结果、错误摘要等执行细节

这样既能支撑任务控制面，也能支撑调试与审计。

### 6.6 Session 与 Task 的边界
平台不能把 OpenClaw session 直接等同于 `Task`。

允许：
- `Task` 挂接 `sourceSessionRef` 作为来源引用
- `Run` 挂接 runtime session context 作为执行上下文

不允许：
- 用 session 直接充当 task 主键语义
- 让页面围绕 session 而不是 task 构建

## 7. OpenClaw-First Adapter 设计

### 7.1 Adapter 定位
`OpenClawAdapter` 是平台和 OpenClaw runtime 之间的 anti-corruption layer。

只有 adapter 知道 OpenClaw 原生 schema、状态名、消息格式和外部引用。其余层只消费平台规范对象。

### 7.2 Adapter 职责边界
MVP 中 adapter 只负责五类职责：
- 接收平台动作：`create run`、`retry`、`resume`、`cancel`、`submit approval`、`provide human input`
- 拉取 runtime 状态：运行状态、消息、工具调用、审批请求、产物、错误
- 映射为规范对象：`Run`、`Event`、`Approval`、`Artifact`、`ConversationEntry`、`ToolCallDetail`
- 维护同步位置：外部引用、cursor/offset、最后同步时间等
- 上报 adapter 自身健康状态，而不是伪装成业务失败

### 7.3 MVP 同步策略
MVP 采用 `hybrid pull-first`：
- 平台写入后立即调用 adapter 执行外部动作
- adapter 通过轮询方式增量同步 OpenClaw 状态
- 同步结果先落成规范事件，再更新当前状态与投影视图

Webhooks 或流式订阅可以作为后续增强，但不是 MVP 依赖项。

### 7.4 可接受问题与不可接受问题
可接受：
- event 粒度不够完美
- 某些 payload 细节映射不完整
- 只能靠 polling，同步不是实时流式

不可接受：
- 无法稳定触发执行
- 无法判断 run 是 `running / waiting / failed / completed`
- 无法识别 `waiting for approval` 或 `waiting for input`
- 无法把至少一部分消息或工具调用挂回任务执行上下文
- 无法建立可追踪的 `task -> run -> event` 链路

### 7.5 最小可行性门槛
在正式进入实现前，必须能验证 OpenClaw 至少满足四点：
- 可以触发执行
- 可以查询执行状态
- 可以读取关键执行输出
- 可以从审批或输入等待态继续推进执行

如果这四点无法成立，则项目不应继续推进成一个伪 B 产品。

## 8. 信息架构与页面语义

### 8.1 顶层导航
MVP 顶层导航调整为：
- `Workspaces`
- `Schedule`
- `Tasks`
- `Inbox`
- `Memory`
- `Settings`

这里 `Schedule` 是关键入口，不再视为 Phase 2 附属页面。

### 8.2 Workspace Overview
`Workspace Overview` 是运营分诊面，不是 BI dashboard，也不是欢迎页。

建议展示：
- `Running Tasks`
- `Waiting for Approval`
- `Blocked / Failed Tasks`
- `Upcoming Deadlines`
- `Recently Updated Tasks`

它的任务是帮助用户先看到哪里要处理。

### 8.3 Schedule
`Schedule` 是全局任务安排面，不是展示层，而是实际编排层。

默认要回答三个问题：
- 什么时候做
- 谁或哪个 agent 做
- 当前排程是否冲突

核心内容：
- 日程视图：按时间块看已安排任务
- `Unscheduled Queue`：还没进入时间表的任务
- `AI Proposals`：AI 提出的排程建议
- `Conflicts / Overdue Risks`：冲突、超期风险、容量问题

### 8.4 Task Center
`Task Center` 不是被动数据表，而是任务控制列表。

每条任务摘要至少应显示：
- title
- current status
- priority
- block reason summary
- latest run status
- due date
- current schedule summary
- last update time

默认过滤与视角应偏向：
- `Running`
- `WaitingForApproval`
- `Blocked`
- `Failed`
- `Unscheduled`
- `Overdue`

### 8.5 Task Page
建议路由：`/workspaces/:workspaceId/tasks/:taskId`

`Task Page` 负责计划和控制，回答：
- 这个任务是什么
- 为什么重要
- 什么时候做
- 当前卡在哪里

它应承载：
- task definition
- priority
- dependencies
- owner
- budget
- deadline 和 schedule
- latest run summary
- recent approvals / artifacts / block reason
- 进入 `Work Page` 的入口

### 8.6 Work Page
建议路由：`/workspaces/:workspaceId/work/:taskId`

`Work Page` 不是 `Task Page` 的 tab，也不是子面板，而是独立的重型工作面。

它负责执行观察和人工介入，回答：
- 当前执行在做什么
- 刚刚发生了什么
- 我现在需要介入什么

当前产品方向进一步收敛为：`Work Page` 必须表现为 **run-level collaboration workbench**，而不是监控页、聊天壳或信息堆叠页。

它应承载：
- sticky `Task / Run` context bar
- `Next Action` 主干预区
- `Shared Output`
- `Execution Workstream`
- approvals / input requests
- artifacts
- tool activity
- 后续可能扩展的代码查看、文档查看和编辑能力

桌面端默认采用 **workbench hierarchy**：
- 顶部：sticky context bar，显示 task / run / schedule impact / block summary / deep links
- 主列：`Next Action` → `Shared Output` → `Execution Workstream`
- 右栏：inspector rail，承载 run snapshot、approvals、artifacts、tool activity、sync/runtime health

核心原则：
- 主区必须优先回答 `现在要做什么`
- `Execution Workstream` 是默认可见的观察面，但不应退化成原始日志堆
- conversation 是执行证据的一种切面，不是页面中心
- 低频信息和原始 payload 必须折叠或降级

### 8.7 Inbox
`Inbox` 只收纳需要人立刻处理的中断点，例如：
- approval request
- input request
- 高风险恢复确认
- 待确认的 AI 排程建议

每项应显示：
- action type
- risk level
- source task
- current run
- summary
- consequence

并支持：
- `approve`
- `reject`
- `edit-and-approve`

### 8.8 Memory Console
`Memory Console` 以运维视角展示记忆条目，而不是聊天附属页。

至少展示：
- content
- source
- scope
- status
- linked task/run

并支持手动失效。

### 8.9 响应式策略
- desktop：`Work Page` 三栏，`Schedule` 以完整编排视图为主
- tablet：两栏布局，右侧信息区可折叠
- mobile：堆叠布局，但必须保留 sticky task header、quick actions、status、block reason、approvals、关键 schedule 信息和关键 timeline 事件

响应式简化不能以丢失任务状态、阻塞可见性和任务安排上下文为代价。

## 9. 页面边界与读模型分层

### 9.1 页面职责边界
`Schedule` 负责：
- 全局任务编排
- 冲突检查
- 批量排程
- 接受或拒绝 AI 排程建议

`Task Page` 负责：
- 任务定义与计划控制
- 单个任务的安排调整
- 依赖、负责人、优先级和 block reason

`Work Page` 负责：
- 当前执行观察
- 审批和输入介入
- 失败诊断与恢复动作

### 9.2 读模型分层
至少拆成三类投影视图：

`Task Projection`：
- task status
- priority
- block reason
- latest run summary
- approval pending count
- deadline 和 schedule summary
- latest artifact refs
- last activity time

服务于：
- `Workspace Overview`
- `Task Center`
- `Task Page`

`Work Projection`：
- current run
- execution timeline
- conversation entries
- tool call details
- artifacts
- pending approvals / input requests
- runtime refs

服务于：
- `Work Page`

`Schedule Projection`：
- scheduled tasks by time range
- unscheduled tasks
- overdue / at-risk tasks
- AI schedule proposals
- assignee load summary

服务于：
- `Schedule`

### 9.3 数据装载边界
`Task Page` 读取：
- `Task Projection`
- 轻量 `latest/current run snippet`

`Work Page` 读取：
- 轻量 `Task Shell`
- 完整 `Work Projection`

`Schedule` 读取：
- `Schedule Projection`
- 必要的轻量 `Task Shell`

`Task Shell` 只保留跨页面必须知道的任务信息，例如标题、状态、优先级、block reason、deadline、schedule summary 和依赖摘要。

### 9.4 写操作边界
任务级编辑动作主要留在 `Task Page`：
- 修改标题或描述
- 调整优先级
- 调整依赖
- 调整负责人
- 更新目标定义

排程级动作主要放在 `Schedule` 和 `Task Page`：
- propose schedule
- apply schedule
- clear schedule
- reassign task
- accept or reject AI proposal

运行级动作主要放在 `Work Page`：
- start run
- retry run
- resume run
- submit approval
- provide input
- 查看执行输出与过程证据

允许 `Task Page` 保留少量控制入口动作，例如 `Start Run` 和 `Open Work Page`，但不应承载主要执行过程交互。

### 9.5 一致性规则
- 同一个任务的计划信息必须来自统一任务事实源
- 同一个运行的执行信息必须来自统一运行事实源
- `Schedule / Task / Work` 共享同一任务事实，但不共享同一职责

如果 `Schedule` 或 `Task Page` 修改了排期，`Work Page` 顶部的 `Task Shell` 必须及时反映。

如果 `Work Page` 产生了新的审批、产物或阻塞，`Task Page` 和 `Schedule` 的摘要与风险状态必须及时回流。

## 10. 数据流与状态同步规则

### 10.1 单一写入口
所有来自 `Schedule`、`Task Page` 或 `Work Page` 的动作，都必须先进入平台应用层命令，而不是直接修改页面状态或直接打到 OpenClaw。

固定链路为：
`UI Action -> Domain Command -> Domain Validation / State Check -> Local Record Write -> Adapter Call -> External Ref Persist -> Async Sync Completion`

这意味着：
- 本地系统先形成可追踪记录
- OpenClaw 是执行器，不是唯一真相源
- UI 不直接依赖 runtime 原生接口语义

### 10.2 排程命令集合
MVP 排程命令至少包括：
- `proposeSchedule`
- `applySchedule`
- `clearSchedule`
- `reassignTask`
- `acceptScheduleProposal`
- `rejectScheduleProposal`

这样可以确保日程变更不会在不同页面各改各的。

### 10.3 读取链路
读取通过统一同步链路完成，而不是让页面直接临时查询 OpenClaw：
`Adapter Poll/Sync -> Canonical Event Append -> Projection Update -> UI Read`

这样所有页面看到的是同一套平台状态，不会因为各自拼接 runtime 数据而产生口径分裂。

### 10.4 排程的真实来源
任务上保留当前排程快照，同时系统写入结构化事件。

MVP 至少保留以下排程事件：
- `task.schedule_proposed`
- `task.schedule_changed`
- `task.unscheduled`
- `task.assignment_changed`

也就是说：
- `Task` 上存当前值
- `Event` 里存为什么变成这样

### 10.5 AI 与用户如何共同安排
用户操作可以直接应用。

AI 操作默认先生成排程建议，再由用户确认；只有当 workspace 明确开启更激进策略时，AI 才能直接落盘。

无论哪种模式，都必须记录：
- `scheduleSource`
- `reason`
- `createdByPolicy`（如果来自策略）

这样后面才能审计是谁改了排程、为什么改。

### 10.6 运行态与排程态的同步规则
OpenClaw adapter 只负责产生运行事实，不直接改排程。

例如 adapter 只上报：
- `run.started`
- `run.completed`
- `run.failed`
- `waiting_for_input`
- `waiting_for_approval`

排程层的变化由领域层推导：
- `run.started` -> 任务可进入 `in_progress`
- `waiting_for_input` 或 `waiting_for_approval` -> 任务进入 `blocked`，当前排程标为 `at_risk`
- 超过 `scheduledEndAt` 仍未完成 -> 标记 `overdue` 或 `schedule_conflict`
- `run.completed` -> 清理活动时间块或转为完成态

重点是：运行系统提供事实，控制平面决定这些事实如何影响排程。

### 10.7 同步硬规则
- 必须同时保存 `current state` 和 `event history`
- 增量同步必须幂等，避免重复事件
- 事件排序优先使用 runtime 时间戳，必要时使用本地 ingest sequence 兜底
- `Task status` 和 `scheduleStatus` 都不允许由 adapter 直接硬写，必须由领域层推导
- `waiting for approval`、`waiting for input`、`sync stale` 必须成为显式状态，而不是隐藏在日志中
- `runtime failure` 和 `adapter sync failure` 必须分开表达

### 10.8 三个页面的数据解释关系
`Schedule` 回答：全局现在怎么排。

`Task Page` 回答：这个任务为什么这么排。

`Work Page` 回答：当前执行会不会破坏这个排程。

三者共用一条可追踪链路：
`task -> schedule snapshot -> run -> event`

## 11. 阻塞、失败与恢复机制

### 11.1 问题类型分层
MVP 不应把所有异常都合并成一个 `failed`。

至少要区分：
- `Blocked`：任务还能继续，但当前在等条件满足
- `Failed`：当前 run 已失败，不能自己继续
- `Degraded / Sync Issue`：平台与 OpenClaw 的同步或适配器观测出了问题，但不一定代表任务本身失败

### 11.2 阻塞原因要结构化
`Task` 不能只存一段 block message，而要至少暴露：
- `blockState`：`none / blocked / failed / degraded`
- `blockReasonCode`
- `blockSummary`
- `blockedAt`
- `blockedByRef`
- `recommendedAction`

`blockReasonCode` 至少覆盖：
- `waiting_for_input`
- `waiting_for_approval`
- `waiting_for_dependency`
- `waiting_for_schedule`
- `runtime_error`
- `tool_error`
- `adapter_sync_error`
- `overdue_risk`

这样 `Inbox / Schedule / Task / Work` 才能一致展示。

### 11.3 不同问题的主处理入口
- `waiting_for_input`：主入口是 `Inbox`，也可从 `Work Page` 直接输入并继续执行
- `waiting_for_approval`：主入口是 `Inbox`
- `waiting_for_dependency`：主入口是 `Task Page`
- `waiting_for_schedule` 或 `overdue_risk`：主入口是 `Schedule`
- `runtime_error / tool_error`：主入口是 `Work Page`
- `adapter_sync_error`：主入口偏 `Settings / Adapter Health`

任务页里可以展示这些问题，但不应让用户自己猜该去哪处理。

### 11.4 恢复动作必须精准对应
MVP 至少支持以下恢复动作：
- `resumeRunWithInput`
- `resolveApproval`
- `retryRunFromStart`
- `retryRunFromCheckpoint`（如果 OpenClaw 暂不支持，可以先只保留接口位）
- `replanTask`
- `rescheduleTask`
- `reassignTask`
- `markTaskAbandoned`

恢复动作的目标不是“再点一次”，而是回答下一步如何推进任务。

### 11.5 对 Schedule 的影响规则
阻塞和失败必须回写到排程层：
- 任务进入 `blocked` -> 当前时间块保留，但标记 `at_risk`
- 任务进入 `failed` -> 当前安排转成 `interrupted`
- 超过 `scheduledEndAt` 仍未完成 -> 标记 `overdue`
- 恢复成功并重新开始 -> 重新进入 `in_progress`

执行异常不能只留在 `Work Page`，它必须反馈到任务安排视角。

### 11.6 Task / Work 各自如何表达
`Task Page` 偏决策视角：
- 当前阻塞类型
- 阻塞开始时间
- 影响了哪个排程
- 推荐动作
- 是否影响依赖链或截止时间

`Work Page` 偏诊断与恢复视角：
- 失败发生在哪个 run 或哪一步
- 最近相关事件和工具调用
- 可恢复动作
- 恢复后会不会影响当前 schedule

### 11.7 一条硬规则
任何 `blocked / failed / degraded` 状态，都必须能在很短时间内回答四个问题：
- 卡在哪里
- 为什么卡
- 谁来处理
- 点哪个动作能继续

如果做不到，说明系统虽然有状态，但还没有形成真正的控制面价值。

## 12. MVP 范围与非目标

### 12.1 MVP 必须打通的主链路
MVP 需要打通：
- 创建任务
- 安排任务
- 触发 run
- 追踪 run
- 识别审批、输入、失败、阻塞
- 在 `Schedule / Task / Work` 三个面提供一致但职责分离的观察与操作
- 形成 `task -> run -> event -> artifact / approval` 的完整可追踪链路

### 12.2 MVP 排程范围
MVP 做：
- 手动排程
- AI 排程建议
- 冲突检测
- 延期与超期标记
- 待确认排程建议
- 全局 `Schedule` 顶级页面

MVP 不做：
- 复杂多周自动优化
- 精细资源容量模拟
- 自动连续重排整周日历
- 完整的高级日历产品化能力

### 12.3 后续阶段可扩展能力
可以留到后续阶段：
- 流式同步
- 多 runtime 深度兼容
- 高级可视化编排
- 更强的 calendar/time-block 交互
- IDE 级编辑工作台

## 13. 实现计划输入
本设计文档批准后，下一步不是直接写代码，而是基于本文输出实现计划。

实现计划必须围绕以下顺序展开：
- 先验证 OpenClaw feasibility gate
- 再定义数据模型与 adapter contract
- 再搭建读模型与同步链路
- 再落 `Schedule / Task / Work` 页面骨架与交互
- 最后补足恢复动作、错误状态和 memory/inbox 细节

在实现过程中，任何会把产品推回 A 或 C 的方案，都应视为设计违背，而不是可接受的工程折中。
