# 内核可移植 S0：远程执行边界与迁移清单草案

日期：2026-11-09。状态：**设计交付，未实现、未进行平台验收**。依据：[实施方案](kernel-portability-plan.md) §5、§6、§9；源码基线为 `a35dd2b8d75a62fede578015759c27513efc55a9` 加本工作区已有未提交修改。下文“当前”指实际读取的工作树，不代表干净 HEAD。

本文记录 S0 的设计交付；同一工作树已另行加入 125 个工具的原始 hash fixture、Agent tools 快照及六个合成跨语言样例。停止实验与整体平台验收仍待完成，不能据本文把 S0 整体标为完成。macOS、Windows 的停止实验均为 **pending**，Linux 的实际进程树实验结果另行记录。发行目标列表和历史测试不能作为平台支持声明。

## 1. 本次定下的责任边界

普通远程执行应用负责设备配对流程、传输凭据的散列与撤销记录、项目映射、设备协议、业务事件、收发 outbox、固定回执及核对；设备端是独立程序，依赖计划中的 `@chrona/pi`，负责本地工作目录、锁、Pi、执行点预算、取消和持久 journal。它们都不能直接写 kernel DB、建立第二条 Run 队列、伪造原 caller 或提升为 owner。

内核保留当前 Run 队列、真实 caller、授权、共享预算、执行容量与目录占用、租约、取消、应用生命周期和最终停止裁决。新增内容只限下文列出的交付持久点、精确认证入口和可信停止验证；不引入通用远程模块宿主、远程任意命令、公共 `executor` namespace 或可安装的“可信应用”。`@chrona/pi` 是库，Agent 仍是唯一不可变应用。

可信宿主的停止验证器与普通应用进程必须分离。远程应用可以转发证据，不能调用一个接受 `stopped: true` 就释放容量的接口。设备管理、项目和配对策略仍属于应用；可信宿主仅绑定经过 owner 批准的设备验证公钥、校验执行授权及停止证据。此公钥绑定是防应用伪造证据所需的信任锚，不在内核重建整套设备产品模型。

## 2. 已核实的现有链路及缺口

| 当前路径与符号 | 已有行为 | 拆分必须保持或补足的事实 |
| --- | --- | --- |
| `packages/engine/src/modules/steward/execution-admission.ts`：`originalStart`、`admitExecutionIn` | 以 workspace/owner/caller/commandKey 找固定请求，比较 requestDigest 与 callerHash；一个事务建立 session、Run、attempt、准入和目录占用 | 准入成功只代表排队；应用私有 DB 不在这个事务里 |
| `packages/engine/src/modules/steward/execution-claim.ts`：`remoteClaimFence`、`prepareRemoteAssignment` | queued→running 与 ExecutorAssignment 准备在同一 kernel DB 事务内；claim 时重查授权、容量、映射、基线 | 迁移后不得先把 Run 改 running，再依赖一次未持久化的应用调用交付；`Run.startedAt` 不是设备已启动 |
| `packages/engine/src/modules/steward/execution-remote-completion.ts`：`commit` | 绑定 caller、assignment、launchDigest、source watermark、finalDigest；可先存最终内容，只有可信停止才 finalized | 保留“收到结果”和“确认停止”两阶段，结果正文不释放占用 |
| `packages/engine/src/modules/steward/runs.ts`：`claimNext`、`finishRunIn`、`expireLeases` | 一条 Run 队列；未知停止保留容量；remote relay abort 不能证明退出 | 已取消、租约过期、Run 显示 failed 均不能代替 stopConfirmedAt |
| `packages/engine/src/modules/steward/executor-auth.ts`、`executor-control.ts` | hash-only 凭据；generation/incarnation；事务内重查；旧代次仅精确 drain；`verifiedStop` 校验既有身份、launch 和 journal 关系 | 不能把这套权威判断简单搬进普通应用后信任其布尔返回 |
| `apps/server/src/executor-router.ts`、`middleware/auth.ts`、`app.ts` | 当前 `/api/executor/v1/*` 是精确 method/path 的替代认证；owner 接口分开；流式限长、版本校验；router 在普通模块代理前 | 现有 `/api/:name/*` 代理要求 owner API key，设备不能借此直接进入；API_KEY 未配置时通用中间件会放行，新增入口必须自行 fail closed |
| `apps/server/src/execution-device-runtime.ts` | relay complete 依赖已持久 stop/finalized，或严格 pristine 的 never-offered tombstone | 不能用“应用没有看到设备 ACK”证明从未启动 |
| `packages/integrations/src/executor/process.ts` | 仅 Linux/systemd 262；boot/unit/invocation/cgroup 身份；launch intent、spawn_possible、ready gate；按进程组整体观察停止 | 当前能力依赖设备端 Linux；不应成为核心启动条件，也没有 macOS/Windows 等价实现证据 |
| `packages/integrations/src/executor/daemon.ts`、`bridge.ts` | 重启先核对且不重启旧 Pi；超时/授权宽限控制；传给 Pi 的 executionBudget 只有 maxToolCalls，其他预算描述写入 prompt；bridge 只提供空工具 catalog，拒绝其他调用 | 当前远程路径没有完整的内核模型预算网关，不能把最终 usage 或 prompt 当成执行约束 |
| `packages/contracts/src/steward/execution.ts`、`executor.ts` | execution budget 只有 timeoutMs（1–1200 秒）、maxToolCalls（1–60）；协议有明确容量上限 | token/model-call 限制是本草案待实现的治理连接，当前 execution budget 没有这些字段 |
| `packages/engine/src/modules/steward/module-status.ts`、`module-remove.ts`、`execution-module-guard.ts` | pause/remove 先检查 idle；删除前备份及再次检查；guard 当前绑定任务 caller module 和目录占用 | 尚不认识独立的远程交付应用所有者；暂停当前是拒绝有未完工作的操作，不是自动远程 drain |

当前 `executor-control.ts` 的注释明确承认：设备凭据意味着信任设备本地 journal/manager，并非针对恶意设备的 OS attestation。下文签名方案也不改变这个信任假设。

## 3. 语言中立的私有合同草案

以下是 S5 实现的建议字段和操作语义，不是已注册 API。使用普通 routed JSON 与设备 HTTP JSON；不要求双方使用 TS、Bun、Zod 或导入内核源码。`pollDelivery` 等名称表示私有操作，不增加公开 namespace。执行入口只接受获准项目中的 Pi 任务，没有任意 argv/shell/插件分发字段。

### 3.1 编码、身份与固定键

- UTF-8 JSON；对象不允许重复键、未知字段、非有限数字；整数限于 0 到 9007199254740991。协议版本必须精确匹配，不支持时返回 `unsupported_version`，不尝试旧协议。
- digest/signature 输入采用 RFC 8785 JCS 的 JSON 字节；digest 为 SHA-256 小写 hex。签名输入为 `chrona.remote-execution.s0\n` 加 JCS 字节。domain 包含在签名内容中，launch/control/stop/final 各有不同 kind；二进制签名与公钥用无填充 base64url。S5 必须提交跨语言向量，当前未生成。
- 必带 fence：`workspaceId, ownerId, caller, workId, sessionId, runId, attemptId, deliveryId, app, device, projectRef, mappingRevision, workspaceRef, baseline, directoryIdentity`。`caller` 由内核注入，包含真实主体及模块 id/hash；`app={moduleId,hash,activationId}`；`device={deviceId,generation,incarnation,keyId}`。绝不接受调用参数里的 owner/caller 替代连接主体。
- `commandKey` 是调用方幂等键；同键同 digest 返回原回执，同键不同 digest 返回 `conflict`。`deliveryId` 由内核创建，与一个 attempt 一一对应；重试不改 deliveryId，不重新排队、不换设备、不建立新 attempt。
- `launchDigest` 覆盖不可变 fence、goal、目录模式、source manifest、预算、绝对 deadline。续租的短授权不改变 launchDigest。`sourceSeq` 从 1 连续递增；`finalDigest` 覆盖最终业务内容及最终 source watermark。停止观察单独签名，以便 unknown 后补充证据而不改写最终业务内容。
- 绝对时间为 UTC RFC3339；执行用 monotonic deadline，墙钟只用于核对与审计。消息必须有 requestId，但 requestId 不是产生副作用的唯一键。

### 3.2 消息、接收条件与回执

| 私有操作 | 最少业务字段（均加上述 fence） | 耐久效果与重复处理 |
| --- | --- | --- |
| `admit`（现有 Agent 执行原语内部） | commandKey、requestDigest、placement、goal、budget、queueExpiresAt | kernel 事务创建 queued Run/attempt/reservation 与准入回执；相同键回原 admission，尚无设备执行授权 |
| `pollDelivery`（应用→kernel） | app fence、after、limit | 仅返回同一 app incarnation 获得的 durable delivery/control；读响应丢失可重复读，不以读取即删除 |
| `acceptDelivery`（应用→kernel） | deliveryId、launchDigest、appReceiptId | 应用必须先提交其 inbox；kernel 存固定 accept receipt。accept 不表示设备启动，不释放占用 |
| `launch`（应用→设备） | 完整不可变 assignment、launchDigest、内核签名短租约、remainingMs、source manifest | 设备验证签名、绑定、预算和期限；journal 原子写入 intent 后才准备目录；已有 deliveryId 只核对/回原状态 |
| `started`（设备→应用→kernel） | launchDigest、签名 processIdentity、sourceReceipt、device journalSeq | kernel 校验授权及身份并存回执；只允许同一身份补报，不允许用新 PID 替代原身份 |
| `control`（kernel→应用→设备） | controlKey、controlDigest、kind、sequence；取消带 reason | kernel 先持久 command/outbox；设备先写 inbox 和固定 receipt。取消单调生效；answer 等业务控制必须精确匹配未结 interaction，过期不重放 |
| `source`（设备→应用→kernel） | sourceSeq、digest、kind/payload 或显式 gap、throughSourceSeq | 每层提交 inbox 后才 ACK；重复同序同 digest 回原 watermark，不同 digest 冲突；不把 display detail 当权威问题或 stop |
| `final`（设备→应用→kernel） | finalDigest、outcome、missing、sourceWatermark、bounded result/changes | 设备和应用均先持久 final outbox；kernel 原子保存不可变 final+回执。缺停止证据时返回 `contentCommitted:true, stopConfirmed:false` |
| `observeStop`（设备经应用转发→可信宿主） | stopEvidence、signature、evidenceDigest | 宿主验证后产生内部可信结果；kernel 同事务存证据、结算 Run、释放治理容量。重复证据返回固定回执；不能由 app 自行构造内部可信类型 |
| `reconcile`（三方核对） | snapshotId、after、complete、每项 delivery/launch/process/source/control/final 摘要 | 只对账、查询原回执、补报或请求停止；全快照完成前无新 launch；遗漏不是 never_started；游标过期重取快照，不能续用不一致分页 |

每个响应含 `requestId, receiptId, requestDigest, committedAt, state`，以及适用的 `launchDigest, finalDigest, acceptedThroughSourceSeq, stopConfirmed`；发送方对照自身 outbox 后才清理待送项。错误集合沿用现有语义：`invalid/unauthorized/forbidden/not_found/conflict/cursor_expired/too_large/capacity/unavailable/unsupported_version/unsupported`；不回传凭据和本地绝对路径。只有明确的 unavailable/capacity 等临时失败可按同键重试。

初始上限沿用当前 `EXECUTOR_LIMITS` 的实值，放进应用/设备自己的版本化合同：launch 65536 B、proof 4096 B、单 source 32768 B、batch 100 条/262144 B、HTTP body 524288 B、final 196608 B；每设备并发 2、共享 Coding 全局 4、每调用应用 2。最后三项仍由 kernel 共享容量裁决，应用的配置只能收紧。现有 source receipts 的 per-device/global 字节限额和 cancel/gap 预留必须保留（见 `execution-source-budget.ts`、`execution-control-budget.ts`），达到上限后拒绝新 launch 或输出显式 gap，不能挤掉取消、final、stop 的耐久空间。控制/回执不能因业务日志 TTL 被提前删除。

## 4. 设备认证：精确入口、无 owner key

### 4.1 配对与凭据

Owner 在已认证的本地管理会话中批准具体应用 id/hash、设备验证公钥及项目授权；设备永远不取得 owner API key、Run token 或 provider secret。应用生成一次性配对码，设备先耐久保存随机 32-byte transport credential 和独立 Ed25519 私钥，再兑换；应用只存 transport credential 的 SHA-256。配对码最长 10 分钟、一次消费；同码同 credential、公钥返回固定 receipt，不同材料冲突；消费 receipt 保留 24 小时，过期不重新配对。设备公钥的可信宿主绑定还需 owner 确认，单有配对成功不能启动任务。

Transport credential 供应用验证传输身份；私钥仅由设备程序持有，不能存进应用 DB。应用若拥有 bearer 也不能伪造 device-signed launch ACK 或停止观察。宿主保存最小公钥批准绑定和执行验证记录；应用保存展示、配对、映射和业务撤销记录。撤销先持久化到 kernel 授权 fence，拒绝新启动，再由应用取消/drain；只更新应用 DB 不算撤销完成。

当前 `executor-config.ts` 允许 HTTP/HTTPS；新入口对非 loopback 必须有经过认证的 TLS，拒绝静默退回明文。日志、错误、备份和事件正文不得包含 bearer/私钥。

### 4.2 入口草案与 owner 中间件关系

建议只注册 **POST `/api/remote-execution/device/v1/{pair,poll,report,question,final,reconcile}` 六个字面路径**，这是计划中的应用设备入口，不是当前路径或公共工具。注册绑定特定已检查的 entry 应用 `moduleId/hash/activationId`；未来改名需显式改表，不使用 `/api/:name/*`、前缀匹配或应用自报路径作为免鉴权规则。

Server 在普通 owner 代理前命中精确表：限速、Content-Type、流式字节上限、版本及 body schema 检查后交给绑定应用的认证处理。Pair 只允许一次性 code+credential 兑换；其他请求要求 bearer，且对照应用当前 generation/incarnation、撤销、有效期。Server 通过受认证的模块连接注入真实 app 身份；删除客户端传来的内部身份头，不把连接变为 owner。应用的身份判断只授权访问其设备协议，不能因此获得 kernel model/tool/finalize 权限。

`API_KEY` 缺失时入口仍独立认证；owner pairing-admin/revoke 管理操作必须 fail closed，不能沿用通用中间件的无 key 放行。GET、路径后缀、编码斜杠、相邻应用、owner API、普通 `/api/remote-execution/*` 均不属于设备认证例外。入口不存在、应用暂停或换代时拒绝普通设备业务；精确 final/reconcile drain 由下节保留的恢复接收器处理。不得把恢复请求转发到已删除的任意应用进程。

### 4.3 授权与旧代次 drain

每次有副作用的 kernel 写事务再次核对 caller、app activation、device 公钥批准代次、delivery、预算、租约和撤销，不只依赖 HTTP 前置校验。正常运行要求全 fence 当前且已完成 reconcile；重连新 incarnation 须 owner/受控 CAS 批准，不由设备自选名字获得权限。

已撤销/换代的设备只可用原 key 针对已登记旧 delivery 提交 final、stop、source ACK 摘要和查询固定回执；不能 poll 新 launch、续正常授权、提出新问题或扩展目录授权。换代应用只能在经过生命周期接管的同一私有 DB 上读取这些记录；不能以新 hash 冒充旧 caller。原 caller 的业务查询仍按原授权范围过滤。

## 5. kernel Run 与应用私有 DB 的 durable boundary

不假设跨 SQLite/进程事务，不宣称 exactly-once。语义是至少一次传输、固定键重试、每 delivery 至多一次自动启动尝试；启动窗口不明时进入 unknown，绝不通过新 attempt 掩盖。

### 5.1 三份记录及写入顺序

1. **K1 kernel 准入**：同一事务提交 admission key/digest、Run queued、attempt、共享容量/目录 reservation 和固定准入回执。应用可以离线；queue expiry 到期且从未交付时才能用 never-offered 结束。
2. **K2 kernel claim**：在队列 writer lock 事务中重查真实 caller、授权、预算、目标代次/在线核对状态和生命周期，选择同一条 Run；同时提交 running/claimed 状态、唯一 deliveryId、launchDigest、不可变 payload、deadline 与 delivery outbox。禁止“仅内存回调再写应用 DB”。这条 outbox 只记录已认领 Run 的交付，不做另一层排队调度。
3. **A1 应用接收**：应用私有 DB 单事务插入 delivery inbox（deliveryId 唯一，检查 digest）和设备 launch outbox，然后 ACK K2。K2 重送得到同一个 A1 receipt。尚无 A1 时 kernel 重送；A1 存在但 K ACK 丢失时查询/重送同键；均不再 claim。
4. **D1 设备启动**：设备先写 journal intent；在任何可能 spawn 前落盘 spawn_possible；完成目录锁与基线检查；创建平台监管容器并耐久写 processIdentity，ready gate 才放行 Pi。每个步骤均先持久再 ACK。已有 delivery journal 无论是否有 ACK 都不得自动重启。spawn_possible 后崩溃而缺身份，必须 unknown 并保留占用。
5. **A2/K3 回传**：设备 source/control/final outbox → 应用 inbox+kernel outbox 原子提交 → kernel 校验并提交固定 receipt。内核只有提交后 ACK，应用只有收到该 ACK 才标记转送完成；设备只认应用已耐久接收的 ACK。应用 ACK 丢失、kernel ACK 丢失、任意进程重启均用原键重送。
6. **K4 结算**：final 内容提交不等于停止。可信验证器的 stop 与 final/缺失结果标记、治理结算、stopConfirmedAt、释放并发容量在同一 kernel 事务提交。目录内容保留与 cleanup 是独立授权操作，不能由“停止”自动删除。应用状态页最终以 K4 固定回执核对。

应用私有 DB 至少有 delivery inbox、device launch/control outbox、source inbox、kernel report/final outbox、固定 receipts、device generation 与 reconcile snapshot。设备至少保留 assignment/launchDigest、spawn 阶段、workspace lock、processIdentity、source/control watermark、final/stop outbox 和回执。采用实际 DB 事务或原子写+fsync 的 journal；响应之前发生的磁盘失败不得回答 committed。

kernel 持久记录只保留 Run 治理所需的 delivery/fence/digest/expiry/receipt/verified evidence；移走设备业务模型和 source payload。应用 DB、设备 journal 和 kernel receipt 各自备份，恢复后先核对；恢复到较旧 app DB 不能让 kernel outbox 的 ACK 或设备 journal 消失。恢复点缺记录就是 unknown，不重跑。

### 5.2 不能压缩掉的崩溃窗口

| 注入点 | 恢复动作 | 禁止动作 |
| --- | --- | --- |
| K1 commit 前/后响应丢失 | 同 commandKey 查询原 admission；不存在才重新准入 | 新 work/run 绕过固定键 |
| K2 commit 前崩溃 | queued 保持；未授权设备启动 | 从应用猜测 payload 后启动 |
| K2 commit 后、A1 前 | 重送同 delivery | claim 第二次 |
| A1 commit 后、kernel accept 前 | 重复 inbox 命中原 receipt，继续原 outbox | 把未收到 K ACK 解释为新任务 |
| D intent 后、spawn_possible 前 | 可用严格 journal tombstone 证明 never_started | 仅凭无 PID 证明未启动 |
| spawn_possible 后、identity/ready ACK 前 | 查监管容器和持久身份；缺证据则 unknown | 自动重启、换 delivery 或只查 PID |
| 设备 final/A2/K3 任一 commit 后 ACK 丢失 | 查询/重送同 finalDigest 与 source watermark | 改写已固定 final |
| K4 commit 后 ACK 丢失 | 返回原结算回执；不再结算预算 | 重复释放容量/目录 reservation |
| 应用 DB 不可读或磁盘满 | K outbox 保留、停止新交付，保留 cancel/final 空间；进入恢复 | kernel 直接删除应用、跳过原 DB 新建空库 |

## 6. 执行点预算与可信停止

### 6.1 预算不是 prompt 或最终 usage

当前 timeoutMs/maxToolCalls 继续由内核硬上限收紧；model-call/output-token 采用现有共享 model budget 的授权来源，不能由远程应用另开额度。草案要求 launch 带 `budgetGrant={grantId,deadlineAt,maxToolCalls,maxModelCalls,maxOutputTokens,modelPolicyDigest}`，由 kernel 签名并绑定完整 fence。字段接入和合同 hash 变化要在 S5 逐项列明；这不是当前已支持的 execution schema。

| 约束 | 执行点与证据 | 失败策略 |
| --- | --- | --- |
| 准入、全局/应用/设备并发、目录 | K1/K2 事务 reservation；unknown 计入容量 | 无额度不发 launch，expiry/revoke 不释放 unknown |
| 实际运行时间 | 设备验证签名租约，用 monotonic 计时；取绝对 deadline、剩余时长、最近授权宽限的最小值；监管器独立兜底 | 断连不续租；到期关闭新模型/工具请求并停止进程树；仍需 stop 证据 |
| 工具次数 | `@chrona/pi` 在实际工具 dispatch 前按稳定 toolCallId 持久扣数；所有执行工具包括本地文件/shell都计入；routed 工具另由内核验证原 caller | 超额拒绝；journal 不可写拒绝；重复副作用未知不自动重放 |
| 模型调用与 output tokens | 每次模型请求经过 kernel 控制的预算入口，先按 requestKey 事务预留 call + 最大 output，再允许受支持 provider 的 native output cap；设备不持有可绕过此入口的 provider 凭据 | 未支持模型/cap、grant 失效、网关不可达均拒绝；不允许本地 Pi credentials 回退 |
| 共享使用量结算 | 可信 provider response/预算入口记录累计；响应不明保留该次完整预留，重复 requestKey 查询原 receipt，不重发不明外部请求 | device final usage 仅展示/核对，不能增加额度或返还不明预留 |
| 日志、控制、回执空间 | 现有有界 source/control reservation 机制迁入 app/设备，kernel 保留治理 receipt | gap 有明确 watermark，优先保住 cancel/final/stop |

现有 `packages/integrations/src/steward/pi-model-gateway.ts` 只验证了 Pi 1.5.0 的特定 native output cap 路径；不能直接把它称为完整远程网关。建议复用其 fail-closed provider 检查，但先完成远程每次请求与共享预算的连接。若共享硬预算还包含 input/总 token 或货币额度，则必须在请求前用受信任 provider 计数器或可证明上界预留；没有可信计数/上界的模型不准入。最终自报 token 不满足这一条件。具体 provider 计数策略待决，不允许因此先上线一个“估算后无限执行”的版本。

Linux 当前 `process.ts` 的 RuntimeMaxSec 为剩余时间向上取秒再加 5 秒，且有 MemoryMax/TasksMax；这只是监管兜底，不是精确 deadline 证据，也不把该 Linux 专用策略变成三端核心依赖。超时触发后不再允许新请求；停止耗时单独记录。信任本地代码和设备 OS 的前提下约束执行路径；本方案没有阻止恶意设备另启进程/另取凭据的 OS 隔离保证。

### 6.2 谁能签发可信停止

设备 adapter 由独立设备发行物提供；验证器位于可信宿主集成层，不能由普通应用安装/替换。Owner 批准的设备公钥绑定设备代次；adapter 只有读取监管器和本地 journal 的窄输入，不提供“签任意 stopped JSON”业务接口。公钥绑定不能只接受应用自报的 key。

建议 `stopEvidence` 签名内容：`kind, fullFence, launchDigest, journalSeq, processIdentityDigest, observerKind, observerVersion, observation, observationDigest, finalDigest|null, sourceWatermark, challengeId`。challenge 由 kernel 在 delivery/reconcile 中耐久分配，重送保持同值；旧 challenge/旧 delivery 的证据不能结束新 Run。宿主先校验 key、签名和所有绑定，再按已支持的平台 adapter 规则验证 observation；验证成功才创建内部可信 stop 结果。普通 routed JSON 不能反序列化成 `VerifiedDeviceStop`。

- `never_started`：只接受可信 journal 在 intent 后、spawn_possible 前的 tombstone，或 K2 从未被交付且 delivery 已封死的 kernel never-offered 证明。任何网络发送前必须先提交 offered；ACK 丢失仍算 offered。只要可能 spawn、缺失 journal、已见 source/process，就拒绝 never_started。
- `tree_empty`：必须对应原监管容器的稳定身份与观察。Linux 当前规则包含 bootId/unit/invocationId/controlGroup、相同 cgroup root 的一致观察；不能只用 MainPID=0、`kill(pid,0)` 失败、父进程 exit、HTTP 断开或应用退出。
- `unknown`：签名正确也不升级为 stop。final 可固定为缺失/失败，容量和目录治理占用继续保留；后续新的独立 stop 证据可结算同 final，不改业务内容。
- 旧进程身份、PID/unit 名重用、设备重启后不可核实的容器、key 不匹配、日志损坏、manager 不可用：全部 unknown。新 bootId 本身不是旧树已停止的充分证据，除非对应平台验证规则已证明且记录完整。

签名证明来源和完整性，不证明设备 OS 没有撒谎。当前可信设备假设与普通应用不可任意伪造停止是两条不同边界。具体密钥批准 UI、设备 adapter 二进制完整性和 key 恢复方案仍需评审；未完成时 S5 停止验证门禁不通过。

## 7. 生命周期与失败矩阵

所有 pause/update/remove 先建立 kernel 生命周期 fence，阻止新的 claim、launch 和租约扩展，再处理既有 delivery。当前实现先拒绝非 idle；这是安全基线。自动 drain 尚未实现，不能仅杀掉应用进程后宣布完成。

| 场景 | kernel / 应用 / 设备的规定动作 | 对外状态、占用与验收点 |
| --- | --- | --- |
| 设备离线、任务尚未交付 | 保留 queued 到 queueExpiresAt；不换设备/映射；未交付证明与 expiry 同事务封死 | queued→expired/failed，只有严格 never-offered 可释放 |
| 设备运行中断连 | 设备宽限到期停止；kernel 保留取消/outbox；重连先 reconcile | unknown，不以 lastSeen/超时释放 |
| 取消响应丢失 | 重送同 controlKey，设备返回持久原 receipt；最终核对 tree stop | cancelRequested 不等于 cancelled；停止不明持续占用 |
| 应用崩溃/重启 | 先恢复私有 DB inbox/outbox/receipt，向 K/D 读快照；全核对后恢复交付 | 不重复 claim/launch，暂拒新设备业务 |
| 设备崩溃/重启 | 读 journal、监管器身份，补报/停止；不自动 resume 旧 Pi | 缺日志/身份为 unknown；不存在“重启即清空占用” |
| Server 重启/旧备份恢复 | 从 Run 和 durable delivery 恢复，关闭新交付直到 K/A/D 核对 | 不依赖 `executor-control.ts` 当前进程内游标/Map 恢复事实 |
| 原 caller 授权撤销/到期 | kernel 先封授权、持久 cancel，再通知应用；设备续租/新工具/模型请求拒绝 | 原结果仅可按 drain 规则提交，不提升 owner |
| 设备撤销/换 generation | kernel key/fence 撤销事务优先；应用停发新任务并 drain 原 assignment | 旧凭据不能复活，旧 key 只精确 drain |
| 应用 pause | 设置交付 fence；已 queued 的未交付工作按固定 policy 取消，已交付工作发 cancel 并核对；未确认前维持原进程或恢复接收器 | 操作保持 pending/拒绝完成；不误把模块 idle 当设备 idle |
| 应用 update/rollback | 旧 activation 先 drain；新 activation 接管前核对同一私有 DB/schema 与旧 receipts；caller hash 不替换 | unknown 未解时阻止激活完成；旧响应不能写新代次工作 |
| 应用 remove | 停交付、取消、核对 K4；确认无未决 delivery 后才走现有备份/删除/数据批准流程 | 唯一 journal/receipt 不可删除；备份文件不是运行中的恢复接收器 |
| 应用已不可运行且有未决工作 | kernel 可信恢复接收器只接设备签名的旧 delivery final/stop 与固定查询，保留精确 verifier/key/fence | 不执行应用业务，不发新 launch；不能验证则持续 unknown，阻止破坏性清理 |
| 旧 hash/generation/incarnation、乱序 source/control | 匹配原记录的精确 drain/重复回执；其他拒绝 | 不覆盖新任务，不倒退 watermark，不重放过期 answer |
| final 重复或内容冲突 | 同 digest 原回执，不同 digest conflict；stop 独立追加 | 只结算一次；已固定结果不被重写 |
| 输出/回执存储满、DB 损坏 | 停新交付；有界 gap/预留 cancel/stop 通路；缺关键记录拒绝恢复性猜测 | 不吞取消，不删除占用换取空间 |

恢复接收器只需 kernel 已持久的旧 delivery、公钥绑定和有界签名信封，不能要求还活着的普通应用帮忙认证；因此必须在允许暂停/删除应用前实现。若暂不实现这条窄通路，就保持现有 idle guard 拒绝 pause/update/remove，不能把强制删除作为正常流程。

## 8. S1–S6 精确迁移/删除清单

以下均为工作树已核实路径；花括号表示同目录逐个文件。删除的是标明的旧职责/字段，不是整文件一概删除。尚未创建的目标（`packages/pi`、JSON 运行包等）只在“去向”列出现，不伪称已有源码。

### 8.1 S1：可信本地执行与运行包

| 当前 source / caller / config / resource | 移除、保留与去向 |
| --- | --- |
| `packages/integrations/src/steward/script-sandbox.ts` | 删除 spawnIsolated/bwrap、硬虚拟内存、MALLOC_ARENA_MAX、强制 sh 包装、扩展名内置解释器表、POSIX `:`/`.venv/bin` 假设；保留时间/取消/实际停止，改读 runtimes.json 并显式 argv |
| `packages/integrations/src/steward/module-runtime.ts`、`agent-application-host.ts`、`pi-launch.ts` | 删除 required-isolation 分支及 `CHRONA_STEWARD_EXECUTION_MODE`/`CHRONA_STEWARD_SANDBOX_BWRAP` 读取与 bwrap 传递；Pi launch 在 S2 移动前完成收缩 |
| `packages/engine/src/modules/steward/{module-typecheck.ts,module-build-helpers.ts}` | 删除 sh+ulimit、`.ts/.tsx/.mts` 特判和内核 TS 声明生成；`typecheck.sh` 改运行包声明命令；`calls.json` 交运行包生成 calls.d.ts |
| `packages/engine/src/modules/steward/{module-build-process.ts,module-capabilities.ts,module-continuity.ts,module-build.ts,module-diagnostics.ts,module-supervisor.ts,ports.ts}` | 删除 virtualMemoryMb/memoryMb 硬限制传递、报告和默认值；时间/取消/实际退出观察保留 |
| `packages/contracts/src/steward/index.ts`、`packages/engine/src/modules/steward/{builtin/agent/build.ts,builtin/agent/module.json,external/memory-local/module.json}` | 去除 manifest limits.virtualMemoryMb schema、输入与生成内容；同步合同 fixture，不能只删 runtime 分支留下死配置 |
| `packages/integrations/src/steward/module-packages.ts`、`agent-application-host.ts` | 删除 Nix 自动供应、CHRONA_NIXPKGS、GC root、Linux 包管理器安装建议；保留用户已安装解释器检查和 npm/python 冻结 lockfile 安装能力；处理 `.chrona/packages.json` 中 `/nix/store`/bin 资源旧入口 |
| `packages/integrations/src/steward/browser.ts` | S2 前删除 HEADLESS_SHELL、nix acquire、固定 linux64 下载、unzip/python 解包、providers/browser 自动获取；保留明确配置 `CHRONA_STEWARD_BROWSER`/已安装浏览器检测 |
| `packages/db/src/sqlite-backup-files.ts`、`packages/cli/src/program.ts` | 删除外部 tar 进程和其命令描述；进程内备份保留 platform/sessions/secrets/qq-bot 根、只允许常规文件/目录的恢复与权限边界 |
| `scripts/build-binaries.ts` | 删除发行归档的外部 tar 依赖；不能只修用户备份而遗漏发布机 |

### 8.2 S2–S3：Agent 自包含及冻结 JSON

| 当前 source / caller / resource | 迁移及删除点 |
| --- | --- |
| `packages/engine/src/modules/steward/{agent-application.ts,agent-delegation.ts,agent-projects.ts,agent-primitives.ts}` | 从 builtin/agent/primitives 导入的 schema 改为合同包；运行时逻辑归 Agent，不向 kernel 拉 Agent 实现 |
| `packages/engine/src/modules/steward/builtin/agent/{runtime.ts,primitives.ts}` | 清除越出 Agent 目录的 host 实现相对 import；纯 schema 去计划目标 `packages/contracts/src/steward/agent.ts`，运行逻辑留 Agent；不能整份 primitives 直接提升到 kernel |
| `packages/integrations/src/steward/{pi-provider.ts,pi-events.ts,pi-launch.ts,pi-process.ts,pi-resources.ts,pi-session-resume.ts,pi-transcript.ts}` 及相应 `.bun.test.ts` | 移入计划中的 `packages/pi`；`pi-bridge.bun.test.ts`、`pi-lifecycle.bun.test.ts` 亦需随 Pi 依赖审计 |
| `packages/integrations/src/{steward/pi-model-gateway.ts,steward/agent-application-host.ts,executor/daemon.ts,steward/index.ts}` | Pi 消费者和导出改为 `@chrona/pi`；网关治理职责不因库移动变成设备自报 |
| `packages/integrations/src/steward/browser.ts`、`transcript-redaction.ts` | browser 实现收缩后移入 Agent；transcriptRedactor 去 `@chrona/logging/redaction`，修改 `packages/engine/src/modules/steward/{transcript.ts,module-build-session.ts}` 与 Pi/Agent 消费者 |
| `packages/engine/src/modules/steward/{module-typecheck.ts,module-typecheck-material.macro.ts}` | 删除 builtinCallerMaterial 与 macro 整棵 host 类型材料；不在发行资源复制另一份旧源码树 |
| `.dependency-cruiser.cjs`、`build/{manifest.ts,portable-elf.ts,release-smoke.ts}` | 补内核不得 import builtin/agent 与 Agent 不得跨目录的规则；打包纳入 Pi 库和运行包；不增加测试/fixture 例外 |
| `packages/engine/src/modules/steward/module-contracts.ts`：callsDeclaration/tsType | S1 将生成移入运行包，S3 消除运行时 TS 专用和 schema 生成职责；保留语言中立合同读取 |
| `packages/engine/src/modules/steward/{tools.ts,module-build-session.ts,module-reference.ts,module-tools.ts,system-apps.ts,module-tool-contract.ts,system/modules.ts}` | 核对这些当前 toJSONSchema 调用，hash/发现生产路径改为提交的 JSON；冻结 system-tools.json、module-manifest.json 和书面 canonical/hash 算法 |
| `packages/contracts/src/steward/execution-tools.ts`、`build/execution-contract-types.ts`、`packages/engine/src/modules/steward/{builtin/agent/build.ts,external/web/pages.ts}` | 同为当前 toJSONSchema 来源；分别区分运行时合同来源与构建时生成，构建用途可保留，不能用全仓无 toJSONSchema 代替验收 |
| `build/manifest.ts` 资源项：`resources/module-sdk/{package.json,sdk.ts,testing.ts,preview.ts,build-contract.md,group-build-contract.md,calls.d.ts}`、`resources/module-typecheck/check.ts` 及 typescript/@types 资源 | 发布源均在 `packages/integrations/src/steward/module-sdk/`、`module-typecheck/`；运行包纳入 calls.ts/runtimes.json，calls.d.ts 不再由内核直接写；更新 smoke 检查资源完整性 |
| `resources/module-git/{agent,author,coding,coding-web,events,files,mcp,memory-local,mind,notify,qq,remind,web}.bundle`、`lock.json`、`publish-plan.json`、`LICENSE`、`THIRD-PARTY-NOTICES.txt` | 对受影响种子和元数据按生成流程重建；保留 Mind/Remind 源材料与所有权/许可；不能删整个目录。Agent build/module.json 变化也要同步已提交生成产物 |

### 8.3 S4：本地通信和停止

| 当前 source / caller / config | 替换范围 |
| --- | --- |
| `packages/engine/src/modules/steward/{module-channel.ts,module-supervisor.ts,module-http-ready.ts,module-preview.ts}` | Unix socket path、单连接、HTTP readiness、activation 绑定；控制握手须绑定 moduleId/hash/activationId 和随机连接秘密。最终 IPC 后端待三端实验，不以端口连通当认证 |
| `packages/integrations/src/steward/module-sdk/{sdk.ts,testing.ts,preview.ts}` | CHRONA_SOCKET/CHRONA_HTTP_SOCKET、Bun.serve unix、测试/preview fetch unix 同步替换；不能只改 server 令 SDK 留旧协议 |
| `apps/server/src/app.ts` | 普通模块 HTTP 代理的 `{unix: socket}` 与 readiness/内部凭据一起替换；外部输入不能伪造内部连接头 |
| `packages/integrations/src/steward/script-sandbox.ts`、`pi-launch.ts`、`pi-process.ts`、`packages/engine/src/modules/steward/module-supervisor.ts` | detached/process-group kill、父退出处理改为经实验验证的 tree stop；Pi 文件按 S2 新位置继续审计。生成含握手的 module-wire.json，不写另一套 Python SDK |

### 8.4 S5–S6：远程协议退出核心

| 当前 source / DB / resource | 拆分或删除职责及遗漏风险 |
| --- | --- |
| `apps/server/src/{executor-router.ts,execution-device-runtime.ts}`、`middleware/auth.ts`、`app.ts` | 删除设备专属 router/装配与旧 `/api/executor/v1/*` 免鉴权表，替换为 §4 精确入口及窄验证/恢复接收器；保留 owner fail-closed 和普通模块代理鉴权 |
| `apps/server/src/steward-runtime.ts` | 移走 executorOwner/controller/provider/admission、设备 placement 注册和启动装配；无远程应用时不探测 systemd/flock |
| `packages/engine/src/modules/steward/{executor-auth.ts,executor-control.ts,executor-event-ingress.ts,executor-provider.ts}`、`packages/engine/src/executor.ts` | 设备配对、poll/report/final/reconcile 协议与设备模型操作移入普通应用；Linux 证明验证放可信集成层。移除旧 engine 专用 export，不用同内容的新 façade 保留永久耦合 |
| `packages/engine/src/modules/steward/{execution-admission.ts,execution-claim.ts,execution-v2-tools.ts,execution-workspace-cleanup.ts}` | 清除 executorAdmission 与直接 ExecutorAssignment.startedAt 查询；改为 kernel delivery/reservation 与应用私有 placement 回执；保留本地 Coding 和原 caller 权限 |
| `packages/engine/src/modules/steward/{execution.ts,execution-remote-completion.ts,runs.ts,tick.ts,ports.ts}` | 移除 remoteCompletion/deliverRemoteControl/remoteExecutionSink/executorController/executorProvider/executorOwner/executionLocations/resolveExecutionPlacement 中的设备专属合同与直接设备遍历；保留队列、可信结算与 §5 durable boundary。tick 不能再枚举 ExecutionExecutor 逐设备 claim |
| `packages/engine/src/modules/steward/{execution-control-budget.ts,execution-source-budget.ts}` | 搬走设备 source/control 协议限额，保留 kernel 必需治理预算；cancel/gap 预留不能遗失 |
| `packages/integrations/src/executor/{daemon.ts,client.ts,bridge.ts,journal.ts,process.ts,process-entry.ts,spool.ts,index.ts}` | 移入独立设备程序/应用传输实现，Linux manager 后端独立；核心包删除 executor export；设备继续 @chrona/pi 与窄 budget/stop 合同 |
| `packages/integrations/src/executor/{workspaces.ts,workspace-identity.ts,workspace-cleanup.ts}`、`packages/engine/src/modules/steward/local-workspace.ts` | 先抽共用目录准备/锁/清理，核对服务器调用后再移设备端；不得把本地 workspace-local/Coding 一起删掉 |
| `packages/cli/src/{executor-config.ts,executor-runtime.ts,executor-lock.ts,executor-entry.ts,executor-commands.ts}`、`program.ts`、`bun-entry.ts` | 设备 configure/pair/run/drain、flock、Linux/systemd 检测和隐藏 `__executor-process` 从核心 CLI/入口删除，归独立设备发行物 |
| 设备资源：config 的 origin/pi/mappings、credential 文件、`identity.json`、incarnation、journal/spool、workspace locks/worktrees；`CHRONA_RESOURCE_DIR` 下 `pi/chrona-tools.ts` | 私密读写的 owner/perms/NOFOLLOW/原子 fsync 语义在新平台逐项验证；非 Linux 不套用 POSIX mode 等价声明；不能把旧 workspace 或唯一 journal 静默清理 |
| `packages/contracts/src/steward/executor.ts`、`executor.bun.test.ts`、`executor-cleanup.bun.test.ts`、`packages/contracts/fixtures/executor-v1/cases.json` | 旧设备协议退出核心合同；有用故障案例迁入 app/device 私有合同测试；当前 HTTP owner pairing-codes/revoke/incarnation 亦清除 |
| `packages/engine/src/modules/steward/external/coding/{executor-contract.js,executor-contract.d.ts}`、`build/execution-contract-types.ts` | Coding 的设备专属生成物与 import 改到新的应用路由合同；保留 Coding command 业务协议，逐项列明 placement 变化的 hash 例外 |
| `prisma/schema.prisma`：`ExecutionExecutor, ExecutorPairing, ExecutorAssignment, ExecutorSourceReceipt` | 设备业务表迁到应用私有 DB 后从核心 schema 删除；K2/K4 所需最小交付/验证记录独立落地再删，不能先丢唯一恢复事实 |
| 同 schema：`ExecutionAttempt` 的 executorId/executorGeneration/mappingRevision/directoryIdentity/sourceManifest/sourceReceipt 等、`ExecutionCommand` | 拆出设备业务字段与通用 attempt/command 治理；保留 caller/run/heldDirectory/stopConfirmedAt 等必要事实；不整表删除 ExecutionAttempt/ExecutionDetail/ExecutionSnapshot/ExecutionControl/ExecutionCommand |
| `packages/{engine,integrations}/package.json`、`.dependency-cruiser.cjs` | 清理 `./executor` export、engine public executor 例外和旧设备 import；应用/设备独立构建不绕开依赖规则 |
| `build/{manifest.ts,release-smoke.ts,portable-elf.ts}`、`scripts/build-binaries.ts`、`packages/pi/resources/` | 核心 manifest 当前 executor={linux,systemd 262,__executor-process,...} 与设备资源检查迁到独立发行物；Pi extension 仍可能被本地 Agent 使用，审计共享消费者后打包，不能整目录误删；targets 仅构建目标 |

S6 连同现有设备测试调用者迁移/替换：`apps/server/src/__tests__/api/executor-auth.bun.test.ts`、`packages/db/src/executor-model.bun.test.ts`、`packages/engine/src/modules/steward/{executor-auth,executor-control,executor-poll-cleanup,module-executor,execution-never-offered}.bun.test.ts`、`packages/cli/src/executor-cli.bun.test.ts` 和 `packages/integrations/src/executor/*.bun.test.ts`。这些文件是后续实施清理对象，本次没有修改。

## 9. 本地进程实验方案：尚未执行

目的不是测 PID 是否消失，而是证明任务树停止、身份不复用、崩溃后能核对。全部使用临时目录、无网络、无模型的小进程；先做 S4 本地模块监管，再把同一故障集用于 S5 独立设备 adapter。**macOS/Windows pending，不能从 Linux 结果外推。**

### 9.1 可执行的最小负载

下面 Python 仅是实验负载，不是生产 SDK 或停止实现。保存到临时目录 `tree.py`，用本机 Python 的绝对路径；Windows 用 `py -3` 或已安装 python。通过被测监管器运行 `python tree.py <绝对临时输出目录> root ignore`。它写每层身份、每 100 ms 写 heartbeat；将 ignore 改为 normal 可测正常退出。输出目录唯一且不得位于真实项目。

```python
import json, os, pathlib, signal, subprocess, sys, time, uuid
root = pathlib.Path(sys.argv[1]).resolve()
role, mode = sys.argv[2:4]
root.mkdir(parents=True, exist_ok=True)
identity = {"role": role, "pid": os.getpid(), "ppid": os.getppid(),
            "nonce": uuid.uuid4().hex, "started_ns": time.time_ns()}
(root / (role + ".json")).write_text(json.dumps(identity), encoding="utf-8")
if mode == "ignore" and hasattr(signal, "SIGTERM"):
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
if role != "grandchild":
    child_role = "child" if role == "root" else "grandchild"
    opts = {}
    if os.environ.get("EXPERIMENT_ESCAPE") == "1":
        if os.name == "nt":
            opts["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            opts["start_new_session"] = True
    subprocess.Popen([sys.executable, str(pathlib.Path(__file__).resolve()),
                      str(root), child_role, mode], **opts)
end = time.monotonic() + 45  # 实验看门狗；不是 stop 证据
while time.monotonic() < end:
    (root / (role + ".beat")).write_text(str(time.monotonic_ns()), encoding="ascii")
    time.sleep(0.1)
```

测试结束先由监管器查询/清理其拥有的树，再删除临时输出；不能仅等 45 秒后将其自然退出计为取消通过。负载的 PID/nonce/heartbeat 是交叉检查数据，停止裁决仍来自监管器的容器身份/空树观察。单纯 kill 父进程是负向对照：grandchild 继续写 heartbeat 时必须观察到失败/unknown。

### 9.2 每平台实际动作与通过条件

| 平台 | 要执行的本地实验 | 必须保存的证据；当前状态 |
| --- | --- | --- |
| Linux | 经当前 `createExecutorLauncher` 将负载放入 user systemd 262 transient service；验证 ExitType=cgroup/RemainAfterExit/KillMode；分别 normal/ignore/escape 运行；启动后在 intent、spawn_possible、identity、ready gate 各点 SIGKILL 测试控制器；恢复只 stop/query 不 launch | systemd/Bun/OS 版本、bootId/unit/invocation/cgroup root、journal 写入点、manager 属性与 cgroup populated、所有 heartbeat 时间线、stop receipt；**本轮未运行** |
| macOS | 先测 Bun/Node process group：root/child/grandchild、ignore TERM、setsid 逃离、父崩溃、控制器崩溃后恢复；若 killpg 不能覆盖或稳定核对整个树，则评估独立 launchd job/本地 supervisor 的容器跟踪；不得以 `ps` 枚举快照补成可信证明 | OS/arch/Bun、原组/会话身份、逃离后 heartbeat、回收与恢复记录；要证明空树及稳定身份，否则标 unsupported/unknown；**pending，未选定可信后端** |
| Windows | 用本地最小 Win32 supervisor 创建 Job Object，设置 KILL_ON_JOB_CLOSE；CREATE_SUSPENDED 创建 root，先 AssignProcessToJobObject 再 ResumeThread；运行三层负载与 CREATE_NEW_PROCESS_GROUP，尝试 BREAKAWAY、nested job；TerminateJobObject 后等 job active-process-zero；强杀 controller，另测 broker 持有句柄与重连核对 | Windows/Bun 版本、job 身份/句柄所有者、Assign 先于 Resume、job accounting/完成通知、三层 heartbeat、controller 崩溃后的 stop 或 unknown。Bun 是否可在所需窗口绑定 Job 必须实测；PID/taskkill 返回值不够；**pending，未实现 adapter** |

每个平台逐项执行：正常完成、超时、显式取消、忽略 TERM 后升级、产生孙进程后取消、root 意外退出、controller/设备 daemon 意外退出、服务重启、启动 ACK 丢失、同名容器/身份复用、journal 丢失/损坏、deadline 已过、进程逃离监管树。逃离或恢复无法证明时必须返回 unknown/unsupported，不允许记录“取消成功”。macOS/Windows 的 broker/manager 选择是实验要回答的问题，不能先声称已具备稳定身份恢复。

## 10. 可执行验收清单与交付门禁

本节是后续执行指令，复选框未选中表示尚无本轮证据。测试只用 OS 临时 DB、假设备传输及 §9 本地进程；不得连模型、真实设备或账号。现有测试路径用于基线，新增场景在实施时加入实际所属测试，不能以当前旧链路测试通过代替新合同通过。

### 10.1 当前可运行的源码基线

在仓库根目录，以下各行分别串行执行，Linux 使用 AGENTS 要求的内存限制；本次文档任务未运行这些测试：

```sh
systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=1G env NODE_OPTIONS=--max-old-space-size=6144 bun test packages/engine/src/modules/steward/execution-admission.bun.test.ts packages/engine/src/modules/steward/execution-never-offered.bun.test.ts packages/engine/src/modules/steward/execution-server-workspace.bun.test.ts
systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=1G env NODE_OPTIONS=--max-old-space-size=6144 bun test packages/engine/src/modules/steward/executor-auth.bun.test.ts packages/engine/src/modules/steward/executor-control.bun.test.ts apps/server/src/__tests__/api/executor-auth.bun.test.ts
systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=1G env NODE_OPTIONS=--max-old-space-size=6144 bun test packages/integrations/src/executor/journal.bun.test.ts packages/integrations/src/executor/recovery.bun.test.ts packages/integrations/src/executor/process.bun.test.ts
systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=1G env NODE_OPTIONS=--max-old-space-size=6144 bun test packages/engine/src/modules/steward/contract-hash-baseline.bun.test.ts packages/engine/src/modules/steward/system-contracts.bun.test.ts build/execution-contracts.bun.test.ts
```

### 10.2 实施时逐项操作与预期断言

- [ ] **S0 剩余基线**：读取/冻结 `packages/contracts/fixtures/{contract-hashes.json,contract-hash-cases.json}`、`packages/engine/src/modules/steward/contract-hash-baseline.fixture.ts` 与 Agent tools 快照；记录实际 revision/命令/digest。本次只完成设计，不写这些文件。
- [ ] **双 DB/三 journal 崩溃**：临时 kernel DB、app DB、device journal；在 §5.2 每个 commit 前后独立杀进程、丢 ACK、重送同键及不同 digest。断言仅一个 Run/attempt/delivery，自动 launch 计数最多 1；每个 durable ACK 能在重启后查到；unknown 不重发执行。
- [ ] **认证穿透**：按 §4 六个精确路径做表驱动 method/path/body/bearer 测试；覆盖 API_KEY 未配置、无 credential、错 key、公钥未批准、过期/消费 code、旧 activation、generation/incarnation、相邻路径和伪造内部头。断言设备不能读任意 owner API、不能跨应用，错误请求无 DB 副作用。
- [ ] **撤销竞态**：在 HTTP 验证后、K2/工具/模型事务前提交 revoke；断言后一次事务拒绝且 cancel 已耐久，旧凭据仅能精确 drain。
- [ ] **预算执行**：假 provider 接收请求计数，预算取 1 call/小 output cap；同时发两次模型请求、重复 requestKey、丢 provider response、用不支持 cap 模型、伪造低 usage、断开预算入口。断言最多获准预留的一次请求到 provider，payload cap 不超额，不明请求不重发且不返还预留。工具限制取 1 后第二次工具不产生文件副作用；断连/过期停止后仍需可信 stop 才释放。
- [ ] **证据负向**：转发 `stopped:true`、错误签名、旧 challenge、旧 delivery/process、仅 root exit、仅无 PID、日志损坏；断言不能写 stopConfirmedAt。相同合法证据两次只结算一次；final unknown 后补合法 stop 固定同一 finalDigest。
- [ ] **生命周期**：对 §7 每行分别注入 pause/update/remove/server/app/device 重启；执行前后查 kernel reservations、app receipts、device journal。断言旧 app 退出不释放设备占用；唯一恢复记录仍可读；unknown 阻止破坏性完成；新 hash 不重放旧任务。
- [ ] **四种安装组合**：全新数据目录依次测无远程应用核心、本地 Coding、安装远程应用+假传输、独立设备程序+本地负载。断言无远程应用时无 systemd/flock/Nix/bwrap/tar/sh 启动探测；本地目录准备和 Coding 原 caller 保持有效。实际设备/模型组合另行授权，本清单不把假传输算实机通过。
- [ ] **S4/S6 平台证据**：逐平台运行 §9 全故障集；保存精确命令、提交/dirty 状态、平台/arch/运行时、manager/adapter 版本、日志、失败和限制。服务端支持矩阵与设备端支持矩阵分开列；没有证据的格子保持 pending。
- [ ] **删除审计**：对 §8 每个旧生产调用者和发布资源逐项核对；在核心启动依赖图中不再有设备 manager/protocol。执行 `rg -n 'executorAdmission|executorController|executorOwner|remoteExecutionSink|resolveExecutionPlacement|ExecutionExecutor|ExecutorAssignment' apps/server/src packages/engine/src packages/contracts/src prisma/schema.prisma build`，生产命中逐条解释或清除；测试/历史说明不能当作生产残留。
- [ ] **跨语言合同/hash**：独立 JSON 实现重算 committed hash、编码向量与签名向量；除 S5 显式 placement/budget 变化外 fixture 不变。S1/S2 不接受无解释 hash 漂移。
- [ ] **最终检查**：在 AGENTS 的内存上限下串行 `bun run typecheck`、`bun run lint`、`bun run test:bun`、`bun run test:api`；发行构建与 `build/release-smoke.ts` 按新资源清单验证。真实模型/设备、owner 构建、界面回放属于后续独立验收，未执行不得写通过。

## 11. 待决事项与本次结果

本文建议采用 durable kernel delivery + app inbox/outbox、独立设备签名 + 可信宿主验证、每模型请求的 kernel 预算预留、未知停止阻止释放/破坏性生命周期。这些是可评审的合同草案，不是已合入的运行能力。以下事项仍需实施前定稿或实验：

| 待决项 | 定稿条件 / 未满足时行为 |
| --- | --- |
| 可信设备 key 批准、恢复/轮换及 adapter 完整性 | 证明 app 不能自批公钥/签停止；严格设备信任假设写入发行合同；未通过不接受 stop |
| 双 DB durable delivery 的具体 kernel schema/私有操作归属 | 完成 §5 崩溃注入；不把 ExecutorAssignment 全表改名冒充抽象；未完成不拆现有原子边界 |
| 设备 ingress 的注册与暂停后恢复接收器装配 | 精确路径/代次/owner 缺失测试，以及删除后 drain 验证；未完成继续 idle guard 拒绝生命周期完成 |
| Pi 远程逐请求 model gateway、input/总 token 预留规则 | 受支持 provider 的 native cap、计数/上界与共享额度有执行证据；不支持的模型 fail closed |
| macOS/Windows 监管后端与稳定恢复身份 | §9 本地进程实验；**pending**，未具备时 unknown/unsupported，不宣布平台支持 |
| 最终 IPC/HTTP transport 与握手 | 控制、SDK、测试、preview、普通代理共同通过三端认证/断连实验；不只看 Bun API 存在 |
| 独立设备发行、默认预装选择、Pi 库资源归属 | 无远程应用的核心能离线启动；独立包 smoke；默认预装不增加权限 |
| S5 合同字段/hash 例外与固定数据限额归属 | JSON/hash fixture 和 Agent/Coding callers 逐项对照；保留有界取消/停止空间 |

本次结果：完成源码核对与本文设计；生产实现、fixture/快照、自动化测试、进程实验和三端验收均未在本次执行。后续阶段状态应按实际证据另行记录，不在本次改写实施方案。
