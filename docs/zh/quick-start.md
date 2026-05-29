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
3. 添加 AI client。如果要进行本机 agent 执行，选择 `Hermes`。
4. 将它绑定到需要的功能，例如 `generate_plan`、`suggest`、`chat`、`dispatch_task`。
5. 创建任务，并补充足够的执行上下文。
6. 把任务放入日程。
7. 在任务工作区生成计划。
8. 审查或编辑计划图，然后接受计划。
9. 从任务工作区或 Work 页面开始执行，或在配置自动执行后让 Chrona 推进到期任务。
10. 在 Work、Inbox 或任务工作区查看进度、阻塞、审批和输出。

## Providers 和 AI clients

Chrona 将 AI clients 与 feature bindings 存在数据库中。Chrona 当前没有内置模型 provider；使用 AI 功能前，需要先配置外部 provider client。

- `hermes`：当前主要支持的执行 provider，用于 Hermes-backed agent execution。
- `debug`：确定性的本地测试/开发 provider。

Feature binding 决定哪个 client 处理哪个能力。常见功能包括 `suggest`、`generate_plan`、`conflicts`、`timeslots`、`chat`、`dispatch_task`。

### 本机 Hermes

当 Hermes gateway 和 Chrona 运行在同一台机器时，使用本机 Hermes。

1. 添加 `Hermes` client。
2. 保持 `Hermes 位置` 为 `本机 Hermes`。
3. 保持 `Base URL` 为 `http://127.0.0.1:8642`，除非你的 Hermes API server 使用其他端口。
4. 点击 `诊断 Hermes`，检查 CLI、plugin、plugin MCP URL、Hermes `.env`、API key、连通性和 capabilities。
5. 如果缺少配置，点击 `自动配置本机 Hermes`。Chrona 可以安装/更新 plugin、写入 plugin 配置，并向 `~/.hermes/.env` 写入 `API_SERVER_ENABLED=true` 和 `API_SERVER_KEY`。
6. 如果提示需要重启 Hermes，请重启。Chrona 可以请求执行 `hermes gateway restart`，但如果 Hermes 通过 service 或自定义命令运行，通常你自己重启会更清楚。

CLI 也提供同样的检查：

```bash
chrona hermes doctor
chrona hermes setup
chrona hermes setup --show-api-key
```

### 远程 Hermes

当 Hermes gateway 运行在另一台机器时，使用远程 Hermes。

1. 添加 `Hermes` client。
2. 将 `Hermes 位置` 设为 `远程 Hermes`。
3. 输入远程 base URL 和 API key。
4. 在远程机器上安装/启用 Chrona Hermes plugin，把 plugin MCP URL 指向当前 Chrona server，设置 `API_SERVER_ENABLED=true`，设置 `API_SERVER_KEY`，然后重启 Hermes。
5. 在 Chrona 中运行 `诊断 Hermes` 和 `测试可用性`。

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
- 如果 Hermes 诊断失败，先看每一项检查。本机模式可以自动修复 plugin/config/env 问题；远程模式会显示手动说明，因为 Chrona 不应该修改另一台机器。
- 如果执行暂停，在 Inbox 和 Work 页面查看等待输入、审批、阻塞或失败状态。
- 本地开发时，如果 schema 或依赖变化，运行 `bun run setup`。在 NixOS 上，Prisma 可能需要自定义 engine 配置或设置 `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1`，因为上游可能缺少 `linux-nixos` engine target 的 checksum 文件。
