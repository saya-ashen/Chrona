# Chrona 运维说明

适用于重构后的单一 owner 版本。先读[快速开始与配置表](../../README.zh.md)。所有命令均在仓库根目录执行，或使用对应版本的打包 CLI；不要用旧版本可执行文件操作新库。

## 启动与数据位置

源码开发用 `bun run dev`，仅启动源码 API 用 `bun run server:start`。打包版本用 `chrona start --no-open`，默认监听 `127.0.0.1:3101`；`chrona start` 只在打包版本提供。

建议在启动、备份、恢复与诊断的同一环境中显式设置：

```bash
export CHRONA_DATA_DIR="$PWD/.data/steward-fresh"
export DATABASE_URL="file:$CHRONA_DATA_DIR/chrona.db"
export CHRONA_STEWARD_AGENT=pi
```

以上目录必须是新目录或已经属于本版本的数据目录。源码服务不根据 `CHRONA_DATA_DIR` 推导数据库，未设 `DATABASE_URL` 时默认使用 `file:./prisma/dev.db`。打包 CLI 的备份、恢复、诊断默认使用数据目录内的 `chrona.db`。显式设置两者可避免操作错库。

打包 CLI 数据目录未指定时：Linux 使用 `XDG_DATA_HOME/chrona`，否则 `~/.local/share/chrona`；macOS 使用 `~/Library/Application Support/chrona`；Windows 使用 `APPDATA/chrona`，否则用户目录下的 `AppData/Roaming/chrona`。

启动自动应用迁移、创建 `ws_default` 工作区并获取数据库运行锁。不要启动两个服务共享同一个数据库。

## 从空目录开始

迁移运行器拒绝重构前的数据库，也拒绝已应用迁移的校验和变化。这不是自动升级旧数据的路径。

1. 停止旧服务，确认不再有写入。
2. 归档旧数据库、SQLite 附属文件和相关状态，保留可恢复副本；不要删除或覆盖原件。
3. 选择全新空目录，设置新的 `CHRONA_DATA_DIR` 与 `DATABASE_URL`。
4. 启动新服务，确认页面与诊断指向新库。

真实数据归档、切换与恢复应由 owner 明确批准。不要修改迁移记录来绕过拒绝，也不要把旧库恢复到新服务期待的位置。

## 备份与恢复

先停止服务（完整备份会获取数据库运行锁，服务运行时拒绝操作），确认 `CHRONA_DATA_DIR` 与 `DATABASE_URL` 指向同一实例。系统需提供 GNU 兼容的 `tar`。

```bash
chrona backup /absolute/private/path/chrona-backup.db
chrona doctor
```

备份生成一对文件：`chrona-backup.db`（一致性 SQLite 副本）和 `chrona-backup.db.tar`（`<dataDir>/affairs`，包括 git 历史，以及 `<dataDir>/secrets`）。即使数据库放在数据目录外，也以显式 `CHRONA_DATA_DIR` 选择文件根目录。两者缺一不可，均未加密；tar 和数据库文件权限为 0600，备份目录也应仅 owner 可访问。缺失的事务/凭据目录按空目录恢复。拒绝符号链接和特殊文件；使用 portable ustar，超出该格式路径/文件大小限制会失败。命令失败时可能留下不完整副本，不要将其当成成功备份；重试使用新输出路径。

不要用运行中的裸数据库复制代替一致性备份。QQ 状态（包括数据目录中的 `qq-bot`）、Provider profile（默认 `<dataDir>/providers/pi`，包含其自身认证）及其他自定义目录不在此 tar 中，需单独安全归档。不要公开或将认证写入版本库。

恢复前停止服务，确认目标数据库路径，保留现有数据备份：

```bash
chrona restore /absolute/private/path/chrona-backup.db
```

恢复必须同时提供数据库和同名 `.tar`，不会静默退回仅恢复数据库。默认不覆盖已有数据库或事务/凭据目录；`--force` 替换而非合并目录，避免留下旧文件。恢复拒绝不安全路径、链接及非本命令生成的归档格式。只恢复可信来源的备份。

旧数据库恢复副本保留在数据库旁，旧事务/凭据目录保留为数据目录下 `.restore-files-*-prior-affairs` / `-prior-secrets`。普通错误会回滚目录；跨 SQLite 与文件目录的替换不是崩溃原子事务。断电或强制中断后，不要直接重启：保留整个目录，请 owner 检查数据库恢复标记及暂存/旧目录，或在全新目标目录用完整备份对重试。大归档恢复会占用与归档大小相关的内存。

只有明确要替换且已有恢复手段时才使用 `chrona restore /absolute/private/path/chrona-backup.db --force`。恢复后运行 `chrona doctor`，再启动服务并检查页面。建议先在独立目录演练恢复，不要首次在真实数据上试验。

源码环境将上述 `chrona` 替换为 `bun run packages/cli/src/index.ts`，例如：

```bash
bun run packages/cli/src/index.ts doctor
```

`doctor` 检查数据库存在性、SQLite 完整性、存储权限、运行锁和网络安全配置；它不会验证模型或 QQ 能否真正响应。确认进程已退出后，才考虑 `chrona doctor --repair-stale-lock`；它隔离确认陈旧的锁，不删除数据库。畸形锁需人工检查。

## 环境变量

完整操作配置见 [README 配置表](../../README.zh.md)。重点：

- 存储：`DATABASE_URL`、`CHRONA_DATA_DIR`；迁移路径覆盖为 `CHRONA_MIGRATIONS_DIR`。
- API：`HOST`、`PORT`、`API_KEY`、`ALLOWED_ORIGINS`。保持回环监听；不得靠危险覆盖项替代认证。
- Provider：`CHRONA_STEWARD_AGENT=pi`、`CHRONA_STEWARD_PI_COMMAND`（必填绝对路径）、`CHRONA_STEWARD_PI_VERSION`（默认精确 `0.85.0`，可显式选 `1.3.0`）、`CHRONA_STEWARD_PI_AGENT_DIR`（默认 `<dataDir>/providers/pi`）、`CHRONA_STEWARD_PI_RESOURCES_FILE`（可选受控资源清单）、`CHRONA_STEWARD_PI_MODEL`、`CHRONA_STEWARD_PI_WEB_EXTENSION`；Chrona 工具扩展由运行时选择。
- 后台：`CHRONA_STEWARD_TICK_SECONDS` 默认 30 秒；没有接待 / assessor 双角色。
- 来源：`CHRONA_CHINO_DASHBOARD_URL` 配置 Chino 适配器；邮箱在设置 → 连接器填写 IMAP/SMTP 配置和密码，凭据保存在 `<dataDir>/secrets`。只读同步、入站去重，SMTP 代发须批准。
- QQ：`CHRONA_QQ_APP_ID`、`CHRONA_QQ_SECRET_FILE`、`CHRONA_QQ_STATE_DIR`；链接用 `CHRONA_PUBLIC_URL`。
- Owner MCP：`/api/mcp`（Streamable HTTP，无状态，`Authorization: Bearer <API_KEY>`）由内置 `mcp` 模块提供，供用户自己的 Pi / Claude Code 使用，需要模块沙箱（bwrap）。工具与网页 owner 操作相同：`chrona_today`、`chrona_apps`、`chrona_sessions` 等会话工具、`chrona_content_*`、`chrona_chat`、`chrona_approvals`、`chrona_approval_resolve`、`chrona_modules`、`chrona_notifications`，以及各模块的 `m_*` 工具。客户端应对 `chrona_approval_resolve` 要求逐次确认。

环境变量修改后重启服务。保持 `CHRONA_E2E_TEST_ROUTES` 未设置。开发脚本的 Vite 监听所有网卡，不应向不可信网络开放。

## 日志与健康

日志输出到服务标准输出/错误；由运行终端或进程管理器收集，没有统一固定日志文件路径。注意启动失败、迁移拒绝、`STEWARD_TICK_FAILED` 和 `qq-bot` 组件事件。分享日志前检查是否含私人文本或路径，不要附上密钥、绑定文件或数据库。

- **设置 → 运行状况**：Agent、来源积压、发件箱等应用级状态。
- API 端口的 **`/health`**：服务存活与 Agent 配置状态；Agent 显示可用不代表已成功调用模型。
- API 端口的 **`/ready`**：执行数据库查询，成功返回 ready，失败返回 503；不检查 QQ 或模型。
- **`/api/steward/health?workspaceId=ws_default`**：工作区级运行状况，遵循 API 认证。

健康接口不能替代端到端验收。不要为了探测健康而关闭认证。

## QQ 状态与绑定

按 [QQ 配置步骤](../../README.zh.md)配置私有密钥文件并生成绑定码：

```bash
chrona qq bind-code --workspace ws_default
```

发送 `绑定 <码>` 到独立 Bot 私聊。默认有效十分钟，可用 `--ttl <minutes>` 指定 1–60 分钟。已有绑定时，只有明确授权更换主人才能用 `--replace`；替换必须留在同一工作区。正常对话不需要前缀。

状态文件为 `CHRONA_QQ_STATE_DIR/status.json`；未指定状态目录时为 `CHRONA_DATA_DIR/qq-bot/<appId>/status.json`。服务启动、消息处理后及每 30 秒更新，包含更新时间、gateway、token、bound、绑定时间、ownerHash 和 challengePending。检查时间是否仍在更新、网关与 token 状态以及是否已绑定。绑定成功不代表后续推送必然被 QQ 接受。

同目录的绑定与挑战文件是私有状态，不要公开；绑定码只存哈希，CLI 输出的明文码应保密。QQ 平台的发送限制与 Chrona 打扰预算都可能影响通知，先看网页发件箱状态，不要绕过预算补发。

## 确认 Agent 真正可用

**升级前置条件：** 不再默认启动 PATH 中的 `pi`，也不再继承个人 Pi profile。依赖旧默认值的安装若直接部署，会显示 Provider 不可用。先由 owner 准备专用执行入口/profile/认证，再安排切换与回滚；不要自动复制个人凭据或顺带升级 Pi。

配置示例（路径须替换，非自动安装/迁移脚本）：

```bash
export CHRONA_STEWARD_PI_COMMAND=/opt/chrona/pi/bin/pi
export CHRONA_STEWARD_PI_VERSION=0.85.0
export CHRONA_STEWARD_PI_AGENT_DIR="$CHRONA_DATA_DIR/providers/pi"
install -d -m 700 "$CHRONA_STEWARD_PI_AGENT_DIR"
# 另行以服务用户，用选定 Pi 和以下环境准备模型认证/配置：
# PI_CODING_AGENT_DIR="$CHRONA_STEWARD_PI_AGENT_DIR" "$CHRONA_STEWARD_PI_COMMAND"
```

1. 审查并固定专用可执行文件，不附带 shell 参数。不要直接复用会追加日常扩展/主题/配置的交互式包装器。版本输出须精确匹配配置；当前只接受 `0.85.0` 和 `1.3.0`，两者能力并不等同，不据本机版本推断服务能力。
2. profile 须已存在、为绝对规范路径且不经符号链接，位于事务/工作目录之外。Unix 下不得有 group/other 权限（建议 `0700`），并应由服务用户管理。Chrona 不自动创建它、不复制认证。实际传给 Pi 的变量为 `PI_CODING_AGENT_DIR`。该目录仅隔开服务资源与可写状态，不是完整的宿主私密信息读取隔离。
3. 设置 `CHRONA_STEWARD_AGENT=pi`，检查 Chrona 工具扩展有效；需要网页工具时显式设置已审查的网页扩展。保留关闭资源自动发现及 `--no-approve` 项目信任拒绝。每次启动在提示/注入前查询 `get_commands`，拒绝不属于显式扩展/技能的命令资源。可选资源清单须为 profile 和事务树之外、私有、规范路径的 JSON 文件，入口只接受明确的本地文件及三个已列明的 Pi 1.3 内置扩展；修改后重启，不自动安装或发现资源。配置与原生 MCP 限制见 [Provider 运行说明](provider-runtime.md)。命令检查不覆盖任意包装器代码或仅注入工具的扩展，不能替代入口审查。
4. 重启后查看设置 → 运行状况及 `/health`。缺命令/profile/扩展、版本不符、未启用或正在停止都可能使 Agent 不可用。健康检查不发送模型请求，也不验证认证、完整工具清单或真实交互链路；命令资源检查发生在具体运行启动时。
5. 由 owner 在网页输入一个无敏感内容的简单问题，确认收到实际回答。再交代一件小事务，确认有进展或成果；只出现排队状态不能算成功。另行核验取消、恢复、补充消息及跨日任务。
6. 失败时查看事务技术详情、运行状况和日志，区分配置/版本、模型认证、扩展交互、超时和工具失败。Pi 的 select/confirm/input/editor 显示在全局待答复区，不仅在当前事务页。请求受本次 deadline 与自身 timeout 的较早者限制（最长 5 分钟），过期/取消/暂停/结束/进程退出/重启后不能继续批准。收到答复只代表本次请求已记录，不代表外部动作已经执行。没有接入交互回调、请求超长或含已识别敏感信息时明确失败，绝不自动同意。需要人工输入的工作不宣称能全程无人值守。

第 5 步会调用真实模型并可能产生费用，属于人工验收，不应放进自动化测试。本次改动未执行真实模型或 QQ 验证，未修改线上配置。

## 脚本限制

Provider 自带文件、命令与网页工具，Chrona 不再维护脚本草稿/工具版本系统。`CHRONA_STEWARD_SANDBOX_BWRAP` 配置 Provider 的 bubblewrap 包装；未配置时 Pi 关闭 bash，保留文件与可选网页工具。Provider 包装的宿主挂载只读，事务/会话目录及服务专用 Pi profile 是可写例外，不再将整个宿主 `~/.pi` 设为可写。它不隔离所有宿主读取，不能当成凭据保密边界。

同一变量也配置模块沙箱；模块通过隔离测试并经绑定内容 hash 的批准启用后执行，保留超时/输出限制，网络访问按模块声明与策略控制。目前假定 `/nix/store`，不能视为通用部署支持。未通过探测时不回退到宿主执行。以实际执行结果为准，不以模型文字为准。
