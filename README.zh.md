[English](./README.md) | 中文

<p align="center">
  <img src="apps/web/public/favicon.png" width="80" alt="Chrona logo" />
</p>

<h1 align="center">Chrona</h1>

<p align="center">
  <strong>把 AI 对话变成可保存的任务、可编辑的计划、可排期的工作和可观测的执行过程。</strong>
</p>

<p align="center">
  <a href="https://github.com/saya-ashen/Chrona/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/saya-ashen/Chrona/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
  <a href="./package.json"><img alt="Bun >= 1.3.11" src="https://img.shields.io/badge/bun-%3E%3D1.3.11-black" /></a>
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="./docs/zh/quick-start.md">完整指南</a> ·
  <a href="./docs/architecture.md">架构</a> ·
  <a href="./docs/zh/roadmap.md">路线图</a> ·
  <a href="./CONTRIBUTING.md">贡献</a>
</p>

<p align="center">
  <img src="docs/assets/CreateTask.png" width="45%" alt="创建结构化 Chrona 任务" />
  <img src="docs/assets/TaskWorkSpace.png" width="45%" alt="查看包含计划和执行上下文的 Chrona 任务工作区" />
</p>

---

Chrona 是一个 local-first 的 AI 原生工作台。它把通常分散在不同工具中的四层能力连接起来：

```text
Task -> Plan -> Schedule -> Execution
```

你可以用 Chrona 捕获一个粗略意图，把它变成可编辑的计划图，放入日程，用 AI 或人工 checkpoint 执行，并在之后回看发生过什么。

## 为什么需要 Chrona

AI chat 很快，但工作状态容易消失在聊天记录里。Chrona 把状态显式保存下来：

| 如果你需要... | Chrona 提供... |
| --- | --- |
| 保存真实工作，而不是保存 prompt | 带优先级、状态、标签、依赖、日程信息和已接受结果的持久任务 |
| 把模糊意图拆成步骤 | 可审查、可 patch、可接受、可重新执行的 AI 计划图 |
| 让时间和执行保持连接 | 日程块、冲突、建议、等待状态和 inbox 审批队列 |
| 让 AI 执行但不失控 | 作用域受限的 runtime refs、checkpoint、审批、工具轨迹、失败和持久化输出 |

## 快速开始

Chrona 目前是 Bun-only 项目。仓库开发和生产 server 都使用 Bun 作为运行时；当前不支持 npm package 安装。

### 从源码运行

如果你想开发 Chrona 或查看代码，选择这条路径。

```bash
git clone https://github.com/saya-ashen/Chrona.git
cd Chrona
bun install
bun run dev
```

打开 `http://localhost:3101`。`bun run dev` 会启动 Bun/Hono API server 和 Vite Web 应用。

### 使用 Docker 运行

如果你想启动容器化的本地 server，选择这条路径。

```bash
docker build -t chrona .
docker run --rm -p 3101:3101 -v chrona-data:/data chrona
```

容器会把 SQLite 数据保存到 `/data/chrona.db`。如果需要跨重启保持稳定认证，请显式设置 `API_KEY`。

## 首次运行

1. 打开 `http://localhost:3101`。
2. 进入 `Settings -> AI Clients`。
3. 添加 `llm`、`hermes` 或 `debug` client。
4. 将 client 绑定到 `generate_plan`、`suggest`、`chat`、`dispatch_task` 等功能。
5. 创建任务，生成计划，审查并接受计划，然后从任务工作区或 Work 页面开始执行。

数据目录、AI client 细节和排障说明见[完整快速开始](./docs/zh/quick-start.md)。

## 你可以做什么

### 捕获持久任务

创建、更新、完成、重开、删除、打标签、设置优先级、估时、关联、排期，并接受真实工作结果。

### 生成可编辑计划

把粗略任务变成结构化计划蓝图。已接受的计划会变成持久化 task plan layer 和 graph node，而不是一次性的 assistant 文本。

### 执行图结构工作

用 `task`、`checkpoint`、`condition`、`wait` 节点运行计划图。节点可以是 manual、assisted 或 automatic，也可以分配给 user、AI 或 system executor。

### 保持 AI 执行可观测

AI worker 只接收安全的 runtime refs，不直接接触内部数据库 ID。它们通过 `chrona.task.complete`、`chrona.condition.select`、`chrona.node.block`、`chrona.node.fail`、`chrona.wait.complete` 等 Chrona 命令汇报进度。

<p align="center">
  <img src="docs/assets/NodeDetail.png" width="80%" alt="查看 Chrona 执行节点的状态、详情和活动记录" />
</p>

### 管理时间和审批队列

使用 schedule views、AI insights、冲突建议、日程提案、waiting runs、failed runs、cancelled runs 和 inbox approvals 保持工作流推进。

### 带着上下文恢复工作

通过 Work 页面、任务工作区、memory console、assistant surfaces、conversation history、tool traces 和持久化输出理解并继续长周期工作。

## 架构

Chrona 是运行在 Bun 上的 Vite + Hono monorepo，使用 SQLite 持久化。

```text
React SPA
  -> Hono API server
  -> Chrona engine
      -> task / plan / schedule / projection modules
      -> graph-runtime execution state
      -> Prisma + SQLite persistence
      -> AI clients and provider adapters
```

| 区域 | 路径 |
| --- | --- |
| Web app | `apps/web/` |
| API server | `apps/server/` |
| CLI 和 binary entrypoints | `packages/cli/` |
| 共享 schema 和 runtime contracts | `packages/contracts/` |
| 数据库层 | `packages/db/` |
| 产品引擎 | `packages/engine/` |
| 计划图 runtime | `packages/graph-runtime/` |
| Provider adapters | `packages/providers/` |

更多设计说明见[架构指南](./docs/architecture.md)、[数据模型](./docs/data-model.md)和[后端执行流程](./docs/backend-execution-flow.md)。

## 配置

如果需要本地覆盖配置，复制 `.env.example`。

| 变量 | 用途 | 默认值 / 说明 |
| --- | --- | --- |
| `DATABASE_URL` | SQLite database URL | 源码默认：`file:./prisma/dev.db`；Docker：`file:/data/chrona.db`；CLI：平台数据目录 |
| `HOST` | API server bind host | 默认只绑定本机 `127.0.0.1` |
| `PORT` | API server port | `3101` |
| `API_KEY` | `/api/*` routes 的可选 bearer token | Docker 未设置时会自动生成 |
| `CHRONA_WEB_DIST` | 静态服务使用的 Web build 目录 | `apps/web/dist` |
| `ALLOWED_ORIGINS` | 逗号分隔的 CORS allowlist | 本地开发可省略 |
| `VITE_API_BASE_URL` | 前端 API base URL override | Web 和 API 分离部署时使用 |

AI clients 在 Web 应用的 `Settings -> AI Clients` 配置。当前支持 `llm`、`hermes`、`debug`：`llm` 用于 OpenAI/OpenRouter 兼容 API，`hermes` 用于 Hermes-backed agent execution，`debug` 用于本地开发和测试流程。

## 开发

仓库开发需要 Bun `>=1.3.11`。

```bash
bun install
bun run dev              # 完整开发栈
bun run typecheck        # TypeScript
bun run lint             # ESLint
bun run test             # Vitest
bun run test:bun         # Bun-native tests
bun run test:api         # API tests
bun run test:e2e         # Playwright E2E tests
```

较大变更前，也建议运行：

```bash
bun run check:ui-foundation
bun run check:boundaries
bun run analyze
```

开发环境、代码风格、边界规则、schema-first contract 规则和测试要求见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 文档

| 主题 | 文档 |
| --- | --- |
| 文档索引 | [docs/README.md](./docs/README.md) |
| 快速开始 | [English](./docs/en/quick-start.md) / [中文](./docs/zh/quick-start.md) |
| 架构 | [docs/architecture.md](./docs/architecture.md) |
| API reference | [docs/api-reference.md](./docs/api-reference.md) |
| 数据模型 | [docs/data-model.md](./docs/data-model.md) |
| 后端执行流程 | [docs/backend-execution-flow.md](./docs/backend-execution-flow.md) |
| Provider boundary | [docs/provider-boundary.md](./docs/provider-boundary.md) |
| Package boundaries | [docs/package-boundaries.md](./docs/package-boundaries.md) |
| 路线图 | [English](./docs/en/roadmap.md) / [中文](./docs/zh/roadmap.md) |

## 项目状态

Chrona 正在快速迭代中。核心的任务、计划、日程、执行和 AI-client 流程已经存在，但 API、runtime contracts、打包方式和部署路径在稳定版本前仍可能变化。当前只支持 Bun 运行时。

## 贡献

欢迎贡献。请从 [CONTRIBUTING.md](./CONTRIBUTING.md) 开始，运行相关检查；修改任务、日程、执行或导航流程时，请用测试覆盖行为。

## License

MIT
