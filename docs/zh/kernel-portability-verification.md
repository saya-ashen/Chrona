# 内核可移植性实施验证记录

日期：2026-11-09。状态：**S0–S3 已实施；S4/S5 部分完成，S6 未验收**。对应[实施方案](kernel-portability-plan.md)，本记录的实施快照核对至当日 **18:36（+08:00）**，主分支合并后的检查见下方“合并复核”。物理存储改动后 root tsc final9、root lint final6、边界 final3、schema `--check` 与原始 hash 基线通过；新增 7 文件确定性回归 **50 pass / 441 断言，无失败、无跳过**，包含真实 Pi 1.5.0、生产 HTTP、内核预算预留、签名停止及 cleanup。普通应用和设备新增有限 SQLite 页数、实际分配的证据预留与有界回滚日志；满额后拒绝新工作，已接纳任务继续提交终止和控制回执。独立复核 7 项测试 / 106 断言通过，没有确认的实质缺陷。安全归档、超过 100 项设备 journal 的持续运行与完整故障矩阵仍未完成。

第三轮 full Bun 在物理存储改动前已跑完 229 文件，notify 首次失败后隔离重试通过，不能称为无重试全绿；修复持久化等待后定向回归 17 pass / 0 fail。完整 API 为 105 pass / 19 文件。编译产物 helper 路径与 ELF RPATH/RUNPATH 泄漏已修复；17:55 默认 Linux CLI 使用仅允许离线缓存、保留 frozen lockfile、禁用安装脚本的 Bun 包装器完成迁移、health 与 Web runtime smoke。18:36 包含物理存储改动的最终 14 seeds、核心及设备发行包均已刷新；完整 Linux runtime smoke、实际可选应用 seed 安装与复制设备二进制 smoke 再次通过，结果见 §2.3。所有结果限本地；completion 使用假实现，无真实外部模型、部署或生产验收。

以下 18:36 及此前的实施记录以 `a35dd2b8d75a62fede578015759c27513efc55a9` 加当时工作区修改为基准；实现随后保存为 `442223ee`。该早期基准提交本身不包含全部被测实现。已记录的原生进程测试环境为 Linux 7.3.0-cachyos x86_64、Bun 1.4.2、Node v22.22.3、GCC 15.2.0。临时日志和交接文件是本机证据，未作为仓库持久测试报告提交。复现时必须另存实际 revision、工作区差异、环境、命令、退出码与完整输出。

通过数来自实际检查日志及所有者交接；文内给出持久源码或测试入口，`/tmp` 文件用于定位本机当次输出，不充当唯一测试源码。以下时间均为 2026-11-09 +08:00；秒级时间为日志最后写入时间，只有分钟的时间为交接标记，均不推定为命令开始时间。分次检查不构成同一冻结修订的全部验收，后续源码变化须另记证据。

## 合并复核（2026-11-09 19:18 +08:00）

按所有者要求，将主目录 `platform-v2` 的 `f964e4dd`（包含 `079daa24`）合入可移植性实现 `442223ee`，再更新主目录。保留主分支的对话续接、进度、pending reply、冻结请求、Mind 可选应用恢复及 Pi 有限重试，同时保留共享 Agent 合同、Pi 独立包、认证 loopback、原生停止证据和远程交付治理。原始 125 项 hash golden 未修改；主分支 Mind 的六项新增、四项变化另记于 [main merge fixture](../../packages/contracts/fixtures/contract-hash-main-merge.json)。重复的旧 Agent 集成测试移除，保留 `scripts/agent-integration` 中的等价测试；完成回调的固定键、事务回滚和重放断言迁入现行交付测试。

本次检查与此前实施验收分开，不宣称重新跑完所有 Bun 文件：

| 合并后检查 | 实际结果与本机证据 |
| --- | --- |
| 根 TypeScript | PASS；`/tmp/chrona-portability-merge-typecheck3.log`，最后新增回调断言后再次检查见 `/tmp/chrona-portability-merge-typecheck-final.log` |
| Lint | 两父提交逐文件比较 389 文件，0 errors / 62 warnings，无高于两父提交既有债务的文件；`/tmp/chrona-portability-merge-lint-parents.log`。普通单父 ratchet 曾因另一父提交已有 Web 警告失败，保留该结果，不称默认 ratchet 全绿；仓库 ratchet 策略未放宽 |
| 依赖边界 | PASS，0 errors / 40 warnings，826 modules / 4329 dependencies；`/tmp/chrona-portability-merge-boundaries.log`。先前恢复的重复 browser test 触发三项 Agent 边界错误，确认与已迁移测试等价后删除旧副本，没有添加豁免 |
| 定向消费面 | 23 文件、278 pass / 0 fail / 0 skip，1939 断言；`/tmp/chrona-portability-merge-tests.log`。包括完成 outbox、hash、Pi retry、Agent 设置/响应、Mind、对话、Web 三尺寸浏览器、MCP/QQ、SDK/进程/Pi 消费面 |
| 全部 server/API | 19 文件、104 pass / 0 fail，844 断言；`/tmp/chrona-portability-merge-api.log`，每文件独立临时数据库 |
| 独立复核 | 未确认实质合并回归；253 项定向检查通过，14 个 seeds 的 checksum、commit 与源码树一致。与上面套件有重叠，不相加 |
| 最终生成与发行 | 14 seeds 再生；初次 compiled resources 检查发现删除重复 Agent browser test 后 seed 滞后，刷新后通过。全新 Linux CLI 编译、shipped SDK checker、默认迁移/health/Web/auth API runtime smoke PASS；`/tmp/chrona-portability-merge-release/`。依赖只使用离线缓存、frozen lockfile、禁用安装脚本 |

上述发行复核仅刷新本地 CLI 和资源；18:36 的独立设备压缩包属于合并前产物，不把旧 checksum 作为本次合并产物。许可证及第三方声明按原文件逐字复制，新增三个声明副本保留原有 EOF 空行。无 push、部署、真实模型或外部账户操作。Windows/macOS、安全归档和完整故障矩阵的未完成项保持原判定。

## 1. 阶段判定与现行源码

| 阶段 | 实施状态 | 源码与判定边界 |
| --- | --- | --- |
| S0 | 已实施，最终接受仍有门槛 | [hash 基线](../../packages/contracts/fixtures/contract-hashes.json)、[合成用例](../../packages/contracts/fixtures/contract-hash-cases.json)、[基线测试](../../packages/engine/src/modules/steward/contract-hash-baseline.bun.test.ts)；原始 golden 不因实现变化而重写 |
| S1 | 已实施，本机 Linux 发行 runtime 已通过 | [运行时表](../../packages/integrations/src/steward/runtimes.json)、[可信本地启动](../../packages/integrations/src/steward/script-sandbox.ts)、[内核检查调度](../../packages/engine/src/modules/steward/module-typecheck.ts)、[运行包声明生成](../../packages/integrations/src/steward/module-typecheck/calls.ts)、[进程内备份](../../packages/db/src/sqlite-backup-files.ts) |
| S2 | 已实施，本机 Linux 发行 runtime 已通过 | [Agent 合同](../../packages/contracts/src/steward/agent.ts)、[Pi 库](../../packages/pi/)、[Agent runtime](../../packages/engine/src/modules/steward/builtin/agent/runtime.ts)、[依赖规则](../../.dependency-cruiser.cjs)；历史安装/编译失败及后续结果分别登记于 §2.3，本机最终 Linux 发行 runtime smoke 在 helper 路径与 RPATH 修复后通过，见 §2.3 |
| S3 | 已实施，最终接受仍有门槛 | [生成器](../../scripts/generate-contract-schemas.ts)、[系统工具 JSON](../../packages/contracts/schemas/system-tools.json)、[Manifest JSON](../../packages/contracts/schemas/module-manifest.json)、[hash 实现](../../packages/engine/src/modules/steward/module-tool-contract.ts)；生成检查与完整消费面回归是不同证据 |
| S4 | Linux 与认证 loopback 已有实现；平台验收未完成 | [进程包](../../packages/process/README.md)、[原生证据](../../packages/process/NATIVE-EVIDENCE.md)、[共享传输](../../packages/integrations/src/steward/module-sdk/transport.ts)、[内核通道](../../packages/engine/src/modules/steward/module-channel.ts)、[wire JSON](../../packages/contracts/schemas/module-wire.json)；Windows 未原生验证，macOS 完整后代监管未实现 |
| S5 | 部分完成，本机实际设备全链路与可靠性修复定向通过 | [生产设备测试](../../packages/remote-device/src/production.bun.test.ts)、[生产入口测试](../../apps/server/src/__tests__/api/remote-execution-ingress.bun.test.ts)、[私有 carrier](../../packages/engine/src/modules/steward/execution-delivery-carrier.ts)、[普通应用](../../packages/engine/src/modules/steward/external/remote-execution/)、[模型库](../../packages/remote-model/)；实际本地进程和真实内核，假 completion，无外部模型。逻辑配额、公平轮询、cold cancel 与有限物理存储定向通过；安全归档、完整故障矩阵及三平台发行验收仍待完成 |
| S6 | 未验收 | 三端执行/故障矩阵、完整场景回放及实际环境验收尚未完成 |

S1 明确登记 `modules.diagnostics` 的字段删除；S5 明确登记 `agent.run`、`agent.placement`、`agent.locations`、`agent.cleanup` 的合同变化。以 [transitions](../../packages/contracts/fixtures/contract-hash-transitions.json) 和 [additions](../../packages/contracts/fixtures/contract-hash-additions.json) 逐项核对，不通过更新 S0 fixture 隐藏额外变化。新增应用工具在并行修改时，也必须同步检查 additions。

历史 S0 设计稿中的签名编码、字段及候选协议不是当前 API。当前执行合同见 [kernel-execution.ts](../../packages/contracts/src/steward/kernel-execution.ts)，当前普通应用协议见 [contracts.ts](../../packages/engine/src/modules/steward/external/remote-execution/contracts.ts)。例如现行停止签名为 Ed25519 签署 `Buffer.from(executionDigest(statement), 'hex')`，不是早期草案的 JSON 文本签名；配对公钥为 PEM Ed25519。

## 2. 实际检查到的结果

以下为分次、分套件结果，存在重复覆盖，**不相加为总完成数**。交接没有列明命令或文件集合时，不从通过数反推范围；局部 tsc、lint 或 fixture 通过不能替代根检查。

### 2.1 当前全局检查

| 检查、输出时间与证据 | 结果及当前判定 |
| --- | --- |
| root lint final6，18:28 主协调确认，`/tmp/chrona-portability-lint-final6.log`；[ratchet](../../scripts/lint-ratchet.ts) | **PASS：440 个改动文件，0 errors、1 个既有 doctor complexity warning**。物理存储改动后重跑；此前 helper 修复后的 final5 结果保留为历史 |
| `check:boundaries` final3，18:33 主协调确认，`/tmp/chrona-portability-boundaries-final3.log`；[依赖规则](../../.dependency-cruiser.cjs) | **PASS：0 errors、35 warnings；798 modules、4175 dependencies**。物理存储改动后重跑 |
| schema `--check`，17:23:15，`/tmp/chrona-portability-schema-final.log`；[生成器](../../scripts/generate-contract-schemas.ts) | **PASS（协调交接确认）**。日志为空，空文件本身不是成功退出的证明 |
| root tsc final9，18:33 主协调确认（物理存储改动后），`/tmp/chrona-portability-typecheck-final9.log`；[根 TS 配置](../../tsconfig.json) | **PASS，exit 0**。日志仅命令行、无诊断，成功依据包括退出码确认；17:29:20 final5 首次通过及此前 fixture 错误保留于 §2.3 |
| full Bun 第三轮，17:42 完成交接，`/tmp/chrona-portability-full-bun3.log`；[runner](../../scripts/run-bun-tests.ts) | **229 文件跑完，runner 结束无最终失败文件清单；包含一次失败后的重试通过**。230 段摘要（含 notify 重试）原始合计 2456 pass / 1 fail / 38 skip；按每文件最终结果为 **2450 pass / 38 skip**。notify 首次 6 pass / 1 fail，隔离重试 7 pass，不能写成首次或无重试全绿。串行、每文件新环境、8 GiB 上限；第二轮失败另存 HISTORY |
| full API，17:28:55 日志 / 17:31 退出码交接，`/tmp/chrona-portability-api-final2.log`；[runner](../../scripts/run-api-tests.ts) | **PASS：105 tests、0 fail、19 files，exit 0（17:31 协调确认）**。17:18:20 的 4 个失败文件保留于 §2.3；不与 server/device/model 定向套件累加 |
| 晚到修复回归，17:42，`/tmp/chrona-portability-late-regressions.log`；[notify 持久化等待](../../packages/engine/src/modules/steward/external/notify/format-test.ts)、[policy author](../../packages/engine/src/modules/steward/module-policy-author.bun.test.ts)、[hash 基线](../../packages/engine/src/modules/steward/contract-hash-baseline.bun.test.ts)、[公平性](../../packages/engine/src/modules/steward/execution-delivery-fairness.bun.test.ts) | **17 pass / 0 fail**：policy author 7、baseline 9、fairness 1。notify 重启前等待精确 `call.id` 已持久化为 SQLite `call_id`；这是修复后的新定向结果，不覆盖整轮首次失败历史 |

### 2.1.1 物理存储与最终设备回归

18:32，`/tmp/chrona-physical-storage-final.log`：串行、每文件隔离 SQLite、8 GiB 内存上限、启用真实 Pi 和生产 HTTP，共 **50 pass / 0 fail / 0 skip / 441 断言**。范围为 [设备行为](../../packages/remote-device/src/device.bun.test.ts) 36、[生产链路](../../packages/remote-device/src/production.bun.test.ts) 1、[设备存储](../../packages/remote-device/src/storage.bun.test.ts) 2、[私有 journal](../../packages/remote-device/src/journal-private.bun.test.ts) 1、[设备 ELF](../../packages/remote-device/src/linux-artifact.bun.test.ts) 5、[应用存储](../../packages/engine/src/modules/steward/external/remote-execution/storage.bun.test.ts) 2、[应用 liveness](../../packages/engine/src/modules/steward/external/remote-execution/liveness.bun.test.ts) 3。实际 source flood 涉及数百次同步持久化，原 15 秒预算不足；仅该项上调至 60 秒，原断言全部保留。此前超时导致清理后仍访问已关闭数据库，记录为失败历史，不能用新结果隐藏。

[应用存储](../../packages/engine/src/modules/steward/external/remote-execution/storage.ts) 与[设备存储](../../packages/remote-device/src/storage.ts) 默认 `max_page_count=32768`、4096-byte pages，即每库 128 MiB；普通准入高水位 8192 页 / 32 MiB。DELETE rollback journal、EXTRA 同步、禁止 cache spill、内存临时表避免无界 WAL；回滚日志临时上界由有限数据库页数及每页 journal 开销决定，稳态删除。每交付先提交实际 blob 预留，再允许外部效应；普通事务提交前恢复预留 backing，终止/取消/模型回执仅消耗对应预留，失败原子回滚。测试覆盖实际分配块、SQLITE_FULL、普通容量耗尽后的 final/stop/control drain、固定回执重启、journal 大小采样和 WAL 模式转换。已有活动数据缺失物理预留时明确要求恢复，不做静默迁移。

独立只读复核：7 项存储/liveness 测试、106 断言通过；额外临时数据检查在普通准入耗尽后持久化 524 KB 已完成模型回执，重启后禁止重发、保留两个未知 attempt 容量，SQLite integrity 为 `ok`。这些限制约束本实现的数据库写入，不能保证其他程序耗尽整块磁盘时仍可落盘，也不构成对可信本地应用的文件系统隔离。无安全 GC；记录保留上限达到时停止新准入，不删除未知所有权或固定回执。

18:34 再跑 [hash 基线](../../packages/engine/src/modules/steward/contract-hash-baseline.bun.test.ts) **9 pass / 147 断言** 与 [schema 生成测试](../../scripts/generate-contract-schemas.bun.test.ts) **7 pass / 43 断言**，schema `--check` exit 0。原始 125 项 golden、5 项显式 transitions、16 项 additions 均保持精确匹配。

### 2.2 定向通过与历史结果

| 时间、范围与持久入口 | 已记录结果及边界 |
| --- | --- |
| 15:55:49 基础合同；[hash 基线测试](../../packages/engine/src/modules/steward/contract-hash-baseline.bun.test.ts) | `/tmp/chrona-portability-foundation-tests.log`：36 pass、0 fail、3 文件，早期结果 |
| 15:24:34 / 15:25:38 S1；[可信本地运行](../../packages/integrations/src/steward/script-sandbox.ts)、[构建会话测试](../../packages/engine/src/modules/steward/module-build-session.bun.test.ts) | `/tmp/chrona-s1-targeted.log`：110 pass / 5 文件；`/tmp/chrona-s1-build-tests.log`：130 pass / 5 文件；均 0 fail，不累加 |
| 15:32:59 / 15:35:19 S2；[Pi 测试源码](../../packages/pi/) | `/tmp/chrona-s2-pi-tests-final.log`：139 pass / 8 文件；`/tmp/chrona-s2-review-tests.log`：51 pass / 3 文件；均 0 fail，不代表完整 Agent 安装通过 |
| 15:40:56 合同/Python；[合同包](../../packages/contracts/)、[SDK](../../packages/integrations/src/steward/module-sdk/) | `/tmp/chrona-contract-python-check.log`：11 pass、0 fail、2 文件；定向结果 |
| 16:35:15；[supervisor 测试](../../packages/engine/src/modules/steward/module-supervisor.bun.test.ts) | `/tmp/chrona-supervisor-reviewed.log`：48 pass、0 fail、1 文件；未知停止保留监管所有权 |
| 17:07:44 日志 / 17:08 交接；[supervisor](../../packages/engine/src/modules/steward/module-supervisor.bun.test.ts)、[生命周期](../../packages/engine/src/modules/steward/module-lifecycle.bun.test.ts)、[build-session](../../packages/engine/src/modules/steward/module-build-session.bun.test.ts) | `/tmp/chrona-supervisor-tests.log`：88 pass、0 fail、636 断言；包含此前 supervisor/build-session 覆盖，不再累加。scoped lint/TS 通过，不替代根检查 |
| 16:27:56；[SDK resources 测试](../../packages/integrations/src/steward/script-sdk-resources.bun.test.ts) | `/tmp/chrona-consumer-resource-final.log` 的 resources 段 5 pass、0 fail；同文件 build-session 段 36 pass、1 fail，见历史账 |
| 16:40:16 日志 / 16:41 交接；[内核交付测试](../../packages/engine/src/modules/steward/execution-delivery.bun.test.ts)、[治理测试](../../packages/engine/src/modules/steward/execution-delivery-governance.bun.test.ts)、[hash 基线](../../packages/engine/src/modules/steward/contract-hash-baseline.bun.test.ts) | `/tmp/s5-kernel-final-tests.log`：228 pass、0 fail、1223 断言、16 文件；执行/生命周期/模型预算/hash 定向结果，不能延用为其后新增治理分支的通过数 |
| 16:29:31；[生产入口测试](../../apps/server/src/__tests__/api/remote-execution-ingress.bun.test.ts) | `/tmp/s5-production-e2e.log`：历史选定用例 1 pass、27 断言、3 filtered；不能代替下面的新模型/设备结果 |
| 17:10:21 日志 / 17:12 server 交接；[生产入口测试](../../apps/server/src/__tests__/api/remote-execution-ingress.bun.test.ts)、[server runtime 测试](../../apps/server/src/steward-runtime.bun.test.ts) | `/tmp/s5-server-final-tests3.log`：53 pass、0 fail、317 断言、5 文件；包括实际 SDK/native carrier、固定模型收据、pending unknown 不重发、生命周期/owner cleanup。局部 TS/lint 通过 |
| 17:10:41；[生产入口 actual Pi 用例](../../apps/server/src/__tests__/api/remote-execution-ingress.bun.test.ts) | `/tmp/s5-server-final-actualpi.log`：1 pass、0 fail、91 断言、3 filtered；生产 HTTP/真实应用/实际 Pi，假 completion |
| 17:14:18 日志 / 17:15 model 交接；[Pi](../../packages/remote-model/src/pi.bun.test.ts)、[gateway](../../packages/remote-model/src/gateway.bun.test.ts)、[kernel](../../packages/remote-model/src/kernel.bun.test.ts) | `/tmp/chrona-model-final-tests3.log`：18 pass、0 fail、115 断言，实际 Pi opt-in；17:16 默认运行 8 pass、10 skip，不把 skip 记为实际 Pi 通过 |
| 17:17 device 交接；[实际 RemoteDevice 全链路测试](../../packages/remote-device/src/production.bun.test.ts) | 1 pass、21 断言、3.55s；真实生产路由/SDK/内核/Pi/native file/签名停止/cleanup。已包含于下一行最终设备套件，不重复累加 |
| 17:36 device 最终交接；[设备与故障测试](../../packages/remote-device/src/device.bun.test.ts)、[问题控制测试](../../packages/remote-device/src/questions.bun.test.ts)、[生产全链路测试](../../packages/remote-device/src/production.bun.test.ts) | **39 pass、0 fail、325 断言，无 skip，实际 Pi 1.5.0 与生产 HTTP 启用**。在 17:35 native cold-claim 修复后，再跑生产用例 **1 pass / 36 断言**；不与整套累加。包级 tsc PASS；changed-file lint 0 errors / 6 warnings；重建与仓库外复制二进制 smoke PASS。来源 `/tmp/s5-device-api.md` 17:36 段；17:26 的 34 pass / 274 断言及旧产物已被取代 |
| 17:37 app 最终源码；[应用 liveness](../../packages/engine/src/modules/steward/external/remote-execution/liveness.bun.test.ts)、[native delivery](../../packages/engine/src/modules/steward/execution-delivery.bun.test.ts)、[公平性](../../packages/engine/src/modules/steward/execution-delivery-fairness.bun.test.ts) | 应用 **2 pass / 15 断言**，原生 **21 pass / 179 断言**，公平性 **1 pass / 17 断言**；原 SDK SQLite 套件与 scoped tsc PASS。最终精确 wire bytes 预留后重跑应用通过。来源 `/tmp/chrona-s5-app-liveness-report.md`；逻辑配额不代表 SQLite/WAL 物理增长已受控 |
| 17:43–17:44 helper 路径最终交接；[编译后真实回归](../../packages/integrations/src/steward/module-packaged-helper.bun.test.ts)、[checker](../../packages/engine/src/modules/steward/module-typecheck.ts)、[installer](../../packages/integrations/src/steward/module-packages.ts)、[build helper](../../packages/engine/src/modules/steward/module-build-helpers.ts) | `/tmp/chrona-helperpath-regression.log` **1 pass / 8 断言**：实际编译 fixture，从无关 cwd 运行，检查真实 TS 好/坏结果、声明生成及 bun/uv installer 调用；`typecheck.log` **16 pass / 94 断言**，`packages.log` **9 pass / 33 断言**（2 个实际依赖安装用例 filtered）。日志前缀均为 `/tmp/chrona-helperpath-`；scoped lint 0 errors / 0 warnings。显式 `StewardPorts.processHelper` 贯通 checker、两种 installer、父 build helper；不代表 normalized 发行 guardian 的 Nix loader runtime smoke 通过 |
| [process 原生证据](../../packages/process/NATIVE-EVIDENCE.md)、[原生测试源码](../../packages/process/src/) | 28 pass、22 skip、0 fail；Linux helper 构建/退出码 smoke 通过。21 Windows、1 macOS 原生用例跳过，不代表三端通过 |

应用确定性 [harness](../../packages/engine/src/modules/steward/external/remote-execution/harness.ts) 与[实际 SDK 测试入口](../../packages/engine/src/modules/steward/external/remote-execution/test.ts) 必须和真实内核集成分开登记。早期 `/tmp/s5-real-kernel-passed.json` 临时连通程序只保留为历史线索；现行全链路依据为上述仓库持久测试，不以临时程序充当测试源码。

17:27 协调还报告：Agent manifest union 修复完成；[execution-admission](../../packages/engine/src/modules/steward/execution-admission.ts) 与 [delivery store](../../packages/engine/src/modules/steward/execution-delivery-store.ts) 在持久 admission 后不再等待 `onQueued`。原 Agent module-call 4 项、release 1 项和 kernel delivery 21 项定向通过；公平轮询及应用 liveness 定向结果见 §4.2。这些定向结果不替代完整套件；API 整套与第三轮 full Bun 的最终文件结果另列于 §2.1，notify 首次失败及重试历史见 §2.3。

### 2.3 HISTORY：失败及时间明确的后续

| 失败时间、日志与持久入口 | 当时结果 | 后续及未关闭部分 |
| --- | --- | --- |
| 15:37:40，`/tmp/chrona-s3-consumer-tests.log`；[模块通道](../../packages/engine/src/modules/steward/module-channel.ts)、[notify 设置测试](../../packages/engine/src/modules/steward/external/notify/settings-page.bun.test.ts) | 41 pass、3 fail：旧 Unix 启动/清理与 notify `ui-settings` 列表期望 | 后续资源/supervisor 定向通过及第三轮 full Bun 最终文件结果见 §2.1；保留当时失败，不用局部计数抵消历史 |
| 16:27:56，`/tmp/chrona-consumer-resource-final.log`；[build-session](../../packages/engine/src/modules/steward/module-build-session.bun.test.ts) | 36 pass、1 fail；resources 另段 5 pass | 16:32:34 `/tmp/chrona-retirement-final.log` 的 build-session 37 pass、0 fail；17:07:44 新组合套件 88 pass。旧失败保留，不重复累计 |
| 16:32:34，`/tmp/chrona-retirement-final.log`；[supervisor](../../packages/engine/src/modules/steward/module-supervisor.bun.test.ts) | supervisor 45 pass、3 fail | 16:35:15 supervisor 48 pass、0 fail；17:07:44 组合套件再通过 |
| 16:38:59，`/tmp/chrona-integration-final-agent-application.log`；[Agent 安装集成](../../scripts/agent-integration/agent-application.bun.test.ts) | 2 pass、3 fail，`Module exceeds file limits` | 17:11:25 全 Bun 第二轮同文件先有 callback/progress 超时，隔离重试 5 pass；这保留为 flaky 历史，不能算无重试全绿 |
| 16:39:01，`/tmp/chrona-integration-final-settings-page.log`；[设置页集成](../../scripts/agent-integration/settings-page.bun.test.ts) | 2 pass、1 fail，同类安装阻塞 | 17:11:25 全 Bun 第二轮记录该文件 3 pass、0 fail；不代表全 Bun 已通过 |
| 16:38:58，`/tmp/chrona-integration-final-detached.log`；[编译测试](../../packages/engine/src/modules/steward/module-typecheck-builtin.bun.test.ts) | 2 pass、1 fail，脱离源码树检查出现额外 stderr | 第二轮全 Bun 最终失败清单已无该文件；仍须在最终发行源码/资源上验收 |
| 16:36:37 / 16:43:50 / 16:59:40，`/tmp/chrona-portability-typecheck{7,8,9}.log`，另有 16:40:29 `/tmp/s5-typecheck-final.log`；[根 TS 配置](../../tsconfig.json) | 非空错误，含退役 Executor 引用及并行修改 fixture | 17:12:11 `typecheck-final.log` 仍有 device 参数错误；17:21:21 `final2.log` 为 3 错（release fixture export、build process Promise、gap fixture）；17:23 协调记录 build Promise 注解已修。17:22:36 `final3.log` 为 2 错；17:27:18 `final4.log` 仅剩 coding fixture `sessionId` 错误。17:29:20 `final5.log` 无诊断，17:31 协调确认 root tsc exit 0；旧失败保留，现行结果见 §2.1 |
| 17:12:47，`/tmp/chrona-portability-lint-final.log`；[build process](../../packages/engine/src/modules/steward/module-build-process.ts) | `no-unsafe-finally` 与 local workspace/claim 条件诊断 | 17:20:17 root lint ratchet PASS 438 files，见 §2.1 |
| 17:11:25，`/tmp/chrona-portability-full-bun2.log`；[agent-module-calls](../../packages/engine/src/modules/steward/agent-module-calls.bun.test.ts)、[agent-release](../../packages/engine/src/modules/steward/agent-release.bun.test.ts)、[device](../../packages/remote-device/src/device.bun.test.ts) | 最终 3 文件失败：Agent scoped streams/interrupt、release upgrade、device pending cleanup/unsupported input 不应阻塞 cancel；并有上述 Agent callback 隔离重试 | 17:12 起所有者修复；17:25 发行交接报告 Agent manifest union 修复及构建定向检查通过；17:26 device 34 pass 与包级 tsc 通过。17:27 原 Agent module-call/release 与 delivery 定向通过；17:42 第三轮 full Bun 已完成 229 文件，最终无失败文件清单；notify 另有首次失败后隔离重试通过，见 §2.1，不宣称无重试全绿 |
| 17:18:20，`/tmp/chrona-portability-api-final.log`；[agent HTTP](../../apps/server/src/__tests__/api/agent-http-runtime.bun.test.ts)、[provider](../../apps/server/src/steward-provider.bun.test.ts)、[workbench](../../apps/server/src/__tests__/api/execution-workbench.bun.test.ts)、[coding peer](../../apps/server/src/coding-peer-clients.bun.test.ts) | 最终 4 文件失败：Agent capability/cancel、Provider 问答/取消 fixture 缺 TS runtime/build helpers、coding follow-up 收据预期 accepted 实得 pending | 17:23–17:27 修复 fixture；17:28:55 `api-final2.log` 完整重跑，17:31 协调确认 105 tests / 0 fail / 19 files、exit 0；原 4 文件定向 11 pass / 237 断言。这些与 server 53 项覆盖重叠，不累加 |

第三轮新增失败历史：`/tmp/chrona-portability-full-bun3.log` 中 [policy author](../../packages/engine/src/modules/steward/module-policy-author.bun.test.ts) 的 notify 重启场景首次 6 pass / 1 fail，隔离重试 7 pass。stub 收到调用时，enqueue 回复的 `call_id` 尚未落 SQLite，立即停进程会使恢复状态仍为 queued。17:41 在 [format-test.ts](../../packages/engine/src/modules/steward/external/notify/format-test.ts) 增加精确 `call.id` 的有界持久化等待，保留原重启与收据断言；17:42 policy author 新跑 7 pass，连同 baseline 9、fairness 1 共 17 pass / 0 fail。**这关闭已知断言竞态，不改写整轮首次失败历史。**

发行 HISTORY：16:49 [固定 seeds 校验](../../scripts/module-git-release.ts) 曾在 web 报 `Module seed differs from packaged source` 并保守失败；随后等待应用源码稳定。17:28 打包/catalog/lifecycle 定向 45 pass / 612 断言，后续 CLI 51 pass / 314 断言、实际 staged SDK checker 回归 2 pass / 13 断言，均非完整默认 CLI 启动接受。持久入口见 [seed 测试](../../scripts/module-git-release.bun.test.ts)、[release smoke](../../scripts/release-smoke.bun.test.ts)、[catalog 合同](../../packages/engine/src/modules/steward/module-p0-contract.bun.test.ts)、[安装生命周期](../../packages/engine/src/modules/steward/module-install.bun.test.ts)。

发行 HISTORY（17:42–17:47）：17:42 已在最终 Agent、17:37 app 和 notify fixture 修复后重新生成全部 **14 个固定 seeds**；remote-execution 为 `fb2c0833ff4fa4a0599cdced1180bfd4bd87be24`，notify 为 `c91818ad49c6a9ac3b7983e172067d3575896dde`。当时 compile/resources/CLI/SDK checker/ELF 已通过，但旧 stage 的 notify archive 已过时；17:43 最终 staging 已按新 seeds 重做。实际当前 remote-execution 固定 seed 安装通过（offline SDK tests + typecheck，`builtin: false`、execution authority 数 0），结果见 `/tmp/chrona-s5-release-final/install-result.json`；该安装探针使用辅助 host guardian，不能替代默认发行 runtime。17:43–17:44 已修复编译后 checker/installer/build helper 的显式路径，之前的 `/$bunfs/... guardian missing` 属于修复前历史；**17:46 最终交接：修复后重新编译、资源 staging、CLI/help、SDK checker、14 固定 bundles/source 校验、ELF 与 archive 检查均 PASS；实际默认 CLI runtime smoke 未通过。** 实际编译 CLI 从仓库外、隔离私有状态启动，health/迁移通过，Web 为 404，日志为 `ProcessStopUnknownError: Guardian exited without valid stop evidence`，旧 missing-helper 已消失。同一个 normalized guardian 配匹配的 `NIX_LD` 可 code 0、descendants/stopped/treeClean；受限 child env 下为 `SIGABRT`、stack smashing、unknown，证据 `/tmp/chrona-s5-release-final/helper-loader-result.json`。17:47 ELF 补查显示 `/lib64` interpreter 使用主机默认 glibc 2.44，而残留 Nix RUNPATH 指向编译器 glibc 2.42；仅修改 PT_INTERP 与 ELF 通过不能证明可移植。本机 Nix 构建产物 runtime **未接受**，须兼容原生 runner 重新证明；未放宽 safe env 或伪造停止，未安装依赖。独立设备最终复制二进制 smoke 已通过，archives 仅本地保存，无发布。

17:49 后续：临时复制 normalized helper 并移除 RUNPATH 后，清除 `NIX_LD`/`NIX_LD_LIBRARY_PATH`/`LD_LIBRARY_PATH` 的受限环境 `spawnSupervised` 探针得到 code 0、descendants/stopped/treeClean。协调已重新打开发行工作，拟在构建中去除 ELF `DT_RPATH`/`DT_RUNPATH`，再重编译、运行实际默认 CLI smoke 并重建 archives；当时正式代码及最终结果尚未交接，后续结果见下一段。因此 17:46 runtime 阻塞和下列 archive 校验均为该修复前的最后实际结果，不能将临时探针当作已修复接受，也不将此问题表述为不可避免的 Nix 主机限制。safe env 与停止证据门槛继续保持。

17:55 最终后续：[`portable-elf.ts`](../../build/portable-elf.ts) 已在构建时移除 helper 的 `DT_RPATH`/`DT_RUNPATH`，验证表边界、对齐和终止符，并保留其他动态项及共享字符串；无需 patchelf 依赖。新增发行回归 **18 pass / 138 断言**，scoped lint 与 root tsc 通过。实际打包 helper 在仅传 PATH 的子进程环境中得到 code 0、descendants/stopped/treeClean，动态表无库搜索路径项。新 CLI 编译、14 固定 seeds/source guards、资源、SDK checker、CLI smoke 与实际 remote-execution 安装通过；安装使用该打包 helper，`builtin=false`、execution authority 数 0。最初 no-install 包装器拒绝 Agent 安装属于验证脚本限制；改用 `bun install --offline --ignore-scripts` 并保留原调用的 `--frozen-lockfile` 后，**默认 Linux CLI 的完整 runtime smoke 通过**。本机结果见 `/tmp/chrona-s5-release-final/runtime-offline-result.json` 与 `/tmp/chrona-release-offline-runtime.log`，未开放网络或真实模型。新核心 archive SHA256 为 `52a89c784514f5a55cd17d7a949f68e43c2f9555c477cd5b86a1f1f62a6c28ad`；旧核心 archive hash 仅为历史。设备 archive 未变。未据此推定其他 libc、arm64、Windows 或 macOS 通过。

17:46 发行定向结果为 97 个独立测试 / 928 断言（原 smoke 环境用例重叠已扣除），scoped 10-file lint/diff 检查通过，来源 `/tmp/chrona-s5-release-final/report.md` 与 `verification.json`，不与全局计数累加。本地 archives：`/tmp/chrona-s5-release-final/releases/chrona-linux-x64.tar.gz` SHA256 `4a486c43c1ea002929c0a5eb6d05eabed6528b1a7c310d39883fc5da48797cda`；同目录 `chrona-remote-device-linux-x64.tar.gz` SHA256 `6d0823693d1a40667f0545387e2169d644e969f518ff441dc01fb5570dfb09b9`，`SHA256SUMS` 已验证。

18:36 **当前发行结果（包含物理存储改动）**：最终 14 个 Git seeds 均与资源源码树一致；remote-execution 为 `e7f05e2ef5e476eaabf35c95d11ac8cac6e3b3a8`，notify 为 `c91818ad49c6a9ac3b7983e172067d3575896dde`。发行/存储/解析器定向 **27 pass / 0 fail**；重新编译核心 CLI、shipped SDK checker、默认 runtime smoke（迁移、health、Web、认证 API）、真实可选应用固定 seed 安装、独立设备构建与复制 smoke 均通过。安装依然使用离线缓存、frozen lockfile、禁用安装脚本。两个 guardian 的 RPATH/RUNPATH 均为空，PATH-only 启动获得 code 0 与 descendants/stopped/treeClean；主机 nix-ld 会向 child 注入空 `LD_LIBRARY_PATH`，初始临时探针对环境文本的过严断言失败及复核均在发行报告保留，没有放宽生产环境过滤或停止证明。883 个源码文件 sourceguard 无漂移，两个 archive 逐文件比对通过，7 条 SHA256SUMS 全部通过。当前本地 archive：

| 文件 | SHA-256 |
| --- | --- |
| `/tmp/chrona-s5-release-final/releases/chrona-linux-x64.tar.gz` | `55c8fcd41ee7a541bf7bc8f48dc2699e277262062e12d8f05ab03d9d176943cc` |
| `/tmp/chrona-s5-release-final/releases/chrona-remote-device-linux-x64.tar.gz` | `4a86a5f4cf0be41c8f42195902f7fcab0a7031e52ed64d10e4a3bbbf227b910e` |

证据为 `/tmp/chrona-s5-release-final/report.md`、`verification.json`、`sourceguard.json`、`archive-verification.json` 和 `refresh-logs/`；对应持久构建、ELF、release smoke、seed 测试入口见本节链接。此前 archive 与 remote-execution seed 的 hash 仅为历史，不能作为当前产物身份。未提交或发布，无三平台接受推定。

17:27 cancel-before-journal 占用问题已由 17:35 native、17:36 device、17:37 app 最终修复与回归取代，见 §4.2；17:26 的 34 pass 及旧产物 hash 仅为历史。**根检查已有分次通过，full Bun 有重试历史；没有同一冻结最终修订的无重试全绿或 S6 接受结论。**

## 3. S4 原生能力与运行方法

### 3.1 当前支持矩阵

“未知/未验证”表示没有可用的原生运行证据；不按源码存在、跨平台 TypeScript 编译或被跳过的测试推定支持。

| 范围 | Linux x64 | macOS | Windows |
| --- | --- | --- | --- |
| 原生进程 helper | 本机已构建、实进程测试通过 | POSIX 进程组代码存在，原生结果未知 | Job 后端已实现，原生编译/运行结果未知 |
| 完整后代停止 | subreaper + `/proc` 收养循环至 `ECHILD`，有 `setsid` 逃组测试 | **能力缺失**：仅 group，`treeClean: false`，需要后代证明的调用方拒绝启动 | Job 原子归属、kill-on-close、空 accounting 代码存在，原生证据未知 |
| guardian 强制死亡 | 可以留下后代；结果必须 unknown、保留占用 | 结果未知；进程组不能替代后代证明 | 设计为 Job 关闭杀成员，丢失状态仍 unknown；原生结果未知 |
| 认证 loopback/模块 HTTP/预览 | 有共享实现与定向证据，完整工作流待收口 | 原生完整工作流未知；不能绕过进程监管门槛 | 原生完整工作流未知；SDK Windows 包装已同步，资源分发待验收 |
| 核心、本地 TS/Python、Coding | 有局部验证；完整回放未验收 | 未验收 | 未验收 |
| 独立设备 | 实际 RemoteDevice/生产 HTTP/Pi/签名停止/cleanup 定向通过；复制产物 smoke 通过，限本机 Linux x64 | 未支持/未验收 | 未支持/未验收 |
| 实际远程任务/模型/生产 | 未验收 | 未验收 | 未验收 |

Linux 的正面停止证据来自 [guardian.c](../../packages/process/native/guardian.c)：启动前设置 subreaper，固定原 leader 身份，清理原组并循环回收已收养后代，直到没有子进程。缺 `/proc`、helper/状态丢失或超时都不能得到正面结论。它是可信本地监督，不是对恶意同用户进程的隔离。

Windows 的 [guardian-windows.c](../../packages/process/native/guardian-windows.c) 在 `CreateProcessW(CREATE_SUSPENDED)` 时通过 Job list 原子归属，禁止 breakaway，以 `TerminateJobObject` 成功且 `ActiveProcesses == 0` 作为正面条件。当前没有原生编译运行证据。服务、WMI、提权或其他外部 broker 创建的工作不受普通 Job 继承承诺覆盖，不能把这类工作算作已监管后代。

macOS 的 [专用用例](../../packages/process/src/darwin.bun.test.ts) 应证明后代可逃出进程组、完整后代证明被拒绝。即使这个用例原生通过，也只证明正确拒绝；更强监管后端仍待设计实现，不能将 group-only 上调为完整支持。

认证 loopback 监听 `127.0.0.1` 随机端口，使用每实例 32 随机字节 token 和 `auth`/`ready` v1 握手、大小及时间界限。连接合同见 [module-wire.ts](../../packages/contracts/src/steward/module-wire.ts)：`CHRONA_IPC_ENDPOINT`、`CHRONA_IPC_TOKEN`；本机来源不能自授 caller。模块 HTTP 仍经过受控代理。复核时 [SDK process 副本](../../packages/integrations/src/steward/module-sdk/process.ts) 已与 [process 包装器](../../packages/process/src/index.ts) 字节一致，并带有 `windows-transport.ts`。这修正了较早报告中的副本未同步缺口；仍需校核打包、原生二进制及分发后的 `chrona.exec`，源码一致不等于 Windows 运行通过。

### 3.2 在每个目标平台原生运行

使用真实目标 OS 和实际要发布的架构；不通过 mock `process.platform` 验收。已有 [native workflow](../../.github/workflows/process-native-acceptance.yml) 配置 `ubuntu-latest`、`macos-14`、`windows-2022`，Bun 1.4.2 / Node 22，Windows 使用 MSVC 开发环境。**本轮没有运行该 workflow 的证据**，新增 YAML 不计为平台通过。

在目标主机的同一修订中记录环境，再运行：

```sh
git rev-parse HEAD
git status --short
node -p 'JSON.stringify({platform:process.platform,arch:process.arch,os:require("node:os").release(),node:process.version})'
bun --version
bun run --cwd packages/process build:helper
bun test packages/process/src
```

Windows 从 Visual Studio Developer PowerShell/开发环境运行上述命令，要求 Windows 10+/Server 2016+ SDK 与 C11 编译器；Linux/macOS 使用 `CC` 或 `cc`。helper 输出位于 `packages/process/bin/<platform>-<arch>/chrona-process-guardian`，Windows 为 `.exe`。编译器只是构建前提，运行时必须分发匹配的原生二进制，不能现场编译或下载替代。打包/移动 JS 后需正确配置绝对 `helperPath` 或 `CHRONA_PROCESS_HELPER`。

验收保存每一平台/架构的编译输出、通过/失败/跳过项以及测试证据；缺 Bun、Node 或编译器是未验收，不能改为静默 skip。Windows 必须实际执行 detached 三代、cancel/timeout/abort、root/owner/guardian 死亡、嵌套 Job 与 breakaway、argv/Unicode/stdio、伪造/丢失状态测试，并补受限父 Job、支持的桌面 Windows/架构及启动故障窗口验证。macOS 必须执行逃组与拒绝用例，完整后代监管仍需另一个有效后端。

进程包通过之后，还要使用发行中的 SDK/native 资源，在同一平台跑模块安装→检查→启动→调用→HTTP/预览→停止→更新→服务重启，以及本地 Coding。直接调用库、只做 helper smoke 或 Linux 合成 Windows 状态均不能替代这些集成场景。更完整的原生限制见 [NATIVE-EVIDENCE.md](../../packages/process/NATIVE-EVIDENCE.md)。

## 4. S5 已贯通路径与尚未闭环的部分

### 4.1 实际独立设备、生产入口与真实内核

[production.bun.test.ts](../../packages/remote-device/src/production.bun.test.ts) 实例化实际 `RemoteDevice`/`DeviceHTTP`，经过 `createServerApp` 的生产 HTTP 路由、真实 `remote-execution` SDK 子进程及私有 native carrier，进入真实临时 SQLite 内核。实际 Pi 1.5.0 的 native `read` 读取工作目录文件，完成两次可信内核模型预留/固定收据；设备生成的 Ed25519 停止证明由内核验证，`heldDirectory` 清空。随后真实 `kernelExecutionCleanup` preview/confirm 经应用和设备公共工作目录 API，仅删除已停止且归属正确的 worktree，源项目不变。17:17 为 1 pass / 21 断言；17:36 最终设备套件为 39 pass / 325 断言。17:35 native cold-claim 修复后再跑该生产用例 1 pass / 36 断言，新增内核已 claim、尚未 offer 时取消，验证占用先保留、设备 never_started 签名后才释放；不会额外启动 Pi 或模型调用。

这里仅 completion I/O 使用确定性假 Agent，实际设备程序、生产路由、应用 SDK、内核数据库、Pi 和文件工具均实际执行；无外部模型或外网调用。它证明本机 Linux 的实际程序闭环，不等于跨主机或生产验收。[生产入口测试](../../apps/server/src/__tests__/api/remote-execution-ingress.bun.test.ts) 另有 17:10:41 actual Pi 1 pass / 91 断言，不能与设备套件累加为总覆盖。

设备最终交接记录的复跑方法如下；本次文档工作没有执行它。须配置已审核 Pi 1.5.0 的绝对路径、使用新测试数据库，并按 §5 串行限制内存：

```sh
DATABASE_URL=file:/tmp/chrona-device-acceptance-new-test.db \
CHRONA_TEST_DEVICE_HTTP=1 CHRONA_TEST_PI_COMMAND=/absolute/path/to/pi-1.5.0 \
systemd-run --user --scope --quiet -p MemoryMax=4G -p MemorySwapMax=512M \
bun test packages/remote-device/src
```

[router](../../apps/server/src/remote-execution-router.ts) 当前支持精确 POST `device/v1/{pair,poll,report,reconcile,model}`；[binding](../../apps/server/src/remote-execution-binding.ts) 绑定已批准应用及精确 activation。owner 的 `pairing-create/mapping-set/device-revoke/status/authority/cleanup` 要求实际配置的 API key；设备 bearer 仅在应用私有存储保存摘要。请求限制 524288 bytes、严格 UTF-8/JSON。配对不构成执行授权。owner cleanup 仅处理 owner 自己创建的 work；module-owned work 必须由原 module caller 调用 `execution.cleanup`，不能伪造 module principal。

应用持有凭据摘要、映射、relay inbox/outbox 和收据；共享准入、Run、预算、占用及最终停止判定仍由内核持有。carrier 从真实 SDK 上下文绑定 `{workspaceId,moduleId,hash,activationId}`，不接收设备自报 receiver。设备 `localWorkspaceRef` 不替换不可变原生 `launch.workspaceRef`。传输中断、final 或应用 ACK 均不是释放占用的停止证明。

### 4.2 治理、恢复与可靠性收口

[carrier](../../packages/engine/src/modules/steward/execution-delivery-carrier.ts) 已接通 `revoke/cancel/reconcile/retention`，具体逻辑及定向检查见[治理实现](../../packages/engine/src/modules/steward/execution-delivery-governance.ts)与[测试](../../packages/engine/src/modules/steward/execution-delivery-governance.bun.test.ts)。16:47“真实 host 缺治理分支”、17:01“缺 model 路由/设备 cleanup”均为 **HISTORY，已被 17:12 server、17:36 device 最终交接及当前源码取代**。

| 范围 | 当前可确认状态（至 17:56） | 剩余门槛 |
| --- | --- | --- |
| 撤销/取消/核对及原 activation 排空 | 窄治理已落地；核对先于 offer；只允许原精确 receiver 排空，未知/缺失 journal 保留占用，必须有可信停止 | 最终版本覆盖完整生命周期、代次替换、响应丢失与所有故障组合；不能以已实现推定所有组合已验收 |
| cleanup preview/confirm/report | 实际 RemoteDevice 生产全链路通过；固定输入/摘要和收据先持久化，模糊崩溃状态 unknown，不重复破坏性操作 | 全发行环境及过期/冲突/越权/故障矩阵复核；unknown stop 继续禁止删除 |
| 问题与结构化 answer | 实际 Pi live question 与 `ProviderAnswer` 已接通；设备 17:36 最终套件含 pending/answered 事实与丢失回复后一次 ACK | 不跨重启重建问题、不文本注入；外部模型及完整发行环境仍未接受。17:17 应用只接受 string 的阻塞已过时 |
| 设备容量与 receiver 更替 | 17:26 已修两个 subject slots、单个 offer 拒绝不阻塞已收任务/controls；只有完整核对、旧任务全停止、零容量、旧 outbox 全 ACK 及认证 ready poll 后才换 receiver | 保留旧 target/launch，不自动重写；完整代次替换和跨边界故障接受仍待补齐 |
| source 配额与终止证据 | producer 限完整 canonical source 累计 262144 bytes / 512 reports，再生成连续显式 gap 并停止原生进程；app 独立预留 gap 4096、final 262144、stop 81920、cancel/ACK 16384 bytes。17:37 最终 exact wire bytes 预留后应用 liveness 2 pass / 15 断言，原 SDK SQLite 套件通过 | 逻辑配额和有限物理存储已实现并验证，不允许静默丢序号/假 ACK；安全归档与容量回收仍未完成 |
| 轮询公平性 | app 持久轮转、controls 优先、跳过不适配项并按完整 wire bytes 预留；native 持久 `offeredAt` 水位、冻结时钟下也轮转，controls 与 cold claims 均能前进，收据也轮转。17:35 修复尚未 offer 的已取消 claim 被跳过 | [公平性回归](../../packages/engine/src/modules/steward/execution-delivery-fairness.bun.test.ts) 1 pass / 17 断言、原生 21 pass / 179 断言；[应用 liveness](../../packages/engine/src/modules/steward/external/remote-execution/liveness.bun.test.ts) 最终 2 pass / 15 断言。覆盖 >100 pending controls，不等于 >100 delivery journal 恢复接受；完整故障组合仍待验收 |
| 取消早于设备 journal | 已修复：app 仅对 never-launch-authorized、非隔离、active+ready 的 held identity 中继 `launchable=false` 和精确 cancel；设备经完整认证核对后先写 journal，再签名 never_started、cancelled final 与 durable ACK，不调用 driver。drain-only 不置 possible-launch offered 标记，丢失回复后可安全重放 | 17:36 设备 39 pass / 325 断言；17:35 native cold cancel 修复后生产 HTTP 再跑 1 pass / 36 断言。既有 spawn_possible/running/unknown 或先前授权却缺失的 journal 继续 unknown/保留占用，不能伪造停止；完整代次/故障组合仍待接受 |
| 存储/发行 | journal 保留证据，100 deliveries、无 GC；app/device 已实现逻辑配额、128 MiB SQLite 页数上限和实际证据预留。物理改动后的 14 seeds、核心与设备二进制已刷新，完整本机 Linux runtime 和独立设备 smoke 通过 | 有限 SQLite/回滚日志已验证；安全 GC/retention、超过 100 delivery 恢复未完成；foreign Linux/libc、arm64 仍待接受；本机默认 Linux CLI 已在正式 RPATH 修复后通过离线 runtime smoke |
| 旧链路 | 退役内核设备表/Executor 路径及旧 server router/runtime/auth 测试已有替代与删除；root tsc/API 已通过，full Bun 最终文件无失败清单但有 notify 重试 | 17:46 资源/staging 通过；runtime RUNPATH 修复重新打开，最终重跑待交接，完整平台矩阵尚未闭环 |

### 4.3 模型库与独立产物的边界

[`@chrona/remote-model`](../../packages/remote-model/README.md) 已提供 `createRemoteModelGateway`、`startRemotePi` 及 `events?: ProviderEvents`；实际 Pi native tools、live questions、内核预留/固定模型收据和应用重启后 pending unknown 不重发均有定向证据。模型文本工具协议为 `chrona.remote.text-tools.v1`，不支持的图像/options 明确拒绝。每次实际请求绑定不可变 key/完整 delivery；执行前预留次数和输出预算；pending/unknown 不换 key 重试，无 provider 凭据回退。

[`kernelPiDriver`](../../packages/remote-device/src/driver.ts) 是生产路径，[CLI](../../packages/remote-device/src/cli.ts) 使用已配置、审核的 Pi 1.5.0 和可信模型网关。旧 `governedPiDriver` 不可用占位及 `MODEL_GATEWAY_GAP` 仍用于缺前提时拒绝；**它们不再代表已配置生产路径一律拒绝**。缺 Pi 或网关失败继续 fail closed，不引入任意进程/凭据旁路。

[构建](../../packages/remote-device/scripts/build.ts)及[复制产物 smoke](../../packages/remote-device/scripts/smoke-build.ts)已在 17:36 最终 cancel-before-journal 修复后重跑通过：从仓库外、空 PATH、无凭据/外网启动，验证私有配置、嵌入资源、提取 helper 的真实后代停止与篡改拒绝。当前 `dist/chrona-remote-device` SHA256 为 `29e7868be088657c65c2c202cd3883969aedb6b6fb5cbd2392f09bc9d6e0ee2b`；17:26 的 `06eb4043…` 已被取代。该产物和本地 archive 不是跨平台发行接受；本机 Nix smoke 显式使用与编译器匹配的 `NIX_LD`，不能据此证明其他 libc/loader 可运行，也不能替代核心默认 CLI 的 runtime smoke。产物嵌入 Bun、公共 adapters/extensions/native helper，实际完整 Pi CLI 1.5.0 是另行安装、显式配置的依赖。仅本机 Linux x86-64 已验证，foreign Linux、arm64、macOS/Windows、跨主机和生产环境仍未验收。

## 5. 最终检查与接受门槛

以下供最终修订复跑；helper 修复后 root tsc final7、lint final4、边界 final2，以及先前 API/schema 已有分次通过，第三轮 full Bun 已完成且有 notify 首次失败后重试通过。helper 路径及 notify 最终修复另有定向证据，默认发行 runtime smoke 的 17:46 阻塞已由 helper 路径和 RPATH 修复关闭，17:55 正式产物在离线冻结安装下通过实际 runtime smoke；没有同一冻结最终修订的无重试全绿结论。使用已安装的工作区依赖与新临时数据；重型检查串行且限制内存。Linux 示例：

```sh
systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=1G env NODE_OPTIONS=--max-old-space-size=6144 bun run typecheck
systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=1G env NODE_OPTIONS=--max-old-space-size=6144 bun run lint
systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=1G env NODE_OPTIONS=--max-old-space-size=6144 bun run check:boundaries
systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=1G env CHRONA_TEST_CONCURRENCY=1 bun run test:bun
systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=1G env CHRONA_TEST_CONCURRENCY=1 bun run test:api
```

这些命令逐项执行、逐项保存退出码和日志，不并行挤占内存。macOS/Windows 原生检查需要平台原生或 CI 提供的资源上限，使用对应 shell 设置环境变量并调用同名脚本；本机没有验证其资源限制配置，不能把 Linux 的 systemd 命令照抄为原生证明。systemd 不是核心运行前提。

可先复跑已知收口点；测试 runner 为每文件准备独立数据和 helper，避免测试环境串扰：

```sh
CHRONA_TEST_CONCURRENCY=1 bun run scripts/run-bun-tests.ts \
  packages/engine/src/modules/steward/module-supervisor.bun.test.ts \
  packages/engine/src/modules/steward/module-build-session.bun.test.ts \
  packages/integrations/src/steward/script-sdk-resources.bun.test.ts
bun scripts/generate-contract-schemas.ts --check
```

需要补齐同一最终修订的以下证据才能接受 S6：

1. 全局检查通过，已知失败逐项关闭；hash golden、transitions/additions、依赖边界和发布资源一致，旧 Executor 路径及失效引用清除。
2. 每个受支持 OS/架构原生构建并跑监管与实际分发 SDK 集成；能力不足明确拒绝，unknown 不释放占用，Windows/macOS 不借 Linux 结果宣布支持。
3. 无远程应用的核心、本地 Coding、实际普通应用和独立设备四种组合完整回放；断连、响应丢失、重启、取消、撤销、清理与应用生命周期均有真实边界证据。
4. 实际 Pi 请求经可信模型网关执行预算，无凭据旁路；已有本机实际设备程序与假 completion 的确定性通过，仍须覆盖剩余故障与实际分发环境。外部模型或跨主机接受结果另按具体环境登记，自动化不调用真实模型。
5. 按方案 §11 保存新数据目录中的 Agent 对话/Coding、当前会话创作（Agent 在已有 Run 中构建、Author 提交精确材料）及 events/notify/web hash 绑定回放和截图；记录准确修订、平台、命令、通过/失败/跳过及限制。绿色局部测试或历史 smoke 不代替此步骤。

本记录确认实际独立设备程序与 Pi 的本机确定性全链路通过；不声明外部模型、跨主机设备、其他原生平台或生产接受。S0–S3 的“已实施”与 S4/S5 的定向通过均不能提前关闭 S6。
