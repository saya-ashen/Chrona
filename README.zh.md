[English](README.md) | 中文

# Chrona

本地优先的个人管家：通过网页或 QQ 私聊交代事情，在持久的会话和应用中一起推进。

## 如何工作

**会话目录**位于 `<dataDir>/sessions/<id>/`。每个**应用内容区**位于 `<dataDir>/platform/content/<moduleId>/`；模块代码和数据分别位于 `<dataDir>/platform/store` 和 `<dataDir>/platform/data`。Provider（目前为 Pi）自行组织内容文件、局部编辑页面、研究并使用自己的工具。Chrona 提供持久调度、前后台排队、连接器凭据、审批和送达。模型文字不直接创建调度或发送消息，这些动作必须调用 Chrona 工具。

- **今日**：待批准、调度、最近活动。
- **会话**：对话与保存的工作。
- **应用**：内容区、页面、文件与模块能力。
- **设置**：通知、权限、偏好、连接器、Provider 与运行状况。

调度支持唤醒 Provider、不调用模型的固定提醒、确定性脚本任务。主动通知经过打扰预算、安静时段与汇总。外部文本不能授予权限。经 Chrona 代发邮件需要批准。

## 快速开始

需要 **Bun ≥ 1.3.11**、**git** 和固定版本的 **Pi CLI**，模型访问须配置在服务专用 profile 中。[Provider 适配器](packages/integrations/src/steward/pi-provider.ts) 使用 Pi RPC；默认精确固定 **0.85.0**，也可显式选择 **1.3.0**。完整备份还需要 GNU 兼容的 `tar`。

使用新数据目录，不要复用重构前数据库：

```bash
bun install
export CHRONA_DATA_DIR="$PWD/.data/steward-fresh"
export DATABASE_URL="file:$CHRONA_DATA_DIR/chrona.db"
export CHRONA_STEWARD_AGENT=pi
# 替换为已审查的服务专用可执行文件，不附带 shell 参数。
export CHRONA_STEWARD_PI_COMMAND=/opt/chrona/pi/bin/pi
export CHRONA_STEWARD_PI_VERSION=0.85.0
export CHRONA_STEWARD_PI_AGENT_DIR="$CHRONA_DATA_DIR/providers/pi"
install -d -m 700 "$CHRONA_STEWARD_PI_AGENT_DIR"
# 先用此可执行文件及 PI_CODING_AGENT_DIR 单独配置模型访问。
bun run dev
```

上面的 Pi 路径是示例，不是安装命令。须另行用 `PI_CODING_AGENT_DIR="$CHRONA_STEWARD_PI_AGENT_DIR"` 和选定的可执行文件准备模型访问。Chrona 不复制个人认证，不自动创建 profile。profile 须为应用内容区和会话目录外的绝对规范路径，仅服务用户可访问（Unix 权限 `0700`）。缺配置或版本不符时 Provider 不可用，不回退 PATH/个人 profile。升级已有安装前先看[运维说明](docs/zh/operations.md#确认-agent-真正可用)。

打开 `http://localhost:3100`，API 默认 `http://127.0.0.1:3101`。启动自动迁移并创建 `ws_default`。务必显式设置两个存储变量：源码服务的数据库默认 `file:./prisma/dev.db`，不会随 `CHRONA_DATA_DIR` 自动改变。开发 Vite 监听所有网卡，只用于可信开发网络，不是公开部署方案。

打包版本使用 `chrona start --no-open`，源码仅启动 API 使用 `bun run server:start`。

## 配置

在服务环境中设置，修改后重启：

| 变量 | 含义 |
| --- | --- |
| `DATABASE_URL` | SQLite URL；源码默认 `file:./prisma/dev.db` |
| `CHRONA_DATA_DIR` | 平台、会话和凭据根目录；服务与 CLI 都应显式设置 |
| `HOST`、`PORT` | API 监听，默认 `127.0.0.1`、`3101` |
| `API_KEY` | API 认证；非回环暴露前必须配置 |
| `ALLOWED_ORIGINS` | 逗号分隔的额外浏览器来源 |
| `CHRONA_STEWARD_AGENT` | `pi` 启用 Provider；否则关闭 |
| `CHRONA_STEWARD_PI_COMMAND` | 必填，已审查的服务专用可执行文件绝对路径；不回退 PATH，不附带 shell 参数 |
| `CHRONA_STEWARD_PI_VERSION` | 精确版本固定；默认 `0.85.0`，也支持显式选择 `1.3.0` |
| `CHRONA_STEWARD_PI_AGENT_DIR` | 已存在、私有、规范路径的 profile；默认 `<dataDir>/providers/pi`，不自动复制 |
| `CHRONA_STEWARD_PI_RESOURCES_FILE` | 可选私有规范路径 JSON 清单：审核过的技能/扩展入口文件及额外工具名；不安装、不自动发现 |
| `CHRONA_STEWARD_PI_MODEL` | 可选 Pi 模型选择 |
| `CHRONA_STEWARD_PI_WEB_EXTENSION` | 可选显式网页工具扩展路径 |
| `CHRONA_STEWARD_SANDBOX_BWRAP` | Provider 隔离与调度任务使用的 bubblewrap 可执行文件 |
| `CHRONA_STEWARD_TICK_SECONDS` | 后台 tick 周期，默认 `30` 秒 |
| `CHRONA_CHINO_DASHBOARD_URL` | Chino 服务健康来源 URL |
| `CHRONA_PUBLIC_URL` | 通知链接使用的 HTTP(S) origin |
| `CHRONA_QQ_APP_ID` | 专用 QQ Bot 应用 ID |
| `CHRONA_QQ_SECRET_FILE` | 服务用户持有的私有 app-secret 文件 |
| `CHRONA_QQ_STATE_DIR` | QQ 状态目录；默认 `<dataDir>/qq-bot/<appId>` |

没有 bubblewrap 时关闭 Pi 的 bash 工具，保留文件工具及显式配置的网页工具。启用后，Provider 的宿主挂载只读，指定应用内容区、会话目录和专用 Pi profile 可写，可联网；这不是阻止所有宿主读取的保密边界。Chrona 不重复提供 Provider 的网页和 shell 工具。独立的调度任务沙箱需通过隔离探测，目前假定 `/nix/store`，失败时不会退回宿主执行。

Pi 关闭资源自动发现及项目信任。可选的[受控资源清单](docs/zh/provider-runtime.md)通过 Pi 原生加载机制显式添加技能/扩展；原生 MCP 须明确固定 `1.3.0`。发送提示前检查命令资源。这不是完整工具清单，也不能证明包装器/扩展安全，仍须独立审查入口、扩展代码和服务 profile。健康检查验证启动配置与版本，不代表认证有效或模型已成功响应。

### 处理进度与执行端请求

会话/应用页显示安全的进度摘要与用量估算。Pi 的 `select/confirm/input/editor` 请求显示在全局待答复区，查看其他会话、应用或设置页时也能处理。请求须明确答复，只属于本次处理，受截止时间约束；中断/重启后不能复用。编辑器原文仅由当前存活 controller 临时提供，原文和自由文本答复不进入请求历史，也不填入聊天草稿。超长或含敏感内容的请求会拒绝，不让用户批准被隐藏的细节。Chrona 自己的审批仍单独生效。

停止本次处理会保留已保存内容/消息，阻止新 Chrona 动作，且本次不自动重试；不会撤回已经发生的外部效果，也不会取消未来安排。用量是执行端估算，区分本次增量与会话累计，缺失值不冒充零。见[行为与限制](docs/zh/provider-runtime.md)。

### 邮箱连接器

在 **设置 → 连接器** 填写地址、IMAP 主机/端口（TLS，默认 993）、文件夹（默认 INBOX）、密码或应用密码，并选择所属应用。SMTP 主机/端口可选，配置后可代发（默认 465，要求 TLS）。连接器只读同步邮件、入站去重并为应用保存材料。凭据保存在 `<dataDir>/secrets`，不作为 Provider 上下文提供。SMTP 代发需要用户批准。测试真实连接会访问邮件服务器；自动化测试使用假的适配器。

### QQ

配置上表专用 Bot 变量及私有密钥文件后，生成主人绑定码：

```bash
chrona qq bind-code --workspace ws_default
```

源码环境把 `chrona` 替换为 `bun run packages/cli/src/index.ts`。在 Bot 私聊发送 `绑定 <码>`，默认十分钟过期。QQ 平台送达限制和 Chrona 打扰预算仍然有效。

## 备份与安全

**必须备份数据目录，不能只备份 SQLite。** 停止服务后运行 `chrona backup /absolute/private/path/backup.db`，生成一致性数据库副本和 `backup.db.tar`，后者包含 `platform`（应用内容及模块代码/数据）、`sessions` 及 `secrets`。两个文件须一起保存并保护隐私，均未加密。停止状态下执行 `chrona restore /absolute/private/path/backup.db` 恢复两者；默认拒绝已有数据，明确替换才使用 `--force`。QQ 状态和 Provider profile（包括 `<dataDir>/providers/pi`）需另行归档，均不在上述 tar 中。恢复限制见[运维说明](docs/zh/operations.md)。

本地优先不等于离线：模型、网页、QQ 和邮件可能访问外部服务。保护备份、审核批准并验证模型结论。Provider 环境过滤 Chrona 凭据，但保留其自身模型访问配置。不兼容重构前数据库；目前只实现 Pi，设计文档中的其他 Provider 不代表已经可用。

[文档](docs/README.md) · [目标](docs/zh/steward-goals.md) · [架构](docs/zh/platform-v2.md) · [贡献](CONTRIBUTING.md)

## 许可

[MIT](LICENSE)。
