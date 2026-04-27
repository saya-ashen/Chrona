# Chrona 快速开始

## Chrona 是什么

Chrona 是一个 AI 原生任务控制台，核心由两个循环组成：

- **排期** — 将模糊意图转化为具体时间块和结构化任务计划
- **执行** — 让 AI 智能体按计划推进任务，并持续更新计划

## 环境要求

- **Node.js >= 20** — 唯一运行时依赖
- 无需 Bun、构建工具或 Docker

## 安装

```bash
npm install -g @chrona-org/cli
```

## 启动

```bash
chrona start
```

首次运行会自动完成所有初始化：
- 创建 `~/.local/share/chrona/`（数据目录）
- 创建 `~/.config/chrona/.env`（配置文件，基于打包的模板）
- 创建 SQLite 数据库并执行 schema 迁移
- 在浏览器中打开 `http://localhost:3101`

Web 应用完全在本地运行 — 无需云端账号。

### 数据目录

| 平台 | 数据 | 配置 |
|------|------|------|
| Linux | `~/.local/share/chrona/` | `~/.config/chrona/` |
| macOS | `~/Library/Application Support/chrona/` | `~/Library/Preferences/chrona/` |
| Windows | `%APPDATA%/chrona/` | `%APPDATA%/chrona/` |

可通过环境变量覆盖：`CHRONA_DATA_DIR`、`CHRONA_CONFIG_DIR`。

## 配置 AI 后端

在 Web 应用的 **设置 > AI 客户端** 页面中添加和配置 AI 后端。

支持两种后端类型：

### LLM（OpenRouter 兼容接口）

兼容所有 OpenRouter 兼容的 API。通过 Web UI 配置 — 添加 LLM 客户端，填写 API key 和模型名称。

### OpenClaw 网关

在 Web UI 中添加 OpenClaw 客户端，填写网关 URL 和 token。配置完成后可在设置页面测试连接。

## CLI 用法

`chrona` 命令同时也是一个 CLI 客户端，用于操作本地 API：

```bash
chrona task list                          # 列出任务
chrona task create --title "研究 X"       # 创建任务
chrona task show <id>                     # 查看任务详情
chrona run start <task-id>               # 启动智能体运行
chrona schedule list                     # 列出已排期任务
chrona ai suggest --title "想法"         # AI 任务建议
```

所有命令都支持 `--base-url` 参数，可指向其他 API 服务器。

## 产品流程

### 1. 创建与排期

在 Web 应用中创建任务，或通过 CLI 创建。在排期页面的日历视图中将任务拖放到时间段。AI 功能支持自动补全、计划生成和时间建议。

### 2. 配置执行

每个任务可分配运行时适配器（如 `openclaw`）、AI 模型和执行提示词。任务工作区提供可视化的计划图，可编辑、重排并物化为子任务。

### 3. 运行与观察

在任务上启动智能体运行。在工作视图中查看实时对话、工具调用和审批。智能体可在运行中途请求输入或审批。执行进度会自动更新计划。

## 服务器选项

```bash
chrona start                     # 默认端口 3101
PORT=3100 chrona start           # 自定义端口
HOST=0.0.0.0 chrona start        # 绑定所有网络接口
```

生产模式下，服务器在同一端口上同时托管 API 和静态 SPA。

## 下一步阅读

- [路线图](./roadmap.md) — 产品规划
- [架构设计](../architecture.md) — CQRS + 事件溯源设计
- [API 参考](../api-reference.md) — REST API 文档
