# 重构方案：架构、数据模型与页面

状态：2026-10-15 主管设计，按 [设计目标](steward-goals.md) 实施。不保留旧系统兼容性：
旧任务 / 目标 / 日程 / 计划 / 运行 / Provider / 成果库 / 管理 MCP / Hermes 插件全部删除；
数据库新基线，生产从零开始（旧库只归档备份，部署另行授权）。

## 1. 保留与删除

| 保留（重写为新模型） | 删除 |
| --- | --- |
| `apps/server`：认证、`/api/steward`、静态页面、steward 运行时（tick、Agent 循环、QQ Bot） | 所有非 steward 路由、MCP、agent-control、assistant-surface、ai、goals、tasks、pages、triggers、runtime |
| `apps/web`：外壳 + 管家页面 | 其余页面、设置里的 AI clients 等 |
| `features/steward` | 其余 15 个 feature |
| `packages/contracts/src/steward`、`db`、`domain/steward`、`engine/modules/steward`（+ workspaces）、`integrations/steward`、`i18n`、`shared`、`logging`、`cli`（精简） | `providers`、`graph-runtime`、`ui-protocol`、`skills`、`agent-cli`、`external-plugins/*`，contracts / engine / integrations 中的非 steward 部分 |
| Pi Agent 运行器与工具扩展（移入 `packages/integrations/src/steward/pi-agent/`） | 旧迁移链、指纹 / amendment / normalizer 机制、迁移 fixtures |
| 来源适配器（`chino_service_health`、`local_test`）、QQ 官方 Bot 传输 | Reddit 适配边界（无授权，暂删，需要时再加）、Hermes 投递 |

## 2. 数据模型（一切皆事务）

| 模型 | 作用 |
| --- | --- |
| `Workspace` | 单一 owner 的数据范围；`settings` 存打扰预算、安静时段、时区、日报时间 |
| `Affair` | 一件事。`status`：`active` 进行中 / `watching` 照看中 / `paused` / `done`。照看方式：`cadenceSeconds`、`nextCheckAt`、`lastCheckAt`。Agent 运行状态：`agentState`（`idle`/`queued`/`running`/`waiting_user`/`failed`）、`nextRunAt`、`failures`、`handling`（处理方式与理由）、`summary`（“现在怎么样了”） |
| `AffairEntry` | 事务时间线：用户原话 / 补充 / 反馈、进展、来源变化、提问与答复、授权请求与决定、成果发布、通知。`actor`：`user`/`chrona`/`source` |
| `AffairResult` | 成果版本（不可变，Markdown 正文 + 来源 + 局限 + 下一步）；用户反馈作为 Entry，触发修订 |
| `AffairRun` | 一次 Agent 运行（原 StewardWorkAttempt）：唤醒原因、能力令牌哈希、租约、工具调用、结局 |
| `Ask` | 需要用户的事：`question`（补充信息）、`approval`（动作授权）、`suggestion`（建议）。`open`→`answered`/`approved`/`denied`/`dismissed`/`expired`；带 `topic` 用于拒绝冷却 |
| `FollowUp` | 到期唤醒事务 |
| `Grant` | 授权规则：`action` × `mode`（`auto`/`notify_after`/`preapproved`/`ask`/`never`）× 范围（全局 / 事务 / 来源）× 期限；来源 `default` 或 `user` |
| `Connection` / `InboundEvent` / `EventAssessment` | 来源管线（去重、基线、评估、关联事务） |
| `Notification` | 发件箱；`level`：`now`/`digest`/`web`；生成 ≠ 发送 ≠ 已读 |
| `ChatMessage` | 聊天记录（入 / 出），用于“刚才那件事”的指代 |
| `Preference` | 长期偏好：文本、来源（`said`/`learned`）、可在网页查看删除 |
| `ManagedTool` / `ToolRun` | 面板、脚本；脚本版本哈希 + 批准记录 |
| `Audit` | 追加式审计 |

删除的概念：`Delegation`（照看方式并入 Affair，权限并入 Grant）、`AttentionItem`（拆为 Ask + Entry + 今日投影）、`StewardWork`（并入 Affair）。

## 3. 运行方式

```text
聊天 / 网页输入 ──► 接待（Concierge，一次短 Pi 运行）
                     ├─ 直接回答（可用 web 检索）
                     ├─ 新事务 → 排队给事务 Agent
                     ├─ 补充 / 反馈 / 回答问题 → 对应事务 Entry，唤醒
                     ├─ 批准 / 拒绝 → 解决 Ask
                     ├─ 暂停 / 继续 / 结束事务
                     └─ 记住偏好
来源事件 / 到期跟进 / 检查节奏 ──► 关联事务 ──► 唤醒事务 Agent
事务 Agent（Pi，多步）──► Chrona 工具 ──► 策略层判定 ──► Entry / 成果 / Ask / 通知
通知 ──► 打扰预算（now / digest / web，日上限，安静时段）──► QQ Bot / 网页
```

- **接待**只做理解与路由，上下文：最近 20 条聊天、未结束事务（标题、状态、最近更新）、开放 Ask、偏好。
  无法确定指代且多件事都可能时，才用一句话澄清。
- **事务 Agent** 工具：`get_context`、`save_progress`、`ask_user`、`request_approval`、`publish_result`、
  `set_care`（检查节奏）、`follow_up`、`suggest`、`draft_tool`、`run_tool`、`notify`、`finish`、`close_quietly`，
  另有 `web_search` / `fetch_content`。所有工具效果都过策略层（Grant）。
- **策略层**（`packages/domain/src/steward/policy.ts`，纯函数）：输入动作、范围、Grant 列表、内置默认表，
  输出 `auto` / `notify_after` / `preapproved` / `ask` / `never`。模型无法修改 Grant。
- **打扰预算**（纯函数）：输入级别、今日已推送数、安静时段、时间，输出“现在发 / 进日报 / 只在网页”。

## 4. 页面设计

导航只有三项：**今日 · 事务 · 设置**。每页顶部都有同一个输入框“交代一件事 / 问点什么”，走接待流程，
回复显示在输入框下方（与聊天同一套逻辑）。

### 今日 `/:lang`

```text
┌ 今天 10月15日 ─────────────────────────────────────────┐
│ [ 交代一件事，或问点什么……                       发送 ] │
│ 一句话摘要：3 件事在推进，2 件等你决定，昨天以来 1 个新成果 │
├ 等你决定 ──────────────────────────────────────────────┤
│ ● 调研：二手相机  需要补充：预算上限？      [回答……] [发送] │
│ ● 服务巡检  想把检查改为每 30 分钟         [同意] [不用]  │
├ 重要变化 ──────────────────────────────────────────────┤
│ Chino · Jellyfin 恢复正常（2 小时前） → 事务              │
├ 新成果 ────────────────────────────────────────────────┤
│ 《二手相机选购结论》v2  摘要两行……              [阅读]    │
├ 临近 ─────────────────────────────────────────────────┤
│ 周五  续费域名（跟进）                                   │
├ 建议 ─────────────────────────────────────────────────┤
│ 你每周都在查汇率，要不要做个面板？   [好] [没用] [不再提]  │
└───────────────────────────────────────────────────────┘
```

空区块不显示；全部为空时显示“目前没有需要你处理的事”。

### 事务列表 `/:lang/affairs`

分组：**等你**（有开放 Ask）· **进行中** · **照看中**（显示节奏与下次检查）· **已暂停** · **已结束**（折叠）。
每行：标题、一句话现状、下一步、最近更新时间。

### 事务详情 `/:lang/affairs/:id`

```text
┌ 标题  [进行中]                          [暂停] [结束]   ┐
│ 目标：……                                               │
├ 现在怎么样了 ─────────────────────────┬ 照看方式 ──────┤
│ summary（Agent 维护的现状）              │ 每 1 小时检查   │
│ 下一步：……                              │ 上次 10:20      │
├ 等你决定（若有）────────────────────────┤ 通知：重要时    │
├ 成果 v2 ▾ ─────────────────────────────┤ [修改]          │
│ Markdown 正文、来源、局限               ├ 来源 / 工具 ────┤
│ [ 修改意见……                   发送 ]   │ ……             │
├ 经过 ──────────────────────────────────┤ 授权 ──────────┤
│ 时间线（用户 / Chrona / 来源）           │ ……             │
│ [ 补充……                       发送 ]   │                │
└ 技术详情（折叠）：运行记录、工具调用、事件 ─────────────────┘
```

窄屏时右栏移到“现在怎么样了”之后。

### 成果阅读 `/:lang/affairs/:id/results/:version`

全宽阅读视图，版本切换，来源列表，反馈框。

### 设置 `/:lang/settings`

分区：**聊天**（QQ Bot 绑定状态）· **通知**（日上限、安静时段、日报时间）· **授权**（内置默认 + 用户规则，
四种模式可改、可撤销）· **记住的偏好**（列表、删除）· **来源**（连接状态、覆盖说明、暂停/撤销）·
**工具**（面板、脚本、批准状态）· **运行状况**（Agent、来源积压、发件箱）。

## 5. 实施阶段

| 阶段 | 内容 |
| --- | --- |
| P0 清理 | 切断入口对旧系统的引用，删除不可达代码、测试、脚本、文档；新 schema 基线与简化迁移 |
| P1 模型 | 新契约、schema、engine：Affair / Entry / Result / Run / Ask / Grant / Notification / Preference / ChatMessage |
| P2 Agent | 事务 Agent 工具迁移到新模型；接待（Concierge）；QQ Bot 自然语言（去掉回复码依赖） |
| P3 策略 | 授权策略层、打扰预算、日报、建议冷却、偏好注入 |
| P4 页面 | 今日 / 事务 / 详情 / 成果阅读 / 设置 |
| P5 工具 | 面板；脚本批准版本在沙箱中运行 |
| P6 验收 | 设计目标第 12 节的场景，用真实 Pi 跑；未见过的新需求轮换 |
