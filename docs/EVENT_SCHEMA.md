# EVENT_SCHEMA

## 1. 文档目的
定义系统内结构化事件的最小规范，确保后续 Agents 在做 timeline、inbox、状态同步和 adapter 时有统一约束。

## 2. 设计目标
- 所有关键状态变化都事件化
- Timeline 依赖事件，而不是依赖原始日志拼接
- Approval Inbox 依赖事件聚合
- 后续 causal timeline 可以建立在当前事件模型之上

## 3. 通用事件字段
每个事件至少包含：
- id
- event_type
- workspace_id
- task_id
- run_id（允许为空，但 run 相关事件必须有）
- timestamp
- actor_type
- actor_id
- source
- payload

字段说明：
- actor_type: user / agent / system / runtime
- actor_id: 对应执行主体标识
- source: ui / api / scheduler / adapter / runtime
- payload: 与事件类型相关的结构化数据

## 4. MVP 必须支持的事件类型

### 4.1 task.created
触发时机：创建任务
payload 最少包含：
- title
- initial_status
- priority

### 4.2 task.updated
触发时机：任务元数据修改
payload 最少包含：
- changed_fields

### 4.3 task.status_changed
触发时机：任务状态变化
payload 最少包含：
- from_status
- to_status
- reason

要求：
- 所有 Task 跨状态变化都必须产生该事件

### 4.4 run.started
触发时机：某次执行开始
payload 最少包含：
- runtime_name
- runtime_run_ref
- triggered_by

### 4.5 run.completed
触发时机：执行完成
payload 最少包含：
- result_summary
- artifact_count

### 4.6 run.failed
触发时机：执行失败
payload 最少包含：
- error_summary
- retryable
- resume_supported

### 4.7 approval.requested
触发时机：执行需要人类审批
payload 最少包含：
- approval_id
- approval_type
- title
- summary
- risk_level

要求：
- Inbox 必须能直接从该事件构建列表

### 4.8 approval.resolved
触发时机：审批处理完成
payload 最少包含：
- approval_id
- resolution
- resolution_note

resolution 枚举：
- approved
- rejected
- edited_and_approved
- expired

### 4.9 artifact.created
触发时机：产生新的任务产物
payload 最少包含：
- artifact_id
- artifact_type
- title
- uri

### 4.10 memory.created
触发时机：新增记忆
payload 最少包含：
- memory_id
- scope
- source_type

### 4.11 memory.updated
触发时机：记忆变更或失效
payload 最少包含：
- memory_id
- changed_fields

### 4.12 schedule.created
触发时机：创建任务时间安排
payload 最少包含：
- start_at
- end_at
- source

### 4.13 human.input_requested
触发时机：agent 需要用户补充输入
payload 最少包含：
- prompt
- input_type
- blocking

### 4.14 tool.called
触发时机：底层工具调用开始
payload 最少包含：
- tool_name
- arguments_summary

### 4.15 tool.completed
触发时机：底层工具调用完成
payload 最少包含：
- tool_name
- success
- result_summary

## 5. Timeline 展示规则
Task Detail 的 timeline 至少按以下逻辑构建：
1. 按 timestamp 升序或分组倒序展示
2. 重点突出以下事件：
- task.status_changed
- run.started
- run.failed
- run.completed
- approval.requested
- approval.resolved
- human.input_requested
- artifact.created
3. tool.called / tool.completed 可以折叠显示，避免噪音过大

## 6. Inbox 聚合规则
Approval Inbox 的数据源优先基于 Approval 实体，但展示状态同步必须受以下事件驱动：
- approval.requested
- approval.resolved

最小展示字段：
- approval_id
- task_id
- title
- summary
- risk_level
- requested_at
- current_status

## 7. 状态同步规则
以下对象变更必须同时更新实体和事件：
- Task status
- Run status
- Approval status
- Memory status

实现约束：
- 不能只改数据库实体不写事件
- 也不能只写事件不更新实体当前态

## 8. Adapter 约束
Runtime Adapter 接入时，必须把底层原始事件/日志映射为本文件中的 canonical events。

最低要求：
- 能映射 run started/completed/failed
- 能映射 approval requested/resolved
- 能映射 tool called/completed（如底层可见）
- 能映射 human input requested

如果底层 runtime 信息不足：
- 允许 payload 降级
- 但 event_type 不得缺失
- 且必须保证 task.status_changed、run.started、run.completed/run.failed 可用

## 9. 非目标
本文件不定义：
- 最终数据库表结构
- 消息总线技术选型
- 全量审计日志标准
- 高级因果图算法

## 10. 实现优先级
P0：
- task.status_changed
- run.started
- run.completed
- run.failed
- approval.requested
- approval.resolved
- artifact.created
- human.input_requested

P1：
- tool.called
- tool.completed
- memory.created
- memory.updated
- schedule.created

## 11. 验收检查
后续 Agents 完成实现后，至少应验证：
1. 任一 task 的状态变化都能在 timeline 中看到。
2. 任一审批请求都能进入 inbox，并在处理后正确消失或更新。
3. 任一 failed run 都有明确错误摘要事件。
4. 任一 artifact 都能在 task detail 中找到对应创建事件。
