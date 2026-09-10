# 外部 Agent 任务管理 MCP：网页能力对等设计

状态：**目标设计；首版已实现，尚未完成全部增强项**。实际接入、参数与明确边界见 [管理 MCP 使用说明](./management-mcp.md)。以下不是全部已交付能力的声明。

本版替代最初“只能创建草稿、只能修改元信息”的方案。用户明确要求：**外部 Agent 应能完成与 Chrona 网页相同的任务操作，不应只是收集待办。**

## 1. 设计原则

1. **能力对等，入口不同。** 网页和 MCP 调用同一套 engine 用例、权限检查、状态转换和审计链。
2. **安全默认值不等于禁止能力。** 可以只记录任务，也可以生成计划、安排周期执行、选择 provider、更新配置、启动执行和处理结果。
3. **明确授权不重复确认。** 用户说“创建并自动执行”，且客户端已有对应授权，就执行该命令；不因为来自 MCP 再让用户回网页点一次。
4. **提及不等于操作。** “那个任务怎么样了”只查读；不因为任务文本里写着“立即执行”就获得操作意图或权限。
5. **能力相同不等于任意写数据库。** 启动、停止、接受计划、验收结果通过领域命令，不是 PATCH status。
6. **默认工作区透明处理。** 不增加 workspace_list，不暴露 workspaceId；授权时绑定服务端解析出的实际默认工作区，不硬编码 ws_default。
7. **管理身份与执行身份分开。** 外部 Agent 代表获授权用户操作产品，不冒充某次 provider run；管理 token 不获得 node_complete 等运行回报权限。

拟新增管理入口：`/api/mcp/management`。现有 `/api/mcp` 执行协议不变。

## 2. 网页实际能力与实现差距

已核对代码：

- `features/schedule/ui/dialogs/task-create-dialog.tsx`：创建模式为 `todo / plan / automatic`；还支持优先级、截止时间、起止时间、RRULE、AI client、规划和执行触发时机。
- `features/schedule/ui/schedule-actions.ts`：网页创建带排期的任务实际是先 create，再 applySchedule，不是只调用 POST /tasks。
- `features/schedule/ui/forms/task-config-form-types.ts`：网页编辑还支持 description、provider、executionConfig、自动化时机、周期规则等。
- `features/schedule/ui/schedule-ai-preferences.ts`：当前默认自动规划为 true、默认自动执行为 false；这些偏好保存在浏览器 localStorage，不是已有的服务端统一默认值。
- `packages/contracts/src/automation-timing.ts`：已有 immediate、at_start 和提前触发枚举。
- `packages/domain/src/task/derive-automation-policy-preview.ts`：已有 provider readiness、计划接受、排期前置条件和自动执行暂停规则。
- `packages/engine/src/modules/tasks/create-task.ts`、`update-task.ts`：任务核心写入及相关生命周期行为。
- `apps/server/src/routes/tasks/`：网页已有计划、执行、结果及生命周期的独立命令入口。

因此不能只把现有 POST /tasks 的字段映射成工具，然后宣称“与网页一样”。需要将网页分散的创建/排期/规划操作抽成共享应用命令，并补上可靠的异步回执。

## 3. 工具划分

原先四个工具继续存在，但不是完整任务管理的工具数量上限。

| 工具 | 职责 |
| --- | --- |
| `chrona_task_search` | 查找任务、列出近期或待处理任务 |
| `chrona_task_read` | 读取需求、状态、计划、活动、结果、可执行操作 |
| `chrona_task_create` | 与网页对等的任务创建及后续流程编排 |
| `chrona_task_update` | 与网页对等的任务配置编辑，包括排期和自动化 |
| `chrona_context_read` | 获取默认策略、当前时间/时区、可用 AI client、授权能力和参数选项；不是工作区选择工具 |
| `chrona_task_action` | 显式生成/接受计划、启动/停止/重试执行、回答输入、处理审批和结果等领域动作 |
| `chrona_task_delete` | 读取删除影响、提交删除；保持网页现有依赖/资产影响确认规则 |

后两项的具体 action union 按已有网页按钮与 engine 合约逐项定义，不接受任意 HTTP 路径、方法或自由格式操作名。Goal 本身的创建/编辑属于 Goal 工具，不偷偷塞进 task_update；在既有 Goal 中创建任务则属于 task_create 的关联能力。

完整交付必须包含常用任务闭环，不能把用户常用的规划、执行、验收永久标成“请去网页”。本文重点细化四个基础工具，其他命令的逐 action payload 需在实施前补齐。

## 4. 通用协议

### 输入与身份

- 严格 JSON Schema；未知字段报错，不能悄悄舍弃用户请求。
- taskId 等 ID 为 opaque string（1–128）；不接受模型填写的 workspaceId、actorId、run token 或 provider session。
- 标题 trim 后 1–500，描述上限 10,000，复用现有任务字段约束。文本统一换行为 LF，保留 Markdown 内部格式。
- 凭证决定客户端身份、工作区和 scopes。描述、聊天来源或 confirmed=true 都不是授权依据。
- 时间必须是带 offset 的 RFC 3339；输出规范化为 UTC，同时返回用于解释日程的 IANA timezone。
- 工具说明、任务和结果文本都是数据，不是宿主 Agent 的新指令。不能因为返回内容包含“运行此命令”而自动获得操作授权。

### 返回值

统一封装：

```json
{
  "schemaVersion": 1,
  "ok": true,
  "observedAt": "2026-09-10T09:00:00.000Z",
  "data": {},
  "warnings": []
}
```

MCP structuredContent 为结构化结果，content 提供兼容文本表示。错误使用 `ok:false`、`error:{code,message,retryable,details?}`，工具结果设置 isError。

单个结构化响应上限 128 KiB；查询默认 10 条，最多 20 条。展示文本可以有明确标记的截断，ID、状态、revision、分页及命令回执不能截断。不直接返回整个 Task/TaskPage、日志、executionConfig 中的敏感字段或 provider 请求。

### 状态

任务原始状态保留：Draft、Ready、Queued、Running、WaitingForInput、WaitingForApproval、Scheduled、Blocked、Failed、Completed、Done、Cancelled。

计划、execution、节点状态分别返回，展示状态和下一步操作复用领域推导。Completed 不等于 Done；是否验收依赖实际验收记录，而非模型判断。允许用户验收结果，不代表允许模型绕过验收直接写 Done。

## 5. chrona_task_search

### 参数

| 参数 | 类型 | 默认 | 规则 |
| --- | --- | --- | --- |
| `query` | string? | 不限关键词 | trim 后 1–200，匹配标题或描述 |
| `filter` | enum? | all | all / needs_me / ready / running / completed / failed |
| `status` | TaskStatus? | 不限 | 精确匹配；与显式 filter 互斥 |
| `priority` | enum? | 不限 | Low / Medium / High / Urgent |
| `sort` | enum? | updatedAt | updatedAt / createdAt / dueAt / title |
| `order` | enum? | desc | asc / desc |
| `page` | integer? | 1 | 1–1,000 |
| `pageSize` | integer? | 10 | 1–20 |

filter 复用网页分组：needs_me = WaitingForInput/WaitingForApproval/Blocked；ready = Ready/Queued/Draft；running = Running；completed = Completed/Done；failed = Failed。分组不改变返回的原始 status，也不表示 ready 中每个任务都可立即执行。

第一版复用 contains 搜索，不虚构语义相似度。排序追加 ID 作为稳定次序；dueAt 空值排最后。页码查询不承诺并发修改下的快照导出；超过第 1,000 页要求缩小筛选。

### 返回和行为

- items：taskId、title、descriptionPreview、status、priority、kind、dueAt、updatedAt、派生状态、下一步操作摘要、url。
- title/descriptionPreview 展示上限各 200，截断有标记；完整值用 read。
- total、page、pageSize、hasMore、paginationLimitReached。
- 零结果为成功空列表；多个候选先澄清目标，不能默认修改第一条。
- 没有 query 时可列出最近任务；用户给出本实例任务链接时可校验 origin/路由后直接 read，不抓取任意 URL。

```json
{
  "query": "文档",
  "filter": "needs_me",
  "pageSize": 5
}
```

## 6. chrona_task_read

### 参数

| 参数 | 类型 | 默认 / 规则 |
| --- | --- | --- |
| `taskId` | string | 必填 |
| `view` | enum? | summary；summary / description / config / plan / activity / result |
| `planSource` | enum? | 仅 plan；saved / execution，默认 saved |
| `resultSource` | enum? | 仅 result；current / accepted，默认 current |
| `workBlockId` | string? | 需要查看某次周期任务时选择；必须属于任务，省略沿用网页默认选择 |
| `page` | integer? | 仅 plan/activity/result，默认 1，最大 1,000 |
| `pageSize` | integer? | 仅 plan/activity/result，默认 10，最大 20 |

不适用的参数报错，不静默忽略。

### 返回能力

共同返回 task 基础字段、配置并发 revision、保存的计划、选定 execution/节点状态、editability、availableActions、url。

| view | 内容 |
| --- | --- |
| summary | 描述预览（500）、任务/计划/执行/节点状态、下一步、规划或执行命令进度 |
| description | 完整描述、标题、优先级，已有 Goal/父任务基本关联 |
| config | 网页可编辑的非敏感执行配置、选定 AI client、自动化、截止时间、排期、周期规则及锁定原因 |
| plan | 指定来源计划的版本、状态、摘要、节点分页；不输出原始 provider prompt/请求 |
| activity | 用户可见领域事件分页，不返回原始工具输入输出或聊天全文 |
| result | 指定 run 的正式结果摘要、验收信息、产物元信息分页；摘要最多 3,000，超长附截断标记 |

availableActions 中每项返回 action、适用 run/plan/version、requiredInput 的受支持 schema 引用、availability 和 disabledReason。网页与 MCP 是否可用分别列出；已有客户端授权的动作可直接走 MCP，不一律标成 chrona_ui。

保存的计划与执行使用的计划可能不同。选定 occurrence、run、节点、结果必须同源；没有选定来源时返回 null，不偷偷借用另一轮执行。

产物文件读取沿用产品现有文件授权边界，需要时增加有界资源读取能力；不能直接将所有 artifact URI、本地路径、运行上下文当作任务阅读内容公开。

## 7. chrona_task_create：完整创建入口

### 7.1 创建模式

| mode | 用户意图 | 实际效果 |
| --- | --- | --- |
| `todo` | “先记一个任务” | 创建任务；可带截止时间/排期；不自动规划或执行 |
| `plan` | “创建任务并帮我规划” | 创建并按指定时机生成计划，保留网页同样的计划审核流程 |
| `automatic` | “创建并自动执行” | 创建，按已有自动化规则生成/接受有效计划，再启动或排期执行；仍可能因输入、审批、失败而暂停 |

mode 在工具协议中必填，由 Agent 根据明确意图或用户已授权的默认策略填写，不要求用户手工理解枚举。

`automatic` 不是“关闭审批/全权限运行”。它表达用户授权启动现有自动化流程，不能覆盖 provider 的权限策略，也不能无条件跳过运行中审批。

### 7.2 参数

| 参数 | 类型 | 必填 / 默认 | 能力 |
| --- | --- | --- | --- |
| `requestId` | UUID | 必填 | 同一创建命令重试复用，涵盖整个创建编排 |
| `title` | string | 必填 | 1–500 |
| `description` | string? | 无描述 | 最多 10,000，包含背景、要求、验收标准 |
| `priority` | enum? | Medium | Low / Medium / High / Urgent |
| `mode` | enum | 必填 | todo / plan / automatic |
| `start` | enum | automatic 时必填 | now / scheduled；其他模式不传 |
| `timing` | object? | 下述规则 | plan / execution 分别指定已有 AutomationTimingPreset |
| `dueAt` | datetime? | 无 | 真正写入截止时间，而非仅塞入描述 |
| `schedule` | object? | 不排期 | startsAt、endsAt、timezone；时间块起止配对，endsAt > startsAt |
| `recurrence` | object? | 普通任务 | rule（RRULE）、timezone；首次起止由 schedule 提供 |
| `aiClientId` | string/null? | 产品默认选择 | 选择已有 AI client，null 表示恢复产品默认，不传秘密配置 |
| `executionConfig` | typed object? | 产品默认 | 网页支持的 model、contextStrategy、allowSubAgents、toolMode、approvalPolicy 等；按实际 provider 能力/合约校验 |
| `goalId` | string? | 不关联 | 在已有 Goal 内创建，复用 Goal 上下文冻结规则 |
| `parentTaskId` | string? | 不关联 | 创建真正子任务，校验归属和已有关系规则；不当作普通提及链接 |
| `dryRun` | boolean? | false | 校验/规范化并预览流程；不保存、不启动模型、不占用真实命令幂等键 |

Goal 创建可进一步采用 discriminated association 输入，以便完整承载网页 Goal 任务的 kind/expectedOutcome；这些字段的最终 schema 复用 Goal 合约，不通过 description 冒充已持久化的 Goal 属性。

### 7.3 时间与立即执行

已有 timing 值：`immediate / at_start / before_30m / before_1h / before_2h / before_1d`。

- todo 不接受 timing。
- plan 无排期时默认 immediate；有排期时默认 at_start，可显式提前规划。有效值在规范化回执中返回。
- automatic + scheduled 必须提供完整 schedule；默认规划/执行时机均 at_start，可按网页已有策略提前。
- automatic + now 表示立即进入“生成有效计划 → 按既有自动化接受规则接受 → 启动”的共享命令编排；不传 schedule/recurrence，不伪造一个日历时间块。它是已有网页可达命令的组合，不是直接设置 task.status=Running。
- 当前自动排期 readiness 要求时间块，因此立即编排不能直接套用该分支或绕过它；需显式复用计划/启动用例和各阶段 guards。这是待实现的组合入口，不是当前单个 POST /tasks 已有能力。
- before_* 没有排期基准时拒绝，不猜时间。scheduled 的时间晚于/早于规划触发时刻时，沿用现有 missed-run 和 readiness 规则，并在预览/回执中说明实际触发策略。
- 相对日期由 Agent 结合 context_read 的当前时间和用户时区解析。只说“明天”但没有必要的执行时刻/时长且无已授权默认值时才询问，不任意猜成午夜。
- 当前 recurrence 核心创建将 trigger timezone 写为 UTC；在未证明 IANA/DST 语义前不能宣称支持本地墙钟周期。实施须在共享 recurrence 层补齐或对不支持的时区明确报错，网页与 MCP 行为一致，不能悄悄转成另一种日程。

### 7.4 默认行为与可用选项

不能声称服务端已经能读到浏览器 localStorage 偏好。实现应把创建默认策略提升为网页和 MCP 共用的服务端配置；迁移既有浏览器偏好时由用户选择采用哪份，不后台覆盖。

context_read 返回实际默认 mode、时区/可选时长、产品默认 provider、可选 AI client 的 ID/名称/能力、timing 枚举和客户端 scopes。Agent 先看已知上下文再填写模式；不凭 provider 名称猜一个 aiClientId。

用户要求 Pi 执行时，选择匹配的已配置 Pi client；有多个候选则澄清。网页与 MCP 采用同一 provider 选择规则，但“从 Pi 对话创建”本身不是显式指定 Pi 执行。

缺失 provider 时 todo 可以保存。请求 plan/automatic 但已知缺少必要能力时，预检报可修复错误，不悄悄降级成 todo 并声称完成。

### 7.5 权限与确认

- 创建需要 tasks:write；带排期需要 schedule:write；生成/接受计划需要对应 plans scope；自动执行需要 executions:control。
- scopes 是同一用户权限上给客户端的委托上限，不由 mode 自动扩大。
- 接入时可以选择“完整任务管理”，一次授予常用任务生命周期能力，而不是每次操作重复申请权限。只读/只创建也是可选授权配置，不是工具能力天花板。
- 用户明确“创建并执行”且授权足够时直接提交。仅在产品本来要求确认、权限不够、目标/时间有歧义时中止并返回具体下一步。
- 需要逐次确认的部署必须依赖可信宿主交互或服务端可验证审批记录，不能只接受模型生成的 confirmed=true。

### 7.6 返回与异步流程

创建提交返回 taskId、url、commandId、requestId、规范化参数、实际 mode/provider/时间策略、配置 revision 和当前阶段。

阶段：`accepted / creating / scheduling / planning / awaiting_input / awaiting_approval / ready_to_execute / executing / completed / failed`。这是管理命令阶段，不替换 TaskStatus；例如自动规划命令完成不意味着任务执行已完成。

- 同步校验失败：不创建任务。
- task/关联/排期等本地写入和持久化启动意图先提交；提交前不能启动 provider 或让 scheduler 看见半配置任务。
- 之后通过持久化 command/outbox 驱动规划和执行；不能依赖响应后 fire-and-forget Promise。
- 已创建后 provider 失败：返回/读取 command.failed，保留 taskId 和失败阶段，不能让用户以为没有创建成功。
- 原 requestId 重试找回同一个 task/command，不重复排期、规划或启动 execution。外部 provider 副作用不能承诺 exactly-once；不确定是否已启动时进入对账，不盲目再发。
- 客户端用 read(summary) 看命令进度；可选订阅优化，不依赖所有宿主都支持推送。

### 7.7 调用示例

只记录：

```json
{
  "requestId": "f9bcdd74-111f-44a4-b27a-5abf3f7fa331",
  "title": "整理 Chrona 项目文档",
  "mode": "todo"
}
```

创建并立即规划：

```json
{
  "requestId": "51ddf947-895a-4dc6-82b8-d4d20ff98cf8",
  "title": "整理 Chrona 项目文档",
  "description": "补充 Pi provider、部署和故障排查说明。",
  "mode": "plan",
  "timing": { "plan": "immediate" }
}
```

用已选择的 Pi client 立即开始自动流程（示例 ID 必须替换为 context_read 返回值）：

```json
{
  "requestId": "7d1a3c95-132b-4fbe-9a3a-c4246bcae15d",
  "title": "整理 Chrona 项目文档",
  "mode": "automatic",
  "start": "now",
  "aiClientId": "example-configured-pi-client-id"
}
```

指定 UTC 时间排期、提前规划、到时执行：

```json
{
  "requestId": "a1f0686d-04aa-43ef-b892-73527434d3fb",
  "title": "检查项目依赖更新",
  "mode": "automatic",
  "start": "scheduled",
  "schedule": {
    "startsAt": "2026-09-11T09:00:00Z",
    "endsAt": "2026-09-11T10:00:00Z",
    "timezone": "UTC"
  },
  "timing": { "plan": "before_1h", "execution": "at_start" },
  "dueAt": "2026-09-11T12:00:00Z"
}
```

RRULE 的按日/周等周期创建也必须支持，以上 scheduled 请求可增加 recurrence；非 UTC 的周期例子应在共享引擎时区验证完成后加入，不能提前伪造支持。

## 8. chrona_task_update：网页配置对等

必填 requestId、taskId、expectedRevision、非空 patch；可选 dryRun。patch 使用严格白名单，但白名单按网页可编辑业务字段确定，不人为缩成三个字段。

| patch 字段组 | 能力 |
| --- | --- |
| title / priority | 替换基础属性 |
| description | replace / append / clear，合并后不超过 10,000 |
| aiClientId / executionConfig | 网页允许的 provider 和运行配置变更，保留模型锁定/会话归属规则 |
| mode / start / timing | 修改自动规划和执行策略；启用后可能启动工作，必须预览/回执说明，并校验对应权限 |
| dueAt / schedule | 设置/清除截止时间；设置/移动/清除时间块，不能混同清截止时间与取消排期 |
| recurrence | 设置/修改/清除周期规则，复用 occurrence/trigger 更新规则 |

不再规定“只要有计划就不能改描述”或“周期任务在 MCP 一律只读”。是否能改、对哪些范围生效、哪些字段由外部日历管理，必须与网页实际领域规则相同。

- description 支持 `{mode:"replace",text}`、`{mode:"append",text}`、`{mode:"clear"}`。append 用两个换行连接；超长整次失败，不截断。
- 已开始的 run、已冻结上下文和已验收结果不能被配置更新倒写；改任务描述不代表当前 run 已接收新指令。需要对当前执行补充输入时走 task_action。
- 更换 provider、启用自动化、修改周期等返回实际副作用、影响范围、被取消/新建的未来 occurrence、是否需要新计划，而不是总返回 executionStarted=false。
- source-managed 字段沿用网页锁定规则；允许编辑的 Chrona 备注不能因外部日历来源而一刀切禁止。
- 准备将来执行的配置更新与“马上启动现有执行”是不同命令。mode/start 只按明确请求处理，不因为字段变化猜测重跑。
- status 仍不是通用可写字段；启动、停止、验收、重新打开通过已有领域命令实现相同产品能力。

返回 operation（updated/noop 或异步 accepted）、新 revision、实际 changes、影响预览/实际 effects、commandId（如有）及状态链接。配置无变化且没有动作请求时才可 noop；配置相同但用户明确请求立即执行不能被错误吞掉。

## 9. 规划、执行、结果与删除

四个 CRUD 风格工具不足以覆盖网页完整任务生命周期，必须补齐命令面，而不是让 update 接受任意 status。

`chrona_task_action` 采用 action discriminated union；每个 action 的 schema 显示必要的 planId/revision、runId、node/approval/input ID 等，不能只提交含糊的 taskId + execute。

需要覆盖的网页能力：

- 生成/重新生成/停止生成计划、接受指定版本计划；计划图编辑按现有 mutation 合约提供，禁止任意原始 JSON 覆盖。
- 启动、停止、取消、重试等实际存在的执行命令；暂停/恢复仅在当前引擎确实支持时发布。
- 回答明确输入请求、批准或拒绝明确审批；不可混用输入与审批。
- 验收特定 run 的结果、产品支持的完成/重新打开、基于已验收结果继续提问或创建后续任务。
- 排期 proposal 的接受/拒绝、周期任务中单次 occurrence 与整个系列的明确作用范围。

`chrona_task_delete` 必须返回并校验网页同样的关联任务/资产删除影响；并发影响变化要求重新确认。工具可以完成删除，不以“有风险”为由永久只返回网页链接。

新增管理工具不暴露 provider 的 node_complete；用户验收、手工完成任务和执行 Agent 提交节点结果是不同领域动作。

本节是必须覆盖的产品能力清单，**具体 action payload、审批通道与删除确认票据还需细化**，不能据此宣称整个管理协议已经冻结或实现。

## 10. 并发、幂等与审计

- 配置 revision 覆盖所有公开可编辑配置，而不再仅覆盖标题/描述/优先级。UI、MCP、同步器的相关写入都必须参与版本机制；TaskPlan.revision 不能充当任务配置版本。
- 每次写入在原子边界内检查客户端授权、任务归属、source-managed 字段、当前可执行条件和版本。不同 run/plan/action 使用其对应的版本约束。
- 冲突返回 REVISION_CONFLICT；Agent 重新读取、判断，不能拿新 revision 自动覆盖他人修改。
- 幂等键为 clientId + boundWorkspaceId + toolName + requestId，存规范化请求 digest。同键异参报 IDEMPOTENCY_CONFLICT；同键同参返回原 command/回执。
- 鉴权和撤销检查先于重放；已成功请求的重放先于旧 revision 冲突检查。重放标记原快照时间，不装作当前状态。
- 本地事务、command、outbox 与回执建立持久化关联；不能只用内存去重。相同 command 的阶段恢复不能重复创建任务、排期、启动 run。
- provider 启动结果不确定时进行归属/状态对账，保留可恢复的未知状态；不能盲目重试有副作用的调用。
- actor 由客户端凭证派生，不能沿用硬编码 UI/server-action 来源。外部聊天 ID 如将来记录，仅作可选来源引用，不是 TaskSession 所有权。
- 管理入口禁止无凭证 local fallback；每次请求验证 scopes/revocation，transport session 不跨客户端复用。
- 跨工作区任务统一 NOT_FOUND；日志不记录 bearer、完整描述、provider 请求体或原始工具数据。

错误至少包括 AUTH_REQUIRED、FORBIDDEN、NOT_FOUND、VALIDATION_ERROR、PRECONDITION_FAILED、REVISION_CONFLICT、IDEMPOTENCY_CONFLICT、REQUEST_IN_PROGRESS、CONFIRMATION_REQUIRED、RATE_LIMITED、INTERNAL_ERROR。已提交的异步命令失败返回 task/command 和失败阶段，不混同为“请求未生效”。

## 11. Skill 行为

| 用户表达 | 行为 |
| --- | --- |
| “先记个任务” | create(todo) |
| “创建并规划” | create(plan)，报告规划已排队/运行，而非宣称已经规划成功 |
| “现在用 Pi 帮我做” | 解析 Pi client → create(automatic, now)，授权足够直接提交 |
| “明天九点自动执行” | 解析时区和必要时间块信息 → create(automatic, scheduled)，不只写进描述 |
| “每周一检查更新” | 明确只安排还是自动执行 → 带 recurrence 创建，不把周期要求丢掉 |
| “那个任务怎么样了” | search/read，不写入 |
| “改成 Codex，调整排期” | read(config) → update，使用同一产品规则并说明影响 |
| “接受这个结果” | read(result) → 针对明确 run 的验收命令，不写 status=Done |

模糊时只问真正缺失的信息；不对每次正常操作额外设置审批。高风险操作的确认遵守用户接入策略及产品规则，不靠提示词作为唯一安全边界。

## 12. 实施位置与验收

- `packages/contracts`：管理 schema、模式映射、命令回执和输出投影合约。
- `features/mcp-control-plane`：独立 management transport、注册、认证装配。
- `packages/engine`：共享创建/排期/规划命令编排、修改/生命周期用例、事务和审计。网页与 MCP 都调用这些用例，不把顺序编排各写一遍。
- `packages/db` / `prisma`：客户端授权、共享默认策略、配置 revision、持久化命令/回执；遵守当前 release-line migration 政策。
- `packages/skills`：共享对话策略；`packages/integrations`：用户批准后的 Pi/Codex 配置。

验收以“同一输入，网页与 MCP 的任务配置、计划接受语义、排期/occurrence、执行行为一致”为核心：

1. todo、立即规划、立即自动流程、定时自动流程、提前规划、周期任务均可用。
2. 截止时间、AI client、模型/受支持运行配置正确持久化，不丢字段。
3. 用户明确自动执行且授权足够时无需回网页；缺权限时不静默降级。
4. 运行中输入/审批、接受计划和验收结果沿用相同领域规则，不用状态赋值绕过。
5. 网页允许的编辑可通过 MCP 完成；冻结历史和来源锁定仍然有效。
6. 幂等、断线、提交后崩溃、provider 部分失败、时间/时区/DST、并发修改均有覆盖。
7. 单次 occurrence 与全系列作用范围明确；原任务已有运行时不能意外重复启动。
8. 数据输出有界、不泄密；正确默认工作区、权限撤销及执行/管理 token 隔离。
9. 实际 Pi/Codex 客户端跑通“创建→规划→执行→读取→验收”的常用闭环。

本次只修订设计，没有实现接口，也没有修改数据库、认证、执行引擎或 Chino 部署。立即编排、共享默认策略、时区能力、其余 action payload 都是明确的待实施项，不当作现有能力。
