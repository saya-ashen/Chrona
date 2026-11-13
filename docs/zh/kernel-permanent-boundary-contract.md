# 内核永久边界合同（冻结候选）

> 2026-11-10：此为前一阶段记录。新版公开 API 正在按[目标规范](kernel-api-design.md)改造，现状与验证见[API 实施记录](kernel-api-implementation.md)。旧接口和旧验收不证明新版能力。


本文维护现有五命名空间的源码合同；后续设计见[API 目标规范](kernel-api-design.md)，新目标尚未实现或冻结。2026-11-09 的门禁是阶段证据，后续内核及应用变更分别见[内核迁移](kernel-agent-migration.md)、[应用迁移](application-migration.md)，不能沿用旧计数证明当前整树通过。

状态：2026-11-09 本轮代码收缩及工程验收完成，**UNFROZEN（冻结候选，未宣布永久只增不删）**。具体命令、基线、结果与限制见验收记录（已从工作树删除，见 git 历史 docs/zh/kernel-permanent-boundary-validation.md）。本文依据本地主要源码，不把历史报告、旧类型导出、已存在的测试文件或此前检查次数视为本轮通过证据。[实施记录](kernel-permanent-boundary-implementation.md)记录实现与门禁。公开合同、应用所有权、仓库调用方及发布入口已经在本轮同步收缩。

## 1. 所有权与适用范围

架构只有内核与应用两类。内核持有身份、路由、精确授权、凭据隔离、预算、单 Run 队列、租约、取消、实际停止证据、持久化及受控生命周期。应用持有业务政策、工作流、配置、会话日志、提示、展示、通知措辞与投递。`runtime-callback`、`workspace-local` 是内核内部宿主实现，不是第三类应用，也不是公开命名空间。

Agent 是唯一不可变内置应用，Pi 是唯一内置 Provider。Agent 是独立 SDK 进程，持有 Pi 适配器、操作句柄和应用私有模型政策；内核管执行准入和硬上限。Agent 的改动随 Chrona 发布，不允许动态候选替换、回滚、删除或冒充其身份。身份来自持久化 `Module.builtin` 及当前批准版本，不来自模块名、目录或调用参数。

Web、Notify、QQ、Author 是普通默认预装应用；Files、Events、memory-local 等是普通可选应用。预装不授予额外权限，不构成新的身份等级。Web/Notify 可以通过受控普通应用生命周期更新、暂停、替换和申请删除；仍须满足依赖、审批、实际停止、备份及数据损失守卫，不能据此绕过入口应用约束。初始化账本记录安装或跳过，不在移除后自动补装，不覆盖现有选择或定制。`origin: kernel | builtin | external` 与 `capabilities` 是当前 wire 元数据，不应被展示成第三种架构类别；旧 capability 操作名称也不是工具注册表。

本轮只用临时数据库和全新数据目录验收；不迁移现有用户数据，不支持旧接口、旧代码兼容或兼容别名。不以文档盘点授权模型调用、网络、真实账号、生产服务或部署验收。

## 2. 路由、发现和结果语义

主要源码：`packages/engine/src/modules/steward/system-modules.ts`、`module-calls.ts`、`module-owner.ts`、`module-tools.ts`、`module-reference.ts`，以及 `packages/contracts/src/steward/index.ts`。

`registerSystemModules()` 当前只公开五个内核命名空间：`modules`、`approvals`、`settings`、`secrets`、`activity`。Agent 工具通过应用 Manifest 路由。历史 schema 或私有构建函数不注册公开接口。

- 普通应用使用 `chrona.call(target, args, options?)`；`target` 是 `<module>.<tool>`。`options` 包含 `mode: sync | async`、`key`、`reply`、`timeoutMs`、`expectedTarget?: {moduleId, contractHash}`。同步返回工具结果；异步返回 `{callId,status,duplicate}`，用 `chrona.callStatus(callId)` 核对 `{callId,status,output?,error?}`，或接收 `call_result`。状态为 `queued | running | waiting | succeeded | failed | unknown`；等待审批不能伪装为成功。
- 真实 caller、workspace、moduleId/hash 由路由绑定。`visibility` 定义受众；普通 `uses` 是声明合同，不是通用 runtime allowlist。当前批准且活跃的 `uses: ["*"]` 应用可进入 owner 受众，owner 写操作还须 `requireOwner` 等实际身份检查。敏感原语另有精确限制；发现、提示、材料 provenance 均不授予权限。
- `modules.tools` 是可达工具发现面，排除私有宿主和暂停应用。`audience: user` 只筛选 owner/provider 可见工具，仍受当前 caller 准入限制，不把调用者升级为 owner。应用结果提供 `moduleId`、当前 `hash` 和 64 位十六进制 `contractHash`；需要固定回调时传 `expectedTarget`。`hash` 标识源码版本，`contractHash` 标识工具合同，两者不能互换。
- `modules.reference` 只读声明文档，无启动、检出或业务数据读取。`outputSchema: null` 表示未声明；缺少 `examples`、`errors`、`sideEffects` 不等于无风险或结果为空。reference 收集代码显式跳过暂停应用，且只读取当前批准的活动版本；文档发现本身不授予调用或执行权限。
- 异步入队与实际交付都检查目标身份和合同。声明 `idempotent: true` 的目标可在规则允许时重投；未知的非幂等效果不自动重放。失去答复先核对固定结果，不开新 request key 猜测重试。取消请求不等于停止，`unknown` 停止仍占容量。

### 2.1 `contractHash` 的语言中立算法

系统工具以已提交的 `packages/contracts/schemas/system-tools.json` 为合同源，条目为 `target → {input, output, visibility, idempotent}`；包括五个公共命名空间和构建工具 `chrona_reply`。`module-manifest.json` 保存构建提示使用的 Manifest 输入 schema。生成命令为 `bun scripts/generate-contract-schemas.ts`，一致性检查为同命令加 `--check`。生成器只读取公共声明，不加载处理器、Agent 或应用运行时；运行时发现与 hash 直接读取 JSON，zod 仍负责实际输入/输出校验。

普通应用工具从 Manifest 的 `parameters` 递归生成 `input`：根对象保留 `properties`、`required`，并固定 `additionalProperties: false`；嵌套对象补齐缺省的 `required: []`，保留声明的 `additionalProperties`；数组保留 `items`，并递归规范化；标量保留所有声明字段。对象和数组保留非空 `description`。未声明 `output` 时使用 `null`，声明时保留原始 JSON Schema；系统条目的完整 zod 输入/输出已在构建期转换，不能在运行时重新转换或去除 `$schema` 等字段。工具的名称、源版本和工具级说明不参与 hash，schema 内的说明参与。

1. 构造 `{input, output, visibility, idempotent}`，其中只有 `visibility` 先按 ECMAScript 默认字符串排序（UTF-16 码元）排序。`required`、`enum`、`anyOf` 等其他数组保持声明顺序。
2. 严格按以下 ECMAScript `JSON.stringify` replacer 序列化，无空格、无尾换行：

   ```js
   JSON.stringify(contract, (_key, item) =>
     item && typeof item === "object" && !Array.isArray(item)
       ? Object.fromEntries(Object.entries(item).sort(([left], [right]) =>
           left < right ? -1 : left > right ? 1 : 0))
       : item);
   ```

   对象键比较使用 UTF-16 码元顺序，不使用 Unicode 码点、locale 或 UTF-8 字节顺序。`Object.fromEntries` 后仍遵守 ECMAScript 自有属性枚举：数组索引形式的键（`0` 到 `4294967294` 的规范十进制文本）先按数值递增，再列出其余已排序键。因此不能直接用字典序输出所有键。对象中的 `undefined` 字段省略；数组内的缺项/`undefined` 按 `JSON.stringify` 输出 `null`。
3. 字符串转义和数字格式严格遵循 ECMAScript `JSON.stringify`：通常直接输出非 ASCII 字符；孤立 surrogate 使用转义；`-0` 输出 `0`；数字使用 ECMAScript 最短表示及其指数格式（例如 `1e-7`、`1e+21`）。不做 Unicode 规范化。
4. 对上述文本的 UTF-8 字节取 SHA-256，输出 64 位小写十六进制。

跨语言 golden 数据在 `packages/contracts/fixtures/contract-hashes.json`（125 个 S0 hash）、`contract-hash-cases.json`（包含规范化结果和精确序列化 preimage）及 `agent-tools.json`。允许的阶段变更逐项记在 `contract-hash-transitions.json`；S3 不重写旧 fixture。`contract-hash-baseline.bun.test.ts` 检查全部基线与合成向量，`scripts/generate-contract-schemas.bun.test.ts` 另独立核对新生成系统合同的 hash 与已提交 JSON 的字节一致性。

以下表中 `?` 表示可省略，`null` 表示显式空值，`[]` 表示数组。复杂嵌套对象以其实际 schema 名及主要字段说明，完整类型以对应源码为准；表不额外发明接口。

## 3. `modules`：当前恰好 13 个工具

主要源码：`system/modules.ts`、`system-outputs.ts`、`module-diagnostics.ts`、`module-reference.ts`、`module-candidates.ts`；路径均相对于 `packages/engine/src/modules/steward/`。

| 工具 | 输入字段 | 输出字段/形状 | 受众与实际权限 |
| --- | --- | --- | --- |
| `modules.list` | `{}` | 应用数组：`id,name,description,status,builtin,activeHash,origin,capabilities,health,versions,runs`；`versions` 最多 5 项：`hash,status,createdAt,errors,git:{commit,tree}\|null`；`runs` 最多 5 项：`id,hash,triggerId,firedAt,exitCode,error,createdAt` | modules/owner/provider；只读身份与观察事实 |
| `modules.tools` | `{query?,audience?:caller\|user}` | 数组：`moduleId?,hash?,contractHash?,target,description,inputSchema,outputSchema,examples,sideEffects,errors,retry,idempotent`；系统工具没有应用身份字段 | modules/owner/provider；仅当前可达合同 |
| `modules.reference` | `{target?}` | 无 target：`[{target,source:{kind,hash},description}]`；有 target：再含 `inputSchema,outputSchema,documentation,examples,sideEffects,errors,retry,admission:{visibility,uses,idempotent},routingErrors,contractHash` | modules/owner/provider；声明文档；已注册 `modulesReferenceOutput`，明确索引数组与详情对象两种输出 |
| `modules.diagnostics` | `{module?}`（名称或 id） | 最多 100 项；健康摘要再含 `incidents,contractFailures,evolution,evidenceTrust`，各证据列表最多 5 项 | modules/owner/provider；日志是不可信历史证据 |
| `modules.health` | `{open?:"true"\|"false",cursor?}` | `{items,nextCursor}`，最多 50 项；摘要字段 `module,moduleId,activeHash,configuredStatus,observedAt,runtime:{state,pid},activation,consecutiveFailures,incident,contractFailureCount,open,nextAction,truncated` | modules/owner/provider；只观察，不调用应用自检 |
| `modules.admit-candidates` | `{requestKey,submitter:{moduleId,hash},targets:[{name,moduleId,expectedActiveHash}]}` | `{admissionId,requestKey,submitter,targets}` | owner；重新核对授权方、批准提交方和完整目标基线；仅材料准入 |
| `modules.source` | `{admissionId,moduleId,hash,to}` | `{moduleId,hash,materialDigest}` | modules；必须是真实获准提交方；仅准入内已有目标的精确批准 Git 基线，写入该提交方 content |
| `modules.submit` | `{admissionId,requestKey,items:[{name,dir,intent:{changes,preserves?}}]}` | 固定 `CandidateReceipt`，见下一节 | modules；完整目标集合、真实提交方、基线、路径和不可变材料均须匹配 |
| `modules.candidate-check` | `{receiptId}` 或 `{admissionId,requestKey}`，严格二选一 | 同一固定 `CandidateReceipt` | modules；处理器只允许当前提交方身份或经检查 owner；不选择 latest，不授权执行 |
| `modules.rollback` | `{module,hash}` | `{status:"active",moduleId,activeHash}` 或 `{status:"pending_approval",approvalId}` | owner + `requireOwner`；仅已批准版本，数据恢复独立审批 |
| `modules.disable` | `{module,reason}` | `{status:"paused"\|"active",moduleId}` 或 `{status:"pending_approval",approvalId}` | owner + `requireOwner`；保留数据、停止守卫 |
| `modules.enable` | `{module,reason}` | 同上 | owner + `requireOwner`；不能越过暂停名单或 Agent 身份限制 |
| `modules.remove` | `{module,reason}` | 同上；审批返回不表示已删除 | owner + `requireOwner`；删除审批、依赖、备份、实际停止和数据损失检查 |

没有公开 `modules.build`、`build-owner`、`propose`、`check`、`checkout`、`request-group`、`install`、`upstream`、`configure`、`settings`、`interfaces`、`permissions`、`contributions`、`report-health`、`stop-build`、`revise-build` 或 build-session 查询系列。原子候选集合属于 `submit` 及其 receipt 的内部生命周期，不另开 group API。

## 4. 固定材料合同与 Author 实际工作流

共享 schema：`packages/contracts/src/steward/module-candidates.ts`。`targets`、`items` 各 1–4 项，名称唯一；目标已有 `moduleId` 也须唯一。新目标用 `moduleId:null,expectedActiveHash:null`，已有目标绑定精确 id 和活动 hash。`requestKey` 为 trim 后 1–120 字符，身份 id 为 1–128 字符，版本 hash 接受 40 或 64 位十六进制；实际源码导出要求已存储的批准 Git commit（40 位）。`materialDigest` 是 64 位十六进制 SHA-256。`intent.changes` 为 1–20 项、每项最多 500 字符，`preserves` 为 0–20 项、默认 `[]`。

`CandidateReceipt` 实际字段：

```text
{
  receiptId, admissionId, requestKey, submitter: {moduleId, hash},
  state: submitted | pending_approval | approved | rejected,
  approvalId: string | null,
  members: [{name, moduleId, hash, versionId, expectedActiveHash,
             materialDigest,
             status: building | testing | pending_review | approved | rejected,
             selected: boolean}]
}
```

提交前冻结整个集合的文件、Manifest、entry 和必要 migration 材料，保存 Git revision，再在一个事务里绑定准入、所有候选及唯一 receipt，之后交给检查队列。并发或 lost reply 重放先查 receipt 再读文件；同 key 同参数返回既存结果，材料之后变化或删除不重新生成候选；同 key 不同参数 `conflict`。准入只消费一次。receipt 的最终 `state` 持久化，`selected` 是当前活动 hash 投影，不能把“曾批准”等同“现在仍选中”。

检查和最终激活再次核对授权方、提交方、成员、活动基线、数据与凭据条件；集合不能部分激活。有凭据变更等条件时使用绑定精确成员的审批。准入不代替后续检查或审批，也不授权模型、目录、预算、自动重试或任意源码读取。具体运行与并发结果仍待最终门禁。

Author 主要源码：`external/author/module.json`、`contracts.ts`、`workflow.ts`。它是普通应用，自己的 `uses` 只有 `modules.source`、`modules.submit`、`modules.candidate-check`，没有准入签发或 Agent 执行能力。

| Author 工具 | 实际输入 | 实际输出 | 权限/用途 |
| --- | --- | --- | --- |
| `author.prepare` | `{input:JSON文本}`，文本为 `{requestKey,submitter,targets,goal,intent}` | `{kind:"material-preparation",request:{goal,targets,intent},admission:{requestKey,submitter,targets},prompt}` | owner；只准备材料说明和准入草案，owner 核对 submitter 是当前批准 Author 身份 |
| `author.write` | `{path,content}` | `{path,size}` | provider/modules/owner；Author 私有 content 内受限材料 |
| `author.read` | `{path,offset?,limit?}` | `{path,size,offset,nextOffset,eof,content}` | provider/modules/owner；有界读取 |
| `author.list` | `{path}` | `{path,entries:[{name,kind:file\|directory}]}` | provider/modules/owner；有界目录 |
| `author.import` | `{input:JSON文本}`，文本为 `{from,to,source,artifacts,build}` | `{path,record,files,bytes,materialDigest}` | owner；从明确工作目录导入所选源码及二进制，自动记录摘要，整体发布到新的 Author 源码目录；不编译 |
| `author.export` | `{input:JSON文本}`，文本为 `{path,to}` | `{path,to,files,bytes,materialDigest}` | owner；从 Author 自有源码/阶段材料导出到新的工作目录，保留完整源码、记录和产物；不覆盖现有目标 |
| `author.stage` | `{input:JSON文本}`，文本为 `{name,from,to,provenance}` | `{name,dir,metadata,files,bytes,materialDigest}` | owner；from 为 `sources/<workspace>` 或 `packages/<stage>/source`，to 为 `packages/<stage>`；来源说明不是授权 |
| `author.source` | `{input:JSON文本}`，文本为 `{admissionId,moduleId,hash,to}` | 原样转交 `modules.source` 结果 | owner；`to` 为 `sources/<workspace>`，内核看到的实际 caller 是 Author |
| `author.submit` | `{input:JSON文本}`，文本为 `{admissionId,requestKey,items}` | 原样转交 `modules.submit` receipt | owner；`dir` 为 `sources/<workspace>` 或 `packages/<stage>/source`；重放不先读取可变材料 |
| `author.receipt` | `{input:JSON文本}`，文本为 `{receiptId}` 或 `{admissionId,requestKey}` | 原样转交 `modules.candidate-check` receipt | owner；只核对精确选择器 |

`stage.provenance` 是 `{kind:"local",label}` 或 `{kind:"kernel-source",moduleId,hash,ref,materialDigest}`，属于调用者提供的材料说明。Author 不允许以 `agent` 为材料目标。

当前闭环由当前对话 Agent 完成：经 `modules.list` 核对当前批准 Author 的 moduleId/hash 与全部目标 → 调用 `author.prepare` 获得草案和创作指引 → 以真实 owner 入口身份调用 `modules.admit-candidates`，绑定 Author 提交身份、完整目标和精确活动基线 → 在当前工作区使用已有文件/命令工具编写、编译、测试，再经 `author.import` 导入明确源码与产物（小段文本也可用 `author.write/read/list`；更新先经 `author.source` 取回获准精确基线，再用 `author.export` 导出重建）→ `author.submit` → `author.receipt` 核对固定回执、检查和审批状态。Author 转交 source/submit/candidate-check 时使用实际 Author 身份，不能通过参数冒充。调用准入的是当前 Agent 所代表的真实入口，而不是 Author。

`prepare` 是纯材料准备：不写文件、不启动模型、不签发准入、不提交或安装。当前 Agent 沿用已有 Run、工具权限、预算、取消与期限，无需另起 Agent、队列或新增内核能力。材料准入仍不授权模型执行；不能从 prompt、准备结果或 pending 回执推断检查、审批、激活成功。丢失回复后保留原 requestKey，按 receiptId 或 admissionId/requestKey 核对，不自动换 key 重投。工程验证与限制见[当前对话创作记录](author-current-conversation.md)。

## 5. 其余四个内核命名空间

主要源码：`system/approvals.ts`、`system/settings.ts`、`system/secrets.ts`、`system/activity.ts`、`system-outputs.ts`、`notification-facts.ts`、`activity.ts`。

| 工具 | 输入字段 | 输出字段/形状 | 实际权限与边界 |
| --- | --- | --- | --- |
| `approvals.list` | `{status?:open\|approved\|denied\|expired}` | Approval 数组；默认 open | owner + `requireOwner` |
| `approvals.resolve` | `{approval,decision:approve\|deny}` | Approval | owner + `requireOwner`；只传递用户已作出的决定，内部固定 once；无公开 scope 选择 |
| `approvals.request` | `{title,detail?,preview?}` | `{approval,decision:approved\|denied}`；等待时持久化 waiting | 真实 module；异步 `reply:true`；同 call 复用一份请求，不授予 standing grant |
| `approvals.status` | `{approval}` | `{approval,status,hash,resolvedAt}` | 只读该 module 自己发起的请求 |
| `settings.get` | `{}` | `{timezone,modelUsage,moduleModel}` | module（`entry(caller)`）；内核治理事实 |
| `settings.update` | `{settings:JSON文本}`；文本只含 `timezone?`、`moduleModel?` | 同上 | owner + `requireOwner`；没有通用应用设置存储 |
| `secrets.get` | `{name}` | `{value:Record<string,string>}` | 当前批准 module Manifest 必须声明该 secret；不返回 refresh token/隐藏字段；不记录调用敏感值 |
| `secrets.set` | `{name,value:JSON文本,merge?:boolean}` | `{name,configured:true}` | owner + `requireOwner`；value 为 1–20 个非空字符串字段；不记录值 |
| `secrets.remove` | `{name,field?}` | `{name,configured:boolean}` | owner + `requireOwner`；删除字段保持 OAuth 锁和失效守卫 |
| `secrets.list` | `{}` | `[{name,configured,updatedAt,modules}]` | owner + `requireOwner`；仅名称、时间、声明者，无值 |
| `secrets.authorize` | `{name,provider,scopes,account?}` | `{url,redirectUri,expiresAt}` | 声明该 secret 的批准 module，或经处理器检查的 owner；须已有批准 OAuth 定义；provider 为 google/microsoft，scopes 是空格分隔文本；不记录敏感调用 |
| `secrets.token` | `{name,provider,account?}` | `{accessToken,expiresAt}` | 声明该 secret 的批准 module；短期交付，不记录，不把 refresh token 交给应用 |
| `activity.runtime` | `{}` | `{provider,moduleSandbox,queuedRuns,runningRuns,failedRunsToday,lastTickAt,at}` | modules/owner；运行事实，不含 `dueSchedules` 或公开调度能力 |
| `activity.runs` | `{session?}` | `[{id,sessionId,sessionTitle,active,status,progress,usage,resources,interactions,updatedAt}]` | modules/owner；只读状态、用量和待交互事实，无 transcript 或执行权限 |
| `activity.records` | `{before?}` | `{rows:[{id,at,kind,subject,module,hash,approvalTitle,details}],before}`，最多 200 条 | modules/owner；allowlist、脱敏元数据，无原始 audit payload |
| `activity.consumer` | `{module?:string\|null}`（实际为模块 id） | `{moduleId,revision}` | owner + `requireOwner`；省略读取，null 取消；切换前须暂停旧消费者 |
| `activity.facts` | `{}` | `{revision,facts:[{id,at,type,data}]}`，最多 50 条 | 仅选中的真实活跃 module 身份；不记录消费调用 |
| `activity.ack` | `{revision,ids:string[1..100]}` | `{acknowledged:string[]}` | 选中身份及当前 revision；重复消费有固定归属，不重投已确认事实 |
| `activity.withdrawals` | `{revision,keys:string[1..100]}` | `{withdrawn:string[]}` | 同上；持久 tombstone 对账；不记录消费调用 |

`approvals` 仅公开上表的 `list/resolve/request/status` 四个工具。Approval 字段为 `id,action,moduleId,title,detail,preview,status,createdAt,resolvedAt`；`action` 精确为 `activate_module | delete_data | modify_external`。决定绑定具体 approval 及其 payload；模块请求恢复原 waiting call，不创建通用或 standing grant。没有公开 grants/revoke 工具，也没有公开 always/scope 参数；保留的内部 policy、Grant 存储或共享 schema 不构成公开授权合同。

`settings.moduleModel` 为 null 或 `{maxCallsPerEvent,maxOutputTokens,dailyCalls,eventTimeoutMs,moduleDailyCalls?}`；上限范围分别是 1–20、1–32000、1–10000、5000–600000 ms，`moduleDailyCalls` 值为 0–10000。`modelUsage` 项为 `{module,calls,inputTokens,outputTokens}`。这些是硬上限和预算日界时区；模型选择、thinking、应用偏好和通知设置由应用私有工具管理。

`activity.facts` 的 `type` 仅为 `notice | lifecycle | withdraw | approval`，`data` 遵循 `kernelFactSchema`。内核在状态事务中保存有限事实，不调用 Notify、不决定文案和投递。消费者必须先私有持久化、再 ack、再投递；恢复或更换选择后用 withdrawals 对账。默认预装可一次性 seed Notify，显式 null 或后来选择不会被覆盖。

OAuth 刷新、同意绑定和敏感交付仍是必要保留机制；这不构成“凭据边界审议已经全部完成”的声明。

## 6. Agent 应用面与私有宿主

主要源码：`builtin/agent/module.json`、`module-contracts.ts`、`context-contracts.ts`、`primitives.ts`、`model-policy.ts`、`runtime.ts`，以及 `agent-application.ts`、`agent-delegation.ts`、`agent-context-tools.ts`。

Agent SDK Manifest 使用 kebab-case 参数（如 `request-key`、`context-id`、`max-output-tokens`）；应用处理器规范化成下表 camelCase，嵌套字段同样处理。不得同时提交规范化后重名的参数。Kernel 的 `{input:JSON文本}` 私有调用形状不能作为普通 module API 使用。

| Agent 工具 | 实际解析输入字段 | 输出字段/形状 | 权限 |
| --- | --- | --- | --- |
| `agent.health` | `{}` | `{name,supportsRunModel,complete,available,sandboxed,error}` | modules；运行时可用性不等于业务就绪 |
| `agent.configure` | `{config?:{tiers:Record<tier,{model,thinking?}>,preferredTimeoutMs},clear?}` | `{config:policy\|null,ready}` | owner；每次读写通过当前 routed call 再检查 owner 准入；clear 与 config 不能同时设置 |
| `agent.complete` | `{commandKey,prompt,system?,maxOutputTokens}` | `{operationId}` | 当前批准 module、实际 call 绑定；须 Manifest model 声明与预算；不能从此参数选择 model/provider/timeout |
| `agent.completion` | `{operationId}` | `{result:{text,inputTokens,outputTokens}\|null,failure,unknown?}` | 绑定原 module 操作，不能取他人的结果 |
| `agent.context` | `{requestKey}` | `{contextId}` | 当前批准 module；应用拥有自己的上下文日志和政策 |
| `agent.run`（上下文） | `{contextId,requestKey,prompt,content?,lane?,tools?}` | `{runId,contextId,status,active}` | 原 module 身份；tools 仅从该 caller 已准入目录选择，不借 Provider 提权 |
| `agent.get`（上下文） | `{runId}` | 同上 | 只访问该 caller 绑定 Run |
| `agent.stream`（上下文） | `{runId,after?,limit?}` | `{items:[{sequence,at,kind,payload}],after,ended,transcript,interactions}` | 有界、脱敏；默认 limit 50，最多 100 |
| `agent.write`（上下文） | `{runId,requestKey,text}` | `{accepted:true}` | 精确 Run、真实 caller、当前控制准入 |
| `agent.interrupt`（上下文） | `{runId,requestKey}` | `{runId,contextId,status,active}` | 请求停止；不伪造实际停止证据 |
| `agent.respond`（上下文） | `{runId,requestKey,questionId,answer}` | `{accepted:true}` | 只回答该 caller 的待交互 |
| `agent.run`（执行） | `{executionId,requestKey,prompt,projectRef,resumeFrom?,budget:{timeoutMs,maxToolCalls}}` 或 V2 的 `{executionId,requestKey,prompt,kind:"execution",placement:{executorId,projectRef,mappingRevision},workspace:{mode,baseline,source?},budget,queueExpiresAt,resumeFrom?}` | `{execution,placement?}` | 原 caller、host project grant、预算、基线、固定设备准入；不能用输入指定任意 cwd |
| `agent.get`（执行） | `{executionId,runId?,attemptId?}` | `executionViewSchema` | 绑定该执行身份 |
| `agent.lookup` | `{requestKey}` | `executionViewSchema` | 只核对该 caller request |
| `agent.stream`（执行） | `{executionId,runId,attemptId,cursor?,limit?}` | `{events,cursor,highWatermark,gap,snapshotRequired}` | 精确 attempt 的有界事件 |
| `agent.write`（执行） | `{executionId,runId,attemptId,requestKey,text}` | `{accepted:true}` | 精确 attempt 控制 |
| `agent.interrupt`（执行） | `{executionId,runId,attemptId,requestKey}` | `executionViewSchema` | 取消与实际停止分开 |
| `agent.respond`（执行） | `{executionId,runId,attemptId,requestKey,questionId,answer}` | `{accepted:true}` 或 `{accepted:false,error:{code,message}}` | 精确 question 绑定；仅明确在消费命令前拒绝的验证失败返回 false，未知结果继续报错 |
| `agent.inspect` | `{executionId,runId,attemptId}` | `{snapshot,source}`，source 为 `executionResultSourceSchema` | 精确执行结果证据，不靠模型文本判断来源 |
| `agent.placement` | `{executionId}` | `executionPlacementViewSchema`：`workId,sessionId,runId,attemptId,placement,workspace,queueExpiresAt,online` | 受控位置事实 |
| `agent.locations` | `{after?,limit}` | `{locations,after}`，位置含 `executorId,projectRef,mappingRevision,label,kind,online,baseline,workspaceModes` | 受控 host 配置视图，不授予目录权限 |
| `agent.cleanup` | `{workId,commandKey,action:"preview"}` 或 `{workId,commandKey,action:"confirm",previewDigest}` | `{workId,workspaceRef,state:retained\|blocked\|removed\|unknown,reason,previewDigest:null\|SHA256}` | receipt 优先，确认删除须精确 preview 和守卫；输入为 `workCleanupInputSchema` |

`executionViewSchema` 为 `{workId,sessionId,runId,attemptId,projectRef,status,cancelRequested,stopConfirmed}`。Coding 的普通应用接入和验收记录见 `coding-peer-clients-implementation.md`。Editor 已退役并移除，见[退役记录](editor-retirement.md)；本轮不包含真实模型或外部设备验收。

模型政策存于 Agent 私有 data 的 `model-policy.json`，0600 文件及原子替换；tier 映射给出 model/thinking，timeout 取应用偏好与内核事件硬上限的最小值，输出 token 同样受请求及内核硬上限约束。Kernel 硬上限是 `maxCallsPerEvent,maxOutputTokens,eventTimeoutMs`，另有日预算；应用不能自行增加上限。应用通用配置不回流到内核 settings。

隔离 model completion 的 token-limit extension 当前仅按 Pi 1.5.0 验证，并要求 Provider 请求原生带有已支持的输出 token cap。Codex（`openai-codex-responses`）及不支持该 cap 的模型在 completion 路径 fail closed；普通前台 Pi RPC 不受此限制影响。这是 `pi-model-gateway.ts` 的当前实现限制，不代表本轮已通过真实模型验收。

Agent 的 `start/status/inject/abort/release/transcript` 为 kernel-only，原 module 六分支不可调用。kernel-only complete/completion 与 module 同名工具采用不同输入解析。Run token、宿主 cwd/session 路径、callbackId 及原始 principal 由内核绑定，不接受普通应用伪造。

| 内部宿主 | 实际输入 → 输出 | 权限与隐藏边界 |
| --- | --- | --- |
| `runtime-callback.event` | `{callbackId,event}` → Provider answer 或 null | workspace 内 opaque callback；仅内核或当前批准 builtin Agent，生命周期结束释放 |
| `runtime-callback.agent-admit` | `{callId,operation,settle?,execution?}` → 操作对应结果；configure 为 `{authorized:true}`，complete 为 `{reservationId,declaredTier,effectiveHardLimits}` | 仅当前 builtin Agent；从存活 routed call 恢复原 module、args、预算和操作，不由参数自授身份；settle 仅用于上下文 write/interrupt 的结算 |
| `runtime-callback.agent-settle` | `{reservationId,result?:{text,inputTokens,outputTokens},failed}` → null | 仅当前 builtin Agent；workspace 内已存在模型 reservation 的用量结算；不接收 callId/operation，也不授予新执行权限 |
| `workspace-local.prepare` | `{request:{principal,input,grant,attemptId,workspaceRef,phase}}` → `{lockId,bindingDigest,cwd,projectDirectoryIdentity,workspaceDirectoryIdentity,workspace,sourceReceipt,verifiedAt}` | kernel-only；phase 为 admission/claim，server grant 与真实目录身份 |
| `workspace-local.release` | `{lockId}` → `{released:true}` | kernel-only、workspace 绑定锁 |
| `workspace-local.cleanup` | `{principal,input}` → `workCleanupReceiptSchema` | kernel-only；receipt 与实际停止/删除守卫 |
| `workspace-local.capture` | `{runId}` → `{captured:true}` | kernel-only；本机已绑定 attempt |
| `workspace-local.capture-file` | `{runId,path}` → `{name,ref,size,mime,sha256}` | kernel-only；捕获到真实接收应用 content |
| `workspace-local.result` | `{attemptId}` → `executionChangesSchema\|null` | kernel-only；已有不可变捕获 |

私有宿主不进入 `listSystemModules()` 的公开发现目录。救援入口是独立宿主操作，不能作为日常公共 build API；仍保留精确 hash、身份、审批和数据守卫。本文不授权调用救援、修改 host 配置或执行生产操作。

## 7. Manifest、SDK 与普通应用迁移

Manifest 真正的严格 schema 位于 `packages/contracts/src/steward/index.ts` 的 `moduleManifestSchema`。当前字段为：

| 字段 | 当前含义 |
| --- | --- |
| `name,description?,entry` | 版本身份、描述、入口；entry 为 ts/py/sh |
| `tools` | 最多 30 个声明工具；字段 `name,description,output?,examples?,sideEffects?,errors?,parameters,visibility,idempotent`；新候选输出合同要求由构建检查执行，历史可选 schema 不代表旧兼容承诺 |
| `keepAlive,activated,content,listen?` | 进程/激活事件、私有 content、受控 HTTP 入口；listen 要求 keepAlive，不能占保留路径 |
| `uses,packages,secrets` | 路由声明、系统依赖、凭据声明；语言库使用锁文件；提交不带 node_modules/.venv/.chrona |
| `model?` | `{tier,maxCalls,maxOutputTokens}`，使用 `agent.complete` 时声明；不含 provider/model 选择 |
| `effects` | 只允许 `network` |
| `params` | `Record<name,{type:number\|string\|boolean,value}>`；版本内常量，不是可变用户配置 |
| `data` | `{schema,migrate?}`；保留数据安全机制不表示本轮迁移现有用户数据 |
| `tests` | 1–10 个离线作者测试入口 |

已移除 Manifest `settings`、`triggers`、`dynamicSchedules`、`channel`、`contributes`、`healthCheck`、`builds`，以及 S1 删除的 `limits` / `limits.virtualMemoryMb`。严格 schema 会拒绝旧字段；不再承诺硬虚拟内存限制，`model` 的额度仍是模型调用与输出预算。旧 schema 说明里的这些字段不能作为新材料模板。应用设置经各自工具（如 `web.settings`、`notify.settings`、`agent.configure`）写自己的私有 data。观察健康只来自 modules.health/diagnostics；没有公共自报健康或内核主动业务探测。

Web 当前普通应用工具包含 `today/reply/component-set/component-remove/page-set/page-remove/pages/catalog/settings`；`component-set/remove` 为真实模块调用者注册/移除当前版本的可信同页组件，详细契约见 [Web 可执行组件](web-executable-components.md)。Web 负责会话、页面与导航。Notify 当前普通应用工具为 `settings/lifecycle/activity/approval/send/withdraw/channel/list/status/feedback/retry/configure/import`；保留的 kernel 可见工具声明不表示内核仍直接调用它们。内核通知只提供有限 facts，Notify 持有本地存储、预算、quiet hours、digest、渠道登记和投递政策；应用仍可用 `notify.send`。SDK 已移除 `chrona.model`、`chrona.notify`、`chrona.wakeProvider` 助手；应用通过已声明的 routed tools 调用相应能力。

没有公开 `schedules.*`、`projects.*`、`history.*`、`chat.*`、`provider.*`、`executions.*`、`content.*` 或 `memory.*` 内核命名空间；应用私有工具与内部 host 不因此改成系统服务。SDK 导出的 `Trigger` 排除 schedule，`on` 不公开接受 schedule；私有 `WireTrigger`、schedule delivery 与 tick drain 仍接通，不能把公开接口移除写成内部 drain 已删除。Manifest 的 model 校验只针对 `agent.complete`；当前 modules schema 文案和 Web `uses` 已对齐收窄后的工具，不再列旧查询/构建或 schedules 目标。

## 8. 暂停、残留与冻结门禁

`module-availability.ts` 的整应用暂停名单精确为 `remind`，保留源码及依赖材料，拒绝安装和运行接入；路由返回 `unavailable`、reason `module_paused`。初始化对其记录 skipped，不能自动删除或从源码验收推断恢复授权。Mind 已恢复为普通可选应用，部署及自动化限制见[Mind 记录](mind-implementation.md)。Editor 已退役移除，见[退役记录](editor-retirement.md)。Coding 与 coding-web 的普通应用接入见[客户端实施记录](coding-peer-clients-implementation.md)。

2026-11-09 后续迁移恢复 MCP 为普通可选应用，使用现有内核工具与应用私有配置；没有新增内核 API。安装后提供鉴权的 `/api/mcp`，不恢复旧自动构建、调度或集中应用配置接口。验收见 [MCP 迁移记录](mcp-minimal-boundary-migration.md)。

memory-local 不在上述整应用暂停名单；保留 recall/retain/forget/preferences/remember/conversation-context/conversation-retain，定时 consolidation 暂停。不得为唤醒这些应用恢复旧内核 scheduler 或新建通用 timer bus。

Notify 应用专属 lenient 分支已删除。普通应用调用缺失或不可用目标时，在创建异步队列记录前拒绝；Notify 与其他普通目标遵循同一规则。受限的内核内部延迟解析不赋予普通调用者该权限。

以下工程出口已完成本轮范围验收；计数、环境与限制统一记录在验收记录（已从工作树删除，见 git 历史 docs/zh/kernel-permanent-boundary-validation.md）：

| 门禁 | 验证内容 | 状态 |
| --- | --- | --- |
| 路由与残留 | 五命名空间、modules 13 工具及 approvals 四工具；删除旧入口和 scope 参数的真实拒绝；reference 暂停过滤与已注册输出；调用方/发布资源无旧入口依赖；异步 notify.send 缺失目标须在入队前拒绝；内部保留类型、私有 schedule drain 与旧文案须按实际用途核对 | 通过 |
| 材料与集合 | 真实 caller/issuer/submitter、精确完整集合、变更基线、恶意路径/symlink、并发重放、lost reply 后文件变化/删除、固定 receipt、审批后重查、无部分激活 | 通过 |
| 治理与敏感交付 | owner 授权、HTTP health/API 鉴权、waiting/error wire、contract hash/pinning、Agent 旧六分支拒绝、预算/租约/unknown/停止证据、OAuth 与 secret 不记录 | 通过 |
| 普通应用与暂停 | Web/Notify 普通身份、暂停替换删除、不补装、单消费者 facts/ack/withdrawals；当轮暂停入口和源码保留已检查，后续恢复及退役见各应用记录，不将旧名单当作当前状态 | 当轮通过 |
| 文档与构建 | 仓库调用方和资源打包无恢复旧公共面的依赖；临时全新环境的定向/全量检查由主负责人记录具体命令、revision、结果和环境限制 | 通过，见验收记录 |
| 最终冻结 | 逐工具、字段、权限和兼容添加规则审议；上述出口全部满足，再由主负责人确认冻结版本 | **尚未冻结** |

冻结前允许删除或修改本仓库旧接口和调用方，不引入旧兼容层。冻结后才适用公开边界“只增不删”的承诺：新增能力应先放普通应用，必要内核增补须审议并明确输入输出、授权和旧调用语义；不能借新增字段扩大既有权限或重试未知效果。该承诺目前尚未生效。
