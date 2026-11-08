# Agent 内置应用

当前业务调用方优先使用 context/run/get/stream/write/interrupt/respond 原语，应用自己管理会话和业务流程。下文 start/status/inject/abort 等接口保留底层和既有调用说明；完整当前边界见[Agent 原语与应用编排](agent-module-orchestration.md)。

2026-11-07 开发变更。本文区分实现、验证和试用状态；生产部署不在范围。

## 职责

`builtin/agent` 使用现有 `module.json`、SDK socket 和 module supervisor 独立运行。它随 Chrona 发行，内部创建 Pi Provider，持有进程控制对象、运行操作状态和自己的启动／结束回执。正式服务不再在内核进程创建 Pi Provider；`ports.provider` 是 routed-call 代理及能力元信息。显式注入 Provider 的单元测试／嵌入接线仍可使用进程内适配器，按数据库隔离注册，不是正式服务的第二执行路径。

内核保留调用者身份、Run/token 授权、队列、预算、持久状态与停止证据规则。Agent 在执行前由路由核验 Run、cwd、lane、deadline、operationId；启动审计只记录摘要。原进程内版本已有的启动记录不能成为新版重复启动许可。

## 调用

- `start` 立即返回 operationId；`status` 返回未结束、已结束或无法确认。内核等待期间短查询状态，不在 SDK handler 中等待整个任务。
- `inject` 补充输入；`abort` 确认收到请求，不能据此确认任务已停止。
- `release` 只接受已有完成回执的操作；磁盘回执保留，防止同一 Run 再次启动。
- `complete` 启动独立补全操作，`completion` 短查询结果，避免付费模型等待阻塞其他执行的取消。
- `transcript` 与 `health` 提供现有只读能力；诊断 `health` 事件通过现有 `modules.report-health` 报告就绪。
- 工具参数使用 JSON 字符串包裹，应用使用原有 zod 输入校验，保留 nullable、嵌套参数和限制；输出复用运行时 schema 的结构化 manifest 契约。

接口 audience 为 `kernel` 与 `modules`。内核继续使用原始 Run 协议；模块使用下述结构化公开参数，不能传 `input` 编码内核请求。Agent 从 SDK `trigger.caller` 读取直接调用模块的 moduleId/hash，按操作归属校验；业务参数不能冒充身份。owner/Provider 不直接调用 Agent。

## 回调

`runtime-callback` 暂保留进程内订阅，接收进度、用量、资源、执行事件、问答和问答中断。它还提供仅受信任 Agent 能用的 `agent-admit/agent-settle`：准入从当前尚未结束的路由调用中查原调用模块身份、参数和事件预算上下文；Agent 只提交 callId，不能通过业务参数选择调用者。模型结束后按预留记录结算。SDK Agent 使用普通 routed call，内核核验其当前工作空间、builtin 身份、moduleId、activeHash 以及 approved/builtin 版本来源。其他应用即使声明相同 uses，仍无权发送运行回调。引用绑定工作空间，随运行结束释放。

## 宿主接线与停止

宿主仅向已核验发行身份的 Agent 注入 Pi 配置和已有模型环境白名单；不把数据库、QQ 或服务访问凭据传入应用。模型凭据仅经宿主环境进入 Agent/Pi，不进入模块调用、页面或回执。Agent 应用在宿主运行，Pi 继续按用户选定的 trusted-local / required-isolation 模式执行；普通应用的隔离方式不变。Agent 的宿主访问不宣称恶意代码隔离。

应用使用现有 SDK 和 supervisor。断开 socket 时，SDK 生命周期回调触发 Agent 清理；supervisor 仍拥有应用进程组。正常服务退出先取消并等待活动运行，再停止模块。失联、崩溃、回执写入失败均不能推断实际停止，内核仍保留未知状态。应用重启发现只有启动摘要而无完成回执时报告未知，不自动重启工作。此版本不承诺接管崩溃前的活动 Pi 会话。

新 Agent 不允许普通提案／构建／动态替换／回滚／删除，否则会把可信宿主入口交给普通代码。supervisor 启动时只从当前 Chrona 发行的已核验资源升级 Agent：旧版必须是批准的 builtin 来源，数据 schema 相同、无迁移、无正在运行的 Run；保留暂停状态和已有数据，记录版本与激活历史。有运行时阻塞则保留旧版并报告注册失败，停止／协调完成后重启再升级。该路径不接受模块输入，也不开放动态替换。现有其他应用的生命周期保持原状。

## 数据与交付

应用回执在自己的 data/operations 中，内核执行回执仅存请求摘要与结束结果；文件名为 operationId 摘要，不保存 token、提示词或 profile。公开模块模型回执会保存私有完成文本，受 moduleId/hash 归属校验。结束回执先写临时文件再原子替换。坏数据拒绝恢复。

Agent 自身 bundle 通过 `build.ts` 生成；发行资源生成步骤在比对 Git 种子前重建 bundle。新增 Agent 种子保留其他模块的 Git 历史。未修改数据库 schema 或迁移。

## 普通模块调用

模块使用现有 `chrona.call()`，无需额外 SDK 或 HTTP。manifest 在 `uses` 声明调用契约；遵循现有路由语义，`visibility` 决定受众，`uses` 不是新增的运行时权限白名单。模型功能必须声明 `model` 限制。

```ts
const { operationId } = await chrona.call("agent.start", {
  "work-id": "report-fix", "project-ref": "authorized-project", "command-key": "start-1",
  goal: "完成已授权的项目修改",
  budget: { "timeout-ms": 60_000, "max-tool-calls": 10 },
});
const execution = await chrona.call("agent.status", { "operation-id": operationId });
await chrona.call("agent.inject", { "operation-id": operationId, "command-key": "input-1", message: "补充要求" });
await chrona.call("agent.abort", { "operation-id": operationId, "command-key": "cancel-1" });
```

公开参数采用现有 manifest 的 kebab-case 字段；返回字段沿用结构化契约的 camelCase。操作 ID 是不含路径的摘要。调用均使用默认同步模式：`start/complete` 很快返回操作 ID，随后短查询；不支持把敏感参数持久化进通用异步调用队列。

- `start` 复用已有 ExecutionStart：授权项目引用、目标、幂等 command-key、期限与工具次数上限。内核按原模块身份调用既有执行准入，创建唯一 Run 队列中的执行。模块不能指定 cwd、session 路径、token、模型或内核回调引用。
- `status` 返回 `{ operationId, execution }`；`inject/abort` 要求独立 command-key，复用持久控制回执与撤销规则。准入后由 Agent 直接操作其句柄，避免 SDK handler 经过内核回调自己形成死锁。
- `transcript` 接受 operation-id、可选 cursor/limit，返回已归一化的执行事件页，不接受宿主 session 路径。
- `release` 需结束确认，保留摘要回执防止重复启动；完成的模型结果也可 release。更换模块实例或版本不能读取或控制旧操作；不会自动继承旧版本正在执行的工作。
- `complete` 接受 command-key、prompt、可选 system、max-output-tokens。模型和期限由原模块 manifest 与用户 moduleModel 设置决定；先原子预留额度，再由 Agent 发起请求。`completion` 查询结果，不触发新付费请求。
- Agent 自有 module-operations 回执保存操作归属、请求摘要与执行引用／完成结果。只有 digest 的未知操作重启后拒绝重放；不自动重试付费请求。模型结果属于模块私有数据，受相同归属检查；不写入公共调用审计。

验证证据与当前本机试用版本在 `/tmp/chrona-agent-extraction-check/verification.md` 和独立试用实例 README 中记录。不存在生产部署结论。
