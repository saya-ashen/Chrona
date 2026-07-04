[English](./README.md) | 中文

<p align="center">
  <img src="apps/web/public/favicon.png" width="80" alt="Chrona logo" />
</p>

<h1 align="center">Chrona</h1>

<p align="center">
  <strong>把日程上的工作变成可审查、可恢复、可追踪的 AI 执行图。</strong>
</p>

<p align="center">
  <a href="https://github.com/saya-ashen/Chrona/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/saya-ashen/Chrona/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
  <a href="./package.json"><img alt="Bun >= 1.3.11" src="https://img.shields.io/badge/bun-%3E%3D1.3.11-black" /></a>
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#核心工作流">工作流</a> ·
  <a href="#providers">Providers</a> ·
  <a href="#local-first-与安全模型">安全</a> ·
  <a href="#项目状态">状态</a> ·
  <a href="./docs/zh/quick-start.md">完整指南</a> ·
  <a href="./docs/en/architecture.md">架构</a> ·
  <a href="./CONTRIBUTING.md">贡献</a>
</p>

> [!WARNING]
> Chrona 正在快速迭代中。当前项目是 Bun-only，API 和 runtime contracts
> 仍可能变化，主要产品方向是
> schedule-first：围绕日程规划工作，并自动执行到期任务。

<p align="center">
  <img src="docs/assets/generated/task-workspace.png" width="85%" alt="Chrona task workspace showing an executable AI plan graph" />
  <br />
  <em>安排任务、审查生成计划、交给 AI provider 执行，并检查每个 checkpoint、分支、审批和输出。</em>
</p>

---

Chrona 是一个 local-first 的 AI
辅助工作空间。它帮助你捕获任务、生成可编辑计划、放入日程、手动或自动执行，并在之后回看发生过什么。

Chrona 把通常分散在不同工具中的四个循环连接起来：

```text
Task -> Plan -> Schedule -> Inspectable Execution
```

它适合那些不应该消失在聊天记录里的工作：周期性调研、发布准备、维护、跟进任务，以及需要状态、审批、恢复和持久化输出的
agent run。

## 项目状态

Chrona
当前可用于本地开发和产品探索，但还不是稳定软件。当前代码库已经具备任务、计划、日程、执行、Dashboard、Settings、外部日历和
AI-client 流程；接下来的重点是让“日程到自动执行”的闭环可靠到可以日常使用。

## 为什么需要 Chrona

日历告诉你应该发生什么。任务软件告诉你还有什么没做。AI chat
可以做事，但通常丢失日程、状态和责任链。Chrona
把这些循环合在一起，但不假装它们是同一种东西。

| 不只是...  | Chrona 额外提供...                                                      |
| ---------- | ----------------------------------------------------------------------- |
| 日历       | 可执行工作状态、依赖、估时、日程元数据和到期任务动作                    |
| 任务软件   | 可审查、可 patch、可接受、可重新执行、可追踪的 AI 计划图                |
| AI chat UI | 作用域受限的 runtime refs、checkpoint、审批、工具轨迹、失败和持久化输出 |

当日程上的工作需要可见执行生命周期，而不只是提醒或一次性 assistant 答案时，使用
Chrona。

## 快速开始

Chrona 目前是 Bun-only 项目。源码仓库使用 Bun 作为运行时；仓库开发当前不支持 npm
package 安装。

### 下载发行版

如果你只想运行 Chrona，不需要克隆仓库，选择这条路径。

1. 打开[最新 GitHub Release](https://github.com/saya-ashen/Chrona/releases/latest)。
2. 下载对应平台的压缩包：

| 平台                | 文件                         |
| ------------------- | ---------------------------- |
| Linux x64           | `chrona-linux-x64.tar.gz`    |
| Linux ARM64         | `chrona-linux-arm64.tar.gz`  |
| macOS Apple Silicon | `chrona-darwin-arm64.tar.gz` |
| Windows x64         | `chrona-windows-x64.tar.gz`  |

3. 解压并启动 Chrona：

```bash
tar -xzf chrona-linux-x64.tar.gz
cd chrona-linux-x64
./chrona start
```

Windows 使用打包的可执行文件：

```powershell
tar -xzf chrona-windows-x64.tar.gz
cd chrona-windows-x64
.\Chrona.exe start
```

server 启动后打开 `http://localhost:3101`。

### 从源码运行

如果你想开发 Chrona 或查看代码，选择这条路径。

```bash
git clone https://github.com/saya-ashen/Chrona.git
cd Chrona
bun install
bun run dev
```

打开 `http://localhost:3101`。`bun run dev` 会启动 Bun/Hono API server 和 Vite
Web 应用。

## 首次运行

你可以在不连接真实 provider 的情况下探索 Chrona：创建任务、安排日程、查看
Dashboard、打开任务工作区。AI 计划生成和 agent 执行需要配置 AI client。

完整执行闭环：

1. 打开 `http://localhost:3101`。
2. 进入 `Settings -> AI Clients`，添加 provider client。
3. 选择 `Claude Code` 或 `Codex`，用于真实的本机 agent 执行。
4. 将 client 绑定到 `task.plan`、`task.execution`、`dashboard.brief` 等功能。
5. 创建任务，补充足够的执行上下文，并把它放入日程。
6. 在任务工作区生成计划，审查或编辑生成的图结构，然后接受计划。
7. 从任务工作区手动开始执行，或在配置自动执行后让 Chrona 推进到期日程任务。
8. 在任务工作区或 Dashboard 中查看进度、阻塞、审批、工具活动和输出。

数据目录、AI client 细节和排障说明见[完整快速开始](./docs/zh/quick-start.md)。

## 核心工作流

1. **捕获工作** — 创建带优先级、估时、截止时间、依赖和日程信息的任务。
2. **生成计划** — 把粗略上下文变成结构化计划图。
3. **执行前审查** — 在计划变成可执行任务节点前，patch、接受或重新生成计划。
4. **带状态运行** — 手动、AI assisted 或在配置后自动执行
   `task`、`checkpoint`、`condition`、`wait` 节点。
5. **检查和恢复** —
   从工作区查看审批、工具活动、失败、阻塞、持久化输出和下一步动作。

<p align="center">
  <img src="docs/assets/generated/node-detail.png" width="80%" alt="查看 Chrona 执行节点的状态、详情和活动记录" />
  <br />
  <em>执行记录会留在任务上下文里，包括节点状态、工具活动和输出。</em>
</p>

## Providers

Chrona 把产品工作流和执行 provider 分开。你先把 provider 配置成 AI
client，再把这些 client 绑定到 Chrona 功能。

| Provider 类型 | 状态              | 用途                                                                 | 备注                                                       |
| ------------- | ----------------- | -------------------------------------------------------------------- | ---------------------------------------------------------- |
| `claude_code` | 主要支持 provider | 通过作用域受限的 MCP control tools 进行 Claude Code 计划生成和任务执行 | 未配置目录时默认使用用户级 Claude Code config              |
| `codex`       | 主要支持 provider | 通过作用域受限的 MCP control tools 进行 Codex 计划生成和任务执行       | 未配置目录时默认使用用户级 `CODEX_HOME`（`~/.codex`）      |
| `hermes`      | 待更新 adapter   | 面向本机或远程 agent 执行的 Hermes gateway 集成                       | 适合已有 Hermes 配置；provider 文档/配置流程还没有更新      |

### Claude Code 配置

进入 `Settings -> AI Clients -> Add Client -> Claude Code`。

常用字段：

| 字段 | 用途 | 默认 / 说明 |
| --- | --- | --- |
| Model | 传给 Claude Code 的模型 | 留空则使用 Chrona provider 默认值 |
| API key | Claude Code 使用的 Anthropic API key | 可选；留空则使用用户已有 Claude Code auth/config |
| Config directory | Claude Code 配置/状态目录 | 可选；留空表示使用 Claude Code 默认用户级配置 |
| Working directory | 本次运行的文件系统作用域 | 可选；默认使用 Chrona 进程工作目录 |
| MCP base URL | Chrona `/api/mcp` server URL | 默认使用当前 Chrona server |
| MCP bearer token | Chrona MCP 请求使用的 bearer token | 通常留空；启用 API auth 时使用 `CHRONA_API_KEY` 或 `CHRONA_MCP_BEARER_TOKEN` |
| Timeout | provider run 最大时长 | 可选 |

### Codex 配置

进入 `Settings -> AI Clients -> Add Client -> Codex`。

常用字段：

| 字段 | 用途 | 默认 / 说明 |
| --- | --- | --- |
| Model | 通过 provider config 传给 Codex 的模型 | 可选 |
| API key | OpenAI/Codex API key | 可选；也会作为 `CODEX_API_KEY` 和 `OPENAI_API_KEY` 传给 provider 进程 |
| Base URL | OpenAI-compatible gateway URL | 可选 |
| Config directory | Codex home directory | 可选；留空表示使用默认用户级 `CODEX_HOME`（`~/.codex`） |
| Working directory | 本次运行的文件系统作用域 | 可选；默认使用 Chrona 进程工作目录 |
| MCP base URL | Chrona `/api/mcp` server URL | 默认使用当前 Chrona server |
| MCP bearer token | Chrona MCP 请求使用的 bearer token | 通常留空；启用 API auth 时使用 `CHRONA_API_KEY` 或 `CHRONA_MCP_BEARER_TOKEN` |
| Timeout | provider run 最大时长 | 可选 |

Provider 排障说明见[完整快速开始](./docs/zh/quick-start.md)。

## Local-first 与安全模型

Chrona 默认从本机和显式配置开始。

| 领域           | 默认 / 行为                                                                                |
| -------------- | ------------------------------------------------------------------------------------------ |
| 存储           | SQLite。源码开发默认 `file:./prisma/dev.db`；发行版默认使用平台数据目录，除非显式覆盖。    |
| 网络绑定       | `HOST` 默认绑定本机 `127.0.0.1`。                                                          |
| API auth       | 本地开发可不设置 `API_KEY`；把 `/api/*` 暴露到 localhost 之外前应设置。                    |
| CORS           | Web 和 API 分离部署时，可用 `ALLOWED_ORIGINS` 限制浏览器来源。                             |
| Provider scope | AI worker 接收作用域受限的 runtime refs 和 Chrona control tools，不直接接触内部数据库 ID。 |
| 自动执行       | 需要显式配置 provider/feature，并通过任务工作区状态、审批、阻塞和 run records 保持可见。   |

## 功能

- **真实日程** — 任务带优先级、估时、截止时间、依赖和日程元数据。
- **可编辑计划图** — 生成的计划可审查、可 patch、可接受、可重新执行，并
  materialize 为类型化图节点。
- **图结构执行** — `task`、`checkpoint`、`condition`、`wait` 节点支持
  manual、assisted 和 automatic work。
- **到期任务恢复** — Schedule views、AI insights、冲突建议、日程提案、waiting
  runs、failed runs、cancelled runs 和 approvals 让下一步动作保持可见。
- **可观测 AI 工作** — Provider runs 通过
  `chrona_node_complete`、`chrona_condition_select`、`chrona_node_block`、`chrona_node_fail`、`chrona_wait_complete`
  等工具汇报进度。Conversation history、tool traces
  和持久化输出会留在任务上下文里。

## 路线图

这里是成熟度摘要。完整内容以[路线图](./docs/zh/roadmap.md)为准。

| 领域            | 可用性 | 成熟度         | 备注                                                                                    |
| --------------- | ------ | -------------- | --------------------------------------------------------------------------------------- |
| 任务基础        | 已可用 | 可用           | 创建、更新、删除、完成/重开、状态、优先级、标签、依赖、父子任务和投影。                 |
| 日程界面        | 已可用 | 可用，继续打磨 | Timeline/task views、AI insights、冲突、日程提案、任务创建和配置界面。                  |
| 计划生成        | 已可用 | 实验性         | 流式 AI 计划生成、持久化、审查/编辑/接受流程，以及 materialize 为图节点。               |
| 执行 runtime    | 已可用 | 实验性         | 可执行的 `task`、`checkpoint`、`condition`、`wait` 节点，AI-visible refs 和持久化状态。 |
| 审查闭环        | 已可用 | 实验性         | Dashboard 和任务工作区中的 pending approvals、日程提案、等待输入、失败/取消 run 入口。  |
| 外部日历        | 已可用 | 早期           | 只读日历订阅、导入忙碌事件、来源管理、刷新状态和日程上下文。                            |
| 可靠自动执行    | 进行中 | 尚不稳定       | 仅在配置允许且安全时启动到期日程任务，并在执行阻塞或失败时提供清晰恢复路径。            |
| 更多 providers  | 进行中 | 实验性         | 在保持 provider 边界清晰的前提下接入更多执行/provider integrations。                    |
| 多 session 执行 | 已计划 | 尚不可用       | 增加多 session 的隔离、复用、恢复和诊断能力。                                           |
| 生产可用性      | 已计划 | 未就绪         | 认证、备份/恢复、部署文档、迁移安全、可观测性和运维 runbooks。                          |

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

| 领域                                | 路径                      |
| ----------------------------------- | ------------------------- |
| Web app                             | `apps/web/`               |
| API server                          | `apps/server/`            |
| CLI 和 binary entrypoints           | `packages/cli/`           |
| Shared schemas 和 runtime contracts | `packages/contracts/`     |
| Database layer                      | `packages/db/`            |
| Product engine                      | `packages/engine/`        |
| Plan graph runtime                  | `packages/graph-runtime/` |
| Provider adapters                   | `packages/providers/`     |

更多设计说明见[架构指南（英文）](./docs/en/architecture.md)、[数据模型（英文）](./docs/en/data-model.md)和[后端执行流程（英文）](./docs/en/backend-execution-flow.md)。

## 配置

如果需要本地覆盖配置，复制 `.env.example`。

| 变量                | 用途                                       | 默认 / 说明                                                                |
| ------------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| `DATABASE_URL`      | SQLite database URL                        | 源码默认：`file:./prisma/dev.db`；发行版默认使用平台数据目录，除非显式覆盖 |
| `HOST`              | API server bind host                       | 默认本机 `127.0.0.1`                                                       |
| `PORT`              | API server port                            | `3101`                                                                     |
| `API_KEY`           | `/api/*` routes 的可选 bearer token        | 本地开发可省略                                                             |
| `CHRONA_WEB_DIST`   | Built web app directory for static serving | `apps/web/dist`                                                            |
| `ALLOWED_ORIGINS`   | Comma-separated CORS allowlist             | 本地开发可省略                                                             |
| `VITE_API_BASE_URL` | Frontend API base URL override             | Web 和 API 分离时使用                                                      |

AI clients 在 Web app 的 `Settings -> AI Clients` 下配置。Provider 类型和 Claude Code/Codex
配置方式见 [Providers](#providers)。

## FAQ

### 不配置 AI provider 可以使用 Chrona 吗？

可以。你可以在没有 AI provider 的情况下创建任务、安排日程、查看
Dashboard、使用任务工作区。真实 AI 计划生成和 agent 执行需要配置 AI
client。主要本机 agent 执行路径使用 Claude Code 或 Codex。

### Chrona 生产可用了吗？

还没有。Chrona 当前可用于本地开发和产品探索，但 runtime contracts、provider
行为和 auto-execution 流程仍在变化。

### Chrona 数据存在哪里？

源码开发默认 `file:./prisma/dev.db`。发行版默认使用平台数据目录，除非
`DATABASE_URL` 显式覆盖。

### 自动执行会静默运行吗？

不会。自动执行需要显式配置
provider/feature，并且会通过任务工作区状态、审批、阻塞、activity 和 run records
保持可见。

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

开发环境、代码风格、边界规则、schema-first contract 规则和测试要求见
[CONTRIBUTING.md](./CONTRIBUTING.md)。

## 文档

| 主题               | 文档                                                                     |
| ------------------ | ------------------------------------------------------------------------ |
| 文档索引           | [docs/README.md](./docs/README.md)                                       |
| 快速开始           | [English](./docs/en/quick-start.md) / [中文](./docs/zh/quick-start.md)   |
| 架构               | [docs/en/architecture.md](./docs/en/architecture.md)                     |
| API reference      | [docs/en/api-reference.md](./docs/en/api-reference.md)                   |
| 数据模型           | [docs/en/data-model.md](./docs/en/data-model.md)                         |
| 后端执行流程       | [docs/en/backend-execution-flow.md](./docs/en/backend-execution-flow.md) |
| Provider boundary  | [docs/en/provider-boundary.md](./docs/en/provider-boundary.md)           |
| Package boundaries | [docs/en/package-boundaries.md](./docs/en/package-boundaries.md)         |
| 路线图             | [English](./docs/en/roadmap.md) / [中文](./docs/zh/roadmap.md)           |
| Security           | [SECURITY.md](./SECURITY.md)                                             |
| Code of Conduct    | [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)                               |

## 贡献

欢迎贡献。请从 [CONTRIBUTING.md](./CONTRIBUTING.md)
开始，运行相关检查；修改任务、日程、执行或导航流程时，请用测试覆盖行为。

## License

MIT
