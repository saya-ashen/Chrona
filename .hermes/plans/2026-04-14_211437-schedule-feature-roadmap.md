# Schedule 页面功能增强实施规划

> For Hermes: planning only. Do not implement from this document without a separate execution step.

**Goal:** 把当前 `/schedule` 从“可查看的日程雏形”升级为“任务驱动的计划与调度 cockpit”，先补齐基础排程体验，再接入 AI 辅助创建/拆解/自动执行/提醒能力。

**Architecture:** 保持 `/schedule` 为唯一前台入口，继续复用现有任务命令能力：`createTaskFromSchedule`、`applySchedule`、`proposeSchedule`、`generateTaskPlan`、`startRun`。前端新增更强的时间轴交互与 command bar；后端新增“自然语言解析 -> 计划草案 -> 用户确认 -> 落库”和“到点执行/提醒”的调度能力。避免把逻辑重新塞回 `schedule-page.tsx`，而是继续拆到 `src/components/schedule/*`、`src/modules/queries/get-schedule-page.ts`、`src/modules/commands/*`。

**Current grounded context:**
- `src/components/schedule/schedule-page.tsx` 已经负责顶层 orchestration、projection refresh、拖放调度、创建 block、保存 task config。
- `src/components/schedule/schedule-page-timeline.tsx` 已支持：
  - queue item 拖到时间轴
  - scheduled item drag start
  - 点击时间轴打开 block composer
  - timeline inline create composer
- 但仍缺关键能力：
  - 已排程 block 的真正“拖动改期/重排”与 resize
  - 更快的 quick create 入口
  - 更完整的 UI 反馈与高级操作流
- 已有 server actions / commands：
  - `createTaskFromSchedule`, `applySchedule`, `proposeSchedule`, `generateTaskPlan`, `startRun`
- `generateTaskPlan` 当前仍是 mock/placeholder 逻辑，适合作为“智能细化”的落点，但需要升级。
- 当前没有成型的 reminder/notification 基础设施；自动执行可复用 `startRun`，提醒需要新增调度与投递层。

---

## 一、产品目标拆分

### P0：基础排程体验可用
让用户可以像真正的日历一样：
1. 快速创建任务
2. 把任务拖入时间轴
3. 直接移动已排程任务
4. 调整 block 时长
5. 清楚看到风险/冲突/空档

### P1：AI 辅助规划可用
让用户可以：
1. 用自然语言一句话创建任务/日程
2. 让 Agent 自动把大任务拆成可执行子任务/阶段
3. 让 Agent 给出今天/本周的排程建议

### P2：调度自动化可用
让系统可以：
1. 到点自动开始可执行任务
2. 在冲突/超期/即将开始时提醒用户
3. 在执行失败或阻塞时回流到 schedule 页面作为风险

---

## 二、推荐实现顺序

推荐严格按 5 个里程碑推进，避免一口气做完导致模型、调度、UI 一起失控。

### Milestone 1：补齐时间轴基础交互
目标：把 schedule 变成“真能排”的页面。

#### 1.1 已排程 block 拖动改期
现状：
- `DayTimeline` 已支持 `onScheduledDragStart`
- 但需要确保 scheduled item 拖回时间轴时会真正更新 `scheduledStartAt/scheduledEndAt`
- 要补视觉反馈、drop target、drag ghost、一致的 optimistic update

实现建议：
- 在 `src/components/schedule/schedule-page-timeline.tsx`
  - 把 scheduled block 组件抽成 `TimelineBlockCard`
  - block 上统一接 `draggable`
  - 拖动时区分来源：`queue` vs `scheduled`
  - drop 后统一走 `onScheduleDrop(item, startAt, endAt)`
- 在 `src/components/schedule/schedule-page.tsx`
  - `handleScheduleDrop` 统一支持两类：
    - queue -> `applySchedule` 到 task
    - scheduled -> `applySchedule` 更新已有时间段
  - 做本地 optimistic patch，避免每次都等 projection roundtrip 才变
- 在 `src/components/schedule/schedule-page-utils.ts`
  - 新增 `moveScheduledItem(...)`
  - 新增 `normalizeDropWindow(...)`
  - 新增 `detectDropCollision(...)`

验收标准：
- 已排程 block 可以拖到新时间
- 拖完后 UI 立即更新，再 refresh 校正
- 冲突时有明确提示，不是静默失败

#### 1.2 block resize（延长/缩短时长）
这是基础功能中最重要但现在缺失的一块。

实现建议：
- 为 scheduled block 增加顶部/底部 resize handle
- 鼠标拖动 handle 时只改 `endAt`（第一版先只做尾部 resize，复杂度低）
- 走同一个 `applySchedule` server action
- `schedule-page-utils.ts` 新增：
  - `resizeScheduledWindow(startAt, endAt, nextEndMinute)`
  - `clampBlockDuration(...)`
- 第一版限制：
  - 最小时长 15/30 分钟
  - 不支持跨天 resize

验收标准：
- 用户可以把 block 拉长/缩短
- 时间轴高度、文本标签、summary 同步变化

#### 1.3 快速创建任务
现状已有 timeline composer，但还不够“快”。

建议补两个入口：
1. 页面顶部 command bar 的 quick create
2. 每天时间轴顶部的轻量 inline quick-add

实现方式：
- 新建 `src/components/schedule/schedule-command-bar.tsx`
  - 输入：标题、时间提示、优先级（默认）
  - 默认走 `createTaskFromSchedule`
  - 如果附带了时间，则紧接着调 `applySchedule`
- 在 `src/components/schedule/schedule-page.tsx`
  - 顶部引入 command bar
  - 成功后 refreshProjection
- timeline composer 继续保留，但更适合“点选空档后创建”

验收标准：
- 用户在 1 个输入框内就能完成“今天下午 3 点做 xx”类创建
- 无需展开完整 `TaskConfigForm` 才能创建简单任务

#### 1.4 UI/交互优化
建议一起做，不然功能有了但体验还是“工具感太重”。

建议点：
- 周条增加 today/selected/overloaded 三种清晰状态
- 时间轴 block 增强视觉编码：priority、runnable、at risk、pending proposal
- queue 卡片增加“推荐拖到最近空档”按钮
- 空日视图增加 CTA
- drag 时显示吸附线与时间浮标
- timeline 滚动区域增加“当前时间线”

涉及文件：
- `src/components/schedule/schedule-page-timeline.tsx`
- `src/components/schedule/schedule-page-panels.tsx`
- `src/components/schedule/schedule-page-copy.ts`

---

### Milestone 2：自然语言创建任务
目标：让用户不用手动填表，也能高效创建任务和日程。

#### 2.1 先做“受控解析”，不要一上来直接自动落库
推荐流程：
1. 用户输入自然语言
2. 后端解析成结构化 draft
3. 前端展示确认卡片
4. 用户确认后再调用 `createTaskFromSchedule` / `applySchedule`

不要直接让模型写数据库，否则错误成本太高。

#### 2.2 新增 command：`parseScheduleIntent`
建议新增：
- `src/modules/commands/parse-schedule-intent.ts`

输入：
- `workspaceId`
- `text`
- `selectedDay?`
- `timezone?`
- `referenceNow`

输出建议结构：
- `title`
- `description`
- `priority`
- `dueAt`
- `scheduledStartAt`
- `scheduledEndAt`
- `runtimeAdapterKey?`
- `confidence`
- `ambiguities: string[]`
- `needsConfirmation: boolean`

前端：
- `src/components/schedule/schedule-command-bar.tsx`
  - 自然语言模式下先显示 parse result card
  - 用户确认后再执行 create/apply

第一版可支持的句式：
- “明天下午三点写答辩提纲”
- “今天晚上 8 点到 9 点 跑实验”
- “本周四前完成文献综述，安排 2 小时”

#### 2.3 处理歧义与失败
- 如果解析不出时间：只创建 unscheduled task
- 如果只有 due 没有 block：创建任务 + 给出“建议安排到最近空档”按钮
- 如果解析出多个时间解释：前端展示 2-3 个候选

验收标准：
- 至少覆盖 70% 的常见中文简单日程表达
- 错误情况下可安全回退到草稿确认，不直接污染日程

---

### Milestone 3：任务智能细化
目标：把“一个大任务”变成“可排程、可执行、可推进”的子步骤。

#### 3.1 升级 `generateTaskPlan`
现状：
- `src/modules/commands/generate-task-plan.ts` 只是 mock payload

建议改为两层：
1. `generateTaskPlan` 生成结构化 plan
2. `proposeTaskBreakdown` 把 plan 转成 schedule-ready 子任务建议

建议结构：
- summary
- milestones[]
- steps[]
- estimatedMinutes
- dependencies[]
- suggestedExecutionMode (manual/agent/approval-heavy)
- suggestedScheduleWindows[]

#### 3.2 schedule 页面新增“智能拆解”面板
入口位置：
- queue card 展开态
- selected block sheet
- 顶部 command bar（对选中任务操作）

新组件建议：
- `src/components/schedule/schedule-task-refinement-panel.tsx`

交互：
1. 点“智能细化”
2. 调 `generateTaskPlan`
3. 返回结构化 plan + 推荐 block
4. 用户选择：
   - 仅保存计划
   - 创建 follow-up tasks
   - 自动生成 schedule proposals

#### 3.3 细化后的落库策略
推荐不要第一版就自动创建大量真实子任务。
第一版建议：
- 先生成 `proposal`/`draft` 层
- 用户点确认后才真正：
  - `createFollowUpTask`
  - `proposeSchedule`

为什么：
- 降低 AI 误拆解对主任务树的污染
- 更容易做撤销和 review

验收标准：
- 大任务可以被拆成 3-8 个可执行步骤
- 用户能一键把 plan 转为 follow-up tasks 或 schedule proposals

---

### Milestone 4：自动执行
目标：让 schedule 不只是看板，而是真正的“任务发车台”。

#### 4.1 引入 execution policy
需要给 task 增加执行策略，否则无法安全自动运行。

建议新增字段（可先存在 task config / runtimeConfig 中，后续再 schema 固化）：
- `executionPolicy.mode`: `manual | suggest | auto`
- `executionPolicy.autoStart`: boolean
- `executionPolicy.requireApprovalBeforeStart`: boolean
- `executionPolicy.maxAutoRetries`: number

前端入口：
- `TaskConfigForm`
- `SelectedBlockSheet`
- queue/scheduled card 的高级设置

#### 4.2 到点启动 worker
自动执行不应该由页面本身触发，必须由后端调度器负责。

建议新增：
- `src/modules/scheduler/run-scheduled-tasks.ts`
- `src/modules/scheduler/list-runnable-scheduled-tasks.ts`
- `src/app/api/internal/scheduler/run-due-tasks/route.ts` 或 cron 入口

流程：
1. 定时扫描“已经到开始时间、尚未运行、executionPolicy=auto、isRunnable=true”的任务
2. 调 `startRun({ taskId, prompt? })`
3. 写事件：`task.auto_started`
4. 刷新 projection

第一版保护条件：
- 只启动 ownerType=agent 的任务
- 只启动 runnabilityState=ready 的任务
- 若已有 active run 则跳过
- 若任务在最近 N 分钟被用户改动则跳过

#### 4.3 自动执行与 schedule UI 联动
- schedule 卡片显示：
  - Auto
  - Waiting for slot
  - Running
  - Blocked
  - Needs approval
- 今天视图显示“即将自动开始”的队列

验收标准：
- 到点任务能被自动启动
- 不会重复启动
- 失败和阻塞会回流到风险面板

---

### Milestone 5：提醒与通知
目标：让 schedule 真正承担“提醒中枢”职责。

#### 5.1 先定义 reminder domain
建议新增：
- `taskReminder` 表，或先以 event + job 的形式实现

建议字段：
- `taskId`
- `kind`: `before_start | overdue | blocked | proposal_pending`
- `offsetMinutes`
- `channel`: `in_app | email | telegram | webhook`
- `status`
- `lastSentAt`

#### 5.2 第一版先做 in-app reminder
不要第一步就上外部消息通道。

第一版能力：
- schedule 页面顶部 reminder rail
- 若任务 10 分钟后开始但未准备好，显示提醒
- 若任务已过开始时间还没启动，显示 overdue reminder
- 若 proposal 挂起太久，显示 review reminder

可能文件：
- `src/modules/queries/get-schedule-page.ts`
- `src/components/schedule/schedule-reminder-rail.tsx`
- `src/components/schedule/schedule-page-types.ts`

#### 5.3 再扩展外部通知
第二阶段再接：
- email
- Telegram/Discord
- webhook

这部分需要独立通知层，不建议和 schedule 页面首批重构绑死。

验收标准：
- schedule 首页能看到所有未处理提醒
- reminder 与 risk/proposal 不混淆，但可交叉跳转

---

## 三、建议的前端结构演进

继续保持 `schedule-page.tsx` 只做 orchestration，新增这些组件：

### 建议新增组件
- `src/components/schedule/schedule-command-bar.tsx`
  - quick create
  - natural language create
  - selected-task quick actions
- `src/components/schedule/timeline-block-card.tsx`
  - scheduled block 渲染
  - drag / resize handle
- `src/components/schedule/timeline-drop-indicator.tsx`
  - 吸附线、hover 时间提示、collision 提示
- `src/components/schedule/schedule-task-refinement-panel.tsx`
  - 智能细化结果
- `src/components/schedule/schedule-reminder-rail.tsx`
  - 到点提醒 / overdue / proposal pending
- `src/components/schedule/schedule-automation-panel.tsx`
  - 自动执行策略展示与切换

### 建议继续拆 utils
当前 `schedule-page-utils.ts` 已偏大，建议拆成：
- `src/components/schedule/schedule-date-utils.ts`
- `src/components/schedule/schedule-timeline-utils.ts`
- `src/components/schedule/schedule-planning-utils.ts`
- `src/components/schedule/schedule-ai-utils.ts`

---

## 四、建议的数据与后端改造

### 4.1 扩展 schedule projection
`getSchedulePage()` 未来应额外返回：
- `reminders`
- `automationSummary`
- `upcomingAutoRuns`
- `scheduleIntakeSuggestions`
- `refinementDrafts`（如果需要）

涉及文件：
- `src/modules/queries/get-schedule-page.ts`
- `src/components/schedule/schedule-page-types.ts`
- `src/app/api/schedule/projection/route.ts`

### 4.2 新增 commands / services
建议新增：
- `src/modules/commands/parse-schedule-intent.ts`
- `src/modules/commands/generate-task-breakdown.ts`
- `src/modules/commands/apply-task-breakdown.ts`
- `src/modules/scheduler/run-scheduled-tasks.ts`
- `src/modules/scheduler/build-reminders.ts`

### 4.3 复用已有 commands
优先复用已有：
- 创建：`createTaskFromSchedule`
- 排程：`applySchedule`
- AI 提议排程：`proposeSchedule`
- 智能计划：`generateTaskPlan`（但要升级）
- 自动开始：`startRun`

---

## 五、建议的分阶段交付顺序

### Phase A：2-4 天
基础可用性
- scheduled block 拖动改期
- 单端 resize
- 顶部 quick create command bar
- timeline UI polish
- schedule 侧 targeted tests

### Phase B：3-5 天
自然语言创建
- parse intent command
- confirm draft UI
- NL -> create/apply 流程
- 歧义处理

### Phase C：3-5 天
任务智能细化
- 升级 generateTaskPlan
- refinement panel
- create follow-up tasks / schedule proposals

### Phase D：3-4 天
自动执行
- execution policy
- due task worker
- auto-start safeguards
- schedule UI status

### Phase E：2-4 天
提醒
- in-app reminder rail
- overdue / before_start / proposal pending
- reminder summary in projection

---

## 六、测试与验证策略

### 前端
重点测试文件建议：
- `src/components/schedule/schedule-page-utils.test.ts`
- `src/components/schedule/schedule-command-bar.test.tsx`
- `src/components/schedule/schedule-page-timeline.test.tsx`
- `src/components/schedule/schedule-task-refinement-panel.test.tsx`

重点覆盖：
- drag minute snapping
- resize clamping
- collision detection
- NL parse draft rendering
- quick create submit payload

### 后端
重点测试：
- `src/modules/queries/__tests__/get-schedule-page*.test.ts`
- 新 commands 的 bun tests
- scheduler worker idempotency tests

重点覆盖：
- parse intent 输出规范化
- auto-start 只触发一次
- reminder 生成不会重复发
- proposal / refinement draft 的确认流

### 编译验证
- `bun vitest run <targeted files>`
- `bunx tsc -p tsconfig.json --noEmit --pretty false`
  - 如全仓库仍有旧错，继续过滤 schedule import chain 看本次改动是否 clean

---

## 七、最大风险与规避方案

### 风险 1：自然语言直接落库导致脏数据
规避：
- 必须先 parse draft，再确认
- 低置信度只创建 unscheduled task

### 风险 2：自动执行误触发
规避：
- 只对 `auto + runnable + no active run + ownerType=agent` 生效
- 增加 execution policy 显式开关
- worker 幂等检查

### 风险 3：AI 细化生成大量低质量子任务
规避：
- 第一版先生成 draft/proposal，不直接建真实子任务
- 用户确认后才 apply

### 风险 4：前端交互复杂度过快膨胀
规避：
- timeline block/card/drop-indicator 独立组件化
- `schedule-page.tsx` 不再承载细节 UI

---

## 八、我建议你现在立刻开始的第一批具体事项

如果下一步要开始实现，我建议先只做下面 4 件事：

1. 做已排程 block 的拖动改期
2. 做 block resize（先只做尾部）
3. 做 schedule 顶部 quick create command bar
4. 做 `schedule-page-utils.ts` 中的 collision / snapping / optimistic helpers

原因：
- 这是最直接提升页面“基础可用性”的部分
- 做完后 schedule 才配得上继续叠加 NL / AI / automation
- 这些改动几乎都能局限在 schedule import chain 内，不会扩散到 work 页面

---

## 九、涉及文件清单（优先级排序）

高优先级：
- `src/components/schedule/schedule-page.tsx`
- `src/components/schedule/schedule-page-timeline.tsx`
- `src/components/schedule/schedule-page-panels.tsx`
- `src/components/schedule/schedule-page-types.ts`
- `src/components/schedule/schedule-page-copy.ts`
- `src/components/schedule/schedule-page-utils.ts`
- `src/modules/queries/get-schedule-page.ts`
- `src/app/api/schedule/projection/route.ts`
- `src/app/actions/task-actions.ts`

中优先级：
- `src/modules/commands/generate-task-plan.ts`
- `src/modules/commands/propose-schedule.ts`
- `src/modules/commands/start-run.ts`
- `src/modules/commands/create-follow-up-task.ts`

新增文件建议：
- `src/components/schedule/schedule-command-bar.tsx`
- `src/components/schedule/timeline-block-card.tsx`
- `src/components/schedule/timeline-drop-indicator.tsx`
- `src/components/schedule/schedule-task-refinement-panel.tsx`
- `src/components/schedule/schedule-reminder-rail.tsx`
- `src/modules/commands/parse-schedule-intent.ts`
- `src/modules/commands/generate-task-breakdown.ts`
- `src/modules/commands/apply-task-breakdown.ts`
- `src/modules/scheduler/run-scheduled-tasks.ts`
- `src/modules/scheduler/build-reminders.ts`

---

## 十、结论

这次 schedule 的优化不应该被理解成“补几个按钮”，而应该按三层来做：
1. 日历交互层：拖动、resize、快速创建、视觉反馈
2. AI 规划层：自然语言创建、任务细化、AI proposal
3. 自动调度层：auto-run、reminder、risk 回流

最合理的落地路径是：
- 先把基础排程交互做扎实
- 再做自然语言输入与智能细化
- 最后接自动执行与提醒

这样能保证每一层都建立在前一层已经可用、可验证的基础上。