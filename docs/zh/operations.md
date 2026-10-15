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

```bash
chrona backup /absolute/private/path/chrona-backup.db
chrona doctor
```

备份命令生成一致性 SQLite 副本，不要用运行中的裸数据库文件复制代替它。备份不包含外部 QQ 状态或模型配置；这些需要单独安全归档。备份目录与文件应仅 owner 可访问。

恢复前停止服务，确认目标数据库路径，保留现有数据备份：

```bash
chrona restore /absolute/private/path/chrona-backup.db
```

默认不覆盖已有数据库。只有明确要替换且已有恢复手段时才使用 `chrona restore /absolute/private/path/chrona-backup.db --force`。恢复后运行 `chrona doctor`，再启动服务并检查页面。建议先在独立目录演练恢复，不要首次在真实数据上试验。

源码环境将上述 `chrona` 替换为 `bun run packages/cli/src/index.ts`，例如：

```bash
bun run packages/cli/src/index.ts doctor
```

`doctor` 检查数据库存在性、SQLite 完整性、存储权限、运行锁和网络安全配置；它不会验证模型或 QQ 能否真正响应。确认进程已退出后，才考虑 `chrona doctor --repair-stale-lock`；它隔离确认陈旧的锁，不删除数据库。畸形锁需人工检查。

## 环境变量

完整操作配置见 [README 配置表](../../README.zh.md)。重点：

- 存储：`DATABASE_URL`、`CHRONA_DATA_DIR`；迁移路径覆盖为 `CHRONA_MIGRATIONS_DIR`。
- API：`HOST`、`PORT`、`API_KEY`、`ALLOWED_ORIGINS`。保持回环监听；不得靠危险覆盖项替代认证。
- Agent：`CHRONA_STEWARD_AGENT=pi`、`CHRONA_STEWARD_PI_COMMAND`、`CHRONA_STEWARD_PI_MODEL`、`CHRONA_STEWARD_PI_AGENT_EXTENSION`、`CHRONA_STEWARD_PI_WEB_EXTENSION`。
- 后台：`CHRONA_STEWARD_TICK_SECONDS` 默认 60；`CHRONA_STEWARD_ASSESSOR=pi` 只控制来源评估，不等于启用接待 Agent。
- 来源：`CHRONA_STEWARD_CHINO_DASHBOARD_URL` 配置 Chino 适配器；还需在设置中管理对应连接和授权。
- QQ：`CHRONA_QQ_APP_ID`、`CHRONA_QQ_SECRET_FILE`、`CHRONA_QQ_STATE_DIR`；链接用 `CHRONA_PUBLIC_URL`。

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

1. 确认服务进程的执行环境能找到 Pi 可执行文件，并拥有可用模型配置。自定义命令填写可执行文件路径，不附带 shell 参数。
2. 设置 `CHRONA_STEWARD_AGENT=pi`，检查 Chrona 工具扩展路径有效；需要联网研究时显式设置网页扩展绝对路径。
3. 重启后查看设置 → 运行状况及 `/health`。缺扩展、未启用或正在停止都可能使 Agent 不可用。
4. 由 owner 在网页输入一个无敏感内容的简单问题，确认收到实际回答。再交代一件小事务，确认有进展或成果；只出现排队状态不能算成功。
5. 失败时检查事务技术详情、运行状况和服务日志，区分可执行文件缺失、模型配置错误、扩展不可用、超时与工具失败。

第 4 步会调用真实模型并可能产生费用，属于人工验收，不应放进自动化测试。本次文档编写未执行真实模型或 QQ 验证。

## 脚本限制

脚本草稿需要按版本批准，批准不等于运行成功。默认没有可用沙箱。当前代码包含可选 bubblewrap 运行器，通过 `CHRONA_STEWARD_SANDBOX_BWRAP` 配置且隔离探测成功才可用；挂载目前假定 `/nix/store`，不能视为通用部署支持。未通过探测时没有回退到宿主执行。具体执行是否成功，以实际工具结果为准，不以模型文字为准。
