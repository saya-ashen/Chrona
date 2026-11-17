# Chrona 运维

本仓库维护通用内核、宿主、CLI、数据库及 SDK。发行不预装应用，应用页面、登录、客户端鉴权、Provider 配置和业务绑定由各应用维护。旧部署记录中的固定应用名单和环境桥接不适用于当前源码。

2026-11-17 已按用户明确授权停止 `chrona-local-3005.service` 与 `chrona-provider-preview.service`，未禁用其自动启动配置；已删除源码根 `prisma/` 的数据库和运行材料。两服务对应的外部数据、其他部署、历史恢复根及备份未删除。本轮只编辑源码和静态核对，未构建、运行检查或部署。

## 启动与数据

源码使用 `bun run dev` 或 `bun run server:start`；打包 CLI 使用 `chrona start --no-open`。默认监听 `127.0.0.1:3101`。空内核可启动，不提供应用首页；应用安装与批准完成前，连接成功不表示业务可用。

`CHRONA_DATA_DIR` 选择实例文件根；默认 Linux 使用 `$XDG_DATA_HOME/chrona` 或 `~/.local/share/chrona`，macOS 使用 `~/Library/Application Support/chrona`，Windows 使用 `%APPDATA%/chrona` 或用户目录下 `AppData/Roaming/chrona`。数据库默认 `<dataDir>/chrona.db`，显式 `DATABASE_URL` 优先。建议为每个开发实例指定独立目录：

```bash
export CHRONA_DATA_DIR="$PWD/.data/kernel-fresh"
export DATABASE_URL="file:$CHRONA_DATA_DIR/chrona.db"
bun run server:start
```

schema 和唯一初始 SQL 位于 `packages/db/prisma/`，Client 生成路径为 `packages/db/src/generated/prisma/`，发行迁移资源为 `resources/prisma/`。启动获取数据库运行锁、应用迁移并创建默认工作区，无需 seed。不要让多个服务共享同一数据库。旧库和修改过的已应用迁移由 checksum 守卫拒绝，不能通过修改迁移记录绕过。

配置文件使用 `CHRONA_CONFIG_FILE`；示例见 [chrona.config.example.json](../../chrona.config.example.json)。环境变量优先于文件，非法配置报告具体路径和字段。`HOST`、`PORT`、`API_KEY`、`ALLOWED_ORIGINS` 控制内核 HTTP；对外开放前须配置真实鉴权。应用 listener 自行验证客户端，代理透明转发其 Authorization、Cookie 和 Set-Cookie，仅替换内部传输 token。通用 Run 工具入口仍核对本机连接及绑定 token。

## 管理与安装

写管理前停止使用同一数据目录的服务。`chrona admin modules`、`catalog`、`approvals` 用于核对状态；`approve <approvalId>` 只批准具体动作。安装使用显式应用资源目录 `CHRONA_MODULE_RESOURCES`，不从源码或固定名单恢复材料。

`chrona admin install <package> --request-key <key>` 受理受检构建，`building` 或 `pending_approval` 不表示已激活。查询未知结果使用原 key，明确重试才使用新 key。`--update --exact-release` 仍要求真实材料和当前批准身份，不是跳过检查的入口。应用移除后启动不自动补装，首装不存在免审批路径。

Git 来源关联、状态和显式推送使用 `chrona admin git-associate`、`git-status`、`git-push`；推送需要具体授权、提交与预期远端身份，不随激活自动执行。参见[Git 工作流](module-git.md)。

`chrona doctor` 检查本地运行配置、数据库、完整性、权限、锁、迁移及显式安装资源。它不调用真实模型、不验证应用业务。确认进程退出后才使用 `--repair-stale-lock`；畸形锁须核对原因。

## 停止与恢复

停止依次关闭 HTTP 接单和 tick，等待 Provider、构建、唤醒及最终记录收尾，再关闭应用和数据库。取消、租约失效、超时或断线不能证明后代已经停止；未知停止继续占用容量，不自动重放外部效果。

Linux 长驻应用使用通用 guardian generation 与宿主 `platform/host-stops/` 停止回执；回执不写入应用业务目录，不参与业务快照或 schema 判空。`CHRONA_HOST_STOP_RECEIPT` 与 `CHRONA_HOST_GENERATION` 由宿主绑定。应用保存自身操作与 generation 的关联，停止证据只证明后代停止，不证明业务成功。

本地执行仅支持 `trusted-local`，以服务用户的 OS 权限运行。退役 isolation 配置明确报错，不静默降级。Manifest、路由、凭据读取审批和进程监管均不构成恶意代码的 OS 隔离。缺运行时或依赖应报告原因，不能通过关闭鉴权或脱敏解决。

## 完整备份

先停止服务，确认数据库及文件根属于同一实例，再执行：

```bash
chrona backup /absolute/private/path/before.db
chrona restore /absolute/private/path/before.db
```

备份必须同时保留 SQLite 副本与同名 `.tar`，后者包含 `platform`、`sessions`、`secrets`。应用私有数据位于 `platform/data/`；外部自定义目录需另行归档。归档未加密，数据库和 tar 应仅 owner 可读。运行锁及遗留进程检查拒绝仍存活的写入者；私有 SQLite 使用一致性快照包含已提交 WAL 页，不能用运行中的裸文件复制替代。

备份跳过可重建依赖及会话浏览器缓存；platform/sessions 内链接被列为遗漏，凭据根的链接和特殊文件拒绝。归档采用受限 ustar，路径或文件超限时失败。失败残留不是成功备份，重试使用新输出路径。

恢复要求数据库及 tar 齐全，默认拒绝覆盖非空目标。`--force` 替换目录而不合并，须有具体授权和可用备份。跨 SQLite 与目录替换不是崩溃原子事务；断电后保留恢复标记、暂存和旧目录，核对后再启动，优先在全新目录演练。源码模式可用 `bun run apps/cli/src/index.ts` 调用同一管理入口。

## 部署边界

`deployment:preflight` 只读核对候选发行身份、进程资源根、数据库迁移、活动版本、未知停止及未结算工作；它不是排空或停止证据。`deployment:backup` 复用完整备份并验证可读性。`deployment:accept` 只检查指定 target 的实际归档资源和临时空内核冒烟，不操作真实部署。

实际发布、服务切换、恢复、Nix 激活和真实业务验收均需要具体任务授权。release identity、源码字节、模式和哈希各自保留，不把本地复制称为部署，不把健康接口当作业务验收。

## 历史恢复材料

工程清理的历史部署根为 `/home/saya/.local/share/chrona-deploy/cleanup-and-reorg-20261117T0131Z-caf46efa`，生产动作目录为 `production-20261117T0243Z-8ce927b2-r2`。其完整备份 `backup/before.db`、`before.db.tar`、`external-roots.tar` 及新旧 package/unit/archive GC roots 继续保留。恢复前核对实际服务、最新数据和兼容性，不直接回放旧动作。

unknown 回执 `146941c1-2da2-4864-83c4-4b7a8a3aa44d` 与 `840dfcfd-8ee9-46d5-b142-6ce7babc2810` 使用原 key 对账，不换 key 猜测补发。历史应用升级和页面修复未完成最终产品验收，旧测试、健康和离线修复记录不证明现场问题已解决。本轮没有操作上述服务、数据库或恢复材料。
