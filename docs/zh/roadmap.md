# Chrona 路线图

当前版本：0.1.9

Chrona 正在演进为面向 AI 辅助工作的任务控制面。产品要把四个循环连接起来，并且让每一步都可见、可恢复：任务捕获、图计划、排期安排和运行时执行。

这份路线图区分已经具备的能力与后续方向。它不是对所有条目的固定交付承诺；近期计划代表当前产品重点，中期演进和长期方向则描述执行与排期基础稳定之后的可能发展。

## 当前产品支柱

1. 任务控制：捕获工作、结构化、排序，并保持状态清晰。
2. 计划控制：生成、编辑、接受并执行图计划。
3. 执行控制：运行 AI/运行时支持的节点，并支持人工 checkpoint、显式动作和可恢复状态。
4. 排期控制：把计划变成有时间约束的工作，并暴露冲突、建议和到期执行自动化。
5. 智能体集成：让外部智能体通过安全工具契约创建、规划、排期和推进 Chrona 工作。

## 已完成 / 当前可用能力

以下能力已存在于当前代码库，应视为产品基线。

| 区域 | 当前能力 |
| --- | --- |
| 任务 | 创建、更新、删除、完成/重开、状态、优先级、标签、依赖、父子任务，以及任务投影重建。 |
| AI 规划 | 流式计划生成、生成计划持久化、计划审查/编辑/接受流程，以及 materialize 为任务计划层。 |
| 图计划 | 可执行的 `task`、`checkpoint`、`condition`、`wait` 节点，以及图状态解析。 |
| AI 节点运行时 | 用于节点完成、condition 选择、block/fail、wait 完成的 AI-visible refs；后端真实 ID 保留在服务端映射中。 |
| Work 页面 | 最新结果、计划图、执行记录、任务详情、右侧 rail/inspector、底部 composer surface。 |
| Task Workspace | 任务编辑、计划生成/接受、执行概览、节点详情检查。 |
| Schedule 页面 | 时间线、任务列表、AI insights、冲突、排期建议、任务创建和配置界面。 |
| Inbox | Pending approvals、排期建议、等待输入，以及失败/取消 run 的集中入口。 |
| Memory Console | 工作区/任务记忆条目展示。 |
| AI clients | 通过 Settings / AI Clients 管理的数据库驱动 AI clients 与 feature bindings。 |
| 后端 API | 任务 CRUD/lifecycle、计划生成/接受、task-scoped execution、Work/Schedule 页面投影、runtime provider、AI client 等路由。 |
| MCP / Hermes | 面向 Chrona execution/plan/node 操作的 Streamable HTTP MCP tools，以及用于 agent 式执行的 Hermes provider/plugin 集成。 |
| 外部日历 | 只读订阅来源、来源校验/管理、导入忙碌事件、刷新状态和日程上下文。 |

## 近期计划

近期工作应优先让现有“日程到执行”产品可靠、清晰，再谨慎扩展新的产品表面。

### 1. 让 Work 页面执行记录真正可用

- 将 composer 固定在底部，让中间记录区域可滚动。
- 保留任务所有 runs 的对话历史，而不是只展示最新 run。
- 在协作/对话视图中只展示对话消息，隐藏 tool-call 与 task-event 噪音。
- 简化消息卡片，避免重复显示“你”/“智能体”等 speaker labels。
- 将执行记录改造成可用布局：左侧按 run 分组的执行流，右侧固定 task cockpit，展示当前状态、活跃节点、阻塞项和主要动作。
- 区分最终输出、checkpoints、runtime events、tool calls、assistant/user conversation，避免混成原始线性日志。

### 2. 强化 task-scoped execution API

- 执行状态检查优先使用轻量 task-scoped status/action endpoints。
- 保持 execution endpoints 显式，不把 feature calls 和 task execution 都塞进 generic chat 语义。
- 保持 AI-visible refs 作为 agent worker 的外部契约。
- 明确每个任务的 session 复用、隔离、错误后刷新和恢复行为。
- 以 tool inputs/results 作为执行事实来源，避免依赖临时 structured-result submission 路径。

### 3. 稳定排期到执行闭环

- 接受排期建议后可靠创建或更新 WorkBlock。
- 仅在配置允许且安全时，由 scheduler 启动到期工作。
- 暴露冲突和自动化建议，同时避免轻量状态检查触发整页 schedule projection 刷新。
- Schedule UI polish 聚焦 P0 路径：找到工作、理解冲突、接受建议、启动到期执行。

### 4. 保持 provider 与 package 边界清晰

- AI client 选择保持数据库驱动。
- `generate_plan`、`edit_plan`、`dispatch_task`、`execute_task_node` 等 feature-specific contracts 保持显式。
- Provider 协议解析保留在 `packages/providers/*` 下层。
- 编排、计划执行、排期和任务生命周期策略保留在 `packages/engine`。
- 共享 schema 与 API contracts 保留在 `packages/contracts`。

### 5. 接入更多 provider

- 在当前 provider 集合之外，接入更多 execution/provider 集成。
- 每个 provider 都应位于显式 capability contracts 之后，不把 provider-specific 协议细节泄漏到产品代码。
- 让 provider capability discovery、错误处理和 runtime diagnostics 足够可见，以支持日程驱动执行。
- 增加 provider-specific 行为时，保持核心 task/plan/schedule 工作流不变。

### 6. 支持任务执行多 session

- 当 provider、任务范围或恢复路径需要时，允许单个任务执行使用多个 session。
- 明确 session 复用、隔离、错误后刷新和恢复行为。
- 在 Work 页面和执行时间线中，让每个 session 的事件可检查。
- 避免多 session 执行导致节点重复完成或破坏图状态。

### 7. 完成外部日历生态

- 让当前只读订阅导入在 malformed feeds、被阻止的本地 URL 和刷新失败场景下保持可靠。
- 只有订阅行为稳定后，再加入 Google/Outlook 等认证 provider 集成。
- Calendar import/sync 行为应显式、尽可能可回滚，并安全处理冲突。
- 在与原生 Chrona scheduling 相同的 review loop 中暴露日历冲突和日程提案。

### 8. 让文档与产品状态一致

- README 和 quick-start 聚焦当前 Vite + Hono + Bun 应用。
- 过时的重构计划、审计记录和阶段性债务文档，在内容合并进当前文档后删除或归档。
- API、架构、数据模型、provider boundary、package boundary 文档与真实 routes 和 schemas 保持一致。

## 中期演进

中期工作应在 Work、execution 和 schedule 行为稳定后，扩展当前闭环。

| 主题 | 方向 |
| --- | --- |
| 动态重规划 | 运行中的任务可以请求计划变更，经审查/接受后安全恢复执行。 |
| 执行恢复 | 改进 retry、resume、cancel、blocked-state recovery，以及 run/session diagnostics。 |
| 运行时抽象 | 在不改变核心 task/plan/schedule 工作流的前提下，支持更多 execution backends 和 providers。 |
| 多 session 执行 | 为单个任务协调多个 provider/runtime sessions，同时保持图状态正确和可审计。 |
| 日历生态 | 与外部日历软件同步，同时让 Chrona 的 task、plan 和 execution state 保持权威。 |
| 更强记忆 | 在规划、节点执行和总结中更有意识地使用 task/workspace memory。 |
| 更好的投影 | 让 Work、Schedule、Inbox、Task Workspace 的页面投影更快、更一致，并在可能时保持 task-scoped。 |
| 测试覆盖 | 为 plan generation、graph execution、task-scoped execution actions、MCP tools、Work projections、schedule proposal decisions 增加聚焦测试。 |

## 长期方向

长期方向是战略意图，不应理解为近期承诺。

| 主题 | 方向 |
| --- | --- |
| 外部输入 | 将对话、邮件、笔记和外部系统转成可规划、可排期的 Chrona 任务。 |
| 协作 | 加强多人审查、审批、审计轨迹和共享执行上下文。 |
| 生产就绪 | 改进认证、部署文档、备份恢复、可观测性、迁移安全和运维 runbooks。 |
| 智能体生态 | 让更多 agents 和 tools 通过显式、可检查 contracts 参与工作，同时 Chrona 保持控制面角色。 |
| 组织级规划 | 将个人任务、排期、依赖和执行历史连接成组合/项目级可见性。 |

## 贡献重点

适合现在投入的方向：

- 让文档和示例与真实 route/schema 行为保持一致。
- 围绕任务计划、执行动作、Work 页面投影、排期决策和 MCP tools 补充聚焦测试。
- 改进 Work、Schedule、Inbox、Task Workspace、Settings / AI Clients 的 UI 清晰度。
- 当代码漂移到错误层时，收紧 package boundaries。
- 优先做小而可验证的改动，避免宽泛重写。
