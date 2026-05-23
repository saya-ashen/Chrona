# Chrona 快速开始

本指南包含两种路径：

1. 使用发布包 CLI：安装 `@chrona-org/cli`，然后运行 `chrona start`。
2. 从仓库开发：使用 Bun 和 workspace scripts。

## 路径 A：发布包 CLI

环境要求：

- Node.js 20 或更新版本
- npm 用于安装发布包

```bash
node --version
npm --version
npm install -g @chrona-org/cli
chrona start
```

`chrona start` 会启动本地 Chrona server，通常位于 `http://localhost:3101`，Web 应用也从同一地址提供服务。

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
3. 添加 AI client。
4. 将它绑定到需要的功能，例如 `generate_plan`、`suggest`、`chat`、`dispatch_task`。
5. 创建任务。
6. 生成计划。
7. 审查并接受计划。
8. 在任务工作区或 Work 页面启动执行。

## AI clients

Chrona 将 AI clients 与 feature bindings 存在数据库中。常见 client 类型包括：

- `llm`：OpenAI/OpenRouter 兼容模型调用，用于轻量 AI 功能。
- `hermes`：配置 Hermes bridge/provider 后，用于 Hermes-backed agent execution。

Feature binding 决定哪个 client 处理哪个能力。常见功能包括 `suggest`、`generate_plan`、`conflicts`、`timeslots`、`chat`、`dispatch_task`。

## Work 页面基础

Work 页面是单个任务的主要执行界面，包含：

- 最新结果
- 已生成/已接受的计划图
- 围绕 plan run 与 runtime event 组织的执行记录
- 任务信息和排期状态
- 对话与命令输入上下文
- checkpoint、输入、审批、阻塞、失败恢复动作

## 排障

- 如果 server 无法访问，确认进程监听在 `3101`，且端口未被其他服务占用。
- 如果 AI 功能没有反应，检查 Settings / AI Clients 中是否有启用的 client 和 feature binding。
- 如果执行暂停，在 Inbox 和 Work 页面查看等待输入、审批、阻塞或失败状态。
- 本地开发时，如果 schema 或依赖变化，运行 `bun run setup`。在 NixOS 上，Prisma 可能需要自定义 engine 配置或设置 `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1`，因为上游可能缺少 `linux-nixos` engine target 的 checksum 文件。
