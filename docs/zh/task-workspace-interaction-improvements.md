# 任务工作区交互优化方案

## 目标

让 Chrona 的核心链路从“功能可用”变成“操作顺手”：用户创建任务后，能持续知道自己处在哪一步、下一步该做什么、当前操作会影响什么、结果最终沉淀在哪里。

当前底层能力已经覆盖任务、计划、执行、审批、结果与恢复。主要缺口在交互解释层：状态存在，但用户需要自己理解；操作存在，但缺少预览、差异、确认和后续动作归类。

本文只定义产品与实现方案，不要求立即改数据库。第一阶段优先使用现有 task、plan、execution、projection、artifact、timeline 数据。

## 设计原则

1. **Chrona 解释状态，AI 只产内容**  
   AI 可以生成 plan、result、follow-up 建议；Chrona 必须拥有任务状态、执行状态、审批、结果归属和可执行动作。

2. **每个阶段只有一个主动作**  
   用户始终看到一个最明显的 primary action：生成计划、接受计划、开始执行、提交输入、批准、重试、审查结果、标记完成。

3. **修改前预览，修改后看差异**  
   AI 修改 task brief、plan、result 前后都应有可审查 diff，不应静默替换。

4. **执行前要可预期，执行中要可干预，执行后要可收尾**  
   对应 Run Preview、Execution Cockpit、Result Review。

5. **后续对话必须绑定动作类型**  
   用户一句话可能是提问、更新结果、重跑步骤、修改计划或创建后续任务。Chrona 需要让用户选择语义，避免普通 chat 改变产品状态。

## 当前链路与主要痛点

```text
Create Task -> Generate Plan -> Review/Edit Plan -> Accept Plan -> Execute -> Handle Stops -> Review Result -> Follow-up Conversation
```

痛点：

- 创建 task 后不知道信息是否足够。
- 生成 plan 前缺少计划风格、执行模式、输出类型选择。
- Graph 能显示结构，但不能快速回答“这个计划是否值得接受”。
- AI 修改 plan 后缺少清楚的 added / changed / removed diff。
- Start / Continue 执行前缺少运行预览。
- 执行中缺少固定驾驶舱：当前节点、目标、进度、下一次暂停点、可干预动作。
- Waiting / Approval 更像状态提示，不像用户可快速处理的决策卡。
- 执行完成后缺少明确 Result Review 和 Done 收尾。
- 后续对话缺少动作归类，用户不知道一句话会不会改变 plan/result/run。

---

## 优化 1：Task Readiness Panel

### 解决什么

创建 task 后，用户不知道是否可以直接生成 plan，也不知道缺哪些信息会影响 plan 质量。

### 交互内容

任务工作区顶部显示“Ready to plan?” 检查卡：

```text
Ready to plan?
✓ Title exists
✓ Description exists
! Missing success criteria
! No output format specified
! No schedule/due date
✓ Provider configured

Primary: Generate plan
Secondary: Improve task brief
```

### 最佳实现方案

- 在前端 model 层新增纯函数：`deriveTaskPlanningReadiness(task, availableAiClients, featureBindings)`。
- 输入使用现有 task detail、AI client binding、execution runtime、schedule 字段。
- 输出 read model：

```ts
type TaskPlanningReadiness = {
  status: "ready" | "warning" | "blocked";
  checks: Array<{
    id: string;
    label: string;
    state: "passed" | "missing" | "warning" | "blocked";
    helperText?: string;
  }>;
  primaryAction: "generate_plan" | "complete_brief" | "configure_provider";
};
```

- UI 放在 `TaskWorkspaceHeaderCard` 或 header 下方的轻量 expandable panel。
- `Improve task brief` 第一版只打开编辑区并给出提示，不自动改数据。
- 后续可接 AI brief 改写，但必须用 diff 审查。

### 不建议

- 不要把 readiness 做成硬校验。缺 success criteria 也可以生成 plan，只是给 warning。
- 不要一开始新增 schema。

---

## 优化 2：Plan Intent Presets

### 解决什么

“Generate plan” 过于抽象。用户需要告诉 Chrona 计划风格、风险容忍度和输出形态，但自由文本 instruction 太重。

### 交互内容

生成计划前提供轻量 presets：

```text
Plan style
[Fast] [Careful] [Research-heavy] [Implementation-heavy]

Execution mode
[Manual review] [Ask before risky steps] [Auto where safe]

Expected output
[Summary] [Files] [Report] [Checklist] [PR/Patch]
```

保留自由文本：

```text
Extra instruction: ...
```

### 最佳实现方案

- presets 存在前端 view state，提交 plan generation 时转换为 `userInstruction` 的结构化前缀。
- 短期不改 API：继续用 `POST /api/tasks/:taskId/plan/generations` 的 `userInstruction`。
- 中期在 contracts 中增加明确字段：

```ts
type PlanGenerationPreferences = {
  style?: "fast" | "careful" | "research_heavy" | "implementation_heavy";
  executionMode?: "manual_review" | "ask_before_risky" | "auto_where_safe";
  outputType?: "summary" | "files" | "report" | "checklist" | "patch";
  extraInstruction?: string;
};
```

### 不建议

- 不要一开始做复杂模板市场。
- 不要让 provider-specific 选项进入产品 UI。

---

## 优化 3：Plan Review Summary

### 解决什么

Graph 表达结构很好，但用户审查 plan 时需要先看摘要和风险，而不是逐个节点读。

### 交互内容

Graph 上方增加 Plan Review Summary：

```text
Plan review
8 steps · 3 AI steps · 2 checkpoints · 1 risky operation · ~45 min

Will produce:
- Market research table
- Ranking summary
- Follow-up recommendations

Needs you:
- Approve source list
- Confirm final ranking criteria

Potential risks:
- Uses web search
- May produce long output
```

### 最佳实现方案

- 在前端 `compiledPlanToGraphPlan` / `taskPlanReadModelToGraphPlan` 后新增 summary derive helper。
- 不依赖 AI 二次总结，先从 graph nodes 推导：
  - node count
  - executor count
  - checkpoint count
  - estimated minutes
  - nodes with `requiresHumanInput`
  - nodes with risky metadata / write-like action / external integration hint
  - nodes with result/output intent
- UI 放在 `TaskWorkspacePlanContent` 的 graph header 和 graph panel 之间。

### 不建议

- 不要把 Plan Review Summary 存 DB。它是可重建 view model。
- 不要用长段 AI summary 替代结构化信息。

---

## 优化 4：Plan Diff Review

### 解决什么

用户请求 AI 修改 plan 后，需要知道 AI 改了什么。否则会产生“不敢接受”的感觉。

### 交互内容

AI revision 完成后显示：

```text
Plan changes
+ Added checkpoint: Confirm source list
~ Changed step 3 executor: auto -> manual
~ Changed step 5 objective
- Removed duplicate summary step

[Apply changes] [Reject] [Ask for another revision]
```

### 最佳实现方案

- Plan revision 不直接覆盖当前 accepted/review plan；先保存为 proposed graph patch。
- 如果现有 plan patch API 已可表达 add/update/delete/reorder，复用它生成 diff read model。
- 前端新增 `PlanChangePreview`：按 node 和 edge 变化分组。
- 最小版本：对 revision 前后的 graph 做稳定 ID 对比：
  - 新 ID = added
  - 缺失 ID = removed
  - 同 ID fields changed = changed
  - order/dependencies changed = rewired
- Apply 后才调用现有 plan patch/accept 逻辑。

### 不建议

- 不要让 AI 用自然语言解释“我改了什么”作为唯一依据。
- 不要静默应用 revision。

---

## 优化 5：Selected Node Quick Actions

### 解决什么

现在选中节点能看到详情，但用户真正想做的是对这个节点操作。

### 交互内容

选中 graph node 后，在节点详情卡显示快捷动作：

```text
Selected step
[Rewrite this step]
[Split into smaller steps]
[Add checkpoint before]
[Make manual]
[Make AI-executed]
[Delete step]
[Show result]
[Show logs]
```

### 最佳实现方案

- 扩展 `PlanNodeDetailCard`，根据 plan 状态和 node 状态显示动作。
- 计划尚未接受：允许 edit/split/add checkpoint/delete/change executor。
- 执行中或已执行：禁止破坏性结构编辑，提供 show result/show logs/request changes from here。
- 每个动作生成明确 plan patch intent，进入 Plan Diff Review。

### 不建议

- 不要在已执行节点上直接修改历史事实。
- 不要把所有动作都做成自由文本 prompt。

---

## 优化 6：Run Preview

### 解决什么

用户点 Start / Continue 之前不知道会发生什么、从哪一步开始、哪里会停、会产出什么。

### 交互内容

开始执行前显示：

```text
Run preview
Provider: Claude Code
Mode: Manual checkpoints
Will start at: Step 1 / Collect source material
Expected stops:
- Step 3 requires approval
- Step 6 requires final review

Output destination:
- Task result
- Artifacts
- Activity trail

[Start run] [Edit plan] [Run selected step]
```

继续执行时：

```text
Continue from: Step 4 · Draft summary
Previous result exists · 3 artifacts
```

### 最佳实现方案

- 在 `TaskWorkspaceOperationPanel` 的 `plan-ready-to-run` 状态中加入 preview block。
- Preview 来源：graphPlan、currentExecution、node statuses、provider binding、checkpoint nodes。
- 后端不需要新 API；第一版前端可推导。
- 中期由 engine 提供 authoritative `runPreview`，避免前端重建复杂 execution readiness。

### 不建议

- 不要把 Run Preview 做成必须确认的 modal。它应该是内联 preview，除非存在高风险动作。

---

## 优化 7：Execution Cockpit

### 解决什么

执行中用户需要固定知道：现在做哪一步、为什么做、进度如何、下一步会发生什么、能否干预。

### 交互内容

当前执行区改为驾驶舱：

```text
Current step
Step 3/8 · Research target papers
Status: Running · Provider: Claude Code · 2m 14s

Goal:
Find 10 relevant papers from 2024-2026.

Live:
- Searching arXiv
- Reading paper abstract
- Extracting venue/date

Next:
Will ask you to approve source list.

Actions:
[Pause] [Add instruction] [Skip step] [Open logs]
```

### 最佳实现方案

- 在 `TaskWorkspaceOperationPanel` 中把 running 状态拆成：
  - current node identity
  - node objective
  - latest runtime events
  - next expected checkpoint
  - primary execution action
  - secondary actions
- current node 来源：`currentExecution.currentNodeId` + graphPlan node map。
- live 来源：runtime events，最多显示 3-5 条，完整 trail 继续放 Activity。
- 加 `Add instruction` 输入框：
  - provider 支持 live instruction：发送到 provider/session。
  - 不支持：保存为 pending instruction，在当前 node 完成后应用。

### 不建议

- 不要把 raw event stream 作为主要执行体验。
- 不要显示过多 provider 内部术语。

---

## 优化 8：Decision Cards for Waiting / Approval

### 解决什么

等待输入、审批、选择、阻塞恢复时，用户需要一个明确表单，而不是状态描述。

### 交互内容

输入：

```text
Chrona needs your input
Step: Choose target region

Question:
Which regions should AI prioritize?

[US] [EU] [Asia] [Remote only]

[Submit and continue]
```

审批：

```text
Approve source list?
AI selected 12 sources.

High confidence:
- Stanford PhD Jobs
- MIT EECS Openings

Low confidence:
- Generic LinkedIn search

[Approve] [Request changes] [Reject and replan]
```

### 最佳实现方案

- 后端 checkpoint executor 已有 `actionForm` 形态，可继续作为表单来源。
- 前端对 `operationSpec` 增加产品包装：标题、原因、后果、主按钮。
- `WaitingForInput` 和 `WaitingForApproval` 文案必须区分。
- 对 approve/reject/request changes 生成明确 checkpoint action。

### 不建议

- 不要把 approval 和 input 都写成 “Needs handling”。
- 不要让 AI-authored UI 控制 approve/cancel/retry 这些 runtime authority 动作。

---

## 优化 9：Result Review Step

### 解决什么

执行完成后缺少明确收尾：用户不知道结果是否已确认、是否需要后续处理、是否应该归档。

### 交互内容

完成后进入 Result Review：

```text
Result ready for review

Final result
Artifacts
Verification
Known limitations
Suggested follow-ups

[Accept result]
[Ask follow-up]
[Request changes]
[Create follow-up task]
[Pin to Library]
```

### 最佳实现方案

- 使用已有 `Completed` / `Done` 语义：
  - `Completed` = 执行完成，结果待 review。
  - `Done` = 用户确认结果。
- Result Review UI 仍在 Task Workspace Results 区第一阶段实现。
- `Accept result` 调用现有 result accept / task complete 相关动作，确保状态变为 Done 或等价 accepted 状态。
- `Request changes` 进入 follow-up composer，默认动作类型为 rerun/refine。

### 不建议

- 不要把执行完成直接等同于用户已处理。
- 不要把 Activity 放在 Result Review 的主视觉位置。

---

## 优化 10：Action-aware Follow-up Composer

### 解决什么

用户后续对话经常带有操作意图，但普通 chat 不说明这句话会不会改 result、改 plan、重跑或创建任务。

### 交互内容

结果区底部输入：

```text
Ask or continue from this result...
```

提交后让用户确认动作类型：

```text
What should this do?
[Ask only]
[Update result]
[Rerun selected step]
[Revise plan]
[Create follow-up task]
```

### 最佳实现方案

- Composer 先生成 local intent，不直接执行。
- 五类 intent：

```ts
type FollowUpIntentKind =
  | "ask_only"
  | "update_result"
  | "rerun_step"
  | "revise_plan"
  | "create_follow_up_task";
```

- `ask_only`：只写 assistant response，不改 task state。
- `update_result`：产生 result patch，进入 diff/review。
- `rerun_step`：生成 execution action，需要 Run Preview。
- `revise_plan`：生成 plan patch，进入 Plan Diff Review。
- `create_follow_up_task`：预填 task create form，用户确认后创建。

### 不建议

- 不要让一个 chat 输入隐式触发重跑或修改结果。
- 不要把所有 follow-up 都塞回同一个 plan。

---

## 优化 11：Persistent Status / Stage Bar

### 解决什么

用户在任务工作区里容易迷路。需要始终看到当前阶段和下一步。

### 交互内容

顶部常驻：

```text
Brief -> Plan -> Review -> Run -> Result

Blocked · Plan accepted · Run paused · Step 4/8 · Needs approval
Primary: Approve source list
```

### 最佳实现方案

- 新增纯 helper：`deriveTaskWorkspaceStage(task, plan, currentExecution, commandCenter)`。
- 输出：

```ts
type TaskWorkspaceStage = {
  stage: "brief" | "plan" | "review" | "run" | "result";
  statusLabel: string;
  currentNodeLabel?: string;
  nextActionLabel: string;
  primaryActionId: string;
  tone: "neutral" | "info" | "warning" | "critical" | "success";
};
```

- UI 放在 header card 内或下方，移动端压缩成单行 + dropdown。
- 该 helper 后续应成为 Dashboard / Task List / Task Workspace 状态文案的共享来源。

### 不建议

- 不要每个页面各自写状态判断。
- 不要把 stage bar 做成复杂 wizard，用户仍需能直接跳到 graph/results。

---

## 优化 12：Result Output Organization

### 解决什么

结果内容长、节点多、artifact 多时，用户难读。

### 交互内容

Results 区按节点和类型组织：

```text
Final Summary

Node results
▸ Step 1 / Collect sources
▾ Step 2 / Rank candidates
  - Markdown result
  - Table
  - FileRef

Artifacts
Activity / Debug trail
```

### 最佳实现方案

- 已有方向：Results 顶部节点过滤、collapse all / expand all、组件级折叠。
- 继续保持规则：
  - AI 可以声明内容是否默认折叠。
  - Chrona 自动做节点分组、外层轻量容器、默认折叠规则。
  - FileRef 内部 preview 折叠不等于组件级折叠。
- 无 ownership 时：显示为 Global output，不强行过滤。
- 有 ownership 时：按 node 分组，selected node 只显示相关结果。

### 不建议

- 不要让模型自己创建节点分割线。
- 不要让 raw activity 抢占 final result 的位置。

---

## 推荐落地顺序

### Phase 1：低风险交互解释层

目标：立刻降低“不知道下一步做什么”的感觉。

1. Persistent Status / Stage Bar。
2. Task Readiness Panel。
3. Plan Review Summary。
4. Run Preview。
5. Result Review actions。

特点：主要是前端 view model 和 UI，不改 schema，不碰 execution engine 语义。

### Phase 2：计划修改体验

目标：让用户敢让 AI 改 plan。

1. Selected Node Quick Actions。
2. Plan Diff Review。
3. 局部 revision / split / add checkpoint。
4. Apply / reject / revise again。

特点：需要稳定 graph diff 和 plan patch 表达，但仍可复用现有 plan patch 路由。

### Phase 3：执行中驾驶舱

目标：让长任务执行可理解、可干预。

1. Execution Cockpit。
2. Decision Cards。
3. Mid-run instruction。
4. Better pause/skip/retry/current-node actions。

特点：需要确认 provider capability。provider 不支持 live instruction 时，必须显示降级行为。

### Phase 4：后续对话产品化

目标：让任务完成后的继续对话可控。

1. Action-aware Follow-up Composer。
2. Ask only / update result / rerun step / revise plan / create follow-up task。
3. Result diff / plan diff / run preview 串联。

特点：需要更清晰的 assistant surface 与 task state 边界。

### Phase 5：结果库与长期沉淀

目标：解决长期找结果和复用问题。

1. Result Library。
2. ResultProjection。
3. Tags / Collections。
4. AI 自动摘要与 follow-up 提取。

特点：可能需要 schema 变更，应单独审批。

---

## 最小 MVP

如果只做一轮，建议做这 5 个：

1. Stage Bar：显示 Brief / Plan / Review / Run / Result 和下一步主动作。
2. Plan Review Summary：接受 plan 前显示步骤、输出、人工介入点、风险。
3. Run Preview：开始执行前显示 provider、起始节点、预计暂停点、输出位置。
4. Execution Cockpit：运行中固定显示当前节点、目标、live progress、next stop。
5. Result Review：完成后提供 Accept result / Ask follow-up / Request changes / Create follow-up task。

这组改动最能解释用户的“不方便”：不是功能缺失，而是链路缺少持续状态解释和安全动作入口。

---

## 验收标准

1. 用户在任务工作区任意时刻能回答：
   - 当前处于 Brief / Plan / Review / Run / Result 哪个阶段？
   - 当前主动作是什么？
   - 如果点主动作，会发生什么？

2. 用户接受 plan 前能看到：
   - 步骤数
   - 预计输出
   - 需要用户介入的节点
   - 风险或不确定点

3. 用户开始执行前能看到：
   - provider
   - 起始节点
   - 预计暂停点
   - 输出目的地

4. 用户执行中能看到：
   - 当前节点
   - 当前节点目标
   - 最新进度
   - 下一次可能需要介入的地方

5. 用户执行完成后能执行：
   - 接受结果
   - 请求修改
   - 提问
   - 创建后续任务

6. 用户后续对话前能明确选择：
   - 只问问题
   - 更新结果
   - 重跑步骤
   - 修改计划
   - 创建后续任务

---

## 测试建议

- 状态推导 helper 使用 table-driven tests。
- Plan Review Summary 测试不同 node 类型、checkpoint、估时、人工输入。
- Run Preview 测试未开始、已部分执行、blocked、failed、completed 后继续。
- Decision Card 测试 WaitingForInput 与 WaitingForApproval 文案和 action 区分。
- Result Review 测试 Completed 与 Done 不混淆。
- Follow-up Composer 测试五种 intent 不会互相误触发。
- UI 测试断言用户可见文案、按钮 enabled/disabled reason、主动作存在；不要只测 CSS。

---

## 需要谨慎的边界

- 不要改 provider 协议、执行 engine 语义、auth、token、schema，除非单独审批。
- 不要让 AI-authored json-render 组件承载 runtime authority 控件。
- 不要在 React component 内重建复杂业务状态机；状态推导应放纯 helper。
- 不要让 Completed 和 Done 在 UI 文案中混同。
- 不要让普通 chat 输入隐式改变任务、计划、结果或执行状态。
