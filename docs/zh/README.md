# Chrona 文档 — 中文

Chrona 是一个本地优先的 AI 日程软件。它把任务变成可编辑计划，放入日程，通过 AI/运行时 provider 执行，并在任务工作区和 Dashboard 中审查结果。

## 当前能做什么

- 任务管理：创建、编辑、完成、重开、删除、优先级、标签、父子任务、依赖关系。
- AI 计划生成：从任务生成 PlanBlueprint，流式查看进度，审查、编辑并接受计划。
- 图计划执行：执行 task / checkpoint / condition / wait 节点，支持输入、审批、重试、阻塞、失败和完成。
- 任务工作区：在一个任务上下文中查看最新结果、计划图、执行记录、任务信息、对话上下文和命令输入区。
- Schedule 页面：查看时间块、检查冲突、创建并接受排期建议，并在显式配置后到期自动启动工作。
- 运行状态处理：Dashboard 和任务工作区聚合审批、排期建议、等待输入、失败运行和取消运行。
- AI 配置：Settings / AI Clients 使用数据库保存 AI client 与 feature binding。
- 智能体集成：Hermes 插件通过 MCP 暴露 Chrona 工具，使用 AI-visible refs，而不是后端真实 ID。

## 从这里开始

| 目标 | 文档 |
| --- | --- |
| 安装并运行 Chrona | [快速开始](./quick-start.md) |
| 查看当前产品方向 | [路线图](./roadmap.md) |
| 优化任务工作区交互链路 | [任务工作区交互优化方案](./task-workspace-interaction-improvements.md) |
| 理解 Goal Workbench 资产使用区的目标设计 | [Goal Workbench 产品设计](./goal-workbench-product-design.md) |
| 通过 HTTP 或 MCP 集成 | [API 参考（英文）](../en/api-reference.md) |
| 理解系统架构 | [系统架构（英文）](../en/architecture.md) |
| 跟踪执行内部流程 | [后端执行流程（英文）](../en/backend-execution-flow.md) |
| 理解持久化模型 | [数据模型（英文）](../en/data-model.md) |
| 判断代码应该放在哪里 | [包边界说明（英文）](../en/package-boundaries.md) |
| 扩展 AI/运行时 provider | [Provider 边界（英文）](../en/provider-boundary.md) |
| 理解已接受的长期目标、Trigger 与任务实例设计 | [长期目标与 Trigger 设计（英文）](../en/long-horizon-goals-and-triggers.md) |
| 设计 AI Feature 的 Observation、Action、Result 与 Completion | [AI Feature Runtime 架构与实施规范](./ai-feature-runtime-architecture.md) |

## 主要用户流程

### 1. 任务 → 计划 → 执行

1. 创建或更新任务。
2. 在任务工作区生成 AI 计划。
3. 审查并按需编辑生成的图计划。
4. 接受计划。
5. 手动启动执行，或让 scheduler 在显式配置后到点触发。
6. 遇到 checkpoint、输入、审批、阻塞或失败时介入处理。
7. 在任务工作区查看最新结果与执行记录。

### 2. 排期驱动执行

1. 创建任务，可选设置截止时间。
2. 直接设置时间块，或请求 AI 生成排期建议。
3. 在 Schedule 中接受/拒绝建议。
4. 到期后 scheduler 可以在显式配置后自动启动 WorkBlock。
5. 执行状态与任务投影同步回 Schedule、Dashboard 和任务工作区。

### 3. 智能体集成

外部智能体通过 MCP 工具调用 Chrona，例如 `chrona_plan_generate`、`chrona_node_complete`、`chrona_node_block`、`chrona_condition_select`。智能体只能使用 Chrona 提供的 AI 可见 node / branch refs 提交结果，不能编造后端 ID。

## 开发者地图

| 区域 | 路径 | 职责 |
| --- | --- | --- |
| Web 应用 | `apps/web` | Vite + React 19 + React Router UI |
| Server | `apps/server` | Bun 上的 Hono API 路由与静态资源服务 |
| CLI | `packages/cli` | 用于启动 Chrona 的打包入口 |
| Engine | `packages/engine` | 任务、计划、执行、排期、投影、AI client 用例 |
| Contracts | `packages/contracts` | API schema、AI feature、运行时事件、MCP tool schema |
| Graph runtime | `packages/graph-runtime` | 计划图解析、状态转换、命令执行原语 |
| Database | `packages/db` + `prisma` | SQLite + Prisma 7 schema、迁移、种子数据 |
| Providers | `packages/providers/*` | 运行时/provider 协议适配器 |
| Hermes 插件 | `external-plugins/hermes` | 暴露给 Hermes Agent 的 Chrona MCP 工具 |

## 仓库开发命令

在仓库根目录运行：

```bash
bun install
bun run dev
```

常用检查：

```bash
bun run typecheck
bun run lint
bun run test
bun run test:bun
bun run test:api
bun run check:ui-foundation
bun run check:boundaries
```

仅启动后端服务：

```bash
bun run server:start
```

仅启动前端 dev server：

```bash
bun run dev:web
```
