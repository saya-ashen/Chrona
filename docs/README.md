# AgentDashboard 文档中心

AgentDashboard 是一个基于事件溯源（Event Sourcing）和 CQRS 架构的 AI 智能体任务管理仪表盘。它管理 AI 智能体任务的完整生命周期：创建 → 排期 → 执行 → 审批 → 完成，以 OpenClaw 为主要智能体运行时，集成 AI 驱动的智能排期、任务分解、冲突检测等能力。

## 文档目录

| 文档 | 说明 |
|------|------|
| [系统架构](./architecture.md) | 整体架构设计、CQRS+ES 模式、数据流、技术栈 |
| [快速开始](./getting-started.md) | 环境准备、安装、启动、基本使用 |
| [数据模型](./data-model.md) | Prisma 数据库模型、枚举、关系图 |
| [模块文档](./modules.md) | 核心业务逻辑模块详解（commands/queries/tasks/events/projections/runtime/ai） |
| [API 参考](./api-reference.md) | 所有 REST API 端点的完整文档 |
| [CLI 使用指南](./cli-guide.md) | 命令行工具 agentdash 的完整使用文档 |
| [前端组件](./frontend-components.md) | React 组件架构、页面组成、UI 模式 |
| [AI 功能](./ai-features.md) | AI 智能功能详解：冲突检测、任务分解、智能排期、自动建议 |
| [运行时集成](./runtime-integration.md) | OpenClaw 运行时适配器、WebSocket 协议、会话管理 |
| [开发指南](./development-guide.md) | 开发环境、代码规范、测试策略、提交规范 |

## 技术栈概览

| 层级 | 技术 |
|------|------|
| 框架 | Next.js 16 (App Router) + React 19 |
| 运行时 | Bun |
| 语言 | TypeScript 5 |
| 数据库 | SQLite (Prisma 7 ORM) |
| 样式 | Tailwind CSS 4 + shadcn/ui |
| 验证 | Zod 4 |
| CLI | Commander + chalk |
| 测试 | Vitest 4 (组件) + Bun Test (查询) + Playwright (E2E) |
| AI 运行时 | OpenClaw Gateway (WebSocket) |
| 国际化 | 自建 i18n (支持中英文) |

## 核心概念

```
用户/Agent CLI
      │
      ▼
  ┌─────────┐     ┌──────────┐     ┌──────────┐
  │ API 路由 │────▶│  命令层   │────▶│ 事件存储  │
  │ /api/*   │     │ commands/ │     │ events/  │
  └─────────┘     └──────────┘     └──────────┘
      │                                  │
      ▼                                  ▼
  ┌─────────┐     ┌──────────┐     ┌──────────┐
  │ 查询层   │◀───│  投影层   │◀───│ 重建投影  │
  │ queries/ │     │projections│    │          │
  └─────────┘     └──────────┘     └──────────┘
      │
      ▼
  ┌─────────┐
  │ 前端页面 │
  │ React UI │
  └─────────┘
```
