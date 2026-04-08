# DOMAIN_MODEL

## 1. 文档目的
定义后续 Agents 在实现时必须共享的统一领域对象，避免不同 Agent 对核心对象理解不一致。

## 2. 设计原则
- Task 是一等公民
- Session 不是顶层中心，只是 Task 的一种上下文/视图
- Run 是 Task 的执行实例
- Approval、Artifact、Memory、Schedule 都必须能回挂到 Task 或 Workspace
- 领域模型优先服务 MVP，不为未来做过度抽象

## 3. 核心对象

### 3.1 Workspace
顶层容器。

建议字段：
- id
- name
- description
- created_at
- updated_at
- default_runtime
- status

关系：
- has many Tasks
- has many Memories
- has many Agents
- has many Policies
- has many ScheduleBlocks

### 3.2 Task
系统核心对象。

建议字段：
- id
- workspace_id
- title
- description
- status
- priority
- owner_type
- assignee_agent_id
- source_session_id
- parent_task_id
- due_at
- scheduled_start_at
- scheduled_end_at
- budget_limit
- block_reason
- latest_run_id
- created_at
- updated_at
- completed_at

枚举建议：
status:
- Draft
- Ready
- Queued
- Running
- WaitingForInput
- WaitingForApproval
- Scheduled
- Blocked
- Failed
- Completed
- Cancelled

priority:
- Low
- Medium
- High
- Urgent

owner_type:
- human
- agent

关系：
- belongs to Workspace
- has many Runs
- has many Artifacts
- has many Approvals
- may have many dependent tasks
- may belong to one parent task

### 3.3 TaskDependency
显式表示任务依赖，避免只在 Task 上塞数组后难以扩展。

建议字段：
- id
- workspace_id
- task_id
- depends_on_task_id
- dependency_type
- created_at

dependency_type 建议：
- blocks
- relates_to
- child_of

MVP 最少支持 blocks。

### 3.4 Run
Task 的一次执行实例。

建议字段：
- id
- task_id
- runtime_name
- runtime_run_ref
- status
- started_at
- ended_at
- error_summary
- resume_token
- triggered_by
- created_at
- updated_at

status 建议：
- Pending
- Running
- WaitingForInput
- WaitingForApproval
- Failed
- Completed
- Cancelled

triggered_by 建议：
- user
- retry
- scheduler
- dependency_resolved
- system

### 3.5 Session
对话或交互上下文。

建议字段：
- id
- workspace_id
- runtime_name
- runtime_session_ref
- title
- created_at
- updated_at

说明：
- Session 不直接代表工作完成情况
- 一个 Task 可引用一个或多个 Session
- MVP 中允许 Task 只记录 source_session_id，不强制完整多对多建模

### 3.6 Approval
待人类确认的动作。

建议字段：
- id
- workspace_id
- task_id
- run_id
- type
- title
- summary
- risk_level
- payload
- status
- requested_at
- resolved_at
- resolved_by
- resolution_note

type 建议：
- command_execution
- file_change
- external_message
- external_tool_use
- memory_overwrite
- schedule_change

risk_level 建议：
- low
- medium
- high

status 建议：
- Pending
- Approved
- Rejected
- EditedAndApproved
- Expired

### 3.7 Artifact
任务执行产物。

建议字段：
- id
- workspace_id
- task_id
- run_id
- type
- title
- uri
- content_preview
- metadata
- created_at

type 建议：
- file
- patch
- summary
- report
- terminal_output
- url

### 3.8 Memory
被系统长期保存的上下文对象。

建议字段：
- id
- workspace_id
- task_id
- source_run_id
- content
- scope
- source_type
- confidence
- status
- created_at
- updated_at
- expires_at

scope 建议：
- user
- workspace
- project
- task

source_type 建议：
- user_input
- agent_inferred
- imported
- system_rule

status 建议：
- Active
- Inactive
- Conflicted
- Expired

MVP 最少支持：内容、来源、scope、状态、手动失效。

### 3.9 ScheduleBlock
任务对应的时间块。

建议字段：
- id
- workspace_id
- task_id
- title
- start_at
- end_at
- source
- status
- created_at

source 建议：
- user
- agent
- system

status 建议：
- Planned
- Active
- Done
- Cancelled

MVP 中可只实现 task 上的 scheduled_start_at / scheduled_end_at，不强制先落独立表；但领域上保留该对象。

### 3.10 Agent
执行体或逻辑角色。

建议字段：
- id
- workspace_id
- name
- runtime_name
- role
- status
- current_load
- success_rate
- cost_total
- created_at
- updated_at

status 建议：
- Active
- Busy
- Unavailable
- Disabled

MVP 可只保留最简模型或占位，不要求完整 UI。

### 3.11 Policy
控制预算、权限、自动执行深度。

建议字段：
- id
- workspace_id
- name
- policy_type
- config
- created_at
- updated_at

MVP 允许仅定义模型，不要求实现完整控制台。

## 4. 最小关系图
- Workspace -> Tasks
- Task -> Runs
- Task -> Approvals
- Task -> Artifacts
- Task -> Memories (可选直接关联)
- Task -> TaskDependencies
- Run -> Approvals
- Run -> Artifacts
- Run -> Memories
- Session -> Tasks (MVP 可弱关联)

## 5. 实现约束
1. Task 必须是查询和展示的主入口。
2. Run 不得脱离 Task 单独存在。
3. Approval 必须同时能定位到 task_id，最好也能定位到 run_id。
4. 所有 Artifact 必须可以追溯到来源 task。
5. Memory 至少要能说明来源和 scope。
6. 任何等待态都必须在 Task 上能看到 block_reason。

## 6. MVP 必须落地的对象
必须真实实现：
- Workspace
- Task
- Run
- Approval
- Artifact
- Memory（简化版）

可以先弱实现或保留扩展：
- Session
- ScheduleBlock
- Agent
- Policy
- TaskDependency（如果开发节奏紧，可先用 Task.depends_on 字段占位）

## 7. 决策说明
为了让 Agents 高效推进，实现时不要一开始构建过重的泛化模型。只要满足：
- Task 能承接状态与执行
- Run 能承接生命周期
- Approval/Artifact/Memory 能形成闭环
就足以支持 MVP。
