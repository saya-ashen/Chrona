# Provider 运行：复用 Pi，补齐宿主接线

Chrona 内核管会话、持久消息、队列/恢复、调度、路由授权与运行预算，内置 `notify` 模块管通知预算与送达，`web` 模块管网页；Pi 管推理、文件/命令/网页工具、技能、扩展、MCP 与原生执行权限。不另建技能/MCP/模型执行器。整体边界见[当前架构](architecture.md)；以下是 Provider 适配与接线参考，不表示已接入或验收任何真实账户。M1 保持现有普通会话与构建语义，已完成开发全组检查；[M1 验收记录](chrona-workbench-m1-acceptance.md)已由协调者签署。项目 cwd/日志分离、执行尝试、持久取消、有界详细聊天流、成果捕获及客户端审阅已纳入 M1–M3 集成，当前范围与限制见 [M3 验收记录](chrona-workbench-m3-acceptance.md)。真实 SDK/host 与 fake Pi 子进程/Neovim 的闭环证据不代表真实模型或生产部署验收。

## Provider、内核与模块的当前边界

Provider 使用同一个 `ProviderAdapter`，提供单次 `complete` 和 Agent 的 `start/inject/abort/done`。内核在 `ProviderRunInput` 显式传入可信 `systemPrompt` 及 `resources: configured | minimal`；模块/用户任务文本仍通过 `prompt` 传递，不能提升为系统指令或授权。Pi 不再内置管家业务提示，也不根据 execution 引用猜测任务用途；execution 引用仅用于事件关联。configured 使用 owner 已配置的资源，minimal 不加载 Chrona 工具及额外技能/扩展，实际工具限制仍由可信执行点落实。

内核保留身份、权限、预算、租约、取消、问答、持久化和停止证据；coding 在自己的执行请求中提供编码工作说明，并管理依赖和成果接受。`provider.complete/wake` 仍为带身份与预算检查的内核系统工具。服务器与设备端均显式提供通用执行边界和所选项目规则；不开放 raw RPC，也不引入 herdr 或新的执行循环。实施范围与验收见[三层实施计划](provider-kernel-module-plan.md)。

## 项目编码运行

`executionRunInput` 在普通偏好、记忆和日程组装之前分流编码运行：仅使用已授权项目、目标、明确的基线与预算，日志写入独立 session 目录。Pi 编码 profile 不继承个人技能/扩展资源；原生工具预算由现有扩展的 `tool_call` 前置守卫限制，详细事件中的事后计数仅用于补充终止。

Provider 的实际 `handle.done` 才能提供进程退出证据；启动门的合成结束、调用超时和租约到期不提供该证据。停止待确认时撤销能力并保留目录占用，不自动重跑。实际退出后的成果捕获在释放目录之前完成；完成回调通过既有 routed outbox 触发 `coding.get` 发布，避免取消处理器等待同一应用的串行回调。成果生成与 owner 人工接受分别记录。

## 启动和显式资源

先按[运维说明](operations.md#确认-agent-真正可用)准备专用绝对命令、精确版本和私有 profile。默认 `0.85.0`；显式可选 `1.3.0` 及以后的 `1.x`。不同版本的 MCP/扩展能力不等同，不自动升级，不复制个人认证。

默认继续关闭发现、模板、上下文文件、主题及项目信任。需要资源时，由 owner 设置 `CHRONA_STEWARD_PI_RESOURCES_FILE` 指向审核过的 JSON 文件，例如：

```json
{
  "skills": ["/opt/chrona/resources/research/SKILL.md"],
  "extensions": ["/opt/chrona/resources/web/index.ts"],
  "tools": ["web_search", "fetch_content"]
}
```

这是示例，不是已安装资源。文件须私有（Unix 建议 0600）、规范绝对路径、不经符号链接，位于 Pi profile 与事务树之外；单文件最多 32KB。技能是明确的 Markdown 文件；扩展是明确的本地入口文件，不接受包安装指令、URL、glob 或任意内置扩展。入口须为规范绝对文件、非 group/world 可写，同样不能来自 profile/事务树。空清单/未配置不会发现个人资源；错误清单使 Provider 不可用，不退回默认环境。修改清单后重启服务。

Pi 1.3 还可显式选择 `builtin:mcp`、`builtin:codemode`、`builtin:tool-search`。前者复用该专用 profile 的 Pi `mcp.json`；只允许 owner 明确批准的服务器/账户，**本次源码改动没有配置私人服务器、迁移 OAuth 或连接真实账户**。工具名也须列在 `tools`。例如只读假服务器工具名可为 `mcp__fixture__ping`，实际名称以 Pi 为准。`bash` 默认启用；显式加载的 `codemode` 等资源遵循 owner 选择的执行模式，不再以是否安装 bubblewrap 决定是否启用。

启动后 `get_commands` 只接受显式选择的扩展/技能来源。网页执行详情显示已检查到的技能命令名、版本和显式扩展数；这不是完整工具注册表，也不证明每个工具已经成功执行。显式资源仍是受信代码：须审查入口、扩展及 profile 的权限/配置；专用 profile 不是完整秘密隔离，原生 MCP 配置及授权仍由 Pi 环境负责。尤其不能把可写 profile 误称为 Agent 无法修改的配置边界。

`CHRONA_STEWARD_EXECUTION_MODE` 未设置或为空时默认 `trusted-local`：Provider 的 bash、文件工具与显式扩展使用服务用户的 OS 权限，即使安装了 bubblewrap 也不包装。宿主文件不会默认隐藏；附件通过 `content/chat` 符号链接提供，只读是 Agent 行为规则，不是 OS 强制限制。显式 `required-isolation` 要求 bubblewrap 探测成功，否则 Provider 不可用；该模式隐藏 home 和 Chrona 数据，只读挂入附件，允许写入会话目录、专用 profile 及已批准宿主路径，仍可联网及读取其他宿主挂载，不能承诺隔离所有秘密。模块与构建检查也遵循该模式，需宿主安装依赖的候选目前会被拒绝。两种模式下路由授权、路径访问审批和对外动作审批都保留；能够访问文件或执行命令不代表获得用户授权。

## 完成、补充和停止

- 正常模型运行以会话级 `agent_settled` 为完成候选，再核对最新状态/消息队列/请求/注入 epoch；`agent_end` 不代表恢复完成。
- 补充消息用 Pi 原生 `prompt(streamingBehavior="steer")`，由 Pi 决定忙时排队、空闲时启动，不把已空闲后的消息只塞进队列。
- Pi 1.3 明确返回 `disposition=handled` 的无模型命令/输入处理器不等待不存在的模型结束事件，仍核对运行/UI状态。0.85 没有这一已文档化的 disposition 保证；不能用 1.3 元数据验收推断所有 0.85 扩展路径。
- 取消/超时先保留终止结局、拒绝迟到注入，`clear_queue` 成功后才 `abort`；失败则关闭/有界终止进程。最终文件提交等待子进程退出。
- owner 的“停止本次处理”具有持久取消标记，立即撤销该运行的 Chrona 工具能力；排队/准备启动/最终提交中的取消同样生效。本次不自动重试，已保存消息/文件不删除。不承诺撤回已经发生的外部副作用，不自动取消未来调度。
- 会话与运行的取消以 `chat.cancel` 和内核运行状态为准，不沿用旧“事务”生命周期接口。

## 待答复请求

内置网页在“今天”页显示待答复请求与运行停止入口；选择和确认需要用户明确操作，文本/编辑请求使用独立输入框，不填入聊天框。原文和自由文本答复不存请求审计，不在重启后回放。系统页面规格与 adapter 位于 `packages/engine/src/modules/steward/builtin/web/src/system/`，由共享 json-render renderer 渲染；`app.js` 负责认证、路由与连接 shell。

请求绑定 owner 工作区、运行和新的独立请求 id；选项用序号校验并在适配器中还原为原选项。重复答复只接收一次。timeout、运行 deadline、取消、暂停/结束、进程退出或重启会使旧请求失效，不能跨运行沿用。请求最长 5 分钟；这不是可跨日恢复的 Provider 原生权限会话。失败时可在会话中由用户明确继续，执行端需要重新请求授权。

敏感/过长上下文拒绝发布，不提供对隐藏细节的同意按钮。已知密钥、能力 token、常见凭据格式与控制字符被过滤；不能据此承诺识别所有未知秘密。UI 提醒不要输入密码/密钥，认证应走服务专用 Pi 配置流程。对话原文、工具参数/输出、thinking、原始 notify/widget、set_editor_text 不经这个通道转发；扩展不能借 UI 修改聊天草稿或绕过通知预算。

通知复用既有预算和送达，每次运行最多一个请求提示，失效时尚未发出的提示被抑制。静默时段/上限可能使提示只留网页或进汇总，不能声称 QQ 必达。API“已记录答复”不是 Pi/外部系统完成动作的回执；UI 子协议没有外部动作成功确认，网络/进程故障后的结果须如实核对。

## 进度、用量与持久化

安全进度只记录阶段与受限工具名，不存思考、参数、结果。事件有上限和去重，属于尽力而为的可观测性，不是完整执行录像。用量复用 `get_session_stats`；只有同一 session 且计数未回退时才计算本次增量，否则显示会话累计。缺失/超时统计保持未知，不伪造 0。金额是 Pi 的 USD 估算，不是账单，不把每日运行次数上限冒充金额预算。

当前用既有 Audit 追加技术事件、请求元数据与唯一答复回执，未改 schema/迁移；这不是 P1 所需的可恢复详细事件存储，不能作为编辑器完整会话流使用。请求 controller 和原文/自由文本答复仅在内存；持久记录不会重放授权。旧请求没有存活 controller 时显示中断。

系统模块 `chat` 的接口（供入口模块使用；网页“今天”页与 MCP 的 `chrona_runs` / `chrona_run_answer` / `chrona_run_cancel` 使用）：

- `chat.runs`：最近运行、安全进度/统计/资源与请求，可按会话过滤；不是无界历史导出。
- `chat.answer`：`answer` 为 JSON `{"decision":"submit","value":false}`；选择为整数序号，文本为字符串。关闭为 `{"decision":"cancel"}`。类型/选项不符为 `invalid`，已失效/重复为 `failed`。
- `chat.cancel`：停止本次，不重试。

这些接口不接受 Grant scope，不属于 `chrona_request_approval`，不能扩大 Chrona 的邮件发送、来源、购买等权限。Provider-owned tool 的风险还须由其运行环境/已审查扩展控制。

## 材料的查看与下载

内置网页的会话附件通过认证后的 `/api/web/file` 读取，再以 Blob URL 下载；不把 API key 放进链接。应用页面的图片由 web 的内容引用路由读取，不能以第三方链接接收 owner 认证头。这里不承诺旧“事务”界面的 Markdown、音视频或文档内嵌预览；录音、转写、音视频理解与生成仍须由明确接入的工具处理。

## 验收边界

适配器与界面测试不代表真实来源、OAuth、智能性、外部发送或跨日工作的验收。真实 Pi 的离线元数据探针只使用空认证、合成技能/扩展/stdio MCP，不调用模型。部署前仍须准备专用配置、备份/回滚，并由 owner 单独授权及执行真实场景验收。
