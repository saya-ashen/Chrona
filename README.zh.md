[English](./README.md) | 中文

<p align="center">
  <img src="apps/web/public/favicon.png" width="80" alt="Chrona logo" />
</p>
<h1 align="center">Chrona</h1>
<p align="center">
  <a href="https://github.com/saya-ashen/Chrona/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/saya-ashen/Chrona/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/saya-ashen/Chrona/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/saya-ashen/Chrona" /></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
  <a href="./package.json"><img alt="Bun >= 1.3.11" src="https://img.shields.io/badge/bun-%3E%3D1.3.11-black" /></a>
</p>

## Chrona 是什么

聊天里随时能找的个人管家，网页上可掌控的事务中心，能持续办事的后台 Agent 服务。交代一次，记得住；能做的事情主动推进；有重要变化及时告诉你；回来查看时，清楚发生了什么、成果在哪里、还有什么没解决。

交代的事情统一称为**事务**：可以是一次性请求，也可以持续照看。简单问题可以直接回答，不必创建事务。Agent 根据上下文选择处理方式，不按固定关键词菜单分派；选择可见、可纠正。

```text
QQ 私聊 / 网页 → 接待 → 事务 → Pi Agent → 成果 / 通知
                └ 直接回答      ↑             ↓
                         来源 / 定时检查      QQ / 网页
```

Chrona 负责状态、调度、权限与投递。Pi 通过受限工具办事；模型文字本身不会改变状态。

## 页面

- **今日**：待决定、重要变化、成果与临近跟进。
- **事务**：等你处理、进行中、照看中、已暂停、已结束的事。
- **事务详情**：背景、现状、处理方式、时间线、照看节奏与操作。
- **成果**：可阅读正文、版本、来源、局限与反馈。
- **设置**：聊天绑定、通知、授权、偏好、来源、工具与运行状况。

## 自主权与通知

确定性策略决定 `auto`（直接做）、`notify_after`（做完告知）、`preapproved`（按授权执行）、`ask`（先问）、`never`（交还用户）。只读检索和内部记录通常直接做；设置照看和启用面板做完告知。敏感外部动作需要批准；修改凭据留给用户。批准不会让尚未实现的能力变得可用。外部文本不能授予权限。

主动通知经过 `now` / `digest` / `web` 打扰预算。默认每天最多五条立即推送，23:00–08:00 为安静时段（紧急通知除外），有内容才发日报。超额立即通知合并到日报，可在设置中调整预算。

## 快速开始

需要 **Bun ≥ 1.3.11** 和兼容的 **Pi CLI**；为运行 Chrona 的用户配置好模型访问。Pi 必须支持[运行器](packages/integrations/src/steward/pi-agent-runner.ts)使用的参数。网页检索还需要显式配置网页扩展路径。

在仓库根目录操作，选择全新的空数据目录：

```bash
bun install
export CHRONA_DATA_DIR="$PWD/.data/steward-fresh"
export DATABASE_URL="file:$CHRONA_DATA_DIR/chrona.db"
export CHRONA_STEWARD_AGENT=pi
bun run dev
```

打开 `http://localhost:3100`；API 默认在 `http://127.0.0.1:3101`。启动会初始化数据库和 `ws_default` 工作区。源码开发需要显式指定 `DATABASE_URL`：仅设置数据目录不会改变其数据库位置。不要复用重构前的数据库。

只在可信开发网络使用：开发脚本将 Vite 绑定到所有网卡，即使 API 默认只监听回环地址。这不是生产环境对外开放方案。备份与健康检查见[运维说明](docs/zh/operations.md)。

## 配置

在服务进程环境中设置变量。除注明默认值外，均可不设置。

| 变量 | 用途 / 默认值 |
| --- | --- |
| `DATABASE_URL` | SQLite URL；源码服务默认 `file:./prisma/dev.db` |
| `CHRONA_DATA_DIR` | 打包 CLI 数据根目录、QQ 状态目录的后备位置；建议显式设置 |
| `HOST`, `PORT` | API 监听地址与端口：`127.0.0.1`、`3101` |
| `API_KEY` | API 认证；对非回环网络开放前必须配置 |
| `ALLOWED_ORIGINS` | 逗号分隔的额外浏览器来源；默认允许同源 |
| `CHRONA_WEB_PORT` | 开发网页端口：`3100` |
| `VITE_API_BASE_URL` | 开发代理目标：`http://127.0.0.1:3101` |
| `CHRONA_SERVER_WATCH` | 设为 `false` 关闭开发服务自动重启 |
| `CHRONA_WEB_DIST` | 覆盖构建后的网页资源目录 |
| `CHRONA_CONFIG_FILE` | 可选运行时 JSON 配置路径；显式环境变量优先 |
| `CHRONA_MIGRATIONS_DIR` | 覆盖迁移目录；源码启动默认使用 `prisma/migrations` |
| `CHRONA_STEWARD_AGENT` | 设为 `pi` 启用接待与事务 Agent；否则关闭 |
| `CHRONA_STEWARD_PI_COMMAND` | Pi 可执行文件路径或名称，默认 `pi`，不是 shell 命令 |
| `CHRONA_STEWARD_PI_MODEL` | 可选，传给 Pi 的模型 |
| `CHRONA_STEWARD_PI_AGENT_EXTENSION` | 覆盖 Chrona 工具扩展路径；自动发现仓库内副本 |
| `CHRONA_STEWARD_PI_WEB_EXTENSION` | 兼容网页扩展（如 pi-web-access）的绝对路径；不设置则无网页工具 |
| `CHRONA_STEWARD_ASSESSOR` | `pi` 表示用 Pi 评估来源；否则使用确定性规则 |
| `CHRONA_STEWARD_TICK_SECONDS` | 后台检查间隔：`60` 秒 |
| `CHRONA_STEWARD_CHINO_DASHBOARD_URL` | 启用 Chino 服务健康来源适配器 |
| `CHRONA_PUBLIC_URL` | 通知链接使用的 HTTP(S) origin；不可含路径、查询或凭据 |
| `CHRONA_QQ_APP_ID` | 独立 QQ Bot 的应用 ID |
| `CHRONA_QQ_SECRET_FILE` | 服务用户拥有的私有应用密钥文件路径 |
| `CHRONA_QQ_STATE_DIR` | QQ 状态目录；默认回退到 `CHRONA_DATA_DIR/qq-bot/<appId>` |
| `CHRONA_STEWARD_SANDBOX_BWRAP` | 可选沙箱可执行文件路径；默认不能执行脚本 |

存在危险覆盖项 `CHRONA_UNSAFE_PUBLIC_BIND` 和 `CHRONA_UNSAFE_CORS`，应保持未设置。不要在隔离测试之外启用 `CHRONA_E2E_TEST_ROUTES`。

## QQ Bot 配置

使用独立的 QQ 官方 Bot，并在平台为你的账号开放私聊访问。在服务与 CLI 的同一环境中配置应用 ID、密钥文件路径、数据或状态目录。密钥必须是当前用户拥有的私有普通文件（例如权限 `0600`），不要贴进聊天或提交到仓库。

启动 Chrona 后生成一次性绑定码：

```bash
chrona qq bind-code --workspace ws_default
```

源码环境未安装 `chrona` 可执行文件时：

```bash
bun run packages/cli/src/index.ts qq bind-code --workspace ws_default
```

在 Bot 私聊中发送 `绑定 <码>`。默认十分钟过期。只有绑定的主人能使用，之后正常交流不需要命令前缀。检查设置 → 聊天，以及[运维说明](docs/zh/operations.md)中的 QQ 状态文件。QQ 平台投递限制仍然适用。

## 隐私与安全

本地优先：事务与成果保存在本机 SQLite，但**不等于完全离线**。Pi 模型调用会把有限上下文发送给所配置的模型服务；网页搜索和抓取会访问外部服务；QQ 聊天与通知经过 QQ；Chino 检查会访问配置的服务。数据库备份与 QQ 状态都应作为私人数据保护。

Agent 运行器关闭内置工具，只加载显式扩展。Chrona 的 API、数据库、QQ 配置会从子进程环境中过滤；Pi 仍需自己的模型凭据。服务环境中不要放无关密钥。检查来源、成果与审批，不要把模型输出直接视为已核实事实。

## 项目状态

重构中的单一 owner 应用，不支持多人协作，也不兼容重构前的数据库。来源适配器为 **Chino 服务健康**和**本地测试**（后者是隔离测试入口，不是生产信息源）。

脚本起初是草稿，需要按版本批准。脚本执行**默认不可用**。当前代码包含可选 bubblewrap 运行器，需要配置可执行文件并通过隔离探测；目前挂载假定存在 `/nix/store`。它不是普遍可用或经部署验证的沙箱。草稿或批准不代表脚本已经运行。

产品目标不代表所有目标能力均已交付。参阅[文档索引](docs/README.md)、[设计目标](docs/zh/steward-goals.md)、[架构](docs/zh/steward-rebuild.md)和[贡献指南](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)。
