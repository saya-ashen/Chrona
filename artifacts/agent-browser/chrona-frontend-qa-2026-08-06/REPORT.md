# Chrona 前端常见操作与 agent-browser 实测报告

测试日期：2026-08-06
测试方式：`agent-browser` 真实浏览器交互（无 Playwright 替代）
测试地址：`http://localhost:43100`
测试语言：先测中文路由 `/zh`，并验证了语言切换到 `/en`。
测试数据：所有临时任务均使用 `AB-20260806-` 前缀；临时基础任务、目标任务和 AI client 已删除。目标 `AB-20260806-目标：完成前端 QA` 因目标本身没有删除入口，已通过“停止追求”归档为“已停止”。

## 结论摘要

Chrona 的核心信息架构和主要 CRUD 流程可用：Dashboard、Schedule、Tasks、Goals、Action Center、Settings 均可以打开；创建/编辑/删除任务、创建带首任务的 Goal、Goal 内添加任务、Goal 暂停/恢复/停止、日程视图切换、日历 URL 校验、设置开关、AI client 创建/编辑/启用切换/删除均完成了真实 UI 操作。

当前版本不适合直接作为“无缺陷”的用户验收版本。最需要优先修复的是：

1. 日程页选择某一天后点击“安排任务”，新建任务弹窗仍默认使用当前系统日（实测为 8 月 6 日），而不是用户正在查看的 8 月 7 日，可能把任务保存到错误日期。
2. 任务列表中每行的“更多操作”鼠标点击不会打开菜单；键盘 `Space` 可以打开。同一菜单中的“标记完成”可以被展示给没有完成运行结果的任务，但服务端返回 400，前端没有错误提示。
3. 没有可用 Hermes/provider 时，“Generate plan”进入长期准备状态；停止生成的请求最终成功，但 UI 直到刷新页面才恢复，用户会误以为页面卡死。
4. 中文界面存在大量英文泄漏，尤其是 Task Workspace、Schedule 详情、外部日历、Action Center、Goal Workbench、AI client dialog。部分字符串甚至直接显示内部 key `common.close`。
5. axe 扫描在多个页面持续发现严重的颜色对比度问题；Schedule/Goals 还出现 ARIA 结构或属性错误。

本轮确认的问题共 6 类：2 个高优先级功能/数据风险，2 个中高优先级交互/错误反馈问题，1 个中优先级本地化问题，1 个中高优先级无障碍问题。provider 未配置导致的流程无法完成属于测试环境前置条件限制；但该状态下的超时/恢复表现属于产品问题。

## 测试覆盖范围

### 全局壳、导航与语言

代码依据：`apps/web/src/router.tsx`、`apps/web/src/app-shell.tsx`、`features/mcp-control-plane`、`features/assistant-surface`。

| 操作 | 结果 | 说明 |
| --- | --- | --- |
| 根路径 `/` 重定向到默认语言 | ✅ 可用 | 自动进入 `/zh`，再由 landing page 进入 Dashboard。 |
| Dashboard / Schedule / Goals / Tasks / Action Center / Settings 导航 | ✅ 可用 | 主导航和页面路由均可到达。 |
| 中文切换英文、英文切换中文 | ✅ 可用 | locale 路由切换正常；业务数据标题保持原始输入语言。 |
| 全局“新建任务” | ✅ 可用 | 从 Dashboard、Schedule 等页面都能打开任务创建弹窗。 |
| “连接 AI”入口 | ⚠️ 入口可用，provider 未配置时无法完成 | 能进入 Settings / AI clients；本地 Hermes 不可用时无法完成真实连接。 |
| 全局 AI 下拉菜单 | ⏸ 未能测试 | 页面显示按钮但处于 disabled，当前运行状态没有可用 AI client。 |

截图：[01-dashboard.png](screenshots/01-dashboard.png)。

### Dashboard

代码依据：`features/dashboard`、`apps/web/src/pages.tsx`。

| 操作 | 结果 | 说明 |
| --- | --- | --- |
| 查看概览、统计和任务入口 | ✅ 可用 | Dashboard 成功加载，测试任务创建后也会出现在列表/入口中。 |
| 点击“查看并审批”“打开任务” | ✅ 可用 | 可进入对应任务路由。 |
| 从 Dashboard 新建任务 | ✅ 可用 | 任务创建后 Dashboard 立即出现新任务链接。 |
| 空状态三步引导 | ✅ 可用 | 能看到连接 AI、记录任务、确认计划等引导。 |

基线 axe：Dashboard 有 1 个 violation，主要是 `color-contrast`，另有 `aria-prohibited-attr` 和对比度人工复核项。

### Task 创建

代码依据：`features/schedule/ui/dialogs/task-create-dialog.tsx`、`features/schedule/ui/forms/task-config-form-*`、`features/task-workspace`。

| 操作 | 结果 | 说明 |
| --- | --- | --- |
| 创建普通 Task | ✅ 可用 | 标题、描述、优先级填写后保存成功，服务端 `POST /api/tasks` 返回 201。 |
| 保存为任务 | ✅ 可用 | 不生成计划，保存后任务进入可规划状态。 |
| 协助规划 | ✅ 入口可用 | 会显示 Generate plan；需要可用 provider 才能完成后续。 |
| 按日程自动运行 | ⚠️ 表单可用，日期默认值有严重问题 | 可显示日期、开始/结束时间、重复、自动化策略；在 8 月 7 日页面打开时，弹窗默认日期仍为 8 月 6 日，见 F-01。 |
| Task / Goal 产品模式 | ✅ 入口可用 | 创建弹窗存在 Task / Goal 单选切换；Goal 创建实际走独立 Goal 流程验证。 |
| 优先级 Low / Medium / High / Urgent | ✅ 可用 | 中文显示为低/中/高/紧急；编辑任务时切换 Medium 成功持久化。 |
| 标题/描述必填校验 | ✅ 可用 | 空标题时保存按钮保持 disabled。 |
| 重复：每天/每周/每月/自定义 RRULE | ✅ 入口可用 | 自定义输入框会显示；未保存测试数据。 |
| 自动化策略、执行模型和 provider 选择 | ✅ 入口可用 | UI 控件可见；provider 不可用时没有完成执行验证。 |

截图：[02-create-task-dialog.png](screenshots/02-create-task-dialog.png)、[12-schedule-create-wrong-default-day.png](screenshots/12-schedule-create-wrong-default-day.png)。

### Task 列表

代码依据：`features/task-management`、`apps/web/src/loaders.ts`、`features/task-workspace`。

| 操作 | 结果 | 说明 |
| --- | --- | --- |
| 查看全部/需要我处理/可执行/运行中/已完成/失败统计 | ✅ 可用 | 统计按钮和列表加载正常。 |
| 状态视图：待处理/进行中/结果/全部任务 | ✅ 可用 | 可切换。 |
| 按标题/描述搜索 | ✅ 可用但需要提交 | 输入后必须按 `Enter` 才会触发过滤；仅输入并等待不会过滤，界面没有明显“按 Enter 搜索”提示。 |
| 清除搜索 | ✅ 可用 | 等待网络更新后恢复完整列表；快速操作中曾出现短暂旧列表，建议增加明确 loading/刷新状态。 |
| 优先级过滤 | ✅ 可用 | 选择“中”后只显示匹配项。 |
| 排序方式和升/降序 | ✅ 入口可用 | 下拉和升降序控件存在，未对全部组合逐一核验排序值。 |
| 选择当前可见任务/逐行选择 | ✅ 可用 | 选择后出现清空选择和批量删除。 |
| 批量删除 | ✅ 入口可用，未删除用户现有任务 | 选择状态和删除按钮正确出现；临时任务最终通过任务工作区删除。 |
| 每行更多操作 | ❌ 鼠标路径失败，键盘可用 | 鼠标点击按钮后 `aria-expanded` 仍为 false；聚焦后按 `Space` 可以打开菜单。见 F-02。 |

截图：[05-task-list.png](screenshots/05-task-list.png)、[06-task-search-not-filtering.png](screenshots/06-task-search-not-filtering.png)、[07-clear-search-stale-list.png](screenshots/07-clear-search-stale-list.png)、[08-task-row-actions-keyboard-only.png](screenshots/08-task-row-actions-keyboard-only.png)。

### Task Workspace

代码依据：`features/task-workspace/ui/task-workspace-page.tsx`、`features/task-workspace/ui/task-workspace-operation-panel.tsx`、`features/task-workspace/ui/task-workspace-header-card.tsx`、`features/task-workspace/ui/task-workspace-result-lifecycle-panel.tsx`。

| 操作 | 结果 | 说明 |
| --- | --- | --- |
| 打开 standalone Task | ✅ 可用 | 任务详情、Task brief、计划区域、操作入口都能加载。 |
| 打开 Goal-owned Task inspector | ✅ 可用 | Goal 工作区中的“打开任务”能进入带“所属目标”导航的 Task Workspace。 |
| 编辑任务标题/描述/优先级/日程 | ✅ 可用但保存后当前 header 不立即更新 | `PATCH /api/tasks/:id` 和 schedule 更新均返回 200；关闭编辑器并重新进入/刷新后列表显示新值。 |
| 生成计划 | ⚠️ 在可用 provider 下应进入计划审查；本环境进入长时间 preparing | 提交 command 返回 202，provider 不可用时长期停留，见 F-04。 |
| 停止生成 | ⚠️ 后端成功，前端恢复延迟 | `POST .../plan/generations/stop` 返回 `stopped:true`，UI 直到刷新才恢复。 |
| 查看/接受生成计划 | ⏸ 未完成 | 没有可用 provider，无法取得真实计划。 |
| 开始/暂停/停止/重试运行 | ⏸ 未完成 | 需要已接受计划和 provider。UI 的状态约束已在 Workspace 中可见。 |
| 结果查看/接受结果/follow-up | ⏸ 未完成 | 需要 completed run/result。 |
| 标记完成 | ❌ UI 无条件展示，操作静默失败 | 对没有 completed run 的任务点击“标记完成”，请求返回 400：`Only tasks with a completed run can be marked done.` 页面没有 toast、alert 或 inline error，见 F-03。 |
| 删除任务 | ✅ 可用 | 删除流程显示影响预览，确认“永久删除”后跳转回 Schedule；临时任务已用此流程清理。 |
| Goal asset rebuild | ⚠️ 入口可见 | Goal-owned task 显示 “Rebuild with latest Goal assets”；本次无资产版本，未执行破坏性替换。 |

截图：[03-task-workspace-mixed-language.png](screenshots/03-task-workspace-mixed-language.png)、[04-edit-task-dialog-saved-or-stuck.png](screenshots/04-edit-task-dialog-saved-or-stuck.png)、[09-mark-complete-fails-silently.png](screenshots/09-mark-complete-fails-silently.png)、[19-plan-generation-stuck.png](screenshots/19-plan-generation-stuck.png)。

### Schedule

代码依据：`features/schedule`、`features/schedule/ui/dialogs/task-create-dialog.tsx`、`features/external-calendar`。

| 操作 | 结果 | 说明 |
| --- | --- | --- |
| 前一天/后一天/今天/日期选择 | ✅ 可用 | URL 的 `day` 参数和标题会同步变化。 |
| 时间轴视图 | ✅ 可用 | 时间块、拖放区域、Resize 按钮可见。 |
| 议程视图 | ✅ 可用 | URL 增加 `view=list`，页面显示“当日议程”。 |
| 点击任务时间块查看详情 | ✅ 可用 | 可切换任务详情/执行状态/当前计划。 |
| 从 Schedule 安排任务 | ⚠️ 入口可用，但默认日期错误 | 见 F-01。 |
| 待安排/需要关注 | ✅ 可用 | 两个队列 tab 能切换。 |
| 日历 tab | ✅ 可用 | 打开外部日历管理面板。 |
| 连接外部日历 | ⚠️ 校验可用，真实连接未完成 | Display name、Calendar URL、同步策略、自动化策略都可填；非法 URL 会显示校验错误并阻止有效连接。 |
| 日历 URL 校验 | ✅ 可用 | `POST /calendar-sources/validate` 返回后显示校验错误。 |
| 已连接日历刷新/启用/禁用/重命名/删除 | ⏸ 未完成 | 需要安全的 fixture URL 或外部订阅；源码和已有 E2E 覆盖这些入口。 |

截图：[10-schedule-timeline.png](screenshots/10-schedule-timeline.png)、[11-schedule-agenda-toggle-no-effect.png](screenshots/11-schedule-agenda-toggle-no-effect.png)、[12-schedule-create-wrong-default-day.png](screenshots/12-schedule-create-wrong-default-day.png)、[13-calendar-invalid-url-no-feedback.png](screenshots/13-calendar-invalid-url-no-feedback.png)。

### Goals

代码依据：`features/goals`、`features/goals/ui/goal-list-page.tsx`、`features/goals/ui/goal-workspace-page.tsx`、`features/goals/ui/goal-asset-workbench.tsx`。

| 操作 | 结果 | 说明 |
| --- | --- | --- |
| 创建空 Goal | ✅ 表单校验入口可用 | Goal 标题和第一项任务均为创建复合流程的关键字段。 |
| 创建 Goal + 第一项 bounded Task | ✅ 可用 | 成功创建 Goal 与首任务并进入 Goal Workspace。 |
| 初始 AI review | ⚠️ 可回退 | provider 不可用时显示“审核 AI 初始规划 / 复盘生成失败”，有重试和取消；取消后 Goal 仍保留。 |
| Goal 概览/工作/工作台/成功标准/历史 tab | ✅ 可用 | 均可切换。 |
| Goal 工作区添加任务 | ✅ 可用 | 标题、任务说明、预期产出填写后创建并进入新 Task Workspace。 |
| Goal 成功标准 review/确认提案 | ✅ 可用但文案容易误解 | “Confirm criterion” 请求成功，实际把 proposal 标为 confirmed；“已确认 0/1”表示满足/证据确认数，仍为 0，这是模型语义而非请求失败。 |
| Goal 工作台资产搜索/类型过滤/收件箱/归档 tab | ✅ 入口可用 | 当前 Goal 没有资产，显示空状态；未构造真实 artifact 做资产版本化操作。 |
| Goal 暂停/恢复 | ✅ 可用 | 实际执行了暂停和恢复，按钮状态正确改变。 |
| Goal 停止追求 | ✅ 可用 | 为清理测试数据实际执行，目标变为“已停止”。 |
| Goal 复盘重试 | ⏸ provider 限制 | 初始 review 已观察到失败状态，但未重复触发多次。 |

截图：[16-goals-list.png](screenshots/16-goals-list.png)、[17-goal-creation-ai-review-stuck.png](screenshots/17-goal-creation-ai-review-stuck.png)。

### Action Center

代码依据：`features/action-center/ui/action-center-list.tsx`、`features/action-center/ui/action-center-page-client.tsx`。

| 操作 | 结果 | 说明 |
| --- | --- | --- |
| 查看全部行动队列 | ✅ 可用 | 紧急优先级、等待输入等分组正确显示。 |
| 类型过滤：全部/输入/审批/结果/恢复 | ✅ 可用 | `aria-pressed` 会随选择变化；当前数据混合分组，筛选后建议以卡片数量进一步验收。 |
| 文本搜索 | ✅ 可用 | 输入 `Review` 后只显示匹配的审批事项。 |
| 排序 | ✅ 入口可用 | 最新优先下拉可打开；其他排序值未全部核验。 |
| 批准/拒绝 | ⚠️ 入口可用，未改变现有用户行动数据 | 测试数据来自 demo task；本次避免批准/拒绝用户已有事项。 |
| 编辑并批准 | ⚠️ 入口可见 | 在 provider/任务状态未准备好时按钮会进入 disabled/loading；没有继续提交编辑。 |
| 等待输入接受/拒绝建议 | ⚠️ 入口可见 | 未改变 seeded action。 |
| 打开任务/打开日程 | ✅ 可用 | 入口链接正确到对应 locale 路由。 |

截图：[18-action-center.png](screenshots/18-action-center.png)。

### Settings 与 AI Clients

代码依据：`apps/web/src/pages.tsx`、`apps/web/src/components/settings/schedule-ai-settings-panel.tsx`、`features/ai-clients/ui`。

| 操作 | 结果 | 说明 |
| --- | --- | --- |
| AI 任务标题建议、保存后自动生成计划、默认自动执行开关 | ✅ 可用 | 均实际切换过，并恢复到测试前的值。 |
| 打开 AI client 管理弹窗 | ✅ 可用 | 弹窗居中、无横向滚动。 |
| 添加 AI client | ✅ 可用 | 实际创建 Hermes client，随后清理；首个 client 自动成为默认 client。 |
| provider 类型下拉 | ✅ 可用 | Claude Code/Codex/Oh My Pi/Debug Provider/Hermes 均可见。 |
| Hermes 本机/远程位置、Advanced settings | ✅ 入口可用 | 可进入；未写入真实 secret。 |
| 编辑 client 名称 | ✅ 可用 | 实际 PATCH 成功，列表显示新名称。 |
| 启用/禁用 client | ✅ 可用 | 实际切换两次并恢复 enabled。 |
| 测试可用性 | ⚠️ 未能完成真实 provider 检查 | 本机 Hermes 不可用；UI 能显示“未测试/需要关注”。 |
| 删除 client | ✅ 可用 | 实际 DELETE 返回 200，列表移除 client。 |
| 诊断 Hermes/自动配置/重启 gateway | ⏸ 未执行 | 可能安装或重启本机 runtime，超出本轮无破坏性浏览器验收范围。 |

截图：[14-settings-toggles.png](screenshots/14-settings-toggles.png)、[15-ai-client-created.png](screenshots/15-ai-client-created.png)。

## 问题清单与复现步骤

### F-01 — Schedule 的“安排任务”使用错误日期（高）

现象：在 `/zh/schedule?day=2026-08-07`，页面标题为“8月7日周五”；点击“安排任务”并选择“按日程自动运行”后，创建弹窗日期显示 `Aug 6, 2026`。

复现：

1. 打开 Schedule 并导航到 2026-08-07。
2. 点击“安排任务”。
3. 选择“按日程自动运行”。
4. 查看日期字段；[12-schedule-create-wrong-default-day.png](screenshots/12-schedule-create-wrong-default-day.png) 显示页面选中 8 月 7 日，但弹窗默认 8 月 6 日。

影响：不手工修正时任务会落在错误日期。创建弹窗应接收 `selectedDay` 并以它初始化日期。

### F-02 — Task 列表行操作鼠标打不开菜单（高）

现象：对“更多操作”执行普通鼠标 click 后，`aria-expanded` 仍为 `false`，菜单未出现；聚焦同一按钮后按 `Space` 可以打开。

复现：

1. 打开 `/zh/tasks`。
2. 在任意任务行点击右侧更多操作按钮。
3. 菜单不出现。
4. 用键盘 Tab 聚焦该按钮并按 Space，菜单出现；打开后的菜单见 [08-task-row-actions-keyboard-only.png](screenshots/08-task-row-actions-keyboard-only.png)。

影响：鼠标用户无法访问编辑、删除、标记完成等行级操作；建议检查任务卡/行父级 click handler、事件冒泡和 DropdownMenu trigger 的 pointer event。

### F-03 — 标记完成失败后前端静默（中高）

现象：没有 completed run 的任务仍显示“标记完成”。点击后前端没有反馈；网络响应为 400：`Only tasks with a completed run can be marked done.`

复现：

1. 创建或打开一个没有执行结果的 Task。
2. 打开行级更多操作并选择“标记完成”。
3. 页面保持原状态且无 alert/toast；[09-mark-complete-fails-silently.png](screenshots/09-mark-complete-fails-silently.png) 是操作后的画面。

影响：应按 `runStatus` 隐藏/禁用该操作并解释原因，或捕获 API 错误显示明确提示。

### F-04 — 无 provider 时 Generate plan 长时间停留 preparing（中高）

现象：点击 Generate plan 后 command 返回 202，页面进入 “Chrona is preparing a reviewable plan”；等待超过 5 秒仍没有错误或完成状态。停止请求最终返回 `stopped:true`，但 UI 直到刷新才恢复。

复现：

1. 打开没有可用 Hermes provider 的 Task Workspace。
2. 点击 Generate plan。
3. 等待 5–15 秒，见 [19-plan-generation-stuck.png](screenshots/19-plan-generation-stuck.png)。
4. 点击 Stop generation；若 UI 不恢复，刷新页面才重新显示可生成状态。

影响：无 provider 是可预期配置状态，不能让用户看到无限进行中的假象。应在 provider readiness 已知不可用时阻止请求，或为命令超时/失败提供确定性错误和恢复按钮。

### F-05 — 中文路由大量英文和未解析 key（中）

现象示例：

- Task Workspace 出现 `Generate a plan`、`Task brief`、`You can create a plan now`、`More task actions`。
- Schedule 出现 `Edit task`、`Delete task`、`Medium`、`Review and approve a plan`。
- 外部日历出现 `Connect external calendar`、`Display name`、`Calendar URL`。
- Action Center 出现 `Provide input`、`Approvals`、`Review AI draft before sending`。
- AI client 弹窗关闭按钮直接显示 `common.close`。
- Goal Workbench 出现中英文混用的知识/资产文案。

截图：[03-task-workspace-mixed-language.png](screenshots/03-task-workspace-mixed-language.png)、[10-schedule-timeline.png](screenshots/10-schedule-timeline.png)、[13-calendar-invalid-url-no-feedback.png](screenshots/13-calendar-invalid-url-no-feedback.png)、[15-ai-client-created.png](screenshots/15-ai-client-created.png)、[18-action-center.png](screenshots/18-action-center.png)。

影响：中文用户会把英文视为未完成或不一致的界面，`common.close` 还暴露内部 i18n key。建议检查 `task-workspace-messages.ts`、external-calendar copy、Action Center copy、AI clients dialog 是否传入正确 locale dictionary。

### F-06 — 无障碍扫描有重复严重问题（中高）

本轮使用 agent-browser 内置 axe-core 4.12.1：

- Dashboard：1 个 violation，主要为 `color-contrast`，另有 `aria-prohibited-attr` incomplete。
- Task Workspace / Task list：持续出现 `color-contrast` 和 `aria-prohibited-attr` incomplete。
- Schedule：出现 critical `aria-valid-attr-value` 和 critical `aria-required-children`（`.overflow-x-auto`），另有对比度问题。
- Goals：出现 critical `aria-required-children`（`.overflow-x-auto`）。
- Settings：1 个 violation，14 个颜色对比度节点，另有 `aria-prohibited-attr`。
- Action Center：出现 critical `aria-required-children`（`.overflow-x-auto`）。

另外，AI client 列表启用 checkbox 在 accessibility snapshot 中没有可读名称，只显示为无 label 的 checkbox。建议将 axe 扫描纳入 CI，并优先修复 critical ARIA 结构，再统一检查 muted text 对比度、tablist/overflow 容器和表单控件 label。

## 运行与性能观察

Dashboard 基线 `agent-browser vitals --json`：FCP 约 2516 ms，LCP 约 2696 ms，CLS 约 0.11，TTFB 约 4.8 ms。TTFB 很好，但 CLS 0.11 已高于常见“良好”阈值 0.1；建议为 Dashboard 引导/统计卡片和任务列表预留稳定高度或 skeleton。

## 第一轮未完成的 provider/数据依赖流程

以下内容是第一轮没有可用 provider 时未完成的部分；第二轮已使用真实 OMP 完成了任务计划、执行、结果接受和 follow-up 主流程。仍需 Artifact、checkpoint 或较长运行时间才能完成的项目已在第二轮附录中单独列出：

- 生成计划 → 审查计划 → 编辑/接受计划。
- 接受计划 → 启动执行 → 暂停/停止/重试节点。
- provider waiting-for-user / approval / blocked / failed recovery。
- completed result → 接受结果 → follow-up ask / follow-up create task。
- promote accepted result to Goal。
- Goal assets 的 draft、submit、restore、archive、inbox extract/resolve、asset modification task。
- 外部日历真实订阅导入，以及连接后 disable/enable/refresh/rename/remove。
- Hermes diagnose、自动配置和 gateway restart。

仓库已有对应的 Playwright E2E 场景，可作为后续真实 provider/fixture 环境中的补充：`e2e/specs/task-lifecycle-execution.spec.ts`、`e2e/specs/ai-client-settings-flow.spec.ts`、`e2e/specs/external-calendar-management.spec.ts`、`e2e/specs/recurring-task-lifecycle.spec.ts`、`e2e/specs/schedule-proposal-decision.spec.ts`。

## 建议修复顺序

1. 修复 F-01 日期传递和 F-02 鼠标菜单触发，这两项会直接阻断或改变用户操作。
2. 修复 F-03 的非法完成操作：前端状态约束 + 可见错误反馈。
3. 修复 F-04 的 provider readiness、超时、停止后的 UI revalidation。
4. 补齐中文字典并禁止 key fallback 直接呈现给用户。
5. 修复 critical ARIA 和颜色对比度；将 axe gate 加入前端验收。
6. 在真实 OMP 环境中用较长任务和 calendar fixture 重跑完整生命周期：`create → plan → accept → start → pause/approve → result → accept result → follow-up → delete/promote`。

## 第二轮附录：Oh My Pi（OMP）默认配置实测

本轮按要求没有 mock provider，直接在 Settings → AI Clients 中选择 `Oh My Pi`，只填写名称，保留所有默认配置。测试使用的 client 名称为“OMP 默认 Provider（前端实测）”。

### OMP 配置结果

| 操作 | 结果 | 说明 |
| --- | --- | --- |
| 选择 Oh My Pi provider | ✅ 可用 | UI provider 下拉中可选择 Oh My Pi。 |
| 使用默认配置创建 client | ✅ 可用 | 未填写 Model、OMP Base URL、OMP API Key、HOME、PI_CONFIG_DIR、PI_CODING_AGENT_DIR 等覆盖项。 |
| 测试可用性 | ✅ 可用 | 真实健康检查显示 `Ready`、`可用`、`Oh My Pi SDK package loaded`。 |
| 保存为默认 client | ✅ 可用 | 首个 client 自动成为默认，列表显示 `omp`、`default`。 |
| 保存后再次测试 | ✅ 可用 | 对保存后的 client 重新点击“测试可用性”仍显示 provider 健康检查通过。 |
| 配置页重新加载后的 readiness 状态 | ⚠️ 状态显示会重置 | 重新打开 Settings 后 client 实际仍可运行，但 UI 又显示“未测试/Needs attention”；再次测试即可恢复 Ready。建议持久化或重新加载时自动读取 readiness。 |

截图：[20-omp-provider-ready.png](screenshots/20-omp-provider-ready.png)。本轮保留 OMP client，没有删除，因为它是本次后续真实执行测试所使用的 provider。

### OMP 真实任务生命周期

测试任务标题为 `AB-OMP-20260806-安全生命周期测试`，任务内容明确限制为只读 README.md、不修改仓库、不执行破坏性命令、不访问外部网络。

| 操作组合 | 结果 | 说明 |
| --- | --- | --- |
| 创建 Task → 打开 Workspace | ✅ 可用 | 任务成功创建并进入 Workspace。 |
| Generate plan | ✅ 最终可用，但首屏反馈慢 | OMP 实际生成了 3 步计划；计划生成耗时约 48.8 秒。点击后前 10 秒仍显示 preparing，刷新后显示 waiting for acceptance。 |
| 查看计划步骤 | ✅ 可用 | 可切换 Steps / Flow，点击单个步骤会显示 objective、summary、mode、executor、estimate。 |
| 展开/收起计划 brief | ✅ 可用 | “Use compact brief / Show full brief” 可切换。 |
| Request changes 表单 | ✅ 可用 | 可选择整个计划或指定步骤，填写修订说明；空说明时提交按钮 disabled。 |
| Accept plan | ✅ 可用 | 计划从 draft 变为 accepted，Workspace 显示 Accepted plan 和 Start。 |
| Start execution | ✅ 可用 | 真实启动 OMP 执行，页面显示当前节点、执行进度、Activity 和 Agent transcript。 |
| OMP 多步骤执行 | ✅ 可用 | 3 个节点最终完成，3/3 steps，最终结果可审核。期间有一次 Runtime tool failed，但 OMP 随后完成了节点并产生最终结果；建议后续确认该失败是否属于预期重试。 |
| Pause / Stop | ⏸ 未能形成有效结论 | OMP 任务很快完成，看到 Pause/Stop 后尝试操作时执行已进入下一个节点或已结束，无法稳定捕获暂停窗口。需要更长任务或人工 checkpoint 再测。 |
| 查看最终结果 | ✅ 可用 | 结果展示标题、核心工作环节、来源摘要和执行 transcript。 |
| 结果节点过滤 | ✅ 可用 | 可选择全部节点、阅读 README.md、提取摘要要点、输出中文摘要。 |
| 结果全部展开/收起 | ✅ 可用 | Result options 菜单中的全部展开/全部收起有效。 |
| 打开 Agent transcript | ✅ 可用但关闭有遮挡问题 | transcript 内容完整显示 planning、provider run、node started/completed、result finalization 等事件；Close 按钮被标题层覆盖，鼠标点击失败，按 Escape 可关闭。 |
| Request changes → 重新运行最后一步 | ⚠️ 请求已提交但状态同步不稳定 | `retry_node` command 返回 202，但等待后执行状态仍为 completed；刷新后结果状态一度重新显示待审核，需要再次接受结果。见 F-08。 |
| Accept result | ✅ 可用 | 真实结果接受后页面显示“结果已接受”，按钮变为追问结果/创建下一项任务。 |
| Follow-up ask | ✅ 可用 | 使用 OMP source session 真实回答问题；返回“Chrona 仍处于 alpha 阶段，仅支持 Bun，尚未达到生产就绪状态”。 |
| Follow-up create task | ✅ 可用 | 使用 `handoff_compact` 创建下一项任务，约 38 秒后返回 completed，并创建了新的 Draft Task。随后已通过 UI 删除该临时任务。 |
| Follow-up task 打开/删除 | ✅ 可用 | 新建 Draft Task 能在任务列表中看到并打开，删除确认预览和永久删除均成功。 |
| Promote result to Goal | ⏸ 未出现入口 | 当前结果没有交付文件/Artifact，源码条件要求存在 accepted result 且 `artifacts.length > 0` 才显示 Promote to Goal；本次无法构造该前置条件。 |
| Completed Task 的 Reopen | ❌ 当前 UI 未提供 | 任务列表中 completed Task 的菜单显示“开始执行/标记完成”但均 disabled，没有 Reopen；虽然 API 文档存在 reopen endpoint，当前前端没有可用入口。 |

截图：[21-omp-task-ready-to-plan.png](screenshots/21-omp-task-ready-to-plan.png)、[22-omp-generated-plan-review.png](screenshots/22-omp-generated-plan-review.png)、[23-omp-plan-accepted.png](screenshots/23-omp-plan-accepted.png)、[24-omp-execution-running.png](screenshots/24-omp-execution-running.png)、[25-omp-result-ready.png](screenshots/25-omp-result-ready.png)、[26-omp-request-changes.png](screenshots/26-omp-request-changes.png)、[27-omp-result-accepted.png](screenshots/27-omp-result-accepted.png)、[28-omp-follow-up-question.png](screenshots/28-omp-follow-up-question.png)、[29-omp-create-follow-up-task.png](screenshots/29-omp-create-follow-up-task.png)。

### 第二轮新增问题

#### F-07 — OMP client 的 readiness 状态重新打开后回到“未测试”（中）

1. 选择 Oh My Pi，使用默认配置。
2. 在编辑弹窗点击测试可用性，显示 `Ready / 可用 / Oh My Pi SDK package loaded`，见 [20-omp-provider-ready.png](screenshots/20-omp-provider-ready.png)。
3. 保存 client，关闭并重新打开 AI client 管理弹窗。
4. client 仍是默认且实际可执行，但 UI 又显示“未测试/Needs attention”。

影响：用户会误以为默认 OMP 不可用，必须重复手动健康检查。建议区分“尚未检查”和“上次检查通过”，或者打开页面时执行轻量 readiness 读取。

#### F-08 — Request changes / follow-up 后结果生命周期 UI 与持久状态短暂不一致（中高）

现象：真实 OMP 任务已执行完成并接受结果后，Request changes 提交的 `retry_node` command 返回 202，但执行状态保持 completed；刷新后结果又短暂显示待审核。之后 Accept result 可以再次返回 200 并恢复“结果已接受”。Follow-up create task 请求完成后，重新加载源任务也曾再次看到“结果待审核”，尽管 API 的 `result/follow-up` 明确显示源 run 已 accepted，且创建后续任务返回 `status: completed`。

证据：

- `retry_node` 请求：`POST /api/work/:taskId/commands`，响应 202。
- follow-up create task：`POST /api/tasks/:taskId/result/follow-up`，响应 200，返回 `createdTask.id` 和 `status: completed`。
- 刷新后需要再次点击 Accept result，页面才恢复“结果已接受”。

影响：用户可能重复接受结果或误认为结果生命周期被回退。应让 loader、SSE/read-model 和 result review projection 使用同一 accepted-run 状态，并在 mutation 完成后显式 revalidate。

#### F-09 — Agent transcript Close 按钮被标题层覆盖（中）

现象：打开“Agent transcript”并展开事件后，snapshot 能看到 Close，但 agent-browser 鼠标点击返回 `covered by <h2#...>`；按 Escape 才能关闭。

影响：真实鼠标用户可能无法关闭 transcript。应检查 Dialog header 的 z-index、pointer-events 和关闭按钮层级，并增加键盘焦点回归测试。

#### F-10 — 执行页面产生大量重复 React key 错误（中高）

真实 OMP 执行期间浏览器 console 反复输出：`Encountered two children with the same key, cmsgzculy003e1hfuwjpx8ms4`，本轮重复次数超过 100 次。页面表面仍完成，但 React 官方明确不保证重复 key 下的列表身份和更新行为。

建议定位 Activity/Agent transcript/节点列表中使用同一 ID 的渲染路径；执行过程中应保证每个兄弟节点的 key 唯一，并把 console error 作为 E2E 失败条件。

## 第二轮结论

默认 OMP provider 在当前机器上确实可用，且完成了真实的：

`create task → generate plan → review plan → request changes form → accept plan → start execution → 3-node OMP execution → inspect result → accept result → follow-up ask → follow-up create task → delete follow-up`

其中 Generate plan、follow-up ask 和 follow-up create task 都有明显的 provider 处理延迟，但最终能够完成。剩余未闭环的主要流程是：带 Artifact 的 Promote to Goal、稳定可观测的 Pause/Stop、Retry last step 的一致性，以及重新打开后的 accepted result 状态稳定性。

下一轮建议准备一个包含人工 checkpoint、较长执行时间和真实 Artifact 输出的 OMP 任务，专门验证：

`start → pause → resume → checkpoint approval → stop/retry → result artifact → accept result → promote to Goal`。

## 修复进度：第一批实施结果

已开始根据问题清单修复产品代码，当前状态和每次验证记录见 [FIX_TASKS.md](FIX_TASKS.md)。本轮已完成或部分完成：

- F-01：Schedule 快速创建弹窗使用当前 `viewModel.activeGroup.date`，不再固定取系统今天；已用 agent-browser 在 `?day=2026-08-07` 实测显示 `Aug 7, 2026`。
- F-02：TaskActionsMenu 改为受控 open 状态并显式处理 click；已用 agent-browser 实测鼠标点击能够打开行级菜单，并新增 Vitest 鼠标回归测试。
- F-03：Task 列表只有存在 completed run 时才允许“标记完成”；非法状态不再向后端发送必然失败的请求，并保留 action error 展示。
- F-04（部分）：计划生成期间增加 5 秒 plan-state 兜底轮询；停止成功后立即把本地 generation session 标记为 cancelled，停止失败则恢复 running 并保留错误。
- F-06（部分）：Action Center filter buttons 补充 `role="tab"` / `aria-selected`；AI client enabled checkbox 增加带 client 名称的 `aria-label`。
- F-07：AI client 健康检查结果使用带 24 小时有效期的 localStorage UI cache；保存配置、删除或启用状态变化时会清除缓存。已用 agent-browser 测试 OMP 健康检查后刷新页面仍保持 `Ready`。
- F-09：Sheet 通用关闭按钮增加 `z-20`，避免被带 `z-10` 的 SheetHeader 覆盖。
- F-10（部分）：ActivityTimeline 对重复底层 activity key 做稳定的 occurrence 消歧，避免 React duplicate-key 错误；console error E2E gate 尚未加入。

验证结果：

- Vitest 修复相关集合：8 个测试文件、55 个测试通过。
- `bun run typecheck:app`：通过。
- 修改文件 primary LSP diagnostics：0。
- ESLint：0 errors；仅有若干原有的复杂度和文件长度 warning。
- 真实 agent-browser 复测：F-01、F-02、F-07 已通过；截图 [30-fix-omp-readiness-persists.png](screenshots/30-fix-omp-readiness-persists.png)。

仍待处理：F-04 provider readiness 前置检查、F-05 中文 fallback、F-06 Schedule/Goals axe critical 与对比度、F-08 accepted result 状态回退、console error gate，以及需要专用长任务/Artifact fixture 的 Pause/Stop/Promote to Goal。
