# Chrona / Workbench P1 执行与客户端接线合同

状态：协调者于 2026-11-05 完成八项审核并冻结 P1 公共契约，M2 开发已授权；M1 与 minimality 已验收。产品 executions/coding/editor 服务、持久事件存储及 Workbench backend 尚未实现。主协议仍为 `chrona.execution.v1`，共享 cases.json 字节不变。

权威代码：contracts/steward `execution.ts`（请求/身份/端口）、`execution-events.ts`（事件/响应/HTTP映射）、`execution-tools.ts`（routed工具声明/逐op类型）；engine/steward `ports.ts`（同事务G seam）、`execution-principal.ts`（真实调用身份）。test fake仅供公共消费和无模型代理探针，不规定G算法。

## 1. 固定HTTP与逐op响应

- `POST /api/editor/v1/commands`：Content-Type application/json，body严格 `{v,requestId,command:{op,...}}`，v=`chrona.execution.v1`，requestId为executionId（1–128字符，`[\w:.-]`）。不使用另一个RPC或必须header版本。Bearer API_KEY只给host，不进入模块。
- `GET /api/editor/v1/events`：query严格且全部单值：`v,requestId,workId,runId,attemptId,limit,waitMs`必填，`cursor`可选；不接受sessionId/principal/owner/path或未知键。limit十进制整数1–100，waitMs十进制整数0–15000，cursor≤1024字符，ID同POST。H须拒绝重复query key；`editorEventsQuerySchema`处理转换与其余边界。
- 两条路径都返回 `{v,requestId,ok:true,data}` 或 `{v,requestId,ok:false,error:{code,message,retryable,retryAfterMs?}}`。回显请求的合法requestId；无法提取合法requestId的破损请求使用固定 `invalid`（不是新id/重试key）。合法未知版本回显其requestId，返回v1错误。`requestId`只做相关性，commandKey才做幂等。
- 下表字段均由 `executionInputSchemas[op]` 与 `editorResponseDataSchemas[op]`复用，不复制zod。目标T=`{workId,runId,attemptId}`；控制C=T+commandKey；ID/文本/预算边界以schema为准。

| op | command中除op以外字段 | 唯一success data | 接线 |
| --- | --- | --- | --- |
| start | workId,projectRef,commandKey,goal,budget:{timeoutMs,maxToolCalls} | ExecutionView | coding.create；H创建work后以coding真实caller调用executions.start |
| get | workId | ExecutionView | coding.get |
| lookup_start | commandKey | ExecutionView | executions.lookup-start，原key回执恢复 |
| list | limit,after? | {works:ExecutionView[],after:string\|null} | coding.list |
| send | C,text | {accepted:true} | coding.send→executions.send |
| answer | C,requestId,answer | {accepted:true} | coding.answer→executions.answer；内层requestId是问题ID |
| cancel | C | ExecutionView | coding.cancel→executions.cancel；请求停止不等于停止证据 |
| attach | workId,cursor? | ExecutionView | coding.get；cursor仅客户端续读位置，不入work持久数据，不恢复权限 |
| detach | workId | {accepted:true} | H释放客户端订阅，不调用cancel |
| events | T,cursor?,limit,waitMs | ExecutionEventPage | executions.events；GET与POST同输入输出 |
| snapshot | T | ExecutionSnapshot | executions.snapshot |
| results | workId | {results:ExecutionResult[]} | coding.results；最多100条 |
| accept | workId,resultId,commandKey | {accepted:true} | coding.accept，持久标记用户接受；不隐含提交/推送/部署 |

ExecutionView包含workId/sessionId/runId/attemptId/projectRef/status/cancelRequested/stopConfirmed。attach/get/lookup_start恢复view后，从该view四个ID构造ExecutionRef；events/snapshot先按owner/coding可见性get，核对请求runId/attemptId，再补view.sessionId，不从workId猜session。N只保存事件页返回的cursor；游标是归属约束下的位置，不是raw RPC记录、权限或持久事件本体。重连先attach，再events；gap/snapshotRequired/410时取snapshot并从新page cursor继续，不重放历史问题答案。

`EditorCommandConsumer`精确映射每个op的Promise结果，禁止用任意union碰运气。EXECUTION_CAPABILITIES仍按原禁用项，attach不悄悄改成capabilities响应。

| error.code | HTTP status | retryable |
| --- | --- | --- |
| invalid / unsupported | 400 | false |
| unauthorized | 401 | false |
| forbidden | 403 | false |
| not_found | 404 | false |
| conflict / unsupported_version | 409 | false |
| cursor_expired | 410 | false（客户端改取snapshot） |
| too_large | 413 | false |
| capacity | 429 | true，按retryAfterMs或用户动作；不自动重交start |
| unavailable | 503 | true，先恢复状态，不能盲目重复副作用 |

映射权威 `EXECUTION_HTTP_STATUS`，控制与事件共用。F/G以CallError相同code抛出，现有systemError会保留CallError；普通Error仍failed，H将failed/unknown映射unavailable，不把任意异常message返回用户。按协调者msg_190b331987c9授权，MODULE_CALL_ERRORS保留旧值并追加既有execution错误code，CallErrorCode从同一tuple派生，未增加新协议。host原有401/403/21MiB413/代理503可能先于H发生而沿用host旧body：N按HTTP status处理这类传输失败，不把非envelope正文当事件；H内成功/失败严格上述envelope，未来统一host错误正文不在本轮。

## 2. 固定routed工具与可表达manifest

`executionToolContracts`声明system executions工具，`input`直接使用完整zod，visibility固定 `["owner","modules"]`：start/get/lookup-start/list/send/answer/cancel/events/snapshot。名称lookup-start映射wire op lookup_start。输出分别为上表同op data，不带HTTP envelope。start/send/answer列入system `unrecorded`，只能同步调用，禁止ModuleInvocation持久prompt/answer；F只写key/digest回执。事件正文已规范化，G负责持久预算；不加第二队列。start/cancel/send/answer用commandKey去重，读操作幂等。

H的coding工具名固定create/get/list/send/answer/cancel/results/accept；create/get/list/send/answer/cancel/results的visibility为 `["owner","provider"]`，accept仅 `["owner"]`，避免Provider将自己的产出标记为人工接受；不向任意modules开放。coding本身uses仅列executions所需工具，**不含`*`**。经批准的owner入口（editor/web/mcp，声明uses:["*"]）可按已有admitted规则调用owner工具；普通Provider按provider可见工具调用coding。owner/API入口也必须经过coding再start，让执行归属coding真实moduleId/hash。直接owner调用executions仍允许，属于owner执行，不伪造成coding执行。

manifest顶层参数键受slug约束，不支持workId/commandKey直接声明；answer.value联合也不能用参数子集原样表达。因此8个coding工具统一参数 `{input:string}`，input是**不含op**的同一公共schema的JSON文本；`codingToolDeclarations()`可生成当前moduleManifestSchema/输出子集可消费的声明，`parseCodingToolInput(name,input)`解码并验证原schema。没有另建一套zod或改wire。

```json
{"name":"create","description":"Create a coding work; input matches execution start","parameters":{"type":"object","properties":{"input":{"type":"string"}},"required":["input"]},"visibility":["owner","provider"],"idempotent":true}
```

包内消费方式固定：协调者的官方资源准备将 `execution-tools.ts` 单一入口打包为coding/editor各自只读 `contract.js`（包含zod），H只import `./contract.js`，不假定sandbox可import仓库`@chrona/contracts`；生成文件/安装/SDK装配归协调者，不由H复制第二套schema。`execution-tools.ts`再导出execution与execution-events，打包入口齐备；当前仅导出合同，未生成/安装产品包。

完整output由 `codingToolDeclarations()`从response schema导出manifest支持的结构子集，精确内容限制仍由公共zod验证；smoke将完整生成工具放进真实moduleManifestSchema并走validateToolArgs。调用示例（同步，不把goal作为async持久payload）：

```ts
await chrona.call("coding.create", { input: JSON.stringify({ workId:"w", projectRef:"p", commandKey:"k", goal:"fix", budget:{timeoutMs:60000,maxToolCalls:10} }) });
await chrona.call("executions.start", startPayload); // coding入口处理器，真实caller由内核记录
```

coding manifest工具输出是业务view/accepted/results，不带内核可信principal。coding只管理work、结果、验收和协议适配；F执行唯一Run队列；G仅存规范化事件。H不能spawn第二Provider或执行引擎。

## 3. 真实principal、owner入口及项目授权

系统`executions.handle`在已有routed admission之后调用 `resolveExecutionPrincipal(ports,workspaceId,caller)`：

1. 直接caller.kind=owner返回固定单owner `{workspaceId,ownerId:"owner",caller:{kind:"owner"}}`。ownerId不是API_KEY摘要，不因换key改变。
2. module caller用真实workspace/moduleId/hash复核active row，再以现有callerManifest读取该hash。普通module principal保存真实moduleId/hash；名称coding/editor本身都没有特权。过期版本或停用caller拒绝。
3. 该manifest的grantedUses包含`*`时，按既有admitted owner语义成为owner入口；否则保留module身份。真正获owner授权的任意入口都可用，不增加“仅叫editor”的例外、临时token或新权限表。
4. provider/kernel/system不得伪造module直接start，需通过coding或真实owner入口。tools visibility中的modules只是可到达；实际数据由principal归属检查，不意味着任意模块能读他人执行。

coding.create虽由owner/provider调用，后续chrona.call(executions.start)的caller始终是coding自身，因此持久归属coding。`resolveExecutionProject(principal,projectRef)`在受信host侧按workspace/owner/**coding真实moduleId**映射允许路径，并复核版本权限，不允许body cwd/hostPaths/baseline或“名字相同”绕过；换moduleId须重新owner配置。直接owner使用明确owner映射，不把owner权限冒充coding。owner可读同workspace/owner下任意coding执行，module只能读自身caller归属。

lookup-start按commandKey恢复：module限自身caller key；owner可查本owner下回执，只有一个匹配时返回view，多个coding/直接owner范围同key重名时返回conflict，客户端用已有workId get；不能挑第一条泄露/错误恢复。fake已对齐，start写去重范围仍 `(workspace,owner,caller,operation,key)`。

editor manifest固定 `uses:["*"]`、listen `/api/editor`，作用是可信owner适配入口，等同现有web/mcp权威语义；必须由host安装/激活及认证gate保护。HTTP body、任意header、fake固定principal不是生产owner证明。H不读取API_KEY也不自签owner身份；通过内核真实callerManifest进入executions时才获得owner语义。

## 4. SDK、长轮询与host认证gate

SDK `chrona.serve(fetch, options?:{idleTimeout?:number})`已应用，省略参数保持Bun原默认；editor固定 `chrona.serve(handler,{idleTimeout:30})`，不复制Bun.serve。当前bun-types错误拒绝Unix idleTimeout，SDK单行附具体@ts-expect-error，真实SDK TCP→Hono→Unix15秒探针验证15001ms。测试HTTP server仍30秒；host TCP入口/反向代理也须≥20秒，外部部署链本轮未验证。

SDK call当前不携带AbortSignal，H**不能**声称HTTP断开能取消一个已发出的G 15秒routed等待。冻结选择：H持有HTTP长轮询（最多15秒，owner同时4条），每轮同步 `executions.events({...waitMs:0})`，无事件时等最多250ms或剩余时长，收到request.signal abort立即清H等待槽并停止下一轮；同时查deadline，最多一个即时routed读取在途。这样G没有被H遗留的长waiter；HTTP abort不调用业务cancel。返回页cursor决定下次读取位置。直接module使用executions.events的waitMs>0仍由G限15秒，生命周期结束自然释放，不声称SDK可以跨RPC传取消信号。当前真实probe验证SDK HTTP超时/signal代理释放；实际H轮询适配须在H验证，未偷称已实现。

host认证gate冻结决定（在 M2 共享基线实施，当前尚未应用）：

- apps/server/src/app.ts，在通用apiKeyAuth之前为`/api/editor/*`挂载“已配置API_KEY”门，空/纯空白返回503；配置后继续既有apiKeyAuth校验Bearer/来源。不能用isLocalOwnerAuthorized的未配置匿名分支。
- 仅在实际 HTTP 入口检查一次；不在 steward-runtime.listener 重复检查相同 key 配置。入口拒绝后不得调用 listener，按现有 readEnv 配置加载方式工作，不宣称支持热换 key。其他 listener/auth 默认与绑定均不改。
- editor不能只靠启动时注册成功一直开放；每个请求都过app gate。协调者接线时一并核对host TCP30秒；候选 `final-seams/editor-auth-gate-candidate.patch`。不需要给模块注入API_KEY或trusted header，Unix httpDir由host私有目录管理。

## 5. F/G同一事务与Provider/Steward typed seam

ProviderRunInput已增加可选execution:ExecutionRef、detail:ExecutionDetailSink（`append(event)`）。F持有principal并绑定sink：`detail:{append:event=>ports.executionEvents.append(principal,event)}`。Provider不选择principal，不接收owner能力；普通run无execution/detail，摘要events原样。project cwd与独立sessionDir/logs分离，不能复用其他项目providerSessionId。

StewardPorts已增加可选resolveExecutionProject/executions/executionEvents；当前host装配已注册真实F/G服务。executionEvents=`ExecutionEventStore & ExecutionEventTransactions`；写事务签名：

```ts
admit(tx: Prisma.TransactionClient, principal: ExecutionPrincipal, ref: ExecutionRef): Promise<void>;
control(tx: Prisma.TransactionClient, principal: ExecutionPrincipal, ref: ExecutionRef, fact: ExecutionControl): Promise<void>;
saveSnapshot(tx: Prisma.TransactionClient, principal: ExecutionPrincipal, snapshot: ExecutionSnapshot): Promise<void>;
```

G工厂使用协调者传入的同一StewardPorts.db；上述方法只用tx，不新建client、不`$transaction`/commit、不建队列。共享schema和单一迁移已进入开发树；以下为F/G实际同事务消费顺序：

- start：host project解析；F开启唯一写事务，在writer lock后复核caller/project、key、目录占用与全局预算；分配work/session/run/attempt引用，`createRunSession(tx)`+现有`createRuns(...).enqueue(input,tx)`，写ExecutionAttempt/key digest，再`executionEvents.admit(tx,principal,ref)`；任一步失败整笔回滚，onQueued只在commit后触发，进程只在既有claim/tick后启动。admit预留活动终态余量（256KiB快照+4KiB控制），满额抛CallError capacity；不是独立G准入事务。
- cancel：同一个F写事务内写cancelRequested/revoke事实与`control(tx,...slot:cancel/revoke)`，提交后才handle.abort。queued可证明未启动；running/unknown不虚构stopConfirmed，unknown保留目录占用且不自动重试。
- live snapshot：F在所需写事务调用saveSnapshot；G存有界状态而不恢复controller。详情append可以G自己每批短事务，不在Provider工作期持有F事务。
- finish：F在现有Run终态更新的同一tx内复核attempt/run、更新停止证据/目录占用，`control(tx,...terminal)`+`saveSnapshot(tx,...final)`。终态快照成功后G释放未用预留，按实际快照/控制字节计费；失败则Run/证据/快照全部回滚，不能先claim最终成功再补写。F须给现有Run.finish最小tx入口，普通chat/build保持旧语义；不新建finish队列。

事件Store公共append/read/snapshot仍归G；read先principal权限，再索引seek+limit/bytes，禁止load all。同seq同内容去重、冲突拒绝，gap显式。无raw/thinking；工具字段白名单后脱敏；历史问题不恢复授权。executions的start/send/answer由system unrecorded避免重复写ModuleInvocation正文；外部coding调用仍沿用现有路由记录输入的行为，H不得承诺该外部工具输入不持久化，也不得借此记录凭据/原始RPC/thinking，未来隐私策略改变须单独设计。结果不超原预算。

## 6. 数值合同与环境边界

| 预算 | 明确值 |
| --- | --- |
| event / page | 32KiB；100条/256KiB |
| buffer | 128条/256KiB、250ms flush |
| attempt / detail global | 10MiB；256MiB，终态后7天 |
| snapshot | 单条256KiB；独立16MiB，终态后30天 |
| control | 独立4MiB；每attempt 4×1KiB固定slot |
| polling | server15秒/client20秒/owner4条 |

只有活动/unknown预留完整快照/控制余量；已完成按实际有界字节占用，保留64个小快照不能阻止第65次。正文满额标missing/truncated，已预留final/control仍可写；超大最终文本使用成果引用。不能回收活动空间掩盖停止未知。G负责真实计费/retention/重启/反压/磁盘失败实现及验证，fake不重造allocator/sweep/buffer。

## 7. P1 冻结时的八门与证据（历史边界）

下表保留P1冻结时的实现边界；其中“未实现/未注册”不描述当前M2集成树。当前F/G/H/N实现与真实host及fake Pi/Neovim进展以[统一方案](chrona-workbench-unified-development-plan.md)开头状态和后续验收记录为准。

| 门 | 最终接线成果 | 实现边界 |
| --- | --- | --- |
| 1 身份接口 | schema、typed ports、resolveExecutionPrincipal、owner可读与lookup恢复语义 | Run持久服务尚未注册 |
| 2 cwd/日志授权 | host mapping签名、真实coding moduleId绑定、独立Provider cwd/sessionDir | host项目配置由协调者接线 |
| 3 事件与持久化 | public store+F-owned tx admit/control/saveSnapshot、bound detail sink | G持久计费算法未实现 |
| 4 coding/editor | 固定HTTP、逐op响应、routed名称/visibility、可表达JSON input及owner链路 | H业务适配未实现 |
| 5 TS/Lua | 既有cases.json不改，TS/Lua既有解析证据；窄consumer smoke消费真实manifest/schema | N backend/UI未实现 |
| 6 传输探针 | 实际SDK serve30秒+真实15秒auth/listen/Unix、abort/cap边界 | 外部反代/实际H循环未验收 |
| 7 接线 | Provider/Steward typed seam已应用；host认证采用单一 app 入口门；DB草案未应用 | M2 共享基线完成 schema/安装/auth/runtime，协调者审核；认证门验证前不暴露 editor |
| 8 ownership | final-seams/ownership.md精确文件与导出；H首次文件清单一次确定 | 协调者已签署；M2 按冻结清单派工 |

实际本轮日志/exit/终端closure与独立p1-final-seams.patch见 `/tmp/chrona-unified-20261105-c2mdd7yu/P1-delivery/final-seams`。旧M1/minimality/P1证据不覆盖。M1全量/build/browser未重跑；本轮无真实模型/账号/设备、原用户checkout与Workbench保持只读，无commit/push/deploy。
