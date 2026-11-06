# P2：固定设备、有界并发与工作协议

状态：**协调者于 2026-11-06 冻结 `P2-20261106`；R/Q/U 实现与 M3 开发集成验收已完成**。实现、19 项矩阵、实际 compiled CLI 与真实 host 闭环、独立复核及环境限制见 [M3 验收记录](chrona-workbench-m3-acceptance.md)与[统一方案](chrona-workbench-unified-development-plan.md)。本文保留冻结时的职责和契约说明；冻结本身不是验收证据，不代表生产部署、真实模型或其他平台原生执行已验证。

## 版本与工作边界

保留 `chrona.execution.v1`、十三 op、现有 fixtures 和单服务端执行行为。新增显式 `chrona.execution.v2`，所有十三 op（包括 events）POST 到既有 `/api/editor/v1/commands`，使用相同 owner API_KEY 认证。v2 的 start 为 `{op:"start",input:{kind:"execution"|"group",...}}`，响应按原 requestId 与 op 校验；不支持版本明确失败，不自动换服务端、降版本或再次 start。执行详情仍是同一条 v1 normalized event/snapshot 流；恢复顺序 snapshot 后 get 工作投影，父工作没有伪造 Run。

父与简单依赖只由 coding 持有。一层最多 20 子，图一次登记冻结，子 workId/commandKey 唯一、只依赖同父其他子且无环。独立创建的叶不能事后冒充某父的子。前置实际完成、确证停止且发布可核验成果版本后，记录消费的精确 resultRef 再派发；失败、取消、未知或缺成果均阻塞。依赖只表示顺序与成果上下文，不自动应用、提交或合并代码。父取消先持久关闭新派发，再逐个请求已派子停止；全部确证停止前不能显示安全取消。

工作选择绑定 executorId/projectRef/mappingRevision、明确 baseline 和 existing/independent_worktree。独立 worktree 从明确 commit 创建，不复制未知 dirty 内容。用户输入不含主机路径、任意 Git 参数、caller、能力或设备凭据。准入之后不自动迁移、换位置、换基线或重跑；新尝试必须是新 workId。queueExpiresAt 在首次准入验证 `now < expires <= now+24h`，相同 key 的已存回执先查，重放不重新计算期限。运行预算只从 claim 开始。

请求与完整响应信封分别最多 256KiB；source manifest 最多 100 文件/32KiB，按磁盘原始字节 SHA-256。列表按字节预算缩页并返回 after，不截断或静默丢工作。所有 ref、版本和预算在公共 zod 与 TS/Lua fixtures 中一致。

## 实际源版本

本版采用“保存用户明确关联范围，再核验磁盘版本”，没有隐式上传未保存 buffer。Workbench 本地 root 是用户选择的核验来源，不是服务器路径授权；只保存明确列出的 buffer，写失败或 changedtick 变化即停止提交。服务端/设备在实际 claim 核验精确 baseline 与 manifest；不符则阻止启动。

非空 source manifest 成功后回传绑定 placement、baseline、规范 manifest 摘要、文件数、verifiedAt 和 stage=claim 的 sourceReceipt。省略/空 manifest 没有文件内容核验回执，不能表示整个项目与本地 buffer 一致。基线 commit 核验与 dirty 文件核验分别显示；queued 期间的早先检查不冒充实际使用版本。

## 停止与进程归属

设备主动 HTTP 轮询，不把原 loopback Provider bridge 开放到网络。协议独立 `chrona.executor.v1`；设备凭据、assignmentId、generation 与 attempt 必须精确一致。固定心跳 10 秒、失联宽限 60 秒；在 grace 到期或本地运行期限到期后停止所属进程树并保留现场。未知、仅父 PID 退出或可能重用的 PID 都不释放占用。

共享同一 PiRun/RPC/detail 实现，可信 launch hook 提供 stdin/stdout/stderr、closed Promise 与 kill。普通服务端 direct-child 语义保持；设备的 closed 只有在独占 systemd user transient service 的 invocation/cgroup 身份一致、完整 cgroup 已空后才可 fulfill，不能确认则 reject。服务必须使用 `KillMode=control-group`、`ExitType=cgroup`。Linux/systemd 可用性在执行前检查，不支持则明确不可执行；本版不伪称其他平台有等价停止保证。

隔离的真实 systemd 262 probe 已证明 JSONL 管道、三代不同进程组的同 cgroup 归属、父退出后继续等待、停止后 aggregate populated=0 和 writer 停止；它只证明所选原语，不能替代重启 journal、身份校验与最终 R 验收。

## 容量与目录

唯一工作队列仍是 Run。编码执行全库 4、每 executor 2、每 immutable module 应用 2；owner 提交保守合并为同 workspace/owner 桶。所有 `startedAt!=null && stopConfirmedAt==null` 的编码 attempt 计槽，包括 unknown、过期、已请求取消或已撤权。未 claim 的离线工作不占运行槽，仍按当前准入策略预约写目录。同 session 的 running/unknown 排他。

普通 foreground/build/非编码 background 保留原 lane 与日预算规则，不借用编码槽。写目录身份绑定 executor，两个受信 alias 的同物理目录不能以 revision/label 绕过 hold。所有 claim、回执验权、最终 snapshot、停止证据及占用释放在 SQLite 写锁/同事务边界内完成；迟到旧 generation/assignment 回执不能更改新状态。

## 成果与清理

设备只回传有界 normalized event 与有界 changes，服务端仍发布原 immutable coding 成果；sourceSeq/digest 去重与统一 storedSeq 在同事务提交，不造第二事件流。最终回执丢失时读取原稳定回执，不重跑。成果比较分别校验两份原 SHA/身份/baseline，partial/unavailable 明确展示；不拼可应用的合成 patch。

worktree 默认保留。清理使用独立窄 owner `coding.workspace-cleanup`，preview 与 confirm 分离，confirm 必须携带精确 previewDigest 和独立稳定 commandKey；重新检查占用、dirty、未集成提交及保留选择，状态变化或未知则拒绝。只清理有明确所有权、已停止且无待保留内容的树；不把 accept/cancel/detach 当删除。确认失回执后同 key 查原 receipt，不能重建删除动作。

## 清理传输补充（2026-11-06，协调者冻结）

为完成原清理交付，设备清理复用现有 authenticated poll/report；不新增 HTTP 路由、执行队列或 Pi RPC。poll 可选 `cleanupOperations`、report 可选 `cleanupResults` 各最多 4 项，原总字节预算和 active 身份检查不变，drain 不获得清理权限。缺字段保留原协议行为。

操作绑定原 `target`、`launchDigest`、`workspaceRef`、数值 `mappingRevision`、可空 `sourceReceiptDigest`、原 `WorkCleanupInput` 与 `requestDigest`；摘要是去除自身 `requestDigest` 后整个操作的规范 SHA-256。`target.workId` 必须等于 input.workId。结果为 `{commandKey,requestDigest,receipt}`；服务端核对原持久操作、report.target 和 receipt 的精确身份，不将设备传入值直接当授权。

默认 `retained:true` 表示不自动删除，精确 preview/confirm 可请求处置；额外显式保留保护不能被 confirm 覆盖。清理必须重查真实所有权、已确证停止、无占用、当前映射/设备身份、干净目录和已集成提交。服务端不读取设备路径；设备操作只定位本地已登记的原 workspace。先持久请求、意图和回执再发送或删除；重复 key 核对原请求/回执，删除结果不确定不得重放。默认保留与显式保护的持久事实已由实际 cleanup 和恢复测试核对；具体证据见 M3 验收记录，不能只凭此补充的冻结状态宣称验证通过。

## 崩溃恢复的 final 停止补证（2026-11-06，协调者冻结）

本机在核验源版本后、允许 spawn 前持久保存 prepared sourceReceipt；旧 journal 缺少该事实且 manifest 非空时保留 unknown，不重新读取磁盘冒充原 claim 核验。恢复只在原可信 manager observation 已持久后，为没有 final 的原尝试产生 `unavailable`、`missing:true`、无 changes 的 final；已有 final 始终不可替换，不重启原 Pi。旧 incarnation 不获得 started、progress 或普通 report 权限。

仅为处理首次 started 回执未到服务端的崩溃窗口，final 事务可补记缺失的原 processIdentity/sourceReceipt：当前凭据必须属于 owner 已独立授权的同 executor/generation active 或 recovery 身份，原 assignment 已 offered，完整 ref 与原 launchDigest 匹配，manager cgroup_empty 的稳定 unit 必须由原 executorId/assignmentId 推导。final 仅允许 unavailable、missing 且无 changes，sourceReceipt 必须精确核验原 manifest，throughSourceSeq 不低于服务端 watermark；已有 sourceReceipt/identity 不能被不同值覆盖。drain 不得首次建立该事实。全部核验、补证、final 与确证停止同事务完成；缺证明仍占槽和保留目录。

## 共享实现与持久身份（2026-11-06）

以下共享实现与 R/Q/U 已整合，实际证据见 M3 验收记录。权威字段为 `contracts/steward/executor.ts`、`execution-v2.ts`；内部回调为 `engine/steward/ports.ts`。`generation` 是安全代际；`incarnation` 是 daemon 每次启动生成、原子落盘的实例 ID。两者不能互代。`assignmentId` 是 claim 事务生成的稳定 launch key，每个 attempt 仅一个；不用 PID、workId 或 HTTP requestId 替代。

- `ExecutionAttempt` 增加固定 executor/generation/mappingRevision、directoryIdentity、queueExpiresAt、workspaceRef/mode、sourceManifest/receipt；device 的 resolvedCwd 必须 NULL，Run.cwd 仍是服务端日志目录。v1 的 server/default=1 与 queueExpiresAt=NULL 保持原行为；仅 P2 准入要求完整非空绑定，不伪造旧数据的 source receipt。
- `ExecutionExecutor` 存 owner/workspace、credentialHash、generation、revokedAt、authorizedUntil、incarnation、reconciledAt。授权状态必须在 writer 锁后重读。服务启动后的旧 onlineUntil 不能单独准入：启动时先清空 active 授权并要求完整 reconcile，再给续期；不得修改 generation 代替这个恢复栅栏。
- `ExecutorPairing` 存 codeHash、原 credentialHash、绑定 executorId、首次截止与稳定 receipt 截止。先生成并原子保存本机 0600 的 32 随机字节凭据（64 个 hex 字符），然后兑换；凭据只在 Authorization，pair body 没有 credential。服务端 hash；日志、错误、回执、fixtures 不含 code 或明文凭据。同 code/hash 重试仅返原身份，不续期；异 hash conflict；撤销后 forbidden，不复活。同事务检查生成记录上限。
- `ExecutorAssignment` 是已 claim Run 的传输 journal，记录 launch/digest、prepared/offered/started、processIdentity、source high watermark、receipt 字节/数量、稳定 final/digest、finalizedAt 与 never-started tombstone。没有第二个排队状态、业务排序或自动 retry。`ExecutionCommand.offeredAt/effect` 只记录 inject 的一次投递事实，不存文本或问题答案。
- `ExecutorSourceReceipt` 主键 `(attemptId,sourceSeq)`，保存 digest、throughSourceSeq、storedSeq（可 NULL）与计费字节，不依附 detail retention；没有 payload/答案。模型只保存事实，实际验权、字段一致性与 quota 由事务 ingress 执行，表存在不代表执行器可用。

宿主配置继续使用只读进程快照 `execution-projects.json`：旧 `projects` 格式和 resolver 不变；可选 `placements` 是 `{workspaceId,ownerId,moduleId,grant}`。grant 是 executor 的 server/device union：公共 placement + executorGeneration/directoryIdentity/baseline/label；仅 server 有 canonicalPath。`parseExecutionPlacements` 按真实 caller 与完整 placement 解析，拒绝重复映射、device 路径和 revision 不匹配；返回副本。P2 resolver 必须在准入/claim 事务内连同设备记录重读，不允许网络配置热更新。服务端不 stat/read/write 设备目录；设备本机受信映射负责 canonical/alias 的物理身份核验，不同 deviceId 指向同一物理 checkout 首版不支持。

## HTTP 与认证接线（已整合，验证边界见 M3 验收记录）

`EXECUTOR_HTTP` 仅六个精确 method/path 可绕过 owner API_KEY，然后立即执行独立设备认证；任何其他 method、尾斜线、额外段、旧 loopback bridge 或 owner 路由都不属于 exemption。响应 `{v:"chrona.executor.v1",requestId,ok:true,data}` 或相同错误 envelope，error/status 复用 execution HTTP 映射。无法取得合法 requestId 时为 `invalid`。`parseExecutorResponse` 按操作和原 requestId 校验；客户端还须验证 executor/generation/incarnation 与当前请求一致，超时响应不续期、不启动。固定 origin，`redirect:"error"`，不接受 cookie、URL token、用户 caller/principal。请求端点先检查原始 UTF-8 body 字节，再 strict parse 一次；响应检查完整 envelope 字节。

| method/path | 身份 | 请求/响应 schema | 原始 body 上限 |
| --- | --- | --- | --- |
| POST `/api/executor/v1/pair` | 本机已持久保存的 credential + owner 单次 code | executorPair / executorPairReceipt；无新 secret 返回 | 4KiB |
| POST `/api/executor/v1/poll` | active credential + fence | executorPoll / executorPollReceipt | 4KiB |
| POST `/api/executor/v1/report` | active credential + fence/target | executorReport / executorReportReceipt | 512KiB |
| POST `/api/executor/v1/question` | active credential + fence/target | executorQuestion / executorQuestionReceipt | 32KiB |
| POST `/api/executor/v1/final` | active/recovery 或原 assignment drain | executorFinalRequest / executorFinalReceipt | 192KiB |
| POST `/api/executor/v1/reconcile` | active/recovery 或受限 drain | executorReconcile / executorReconcileReceipt | 512KiB |

owner `POST /api/executor/v1/pairing-codes`、`POST /api/executor/v1/revoke`、`POST /api/executor/v1/incarnation` 保持 owner API_KEY，仅 trusted owner 路由构造 owner/workspace；返回 code 的正文必须使用现有秘密脱敏边界，不记录 body。撤销在一个 writer 事务 generation++、写 revokedAt、清 authorizedUntil/reconciledAt，对原未停 attempt 写 cancel/capability revoke。保留原 credentialHash 只用于 drain：仅 `/final` 和 `/reconcile`，核验原 executor、原 assignment generation、完整四引用、launchDigest；不能续期、给 launch/inject/answer、上报 records/question、调用 bridge 或变更 mapping。drain reconcile 只能接受原绑定的 stop 观察并返回 stop/unknown/ack_final，不接收新的 started/processIdentity 或进度。凭据已删或身份无法核验时 unknown 保留，需 owner 明确验证证据后处理。

首版远端 module 工具目录固定为空，direct call 一律 forbidden；不增加 `/run/register`、`/run/catalog`、`/run/call`，不把旧 `/api/steward-agent` 开放到网络。daemon 本机 extension facade 仍提供空 catalog/拒 call，并保留 Pi native tool budget hook。progress/usage/resources 通过同一 source spool，question 通过独立活请求；`executorBridgeSchema` 只是这四种本机可信 adapter 的输入边界，不是新的远端万能工具端点。

### 冻结时的认证探针边界（历史准备记录）

本小节保留冻结前候选探针的原始边界，以下“未验收”仅描述当时状态；后续真实 controller、CLI、GUI 和发行验证已在 M3 验收记录独立闭合。

`apps/server/src/executor-router.ts` 已在实际 Hono app 的 module proxy 前挂载，owner exemption 仅六个精确 POST，独立凭据只读 Authorization；原始流按各 endpoint 字节预算有界读取，再 strict parse。合法 requestId 回传、未知版本明确拒绝；完整响应使用既有操作 schema/总字节预算并核对 fence、final digest、question/reconcile target，错误不输出 controller message。未装配 controller 明确 unavailable。owner 配对、撤销及 incarnation 管理路由走 API_KEY；未配置（含空白）fail closed。runtime 已闭包受信 ws_default owner，缺工作区明确 unavailable，不任意选 workspace；管理接线属候选，未作真实设备验收。

`engine/steward/executor-auth.ts` 提供真实 DB `createExecutorAuth({db,now})`：createPairing/pair/authenticate/revoke，以及供 R writer 事务复用的 assertExecutorRequest/assertExecutorTarget。凭据只 hash 查询/恒时比较，配对同 code/hash 返回原身份且不续期；撤销 writer 锁后原 key Audit 回执、generation+1、清授权与 reconcile，并为所有未确认停止 attempt 写取消/撤权；不释放 hold、不伪造 stop。drain 仅原代际、当前监管 incarnation、完整原 target/launchDigest 的 final/reconcile，拒新 identity、进度位置变更和续期响应；owner 转交后的旧 daemon 拒绝。R 必须在实际副作用事务重新调用请求 guard，HTTP 前置事务不代替该边界。

新增临时 SQLite 与真实 Hono 探针覆盖独立认证、精确豁免、无 API_KEY、配对稳定回执、撤销/回滚、drain 边界、原始 UTF-8/字节预算、相关性/错误脱敏、缺 controller；controller 的执行响应使用替身，不证明 R 停止/执行。既有 bridge 已用 Bun serve 的 server.requestIP→app env 核对实际 socket peer：严格 loopback、forwarded 拒绝、未知 peer fail closed；临时真实 Bun server 探针覆盖合法 Run capability、设备凭据拒绝与本机非 loopback 拒绝。owner runtime 和首次 incarnation bootstrap 接线已补；全量分页/授权由 R 完成，空本机 facade/native budget、R/Q/U 与 M3 均未验收。前序认证检查见 `/tmp/chrona-unified-20261105-c2mdd7yu/P2-auth-delivery/`；本次 runtime/peer 接线检查、hash 与剩余交接见同根 `P2-runtime-seams-delivery/`。

## Runtime 接线：受信 owner 与 incarnation 转交

服务沿用启动时选择的 `ws_default`（`index.bun.ts:ensureDefaultWorkspace` 与 rescue 的单 owner 工作区），runtime 闭包经 `resolveExecutionPrincipal` 取得 owner；HTTP body、URL、cookie 和设备 fence 均不能选择 owner/workspace。owner 配对、撤销以及新增精确 `POST /api/executor/v1/incarnation` 始终需要 API_KEY，空 key fail closed，不加入六个设备 exemption。owner 配对的 label 仅作为返回给 owner 的显示提示，设备登记 label 仍由 pair 请求提供；配对码不持久明文、不记录日志，响应 no-store。

incarnation 转交 strict 输入为 `{executorId,generation,expectedIncarnation,nextIncarnation,commandKey}`，expected/next 均非空且不同。writer 锁后先读 owner 范围 commandKey 的原 Audit 回执，相同 payload 原样返回，异 payload conflict；再核对 owner、未撤销、原 generation 与 expected，CAS 写 next、清 authorizedUntil/reconciledAt，并同事务记录转换。next 不得复用该设备已退休 incarnation，防止 owner 误重放旧实例；generation 不变。仅 credential 已认证、stored incarnation=NULL 且无 assignment 时，reconcile 才能首次绑定；其他不同 incarnation 必须由 owner 显式转交，绝不按 UUID 请求先后抢占。

转交只授权同设备新 daemon 监管旧任务，不证明任何进程停止，不释放 hold/槽，不产生新 launch。内部 principal 增加 `recovery`，credential/fence 相符但未完成全量对账时只能 reconcile/final；poll/report/question 均拒绝。旧 daemon 转交后连 reconcile/final 也拒绝（撤销 drain 同样必须是当前 incarnation）。旧 assignment.incarnation 永不改写；当前 daemon 的 reconcile/final 可针对同设备/原 generation 的原 assignment，target 仍绑定原 work/session/run/attempt/assignment/digest。旧 assignment 对账仅允许 stopping/unknown/final、原 sourceAck/finalDigest，不接收新的启动 identity。全量固定分页、旧任务停止核验、reconciledAt 提交与实际授权续期归 R；HTTP/bootstrap 不自行宣告完成，不把 recovery 当 active。runtime 在接收请求及 tick 前清除持久 online/reconciled 状态，初始化失败传播。

question 外层 envelope.requestId 仅关联 HTTP；question 返回 data.requestId 以及 poll questions[].requestId 均为服务端 `ProviderInteraction.id`，可与 HTTP requestId 不同。内部 target/questionKey 仍必须对应原请求，不把 HTTP ID 用作 answer 路由。

## Claim、incarnation 与 journal 恢复

Q 的原 Run claim 在 SQLite writer 锁后依次：读 fresh clock、原幂等 key/期限/取消/调用身份、固定 grant 与 generation、R `online(tx,...)`、session/目录/全库容量，再 CAS queued→running、设置 deadline/token 并 `reserve(tx,...)`。离线或 incarnation 尚未 reconcile 则不发 token、不写 startedAt。R `prepare(tx,assignment,digest)` 只把已 reserve 的 launch 变 ready，不再 claim。poll 同事务持久 offeredAt 后才回 launch，丢响应也不清；Run claim 到 offered 前同样计槽。

新 daemon incarnation 先停止新的启动/工具授权，分页 reconcile 所有本机 journal 与服务器未停 assignment；服务器同一 executor 同时只认一个 incarnation。entries 每页最多100，after/complete 对应固定遍历，未收全不设置 reconciledAt、不续期、不发新 launch；服务器未知条目也必须进入 decisions，不用设备 omissions 冒充已停止。旧 assignment.incarnation 不改写，新 incarnation 只能监管、停止、补原 final，不再次创建 PiRun；新 claim 使用新 incarnation。reconcile decisions 只有 stop/report/ack_final/unknown，没有 restart。

设备启动顺序：先原子 journal intent（包含完整 assignment 和摘要）→以唯一 unit 启动→立即持久 bootId/unit/invocationId/controlGroup 身份→记录 started →开始 spool。intent 存在而身份未落盘时，先按唯一 unit/manager 查明原 invocation，不得重启；找不到或已 collect 且无可靠记录时 unknown。启动时生成的 unit 名必须与原 journal 唯一绑定，不能接管同名新 invocation。只有核验从未启动且已持久不可再启动 tombstone 后才报告 never_started；服务端也可对 offeredAt=NULL 且已永久撤销的 descriptor 证明 never-offered，不能依据 Run.startedAt 直接判断。已 offered 的无 ACK 不能使用 never-offered shortcut。

进程监督冻结为 Linux systemd user transient **service**（不是仅 scope），`KillMode=control-group`、`ExitType=cgroup`、独占 unit、有限 RuntimeMaxSec/TimeoutStopSec/TasksMax/内存。closed Promise 只在同 boot/unit/invocation/cgroup 的 aggregate `cgroup.events populated=0` 可靠观察后 fulfill；observer 只能是预先打开的 cgroup.events 或能跟踪同 invocation 的 manager，不用 cgroup.procs 顶层空、PID/HTTP退出码、路径消失、晚到 stop ACK 推断。必须在 --collect 之前建立观察并将观察摘要/时间原子写入 journal；观察丢失则 reject closed、保留 unknown。重启发现 bootId 已变、unit 已 collect、invocation 不符均不能仅凭缺失补造 empty 证明；需可验证原 journal 的停机观察。不得把 cgroup 当恶意同 uid 代码的文件/网络隔离。

授权时长取 `min(本次请求剩余authorizedForMs, assignment deadline剩余, 本机已知截止)`，扣除请求耗时；迟到响应不延长 stopping 状态。heartbeat 10秒、grace60秒、poll wait≤10秒、HTTP15秒；每设备最多一个 poll 和一个 report，心跳不被 backlog 阻塞。取消的 abort 仅确认 durable intent，done 独立等可靠 stop，不能把 abort 返回当停止。

## Source、final 与有界回执

摘要使用 `executorCanonicalJson`（与现有 executionDigest 相同的递归键排序、数组顺序保留）后 UTF-8 SHA-256。launchDigest 输入完整稳定 assignment，不含 remainingMs/offlineGraceMs；record.digest 输入 `{sourceSeq,at,item}`；final.digest 输入完整稳定 final。source manifest 文件按 path 排序、canonical `{files:[{path,sha256}]}` 后取摘要；相对路径不可 .git/越界/重复。sourceReceipt 仅 claim 在实际树核验非空 manifest 后生成；省略/空 source 返回 NULL。

每条 source 先 spool 落盘再发；sourceSeq 是设备来源序号，不是客户端 storedSeq。item=detail/progress/usage/resources/gap；detail 禁止 question/state/gap 冒充权威事实。gap 自身占一个 sourceSeq，`throughSourceSeq>=sourceSeq` 明确缺失区间。实际 question 只由服务端活 channel 分配 requestId，和 source ingest 共用 G 的 storedSeq 分配器；服务重启/daemon 重启后问题 interrupted，prefill/answer 不落盘、不重放。inject 在服务端 ExecutionCommand 写 offeredAt 后最多一次网络投递，设备也先写消费 key 再 inject，journal `consumedControls` 每 attempt 最多128条且字节计入1MiB receipt额度，达界拒绝新 send，答案正文不入该表；丢 ACK 为 unknown，不因相同文本重注入。cancel 按持久 attempt 事实可反复重建。

每次 ingest：writer锁→当前/原身份与 target/grant 撤权检查→同 sourceSeq/digest 返回原 ACK，异内容 conflict→连续新位置或显式 gap→字节/receipt quota→实际客户端事件使用同一 Attempt.highWatermark+1 分配器→detail/summary/snapshot/source receipt/assignment source watermark 一起提交→ACK。纯 progress/resources 没有 v1 客户端事件类型，更新有界 summary、snapshot 和来源水位，receipt.storedSeq=NULL；不消费 storedSeq、不制造假事件或序号空洞。实际 detail/usage/gap 与 question 继续共用持久分配器。所有带 tx 回调禁止嵌套事务或网络/进程操作。retention 删除 detail 不删除有效 source receipt，不能给重传重新分配 storedSeq；已退休 assignment 返回 cursor_expired，不重新开流。

final 独立于增量 backlog：保留同 digest 重传，事务验证完整 ref/launch/baseline/sourceReceipt、stop 实证、不可变结果来源、同一个 Run.finish 核心、终态 snapshot/control 与 final receipt 后才 ACK。`accepted:true,stopConfirmed:false` 只表示未知 final 已保存，不释放槽/目录或发布可验收成功；final JSON/digest 不覆盖。后续 reconcile 可补同 launch 的更强 stop 事实，在同事务完成原 final 并写 finalizedAt；重复已终结 final 返回原 receipt。最终消息过大用原有 artifactRef，不把未经核验的 device 路径交给服务器 capture。

| 有界资源 | 固定上限/行为 |
| --- | --- |
| source record / report records | 32KiB / 100条且256KiB；完整 report512KiB |
| launch / stop proof / final envelope | 64KiB / 4KiB / 192KiB；final 数据预留1KiB envelope |
| device buffer / spool | 128条且512KiB；每 attempt10MiB 增量、1MiB receipt metadata、256KiB独立 terminal headroom |
| source receipts | 每 attempt8192条/1MiB，设备2MiB，服务全局16MiB；最后一条预留 gap，满额停增量，final不等详情 |
| device total journal/spool | 2×(10MiB+1MiB+256KiB)=23,592,960字节；unknown/未ACK final保留，不能回收来冒充安全 |
| durable identity metadata | 每设备最多1024 assignment（含终态/tombstone），服务最多32设备/128 pair记录；每设备同时仅2个大spool/未知attempt，未ACK终态也占本机spool；所有创建同事务验额，满额 capacity |
| terminal/reclaim | final/control/stop 先预留；已确认终态可在保留期30天后将 detail/receipts 退休，assignment 的稳定 final hash/stop tombstone保留在有界metadata内，旧 report 410；unknown不清理 |

metadata、spool、terminal 的实际计费必须由 R/G 实现并测试；上述常量/模型没有代替 allocator。保留的 receipt/tombstone 达界时拒绝新启动，不能偷偷删历史重放栅栏。默认保留 worktree，清理 confirm 使用独立 commandKey + 精确 previewDigest；同 key 先读原 receipt，状态变更拒绝，未知从不删除。

## Typed 接缝与唯一文件所有权

`StewardPorts.resolveExecutionPlacement(principal,placement,tx)` 不替换 v1 resolver；`executionV2Admission.start` 返回 `{execution,placement}`，U 保存真实 child ref 与 source/queue 投影。`ExecutorAdmission.online/reserve/prepare` 归 R；`RemoteExecutionSink.ingest/interaction` 归 Q/G 同一事件事务；`RemoteCompletion.commit/committed` 使用 Q `finishRunIn`，commit 后才触发既有完成 outbox。`VerifiedDeviceStop` 只能由可信 R ingress 在事务内核验证据构造，JSON或TypeScript断言本身不能提供信任。`deliverRemoteControl({target,commandKey,text})` 使用已消费原 key，不改普通 server inject。parent/dependency/cleanup 属 U，内核无 parent 字段和第二队列。

| 写者 | 唯一允许实现路径；测试同名相邻 |
| --- | --- |
| 共享候选作者 | 本次 dispatch 白名单：contracts executor/execution-v2及fixture，Prisma初始迁移，P2 db测试，host execution-projects，ports类型，build execution-contracts及P2合同文档 |
| R（冻结后另派） | engine `executor-control.ts`、`executor-provider.ts`、必要 `executor-auth.ts`；integrations `src/executor/client.ts`、`journal.ts`、`bridge.ts`、`daemon.ts`；server `executor-router.ts`；不写 shared schema/tick/CLI |
| Q（冻结后另派） | engine `runs.ts`、`execution.ts`、`execution-state.ts`；源 ingest 如需 `execution-events.ts`、`execution-event-store.ts` 由协调者明确交给 Q/G 唯一写者；不改 auth/runtime/config |
| U1（冻结后另派） | external coding `storage.ts`、`work.ts`、新增 `work-v2.ts`、`workspaces.ts`；editor `protocol.ts`、`index.ts`；私有 group DAG，不改 Run/schema |
| U2（另仓冻结后另派） | Workbench新增 `chrona/protocol_v2.lua`、`work.lua`、`source.lua`、`ui/chrona_work.lua`，必要 client/backend/chat/session 接线及专用测试/文档；v1 fixture 原样，Pi backend不变 |
| 协调者 | app/auth精确exemption与独立认证、runtime/tick的device分流、server-only cwd guards、CLI同binary与资源打包、根AGENTS/统一方案/架构文档、真实跨层无模型探针 |

公共 `fixtures/executions-v2/cases.json` 含十三 op/requestId/response、group/source/cleanup，`fixtures/executor-v1/cases.json` 含稳定 launch/source/final digest 与恢复 wire；不含配对秘密。TS真实schema消费，Lua以原样镜像和SHA交给U2，不自行重造。打包 `contract.js/.d.ts` 增补v2，另 `executor-contract.js/.d.ts` 提供设备窄契约；共享代码没有引入第二Pi RPC。Lua consumer、真实 app/认证/窄桥、重启 journal、并发、UI 与同 binary 资源已分别通过 M3 实际验收；不能仅由 fixture 通过推断这些产品能力。

## 本机原语与冻结清单（2026-11-06 已审阅）

`integrations/src/executor/bridge.ts` 是仅绑定 127.0.0.1 ephemeral port 的单运行 facade：实际 extension 只 GET `/api/steward-agent/catalog` 与 POST `/tools/:name`；目录固定空，所有直接猜测工具调用 forbidden。一次性本机 capability 只在内存/Provider 过滤环境，不持久化、不复用 owner API_KEY 或 device credential。空目录不禁用原生工具；预算由实际 extension 的 `tool_call` hook 执行。progress/usage/resources/question 继续复用实际 PiEvents RPC，不新增 HTTP 握手；问题答复保持实际 interaction 身份。

`process.ts` 的可信 launch hook 复用原 PiRun：原子 intent 先于 launch，unit 仅绑定 executorId/assignmentId 的稳定摘要，不因 daemon incarnation 或其他 launch 字段变化重建；已有 intent 一律恢复，不再次启动。身份落盘后才释放本机 entry gate。systemd user service 固定 ExitType=cgroup、KillMode=control-group、RemainAfterExit=yes 与有限资源/期限；环境经 D-Bus 名称传递后由 entry 白名单清理 manager 继承变量，值不进 argv。entry/helper 已按同 binary 的 process-entry 路径打包，并通过最终 compiled CLI 实际闭环。

`journal.ts` 以版本化本机包装保留现 `executorJournalSchema`，另存 unit 和完整 manager observation，0600 原子写/fsync、固定字节与 assignment 数界限；source spool/receipt allocator 已在后续实现并验证实际字节配额。普通停止观察接受相同 boot/unit/invocation、固定监督属性、manager active/exited/MainPID0；持久 observation 后才 fulfill closed，再 stop/collect。该分支 observer=`systemd_tracked` 的 populated=0 表示 manager 按 ExitType=cgroup 确认全组退出，不冒充直接 kernel 采样。另为实际 SIGKILL 恢复补充窄联合分支：原 boot/unit/InvocationID 和监督属性匹配、loaded failed/failed/MainPID0/ControlGroup 空，原持久 cgroup2 mount/namespace 身份一致；两次同一 manager 属性采样夹住原 kernel group 的 empty/removed 核验，观测状态参与本地 digest。未知挂载、目录含糊、populated=1、错身份或仅 unit/PID 缺失均不满足该证明。缺 identity、boot/属性/身份改变、外部 stop/collect、观察写盘失败均 unknown/reject。错误退出和停止事实分开；不以 SuccessExitStatus=SIGKILL 伪造成功。真实三代 setsid writer 和实际 Provider+extension+fake Pi 的无模型探针见本次交付报告；upstream v262 状态转换与安装 systemd262 探针分别作为依据。

冻结前由协调者审阅：共享 schema/fixtures 与 typed 接缝一致性、已完成的 Hono/device DB/owner认证/peer探针、本机 facade/native预算/持久观察/恢复原语及限定检查、精确 R/Q/U 文件职责。上述证据已由协调者审阅，接口以 `P2-20261106` 冻结；不得要求冻结前先完整实现 R/Q/U 而形成循环门。后续共享接口变更须由协调者审查、一次落地并通知所有消费者，worker 不自行扩展。

冻结后要求的 controller/daemon、全量对账与 online/final 事务、真实 spool/receipt allocator、Run claim/finish/source storedSeq 事务、parent/worktree/cleanup、TS/Lua consumer、runtime/CLI/同 binary 与跨层探针均已有独立实际证据，见 M3 验收记录。原语探针与产品闭环分别记账；开发集成验收仍不代表真实模型、个人设备安装或生产部署验收。
