# 外部 Agent 管理 Chrona

首版管理入口：`POST /api/mcp/management`，标准无状态 Streamable HTTP MCP。
原 `/api/mcp` 保留：它服务于 Chrona 执行期间注入的工具，不用于外部个人 Agent 管理整个任务列表。

## 连接与权限

在 **Chrona 服务所在机器**、使用同一 OS 用户和同一 `DATABASE_URL` / `CHRONA_DATA_DIR`，运行新版本的 CLI：

```sh
chrona mcp enroll \
  --name personal-agent \
  --public-url https://chrona.example.com \
  --timezone Asia/Shanghai \
  --access full \
  --token-file "$HOME/.config/chrona/credentials/personal-agent.token"
chrona mcp list
chrona mcp revoke CLIENT_ID
```

- `--access` 必填。原有 `read`（任务读取）和 `full`（原有任务管理全部权限）保持原语义；**不会自动获得新增 Goal 权限**。full 包括启动付费执行、批准 provider 操作、删除任务，只授予可信管理 Agent。
- 新增 `assistant-read` 仅授予 `goals:read`；`assistant` 仅授予 `goals:read` + `goals:propose`。日常助理捕获使用这两种最小权限预设，不能创建任务、运行 AI、批准 provider、删除任务或授予权限。新增能力需使用匹配版本并显式 enrollment；Goal 捕获试用已另建最小权限凭据，原有任务凭据未扩大或轮换。
- 源码新增 `assistant-edit`：`goals:read` + `goals:propose` + `goals:write`。仅允许目标内容维护，不含执行、审批、生命周期切换。`goals:write` 覆盖凭据所属工作区，不是逐 Goal 的自然语言权限隔离。原 `assistant` 与已有凭据不自动扩大；编辑版本尚未部署。
- token 仅写入新建私密文件，POSIX 权限 `0600`、父目录必须私密；不输出 token，不覆盖已有文件。数据库只存 SHA-256 摘要。
- 凭据绑定当前默认工作区；工具不提供 workspace 选择或枚举。
- enrollment 是本机管理命令，不存在免鉴权的 HTTP enrollment 路由。CLI 不迁移运行中的数据库；必须先按正常升级流程启动匹配版本的服务。
- 轮换流程：enroll 新凭据 → 更新客户端 → revoke 旧凭据。
- MCP 客户端连接上述 endpoint，使用 `Authorization: Bearer <私密文件中的 token>`。不要把 token 放入对话、URL、Git 或日志。
- 管理凭据独立于全局 API_KEY 和 execution run token。即使服务未设置 API_KEY，管理入口仍拒绝匿名访问；管理凭据不能访问其他受 API_KEY 保护的 API。
- Pi 通过其 MCP 适配扩展连接；Codex 使用其远程 MCP 客户端配置。此实现不自动修改本机 Pi/Codex 配置，不自动部署 Chino。
- 服务端对每次 HTTP 请求、每次工具调用、后台命令后续阶段重新检查撤销和 scope；撤销不是对已发起 provider 操作的自动取消。

## 工具能力

实际参数以 `tools/list` 返回的 JSON Schema 为准；源码：`packages/contracts/src/api/management.schema.ts`、`management-goals.schema.ts`。服务器暴露工具不代表当前凭据具备调用权限；每次调用仍重新验证 scopes。

| 工具 | 能力 |
| --- | --- |
| `chrona_context_read` | 当前时间、时区、权限、Goal 捕获契约版本、时间策略及提醒能力边界；仅具有任务读取权限时返回 provider 列表及默认 provider |
| `chrona_goal_search` | 需要 `goals:read`；工作区隔离的标题/描述检索，生命周期过滤，每页最多20项 |
| `chrona_goal_read` | 需要 `goals:read`；compact / brief / criteria / history 有界读取，不返回原始资产、provider 或运行上下文 |
| `chrona_goal_propose` | 需要 `goals:read` + `goals:propose`；幂等捕获新 Draft Goal，含依据、第一步、未确认标准及自然语言权限请求；不会授权或启动任何工作 |
| `chrona_goal_update` | 需要 `goals:read` + `goals:write`；修改已有 Draft/Active/Paused 的标题、描述、简报、标准，追加进展/发现/决定；revision CAS、dryRun、原子审计与幂等回执，不授权或启动工作 |
| `chrona_task_search` | 标题/描述搜索，状态/过滤器、优先级、排序、分页；独立返回 deadline、排期摘要和自动化设置 |
| `chrona_task_read` | compact / summary / description / config / plan / activity / result；compact 只核对任务与排期，其他视图保留执行上下文 |
| `chrona_task_create` | todo / plan / automatic；显式 `taskExecutionMode: manual` 创建不依赖 provider 的手动任务；立即执行或排期，独立截止时间、重复任务、provider、执行参数；dryRun；回执包含 deadline、排期摘要和自动化设置 |
| `chrona_task_update` | 标题、描述替换/追加/清空、优先级、排期、截止时间、重复规则、自动化、provider 和执行参数；revision CAS、dryRun |
| `chrona_task_action` | 生成/停止/接受/修改计划；执行开始、重启、暂停、取消、重试、输入/审阅；checkpoint；provider approval；结果验收/重试生成；AI 完成/重开；手动任务使用带 `expectedRevision` 的 `manual_complete` / `manual_reopen`；结果追问/创建后续任务；排期提案接受/拒绝 |
| `chrona_task_delete` | preview 影响范围，随后提交精确 task/asset 集合及配置 revision 删除 |

### 日常 Agent 的 Goal 捕获

仓库 skill：[chrona-assistant](../../packages/skills/chrona-assistant/README.md)。包本身不自动安装；本次经用户批准已部署并安装到用户级 Pi。

Pi 保留原 `chrona` 任务连接，另用 `chrona-assistant` 及独立 Goal-only 凭据。后者仅暴露 context 和三个 Goal 工具，使用 server 前缀避免名称冲突。读取 Goal 能力时必须使用同一连接的 context，不要误用原任务连接。已有会话执行 `/reload`，随后可显式调用 `/skill:chrona-assistant`。

已通过实际适配器 HTTPS 发现、context、proposal dryRun、Goal-only 凭据拒绝任务读取，以及 Pi 0.85.1 跨项目技能发现；未为验收创建真实 Goal/任务、运行模型或启用自动化。自动识别和确认质量仍需日常试用。

- 先读取 `capabilities.goals`：`contractVersion: 1`，`canRead` / `canPropose` 是当前凭据权限；`proposalModes: ["new_draft"]`；`activation: false`、`policyGrants: false`。
- 先检索已有 Goal，避免把同一目标重复保存。相同 client/tool/requestId 的重试在同一事务中重放回执；不同 Agent 的相似文本不会自动合并。
- `chrona_goal_propose` 只接收新草稿：`requestId`、`title`、可选 `description`、`rationale`、`firstStep`、`expectedOutcome`、`permissionRequest`、`sourceSummary` 和可选 `dryRun`。不接受 workspaceId、已有 goalId、状态、排期、provider、审批或执行字段。
- 持久化 Goal 为 Draft，`nextReviewAt` 为空，标准为 proposed/未确认。简报中的约束仅是请求，不是已授予或已执行的权限。不会生成 Task、触发器、计划、复查或模型会话。
- dryRun 不写库、不保留来源摘要、不调用模型。真实写入前由日常 Agent 获得用户对最小摘要保存的确认；本工具不是可信权限授予界面。
- 回执 `completed` 只表示草稿已记录；读取 Goal 回执中的链接/ID 再核对当前状态。Goal `revision` 是只读快照指纹，不是授权或变更 CAS 凭据。
- 已部署捕获版本不支持已有 Goal 修改；源码新增编辑能力见下节。仍未提供 Draft 激活、权限授予或结果送达工具，不要用原有任务自动化接口绕过这些边界。任务列表读取需要独立的 `tasks:read`。
- Goal、命令回执和 actor=agent/source=management_mcp 事件原子提交；来源摘要保存在审计事件中。不存完整聊天、密钥或无关私人资料。现有回执保留语义不变，删除 Goal 不等于清除所有回执。

### 维护已有 Goal（源码已实现，待独立部署）

先查 `capabilities.goals.editing.contractVersion: 1` 与 `canUpdate: true`，并确认连接暴露 `chrona_goal_update`；字段缺失或旧凭据均不得假定可写。检索并读取同一 Goal，不建重复目标绕过限制。

- `chrona_goal_read` 新增持久化 `editRevision: goal-config-v1:N` 及 `editability`。更新的 `expectedRevision` 必须取 **editRevision**，不是旧的只读 `revision` 指纹。
- 更新输入：新 UUID `requestId`、`goalId`、`expectedRevision`、说明依据的 `reason`，以及 `patch` / `note` 至少一个。可加 `dryRun: true`，只返回有界差异，不保存提案、事件或回执。
- `patch` 只含实际改动：title、description（null 清空）、局部 brief（outcome/currentFocus/strategy/constraints）、按 ID 的 criteria add/revise/remove。不传字段保持原值；不要从截断读结果重建整个简报或标准列表。constraints 为整数组替换，但只是文字边界，不会授予权限。
- 标准变更语义后重置 satisfied/confirmedAt/evidence，仍为 proposed；未改标准保留证明和确认。至少保留一项，编辑后的标准不超过20项。Goal 只允许 Draft/Active/Paused，Achieved/Stopped 拒绝改写。
- `note: {kind: progress | finding | decision, text}` 追加 agent 归属记录，不是已验证证据、正式结果或完成确认。下一步工作重点可写 brief.currentFocus。
- 明确用户指令直接应用，无需重复确认；AI 推断的实质变化先预览并确认。`reason` 是审计来源，不是服务端验证的用户同意证明；skill 不能把内容编辑凭据变成逐目标的安全策略。
- Goal 内容、revision、简报版本、审计和命令回执原子提交。同请求重试重放历史回执；冲突必须重读、协调新旧变化，不允许只换 revision 重放旧 patch。无实质变化且无 note 时返回 unchanged。
- history 仅列管理端编辑/笔记，可分页；显式返回 reasonTruncated/noteTruncated/changesTruncated 及单值截断标记。缩小 pageSize 可看更多细节，但仍不是完整审计导出。现有网页活动面板未增加专用编辑历史 UI。
- 已有 Task.goalContext 保持冻结；后续新建关联 Task 使用更新后的简报。本操作不重排/暂停已有任务，不激活 Goal，不启动模型或监控。

部署步骤须另获授权：升级并应用已登记 amendment → 显式 enroll `assistant-edit` 新凭据 → 仅更新 Pi 的 `chrona-assistant` 连接及其 `chrona_goal_update` allowlist → 更新安装的 skill 并 `/reload` → 验证能力后撤销旧 assistant 凭据。任务连接不变。本次开发未执行这些步骤，也未新建真实 Goal。

### 原有任务管理能力

具有相应任务权限的客户端不是仅创建草稿的收件箱。示例：

```json
{
  "requestId": "94fe9488-7c57-4342-997e-3e1efc06d3bf",
  "title": "整理本周发布变更并生成发布说明",
  "description": "检查已合并变更、标注破坏性变更，输出 Markdown。",
  "mode": "automatic",
  "start": "now"
}
```

创建时 `mode` 必填；automatic 还必须明确 `start: now | scheduled`。没有可用 provider 时显式拒绝，不偷偷退化成 todo。`start: scheduled` 必须带 `{startsAt, endsAt, timezone}` 时间窗口；`start: now` 不能同时带 schedule / recurrence / timing。todo / plan **不传 start**，但可以直接传 schedule。相对窗口时间策略只在有排期时有效，todo 不启用 timing。

`tools/list` 的 create schema 以 object 为根，通过 `allOf` 公布上述结构性条件。日期先后、IANA 时区及重复规则等仍需运行时校验，复杂请求先用 dryRun。三种模式的完整 dryRun 示例也写在 schema description 中（Zod 会移除含 transform 的输入 schema 的标准 examples）。

### 日程不等于通知

- `todo` 只关闭自动规划和执行，仍是现有 AI Task；没有计划时仍可能显示 `Draft / Needs plan`。不能把所有关闭自动执行的任务都归类为人工待办。
- 手动任务必须显式传 `taskExecutionMode: "manual"` 且仅可用 `mode: "todo"`；不能传 provider、执行配置、自动化、重复规则或 `start`。它可有单次排期和独立 dueAt，并直接完成/重开，不创建 Plan、Run 或 provider session。完成/重开必须提交 task_read 返回的 `expectedRevision`；同一 `requestId` 只可重试相同参数。
- `schedule` 是日历时间块，`dueAt` 是独立截止时间。两者均不配置提醒通知；`timing` 是 AI 规划/执行时间，**不是提醒提前量**。
- `context.capabilities.scheduling` 声明时间块与独立截止时间可用；`manualTasks` 声明已交付的完成/重开支持，重复与手动/AI 转换仍不支持。
- `context.capabilities.reminders` 明确返回 `customRules: false`、`deliveryChannels: []`。现有 `inAppDueIndicators` 根据 dueAt 生成固定的站内到期提示，不可配置，也没有管理 MCP 读取入口。它们不是邮件、系统推送或具有送达保证的通知。
- 不应声称创建几个提前时间块就完成了多次通知配置。

模式示例（每行是一次独立调用的参数片段，均需补充新 UUID requestId 和 title；先用 dryRun）：

```jsonl
{"mode":"todo","schedule":{"startsAt":"2030-10-01T09:00:00+08:00","endsAt":"2030-10-01T09:15:00+08:00","timezone":"Asia/Shanghai"},"dryRun":true}
{"mode":"plan","dryRun":true}
{"mode":"automatic","start":"scheduled","schedule":{"startsAt":"2030-10-01T09:00:00+08:00","endsAt":"2030-10-01T09:30:00+08:00","timezone":"Asia/Shanghai"},"dryRun":true}
```

### 精简核对与状态分离

```json
{"taskId":"TASK_ID","view":"compact"}
```

compact 在读取 Plan/Run/执行会话之前返回：`task`、`revision`、`dueAt`、`schedule`、`automation`，不包含描述、provider 配置、执行 payload 或动作权限。需要修改配置可使用 revision；执行、checkpoint 或查看长命令进度前，仍应读取默认 summary / config 等完整视图。

- `task.status` 保留任务生命周期；`schedule.status` 来自 TaskProjection，不能互相覆盖。
- `schedule.startsAt / endsAt` 是投影时间窗口；缺少投影时 schedule 为 null，没有窗口时两个时间为 null，不猜测状态。
- 如传 workBlockId，compact 额外返回经过归属校验的 `workBlock`（id、status、scheduledStartAt、scheduledEndAt）。它是所选时间块，不替换任务级投影摘要，也不赋予执行权限。
- `automation` 明确列出 autoPlanGeneration / autoExecute 及 timing，不根据这两个开关推断人工待办身份。
- 时间戳以 UTC ISO 格式返回；展示时用 context.timezone 换算。单次排期的原始 IANA 时区没有持久化，不假装读回原时区。
- 搜索、创建/更新回执和各读取视图也包含 schedule / automation。旧字段与默认 summary 保留；summary 仍提供运行时上下文，不是精简视图。
- 命令回执中的摘要属于命令完成时的历史快照，幂等重放不会刷新它。核对当前排期请重新读取 compact / summary。

更新必须带 `expectedRevision`，从 task_read 获取。描述追加形如：

```json
{
  "requestId": "73e3ab4b-f1ad-49ef-b9e2-f9dcbf09a165",
  "taskId": "TASK_ID",
  "expectedRevision": "config-v1:3",
  "patch": { "description": { "mode": "append", "text": "补充：也要检查迁移说明。" } }
}
```

执行动作在 `action.input.action` 中使用已有 HTTP 领域动作名，例如 `start_manual`、`pause_session`、`cancel_session`。`expectedExecutionScope` 对应 task_read 的 executionScope；尚无 execution 时为 null。checkpoint 使用返回的 checkpoint ID、formRevision 和 availableActions，不猜测输入结构。`accept_plan` 必须携带 planId 与 expectedHeadStateVersion。结果验收/完成绑定具体 runId；不允许任意写 status。

## 命令、幂等与失败

- 每个新写入意图使用新 UUID `requestId`。传输失败时重发**完全相同**的 requestId 和参数；同 ID 不同参数返回 `IDEMPOTENCY_CONFLICT`。
- create/update 的本地写入、审计、命令回执同事务提交。独立 deadline 不被清除排期顺便删除。日历来源拥有的标题/排期/重复规则不可修改。
- 配置 revision 由数据库跟踪，包括网页、日历、其他 Agent 的修改；A→B→A 也使旧 revision 失效。冲突时重新读取并重新决定，不盲目覆盖。
- 立即自动化通过持久化命令推进：规划 →（automatic）接受计划 → 恢复请求的自动化配置 →（now）执行。规划期间自动化开关暂时关闭，避免 scheduler 抢先执行半完成命令。规划失败或配置冲突时保留任务与失败命令，不声称已启用执行；用户重新修改配置可提交新意图。
- 长操作返回 `queued` 回执，不占用 MCP SSE 会话。通过 task_read 的 commands，或同参数重放原请求查看回执进度。
- `completed` 是**管理命令完成**，不是任务一定成功；任务可能 running / blocked / waiting。以 task_read 的执行状态判断。
- worker 使用租约、心跳及有界并发；规划复用现有 durable feature 的幂等键。进程在执行 dispatch 后失联，命令标为 `uncertain / EXECUTION_OUTCOME_UNKNOWN`，不重复启动 provider。先读取实际任务执行状态或网页核对，再决定是否发起新的动作。
- 原始 provider 请求、工具载荷、run context、会话凭据不会出现在管理读取中。结果返回脱敏的语义/最终摘要与 artifact 元数据，不返回原始路径/正文。

## 执行完成与结果就绪

`Task.status=Completed` 只表示执行完成，不代表结果已经可验收。task_read 返回 `resultFinalization`；result 视图另返回该结果所属 Run 的 `finalization`，读取历史 accepted 结果时不会误用当前计划的附件。

- `Pending / Unavailable`：结果尚未就绪；管理状态为 `result_pending`，不提供验收动作。
- `Running`：管理状态为 `finalizing`。新记录的 `phase` 区分 `compose / review`；`hasCandidate` 表示已有同版本的候选排版，但不能据此验收。
- `Failed`：管理状态为 `result_failed`，有权限时可用 `retry_result` 重新整理结果，不必重跑执行节点。
- `Ready`：只有最终内容和 finalization 都匹配当前 manifest revision，才返回 `canAccept: true` 并提供验收动作。结果读取和验收使用相同的任务级 canonical Run，不会被较新的节点 Run 替代。

compose 最长 5 分钟，额外 review 最长 1 分钟；超时会发送取消信号，调用方不会无限等待 provider 的启动/清理。有效 compose 会先持久化候选，review 失败、无效或超时均回退候选；晚到的旧 review 不得覆盖新结果。显式重试可复用被中断 review 留下的同版本候选。

整理期间仍返回当前 manifest 声明且通过任务/occurrence/work-block 检查的附件。`artifactRef` 是可用于已有附件引用的 `AF...`；`ref` 保留数据库附件 ID。分页在引用过滤后进行，不混入未声明的历史附件。摘要的 `summarySource` 为 `manifest` 或 `finalized_result`，前者不代表最终排版完成。search 不读取完整 finalization，因此不会仅凭 Completed 宣称结果可验收；请再用 task_read 核实。

管理命令的 `dispatching` 可能持续覆盖执行及结果收尾；正常心跳不证明 provider 有进展。不要因为拿到 queued 回执或看到 Completed 就自动验收。

## 当前边界（未声称完整交付）

- 重复规则沿用现有 UTC recurrence 语义；非 UTC / DST 墙钟重复规则显式拒绝。单次排期支持带 UTC offset 的绝对时间和 IANA timezone。
- 网页 localStorage 中的用户创建默认值尚未迁移为服务端共享偏好。context 标记 `defaults.source: explicit_client_setup`，不假装读取到了浏览器配置。
- 结果正文/附件下载、完整执行图编辑面板的全部扩展命令、网页凭据管理 UI 尚未提供；已有计划 patch 和执行领域动作可用。
- uncertain 回执需核对实际执行状态；未实现自动对账后把所有未知回执转换为成功/失败。
- 命令输入和审计随幂等回执保留，删除任务不会同时清除这些回执；本版本尚无保留周期管理。旧 graph-only、尚未物化 Run 的结果读取/验收兼容性仍需补齐。
- 已部署到 Chino，并通过本机 Pi 所用 MCP 适配器的真实 HTTPS 联调；当前已打开的 Pi 会话需 `/reload` 或重启后加载新配置。尚未进行 Codex 客户端联调，也未在部署验证中调用真实模型。

## 数据库与验证

本发布线仅修改 `20260822000000_repair_release_line`；已发布迁移不变。
已注册各已知 mutable checksum 的源 schema 指纹和 amendment 文件校验，升级前自动备份；未知 drift 拒绝。Goal 编辑新增 `Goal.configRevision` 和 SQLite trigger，并登记当前已部署 checksum `5d2fdbd1…` 的 amendment；已有 amendment/normalizer 同步收敛到新 schema。新建、历史发布快照升级与当前部署结构升级均用隔离数据库验证，不对在线库执行开发迁移。

配置 revision 使用 SQLite trigger。Bun adapter 的 `run().changes` 包含 trigger 写入，不能直接作为 Prisma 的 affected-row 数；新增 adapter guard 返回顶层 `changes()`，并隔离同连接的普通查询与其他调用方事务。相关事务、外键 relation connect、跨调用方回滚测试位于 `packages/db/src/transaction-context.bun.test.ts`。

新增管理测试分布在 engine management、server management MCP、CLI management 和 DB amendment/transaction 测试文件。
### 本次验证记录（2026-09-10）

- 通过：`bun run typecheck`、`bun run lint`（ratchet，原有警告保留）、`bun run check:boundaries`。
- 通过：Vitest 102 文件 / 757 测试；管理 MCP、CLI、worker、迁移及事务专项测试。
- 通过：`bun run chrona build linux-x64`、`bun run build:smoke`（含 packaged upgrade / backup / restore）。
- 通过：全量 `bun run test:bun`。首次的两项 PDF 失败在未修改 HEAD 同样出现；设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指向已有 Nix Chromium 后，全量回归通过。
- 通过：Desktop E2E 的 task list / lifecycle / recurring 三个 spec，共 16 项。最初缺少默认 Playwright 浏览器，改用已有 Nix Chromium；随后修复测试启动竞争，将 `webServer.url` 改为经过 Vite 代理的 `/api/ready`，完整重跑通过。未执行全部 E2E 或 tablet/mobile 全量回归。
- worker 阶段编排使用注入式领域命令替身验证；另有真实本地 debug provider 的无效计划失败测试。未调用真实 Pi/Codex provider。
- 部署联调通过：Pi 实际 MCP 适配器加载全局配置、7 工具发现、独立 Bearer 鉴权、context、automatic dryRun、todo 创建/幂等重放/查询/读取、revision 更新及旧版本拒绝、清除排期保留 deadline、无效 run 拒绝、删除影响预览。测试待办保留供用户检查；原有任务、计划、Run、ExecutionSession、AIClient 均保持不变。

最终日志：`/tmp/chrona-management-bun-browser-final.log`、`/tmp/chrona-management-e2e-final.log`、`/tmp/chrona-management-new-tests-final.log`、`/tmp/chrona-final-*`。基线对照日志 `/tmp/chrona-baseline-pdf-tests.log`。
本机使用已有 Nix Chromium 151；设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 即可，无需下载浏览器或修改系统配置。

### 结果收尾修复回归（2026-09-10；尚未部署）

- `bun run typecheck`、lint ratchet、边界检查通过；本轮修改的源码和测试另跑 ESLint，零警告。
- 全量 `bun run test:bun`：296 文件，2007 passed / 11 skipped / 0 failed。
- Vitest：102 文件，757 passed。Desktop 的 task-lifecycle-execution 与 auto-execution-golden-path：10 passed，包含结果重试不重跑 Plan。
- 官方 Pi 0.85.0 + 临时 profile + 本地假模型：2 passed，覆盖连续 compose/review 与 20KB 请求，没有使用个人模型凭据。
- 新回归覆盖：干净 EOF、提前退出、启动取消、桥接输入保持打开时 Node 退出；review 失败/无效/超时/迟到，候选持久化和恢复、epoch 竞争；MCP finalizing/ready/failed 状态、ResultOverview 摘要、附件引用过滤及分页、历史 accepted scope、验收 Run 一致性。
- 对照 HEAD 的旧桥接运行新退出测试会失败：文件流的阻塞读取使 Node 无法及时退出；新 Socket 桥接通过。此为本地可重复证据，不等同已完成 Chino 线上故障复测。
- 旧 continuation 测试仅写 Ready 标记、缺最终内容；现先断言拒绝这种不完整状态，再用匹配 revision 的最终内容验证验收，未放松生产前置条件。

日志：`/tmp/chrona-repair-bun-all-final.log`、`/tmp/chrona-repair-vitest.log`、`/tmp/chrona-repair-e2e-desktop.log`、`/tmp/chrona-repair-targeted-final.log`、`/tmp/chrona-repair-old-bridge-proof.log`。本轮未部署、未重启 Chino、未重跑或验收线上任务。
