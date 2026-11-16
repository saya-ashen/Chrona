# 阶段 7：深层审查计划

基准 `0ec3e2d1e38d2c6d29c177a09f82a30693036ea1`，开始时工作树及 index 干净。只读追踪真实符号与消费者后修证据充分问题；不重做阶段6搬迁、生产材料生成或既有全量测试，不修改 contracts barrel，不提交/暂存。独立审查和本地阶段提交由父执行。

## 审查面与初始事实候选

| 审查面 | 起点／事实候选 | 证据要求 |
| --- | --- | --- |
| 应用生命周期和停止 | `modules/module-supervisor.ts` 的关闭、restart、stop；原 review 指出 close catch | 追踪 retirement/stopUnknown/实例占位、实际进程停止与调用方；catch 是否已经记录原始原因 |
| 异步调用和回执 | `modules/module-calls.ts` 的 dispatch/settle/recover/stop | 固定 callId/请求 key、丢失投递不可重放、pending loop 的失败消费者和停止日志 |
| tick 生命周期 | `tick.ts` 的后台 Promise、停止与 finalization | 区分已在链路上报的拒绝和真正静默失败；不机械改 catch |
| Run 队列、配额与状态推导 | `agent/`、`execution/`、domain policies | unknown 停止继续占用、终态释放、lease/cancel/budget、阻塞头/显式重试/交错结算 |
| 事务与持久状态 | notification facts、agent/module receipts、timers | 写入者 → 真实读取者 → 留存/清理，错误是否传播；不凭表名判断无消费者 |
| 异步回执和通知 | provider completion、notification facts、call_result | 先持久化、原固定回执查询、重启不重放未知外部效果 |

## 追证后实施候选

- HTTP listener 失败返回 null 前未记录根因；真实消费者为 server HTTP proxy / runtime.listener。仅增加脱敏原因日志。
- keyed sync receipt 事务失败改写为 unknown 后丢根因；固定 callId 仍需保留防重放。仅增加脱敏原因日志。
- tick finalization/interaction/capture 原有审计为空 details，审计失败也被吞，重试队列继续占用却不可诊断。只记录原因，不改变停止证据、重试或结果合同。
- 审批跨事务竞态：`system/approvals.moduleRequest` 提交 Approval，`deliverSystemRow` 稍后置 Invocation 为 waiting；resolve 在中间到达时，`settleWaiting` 只接受 waiting，会丢失决定。父确认这是已授权明确缺陷，要求先真实 barrier 复现、再仅对精确 workspace/approval/caller/hash/async/request Invocation 允许提前结算，不放宽通用 settleWaiting。先让诊断补丁的完整 slice 完成再改其覆盖源码；之后重跑最终 slice，旧结果标为 before-race。补四类真实状态机消费者边界和必要 API 验证。

## 实施及验证边界

- 保持宏观架构和公开合同；新增校验必须指向真实失败对象。广泛产品/API建议单列，不实施。
- 优先删除真正无消费者状态/冗余代码，不加防御框架或 trusted-local 同 OS 身份比对。
- 只改变错误诊断时，验证真实拒绝原因可见及原完成/停止语义；若改变状态机，则表驱动覆盖 `state-machine-invariants.ts` 四类边界。
- 临时数据、fake provider，无真实模型/QQ/账号/数据库/部署/激活。
- 日志 `.tmp/cleanup-and-reorg/stage-7/`；先定向，最终完整 `verify:slice`，`LINT_RATCHET_BASE=0ec3e2d1`，8G/1G、Node6144、concurrency2、继承 PATH/Prisma engine。记录真实 exit，ratchet 不冒充全库 lint。
- Serena/Hindsight 当前子 agent 工具不可用，使用原生 `rg` 和仓库决策文档。阶段6旧失败、组合覆盖及 Pi 跨根构建限制原样保留。
