# 阶段 8 摘要

基准 `7f067370d1319734f9b64adfe88bedd725c618c8`。本阶段保留只读预检、成对备份恢复验证和离线发行验收，删除没有实际切换消费者的本地 delivery 包装器。修改均在隔离工作树本地，未暂存或提交。

## 实施结果

- `scripts/deployment-controls.ts` 和 package scripts 提供 `preflight`、`backup`、`accept` 三个入口；删除 `deployment:deliver`、授权/停机 JSON 与 `delivery.json`。
- `preflight` 使用显式 `--database-url`，复用 SQLite URL 解析及 `inspectSqliteRuntimeLock`，要求活 owner PID 与请求 PID 相同，支持位于 `dataDir` 外的数据库。失败仍输出 `passed: false` JSON，CLI 退出非零。
- 资源根复用 `packages/cli/src/start-server.ts` 的 `findResourceDir`。无参启动保留原顺序；预检以目标 `/proc` 的 cwd/cmdline/exe/env 为输入，支持相对资源覆盖、启动路径邻接资源、显式 package 路径和可识别源码 CLI 入口；自定义 wrapper 隐藏全部资源证据时明确报原因，不用检查器路径猜测。
- 状态查询不再把缺表当零；补齐待回调、全部未接受 outbound receipt、未确认停止或仍占目录的 execution、未解决 workspace cleanup。终态 Run 保留当前值，`never_started`/`stopConfirmedAt` 结算不要求 Run.stopStatus 一律 confirmed。移除重复 `unknownCommands` 和未使用 warning 类型。
- `backup` 复用既有运行锁、快照、四个受控数据根及 restore 检查；只证明选定数据库及 `platform`、`sessions`、`secrets`、`qq-bot` 成对材料可恢复。Provider profile 和其他自定义目录需单独归档；调用方仍需核对实例配置。
- `accept` 先限制 `--release-dir` 与 target 标准目录一致，再复用 `smokeRelease`；不再出现检查同级目录而报告请求目录通过的情况。默认离线。
- operations 记录实际归档解包后验收、排空停服观测、同实例备份和受控切换步骤。13 个独立应用均重新只读核对为 clean main、HEAD 与 pin 相同，DEVELOPMENT.md 存在且纳入恢复材料；应用、CLAUDE、AGENTS、pins、Nix、schema 和合同均零修改。

## 证据边界

首轮问题依据两份独立 BLOCK 报告和直接消费者源码确认；首次修订未在编辑前独立运行原实现复现，不补造当时的修前执行记录。修后 regression 使用全新系统 tmpdir、真实初始迁移 schema 和外置数据库，测试 CLI 子进程的 JSON/退出码、实际子进程锁 owner、相对资源根、缺表、终态/未知停止、待回调、cleanup/outbound receipt、四根备份恢复、运行锁拒绝和错误发行目录。

历史 `r1` 因 systemd 未继承 PATH 找不到 cc；历史 `r2` 的原日志和 result 确认 exit 0、98 个关联文件通过。旧单项 preflight/backup/accept 等无原始日志的记录改为 unverified；旧记录的相对 release-dir 本就会被拒绝，不作为新修复。旧发行 identity 实为 `694f2d9d + modified`，不是 clean `7f067370`。r4 重建记录 `7f067370 + modified`，与旧制品证据分开。

此前 r4 串行服务 `chrona-cleanup-stage8-remediation-r4.service`，PID `1650819`，MemoryMax 8G / MemorySwapMax 1G、Node heap 6144、并发 2，继承 PATH/Prisma 并使用基准 `7f067370`，于 `2026-11-16T22:44:29.789431+00:00` 结束；服务 Result=success、ExecMainStatus=0：78 项定向测试、新构建、精确目录离线验收、归档解包离线验收及最终 slice 全部通过；slice 的 lint/type/guardrails 和 99 个关联测试文件通过。r4 后关闭复审仍发现 F1/F2，修订结果见下节。

r4 当时生产切片 +251/-11、净 +240；测试 +233/-2、净 +231。当前净行以 `stage-8-evidence.json` 的重算结果为准。前两次任务运行器误用 workspace 父目录造成 discovery OOM，失败结果保留，修正 cwd 后 r3 及最终 r4 成功，未把失败改写为通过。全库历史 lint 债务、阶段 6 Bun 单轮失败和未真实部署/使用验收的边界保留；slice 关联文件通过不等于完整 Bun/API 单轮全绿。

## 最后两项 BLOCK：r5

关闭复审仅余 F1/F2，本轮只改部署脚本两处表达式及对应测试。`unsettledCalls` 沿用 module-remove/retention 已有合同，增加 `status = failed AND error IN (unknown, internal)`；普通已知 failed（forbidden）和无 error 的 failed 仍可通过。源码入口的隐式 package 根从入口目录退两级，对齐启动器的 `/repo/packages`；显式 package 值包括空字符串仍由原 `??` 处理，启动器及其无参语义没有再次修改。

先新增真实 schema/CLI 回归并在修前运行：33 pass、3 fail，unknown/internal 错误退出 0、源码隐式 package fallback 错误退出 1；原始日志及生产源码快照保存在 `stage-8-remediation/r5/before-fix-tests.*`。F2 测试启动临时 `/repo/packages/cli/src/bun-entry.ts` 子进程，用真实启动器源码的无参解析、不设置 resource/package override，并由预检读取真实 `/proc`，确实依赖隐式 package 候选。

最终 r5 服务 `chrona-cleanup-stage8-remediation-r5-r2.service`，PID `1717489`，从 `2026-11-16T23:01:52.521654+00:00` 到 `2026-11-16T23:05:58.962538+00:00`；规定的 8G/1G、串行、PATH/Prisma、base7f067370、concurrency2 条件下全部 exit 0。部署定向 36 pass/0 fail、ESLint 零新增，最终 slice 的 lint/type/guardrails 和 99 个关联测试文件通过；源码 SHA256 冻结核对一致。初次 r5（PID1699443）的两条测试环境类型诊断使 slice exit1，虽然 99 个关联文件通过；补显式 NodeJS.ProcessEnv 后重新冻结并完成本轮最终检查，失败日志没有覆盖。等待父协调者独立关闭复审，不暂存或提交。

仅非发行的部署脚本改变，doctor、启动器、build/smoke 同源码结果沿用 r4，不重复运行；r4 日志和 dirty 制品保留，归档与 identity 的 SHA256 重新核对均未变化。生产本轮 +3/-2（净 +1）、测试 +41/-0；阶段累计生产 +252/-11（净 +241）、测试 +274/-2（净 +272）；文档及总净行见 evidence。
