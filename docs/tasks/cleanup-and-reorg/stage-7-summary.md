# 阶段 7：深层审查与最小修复

基准 `0ec3e2d1e38d2c6d29c177a09f82a30693036ea1`，开始时工作树/index 干净。状态：`implemented-directed-final-slice-passed-awaiting-independent-review`。未暂存、提交、改应用 pin、改公开合同或生成生产材料；父负责独立审查及本地提交。

## 发现与修复

| 发现 | 真实触发／消费者／根因 | 最小修法与可观察差异 |
| --- | --- | --- |
| HTTP listener 无诊断 | server `app.ts` 代理经 runtime.listener 冷启动/等 HTTP readiness，supervisor 抛错后只返回 null；超时、停机、禁用等原因消失 | `module-supervisor.listener.failed` 记录 moduleId/hash/path 和脱敏原因，仍返回 null；既有四种 readiness 失败场景验证日志 |
| 固定调用回执提交失败丢根因 | `privateInvocationFinish` 同事务更新 Invocation 和 transcript，异常改写 unknown 后调用者只能查询固定 callId，日志无 SQLite 原因 | `module-calls.receipt.commit_failed` 增加脱敏原因；真实事务失败后仍 unknown，同 key 不重投，fake 应用只执行一次 |
| Provider finalization 不可诊断 | `finishProvider/finalizeProvider` 的 finish、interaction、capture、done 拒绝只有空 details 审计或静默 catch；审计自身失败也丢原因 | 增加带 runId 的脱敏原因日志，先去除当前 Run token；保留审计、pending retry、unknown 占用及 actual Provider exit 证据，无新持久状态 |
| 用户决定在 waiting 前到达会丢失 | `system/approvals.moduleRequest` 先提交 Approval，稍后 `deliverSystemRow` 捕获 AwaitUser 将 Invocation 置 waiting；中间 resolve 调用的通用 settleWaiting 仅匹配 waiting。真实 DB barrier 证明 Approval 已 approved、Invocation 最终仍 waiting，下一 pass 处理0条 | resolve 在同一原事务中仅结算精确 workspace/callId、`system:approvals.request`、async、原 module caller/id/hash 的 running 或 waiting Invocation，并清 lease 和已有 retry error；原 deliverSystemRow 的 status+leaseToken 条件拒绝旧等待写入覆盖。通用 settleWaiting 保持原合同。`isModuleRequest` 补其类型声明已要求的 hash 字段检查，防 malformed payload 省略 callerHash 查询条件 |

审批修复的必要行为变化只有：决定先到时立即产生原固定回执 succeeded，随后旧 waiting 写入不覆盖它。授权仍是原审批单次具体决定；同步调用、其他目标、其他 workspace/caller/hash 的 running 调用不会被结算。重复 resolve 不重新交付；未知外部效果不重放。

状态机四类反例均接真实消费者：`run-recovery` 使用终态释放 foreground 槽位及显式应用重试产生新 Run/token；`module-calls` 使用超过20条 unavailable 调用的阻塞头和健康尾；`module-requests` 用 approve/deny × 租约恢复重入表驱动、真实 writer barrier 比较决定前后交错。另验证五类错绑定不被结算、lease 清除、重复 key/决定及 fake 应用收到原 call_result 后不被重复决定重新开启投递。

## 审查后保留项

- `ModuleInvocation` keyed receipt 是 previousCall/callStatus/去重和 transcript 的读源；90天后只清 payload，保留 consumed key，unknown 与未交付 reply 不按年龄清除。
- `ModuleRun` 有预算、事件结果、诊断和 timer recovery 消费者；readOnly 已有 retainHistory:false，模型事件需预算身份时仅保留必要结果行。
- `ProviderLaunch`、`AgentRunProvider/Admission`、completion `ModuleCall` reservation 与 completion `RunEvent` 约束原固定操作、caller 预算和结果一致性；`settleRunCompletion` 同事务结算。finished 但无完成结果不证明可释放。
- Run/ExecutionAttempt/Delivery/Command/Receipt/Authority/Source/Checkpoint 有准入、恢复、控制、签名停止或清理消费者；unknown 停止继续占配额。实际停止字段及事务内校验未削弱。
- `KernelFact/Consumer` 经 facts/ack/withdrawals 消费；Notify 私有持久化后 ack 再投递，withdraw tombstone 跨消费者保留。当前 retention 只在原消费者已移除后清有限已消费非撤回事实。
- `activated.json` 的 signature/unconfirmed 由 announcement 恢复读取，先持久化再 dispatch，未知不重放。不是可任意删除缓存。
- Timer claim/dispatch/recovery 使用 revision、exact eventId/module/hash 和最终预算核对；未把进程消失当成重放授权。
- `close` 失败保留 stopUnknown 实例与 liveHashes 所有权，禁止替代/重启；shutdown 聚合传播。原若干 close/start observer 的拒绝已有下游 failure/stopUnknown 消费者，不机械替换。
- 阶段6指出的 `callsSettled` catch 是 join 等待器；原 `drainCalls` Promise 向启动它的消费者传播，tick/approvals/provider-channel 各自记录原因。核实后保留原代码，没有用 allSettled 改写来掩盖静默失败。
- `agent-recovery` oldest10：当前普通 Run 每 workspace 三个 lane 各仅准入一个 running/unknown；未证实正常准入能形成十个未知普通 Run 的阻塞头，不添 cursor。

两个范围外方案：Timer 的100个总 ID 上限是否改为100个 active ID（目前 cancel/done 可用原 ID 覆盖）；cleanup 长期回执是否需要独立身份/载荷留存政策。这些约束有存储/幂等读者，改成 active quota 或自动删除涉及产品与留存语义，本阶段未实施。未发现可凭本次证据直接删除的无消费者持久化。

## 验证与限制

日志 `.tmp/cleanup-and-reorg/stage-7/`，详细退出记录见 `stage-7-evidence.json`。

- 初轮直接 `bun test`：121 pass / 5 fail，保留。四处新增日志断言误期待 SQLite trigger 原文；实际 Prisma 适配器报告 `Foreign key constraint violated`。另一处原 rejected completion 分支在 `local-runtime.ts` 的5秒 status 轮询处遇到 `bun test` 默认5秒时限。未改生产轮询、测试 timeout 或加延时；项目正式 runner 本来每文件20秒。
- 修正实际异常断言并用正式 runner：三个文件126 tests通过。初轮与 debug 失败原样保留，不称单轮全绿。
- 审批真实 barrier 修前 exit1：approved + waiting，下一 pass0条；同脚本修后 exit0：succeeded 保持原决定，下一 pass0条。首次 scratch repro 缺 keepAlive、manifest 不合法导致 admission forbidden，已纠正 fixture 并保留失败，不算竞态证据。
- race 定向五文件139 tests通过；随后增加真实 call_result 后12 tests通过；最终增加租约恢复重入后 module-requests 14 tests / 97 assertions通过；自查实际重入回执仍携带旧 retry error，已补 success 的 error:null，并增加无 error 断言，14 tests / 105 assertions通过。四类 harness 均真实 DB，不以 harness 自测替代。
- 必要 API 两文件 rescue/runtime：15 tests通过；曾误把 API 文件传 Bun runner，入口拒绝，实际业务测试未执行，该 exit1保留；随后用正式 API runner通过。
- 诊断补丁 before-race 完整 `verify:slice` exit0：ratchet零新增、typecheck零错误、guardrails含boundaries通过、100关联文件通过。该结果不作为后续审批修复证明。
- 审批修复 r1 完整 `verify:slice` exit0：ratchet/type/guardrails通过、102关联文件通过；日志 race-r1-verify-slice.log。补清 stale retry error 后的最终完整 slice 已启动：`chrona-cleanup-stage7-race-final-r2.service`，runner PID1463458 / child1463461，2026-11-16T21:35:15.358Z。`results.json` 产生后才可据其实际 exit验收；该服务在交接后持续运行。
- 三轮完整 slice 和正式定向均限 MemoryMax=8G、MemorySwapMax=1G、Node6144、concurrency2，继承 PATH/Prisma schema engine，lint基准0ec3e2d1。

生产手写 `+40/-14` 净 **+26**；测试 `+203/-3` 净 **+200**；生成 **0**、应用/依赖/锁/bundle **0**。文档单列。未改状态 derivation、Run 队列或签名停止合同；唯一状态变化为审批精确请求的提前结算。

未重跑广泛 full Bun/API/build/smoke、三尺寸浏览器或材料 assemble：无广泛产品、UI、构建或应用材料变化。阶段6的351通过文件+fixture17测试组合覆盖、原full Bun失败和全库lint193 errors/1033 warnings仍是原有证据；本轮 ratchet通过不等于全库lint绿。无真实模型/QQ/账号/数据库迁移、部署、NixOS激活、push或原Chrona目录写入。

最终 r2 `verify:slice` 已于 2026-11-16T21:39:21.188Z exit 0 完成，102 个关联测试文件通过；日志 `.tmp/cleanup-and-reorg/stage-7/verify-slice.log`。
