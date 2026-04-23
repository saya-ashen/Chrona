# 系统架构

## 架构模式：CQRS + 事件溯源

Chrona 采用 **CQRS（命令查询职责分离）** 结合 **事件溯源（Event Sourcing）** 的架构模式。所有的状态变更都通过命令（Command）触发，产生规范事件（Canonical Event）持久化到事件存储，然后重建物化投影（Materialized Projection）供查询层读取。

### 为什么选择这种架构？

1. **完整审计轨迹**：每次操作都记录为不可变事件，可追溯任务的完整生命周期
2. **读写分离**：写入路径（命令）和读取路径（查询）独立优化
3. **可重建状态**：投影可随时从事件序列重建，保证数据一致性
4. **AI 友好**：事件流天然适合 AI 智能体的决策和分析

## 整体架构图

```
┌──────────────────────────────────────────────────────────┐
│                     客户端层                              │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────┐  │
│  │  Web UI    │  │  CLI 工具   │  │  AI Agent (外部)   │  │
│  │  React 19  │  │  chrona │  │ OpenClaw CLI Bridge│  │
│  └─────┬──────┘  └─────┬──────┘  └────────┬───────────┘  │
└────────┼───────────────┼──────────────────┼──────────────┘
         │               │                  │
         ▼               ▼                  ▼
┌──────────────────────────────────────────────────────────┐
│                     API 层 (Next.js App Router)          │
│  /api/tasks/*   /api/ai/*   /api/schedule/*              │
│  /api/inbox/*   /api/memory/*  /api/work/*               │
│  Server Actions (task-actions.ts)                        │
└─────────────────────┬────────────────────────────────────┘
                      │
         ┌────────────┼────────────┐
         ▼            ▼            ▼
┌──────────────┐ ┌─────────┐ ┌──────────┐
│   命令层      │ │ 查询层   │ │  AI 层   │
│  commands/   │ │ queries/ │ │   ai/    │
│              │ │          │ │          │
│ createTask   │ │ getWork  │ │ conflict │
│ startRun     │ │ getSchedule│ │ decompose│
│ applySchedule│ │ getInbox │ │ suggest  │
│ resolveApproval│ │ getTask │ │ timeslot │
└──────┬───────┘ └────┬─────┘ └──────────┘
       │              │
       ▼              ▼
┌──────────────┐ ┌──────────────┐
│   事件层      │ │   投影层      │
│   events/    │ │ projections/ │
│              │ │              │
│ appendEvent  │ │ rebuildTask  │
│ (不可变日志)  │ │ Projection   │
└──────┬───────┘ └──────────────┘
       │
       ▼
┌──────────────────────────────────┐
│        数据存储层                 │
│   SQLite + Prisma ORM            │
│   15 个模型 / 事件日志 / 投影表   │
└──────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│      外部运行时层                 │
│   OpenClaw CLI Bridge (HTTP)     │
│   运行 AI 智能体任务              │
└──────────────────────────────────┘
```

## 数据流详解

### 写入路径（Command Path）

```
用户操作 → API 路由 → 命令处理器 → 数据库变更 → 追加规范事件 → 重建投影
```

示例：创建任务

```
POST /api/tasks
  → createTask(input)
    → db.task.create(...)           // 持久化任务
    → appendCanonicalEvent({        // 记录事件
        eventType: "TaskCreated",
        payload: { title, priority, ... }
      })
    → rebuildTaskProjection(taskId) // 更新物化视图
```

### 读取路径（Query Path）

```
用户请求 → API 路由/页面组件 → 查询处理器 → 读取投影 + 关联数据 → 组装页面数据
```

示例：加载排期页面

```
GET /schedule
  → getSchedulePage(workspaceId, selectedDay)
    → 读取 TaskProjection（已排期/未排期/风险项）
    → 计算 focusZones（专注区域分析）
    → 计算 automationCandidates（自动化候选）
    → 执行 analyzeConflicts()（冲突检测）
    → 聚合 planningSummary（规划摘要）
    → 返回 SchedulePageData
```

### AI 增强路径

```
用户输入 → AI API 路由 → 规则引擎 / LLM / OpenClaw → 结构化建议 → 用户确认 → 命令执行
```

设计原则：所有 AI 建议都是"建议-确认"模式，不直接修改数据。

## 模块依赖关系

```
commands/  ──────────▶  events/
    │                      │
    │                      ▼
    ├──────────────▶  projections/
    │                      ▲
    ├──────────────▶  tasks/  ◀─── queries/
    │                                │
    └──────────────▶  runtime/       │
                         │           │
                         ▼           ▼
                    openclaw/     ai/ (conflict, suggest, decompose)
```

**依赖规则：**
- `commands/` 可依赖 `events/`, `projections/`, `runtime/`, `tasks/`
- `queries/` 可依赖 `projections/`, `tasks/`, `runtime/`, `ai/`
- `tasks/` 只依赖 `runtime/`（获取配置规格）
- `projections/` 只依赖 `tasks/`（状态派生）
- `events/` 无依赖（最底层）
- `ai/` 可依赖 `queries/`（插件工具需要读取数据）

## 目录结构

```
src/
├── app/                    # Next.js App Router
│   ├── layout.tsx          # 根布局
│   ├── page.tsx            # 首页
│   ├── actions/            # Server Actions
│   ├── api/                # API 路由
│   │   ├── tasks/          # 任务 CRUD + 生命周期
│   │   ├── ai/             # AI 智能端点
│   │   ├── schedule/       # 排期投影
│   │   ├── inbox/          # 收件箱投影
│   │   ├── memory/         # 记忆投影
│   │   └── work/           # 工作台投影
│   ├── inbox/              # 收件箱页面
│   ├── memory/             # 记忆控制台页面
│   ├── schedule/           # 排期页面
│   ├── tasks/              # 任务中心页面
│   ├── settings/           # 设置页面
│   ├── workspaces/         # 工作空间页面
│   └── [lang]/             # 国际化路由（镜像所有页面）
│
├── packages/
│   ├── cli/                # Chrona CLI workspace package
│   │   ├── src/index.ts    # 入口 (commander)
│   │   ├── src/commands/   # 子命令
│   │   └── src/lib/        # API 客户端 + 输出格式化
│   ├── runtime-client/     # 共享运行时客户端与 OpenClaw 通信层
│   ├── openclaw-bridge/    # Bridge HTTP 服务封装
│   └── openclaw-plugin-structured-result/ # OpenClaw business tools 插件
│
├── services/
│   └── openclaw-bridge/    # Bridge 启动入口（委托到 packages/openclaw-bridge）
│
├── components/             # React 组件
│   ├── ui/                 # 基础 UI 组件
│   ├── control-plane-shell.tsx  # 应用外壳
│   ├── schedule/           # 排期 UI 组件集
│   ├── work/               # 工作台 UI 组件集
│   ├── inbox/              # 收件箱组件
│   ├── memory/             # 记忆控制台组件
│   └── tasks/              # 任务中心组件
│
├── hooks/                  # 自定义 React Hooks
├── i18n/                   # 国际化配置
├── lib/                    # 共享工具
│
├── modules/                # 核心业务逻辑
│   ├── ai/                 # AI 智能服务
│   ├── commands/           # 命令处理器（写入）
│   ├── events/             # 事件存储
│   ├── projections/        # 投影重建
│   ├── queries/            # 查询处理器（读取）
│   ├── runtime/            # 运行时适配器
│   │   └── openclaw/       # OpenClaw 集成
│   ├── tasks/              # 任务领域逻辑
│   ├── workspaces/         # 工作空间逻辑
│   └── ui/                 # UI 导航配置
│
├── generated/prisma/       # Prisma 生成的客户端
└── test/                   # 测试配置
```

## 页面架构

| 页面 | 路由 | 说明 |
|------|------|------|
| 仪表盘 | `/` | 工作空间概览，最近活动 |
| 任务中心 | `/tasks` | 可筛选的任务列表，状态分组 |
| 排期 | `/schedule` | Google Calendar 风格的排期驾驶舱 |
| 收件箱 | `/inbox` | 待审批、待输入、排期建议等待处理项 |
| 记忆 | `/memory` | AI 智能体的持久化知识库 |
| 工作台 | `/workspaces/[id]/work/[taskId]` | 任务执行深度视图 |
| 设置 | `/settings` | 系统配置 |

每个页面遵循相同的数据加载模式：
1. 页面组件（Server Component）调用对应的查询函数
2. 查询函数从投影和数据库组装完整的页面数据
3. 页面数据传递给客户端组件渲染

## 关键设计决策

### 1. SQLite 而非 PostgreSQL
- 简化部署：单文件数据库，无需额外服务
- 足够的性能：面向个人/小团队使用场景
- Prisma ORM 提供类型安全的数据访问

### 2. 事件溯源但非纯 ES
- 命令同时写入业务表和事件表（不是纯 ES 的从事件重建状态）
- 事件用于审计、工作流追踪和 UI 时间线展示
- 投影表作为优化的读取视图，由事件触发重建

### 3. AI 双引擎策略
- **规则引擎**：确定性逻辑（冲突检测、时间建议等），无需 LLM
- **LLM 增强**：需要语义理解时调用 LLM（任务分解、自动建议等）
- 每个 AI 功能都有规则引擎兜底，LLM 不可用时不影响核心功能

### 4. OpenClaw 运行时
- 通过 CLI Bridge 的 HTTP 接口与本地 OpenClaw CLI 通信
- 支持会话管理与运行轮询；审批在 bridge 模式下采用简化/noop 处理
- 运行时适配器模式支持扩展其他 AI 执行引擎
