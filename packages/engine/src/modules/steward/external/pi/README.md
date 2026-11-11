# Pi Provider 应用

`pi` 是可选预装的普通应用。激活时通过 `agent.register` 登记自己，再通过现有 Web `page-set` 登记“Pi 设置”页面。执行工具仅对内核可见；配置和本地模型选项工具对所有者可见，由普通应用路由验证当前所有者权限。

本应用拥有 `createPiProvider`、进程操作收据、停止协调和 Pi 配置选择。内核拥有 Run 准入、预算、能力、提供方身份绑定与回调授权；`@chrona/pi` 拥有 Pi 进程协议。应用不使用内置 Agent 的特权准入接口，也不要求内核导入 Pi。

## 构建与验证

在仓库根目录运行：

```sh
bun run packages/engine/src/modules/steward/external/pi/build.ts
bun test packages/engine/src/modules/steward/external/pi
bun run packages/engine/src/modules/steward/external/pi/test.ts
```

应用目录的 `bun run build` 和 `bun run test` 同样可用；后者先构建，再运行完整假提供方测试与随发行版本附带的作者测试。构建生成 `module.json`、`runtime.js`、`test.js` 以及导入入口。构建不安装依赖。测试仅使用假适配器和临时目录，运行时检查通过 Bun 子进程模拟源码及发行产物，不启动真实 Pi、模型或账号。

## 运行契约

注册 ID 为 `pi`，协议版本为 `1`。登记的执行端点为 `health`、`start`、`status`、`inject`、`abort`、`release`、`transcript`、`native`、`complete`；配置工具为 `configure`，页面为 `settings`。登记的 `configuration.revision` 是非敏感有效配置的 SHA256；应用在公布版本前持久化其归档，保存或清除设置后重新登记，登记暂时失败时定期重试。精确输入和输出以 `schema.ts` 及生成的 manifest 为准。

端点直接接收结构化 camelCase 字段。`start` 使用共享 `runtimeStartSchema`，并要求内核签发的 `callbacks` UUID 和 `configurationRevision`。完整启动请求的摘要与操作收据在进程启动前持久化；回调固定发送到 `runtime-callback.event({callbackId,event})`。应用不接受调用者自选的模块身份或回调目标。`native` 将请求交给已有操作的同一个 `handle.native(request)`，保留 JSON 字段，不创建另一个进程。

`start.providerOptions` 当前支持 `{model?,thinking?}`。内核固定的 `model` 优先且禁止冲突。启动和 completion 按内核传入的 `configurationRevision` 精确读取已归档的目录、模型、思考强度和来源。缺少版本或版本不可用时，在创建适配器和启动进程前失败，禁止回退到当前设置。归档在重启后保留；新建上下文采用新登记的设置，排队和已有上下文继续使用原版本。默认目录的继承位置发生变化时也明确失败。原始 Pi 目录内的技能、扩展、凭据等资源仍遵循用户 Pi 的可变资源语义，不复制或冻结。非敏感的初始配置快照保存在操作收据中，并通过 `raw` 事件 `{type:"chrona_configuration",revision,configurationRevision,effective}` 提交给对应 Run；其中包含配置来源、目录、模型和思考强度，不包含凭据或私有宿主启动参数。Pi 原生事件通过 `ProviderEvents.raw` 转发，不使用任意写入入口。

同一操作身份重试复用原收据；参数改变返回 `conflict`。未知启动和完成不能自动重放，并继续占用容量。`abort` 的返回只表示已请求停止；只有终态收据或可信宿主后代进程停止证明才能解除不确定状态。旧宿主的停止证明只能将操作恢复为失败，不能证明业务成功。`release` 释放内存中的句柄，但保留防重放收据。连接丢失时应用请求停止并等待现有句柄结束和终态收据落盘。

`complete` 将 `commandKey` 作为同一操作 journal 中的 `operationId`，要求 `configurationRevision`，接收可选模型、思考强度、系统提示、必需提示与输出 token 上限，以及默认 120000 毫秒的 `timeoutMs`。内核显式传入已准入的超时预算。持久化执行身份后立即返回 `{operationId}`，不等待模型结果；内核使用原 ID 查询 `status`。完成的终态和 `{text,inputTokens,outputTokens}` 一起持久化，`status.completion` 仅在成功终态提供。重复调用复用原收据，不启动第二个进程；旧独立 completion journal 的成功及未确认收据迁入共同 journal，未确认请求不重放。

完成操作使用相同的 `abort/status/release`。应用通过 Pi 适配器的可选 `AbortSignal` 请求结束进程树；适配器须确认后代关闭并清理私有文件后才能提供停止证据。已确认停止的失败或超预算结果记录失败终态；无法确认关闭时保留 `failure:true/outcome:null`，拒绝 release 并继续占用容量。主动停止使用共享 `failed` 终态，超时使用 `timed_out`；上层 Run 的取消状态仍由内核的停止记录决定。内核等待真实结果后结算预算；unknown 保留 pending 预算且不释放收据。丢失 acceptance 回复时仅核对原 ID。截止时间请求停止后最多继续等待 5 秒关闭证据，仍无证据则传播 unknown。通用内核同时接受既有提供方直接返回的同步完成结果。

## 当前用户的 Pi 配置

宿主可传入直接的 `PiProviderOptions` JSON 对象 `CHRONA_PROVIDER_CONFIGURATION`，以及选定模型环境变量的对象 `CHRONA_PROVIDER_MODEL_ENV`。前者不使用额外 `pi` 包装层。环境变量只按适配器允许的键安装到本进程（包括保留来源的 `PI_CODING_AGENT_DIR`），随后删除两个传输变量。宿主保留扩展、桥接地址和进程辅助程序等启动配置的控制权。应用未配置时仍可登记和展示设置；执行可用性由健康检查报告。

所有者通过 `configure` 选择 `profile`、`model`、`thinking`，或通过 `clear:true` 恢复继承。`config` 和页面 `form` 都替换整组覆盖值；表单空值表示继承。思考强度使用 Pi 的 `off/minimal/low/medium/high/xhigh/max`。保存不调用模型，也不修改 Pi 配置目录里的资源。

配置目录依次采用所有者选择、宿主 `agentDir`、服务环境 `PI_CODING_AGENT_DIR`、当前服务用户的 `~/.pi/agent`。明确选择的目录必须已存在且为规范绝对目录；健康检查和适配器进一步验证可用性。继承默认目录时保留 Pi 的首次创建行为。模型与思考强度依次采用所有者覆盖、宿主值、所选目录 `settings.json` 的默认值、Pi 自身默认。界面报告实际来源；服务用户可能与交互用户不同。Pi 继续管理该目录中的技能、扩展、提示模板及上下文。

`models` 离线读取所选目录中 `models.json` 与 `settings.json` 的模型 ID，最多返回 500 个。它不查询账号或远端模型目录，不读取 `auth.json`，不回传密钥、端点、请求头或任意显示名称。配置文件通过不跟随符号链接的方式读取，单文件限制 1 MiB。列表不覆盖 Pi 的所有内置模型，可直接填写模型 ID；目录更改保存后可刷新列表。实际账号和模型可用性仍以执行时的适配器结果为准。
