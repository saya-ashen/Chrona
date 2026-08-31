# Chrona 快速开始

本指南包含两种路径：

1. 从 GitHub 下载发行版，然后运行 `chrona start`。
2. 从仓库开发：使用 Bun 和 workspace scripts。

## 路径 A：发行版

如果你只想运行 Chrona，不需要克隆仓库，选择这条路径。

1. 打开 [最新 GitHub Release](https://github.com/saya-ashen/Chrona/releases/latest)。
2. 下载对应平台的压缩包：

| 平台 | 文件 |
| --- | --- |
| Linux x64 | `chrona-linux-x64.tar.gz` |
| Linux ARM64 | `chrona-linux-arm64.tar.gz` |
| macOS Apple Silicon | `chrona-darwin-arm64.tar.gz` |
| Windows x64 | `chrona-windows-x64.tar.gz` |
3. 解压并启动 Chrona：

```bash
tar -xzf chrona-linux-x64.tar.gz
cd chrona-linux-x64
./chrona start
```

Windows：

```powershell
tar -xzf chrona-windows-x64.tar.gz
cd chrona-windows-x64
.\Chrona.exe start
```

发行版命令会启动本地 Chrona server，通常位于 `http://localhost:3101`，Web 应用也从同一地址提供服务。

Chrona 会把数据保存到平台默认应用目录。需要时可以覆盖：

```bash
CHRONA_DATA_DIR=/custom/path/data chrona start
CHRONA_CONFIG_DIR=/custom/path/config chrona start
```

## 路径 B：仓库开发

环境要求：

- Bun 1.3.x 或更新版本
- Git

```bash
git clone https://github.com/saya-ashen/Chrona.git
cd Chrona
bun install
bun run dev
```

常用仓库命令：

```bash
bun run server:start  # API + 静态 Web 应用 server
bun run dev:web       # 仅 Vite Web dev server
bun run typecheck
bun run lint
bun run test
bun run test:bun
bun run test:api
```

## 首次运行检查清单

1. 打开 `http://localhost:3101`。
2. 打开 Settings / AI Clients。
3. 添加默认的 `OMP` AI client，并先运行可用性检查。OMP 是首个稳定版中唯一的 Tier-1 首次使用路径。
4. 将 OMP 绑定到 `task.plan`；需要时可另配 `Claude Code` 或 `Codex` 负责 `task.execution`。任务选择的执行 client 不会替代独立的 Plan provider。
5. 创建任务，并补充足够的执行上下文。
6. 把任务放入日程。
7. 在任务工作区生成计划。
8. 审查或编辑计划图，然后接受计划。
9. 从任务工作区开始执行，或在配置自动执行后让 Chrona 推进到期任务。
10. 在任务工作区或 Dashboard 查看进度、阻塞、审批和输出。

## Providers 和 AI clients

Chrona 将 AI clients 与 feature bindings 存在数据库中。Chrona 当前没有内置模型 provider；使用 AI 功能前，需要先配置外部 provider client。

- `omp`：Tier-1 / 稳定。负责文档中的首次使用路径、`task.plan`、`task.execution`、Goal review 与结果整理。
- `claude_code`：Beta。当前作为 `task.execution` client 使用；Plan 仍由 `task.plan` 绑定的 provider 生成。
- `codex`：Beta。当前作为 `task.execution` client 使用，要求 OpenAI Responses 兼容上游；Plan 仍由 `task.plan` 绑定的 provider 生成。
- `hermes`：实现仍保留，但在生产 Settings 中隐藏，等待配置与一致性流程通过发布认证。

Feature binding 决定哪个 client 处理哪个能力。产品功能包括 `task.plan`、`task.execution`、`dashboard.brief`；`suggest`、`generate_plan`、`conflicts`、`timeslots`、`chat`、`dispatch_task` 等较底层 feature slot 仍可在需要时使用。

### Claude Code

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

### Codex

进入 `Settings -> AI Clients -> Add Client -> Codex`。

常用字段：

| 字段 | 用途 | 默认 / 说明 |
| --- | --- | --- |
| Model | 通过 provider config 传给 Codex 的模型 | 可选 |
| API key | OpenAI/Codex API key | 可选；也会作为 `CODEX_API_KEY` 和 `OPENAI_API_KEY` 传给 provider 进程 |
| Base URL | OpenAI Responses 兼容 gateway URL | 可选 |
| Config directory | Codex home directory | 可选；留空表示使用默认用户级 `CODEX_HOME`（`~/.codex`） |
| Working directory | 本次运行的文件系统作用域 | 可选；默认使用 Chrona 进程工作目录 |
| MCP base URL | Chrona `/api/mcp` server URL | 默认使用当前 Chrona server |
| MCP bearer token | Chrona MCP 请求使用的 bearer token | 通常留空；启用 API auth 时使用 `CHRONA_API_KEY` 或 `CHRONA_MCP_BEARER_TOKEN` |
| Timeout | provider run 最大时长 | 可选 |

## 任务工作区执行基础

任务工作区是单个任务的主要执行界面，包含：

- 最新结果
- 已生成/已接受的计划图
- 围绕 plan run 与 runtime event 组织的执行记录
- 任务信息和排期状态
- 对话与 command center 上下文
- checkpoint、输入、审批、阻塞、失败恢复动作

## 排障

- 如果 server 无法访问，确认进程监听在 `3101`，且端口未被其他服务占用。
- 如果 AI 功能没有反应，检查 Settings / AI Clients 中是否有启用的 client 和 feature binding。
- 如果 provider 配置失败，检查对应 AI client 是否启用、是否绑定到当前功能，以及 auth/config directory 设置是否有效。
- 如果执行暂停，在任务工作区或 Dashboard 查看等待输入、审批、阻塞或失败状态。
- 本地开发时，如果 schema 或依赖变化，运行 `bun run setup`。在 NixOS 上，Prisma 可能需要自定义 engine 配置或设置 `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1`，因为上游可能缺少 `linux-nixos` engine target 的 checksum 文件。
