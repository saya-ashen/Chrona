# AgentDashboard 系统架构文档

## 目录

1. [架构概览](#1-架构概览)
2. [系统分层](#2-系统分层)
3. [数据流图](#3-数据流图)
4. [数据库设计](#4-数据库设计)
5. [核心枚举](#5-核心枚举)
6. [Runtime Adapter 架构](#6-runtime-adapter-架构)
7. [前端架构](#7-前端架构)
8. [i18n 架构](#8-i18n-架构)

---

## 1. 架构概览

AgentDashboard 采用 **CQRS (Command Query Responsibility Segregation) + Event Sourcing** 架构模式，
将读写操作严格分离，所有状态变更通过不可变事件日志记录，读模型通过投影(Projection)异步重建。

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AgentDashboard                               │
│                                                                     │
│  ┌──────────┐    ┌──────────────┐    ┌─────────────────────────┐   │
│  │          │    │              │    │                         │   │
│  │  Write   │    │   Event      │    │   Read Side             │   │
│  │  Side    │───>│   Store      │───>│   (Projections)         │   │
│  │ Commands │    │  (immutable) │    │   (denormalized views)  │   │
│  │          │    │              │    │                         │   │
│  └──────────┘    └──────────────┘    └─────────────────────────┘   │
│       ^                                          │                  │
│       │                                          v                  │
│  ┌──────────┐                            ┌──────────────┐          │
│  │   API    │                            │   Queries    │          │
│  │  Routes  │<───────────────────────────│  (read-only) │          │
│  │  (POST)  │                            │   (GET)      │          │
│  └──────────┘                            └──────────────┘          │
│       ^                                          │                  │
│       │              ┌──────────┐                │                  │
│       └──────────────│    UI    │────────────────┘                  │
│                      │  (Next)  │                                   │
│                      └──────────┘                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### 核心设计原则

- **命令与查询分离**: 写操作(Command)和读操作(Query)使用不同的模型和路径
- **事件不可变**: 所有状态变更以事件形式追加到 Event 表，支持去重 (idempotency key)
- **投影重建**: 读模型（TaskProjection）可随时从事件日志重建，保证最终一致性
- **纯函数领域逻辑**: 状态推导函数无副作用，便于测试和推理
- **适配器模式**: Runtime 层通过 Registry 模式注册不同执行后端，支持热插拔

---

## 2. 系统分层

```
┌─────────────────────────────────────────────────────────────────┐
│                     前端 (Next.js App Router)                    │
│   Server Components + Client Components + ControlPlaneShell     │
├─────────────────────────────────────────────────────────────────┤
│                     API Layer (src/app/api/)                     │
│          Next.js App Router API Routes (RESTful)                │
├──────────────────────┬──────────────────────────────────────────┤
│   Command Layer      │          Query Layer                     │
│  src/modules/        │       src/modules/                       │
│    commands/         │         queries/                         │
│  (18 commands)       │       (8 queries)                        │
├──────────────────────┴──────────────────────────────────────────┤
│              Projection Layer (src/modules/projections/)         │
│         rebuildTaskProjection / getWorkProjection                │
├─────────────────────────────────────────────────────────────────┤
│               Event Layer (src/modules/events/)                  │
│            appendCanonicalEvent (with deduplication)             │
├─────────────────────────────────────────────────────────────────┤
│            Domain Logic (src/modules/tasks/)                     │
│    deriveTaskState / deriveTaskRunnability / deriveSchedule...   │
├──────────────────────┬──────────────────────────────────────────┤
│   AI Layer           │        Runtime Layer                     │
│  src/modules/ai/     │     src/modules/runtime/                 │
│  LLM + rule-based    │     OpenClaw + Research adapters         │
├──────────────────────┴──────────────────────────────────────────┤
│                   Database (Prisma + PostgreSQL)                  │
│                        14 Models                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 API Layer — `src/app/api/`

Next.js App Router 的 API Routes 作为系统唯一入口。所有 HTTP 请求经由此层路由到对应的
Command 或 Query 函数。

- **POST/PUT/PATCH/DELETE** 请求 → 调用 Command 函数
- **GET** 请求 → 调用 Query 函数
- 负责参数校验、认证、错误处理和响应序列化

### 2.2 Command Layer — `src/modules/commands/`

所有写操作，共 18 个命令函数：

```
src/modules/commands/
├── create-task.ts              # 创建新任务
├── update-task.ts              # 更新任务字段
├── mark-task-done.ts           # 标记任务完成
├── accept-task-result.ts       # 接受任务运行结果
├── reopen-task.ts              # 重新打开已完成/取消的任务
├── create-follow-up-task.ts    # 创建后续跟进任务
├── start-run.ts                # 启动 Agent 运行
├── retry-run.ts                # 重试失败的运行
├── resume-run.ts               # 恢复暂停的运行
├── resolve-approval.ts         # 处理审批请求(approve/reject)
├── provide-input.ts            # 向等待输入的运行提供数据
├── send-operator-message.ts    # 发送操作员消息
├── apply-schedule.ts           # 应用排程（设置时间窗口）
├── clear-schedule.ts           # 清除排程
├── propose-schedule.ts         # 提出排程建议
├── decide-schedule-proposal.ts # 接受/拒绝排程建议
├── invalidate-memory.ts        # 使记忆条目失效
├── generate-task-plan.ts       # AI 生成任务计划
└── __tests__/                  # 命令单元测试
```

每个命令函数遵循统一模式：

```
Command 执行流程:
  1. 参数验证
  2. 读取当前状态（从 DB）
  3. 执行业务逻辑
  4. 写入数据库（事务）
  5. 追加事件 (appendCanonicalEvent)
  6. 触发投影重建 (rebuildTaskProjection)
  7. 返回结果
```

### 2.3 Query Layer — `src/modules/queries/`

所有读操作，共 8 个查询函数：

```
src/modules/queries/
├── get-schedule-page.ts        # 排程页面数据（含 runnability 状态）
├── get-work-page.ts            # 工作台页面（当前活跃任务+运行）
├── get-task-page.ts            # 单个任务详情页数据
├── get-task-center.ts          # 任务中心列表（筛选、排序）
├── get-inbox.ts                # 收件箱（待处理审批、输入请求）
├── get-memory-console.ts       # 记忆管理控制台
├── get-workspaces.ts           # 工作空间列表
├── get-workspace-overview.ts   # 工作空间概览统计
└── __tests__/                  # 查询单元测试
```

Query 函数直接从投影表(TaskProjection)或主表读取，**不触发任何写操作**。
查询结果经过聚合和格式化后直接返回给前端。

### 2.4 Projection Layer — `src/modules/projections/`

投影层负责将规范化的数据库状态转换为前端查询优化的非规范化读模型。

```
src/modules/projections/
├── rebuild-task-projection.ts  # 重建 TaskProjection 表
├── get-work-projection.ts      # 获取工作视图投影数据
└── __tests__/
    ├── task-state.test.ts
    └── projection-read-model.bun.test.ts
```

**rebuildTaskProjection**:
- 输入：taskId
- 读取 Task + 最新 Run + TaskSession + TaskDependency
- 调用 deriveTaskState() 计算派生状态
- 调用 deriveTaskRunnability() 计算可运行性
- 调用 deriveScheduleState() 计算排程状态
- 写入/更新 TaskProjection 表（upsert）

```
┌─────────┐    ┌──────────┐    ┌───────────────┐    ┌────────────────┐
│  Task   │───>│ derive   │───>│ TaskProjection│───>│  Query Layer   │
│  + Run  │    │ State()  │    │  (upsert)     │    │  (read-only)   │
│  + Deps │    │ pure fn  │    │               │    │                │
└─────────┘    └──────────┘    └───────────────┘    └────────────────┘
```

### 2.5 Event Layer — `src/modules/events/`

不可变事件日志，单一入口函数：

```
src/modules/events/
└── append-canonical-event.ts   # 追加规范事件（带去重）
```

**appendCanonicalEvent** 核心特性：
- **幂等去重**: 通过 idempotency key 防止重复事件写入
- **结构化 payload**: 事件携带类型化的 JSON payload
- **时间戳**: 自动附加服务端时间戳
- **关联**: 事件关联到 workspace、task、run 等实体

事件类型示例：
```
task.created / task.updated / task.completed / task.done
run.started / run.completed / run.failed
approval.requested / approval.resolved
schedule.applied / schedule.cleared
memory.invalidated
```

### 2.6 Domain Logic — `src/modules/tasks/`

纯函数层，无数据库访问，无副作用，仅负责业务规则计算：

```
src/modules/tasks/
├── derive-task-state.ts          # 从 Task + Run 推导聚合状态
├── derive-task-runnability.ts    # 判断任务是否可运行
│                                 #   (依赖检查、排程窗口、状态前置条件)
├── derive-schedule-state.ts      # 从排程配置推导排程状态
│                                 #   (Unscheduled/Scheduled/InProgress/
│                                 #    AtRisk/Interrupted/Overdue/Completed)
├── validate-schedule-window.ts   # 验证排程时间窗口合法性
└── __tests__/
    └── derive-task-runnability.test.ts
```

**deriveTaskState** 状态推导逻辑：

```
                    ┌───────────┐
                    │   Draft   │  (新建，无配置)
                    └─────┬─────┘
                          │ 配置完成
                          v
                    ┌───────────┐
           ┌────── │   Ready   │ ──────┐
           │       └───────────┘       │
     startRun()              applySchedule()
           │                           │
           v                           v
     ┌───────────┐              ┌───────────┐
     │  Queued   │              │ Scheduled │
     └─────┬─────┘              └─────┬─────┘
           │ agent picks up           │ 时间到
           v                          v
     ┌───────────┐              ┌───────────┐
     │  Running  │              │  Queued   │
     └─────┬─────┘              └───────────┘
           │
     ┌─────┼──────────┬──────────────┐
     │     │          │              │
     v     v          v              v
  ┌──────┐┌────────┐┌───────────┐┌─────────┐
  │Failed││Wait    ││Wait       ││Completed│
  │      ││Input   ││Approval   ││         │
  └──────┘└────────┘└───────────┘└────┬────┘
                                      │ acceptResult
                                      v
                                ┌───────────┐
                                │   Done    │
                                └───────────┘
```

### 2.7 AI Layer — `src/modules/ai/`

双模式 AI 引擎：**规则模式(rule-based)** 和 **LLM 模式(smart)**，运行时按配置/可用性切换。

```
src/modules/ai/
├── llm-service.ts              # LLM 调用封装 (OpenAI API)
├── conflict-detector.ts        # 冲突检测（规则模式）
├── conflict-analyzer.ts        # 冲突分析（LLM 模式）
├── task-decomposer.ts          # 任务分解（规则 + LLM 双模式）
├── automation-suggester.ts     # 自动化建议
├── timeslot-suggester.ts       # 时间槽建议
├── suggestion-generator.ts     # 通用建议生成
├── test-analyzer.ts            # 测试分析
├── types.ts                    # AI 模块类型定义
└── __tests__/
    ├── conflict-detector.bun.test.ts
    ├── conflict-analyzer-smart.test.ts
    ├── automation-suggester.bun.test.ts
    ├── automation-suggester-smart.test.ts
    ├── task-decomposer.test.ts
    ├── task-decomposer-smart.test.ts
    ├── timeslot-suggester.test.ts
    ├── llm-service.test.ts
    └── ai-integration.test.ts
```

**双模式策略**:

```
┌──────────────────────┐       ┌──────────────────────┐
│   Rule-Based Mode    │       │     LLM Mode         │
│  (fast, 确定性结果)   │       │  (智能, 概率性结果)    │
│                      │       │                      │
│  • 基于阈值/规则     │       │  • OpenAI API        │
│  • 零延迟            │       │  • 上下文理解         │
│  • 离线可用          │       │  • 自然语言输出       │
│  • 可预测            │       │  • 需要 API Key      │
└──────────┬───────────┘       └──────────┬───────────┘
           │                              │
           └──────────┬───────────────────┘
                      v
              ┌───────────────┐
              │  统一接口返回  │
              │  suggestion/  │
              │  conflict/    │
              │  decomposition│
              └───────────────┘
```

**冲突检测**: 检查排程时间窗口重叠、资源竞争
**任务分解**: 将大任务拆分为可执行子任务
**自动化建议**: 分析任务模式，建议自动化执行策略
**时间槽建议**: 基于历史数据和约束推荐最佳执行时间

### 2.8 Runtime Layer — `src/modules/runtime/`

适配器(Adapter)模式 + 注册表(Registry)模式，对接不同的 Agent 执行后端。

```
src/modules/runtime/
├── registry.ts                 # RuntimeAdapter 注册表
├── execution-registry.ts       # 执行注册表（活跃运行追踪）
├── types.ts                    # RuntimeAdapter 接口定义
├── config-spec.ts              # 运行时配置规范
├── task-config.ts              # 任务运行时配置
├── task-sessions.ts            # 会话管理
├── openclaw/                   # OpenClaw 适配器
│   ├── adapter.ts              #   RuntimeAdapter 实现
│   ├── client.ts               #   WebSocket 客户端
│   ├── orchestrator.ts         #   编排器（运行生命周期管理）
│   ├── sync-run.ts             #   同步运行模式
│   ├── mapper.ts               #   数据映射
│   ├── types.ts                #   OpenClaw 特定类型
│   ├── config.ts               #   连接配置
│   ├── freshness.ts            #   数据新鲜度检测
│   ├── probe.ts                #   健康探针
│   ├── evaluate-gate.ts        #   审批门控评估
│   ├── device-identity.ts      #   设备身份标识
│   ├── mock-adapter.ts         #   Mock 适配器（测试用）
│   └── __tests__/              #   测试套件
└── research/                   # Research 适配器
    ├── adapter.ts              #   RuntimeAdapter 实现
    ├── config.ts               #   配置
    └── __tests__/
```

详细架构见 [第6节](#6-runtime-adapter-架构)。

---

## 3. 数据流图

### 3.1 写操作流（Command Path）

```
  ┌──────┐     ┌───────────┐     ┌───────────┐     ┌───────────┐
  │  UI  │────>│ API Route │────>│  Command  │────>│  Prisma   │
  │      │     │ POST /api │     │ Function  │     │  DB Write │
  └──────┘     └───────────┘     └─────┬─────┘     └───────────┘
                                       │
                                       │ (within same transaction)
                                       │
                                       v
                                 ┌───────────┐
                                 │  append   │
                                 │ Canonical │
                                 │  Event    │
                                 └─────┬─────┘
                                       │
                                       v
                                 ┌───────────┐
                                 │  rebuild  │
                                 │  Task     │
                                 │ Projection│
                                 └───────────┘
```

### 3.2 读操作流（Query Path）

```
  ┌──────┐     ┌───────────┐     ┌───────────┐     ┌────────────────┐
  │  UI  │<────│ API Route │<────│  Query    │<────│ TaskProjection │
  │      │     │ GET /api  │     │ Function  │     │ (denormalized) │
  └──────┘     └───────────┘     └───────────┘     └────────────────┘
```

### 3.3 完整数据流

```
Request Flow (Write):

  Browser                API Layer              Command Layer
  ┌──────┐              ┌──────────┐           ┌──────────────┐
  │ User │──POST───────>│ /api/    │──parse───>│ createTask() │
  │ Click│              │ tasks    │  validate │ startRun()   │
  └──────┘              └──────────┘           │ ...          │
                                               └──────┬───────┘
                                                      │
                        Database                      │ tx.begin()
                        ┌─────────────────────────────v──────────┐
                        │                                        │
                        │  ┌────────┐  ┌─────────┐  ┌────────┐ │
                        │  │ Task   │  │  Run    │  │ Event  │ │
                        │  │ table  │  │  table  │  │ table  │ │
                        │  └────────┘  └─────────┘  └────────┘ │
                        │                                        │
                        └────────────────────┬───────────────────┘
                                             │ tx.commit()
                        Projection Layer     │
                        ┌────────────────────v───────────────────┐
                        │  rebuildTaskProjection(taskId)          │
                        │    deriveTaskState()                    │
                        │    deriveTaskRunnability()              │
                        │    deriveScheduleState()                │
                        │    => UPSERT TaskProjection             │
                        └────────────────────────────────────────┘

Request Flow (Read):

  Browser                API Layer              Query Layer
  ┌──────┐              ┌──────────┐           ┌──────────────────┐
  │ Page │──GET────────>│ /api/    │──route───>│ getWorkPage()    │
  │ Load │              │ work     │           │ getSchedulePage()│
  └──────┘              └──────────┘           │ getInbox()       │
                                               └────────┬─────────┘
                                                        │
                                               ┌────────v─────────┐
                                               │ TaskProjection   │
                                               │ (pre-computed    │
                                               │  denormalized    │
                                               │  read model)     │
                                               └──────────────────┘
```

### 3.4 Runtime 执行流

```
  Command Layer          Runtime Layer              External Agent
  ┌───────────┐         ┌──────────────┐           ┌─────────────┐
  │ startRun()│────────>│ Registry     │──lookup──>│             │
  └───────────┘         │ .getAdapter()│           │  OpenClaw   │
                        └──────┬───────┘           │  Server     │
                               │                   │             │
                               v                   │  (WebSocket)│
                        ┌──────────────┐           │             │
                        │ OpenClaw     │──WS──────>│ sessions.   │
                        │ Adapter      │           │  create     │
                        │              │<──events──│             │
                        │ orchestrator │           │  agent      │
                        │ sync-run     │           │  agent.wait │
                        └──────┬───────┘           └─────────────┘
                               │
                               v
                        ┌──────────────┐
                        │ Update Run   │
                        │ status, logs │
                        │ artifacts    │
                        └──────────────┘
```

---

## 4. 数据库设计

系统使用 Prisma ORM + PostgreSQL，共 14 个数据模型。

### 4.1 实体关系图

```
┌─────────────┐       ┌─────────────────┐
│  Workspace  │──1:N──│      Task       │
│             │       │                 │
│  id         │       │  id             │
│  name       │       │  workspaceId    │
│  status     │       │  title          │
│             │       │  description    │
└─────────────┘       │  status (12)    │
                      │  priority       │
                      │  ownerType      │
                      │  scheduledStart │
                      │  scheduledEnd   │
                      │  scheduleStatus │
                      │  scheduleSource │
                      └──┬──┬──┬──┬─────┘
                         │  │  │  │
          ┌──────────────┘  │  │  └───────────────┐
          │                 │  │                   │
          v                 │  v                   v
  ┌───────────────┐        │  ┌───────────────┐  ┌────────────────┐
  │  TaskSession  │        │  │TaskDependency │  │ TaskProjection │
  │               │        │  │               │  │  (read model)  │
  │  id           │        │  │  fromTaskId   │  │                │
  │  taskId       │        │  │  toTaskId     │  │  derivedStatus │
  │  runtimeRef   │        │  │  type:        │  │  runnability   │
  │  openclawSid  │        │  │   blocks      │  │  scheduleState │
  └───────────────┘        │  │   relates_to  │  │  enrichedData  │
                           │  │   child_of    │  └────────────────┘
                           │  └───────────────┘
                           v
                     ┌───────────┐
                     │    Run    │──1:N──┐
                     │           │       │
                     │  id       │       │
                     │  taskId   │   ┌───v──────────┐
                     │  status   │   │  Approval    │
                     │  startAt  │   │              │
                     │  endAt    │   │  id          │
                     │  output   │   │  runId       │
                     └───┬───┬──┘   │  status      │
                         │   │      │  payload     │
                    ┌────┘   │      └──────────────┘
                    │        │
                    v        v
  ┌─────────────────┐  ┌──────────────────┐
  │    Artifact     │  │ConversationEntry │──1:N──┐
  │                 │  │                  │       │
  │  id             │  │  id              │  ┌────v────────┐
  │  runId          │  │  runId           │  │ToolCallDetail│
  │  type:          │  │  role            │  │             │
  │   file/patch/   │  │  content         │  │  id         │
  │   summary/etc   │  │                  │  │  entryId    │
  └─────────────────┘  └──────────────────┘  │  toolName   │
                                             │  input/output│
                                             └─────────────┘

  ┌───────────────┐    ┌──────────────────┐    ┌───────────────┐
  │    Memory     │    │     Event        │    │ScheduleProposal│
  │               │    │   (immutable)    │    │               │
  │  id           │    │                  │    │  id           │
  │  workspaceId  │    │  id              │    │  taskId       │
  │  scope        │    │  type            │    │  status       │
  │  sourceType   │    │  entityType      │    │  proposedStart│
  │  status       │    │  entityId        │    │  proposedEnd  │
  │  content      │    │  payload (JSON)  │    │  source       │
  └───────────────┘    │  idempotencyKey  │    │  reasoning    │
                       │  createdAt       │    └───────────────┘
                       └──────────────────┘
  ┌────────────────┐
  │ RuntimeCursor  │
  │                │
  │  id            │
  │  runtimeName   │
  │  cursorValue   │
  │  updatedAt     │
  └────────────────┘
```

### 4.2 模型说明

| 模型               | 职责                                                 |
|--------------------|------------------------------------------------------|
| **Workspace**      | 顶层工作空间容器，Task 的逻辑隔离                      |
| **Task**           | 核心任务实体，包含状态、优先级、排程、所有者等           |
| **TaskSession**    | 任务的 Runtime 会话，关联 OpenClaw session ID           |
| **TaskDependency** | 任务间依赖关系（blocks/relates_to/child_of）           |
| **Run**            | 单次 Agent 执行记录，包含输入输出和运行时状态           |
| **Approval**       | 审批请求，Agent 需要人工批准时创建                      |
| **Artifact**       | 运行产出物（文件/补丁/摘要/报告/终端输出/URL）          |
| **Memory**         | 上下文记忆条目，分层作用域（user/workspace/project/task）|
| **Event**          | 不可变事件日志，CQRS Event Sourcing 核心               |
| **ConversationEntry** | 运行中的对话记录（user/assistant/system/tool 角色）  |
| **ToolCallDetail** | 工具调用详情，关联到对话条目                            |
| **TaskProjection** | 非规范化读模型，预计算的任务聚合视图                    |
| **ScheduleProposal** | AI/人工排程提案，待决策                              |
| **RuntimeCursor**  | Runtime 同步游标，追踪外部系统同步进度                  |

---

## 5. 核心枚举

### 5.1 TaskStatus — 12 种任务状态

```
┌──────────────────────────────────────────────────┐
│                  TaskStatus                       │
├──────────────────┬───────────────────────────────┤
│  Draft           │  新建，尚未配置完成             │
│  Ready           │  配置完成，可以执行             │
│  Queued          │  已排队，等待 Agent 拾取        │
│  Running         │  Agent 正在执行                 │
│  WaitingForInput │  Agent 等待用户输入             │
│  WaitingForApproval │ Agent 等待人工审批          │
│  Scheduled       │  已排程，等待执行窗口           │
│  Blocked         │  被依赖阻塞                     │
│  Failed          │  执行失败                       │
│  Completed       │  Agent 运行完成，待验收          │
│  Done            │  已验收完成                      │
│  Cancelled       │  已取消                         │
└──────────────────┴───────────────────────────────┘
```

### 5.2 其他核心枚举

```
TaskPriority:        Low | Medium | High | Urgent

OwnerType:           human | agent

ScheduleStatus:      Unscheduled | Scheduled | InProgress |
                     AtRisk | Interrupted | Overdue | Completed

ScheduleSource:      human | ai | system

ScheduleProposalStatus: Pending | Accepted | Rejected

RunStatus:           Pending | Running | WaitingForInput |
                     WaitingForApproval | Failed | Completed | Cancelled

ApprovalStatus:      Pending | Approved | Rejected |
                     EditedAndApproved | Expired

ArtifactType:        file | patch | summary | report |
                     terminal_output | url

MemoryScope:         user | workspace | project | task

MemorySourceType:    user_input | agent_inferred | imported | system_rule

MemoryStatus:        Active | Inactive | Conflicted | Expired

TaskDependencyType:  blocks | relates_to | child_of

WorkspaceStatus:     Active | Archived
```

---

## 6. Runtime Adapter 架构

### 6.1 Registry 模式

```
┌──────────────────────────────────────────────────────────┐
│                  RuntimeRegistry                          │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  adapters: Map<string, RuntimeAdapter>            │   │
│  │                                                    │   │
│  │    "openclaw"  => OpenClawAdapter                  │   │
│  │    "research"  => ResearchAdapter                  │   │
│  │    "mock"      => MockAdapter (test)               │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  register(name, adapter)                                 │
│  getAdapter(name) -> RuntimeAdapter                      │
│  listAdapters() -> string[]                              │
└──────────────────────────────────────────────────────────┘

interface RuntimeAdapter {
  startRun(task, config) -> RunHandle
  pollStatus(runHandle) -> RunStatus
  sendInput(runHandle, input) -> void
  resolveApproval(runHandle, decision) -> void
  getConversation(runHandle) -> ConversationEntry[]
  stop(runHandle) -> void
}
```

### 6.2 OpenClaw WebSocket 协议

OpenClaw 通过 WebSocket 网关通信，使用 JSON-RPC 风格消息协议：

```
┌─────────────────┐                    ┌──────────────────┐
│  AgentDashboard │                    │  OpenClaw Server │
│  (WS Client)    │                    │  (WS Gateway)    │
│                 │                    │                  │
│  ─ sessions.create ──────────────>   │                  │
│                 │  <── session_id ── │                  │
│                 │                    │                  │
│  ─ agent ─────────────────────────>  │  启动 Agent      │
│                 │                    │                  │
│                 │  <── streaming ──  │  事件流:          │
│                 │      events        │   思考/工具调用/  │
│                 │                    │   输出/审批请求   │
│                 │                    │                  │
│  ─ agent.wait ─────────────────────> │  等待完成        │
│                 │  <── final_result  │                  │
│                 │                    │                  │
│  ─ chat.history ───────────────────> │  获取对话历史    │
│                 │  <── entries[] ──  │                  │
│                 │                    │                  │
│  ─ exec.approval.list ─────────────> │  列出待审批      │
│  ─ exec.approval.approve ──────────> │  批准执行        │
│  ─ exec.approval.reject ───────────> │  拒绝执行        │
│                 │                    │                  │
└─────────────────┘                    └──────────────────┘
```

### 6.3 OpenClaw 适配器内部组件

```
openclaw/
├── client.ts           WebSocket 连接管理，消息收发
│                       自动重连、心跳、超时处理
│
├── adapter.ts          实现 RuntimeAdapter 接口
│                       将通用操作映射到 OpenClaw 协议
│
├── orchestrator.ts     运行生命周期编排
│                       状态机管理：Pending->Running->*
│                       事件转发到 Command 层
│
├── sync-run.ts         同步运行模式
│                       阻塞等待运行完成
│                       用于简单任务场景
│
├── mapper.ts           数据格式转换
│                       OpenClaw 消息 <-> 内部模型
│
├── freshness.ts        数据新鲜度检查
│                       防止处理过期事件
│
├── evaluate-gate.ts    审批门控评估
│                       决定是否需要人工审批
│
├── probe.ts            健康探针
│                       检查 OpenClaw 服务可用性
│
├── device-identity.ts  设备标识
│                       多实例部署时的唯一标识
│
├── config.ts           连接配置
│                       URL、认证、超时等
│
├── types.ts            OpenClaw 特定类型定义
│
└── mock-adapter.ts     Mock 实现
                        测试用，模拟完整运行生命周期
                        可配置延迟、失败等场景
```

### 6.4 Research 适配器

```
research/
├── adapter.ts          Research 任务执行适配器
│                       针对研究/分析类任务优化
└── config.ts           Research 运行时配置
```

---

## 7. 前端架构

### 7.1 Next.js App Router + Server/Client Components

```
src/app/
├── [lang]/                          # i18n 路由段
│   ├── layout.tsx                   # 根布局 (Server Component)
│   ├── page.tsx                     # 首页
│   ├── workspace/
│   │   └── [workspaceId]/
│   │       ├── layout.tsx           # ControlPlaneShell
│   │       ├── work/page.tsx        # 工作台
│   │       ├── tasks/page.tsx       # 任务中心
│   │       ├── schedule/page.tsx    # 排程视图
│   │       ├── inbox/page.tsx       # 收件箱
│   │       └── memory/page.tsx      # 记忆控制台
│   └── ...
└── api/                             # API Routes (无 [lang] 前缀)
```

### 7.2 Server Components vs Client Components

```
┌─────────────────────────────────────────────────┐
│              Server Components                   │
│                                                  │
│  • page.tsx — 页面入口，async，直接调用 Query    │
│  • layout.tsx — 布局，获取工作空间上下文          │
│  • 数据获取在服务端完成，零客户端 JS 开销         │
│                                                  │
│  ┌─────────────────────────────────────────────┐│
│  │           Client Components                  ││
│  │                                              ││
│  │  • 交互组件（按钮、表单、模态框）              ││
│  │  • 实时更新（WebSocket 订阅）                 ││
│  │  • 状态管理（React state/context）            ││
│  │  • "use client" 指令标记                      ││
│  └─────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

### 7.3 ControlPlaneShell

工作空间级别的外壳布局组件，提供：

```
┌─────────────────────────────────────────────────────┐
│  ControlPlaneShell                                   │
│  ┌──────────┐  ┌──────────────────────────────────┐ │
│  │          │  │                                  │ │
│  │  Sidebar │  │        Page Content              │ │
│  │          │  │                                  │ │
│  │  • Work  │  │   (Server Component 渲染)        │ │
│  │  • Tasks │  │                                  │ │
│  │  • Sched │  │   Query 数据作为 props 传入      │ │
│  │  • Inbox │  │                                  │ │
│  │  • Memory│  │                                  │ │
│  │          │  │                                  │ │
│  └──────────┘  └──────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 7.4 页面数据流模式

```
  Server Component (page.tsx)
  ┌───────────────────────────────────────┐
  │  async function Page({ params }) {    │
  │    const data = await getWorkPage()   │  ← 直接调用 Query
  │    return <WorkView data={data} />    │  ← 传给 Client Component
  │  }                                    │
  └───────────────────────────────────────┘
                    │
                    v
  Client Component (WorkView)
  ┌───────────────────────────────────────┐
  │  "use client"                         │
  │  function WorkView({ data }) {        │
  │    // 交互逻辑                         │
  │    // POST to /api/... for commands   │  ← 调用 API Route 执行 Command
  │    // revalidate / router.refresh()   │  ← 触发 Server Component 重新渲染
  │  }                                    │
  └───────────────────────────────────────┘
```

---

## 8. i18n 架构

### 8.1 路由结构

采用 Next.js App Router 的 **动态路由段** `[lang]` 实现国际化：

```
src/app/[lang]/
         ^
         │
         ├── "en"  →  英文界面
         └── "zh"  →  中文界面

URL 示例:
  /en/workspace/abc/work    → 英文工作台
  /zh/workspace/abc/work    → 中文工作台
```

### 8.2 字典文件

```
src/
├── dictionaries/
│   ├── en.ts (or .json)        # English dictionary
│   └── zh.ts (or .json)        # 中文字典
│
│  字典结构示例:
│  {
│    "nav": {
│      "work": "Work" / "工作台",
│      "tasks": "Tasks" / "任务中心",
│      "schedule": "Schedule" / "排程",
│      "inbox": "Inbox" / "收件箱",
│      "memory": "Memory" / "记忆"
│    },
│    "task": {
│      "status": {
│        "Draft": "Draft" / "草稿",
│        "Running": "Running" / "运行中",
│        ...
│      }
│    }
│  }
```

### 8.3 I18nProvider

```
┌───────────────────────────────────────────────────┐
│  [lang] layout.tsx                                 │
│                                                    │
│  1. 从路由参数获取 lang                             │
│  2. 加载对应字典: getDictionary(lang)               │
│  3. 包裹 I18nProvider:                              │
│                                                    │
│  <I18nProvider lang={lang} dictionary={dict}>      │
│    {children}                                      │
│  </I18nProvider>                                   │
│                                                    │
│  子组件通过 useI18n() hook 获取翻译函数:            │
│    const { t } = useI18n()                         │
│    t("nav.work") => "工作台"                        │
└───────────────────────────────────────────────────┘
```

### 8.4 i18n 数据流

```
  URL: /zh/workspace/abc/work
       │
       v
  [lang] = "zh"
       │
       v
  getDictionary("zh") → zh.ts
       │
       v
  I18nProvider(dict)
       │
       v
  useI18n() in components → t("key") → 翻译文本
```

---

## 附录：技术栈总览

| 层次        | 技术选型                                    |
|------------|---------------------------------------------|
| 前端框架    | Next.js 14+ (App Router)                    |
| UI 渲染    | React Server Components + Client Components |
| 数据库     | PostgreSQL                                   |
| ORM        | Prisma                                       |
| 运行时     | Bun / Node.js                                |
| 测试       | Bun test + Jest                              |
| AI         | OpenAI API (LLM mode) + 规则引擎             |
| Agent 运行  | OpenClaw (WebSocket) + Research adapter      |
| 国际化     | 自建 i18n ([lang] route segments)            |
| 架构模式   | CQRS + Event Sourcing + Adapter Pattern      |
