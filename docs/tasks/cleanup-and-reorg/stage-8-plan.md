# 阶段 8：规则、开发检查与部署控制

基准：`7f067370d1319734f9b64adfe88bedd725c618c8`。本阶段只修改主仓库入口和说明；不修改合同、Prisma schema、应用仓库或真实部署配置，不调用 chino，不激活 NixOS，不操作真实数据、账号、模型、QQ 或外部通知。

## 入口合同

| 入口 | 检查对象 | 复用机制 | 结果与边界 |
| --- | --- | --- | --- |
| `deployment:preflight` | 错误发行组合、进程使用旧资源、数据库选错、迁移不兼容、缺表、未知停止、未结算工作、待回调和未接受 outbound receipt | release identity、Linux `/proc`、`sqlitePathFromFileUrl`、`inspectSqliteRuntimeLock`、实际状态字段 | 输出 JSON；失败包含 `passed: false` 且退出非零；只读，不停止、写库、转换或切换 |
| `deployment:backup` | 主库/WAL、`platform`、`sessions`、`secrets`、`qq-bot` 未形成可恢复的一组材料 | `backupSqliteDatabase`、`restoreSqliteDatabase` 的锁、快照、权限和归档合同 | 只写显式输出和临时恢复目录；数据库可位于 `dataDir` 外；自定义目录另行归档 |
| `deployment:accept` | 指定发行目录的 identity、资源、helper、CLI 和模式 | 既有 `smokeRelease` | 只接受与 target 对应的标准目录；默认离线，`--runtime` 才用全新临时数据 |

本阶段删除 `deployment:deliver`、`delivery.json`、自报授权和停机证据 JSON。复制归档与正式切换由已有受控运维流程负责，阶段入口不把普通本地复制包装成部署，也不建立签名或第二套授权系统。

## 状态合同

预检要求 `_chrona_migrations`、`Module`、`Run`、`ModuleInvocation`、`ModuleCall`、`ExecutionAttempt`、`ExecutionDelivery`、`ExecutionReceipt`、`ExecutionCommand` 和 `AgentCommand` 存在；缺表失败。终态沿用当前消费者的值。除未知 stop/effect、未结算行外，还阻断 `ModuleInvocation.reply = true AND repliedAt IS NULL`、全部未接受 outbound receipt、未确认停止或仍持有目录的 ExecutionAttempt，以及结果缺失或 unknown 的 workspace cleanup command。终态 Run 不统一要求 `stopStatus = confirmed`，未启动执行的既有 `never_started`/`stopConfirmedAt` 结算路径仍有效。

资源根复用启动器 `findResourceDir`：从目标 `/proc` 的 cwd/cmdline/exe/env 传入显式观察值，保留 resource override、argv0 邻接、exe 邻接、package 资源及 package 根的顺序。标准打包启动、显式资源/包目录和可识别源码 CLI 入口受支持；自定义 wrapper 隐藏 package 路径且所有可观察候选均无 migrations 时，预检明确说明无法确定，不猜测检查器自身路径。启动器原有无参 fallback 保留。

## 固定应用输入

13 个独立仓库均已有 `DEVELOPMENT.md`，并已由各自 `chrona-material.json` 纳入源清单：`author`、`chat`、`events`、`files`、`mcp`、`memory-local`、`mind`、`notify`、`pi`、`qq`、`remind`、`remote-execution`、`web`。本阶段保持应用源码、CLAUDE 转引、pins 和 Nix 声明不变。

这些说明已有实际开发约束：应用拥有源码/锁/材料，纯逻辑在应用内检查，kernel/DB/SDK 组合测试通过 Chrona 的固定恢复目录运行；改动先在应用本地 main 提交，再更新 bundle、artifact 与 lock，不把同级 checkout 当发行输入。仓库存在不代表启用，Remind 仍暂停。本阶段仅盘点保留，没有为“精简规则”制造 AGENTS/CLAUDE 或应用 diff。

## 不实施的范围

- 不新增 API、Prisma schema、迁移、队列、回滚系统或持久化账本。
- 不修改既有 backup/restore 归档格式或一次性 storage converter。
- 不连接 SSH、systemd、chino、NixOS、真实数据库、模型、账号或 QQ。
