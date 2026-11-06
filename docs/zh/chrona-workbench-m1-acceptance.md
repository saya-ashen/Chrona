# Chrona / Workbench M1 验收记录

日期：2026-11-05。状态：**M1 开发验收通过；协调者已复核运行时、文档及发行证据。进入 P1 契约实施，尚未冻结 P1。**

本记录签署 M1 开发验收，保留下面全部环境跳过项与恢复边界。P1 可实施契约与无模型探针；F/G/H/N 仍须等待 P1 冻结，M2/M3 产品实现尚未开始。生产部署、真实数据迁移、账号、模型或设备验收仍未授权。要求来源：[统一方案](chrona-workbench-unified-development-plan.md) §4、§9、§12、§14。

## 冻结基线与证据

运行时树：`1c7ec0a95d0a3f3a6d961133e5f78a89ffdf2f37`，530 文件。原交付目录：`/tmp/chrona-unified-20261105-c2mdd7yu/shared-m1-delivery`。`final-manifest.json` SHA256：`31cc867d1e43822cd1332f4f5025786a0e06436be61987df81fb518f11813349`。原 report、manifest 和运行时快照保持冻结；本轮文档以独立 patch/manifest 交付。

以下证据文件均相对于原交付目录；属于开发环境的实际执行记录，不等于正式验收或生产验证。

| M1 门要求 | 实现/验证事实 | 证据 | 边界/状态 |
| --- | --- | --- | --- |
| A–E 集成与共享契约 | 生命周期、发行安装、Web、公共模块和官方外置已集成；真实调用身份与 callback 目标绑定 | `report.md`、`manifest.json`、`post-suite-manifest.json` | 协调者已审阅并通过 M1 开发验收 |
| 最小内置及绕过拒绝 | 内置固定为 web/mcp/files/notify/events；普通 build/propose/group/owner/admin 不可修改内置；qq/remind/mind 为预装外置，memory-local 为可选外置 | `report.md`、`full-bun-3.log` | 不保留 custom-builtin 兼容路径；现行文档已对齐 |
| 外置生命周期与回执 | 更新保留暂停、显式回滚恢复启用；页面/渠道/订阅归属、登记重启和受限重试验证 | `registration-7.log`、`registration-7.exit`、`full-bun-3.log` | 未使用真实 QQ 或模型 |
| SDK 资源独立性 | trusted-local preload 精确登记 chrona 和 chrona/testing；独立 package/tsconfig、作者检查与长运行进程均验证 | `sdk-loader-4.log`、`linux-smoke-1.log` | required-isolation 路径未改；不是宿主恶意代码隔离 |
| 数据迁移归属 | SQLite writer lock 后读归属，短事务内交换并激活；作者脚本在副本上执行；失败补偿、竞争写、恢复失败和清理失败覆盖 | `swap-ownership-1.log`、[恢复说明](module-recovery.md) | DB/文件系统不是统一原子介质；不声称覆盖任意磁盘损坏或所有不确定提交 |
| 无业务应用的基础能力 | QQ 待配置、可选 memory、无 mind 硬编码协议；注册失败不阻断无关启动阶段 | `full-bun-3.log`、`full-api-5.log`、`report.md` | 真实模型效果未验证 |
| 全量 Bun | 100 文件，1111 pass / 0 fail / 7 skip，5484 expectations；最终轮无 retry | `full-bun-3.log`、`full-bun-3.exit`、`final-suite-matrix.json` | 原环境隔离/平台 skip 保留；此前失败不抹除 |
| 全量 API | 11 文件，37 pass / 0 fail / 2 skip，205 expectations | `full-api-5.log`、`full-api-5.exit` | 两项 bwrap 环境 skip |
| 类型与 lint | 最终 typecheck/lint exit 0；既有 doctor complexity 警告保留 | `typecheck-final-2.log`、`lint-final-3.log` | 未调整规则或债务基线以掩盖失败 |
| 实际浏览器 | 1440×900、1024×768、390×844；36 状态，无横向溢出；40 个 Web 源文件与冻结树一致 | `browser-source-reuse.json`、C 交付浏览器记录 | 验证 bundle 只生成于隔离副本，原 pages.js 未覆盖 |
| Linux x64 真实发行 | generate/compile/portable ELF/资源/archive 成功；793 tar 成员 SHA 核对；内置5/外置4，无模块 node_modules | `linux-build-2.log`、`release-resources.json` | 首轮 Nix engine URL 失败保留；仅 Linux x64 |
| 二进制独立运行/救援 | 实际发行 binary 使用临时数据目录通过资源 typecheck/start/health/web/today smoke；救援由服务器独立承载 | `linux-smoke-1.log`、`report.md` | 未部署生产，未验证其他平台发布 |
| 文档门 | AGENTS、架构、目标、安全、运行、依赖、恢复、owner build、Provider、方案及集成记录逐项对齐 | 本记录及独立 `M1-closeout` 文档 patch/manifest | 最小文档检查通过；协调者已签署 M1 开发验收 |

发行 tar SHA256：`6fdc795f42c73992a2f724b7eda3eee5bc73b3ecd5645739783f467f2cbbfff3`。隔离浏览器 bundle SHA256：`2a05949203a6d06b32d2669e0761f76e50ba84cbebbd805c5bb29931a58340c8`。

## 收口与后续门

历史失败、重试及环境边界保留在 `full-suite-history.json` 与原日志。`full-bun-2` 的提醒 fixture 首次失败和 runner retry 不作为最终无重试成功证据，最终依据为 `full-bun-3`。不删除旧交付或覆盖原报告。

文档补丁与复核结果位于 `/tmp/chrona-unified-20261105-c2mdd7yu/M1-closeout`；P1 候选方案与两仓库基线位于同根目录的 `P1-preparation`。详细流、executions 接口、coding/editor、Chrona Workbench backend、本机执行器和并发均不是 M1 已交付能力。

协调者签署：**M1 开发验收通过**。验收人：本会话 Orca 协调者；日期：2026-11-05；run：`run_14a5760a8957`。已审阅 A–E 与共享集成、SDK/迁移增量、最终矩阵、12 文件文档收口；独立核对最终 manifest、源码归档、迁移补丁及 Linux 发行包 SHA。文档收口补丁 `c2ba110ad9859826f9022181af9e0b22ffbee20190bf67432e32a71e81cdca1e` 不改变受测运行时；本签署及 registration-7 证据引用修正另行保留增量。

验收范围：新开发数据目录、trusted-local、Linux x64，以及离线 Web fixtures；表中 bwrap/Windows 环境跳过、其他平台、真实模型/QQ/设备与跨介质恢复限制保留。不是生产上线或这些未验证环境的验收。成果仍在隔离集成树，未合回原工作区或提交。

下一门：P1 八项契约实施与无模型探针已授权，**P1 尚未冻结**；共享接口、目录/日志与权限、持久取消/事件、TS/Lua fixtures 和精确文件分工须经协调者审核后，才可派 F/G/H/N。

签署后审查修订：协调者于 `msg_228e23d229e3` 授权清理冗余身份读取、内部 typed enum 校验和回滚纯转发层。`switchActiveIn` 复用切换前 row 记录 previousHash；写事务身份、保留名/builtin、版本/schema/迁移/日程/组激活的安全判断保留。本次仅重验受影响现有测试与P1，共8文件191 pass / 0 fail、1626 assertions，typecheck与触及文件lint exit0；具体独立补丁、树和日志在 `P1-delivery/minimality-report.md`。上述全量/发行/浏览器验收仍只对应原冻结树，不能用于声称这些检查已在修订后重跑。协调者尚待亲审本次diff，M1原冻结证据不变。
