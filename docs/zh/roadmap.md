# Chrona 路线图

当前版本：0.2.0

Chrona 是开源 AI 日程软件。它不应该在“原始计划生成、摘要、工具选择”这些能力上和模型本身竞争，因为这些能力会持续下沉到模型层。Chrona 应该围绕 AI 越强反而越重要的部分复利：有时间约束的执行、人的控制、Provider 治理、可观察状态、可恢复失败，以及可信结果。

产品闭环是：

```text
Task -> Plan -> Schedule -> Execute -> Review/Recover
```

AI-first 意味着：每个产品表面都应该帮助 AI 安全推进已排期工作；每个 AI 动作都必须让用户可见、可控、可恢复。

## 战略判断：什么会变便宜，什么会更值钱

随着 AI 能力增强，Chrona 中一些能力会从差异化变成入口能力：

| 能力 | 趋势 | 路线图含义 |
| --- | --- | --- |
| 普通任务拆解 | 变便宜 | 计划生成是入口，不是护城河。 |
| 通用摘要 | 变便宜 | Dashboard AI 应做 action triage，而不是装饰性复述。 |
| MCP/tool 支持本身 | 变便宜 | 用户价值是安全 refs、审计、恢复和权限边界。 |
| Provider 数量 | 变便宜 | 优先做 Provider 行为一致性，而不是堆 logo。 |
| 通用 AI UI 生成 | 变便宜 | json-render 应成为带验证和 fallback 的可信结果层。 |

Chrona 的长期价值应随 AI 能力增强而增强：

| 长期能力 | 为什么会随 AI 变强而更重要 |
| --- | --- |
| Trigger 驱动执行 | AI 能做更多事，但仍需要用户拥有的触发规则；日程是当前已实现来源，未来来源必须保持相同的审批、幂等与审计边界。 |
| 人工审批与恢复 | 自动化越强，未经约束的错误代价越高。 |
| 可观察执行记录 | 更长的 AI 工作需要进度、证据和失败原因。 |
| 统一用户态状态 | AI 行为越动态，内部状态越多；用户需要一个清晰状态和下一步动作。 |
| Provider capability 治理 | AI runtime 会越来越多，产品行为必须一致。 |
| 可信结果表面 | AI 输出会更复杂，用户需要可验证、可审查、有 fallback 的 artifact。 |
| 本地优先二进制 | 日程、任务、Provider 凭据和工作输出都是敏感数据。 |

## 产品支柱

1. **任务捕获**：捕获工作、结构化、排序，并保持状态清晰。
2. **计划生成/审查**：用 AI 创建和修订可执行计划，但审查与接受必须显式。
3. **排期安排**：把工作绑定到时间、冲突、到期窗口和自动化策略。
4. **Provider 执行**：通过 Hermes、Claude Code、Codex 和未来 Provider 执行 AI/运行时工作，同时不把 Provider 差异泄漏到产品行为。
5. **结果审查/恢复**：让输出、失败、取消、审批和等待状态可在 Dashboard 与任务工作区中检查。
6. **可信 AI 表面**：用 json-render 展示经过验证的 AI-authored 结果与洞察，同时保持 runtime controls 由产品控制。

## 当前基线

以下能力已存在于当前代码库，应视为产品基线。

| 区域 | 当前能力 |
| --- | --- |
| 页面 | 当前主导航是 Dashboard、Schedule、Tasks、Action Center、Settings。Memory 可以作为内部/隐藏投影保留，但不是当前主产品表面。 |
| 任务 | 创建、更新、删除、完成/重开、优先级、状态、标签、依赖、父子任务，以及任务投影重建。 |
| AI 规划 | 流式计划生成、生成计划持久化、计划审查/编辑/接受流程，以及 materialize 为可执行任务计划层。 |
| 图计划 | 可执行的 `task`、`checkpoint`、`condition`、`wait` 节点，以及图状态解析。 |
| AI 节点运行时 | 用于节点完成、condition 选择、block/fail、wait 完成的 AI-visible refs；后端 ID 保留在服务端映射中。 |
| Schedule | 时间线、任务列表、AI insights、冲突、排期建议、任务创建、配置表面和外部日历 busy context。 |
| Dashboard | 今日关注、attention items、活动 runs、最近结果，以及失败/取消/等待工作的恢复入口。 |
| Task Workspace | 任务编辑、计划生成/接受、执行概览、最新结果、计划图、执行记录和节点详情检查。 |
| Settings / AI Clients | 数据库驱动的 AI clients 与 feature bindings，覆盖 Hermes、Claude Code、Codex 和开发/debug flows。 |
| 后端 API | 任务 CRUD/lifecycle routes、计划生成/接受 routes、task-scoped execution routes、workspace command/event transport、schedule projections、runtime provider routes 和 AI client routes。 |
| MCP / Provider bridge | Streamable HTTP MCP tools 和 Provider 集成，让外部 AI runtime 通过安全契约推进 Chrona 工作。 |
| 外部日历 | 只读订阅来源、来源校验/管理、导入忙碌事件、刷新状态和日程上下文。 |
| json-render | 经过验证的 AI-authored 结果表面和产品控制的 runtime 边界。 |
| 发布模式 | Bun-first 开发和打包二进制分发。 |

## AI-first 执行原则

1. **已排期工作是当前产品中心。** 已接受的目标设计会把日程推广为 Trigger 创建的任务实例，同时保持时间约束、审批和用户控制为权威。
2. **AI 可以提出建议，Chrona 拥有状态。** 模型可以建议计划、patch、摘要和结果，但 task、schedule、execution、approval、recovery 状态由 Chrona 拥有。
3. **每个非 happy path 都要有一个清晰下一步动作。** waiting、blocked、failed、cancelled、review 状态必须告诉用户下一步做什么。
4. **Provider 差异停留在产品层以下。** 产品 UI 依赖 capability 和归一化事件，而不是 Provider 名称。
5. **AI-authored UI 永远不是 runtime authority。** json-render 可以展示结果和洞察；cancel、retry、approve、configure 和 destructive action 必须是 product-authored controls。
6. **Local-first 应该简单。** Release 用户不应该为了运行产品理解 Bun、schema generation 或 Provider 内部机制。

## 近期战略主线

近期工作应先让现有 AI 日程闭环可靠，再扩展新的产品表面。

### 1. 让 Schedule-to-Execution 成为主闭环

Chrona 应清晰展示：计划如何变成排期工作、排期工作何时变成 AI 执行、执行停止时用户如何恢复。

重点：

- 展示每个 scheduled block 是否可以 auto-plan 或 auto-execute。
- 只在用户配置允许、安全且可理解时启动到期工作。
- 让排期建议可审查，并在可能时可回滚，同时绑定可见工作状态。
- Dashboard 和 Schedule 直接连接 waiting、blocked、failed、cancelled 的恢复动作。
- 外部日历默认作为 busy context 和冲突输入，除非用户显式开启更强自动化。

成功状态：

```text
Create task -> Generate/review plan -> Schedule -> Execute -> Review result -> Recover if needed
```

表现为一个可见产品流，而不是互不连接的后端功能。

### 2. 统一 Dashboard、Schedule、Tasks 的用户态工作状态

随着 AI 执行变得更动态，内部状态会越来越复杂。用户需要一个清晰状态模型。

重点：

- 从一个共享状态模型派生 label、tone、disabled reason 和 primary action。
- 保持 `WaitingForInput` 与 `WaitingForApproval` 的区别。
- 保持 `Failed`、`Blocked`、`Cancelled`、`Completed`、`Done` 的语义区别。
- Dashboard、Schedule、Task Workspace 对同一 work item 显示相同状态和下一步动作。
- 优先使用统一 user-facing state view，而不是每个页面各写条件分支。

成功状态：

```text
same task + same execution facts -> same label, same severity, same primary action on every page
```

### 3. 把执行记录变成 AI work cockpit

原始 runtime logs 不是用户体验。AI 越强，runs 越长，tools 越多，approvals 越多，failures 也会更多。Chrona 必须让它们可理解。

重点：

- 将任务工作区执行部分改造成 cockpit：当前状态、活跃节点、Provider、阻塞项、主动作和最新结果。
- 按 run/session/step 分组执行历史，而不是展示一条原始事件流。
- 区分最终输出、checkpoints、runtime events、tool calls、assistant/user conversation。
- 保留任务多次 runs 的对话历史。
- 摘要化 tool activity 和 failures，但不隐藏证据。

成功状态：

```text
用户能回答：什么在运行，为什么停下，AI 做了什么，有什么结果，现在什么动作安全。
```

### 4. 统一 Provider capability 和恢复行为

Hermes、Claude Code、Codex 和未来 Provider 应该像同一个日程执行产品背后的不同引擎。

重点：

- 维护 Provider capability matrix：health、start、stream、cancel、approval、resume、tool traces、structured output、snapshot recovery。
- 在 Settings 中展示 capability readiness。
- Provider events 先归一化，再进入产品状态。
- 根据 capability 展示动作，而不是按 Provider 名称写 UI 分支。
- 只有当现有 Provider 具备一致的日程驱动执行语义后，再增加更多 Provider。

成功状态：

```text
same scheduled task + different provider -> same running/waiting/failed/completed product behavior
```

### 5. 让 json-render 成为可信 AI 结果层

json-render 用作经过验证的输出时是战略方向；用作失控 runtime authority 时不是。

重点：

- 验证所有 AI-authored spec。
- 为无效 spec 提供 markdown/text fallback。
- runtime controls 必须 product-authored，并与 AI-authored surfaces 分离。
- 给 AI-authored outputs 绑定来源、验证和审查 metadata。
- 将 json-render 用于结果审查、dashboard action triage、计划解释、报告和 artifacts。

成功状态：

```text
AI output can be rich and structured, but bad specs never break execution controls or hide recovery actions.
```

### 6. 让首次运行和二进制发布像本地应用，而不是开发者工具

Bun-first 适合开发和打包；release 用户应该体验到 Chrona 是本地应用。

重点：

- 打包二进制启动顺滑：初始化 storage、服务 Web UI、暴露 health、引导 Provider 设置。
- 提供 Provider setup 和 demo task flow 的首次运行路径。
- 除 troubleshooting 外，隐藏 Bun、schema generation 和内部端口细节。
- 让 local bind/auth 行为可理解且安全。

成功状态：

```text
Download release -> start binary -> configure provider -> run demo schedule task -> inspect result
```

## 中期演进

中期工作应在近期状态、Provider 和 cockpit 基础稳定后，继续深化 AI 日程闭环。

| 主题 | 方向 |
| --- | --- |
| 动态重规划 | 运行中的任务可以请求计划变更，经审查/接受后安全恢复执行。 |
| 执行恢复 | 改进 retry、resume、cancel、blocked-state recovery、stale run reconciliation 和 run/session diagnostics。 |
| Provider 编排 | 根据 capability、任务上下文、日程策略和恢复需要协调 Provider 选择。 |
| 多 session 执行 | 为单个任务协调多个 provider/runtime sessions，同时保持图状态正确和可审计。 |
| 日历智能 | 用外部日历提供 busy context、冲突检测和排期建议，同时保持 Chrona task/execution state 权威。 |
| 可信结果 artifact | 让 json-render outputs 可审查、有来源、fallback-safe，并能在任务历史中长期保留。 |
| 服务执行的记忆 | 用 task/workspace memory 改善规划和节点执行，但默认不把它作为独立用户目的地。 |
| 投影一致性 | 让 Schedule、Dashboard、Task Workspace 的页面投影更快、更一致，并在可能时保持 task-scoped。 |
| 验证 | 为 plan generation、graph execution、task-scoped execution actions、MCP/provider contracts、projections、schedule decisions 和 json-render fallback 增加聚焦测试。 |
| 长期目标 | 增加持久 Goal 生命周期和有边界的 Goal 子任务，不引入持续运行的 Provider session。 |
| 任务实例模型 | 分离可重复任务系列生命周期与单次执行状态；WorkBlock 只保留为可选日历容器。 |
| 可扩展 Trigger | 将日程激活推广为经过验证的 Trigger 定义和幂等 Delivery；Webhook/内部事件必须等到端到端实现时再加入。 |

## 长期方向

长期方向是战略意图，不应理解为近期承诺。

| 主题 | 方向 |
| --- | --- |
| 主动激活 | Chrona 根据 Goal/任务状态、用户策略和 Provider capability 判断何时应规划、排期、触发、执行、审查或延后工作。 |
| 外部输入与 Trigger | 将对话、邮件、笔记和外部系统转换为经过验证的 Trigger Delivery 或结构化任务，不允许外部 payload 拥有权限或运行时状态。 |
| 人类治理的自动化 | 支持更强的日程/事件自动化，同时保留审批边界、幂等、审计轨迹、恢复路径和用户拥有的策略。 |
| Agent 生态 | 让更多 Agent、Trigger 和工具通过显式、可检查契约参与工作，同时 Chrona 对 Goal、任务、任务实例和执行状态保持权威。 |
| 协作 | 在单用户执行治理稳定后，加入更强的多人审查、审批、审计轨迹和共享执行上下文。 |
| 生产强化 | 改进认证、备份/恢复、可观测性、迁移安全、部署文档和运维 runbooks，同时不放弃 local-first 简洁性。 |
| 组织级规划 | 将个人任务、日程、依赖和执行历史连接成项目/组合级可见性。 |

## 贡献重点

适合现在投入的方向：

- 保持文档和示例与当前 AI 日程产品一致。
- 强化 Task -> Plan -> Schedule -> Execute -> Review/Recover 闭环。
- 围绕用户态工作状态、执行动作、Provider contracts、投影、排期决策和 json-render fallback 增加窄测试。
- 改进 Dashboard、Schedule、Task Workspace、Settings / AI Clients 的 UI 清晰度。
- 当代码漂移到错误层时，收紧 Provider/package boundaries。
- 优先做小而可验证的改动，避免宽泛重写。

## 指导句

Chrona 不应该靠比未来模型更会“思考”取胜。Chrona 应该靠让更强的 AI 按用户的日程可靠工作取胜：可见、有边界、可恢复、可信。
