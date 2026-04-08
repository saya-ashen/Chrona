# PRD: Agent Workspace MVP

## 1. 文档目的
本 PRD 用于让后续 Agents 在没有额外口头解释的情况下，明确知道第一阶段要做什么、不做什么、成功标准是什么。

## 2. 产品目标
构建一个以 Task 为中心的 Agent Workspace，而不是以 Chat 为中心的聊天壳。

MVP 要解决的问题：
1. 用户无法统一管理多个 agent 任务。
2. 审批、阻塞、失败、依赖散落在聊天里，难以追踪。
3. 任务、执行、产物、记忆、时间安排没有统一视图。
4. 底层 agent runtime 有能力，但缺少统一 control plane。

## 3. 核心原则
- Workspace first
- Task first
- Approval by default
- Observability by default
- Adapter-based architecture
- 先做可管理，再做更智能

## 4. MVP 范围
### 4.1 必做功能
1. Workspace Overview
- 显示 workspace 概览
- 显示任务列表摘要
- 显示 running tasks
- 显示 waiting approvals
- 显示 upcoming deadlines

2. Task Center
- 创建任务
- 查看任务列表
- 查看任务详情
- 在详情页看到状态、优先级、依赖、最近产出

3. Task Detail 页面聚合
- Summary
- Runs
- Timeline
- Artifacts
- Approvals
- Related Session 引用

4. Structured Timeline
- 展示结构化事件流，不做复杂因果图
- 至少包含：task event、run event、tool event、approval event、artifact event、human input event

5. Approval Inbox
- 汇总所有待审批动作
- 支持 approve
- 支持 reject
- 支持 edit-and-approve

6. Memory Console v1
- 展示 memory 条目
- 查看来源、scope、状态
- 支持手动失效

7. Basic Scheduling v1
- 任务支持 due date
- 任务支持 scheduled start/end
- Overview 中显示最近到期任务

8. Runtime Adapter v1
- 首发仅支持 1 个 runtime
- 但系统结构必须预留 adapter contract

### 4.2 明确不做
- 智能主动建议
- 工作负载预测
- 复杂多 agent 编排可视化
- 多 runtime 深度兼容
- 完整日历拖拽排程
- 高级 causal graph
- 自动复盘写入记忆/技能

## 5. 用户角色
### 5.1 个人高级用户
需要同时管理多个 AI 任务，并快速处理审批和异常。

### 5.2 小团队/平台用户
需要把任务、执行过程、审批和成本管理放到统一工作台。

## 6. 核心用户流程
### Flow A: 创建并跟踪任务
1. 用户进入某个 workspace
2. 创建 task
3. task 被分派到 runtime 执行
4. 用户在 task detail 里查看 run、timeline、artifacts
5. 任务完成或失败

### Flow B: 处理审批
1. agent 执行过程中产生 approval request
2. 系统将其写入 approval inbox
3. 用户审批/拒绝/编辑后批准
4. 执行继续推进，timeline 可见

### Flow C: 处理阻塞/失败
1. task 进入 WaitingForInput / WaitingForApproval / Failed / Blocked
2. 用户在列表和详情页快速看到原因
3. 用户补输入、审批、重试或恢复

## 7. 信息架构
### 顶层导航
- Workspaces
- Tasks
- Inbox
- Memory
- Settings

注意：Calendar、Agents、Policies 暂不作为 MVP 独立主导航，可先以内嵌模块或占位方式保留扩展空间。

### Workspace 内页面
- Overview
- Tasks
- Task Detail
- Inbox
- Memory

## 8. 关键页面要求
### 8.1 Workspace Overview
必须展示：
- Workspace 名称
- Running tasks
- Waiting approvals
- Upcoming deadlines
- 最近更新任务

### 8.2 Task List
必须支持：
- 按状态筛选
- 按优先级筛选
- 按 due date 排序
- 直接看到阻塞原因摘要

### 8.3 Task Detail
必须包含：
- 基本信息
- 当前状态
- 依赖任务
- 最新 run 状态
- 结构化 timeline
- artifacts 列表
- approval 列表
- 关联 session/runs 引用

### 8.4 Inbox
必须包含：
- approval 类型
- 风险级别
- 来源 task
- 请求摘要
- approve/reject/edit-and-approve 操作

### 8.5 Memory Console
必须包含：
- memory 内容
- 来源
- scope
- 状态
- 手动失效操作

## 9. 验收标准
MVP 完成时，至少满足：
1. 用户可以创建 task 并看到其完整生命周期。
2. 用户可以从统一 inbox 处理审批。
3. 用户可以在 task detail 中看懂该任务当前为什么在运行、等待、失败或完成。
4. timeline 不只是原始日志，而是结构化事件序列。
5. 系统代码结构支持后续接入第二个 runtime。

## 10. 非功能要求
- 所有核心状态变化必须有事件记录
- 所有 approval 必须可追溯到 task 和 run
- 所有 task 列表和详情页都要能直接展示当前阻塞原因
- 允许后续扩展多 runtime，但当前实现不得写死为不可扩展结构

## 11. 成功标准
- 用户能在 30 秒内找到卡住的任务及原因
- 用户能在 10 秒内完成常见审批处理
- 用户能明确看到某个任务最近一次 run 的结果和产物
- 开发上能在不重写前端主体的前提下接入第二个 runtime

## 12. 交付边界说明
后续 Agents 实现时，以本 PRD、`docs/DOMAIN_MODEL.md`、`docs/EVENT_SCHEMA.md`、`docs/IMPLEMENTATION_PLAN.md` 为准。
如果设计与实现冲突，优先顺序为：
1. IMPLEMENTATION_PLAN
2. PRD
3. DOMAIN_MODEL
4. EVENT_SCHEMA
