# Task-Centric AI Control Plane Design

## 1. 文档目的
本设计文档用于把当前已确认的产品方向、架构边界、页面职责、同步规则和失败处理规则固化下来，作为后续实现计划和开发的直接输入。

目标不是继续讨论产品是否做成传统后台或聊天壳，而是明确如何把它落成一个以 `Task` 为中心、以 `Run` 为执行实例、以结构化事件为观测基础的 `AI-native control plane`。

## 2. 产品定位与硬约束

### 2.1 产品定位
本项目的目标产品形态是 `Task-Centric AI Control Plane`，不是：
- 传统 admin-first 的任务后台
- conversation-first 的聊天工作台
- 单纯包装 runtime 对话日志的 UI 壳

系统必须优先暴露任务、状态、阻塞、审批、产物和执行链路，而不是先暴露聊天记录。

### 2.2 不可退化约束
用户已经明确选择路线 B：`Task-Centric AI Control Plane`。

这意味着：
- A 路线（传统管理后台）不是 fallback
- C 路线（会话/聊天优先工作台）不是 fallback
- 如果后续验证发现 B 路线在本质上无法成立，项目可以停止，但不能为了“做出来”而降级成 A 或 C

### 2.3 MVP 守门原则
如果出现以下情况，说明产品正在偏离 B：
- 用户必须先读完整对话才知道任务状态
- 审批只能在聊天中理解，不能结构化呈现
- 工具调用只能在原始日志中查看，不能形成结构化执行上下文
- 任务是否 blocked、为什么 blocked、谁该处理不能在列表/详情摘要层直接看见

## 3. 技术栈结论
第一阶段采用：
- `Next.js`
- `SQLite` 作为早期开发和轻量部署数据库
- 后续平滑迁移到 `Postgres`
- `Prisma` 作为 ORM / schema 管理层
- `shadcn/ui` 作为 UI 基础组件层

选择原因：
- 对 AI 辅助开发更友好，脚手架和页面组织清晰
- 前后端可以在一个工程内保持较短回路
- 对 MVP 阶段的快速试错、页面重构和读模型演进成本更低
- 能兼顾早期 SQLite 和后期 Postgres 的演进路径

## 4. 总体架构
系统按四层划分：

### 4.1 Control Plane UI
负责呈现平台规范对象，而不是 runtime 原生对象。

主要页面：
- `Workspace Overview`
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
- 定义任务状态推导规则
- 定义审批、输入、失败、恢复的业务语义
- 统一处理 UI 动作对应的领域命令

### 4.3 Runtime Adapter
首发仅实现 `OpenClawAdapter`。

它是 anti-corruption layer，只负责把 OpenClaw 的运行时行为翻译成平台规范对象与事件，不能把 runtime 原生语义直接渗透到 UI 和领域层。

### 4.4 Persistence / Infra
负责持久化当前状态与事件历史。

MVP 使用 SQLite，但设计必须满足后续迁移 Postgres 时无需改写核心领域边界。

系统既要保存：
- current state
- structured event history

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
- `runtime-adapters/openclaw`
- `ui/workspace`
- `ui/task-detail`
- `ui/work-page`

原则是：
- UI 层按页面/读模型拆分
- Domain 层按核心对象与行为拆分
- Adapter 层按 runtime 隔离
- 不为了未来多 runtime 提前做复杂抽象，只保留 adapter contract

## 6. 规范领域模型

### 6.1 核心对象
- `Workspace`：任务与记忆的顶层容器
- `Task`：系统主对象，代表一个目标、责任和状态容器
- `Run`：Task 的一次执行实例，允许多次重试、恢复、重新规划
- `Event`：系统事实流，是 timeline 和投影视图的基础
- `Approval`：需要人类决策的中断点，必须关联 `Task` 与 `Run`
- `Artifact`：由某次 `Run` 产生的输出结果
- `Memory`：与 workspace/task/run 相关的可追踪记忆条目

### 6.2 关系原则
- 一个 `Workspace` 包含多个 `Task`
- 一个 `Task` 可以有多个 `Run`
- 一个 `Run` 必须属于一个 `Task`
- `Approval` 和 `Artifact` 必须能追溯到对应 `Run`
- `Event` 作为系统记录事实的基础流，可以反向支撑 timeline、block summary、latest run summary 等读模型

### 6.3 Conversation 的地位
`Conversation` 不是顶层中心对象，而是某个 `Run` 的一个解释视图。

换句话说：
- 用户管理的是 `Task`
- 用户观察和推进的是 `Run`
- 对话只是执行过程的一个可读切面

### 6.4 Tool Call 的建模
`Tool Call` 不能只作为一段原始日志文本存在。

MVP 应采用两层表达：
- 平台统一事件层：通过 `tool.called`、`tool.completed` 等事件进入 timeline
- 细节层：通过 `ToolCallDetail` 保留参数、结果、错误摘要等执行细节

这样既能支撑任务控制面，也能支撑调试与审计。

### 6.5 Session 与 Task 的边界
平台不能把 OpenClaw session 直接等同于 `Task`。

允许：
- `Task` 挂接 `source_session_id` 作为来源引用
- `Run` 挂接 runtime session context 作为执行上下文

不允许：
- 用 session 直接充当 task 主键语义
- 让页面围绕 session 而不是 task 构建

## 7. OpenClaw-First Adapter 设计

### 7.1 Adapter 定位
`OpenClawAdapter` 是平台和 OpenClaw runtime 之间的 anti-corruption layer。

只有 adapter 知道 OpenClaw 原生 schema、状态名、消息格式和外部引用。其余层只消费规范平台对象。

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
- 可以从审批/输入等待态继续推进执行

如果这四点无法成立，则项目不应继续推进成一个伪 B 产品。

## 8. 信息架构

### 8.1 顶层导航
MVP 顶层导航保持为：
- `Workspaces`
- `Tasks`
- `Inbox`
- `Memory`
- `Settings`

`Calendar`、`Agents`、`Policies` 不作为 MVP 顶层导航。

### 8.2 Workspace Overview
`Workspace Overview` 是运营分诊面，不是 BI dashboard，也不是欢迎页。

建议展示：
- `Running Tasks`
- `Waiting for Approval`
- `Blocked / Failed Tasks`
- `Upcoming Deadlines`
- `Recently Updated Tasks`

它的任务是帮助用户先看到“哪里要处理”。

### 8.3 Task Center
`Task Center` 不是被动数据表，而是任务控制列表。

每条任务摘要至少应显示：
- title
- current status
- priority
- block reason summary
- latest run status
- due date
- last update time

默认过滤与视角应偏向：
- `Running`
- `WaitingForApproval`
- `Blocked`
- `Failed`

### 8.4 Inbox
`Inbox` 只收纳需要人立刻处理的中断点，例如：
- approval request
- input request
- 高风险恢复确认

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

### 8.5 Memory Console
`Memory Console` 以运维视角展示记忆条目，而不是聊天附属页。

至少展示：
- content
- source
- scope
- status
- linked task/run

并支持手动失效。

### 8.6 Work Page 默认布局
PRD 中原本的 `Task Detail` 聚合面，在本设计中拆成 `Task Page + Work Page` 两个独立页面。

其中重型执行观察面应落在 `Work Page`，桌面端默认采用三栏布局：
- 左栏：任务摘要、状态、优先级、依赖、排期、block reason、关键动作
- 中栏：`Execution Timeline` 为主，`Conversation` 为辅
- 右栏：recent run summary、pending approvals、recent artifacts、tool-call summary、runtime refs、相关 memory

核心原则是：
- timeline 永远是主观察面
- conversation 是解释执行过程的辅助视图，不是页面中心

### 8.7 响应式策略
- desktop：三栏工作面
- tablet：两栏布局，右栏信息区可折叠
- mobile：堆叠布局，但必须保留 sticky task header、quick actions、status、block reason、approvals 和关键 timeline 事件

响应式简化不能以丢失任务状态和阻塞可见性为代价。

### 8.8 反退化检查
如果出现以下情况，说明 UI 正在滑向 A 或 C：
- task state 被聊天内容淹没
- tool calls 只能以原始日志方式查看
- approvals 只能通过聊天上下文理解
- 用户必须读完整 conversation 才知道执行进度

这类现象应视为设计回退，而不是正常产品迭代。

## 9. Task Page 与 Work Page 的独立性

### 9.1 路由建议
- `Task Page`: `/workspaces/:workspaceId/tasks/:taskId`
- `Work Page`: `/workspaces/:workspaceId/work/:taskId`

`Work Page` 不是 `Task Page` 的 tab，也不是子面板，而是独立的重型工作面。

### 9.2 Task Page 职责
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
- deadline / schedule
- latest run summary
- recent approvals / artifacts / block reason
- 进入 `Work Page` 的入口

### 9.3 Work Page 职责
`Work Page` 负责执行观察和人工介入，回答：
- 当前执行在做什么
- 刚刚发生了什么
- 我现在需要介入什么

它应承载：
- current / recent run
- execution timeline
- conversation
- tool activity
- approvals / input requests
- artifacts
- 后续可能扩展的代码查看、文档查看、编辑能力

### 9.4 为什么必须分开
把 `Task Page` 和 `Work Page` 分开，是为了同时守住两件事：
- `Task` 作为控制对象
- `Run` 作为执行对象

如果两者混在一个 tabbed detail 页面里，产品很容易退化为：
- admin-first 的信息堆叠页面
- chat-first 的执行记录页面

独立 `Work Page` 有助于后续扩展代码查看、文档查看、编辑等重型能力，而不会污染任务规划面。

## 10. Task Page / Work Page 的数据交互边界

### 10.1 页面职责边界
`Task Page` 负责任务控制：
- task definition
- priority
- dependencies
- owner
- deadline / schedule
- block reason
- latest run summary

`Work Page` 负责执行协作：
- current run
- timeline
- conversation
- tool activity
- approvals / input requests
- artifacts

### 10.2 数据装载边界
`Task Page` 读取：
- `Task Projection`
- 轻量 `latest/current run snippet`

`Work Page` 读取：
- 轻量 `Task Shell`
- 完整 `Work Projection`

`Task Shell` 只保留执行面必须知道的任务信息，例如标题、状态、优先级、block reason、deadline 和依赖摘要。

### 10.3 写操作边界
任务级编辑动作固定留在 `Task Page`：
- 修改标题/描述
- 调整优先级
- 调整依赖
- 调整排期
- 调整负责人
- 更新目标定义

运行级动作主要放在 `Work Page`：
- start run
- retry run
- resume run
- submit approval
- provide input
- 查看执行输出与过程证据

允许 `Task Page` 保留少量控制入口动作，例如 `Start Run` 和 `Open Work Page`，但不应承载主要执行过程交互。

### 10.4 一致性规则
- 同一个任务的计划信息只允许一个主编辑面：`Task Page`
- 同一个运行的执行信息只允许一个主观察/介入面：`Work Page`
- 两页共享同一任务事实源，但不共享同一职责

如果 `Task Page` 修改了排期或依赖，`Work Page` 顶部的 `Task Shell` 必须及时反映。

如果 `Work Page` 产生了新的审批、产物或阻塞，`Task Page` 的摘要与 block reason 必须及时回流。

## 11. 数据流与状态同步规则

### 11.1 写入链路
所有来自 `Task Page` 或 `Work Page` 的动作，都必须先进入平台应用层命令，而不是直接打到 OpenClaw。

固定链路为：
`UI Action -> Domain Command -> Domain Validation / State Check -> Local Record Write -> Adapter Call -> External Ref Persist -> Async Sync Completion`

这意味着：
- 本地系统先形成可追踪记录
- OpenClaw 是执行器，不是唯一真相源
- UI 不直接依赖 runtime 原生接口语义

### 11.2 读取链路
读取通过统一同步链路完成，而不是让页面直接临时查询 OpenClaw：
`Adapter Poll/Sync -> Canonical Event Append -> Projection Update -> UI Read`

这样所有页面看到的是同一套平台状态，不会因为各自拼接 runtime 数据而产生口径分裂。

### 11.3 读模型分层
至少拆成两类投影视图：

`Task Projection`：
- task status
- priority
- block reason
- latest run summary
- approval pending count
- deadline / schedule
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

原则是：
- 任务控制面读摘要和阻塞态
- 执行协作面读过程细节

### 11.4 同步硬规则
- 必须同时保存 `current state` 和 `event history`
- 增量同步必须幂等，避免重复事件
- 事件排序优先使用 runtime 时间戳，必要时使用本地 ingest sequence 兜底
- `Task status` 不允许由 adapter 直接硬写，必须由领域层基于 `Run / Approval / Input / Event` 推导
- `waiting for approval`、`waiting for input`、`sync stale` 必须成为显式状态，而不是隐藏在日志中
- `runtime failure` 和 `adapter sync failure` 必须分开表达

### 11.5 MVP 轮询策略
建议对以下对象高频轮询：
- active runs
- blocked runs
- recently updated runs

对以下对象低频或停止轮询：
- completed runs
- failed runs
- archived runs

这样可以在 SQLite 阶段兼顾及时性和成本。

## 12. 错误、阻塞与恢复处理

### 12.1 问题类型分层
MVP 不应把所有异常合并成一个 `failed`。

至少要区分：
- `run failed`
- `waiting for approval`
- `waiting for input`
- `sync degraded / stale`
- `mapping partial`

### 12.2 阻塞是一等对象
`Task` 和 `Run` 都应暴露显式 `block reason summary`，至少包含：
- `block type`
- `since`
- `action required`
- `scope`

这样 Overview、Task Center、Inbox、Task Page 都能消费同一套阻塞语义。

### 12.3 恢复动作必须精准对应
MVP 应支持以下恢复动作：
- `Approve / Reject / Edit and Approve`
- `Provide Input`
- `Retry Run`
- `Resume Run`
- `Re-sync`
- `Re-plan / Create New Run`

恢复动作的目标不是“把系统再点一次”，而是回答“下一步如何推进任务”。

### 12.4 状态传播规则
- 当前活动 run 处于 `waiting for approval/input` 时，`Task` 进入 `Blocked`
- 当前活动 run 失败但仍可重试时，`Task` 可进入 `Attention Needed` 或 `Blocked`
- 同步失真时，`Task` 不应展示确定性的 `Completed/Failed`，而应展示 `Sync Stale / Status Uncertain`
- 某次 run 失败但任务已经由新 run 接管推进时，旧 run 保留失败记录，`Task` 以当前活动 run 为准

其中 `Attention Needed`、`Sync Stale`、`Status Uncertain` 可以先作为 projection/UI display state 存在，不要求一开始就落入与 `Task.status` 完全相同的持久化枚举。

如果后续需要进入统一状态机，也必须先证明不会破坏任务控制语义。

### 12.5 页面呈现原则
- `Workspace Overview` 和 `Task Center` 只展示高价值摘要
- `Task Page` 展示任务级阻塞判断和推荐动作
- `Work Page` 展示运行级证据，如失败事件、审批上下文、输入请求、相关工具调用、产物和日志片段
- `Inbox` 只承接需要立刻人工处理的中断项，不承接全部错误

### 12.6 一条硬规则
如果用户必须打开长聊天记录才能知道为什么停了、停在哪、谁该处理、下一步点哪里，那么错误处理设计就是失败的。

这些信息必须先结构化暴露，再允许用户下钻查看对话和细节。

## 13. Scheduling 设计结论
来自 `docs/Thoughts.md` 的 scheduling 想法保留，并按 MVP / Phase 2 分层：

MVP：
- `due date`
- `scheduled start`
- `scheduled end`
- 任务页中的 scheduling panel
- overview 中显示最近到期任务

Phase 2：
- calendar 视图
- time-block 操作
- 更复杂的人机协同排程

这样既保留任务安排能力，又避免 MVP 提前滑向完整日历产品。

## 14. MVP 实现边界
本设计文档明确的是产品与系统边界，不等于承诺一次性实现所有后续增强能力。

MVP 的目标是先把以下主链路打通：
- 创建任务
- 触发 run
- 追踪 run
- 识别审批/输入/失败/阻塞
- 在任务面和工作面提供一致但职责分离的观察与操作
- 形成 `task -> run -> event -> artifact / approval` 的完整可追踪链路

以下能力可以留到后续阶段：
- 流式同步
- 多 runtime 深度兼容
- 高级可视化编排
- 完整 calendar 调度
- IDE 级编辑工作台

## 15. 后续计划输入
本设计文档批准后，下一步不是直接写代码，而是基于本文输出实现计划。

实现计划必须围绕以下顺序展开：
- 先验证 OpenClaw feasibility gate
- 再定义数据模型与 adapter contract
- 再搭建读模型与同步链路
- 再落页面骨架与交互
- 最后补足恢复动作、错误状态和 memory/inbox 细节

在实现过程中，任何会把产品推回 A 或 C 的方案，都应视为设计违背，而不是可接受的工程折中。
