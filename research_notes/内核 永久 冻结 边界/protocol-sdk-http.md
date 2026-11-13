# Kernel freeze 独立审计：跨应用协议、SDK、Manifest、HTTP 与 CLI 边界

审计基线：`cf19ceb704800e5c53e0784aff4558883f6afa9b`。`git status --short` 无输出，工作区干净。仅查看本地源码；未写文件、未运行测试、未访问运行数据库、网络、凭据或模型。以下“问题成立”指源码路径成立，不声称已完成运行时复现。

**结论：不宜直接将当前所有可达协议冻结为永久只增不减。** 当前确有一组值得保留的最小横向语义，但存在协议自相矛盾、应用名策略侵入内核，以及可达 HTTP 鉴权例外。冻结前应先消除这些当前问题；不需要先引入版本协商框架、统一巨型 `execute` API，或“runtime capability”第三类产品实体。

本报告只审计横向机制；不裁定各系统工具业务实现是否应保留。

## 一、冻结前有哪些明确阻塞？

### Takeaway

优先解决：HTTP health 前缀鉴权绕过、`waiting` 状态无法穿过 wire schema、SDK 模型错误码无法被宿主接受。随后明确 contract hash、破坏性变更检查和 deadline 的真实保证。否则会永久保留一组调用者不能一致依赖的行为。

### Cited Findings

#### B1．`/api/health` 的前缀鉴权豁免覆盖可安装应用路径

**严重程度：高；冻结前必须修正。**

鉴权中不是只豁免精确 health endpoint：

```ts
const SKIP_PATHS = ["/api/health", "/health"];

SKIP_PATHS.some((p) => c.req.path === p || c.req.path.startsWith(p))
```

— `apps/server/src/middleware/auth.ts:6`、`apps/server/src/middleware/auth.ts:41-46`

Manifest 只保留精确 `/api/health` 和其 `-` 扩展：

```ts
own === path || own.startsWith(`${path}-`)
```

— `packages/contracts/src/steward/index.ts:112`、`packages/contracts/src/steward/index.ts:254`

因此 `/api/healthy`：

1. 符合 `listenPath`；
2. 不等于 `/api/health`，也不以 `/api/health-` 开头；
3. 可以由 `keepAlive: true, uses: ["*"]` 的应用通过 entry 检查；
4. 请求通过 API middleware 时命中 `startsWith("/api/health")`，跳过 API key；
5. 进入应用 listener proxy。

可达链：`packages/contracts/src/steward/index.ts:115-118`、`packages/contracts/src/steward/index.ts:273-274` → `packages/engine/src/modules/steward/module-build.ts:155-160` → `apps/server/src/app.ts:102-103` → `apps/server/src/app.ts:138-141`。

这不是“导出类型可能有问题”，而是实际安装声明到 HTTP handler 的完整路径。攻击者仍需要应用路径存在；不等于任意远程用户可自行安装应用。

**最小方向：** 精确 health 路径豁免，不将历史前缀行为纳入永久承诺。

#### B2．真实 async `waiting` 状态与公开回包枚举不一致

**严重程度：高；冻结前必须统一。**

路由器真实支持：

```ts
export class AwaitUser extends Error {
  constructor(readonly output: Json) { super("Waiting for the user"); }
}
```

异步系统调用捕获该异常后写入：

```ts
status: "waiting"
```

— `packages/engine/src/modules/steward/module-calls.ts:43-48`、`packages/engine/src/modules/steward/module-calls.ts:474-483`

`callStatus()` 原样返回 DB 的 `row.status`，SDK 的 `CallState` 也包含 `"waiting"`。但是 wire：

```ts
export const CALL_STATUSES =
  ["queued", "running", "succeeded", "failed", "unknown"] as const;
```

`moduleCallReplySchema` 使用这个枚举，没有 `waiting`。

— `packages/engine/src/modules/steward/module-calls.ts:434-439`；`packages/integrations/src/steward/module-sdk/sdk.ts:23`；`packages/contracts/src/steward/index.ts:285`、`packages/contracts/src/steward/index.ts:354-359`

实际 channel 在发送前解析回包：

```ts
moduleCallReplySchema.parse(await work)
```

解析失败被改写为：

```ts
{ code: "internal", message: "Module call failed" }
```

— `packages/engine/src/modules/steward/module-channel.ts:54-58`

所以模块查询自己正在等待用户的 async 调用，可能得到 `internal`，而不是真实状态。重复 key 命中已有 waiting 调用也经过同一回包边界。

**最小方向：** 将已实现、SDK 已声明的 waiting 语义补全到实际 wire；不要把类型断言 `as "queued"` 当作验证。

#### B3．SDK 的模型失败会生成宿主不接受的 event error code

**严重程度：高；冻结前必须统一。**

SDK `ModelError` 接受任意字符串：

```ts
constructor(public readonly code: string, message: string)
```

事件处理 catch 将它直接写为：

```ts
...(error instanceof ModelError ? { errorCode: error.code } : {})
```

— `packages/integrations/src/steward/module-sdk/sdk.ts:40-42`、`packages/integrations/src/steward/module-sdk/sdk.ts:65-75`

SDK `chrona.model()` 明确可能抛出：

```ts
new ModelError("provider_error", ...)
new ModelError("timeout", ...)
```

还从消息中恢复 `unconfigured`、`budget_exceeded` 等代码。

— `packages/integrations/src/steward/module-sdk/sdk.ts:214-235`

宿主 `moduleEventReplySchema.errorCode` 却只能取 `MODULE_CALL_ERRORS`，其中没有 `provider_error`、`timeout`、`unconfigured`、`budget_exceeded`。

— `packages/contracts/src/steward/index.ts:317-323`

channel 对此只记录 `"Invalid event reply"`，不完成 pending event。之后 event timeout 成为 lost delivery；supervisor 可能关闭进程并进入恢复逻辑。

— `packages/engine/src/modules/steward/module-channel.ts:64-70`、`packages/engine/src/modules/steward/module-channel.ts:89-101`；`packages/engine/src/modules/steward/module-supervisor.ts:378-391`

**最小方向：** 统一 SDK 发出的错误与宿主接受的错误；保留“业务拒绝”和“传输/进程失败”的区分。不要把可预期模型失败冻结成“无效 event reply → 超时”。

#### B4．同名 `contractHash` 实际有两套不同含义

**严重程度：中高；冻结前必须明确。**

用于 `expectedTarget`、队列绑定和 `modules.tools` 的 hash：

```ts
export function moduleCallbackContractHash(tool: Tool | SystemTool)
```

计算：

```ts
JSON.stringify({
  input,
  output,
  visibility: [...tool.visibility].sort(),
  idempotent: tool.idempotent,
})
```

— `packages/engine/src/modules/steward/module-calls.ts:51-60`

`modules.tools` 对应用返回此 hash：

— `packages/engine/src/modules/steward/system/modules.ts:149-156`

但 Provider 可达的 `modules.reference` 返回：

```ts
contractHash:
  createHash("sha256").update(JSON.stringify(contract)).digest("hex")
```

这里 `contract` 包含 `target`、`source.hash`、description、documentation、examples、errors、retry 等整份展示文档。

— `packages/engine/src/modules/steward/module-reference.ts:40-60`

所以从 reference 复制 `contractHash` 到 `expectedTarget`，并不等价于从 tools discovery 复制。前者还会因代码版本或文案改变，而后者意图保持兼容代码升级可用。

此外 callback hash 对对象键序没有递归 canonicalization；只是排序 visibility。因此“结构相同、声明顺序变化”也可能触发 callback conflict。

**最小方向：** 冻结一种明确的 callback identity hash 语义；文档快照 hash 不冒充它。不需要建立完整协议版本系统。

#### B5．现有 output-impact 不是完整兼容性或依赖保护

**严重程度：中高；不能作为永久兼容承诺。**

```ts
export async function moduleOutputImpacts(
  db: Db,
  workspaceId: string,
  moduleId: string,
  nextManifest: ReturnType<typeof moduleManifestSchema.parse>
): Promise<OutputImpact[]>
```

只比较旧、新工具的 `output`，以及新增/删除工具；只发现 active、声明了精确 `uses` 或 `*` 的消费者。

— `packages/engine/src/modules/steward/module-output-impact.ts:14-40`

实际缺口：

- 输入变为更严格，不在比较范围；
- 单独改变 visibility，不一定被纳入；
- 单独改变 idempotent，不在比较范围；
- 允许调用但没有声明 `uses` 的消费者不可被发现；
- paused 消费者不在查询范围；
- Python/shell 消费者没有 TypeScript 检查；
- TS 消费者显式泛型、动态 target、JSON string 业务载荷也不等于完整语义检查。

检查依赖者时，只有 `failed` 阻止；`skipped` 不阻止。

— `packages/engine/src/modules/steward/module-build.ts:205-228`；`packages/engine/src/modules/steward/module-typecheck.ts:24-29`

这里还有一个重要限制：**即使 output 变更是兼容增加，callback hash 仍可能改变，已固定的注册或排队调用会被拒绝。** 类型检查通过不代表原 callback registration 继续有效。

— `packages/engine/src/modules/steward/module-calls.ts:57-60`、`packages/engine/src/modules/steward/module-calls.ts:95-112`

**最小方向：** 不把 output-impact 描述成全局 breaking-change safety。冻结工具作者的 input/output 契约责任、pinning 和错误语义；兼容性检查自身仍是可改进的私有发布机制。

#### B6．SDK `timeoutMs` 没有形成端到端 deadline/cancel 承诺

**严重程度：中；冻结前应限定语义。**

`CallOrigin` 定义了 `deadline`；系统工具可接收并自觉遵守：

— `packages/engine/src/modules/steward/module-calls.ts:21-26`、`packages/engine/src/modules/steward/module-calls.ts:278-283`

但模块 channel 构造 origin 时没有 deadline：

```ts
function originOf(scope: CallScope): CallOrigin
```

只传 workspace/caller/chain/path/run。

— `packages/engine/src/modules/steward/module-effects.ts:16-19`

`timeoutMs` 传给模块 event delivery；系统 sync handler 不通过同一 timeout 执行；async enqueue 根本不保存此参数。

— `packages/engine/src/modules/steward/module-effects.ts:27-36`；`packages/engine/src/modules/steward/module-calls.ts:278-283`、`packages/engine/src/modules/steward/module-calls.ts:362-376`、`packages/engine/src/modules/steward/module-calls.ts:406-431`

模块事件计时器是在排到 channel exchange 后建立；supervisor 的 instance queue 又在其外。不能据此承诺从 SDK 调用瞬间开始的严格 wall-clock deadline。

— `packages/engine/src/modules/steward/module-channel.ts:89-110`；`packages/engine/src/modules/steward/module-supervisor.ts:449-456`

wire 方法只有 `call`、`callStatus`，没有通用 `cancel`。

— `packages/contracts/src/steward/index.ts:340-353`

**最小方向：** 明确 `timeoutMs` 当前是有限范围的等待/执行上限，不是跨链取消能力。必须保留 timeout 后 `unknown` 的事实；不要凭空增加通用取消框架。

### Inferences

- B1–B3 是当前实现一致性问题，不是未来需求。
- B4–B6 是“永久契约会让调用者如何理解”的阻塞；可以通过最小修正或准确限定承诺解决，无需先设计下一代协议。
- 不应承诺 exactly-once、全链 deadline、自动兼容所有 schema 添加，当前实现均不提供这些保证。

### Gaps

- 按任务限制未执行运行时复现。
- 本报告不判断全部系统工具是否正确设置 deadline、是否应支持 async；只确认横向机制不能提供统一保证。

## 二、应用真正可达的 Manifest 与 SDK 是什么？

### Takeaway

真正公共的是应用提交、运行、收事件与路由调用所依赖的声明和行为，不是整个 contracts 包。当前没有 Manifest `extends` 或显式应用 `dependencies` 字段；依赖分为 `uses`、声明式 `contributes` 和构建锁文件/系统 packages。

### Cited Findings

#### 2.1 Manifest 完整顶层面

实际验证入口：

```ts
export const moduleManifestSchema =
  z.preprocess(withoutRemovedFields, z.object({ ... }).strict()...)
```

— `packages/contracts/src/steward/index.ts:176-266`

| 类别 | 当前字段与语义 | 证据 |
|---|---|---|
| 身份/入口 | `name`, `description?`, `entry`；entry 只接受顶层 `.ts/.py/.sh` 文件 | `packages/contracts/src/steward/index.ts:177-180` |
| 工具 | `tools`，最多 30；工具名唯一 | `packages/contracts/src/steward/index.ts:182`、`packages/contracts/src/steward/index.ts:257-264` |
| 运行生命周期 | `keepAlive`, `activated`, `healthCheck`，默认 false | `packages/contracts/src/steward/index.ts:183-188` |
| 私有内容 | `content`，默认 false | `packages/contracts/src/steward/index.ts:189-190` |
| HTTP | `listen` 字符串或最多 4 个路径；`/` 或 `/api/<slug>`；需要 keepAlive，build 还要求 entry | `packages/contracts/src/steward/index.ts:115`、`packages/contracts/src/steward/index.ts:192-201`、`packages/contracts/src/steward/index.ts:253-255`；`packages/engine/src/modules/steward/module-build.ts:160` |
| 静态计划 | `triggers: [{id,schedule}]`，最多 10；ID 唯一 | `packages/contracts/src/steward/index.ts:113`、`packages/contracts/src/steward/index.ts:181`、`packages/contracts/src/steward/index.ts:240-244` |
| 路由声明 | `uses`，精确 `<module>.<tool>` 或 `"*"`，最多 40 | `packages/contracts/src/steward/index.ts:203-207` |
| OS 依赖 | `packages`，最多 20 个宿主 backend 名称 | `packages/contracts/src/steward/index.ts:208-214` |
| 应用扩展声明 | `contributes: Record<slug, JSON>`，整体最多 32 KiB 字符长度判断 | `packages/contracts/src/steward/index.ts:216-222` |
| 凭据 | `secrets` 最多 50；名称或结构 spec | `packages/contracts/src/steward/index.ts:151-175`、`packages/contracts/src/steward/index.ts:223-227` |
| 模型预算声明 | `model?: {tier,maxCalls,maxOutputTokens}` | `packages/contracts/src/steward/index.ts:228-229` |
| OS effect | `effects` 目前仅 `"network"` | `packages/contracts/src/steward/index.ts:96-97`、`packages/contracts/src/steward/index.ts:230` |
| 发布参数 | `params: Record<slug,{type,value}>` | `packages/contracts/src/steward/index.ts:231` |
| 用户配置 | `settings`，最多 20；number/string/boolean、default、bounds/options/labels | `packages/contracts/src/steward/index.ts:120-150`、`packages/contracts/src/steward/index.ts:232-235` |
| 资源声明 | `limits?: {virtualMemoryMb}`，1024–8192 | `packages/contracts/src/steward/index.ts:233` |
| 数据演进 | `data: {schema,migrate?}`，默认 schema 1 | `packages/contracts/src/steward/index.ts:234` |
| 作者检查 | `tests`，1–10 个顶层脚本 | `packages/contracts/src/steward/index.ts:235` |

上表最后几项属于同一个 schema 尾部；实际 schema 定义整体见 `packages/contracts/src/steward/index.ts:176-266`。

**没有 `extends`、`dependencies`、任意顶层扩展键。** `.strict()` 会拒绝未知字段。因此冻结时不能把未来业务元数据散落成新的内核顶层字段；当前已经有不解释业务内容的 `contributes` 容器。

语言库由 `package.json + bun.lock`、`pyproject.toml + uv.lock` 安装；系统 package 是 Nix 或宿主发行版程序名称，不是 `OFFICIAL_EXTERNAL_MODULE_NAMES`。

— `packages/contracts/src/steward/index.ts:208-214`；`packages/integrations/src/steward/module-packages.ts:70-98`

#### 2.2 Tool declaration 面

```ts
export const TOOL_VISIBILITY =
  ["provider", "owner", "modules", "kernel"] as const;
```

每个工具：

- `name`, `description`
- `parameters`
- `output?`
- `visibility`，默认 `["provider","owner"]`
- `idempotent`，默认 false
- `examples?`, `sideEffects?`, `errors?`

— `packages/contracts/src/steward/module-tool.ts:5-27`

`errors` 是应用描述性 metadata，可以用任意 bounded string code；**不等于这些字符串自动成为 channel 的 `errorCode`。** metadata 不授予权限或重放安全。

输入支持递归 string/number/boolean/array/object；只有 string 有 enum。顶层参数 key 是 slug；嵌套 object key 可为普通有界字符串。顶层未知参数一律拒绝，嵌套 object 是否接受额外字段由 `additionalProperties` 决定，默认 false。

— `packages/contracts/src/steward/module-input.ts:3-27`；`packages/engine/src/modules/steward/module-calls.ts:184-217`

Output 是有限 JSON Schema 子集：

- `type`、`properties`、`required`、`additionalProperties`、`items`
- `enum`、`const`、`anyOf`、`allOf`
- `title`、`description`
- 无 `$ref`、无任意验证关键词；最多 8000 字符。

— `packages/contracts/src/steward/module-output.ts:3-39`

旧 stored manifest 允许缺省 output；新 build 要求 owner/modules 工具声明 output。Provider-only 工具不在该新 build 条件中。

— `packages/contracts/src/steward/module-tool.ts:16-17`；`packages/engine/src/modules/steward/module-build.ts:155-158`

#### 2.3 配置与扩展所有权

`moduleRuntimeParams()` 将 manifest params 和有效用户 settings 合并。settings 与 params 不得同名；stored 值不再符合声明时退回当前 default。

— `packages/contracts/src/steward/index.ts:142-150`、`packages/contracts/src/steward/index.ts:233-235`

`contributes` 的一般规则是接收模块只读取 `contributes.<自己的名字>`；内容的 schema 和业务解释归接收应用。当前 memory 例外另见下一节。

— `packages/engine/src/modules/steward/system/modules.ts:118-134`

这意味着 **config declaration schema 是横向契约，应用具体 setting key/default/value 不是永久内核契约。**

#### 2.4 SDK 表面和真实调用链

模块 SDK 实际导出：

- `Caller`, `Trigger`, `CallState`, `CallOptions`
- `ModelResult`, `ModelError`
- `onDisconnect(handler)`
- `on(kind, handler)`
- `paths`
- `chrona`

— `packages/integrations/src/steward/module-sdk/sdk.ts:9-44`、`packages/integrations/src/steward/module-sdk/sdk.ts:50`、`packages/integrations/src/steward/module-sdk/sdk.ts:100-120`

`chrona` 当前有：

| 属性 | 实质 |
|---|---|
| `paths` | 当前应用 module/data/content 的路径 |
| `call` | wire method `call` |
| `callStatus` | wire method `callStatus` |
| `reportHealth` | `modules.report-health` wrapper |
| `secret` | `secrets.get` wrapper |
| `token` | `secrets.token` wrapper，SDK provider union 是 google/microsoft |
| `exec` | SDK 本地 spawn helper，不是内核执行服务 |
| `serve` | Bun Unix socket HTTP server helper |
| `model` | Agent completion 开始/轮询 wrapper |
| `notify` | async `notify.send` wrapper |
| `wakeProvider` | `agent.context` + `agent.run` wrapper |
| `emit` | `events.emit` wrapper |

— `packages/integrations/src/steward/module-sdk/sdk.ts:113-249`

`exec` 自己获取凭据、给子进程 env/临时文件、超时 kill 进程组、截断和脱敏输出；不是内核强制所有 app subprocess 必须经过它。

— `packages/integrations/src/steward/module-sdk/sdk.ts:139-210`

`paths` 是宿主注入的应用路径承诺，不应冻结具体 `<dataDir>/platform/...` 布局、临时 socket 根目录或 ENV fallback 默认路径。

— `packages/integrations/src/steward/module-sdk/sdk.ts:113-119`；`packages/engine/src/modules/steward/module-supervisor.ts:206-224`

#### 2.5 不一致或过时的 SDK 表面

- SDK `Trigger` 包含 `content_edit`，实际 `moduleEventSchema` 没有这个分支。
- SDK `Caller` 没有 `system`，实际 wire caller union 有。
- `CallState` 有 waiting，而 wire status 没有。
- typed `calls.d.ts` 是每次 build 从当前契约生成的快照，不是运行时授权规则；shipped default 声明空。
- TypeScript 检查可 skip，Python/shell 本来就 skip。

— `packages/integrations/src/steward/module-sdk/sdk.ts:9-36`；`packages/contracts/src/steward/index.ts:287-315`；`packages/integrations/src/steward/module-sdk/calls.d.ts:1-3`；`packages/engine/src/modules/steward/module-contracts.ts:48-66`；`packages/engine/src/modules/steward/module-typecheck.ts:24-29`

### Inferences

- 冻结最小 SDK 核心：路径、事件 handler、断连通知、call/status、HTTP serve 的宿主连接方式。
- SDK `notify/model/emit/wakeProvider` 可以继续存在于 SDK 或应用库，但不应因此把 Notify/Events/Provider 编排提升为内核永久能力。
- `contributes` 已经提供所需的应用声明扩展点；没有证据要求先增加 Manifest `extends` 框架。

### Gaps

- 本报告没有完整审计 Python/shell 作者如何接入 socket 的全部示例；wire 本身不依赖 TypeScript。
- 具体 setting 字段、各应用输出和 UI schema 由对应审计负责。

## 三、路由与事件协议应永久承诺哪些原始语义？

### Takeaway

应保留的是明确身份、可验证输入输出、目标绑定、可观察未知结果和有条件重试。不能把内部 queue、audit 表或当前 retry 常数全部冻结成公共实现规范。

### Cited Findings

#### 3.1 Transport：没有通用 hello/version negotiation

现行模块 channel 是 Unix socket 上双向 JSON Lines：

```ts
Chrona → module: { id, event }
module → Chrona: { id, result } | { id, error }

module → Chrona: { id, method, params }
Chrona → module: { id, result } | { id, error }
```

— `packages/contracts/src/steward/index.ts:276-283`

实际连接身份由宿主为该实例创建的 socket 和 `CallScope` 建立，不由模块报 `moduleId/hash/workspaceId`。

— `packages/engine/src/modules/steward/module-supervisor.ts:20-21`、`packages/engine/src/modules/steward/module-supervisor.ts:214-215`；`packages/engine/src/modules/steward/module-effects.ts:16-19`

channel 只接受第一次连接；第二连接被销毁；没有 hello 消息。另有 kernel 发出的 `ping: true`，SDK 回空 result，供 SDK 连接检查。

— `packages/engine/src/modules/steward/module-channel.ts:72-79`、`packages/engine/src/modules/steward/module-channel.ts:114-117`；`packages/integrations/src/steward/module-sdk/sdk.ts:87`

两端 line cap 当前都是 32 MiB。

— `packages/engine/src/modules/steward/module-channel.ts:7-23`；`packages/integrations/src/steward/module-sdk/sdk.ts:78-99`

**应保留有界 framing 与 request ID correlation；无需凭空增加 hello。**

#### 3.2 事件及顺序

实际 wire 事件：

- `schedule`：`id`, `firedAt`, optional `scheduleId/payload`
- `tool`：`args`, optional trusted `caller` 与 `call`
- `call_result`：terminal status、callId、target、key、output/error
- `activated`
- `health`

共同 envelope 有 `now` 和合并后的 `params`。

— `packages/contracts/src/steward/index.ts:295-315`

`call` metadata：

```ts
{ id, key: string | null, attempt, chain }
```

不是模块自己提供的 caller identity。

同一实例事件由 supervisor 串行投递；SDK 也串行运行 handlers。事件期间发出的模块→内核调用可并发，不要求等待另一个 call 回包才能读下一个。

— `packages/engine/src/modules/steward/module-supervisor.ts:449-456`；`packages/integrations/src/steward/module-sdk/sdk.ts:44`、`packages/integrations/src/steward/module-sdk/sdk.ts:88`；`packages/engine/src/modules/steward/module-channel.ts:45-60`

没有证据支持跨应用全局事件顺序或 exactly-once event delivery。

`activated` 包括版本激活及其 uses 目标变化后的注册机会；因此它不是“进程每启动一次必定收到”的同义词。

— `packages/contracts/src/steward/index.ts:185-186`、`packages/contracts/src/steward/index.ts:309-310`

#### 3.3 Caller 与 admission

真正 caller union：

```ts
module {module,moduleId,hash}
provider {runId}
owner {via}
kernel
system {module}
```

— `packages/contracts/src/steward/index.ts:287-294`

`admitted()` 的当前规则：

```ts
if (!callerName(caller))
  return tool.visibility.includes(caller.kind ...);

if (tool.visibility.includes("modules")) return true;

if (caller.kind !== "module" ||
    !tool.visibility.includes("owner")) return false;

return manifest && grantedUses(manifest).includes("*");
```

— `packages/engine/src/modules/steward/module-calls.ts:165-173`

**精确 uses 不作通用 runtime admission。** 它是契约/依赖声明；`*` 特殊地允许 module 访问 owner audience。具体敏感工具仍可检查调用方 manifest 和身份。

`callerKey()`：

- module：按 moduleId，不按 hash；
- provider：按 runId；
- system：按 system name；
- owner/kernel：按 kind。

— `packages/engine/src/modules/steward/module-calls.ts:118-123`

因此 async key 的 scope 是：

```text
workspace + callerKey + target module + tool + key
```

不是“全系统同 key”，也不是“每个版本重新开始”。

— `packages/engine/src/modules/steward/module-calls.ts:406-413`

一般 async delivery 只检查原 caller module 仍存在且 workspace 一致，之后用保存的 callerHash 重建 caller。它不像 Agent 特殊入口那样要求 callerHash 仍是当前 activeHash。

— `packages/engine/src/modules/steward/module-calls.ts:441-446`、`packages/engine/src/modules/steward/module-calls.ts:485-499`；`packages/engine/src/modules/steward/agent-application.ts:18-21`

这应明确为“队列归原身份及已记录版本”，不能笼统宣称所有 queued 调用都已自动按当前版本重新授权。

#### 3.4 Target pinning 与 contract binding

可选参数：

```ts
expectedTarget: {
  moduleId: string;
  contractHash: string;
}
```

— `packages/contracts/src/steward/index.ts:337-349`

sync 在 resolve/admit 时检查；最终向进程发送前再次检查 target identity、contract、active hash 和 admission。

— `packages/engine/src/modules/steward/module-calls.ts:57-72`、`packages/engine/src/modules/steward/module-calls.ts:344-353`

async 入队保存目标身份与 contract hash；即使应用 paused，已知 active 工具也会绑定契约。missing target 的显式 null binding 允许 never-sent 调用以后首次绑定；没有 binding 的 legacy 调用不会通过推断得到授权。

— `packages/engine/src/modules/steward/module-calls.ts:75-112`

**应冻结这些安全含义，不冻结它们恰好存于 audit 的 ID/key 格式。**

#### 3.5 Async key、重复、失败、重试

SDK async 必须带 key；重复调用返回已有 invocation，不重新执行，也不比较新 args 是否与旧 args 相同。`expectedTarget` 存在时才额外核对重复 key 的已存 target binding。

— `packages/contracts/src/steward/index.ts:345-350`；`packages/engine/src/modules/steward/module-calls.ts:398-413`

当前语义：

- sync：交付后丢回复或崩溃 → `unknown`，不自动重试；
- async never delivered/unavailable → 可以重试；
- handler 正常拒绝 → failed；
- sent but no answer → 只有声明 idempotent 的目标可再投递，否则 unknown；
- 失效 lease：有已绑定身份且 idempotent 才可恢复重试，否则 unknown；
- callback reply 失败有限重试，调用者仍可通过 status 查询。

— `packages/engine/src/modules/steward/module-calls.ts:298-305`、`packages/engine/src/modules/steward/module-calls.ts:452-472`、`packages/engine/src/modules/steward/module-calls.ts:506-540`

当前内部常数：6 次 delivery attempts、batch 20、指数退避从 30 秒起，上限一小时；callback reply 最多 3 次。

— `packages/engine/src/modules/steward/module-calls.ts:115-116`、`packages/engine/src/modules/steward/module-calls.ts:448`、`packages/engine/src/modules/steward/module-calls.ts:521-540`

这些具体数字适合配置/实现，不应成为永久公共 ABI。应永久保留的是**不把 unknown 改写成“没有发生”，不无条件重放非幂等动作。**

#### 3.6 输入输出、错误与 pagination

外部应用 output mismatch：返回 `failed` 并记录诊断；系统 output mismatch：测试环境抛错，生产仅日志，仍返回结果。

— `packages/engine/src/modules/steward/module-calls.ts:245-272`

因此不能承诺“所有公共 output 都在生产 fail closed”。

当前 wire transport error enum：

```text
undeclared invalid internal forbidden not_found conflict cycle
unknown failed unavailable reauthorize unauthorized cursor_expired
too_large capacity unsupported_version unsupported
```

— `packages/contracts/src/steward/index.ts:317-320`

应冻结错误的机器语义与恢复方向，不冻结动态/翻译后的 message。应用自己的 metadata error code 与传输 enum 分开处理。

通用 `call` 没有 pagination。各目标自行定义 cursor/limit。示例：

- `modules.health` 有 cursor；
- `modules.tools` 当前返回完整匹配列表；
- reference index 与单目标详细引用是两种 bounded discovery 形式，不是通用 pagination envelope。

— `packages/engine/src/modules/steward/system/modules.ts:146-165`、`packages/engine/src/modules/steward/system/modules.ts:171-179`；`packages/engine/src/modules/steward/module-reference.ts:51-60`

### Inferences

最小永久协议应逐项写清：

1. caller 从哪里来；
2. audience 如何决定 admission；
3. key 的 scope；
4. callback identity 和 contract 的绑定方式；
5. sync、async、waiting、terminal 的区别；
6. unknown 和 retry 的边界；
7. 单应用事件串行，而非全局全序；
8. 输入输出验证边界；
9. deadline 不等于取消、不等于 stop proof；
10. discovery metadata 不授予权限。

这些是原始语义，不是一个巨型万能 API。

### Gaps

- 不在此报告中裁定每个 cursor 的有效期、scope 和排序；需要由对应工具契约逐个确认。
- 不承诺应用内部自然语言错误 message 稳定。

## 四、HTTP、CLI、宿主协议分别处于什么边界？

### Takeaway

HTTP host/proxy 和离线恢复是内核宿主的真实外部边界；Agent 内部启动载荷和 executor device protocol 不是普通应用 SDK。它们仍有安全责任，但不该因 export 而整体升格成永久应用 API。

### Cited Findings

#### 4.1 主 HTTP server

实际 mount 顺序：

1. `/api/*` origin/CORS；
2. editor/executor owner auth configuration 检查；
3. API key middleware；
4. executor routes；
5. 21 MiB body limit；
6. `/health`, `/ready`；
7. OAuth callback；
8. Agent bridge；
9. 未处理 API 路径的 module proxy；
10. 非 API GET/HEAD 的 `/` 页面 proxy。

— `apps/server/src/app.ts:79-149`

API key 未配置时，一般 middleware 不验证 key；不是默认 fail closed。这个配置行为必须和监听地址/部署安全规则一起说明，不能写成“一切 `/api/*` 永远需要 key”。

— `apps/server/src/middleware/auth.ts:31-39`

proxy：

- 移除 `Authorization`；
- 移除 `Cookie`；
- 不向浏览器转发 `Set-Cookie`；
- 保留原 pathname/query，不裁掉应用 prefix；
- 手动处理 redirect；
- 连接 request signal；
- 不可达返回 503 `MODULE_UNAVAILABLE`。

— `apps/server/src/app.ts:35-47`

这是真正应保留的凭据隔离语义。应用 HTTP 端不应收到 owner bearer，也不应通过 proxy 设置浏览器 session cookie。

`/health` 返回 runtime health；`/ready` 只验证数据库可查询。两者不是全部应用业务 ready 的保证。

— `apps/server/src/app.ts:50-60`

listener lookup 搜索所有 active module，函数不带 workspace 参数。当前 host HTTP path 是宿主级命名空间，不是可直接推定的每 workspace 独立 HTTP namespace。

— `packages/engine/src/modules/steward/module-supervisor.ts:459-471`

#### 4.2 Agent bridge

精确 GET catalog 与 POST single tool endpoint 豁免 owner API key，随后自行验证：

- 原始 peer 为 loopback；
- 拒绝 forwarded headers；
- bearer run token；
- service catalog/token scope；
- 128 KiB body limit；
- `x-chrona-timeout-seconds` bounded 到 600。

— `apps/server/src/app.ts:19-23`；`apps/server/src/routes/steward-agent.routes.ts:11-34`

这不是普通应用可用的 owner HTTP API，不是新的公共 shell/files 通道。Provider token 的 admission、Run deadline 和工具集合属于受治理 bridge 边界。

#### 4.3 Rescue

独立 Hono app，无主 app middleware、cookies、CORS 或 module routing；所有请求验证独立 rescue bearer。无 bearer 的静态登录页也返回 401。

能力为：

- 模块列表；
- pause；
- approved rollback；
- approvals list/resolve。

固定操作 workspace 为 `ws_default`；独立 64 KiB body limit；独立 listener 需配置 port 与 key，默认 loopback。

— `apps/server/src/rescue.ts:9-58`

应保留独立于 Web 应用失效的恢复入口。不应冻结 rescue HTML、CSP hash、界面布局或自动扩大其权限。

#### 4.4 CLI / offline admin

`createProgram()` 实际注册：

- `start`
- `backup`, `restore`
- `doctor`
- `admin legacy`
- `admin modules/catalog/install/diagnostics/approvals`
- `admin rollback/disable/approve/reject`
- `admin secret-set/secret-remove`
- `qq bind-code`
- executor commands

— `packages/cli/src/program.ts:12-90`

`runAdmin()` 的信任来源写得明确：

```ts
/** Local filesystem ownership, never API_KEY or Provider credentials,
 * authorizes administration. */
```

变更命令拿 SQLite runtime lock；read-only commands 不拿变更锁；停止 module supervisor，不在离线恢复中启动长运行模块；workspace 固定 `ws_default`。

— `packages/cli/src/admin.ts:32-73`

CLI rollback 对需要 data restore confirmation 的 pending approval 会以可信 CLI 来源 resolve；这属于离线管理员权限，不是应用自动获得的能力。

— `packages/cli/src/admin.ts:14-25`

应冻结“离线恢复不绕过真实管理员授权、不混入正常 tick/自动后台工作”的职责边界，不必冻结每个 CLI 输出 JSON/日志格式。

#### 4.5 Agent host launch payload 是内部可信边界

```ts
runtimeStartSchema
```

含 run token、cwd、sessionDir、hostPaths、content dirs、deadline、callbacks 等。

— `packages/contracts/src/steward/local-runtime.ts:17-28`

这些不是普通应用 `agent.run` 应允许自填的参数。可信 Agent start 入口核对 authenticated Run 的 workspace/runId/operationId/cwd/lane/deadline，并保存 launch digest。

— `packages/engine/src/modules/steward/agent-application.ts:23-40`

只有 active、approved、builtin Agent 身份才绑定特殊 host launcher/configuration：

— `packages/engine/src/modules/steward/agent-application.ts:11-16`；`packages/engine/src/modules/steward/module-supervisor.ts:201-224`

该 launch schema 是安全关键内部协议；**“不是普通应用 API”不意味着可以删除校验或泄露给 module args。**

#### 4.6 Executor device protocol 是另一真实外部协议，但不是通用 module host

当前有明确 `chrona.executor.v1`、pair/poll/report/question/final/reconcile HTTP endpoints、generation/incarnation/assignment fences、stop proof 和 bounded journal。

— `packages/contracts/src/steward/executor.ts:7-27`、`packages/contracts/src/steward/executor.ts:44-53`、`packages/contracts/src/steward/executor.ts:136-160`

源码明确：

```ts
/** Local extension facade only. Remote module catalog is empty;
 * direct calls are forbidden. */
export const EXECUTOR_MODULE_CATALOG = [] as const;
```

— `packages/contracts/src/steward/executor.ts:112-113`

server 精确路径鉴权豁免、原始 body byte limit、correlation/fence 校验都已实际挂载。

— `apps/server/src/executor-router.ts:6-11`、`apps/server/src/executor-router.ts:27-85`、`apps/server/src/executor-router.ts:125-156`

因此不能把现有 executor HTTP 当作未来任意 remote application hosting 的通用契约，也不能因其不属于应用 SDK 就把已有设备安全语义视为无关。

### Inferences

应区分四层，不制造第三类产品：

| 层 | 处理方式 |
|---|---|
| 普通应用到内核/应用的公共契约 | 最小永久 freeze 对象 |
| Owner HTTP、rescue、CLI | 明确支持的管理边界；保持恢复和鉴权语义 |
| Kernel ↔ trusted Agent launcher | 私有、安全关键、可随 release 演进 |
| 已有 executor device protocol | 独立设备客户端协议；不扩展宣称成一般 module host |

### Gaps

- backup archive 格式、数据库迁移兼容和 device acceptance 由其他专项审计负责。
- 此次不把 source-exported `ProviderEvents` 或 execution schema 全部判定为公共应用契约；它们有些只是上述内部/设备协议的组成部分。

## 五、哪些当前特殊化应清除，最终冻结哪些最小能力？

### Takeaway

用户要求的两实体模型与当前实现仍有差距。保留 trusted Agent 的身份边界有具体安全理由；Web/Notify、memory/QQ 的产品身份和官方包枚举没有理由变成永久内核知识。先处理已有特殊化，不需要预建未来 Provider 注册框架。

### Cited Findings

#### 5.1 当前确实存在的应用专属/第三类特殊化

| 当前特殊化 | 源码与实际影响 | 冻结判断 |
|---|---|---|
| Web/Notify 保留 builtin 身份 | builtin names 固定 `web,notify,agent`；不能 remove/install；只有 Agent 全部 dynamic operations 禁止 | `packages/contracts/src/steward/module-lifecycle.ts:8`；`packages/engine/src/modules/steward/module-identity.ts:9-32`。Web/Notify 若为普通 app，不应永久保留这些特权/限制 |
| `runtime-callback`, `workspace-local` 特殊身份 | 专门的 `LOCAL_CAPABILITY_NAMES`、注册 map、保留名、接口页 runtime metadata | `packages/contracts/src/steward/module-lifecycle.ts:5-7`；`packages/engine/src/modules/steward/module-registry.ts:4-23`；`packages/engine/src/modules/steward/local-capability-view.ts:7-24`。机制可属内核实现，不应成为第三类产品 |
| memory contribution 跨 namespace 例外 | active approved entry 可读 `contributes.memory`，别人只读自己 namespace | `packages/engine/src/modules/steward/system/modules.ts:112-134`。把 memory 产品概念写进核心 discovery |
| `qq_bot` secret 例外 | manifest entry-only；取 service env，不走普通 store；设置、删除等路径排除它 | `packages/contracts/src/steward/index.ts:249`；`packages/engine/src/modules/steward/system/secrets.ts:55-74`、`packages/engine/src/modules/steward/system/secrets.ts:91-95`；`packages/cli/src/admin.ts:95-115` |
| QQ 私有持久化穿透 CLI | `qqBindCode()` 查名为 qq 的 module，再直接写该 module data 的 QQ state | `packages/cli/src/admin.ts:76-91`。与“模块文件私有、跨模块只通过路由”存在实际例外 |
| Notify async 缺席时特殊 lenient | 仅 `notify.send` 享受模块发起 async 的 lenient missing/unavailable enqueue | `packages/engine/src/modules/steward/module-effects.ts:34-36`。通用队列为何认识 Notify 是当前 app name 侵入 |
| 官方包封闭枚举 | install request/result/catalog 都枚举 `qq,remind,mind,memory-local,coding,editor,mcp,files,events` | `packages/contracts/src/steward/module-lifecycle.ts:9-11`、`packages/contracts/src/steward/module-lifecycle.ts:35-56`。增加官方应用要改 kernel contracts |
| MCP 独占 entry removal 例外 | 只有 external `mcp` 可越过 entry removal protection | `packages/engine/src/modules/steward/module-identity.ts:15-16`；`packages/engine/src/modules/steward/module-remove.ts:30` |
| MCP/Files/Events 代码来源特殊 case | supervisor 根据这三个名字允许 trusted release codeDir resolution | `packages/engine/src/modules/steward/module-supervisor.ts:191-197` |
| entry 的历史身份推断 | `/`、`*`、`chat.*`、除 request/status 外的 `approvals.*` 推断 entry | `packages/contracts/src/steward/index.ts:269-274`。其中 chat 已非实际公共系统 target，不能继续据名字推断当前能力 |
| 已删字段兼容化 | channel/dynamicSchedules 被静默剥离；旧 effects 转 provider.complete/provider.wake/notify.send；tool callers 被剥离 | `packages/contracts/src/steward/index.ts:98-108`；`packages/contracts/src/steward/module-tool.ts:8-13`。这是读取遗留记录的兼容机制，不是新作者永久 API |

**重要区别：** trusted Agent 的特殊 launcher、caller retention、secret/output 隐藏和 Run admission 是当前真实安全边界；不能为了“应用平等”取消。应该把其职责写为唯一 trusted Agent 与内核之间的必要关系，而不是以此证明还需要“runtime capability”第三类产品。

— `packages/engine/src/modules/steward/module-calls.ts:357-375`；`packages/engine/src/modules/steward/agent-application.ts:11-40`

#### 5.2 可添加能力时的安全与兼容限制

“以后只加不删”不自动等于兼容：

1. **输入未知字段默认拒绝。** 新参数只能是 optional 才不破坏旧调用者；新调用者不能假定旧目标支持。
2. **输出消费者可能 `.strict()`。** 新字段或 enum member 可使老消费者拒绝。
3. **event kind / caller kind / error enum 是闭集。** 新增值可能使 SDK 或宿主拒绝整条消息，B2/B3 已是现成例子。
4. **output schema 扩展会改变 callback hash。** 即使类型上兼容，saved callback 也可能要求重新注册。
5. **结构子集有限。** 若新 schema keyword 需要旧 SDK/parser 理解，单纯“只加一个字段”仍是协议变更。
6. **包 catalog 封闭枚举会迫使普通 app 安装演进依赖 kernel release。**

— `packages/engine/src/modules/steward/module-calls.ts:184-217`、`packages/engine/src/modules/steward/module-calls.ts:51-60`；`packages/contracts/src/steward/module-output.ts:3-39`；`packages/contracts/src/steward/index.ts:295-359`；`packages/contracts/src/steward/module-lifecycle.ts:35-56`

最小冻结工作必须先写明 unknown-field/unknown-value 行为，而不是先实现版本 framework。可以保留安全敏感输入严格验证；但不能同时宣称“任何输出增加永远兼容”。

#### 5.3 最小永久 PUBLIC KERNEL 候选：保留原始能力，不扩成万能 API

以下列表是**职责/语义候选**，不是要求把当前函数签名逐字永久封死：

1. **应用身份与受检生命周期**
   - 唯一 module identity、当前 approved activation；
   - checked submission/activation/rollback/disable/removal；
   - caller 与 target 不可伪造；
   - migration、credentials、删除授权不能绕过。
   - 不冻结官方应用名字清单。

2. **模块声明边界**
   - identity、entry、tools、event subscriptions/schedules；
   - uses 与 audience；
   - settings/secret declaration；
   - app-owned opaque contributions；
   - 私有 data/content；
   - 必要的 model/network/resource bounds。
   - 不冻结每个 app 的业务 key、schema、参数默认值。

3. **事件与连接**
   - 有界 JSON framing、request correlation；
   - schedule/tool/async result/activation/diagnostic readiness 的明确语义；
   - 单应用事件串行；
   - disconnect 不等于已证明所有外部动作停止。

4. **受治理路由**
   - sync 与 persisted async；
   - typed/validated input/output；
   - visibility admission；
   - 可信 caller；
   - identity/contract target pin；
   - scope 明确的 idempotency；
   - status、waiting、unknown；
   - 保守 retry/cycle/depth 防护。
   - 不冻结具体队列表、lease 字段或 retry 数字。

5. **必要的内核治理原语**
   - 预算/授权/调度/凭据保管/事实记录；
   - 具体工具的最终集合由各专项审计决定；
   - 不因为名为 system module 就自动保留全部工具。

6. **HTTP 托管边界**
   - approved listener owner；
   - owner auth 与 endpoint-specific auth 精确划分；
   - credential stripping；
   - bounded request；
   - 静态页面与受保护数据的区别。
   - Web 自身 API、页面、主题、Notify delivery 不属于内核永久 API。

7. **独立恢复**
   - Web 损坏后仍可进行受信任 pause/rollback/approval；
   - stopped-service admin 与 backup/restore 的安全入口；
   - 不冻结救援页展示和 CLI 日志。

8. **唯一 trusted Agent 的必要边界**
   - 内核授权 Run、identity/budgets/cancellation/stop evidence；
   - Agent 拥有 Pi backend/operation 实现；
   - 不接受普通模块指定宿主 cwd/token/caller；
   - 未来 Provider 属 Agent 演进，不先注册成新一类内核产品。

#### 5.4 明确排除永久公共冻结的内容

- Prisma model、audit kind/id、queue row、lease、activation generation 的持久化具体实现。
- `CallOrigin`、`CallScope`、registry maps、`registerSystemModule/registerLocalModule` 这些 in-process host 编程接口。
- Agent `runtimeStartSchema` 的 token/cwd/sessionDir 等内部载荷。
- 特定 Pi backend、启动 env、socket 临时目录、process kill/restart 实现。
- SDK convenience wrappers 所引用的 Notify/Events/Agent 业务编排。
- 所有 shared Zod export 的自动公共化。
- 旧 `SESSION_SOURCES`、历史 effects/removed field preprocessing 等仅为 stored data 服务的兼容项。
- build typecheck report、依赖检查算法、output-impact 实现、sandbox memory cap 的当前默认值。
- 官方包枚举、QQ/private state、memory discovery policy、Web/Notify builtin 身份。
- 已有 executor device protocol 的泛化：其当前设备安全保证应保留，但它不应被包装成通用 remote module runtime。

这些排除不等于删除安全能力，而是**不把实现细节或应用策略变成永久应用契约**。所依据的分层分别见 `packages/engine/src/modules/steward/module-registry.ts:4-23`、`packages/engine/src/modules/steward/module-context.ts:10-20`、`packages/contracts/src/steward/local-runtime.ts:17-28`、`packages/contracts/src/steward/executor.ts:112-113`。

### Inferences

**冻结前最小顺序：**

1. 修正 B1 鉴权前缀、B2 waiting、B3 SDK/wire error code。
2. 给 callback hash 一个明确含义，分离 reference snapshot hash。
3. 准确声明 timeout、cancel、unknown、retry、key scope 与 output-impact 的范围。
4. 清除或迁出 memory、QQ、Notify、MCP、官方包名造成的内核策略依赖。
5. 将 Web/Notify 视作普通应用；保留唯一 trusted Agent 的实际信任根。
6. 只冻结上面的必要横向能力及其原始语义，其他留在模块或私有宿主实现。
7. 后续遇到具体新能力缺口再增加窄接口；不先建抽象 Provider/version/remote-host 框架。

### Gaps

- 未审计每个 kernel tool 的必要性；本列表不替代负责各工具的专项报告。
- 未进行 source 修改或测试；所有建议均为冻结前待处理项，不是已完成结果。
- 未提供新文件路径：按只读要求没有创建报告文件；此 Markdown 可由调用方的自动结果捕获机制保存。