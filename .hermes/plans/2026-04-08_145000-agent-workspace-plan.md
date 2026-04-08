# Agent Workspace / Dashboard 计划

> For Hermes: 当前用户要的是“基于想法写计划”，不是立即实现；本文件仅提供产品与实施规划。

**Goal:** 基于 chats.md 中的判断，产出一份可落地的通用 Agent Workspace / Dashboard 计划，明确产品方向、对象模型、MVP 范围、阶段路线和验证方式。

**Current context / assumptions:**
- 当前目录仅看到 `chats.md`，未发现现成代码仓结构，因此本计划按“从 0 到 1 的产品/架构规划”来写。
- chats.md 的核心命题是对的：机会点不在“更漂亮的聊天 UI”，而在“以任务为中心的 agent operations layer / workspace”。
- 目标不是绑定单一后端，而是为 Hermes、OpenClaw、OpenCode、Open WebUI 背后的 agent runtime 提供统一控制层。
- 需要优先解决的是统一抽象、任务状态流、审批、日程、记忆管理，而不是先堆聊天细节。

**Analysis of chats.md:**
整体判断基本正确，方向上值得继续推进，但需要做几处收敛和修正：

1. 正确的部分
- “任务是中心，聊天只是任务的一种视图”这个判断非常关键，适合作为产品核心原则。
- “通用 agent operations layer”比“dashboard 美化版”更有价值，这决定了产品有平台属性，而不是皮肤属性。
- 日程、多任务、审批、记忆、终端/文件、子 agent 协作这些能力确实是现有产品的薄弱整合点。
- 最大难点在统一抽象层，而非纯前端体验，这个判断也成立。

2. 需要修正的部分
- 想法里功能很多，但第一版不能同时做“任务 + 日程 + 审批 + 记忆 + 多 agent + 预算策略 + 主动建议”。必须分层分期。
- “通用接入多个 agent 系统”虽然价值高，但前期不应追求完全通用，建议先做一个主后端 + 一个适配层原型，再逐步扩展。
- “因果链 / causal timeline”是高价值能力，但依赖底层事件模型；MVP 不适合做太重，可先做“结构化事件时间线”。
- “工作负载预测”“主动建议层”很吸引人，但它们依赖稳定数据沉淀，应放到 Phase 2/3，而不是最初版本。

3. 建议的核心产品原则
- Workspace first，而不是 chat first。
- Task first，而不是 conversation first。
- Approval and observability by default。
- Adapter-based architecture，避免产品逻辑与单一 agent runtime 强耦合。
- 先把“可管理”做好，再把“更智能”做好。

---

## 一、产品定位

产品名称（暂定）：Agent Workspace

一句话定位：
一个面向复杂工作的通用 Agent 工作台，用统一的任务、审批、计划、记忆、执行与日程模型，管理一个或多个 AI agent runtime。

目标用户：
- 高频使用 AI agent 的个人高级用户
- 小团队 / AI native 团队
- 需要审批、可观测性、预算控制的组织用户
- 希望把多个 agent 系统接入统一工作台的开发者或平台团队

非目标：
- 不先做“通用聊天客户端”
- 不先做“无后端抽象的漂亮前端壳”
- 不先做“高度自治的全自动 PM/秘书”，避免过早承诺

## 二、北极星价值

产品要解决的核心问题：
1. 用户同时运行多个 agent 任务时，缺少统一的任务管理与状态视图。
2. 批准、阻塞、失败恢复、依赖关系通常散落在聊天流里，难以管理。
3. 记忆、文件、终端、artifact、schedule 彼此割裂，无法形成工作闭环。
4. 不同 agent runtime 能做事，但缺少统一 control plane。

北极星指标建议：
- 每周活跃 workspace 数
- 每个 workspace 的已完成任务数
- 平均任务完成时长
- 需要人工接管的任务比例
- 审批响应时长
- 失败任务恢复成功率

## 三、核心对象模型

第一版统一抽象建议采用以下对象：

1. Workspace
- 顶层容器
- 挂载任务、会话、记忆、文件、日程、agent、策略

2. Task
- 用户真正关心的一等公民
- 字段建议：
  - id
  - workspace_id
  - title
  - description
  - status
  - priority
  - owner_type (human/agent)
  - assignee_agent_id
  - due_at
  - scheduled_start_at
  - scheduled_end_at
  - budget_limit
  - parent_task_id
  - depends_on[]
  - source_session_id

3. Run
- Task 的一次执行实例
- 用于承载具体 runtime 调用、状态流转、重试、恢复点

4. Session
- 对话 / 指令交互容器
- 是任务的一个视图，不是顶层中心

5. Artifact
- 执行过程中生成的文件、摘要、报告、补丁、链接、终端输出引用

6. Approval
- 等待人类确认的动作对象
- 包括命令执行、文件修改、消息发送、外部调用、记忆覆盖等

7. Memory
- 持久偏好、项目规则、经验、上下文事实
- 需要来源、适用范围、置信度、过期策略

8. ScheduleBlock
- 与日历对齐的时间块
- 可由任务反推生成，也可由用户拖拽创建

9. Agent
- 连接的执行体实例或逻辑角色
- 包含能力、成本、当前负载、最近健康状态

10. Policy
- 预算、权限、自动化深度、允许工具范围等控制项

## 四、任务状态机

建议先统一状态机，再设计 UI：
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

状态转换原则：
- 所有跨状态变化都应有 event log。
- WaitingForApproval / WaitingForInput 必须可追溯到具体阻塞原因。
- Failed 不等于结束，需支持 Retry / Resume from checkpoint / Fork。

## 五、MVP 范围

MVP 只做“最有平台感、又最容易验证价值”的部分。

### MVP 必做
1. Workspace 主页
- 展示 workspace 概览、任务列表、正在运行的任务、待审批项

2. 任务中心
- 创建任务
- 查看任务状态、优先级、依赖、最近产出
- 任务详情页聚合 session、runs、artifacts、timeline

3. 执行时间线（结构化版）
- 先不做复杂 causal graph
- 先做结构化事件流：用户指令、agent 决策、tool call、approval request、artifact 生成、错误、重试

4. 审批收件箱
- 所有需要人确认的动作统一进入 inbox
- 支持 approve / reject / edit-and-approve

5. 适配层 v1
- 先接 1 个主 runtime（例如 Hermes）
- 抽象统一接口，为第 2 个 runtime 预留 adapter contract

6. 基础记忆管理
- 展示 memory 条目
- 支持查看来源、scope、状态、手动失效

7. 基础调度
- 支持任务设置 due date / scheduled time
- 不做复杂日历联动，只做最小计划能力

### MVP 不做
- 智能排程优化
- 工作负载预测
- 高级 causal reasoning graph
- 多 runtime 深度兼容
- 复杂多 agent 拓扑编排 UI
- 自动建议层

## 六、Phase 2 范围

在 MVP 被验证后扩展：
1. 日历视图 + 时间块拖拽
2. 任务到 ScheduleBlock 的自动映射
3. 多 agent 负载面板
4. 失败恢复台
5. 更强的 memory ops（冲突、可信度、过期）
6. 预算 / 配额 / 权限策略
7. 第二个 runtime adapter（如 OpenClaw 或 OpenCode）

## 七、Phase 3 范围

1. 主动建议层
2. 完整 planner / executive 双视图
3. 工作负载预测与成本预测
4. 跨 workspace 资源调度
5. 因果链可视化
6. 自动复盘并推荐写入记忆/技能

## 八、信息架构建议

### 顶部一级导航
- Workspaces
- Tasks
- Inbox
- Calendar
- Memory
- Agents
- Policies
- Settings

### Workspace 内侧边栏
- Overview
- Tasks
- Sessions
- Artifacts
- Memory
- Schedule
- Agents
- Activity

### 关键页面
1. Workspace Overview
- 今日任务
- Running tasks
- Waiting approvals
- Upcoming deadlines
- 最近 artifacts
- 成本概览

2. Task Detail
- Summary
- Plan
- Execution
- Timeline
- Artifacts
- Dependencies
- Approvals
- Notes / related session

3. Inbox
- 待批动作卡片列表
- 风险级别
- 来源任务
- 建议操作

4. Calendar
- 时间块视图
- 任务映射
- 冲突提醒

5. Memory Console
- 按 workspace / project / user scope 浏览
- 冲突、过期、来源查看

6. Agent Console
- 当前负载
- 任务分配
- 健康状态
- 成本 / 成功率

## 九、技术架构建议

推荐采用三层：

1. Frontend
职责：
- workspace/task/inbox/calendar/memory/agent 控制台
- 实时状态展示
- 时间线和 artifact 浏览

2. Control Plane Backend
职责：
- 统一对象模型
- 状态机
- event ingestion
- approval orchestration
- policy enforcement
- schedule orchestration
- adapter dispatch

3. Runtime Adapters
职责：
- 将 Hermes / OpenClaw / OpenCode 等系统映射到统一对象模型
- 把底层 session / tool / memory / run event 转成标准事件

关键设计原则：
- 前端只依赖统一 API，不直接依赖具体 runtime。
- runtime adapter 必须是可插拔边界。
- 所有执行事件都标准化为 event schema。

## 十、事件模型建议

第一版统一事件类型：
- task.created
- task.updated
- task.status_changed
- run.started
- run.completed
- run.failed
- approval.requested
- approval.resolved
- artifact.created
- memory.created
- memory.updated
- schedule.created
- tool.called
- tool.completed
- human.input_requested

这会直接决定：
- 时间线 UI 怎么展示
- 审批 inbox 怎么聚合
- 后续因果链是否能演进

## 十一、12 周路线图

### Phase 0: 需求收敛与原型定义（第 1-2 周）
目标：把产品想法从“愿景”压缩成“统一模型 + MVP 范围”。

任务：
1. 从 chats.md 提炼产品原则与边界
2. 写对象模型草案
3. 写状态机草案
4. 定义 adapter contract v1
5. 画核心页面线框图
6. 选定唯一首发 runtime

交付物：
- PRD v1
- Domain model v1
- Event schema v1
- MVP scope doc
- Wireframes v1

### Phase 1: Control Plane 基础层（第 3-5 周）
目标：打通统一任务模型和事件流。

任务：
1. 建 Workspace / Task / Run / Approval / Artifact / Memory 基础模型
2. 建状态机与事件存储
3. 接入 runtime adapter v1
4. 打通 task -> run -> event timeline
5. 打通 approval inbox

交付物：
- 可创建并执行任务的后端雏形
- 可展示结构化时间线
- 可处理审批流

### Phase 2: 核心 UI（第 6-8 周）
目标：形成可演示的工作台产品。

任务：
1. Workspace Overview
2. Task List + Task Detail
3. Inbox
4. Basic Memory Console
5. Basic Schedule View

交付物：
- 端到端 MVP demo
- 用户可从 UI 创建任务并跟踪执行

### Phase 3: 稳定性与验证（第 9-10 周）
目标：验证“任务中心”是否真的比“聊天中心”更有价值。

任务：
1. 增加失败、阻塞、等待输入等边界状态
2. 增加任务依赖
3. 增加基础统计与成本展示
4. 做 5-10 个真实任务场景走查

交付物：
- MVP beta
- 用户验证报告

### Phase 4: 扩展准备（第 11-12 周）
目标：为多 runtime、多 agent、日历联动铺路。

任务：
1. 补第二层 adapter 接口稳定性
2. 评估第二 runtime 接入成本
3. 设计失败恢复台
4. 设计 calendar automation v2

交付物：
- Phase 2 roadmap
- 多 runtime 扩展方案

## 十二、优先级排序

P0
- 统一对象模型
- 任务状态机
- runtime adapter v1
- task detail
- approval inbox
- structured timeline

P1
- memory console v1
- schedule fields + simple calendar
- artifacts 聚合
- 依赖关系视图

P2
- 多 agent console
- policy/budget controls
- failure recovery
- 第二 runtime adapter

P3
- workload prediction
- active recommendations
- causal graph

## 十三、验证方式

必须验证的假设：
1. 用户是否真的更愿意围绕 task 工作，而不是围绕 chat 工作。
2. 审批收件箱是否显著提升复杂任务处理效率。
3. 结构化 timeline 是否比原始 tool log 更可理解。
4. 单 runtime + 统一模型是否足以证明平台方向。

建议测试场景：
- 一个代码修复任务
- 一个调研汇总任务
- 一个需要审批的外部动作任务
- 一个有截止时间的定时任务
- 一个失败后恢复的任务

成功标准示例：
- 用户能在 30 秒内定位“哪些任务卡住了，为什么卡住”
- 用户能在 10 秒内处理待审批动作
- 用户能理解某个任务最近一次失败原因和下一步动作

## 十四、主要风险与应对

风险 1：范围失控
- 应对：严格限制 MVP，只做 task/inbox/timeline/adapter/memory-lite/schedule-lite。

风险 2：底层 runtime 事件不标准
- 应对：先定义内部 canonical schema，再为首个 runtime 做映射。

风险 3：产品变成“很多面板的复杂后台”
- 应对：始终以任务完成率、审批效率、恢复效率为核心，不做纯展示型页面。

风险 4：多 runtime 兼容拖慢进度
- 应对：第一阶段只承诺 adapter-ready，不承诺 fully multi-runtime。

## 十五、下一步执行建议

建议按这个顺序推进：
1. 先把 chats.md 内容收敛成正式 PRD
2. 再补领域模型和事件模型
3. 先做线框图，不急着写代码
4. 选定首发 runtime
5. 基于 MVP 范围启动实现

## 十六、建议输出文件

如果你要继续推进，下一批建议产物是：
- `PRD.md`
- `DOMAIN_MODEL.md`
- `EVENT_SCHEMA.md`
- `MVP_SCOPE.md`
- `WIREFRAMES.md`

## 十七、结论

chats.md 里的大方向是对的，而且判断质量挺高：
- 对机会点的识别是准确的
- 对行业现状的批评是合理的
- 对核心模块的判断也基本靠谱

但要从“正确想法”变成“可落地产品”，关键不是继续加想法，而是做三件事：
- 缩 MVP
- 先定义统一抽象
- 以任务中心和审批/时间线闭环为第一性原则

如果一句话总结这份计划：
先不要做“最聪明的 agent dashboard”，而要先做“最可管理的 agent workspace”。
