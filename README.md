# 🎛️ AgentDashboard

> **AI 原生任务控制平面** — 用于规划、调度和观察 AI 运行时支持的工作

AgentDashboard 是一个面向 AI Agent 工作流的控制面板，提供日程规划、任务管理、执行协作、消息收件箱和记忆管理等核心能力。它采用 CQRS/事件溯源架构，支持通过 OpenClaw 网关与 AI 运行时进行实时交互，让人类与 AI Agent 在同一界面中高效协作。

---

## 📋 目录

- [核心功能](#-核心功能)
- [技术栈](#-技术栈)
- [系统架构](#-系统架构)
- [快速开始](#-快速开始)
- [项目结构](#-项目结构)
- [环境变量说明](#-环境变量说明)
- [常用命令](#-常用命令)
- [文档索引](#-文档索引)
- [许可证](#-许可证)

---

## ✨ 核心功能

| 模块 | 说明 |
|------|------|
| **Schedule（日程规划）** | 时间轴视图，管理日程安排与时间块；AI 辅助时间段建议与冲突检测 |
| **Work（执行协作）** | 与 AI Agent 的实时工作台；对话式交互、审批流程、执行时间线追踪 |
| **Tasks（任务中心）** | 任务的创建、分解、状态管理；支持 AI 驱动的任务自动分解与自动化建议 |
| **Inbox（收件箱）** | 统一的通知与消息中心，聚合来自各模块的待办事项 |
| **Memory（记忆管理）** | Agent 记忆的持久化与检索，支撑上下文感知的 AI 交互 |

---

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| **框架** | Next.js 16 (App Router) |
| **UI** | React 19 + Tailwind CSS 4 + shadcn/ui + Base UI + Lucide Icons |
| **语言** | TypeScript (strict) |
| **运行时** | Bun |
| **数据库** | SQLite (via better-sqlite3) |
| **ORM** | Prisma 7 (with driver adapters) |
| **校验** | Zod 4 |
| **测试** | Vitest + Testing Library + Playwright (E2E) |
| **CLI** | Commander.js + chalk + cli-table3 |

---

## 🏗️ 系统架构

AgentDashboard 采用 **CQRS（命令查询职责分离）** 与 **事件溯源** 模式：

```
┌─────────────────────────────────────────────────────────────────┐
│                        AgentDashboard                           │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │ Schedule  │  │   Work   │  │  Tasks   │  │ Inbox/Memory │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘   │
│       │              │             │                │            │
│  ─────┴──────────────┴─────────────┴────────────────┴────────   │
│                    Next.js API Routes                           │
│  ───────────────────────────────────────────────────────────    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   CQRS / Event Sourcing                  │   │
│  │                                                          │   │
│  │  ┌───────────┐  ┌───────────┐  ┌─────────────────────┐ │   │
│  │  │ Commands  │  │  Queries  │  │    Projections      │ │   │
│  │  │ (写操作)   │  │ (读操作)   │  │  (事件→读模型投影)   │ │   │
│  │  └─────┬─────┘  └─────┬─────┘  └──────────┬──────────┘ │   │
│  │        │              │                    │             │   │
│  │        ▼              ▼                    ▼             │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │                   Events (领域事件)                │   │   │
│  │  └──────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Runtime Adapter Abstraction                  │   │
│  │  ┌───────────────┐  ┌────────────────┐  ┌────────────┐ │   │
│  │  │ OpenClaw Live │  │ OpenClaw Mock  │  │  Local AI   │ │   │
│  │  │  (WebSocket)  │  │  (测试用模拟)   │  │  Provider  │ │   │
│  │  └───────────────┘  └────────────────┘  └────────────┘ │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │        Prisma 7 + SQLite (持久化层)                      │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 关键设计原则

- **Commands** — 封装所有写操作，产生领域事件
- **Queries** — 纯读操作，从投影（Projections）中读取优化后的读模型
- **Projections** — 监听事件流，维护面向查询优化的读模型
- **Events** — 不可变的领域事件，作为系统状态变更的唯一事实来源
- **Runtime Adapter** — 抽象 AI 运行时交互，支持 `live`（OpenClaw 网关）和 `mock` 模式切换

---

## 🚀 快速开始

### 前置要求

- [Bun](https://bun.sh/) >= 1.0

### 安装与启动

```bash
# 1. 克隆仓库
git clone <repo-url> AgentDashboard
cd AgentDashboard

# 2. 安装依赖
bun install

# 3. 配置环境变量
cp .env.example .env
# 按需编辑 .env 文件

# 4. 生成 Prisma Client
bunx prisma generate

# 5. 初始化数据库（种子数据）
bun run db:seed

# 6. 启动开发服务器
bun run dev
```

打开浏览器访问 [http://localhost:3000](http://localhost:3000) 即可使用。

---

## 📁 项目结构

```
AgentDashboard/
├── prisma/                    # Prisma schema + 迁移 + seed 脚本
│   ├── schema.prisma
│   └── seed.ts
├── src/
│   ├── app/                   # Next.js App Router
│   │   ├── [locale]/          # 国际化页面路由
│   │   │   ├── schedule/      # 日程规划页
│   │   │   ├── work/          # 执行协作页
│   │   │   ├── tasks/         # 任务中心页
│   │   │   ├── inbox/         # 收件箱页
│   │   │   └── memory/        # 记忆管理页
│   │   └── api/               # API 路由 (REST)
│   ├── modules/               # 业务逻辑模块
│   │   ├── ai/                # AI 服务 (LLM, 任务分解, 时间段建议等)
│   │   └── runtime/           # 运行时适配器 (OpenClaw 等)
│   ├── components/            # UI 组件
│   │   ├── ui/                # 基础 UI 组件 (Button, Field, Badge 等)
│   │   ├── work/              # Work 模块专属组件
│   │   ├── schedule/          # Schedule 模块专属组件
│   │   └── i18n/              # 国际化组件
│   ├── cli/                   # CLI 客户端 (agentdash)
│   │   └── index.ts
│   ├── hooks/                 # React Hooks
│   └── i18n/                  # 国际化配置与路由
├── scripts/                   # 工具脚本
│   └── openclaw/              # OpenClaw 探测脚本
├── .env.example               # 环境变量模板
├── package.json
├── tsconfig.json
└── tailwind.config.ts
```

---

## ⚙️ 环境变量说明

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `DATABASE_URL` | SQLite 数据库路径 | `file:./prisma/dev.db` |
| `OPENCLAW_MODE` | OpenClaw 运行模式：`live`（连接真实网关）或 `mock`（模拟模式） | `live` |
| `OPENCLAW_GATEWAY_URL` | OpenClaw 网关 WebSocket 地址 | `ws://localhost:3001/gateway` |
| `OPENCLAW_AUTH_TOKEN` | OpenClaw 网关认证令牌 | — |
| `AI_PROVIDER_*` | AI 提供商相关配置（API Key、模型名称等） | — |
| `NEXT_PUBLIC_WORK_POLL_INTERVAL_MS` | Work 页面轮询间隔（毫秒） | `10000` |

---

## 📦 常用命令

### 开发

```bash
bun run dev              # 启动开发服务器 (Next.js)
bun run build            # 构建生产版本
bun run start            # 启动生产服务器
```

### 测试

```bash
bun run test             # 运行单元测试 (Vitest + coverage)
bun run test:watch       # 监听模式运行测试
bun run test:e2e         # 运行端到端测试 (Playwright)
bun run test:openclaw:integration  # OpenClaw 集成测试
```

### 代码质量

```bash
bun run lint             # ESLint 检查
```

### 数据库

```bash
bunx prisma generate     # 生成 Prisma Client
bun run db:seed          # 运行数据库种子脚本
```

### CLI 工具

```bash
bun run agentdash        # 运行 AgentDashboard CLI 客户端
bun run agentdash --help # 查看 CLI 帮助信息
```

### 运维工具

```bash
bun run probe:openclaw   # 探测 OpenClaw 网关连接状态
```

---

## 📖 文档索引

### 系统文档

| 文档 | 说明 |
|------|------|
| [docs/architecture.md](./docs/architecture.md) | 系统架构设计 — CQRS/事件溯源、分层架构、数据库设计、运行时适配器 |
| [docs/modules.md](./docs/modules.md) | 模块参考 — 所有 src/modules/ 下模块的详细 API 文档 |
| [docs/api-reference.md](./docs/api-reference.md) | API 参考 — 所有 REST API 端点的请求/响应格式与示例 |
| [docs/pages.md](./docs/pages.md) | 页面路由 — 所有前端页面的 URL、功能、组件说明 |
| [docs/cli.md](./docs/cli.md) | CLI 参考 — 命令行工具的完整使用指南 |
| [docs/development.md](./docs/development.md) | 开发指南 — 环境搭建、编码规范、新增功能指引 |
| [docs/testing.md](./docs/testing.md) | 测试指南 — Vitest/Bun test/Playwright 三框架测试策略 |

### 项目规划

| 文档 | 说明 |
|------|------|
| [CLAUDE.md](./CLAUDE.md) | AI 编码助手指南与项目规范 |
| [AGENTS.md](./AGENTS.md) | Agent 系统设计与约定 |
| [AI_FEATURES_ROADMAP.md](./AI_FEATURES_ROADMAP.md) | AI 功能路线图 |
| [P0_IMPLEMENTATION_GAP_ANALYSIS.md](./P0_IMPLEMENTATION_GAP_ANALYSIS.md) | P0 实现差距分析 |
| [PHASE1_COMPLETION_SUMMARY.md](./PHASE1_COMPLETION_SUMMARY.md) | 第一阶段完成总结 |
| [PHASE2_COMPLETION_SUMMARY.md](./PHASE2_COMPLETION_SUMMARY.md) | 第二阶段完成总结 |
| [SCHEDULE_PAGE_REDESIGN.md](./SCHEDULE_PAGE_REDESIGN.md) | 日程页面重设计方案 |

---

## 📄 许可证

本项目为私有项目（Private）。保留所有权利。

---

<p align="center">
  <sub>Built with ❤️ using Next.js 16, React 19, and Bun</sub>
</p>
