# Chrona 任务执行结果页深度分析

- 页面：`/zh/tasks/cmsih895j000ma4fuydq4d7m3`
- 采集时间：2026-08-07
- 分析范围：真实页面截图、真实前端可访问性内容、仓库代码与 UX 规范
- 页面状态：`Result ready / 结果待审核`，4/4 steps，0 个文件，结果主体为 GitHub Trending 报告
- 说明：本文是分析和改造依据，不包含产品代码修改。

## 结论先行

这个页面“不好”的根因不是某个颜色、圆角或间距，而是首屏同时承载了五种不同职责：

1. 任务身份和计划上下文；
2. 生命周期阶段导航；
3. 执行状态和结果审核决策；
4. AI 生成的最终报告；
5. Provider/Agent 的调试证据和事件记录。

它们没有形成严格的主次关系，而是在同一张工作区里相互竞争。结果待审核时，用户最重要的问题其实只有三个：

- 结果到底是什么？
- 结果是否可靠、有什么限制？
- 我现在应该接受还是要求修改？

当前页面却让用户先同时处理 `Result ready`、`结果待审核`、`最终结果`、`AI 生成`、`Result output`、`Accept result or request changes` 等多套状态表达；真正结果又位于固定高度工作区的深层滚动区域中。中文页面还出现了明显的中英混杂，使页面更像内部调试控制台，而不是一个完成度高的产品结果页。

最优先的三个改动是：

1. 结果审核态改成“结果优先”：审核动作 + 结果摘要/主交付物 + 限制/证据 + 默认收起的执行记录；Provider transcript 不再出现在结果正文主路径中。
2. 建立唯一的 `WorkStateView`，让 Header、阶段栏、主操作、助手入口、结果审核区消费同一份状态和 next action。
3. 清理 `/zh` 页面所有硬编码英文，并修复 mobile/result-focus 的滚动与可访问性问题。

## 一、证据采集

### 1. 截图证据

截图均由 agent-browser 在真实运行页面采集：

- [01-initial.png](<artifacts/task-page-analysis-2026-08-06/screenshots/01-initial.png>)：桌面首屏，1280×633
- [02-result-mid.png](<artifacts/task-page-analysis-2026-08-06/screenshots/02-result-mid.png>)：结果中段
- [03-result-table.png](<artifacts/task-page-analysis-2026-08-06/screenshots/03-result-table.png>)：12 项目结果表格
- [04-result-bottom.png](<artifacts/task-page-analysis-2026-08-06/screenshots/04-result-bottom.png>)：补充视图和口径/来源
- [05-mobile-top.png](<artifacts/task-page-analysis-2026-08-06/screenshots/05-mobile-top.png>)：移动端 390×844 首屏
- [06-desktop-final-top.png](<artifacts/task-page-analysis-2026-08-06/screenshots/06-desktop-final-top.png>)：桌面最终首屏复采
- [07-transcript-drawer.png](<artifacts/task-page-analysis-2026-08-06/screenshots/07-transcript-drawer.png>)：打开 Agent transcript 抽屉
- [08-result-options.png](<artifacts/task-page-analysis-2026-08-06/screenshots/08-result-options.png>)：结果选项菜单
- [09-request-changes.png](<artifacts/task-page-analysis-2026-08-06/screenshots/09-request-changes.png>)：要求修改态

辅助证据文件：

- [initial-snapshot.txt](<artifacts/task-page-analysis-2026-08-06/initial-snapshot.txt>)：桌面页面 accessibility tree
- [mobile-snapshot.txt](<artifacts/task-page-analysis-2026-08-06/mobile-snapshot.txt>)：移动页面 accessibility tree
- [layout-evidence.json](<artifacts/task-page-analysis-2026-08-06/layout-evidence.json>)：桌面布局、元素几何、滚动容器
- [desktop-scroll-hierarchy.json](<artifacts/task-page-analysis-2026-08-06/desktop-scroll-hierarchy.json>)：桌面滚动层级
- [a11y-desktop.json](<artifacts/task-page-analysis-2026-08-06/a11y-desktop.json>)：桌面 axe 结果
- [a11y-mobile.json](<artifacts/task-page-analysis-2026-08-06/a11y-mobile.json>)：移动 axe 结果
- [request-changes-snapshot.txt](<artifacts/task-page-analysis-2026-08-06/request-changes-snapshot.txt>)：要求修改交互态
- [transcript-snapshot.txt](<artifacts/task-page-analysis-2026-08-06/transcript-snapshot.txt>)：执行记录抽屉内容

### 2. 真实页面结构数据

桌面端实际 viewport 是 1280×633。主要几何关系：

| 区域 | x/y | 宽/高 | 观察 |
| --- | ---: | ---: | --- |
| 应用主内容 | x=240, y=65 | 1040×568 | 左侧导航占用约 240px |
| 任务 Header | x=280, y=89 | 960×122 | 身份、状态、优先级、Occurrence、进度、更多操作都在这里 |
| 任务执行工作区 | x=280, y=219 | 960×390 | 首屏可见高度很小，`scrollHeight=3076` |
| 结果审核头 | x=293, y=289 | 934×114 | 页面进入结果状态后首先看到审核动作 |
| 结果指挥中心 | x=310, y=432 | 900×2847 | 大量 AI 结果内容在固定工作区内部展开 |
| 结果概览卡 | x=310, y=569 | 900×275 | 在 633px 视口中只能看到其顶部的一小段 |

桌面存在一个真正有效的外层工作区滚动容器，`clientHeight=388`、`scrollHeight=3076`；结果内容本身在它下面展开。用户需要在一个只有约 390px 高的面板中滚动约 3,000px 才能看完结果。

移动端 390×844 的关键数据更严重：

- `document.body.scrollHeight=844`，页面本身不增长；
- 工作区位于 y=265，宽 350px，但高度约 5100px；
- 工作区 `overflow: visible`，没有自己的滚动；
- 因此工作区下方大量内容超出 viewport，却没有一个可正常使用的页面滚动路径。

这不是“移动端有点挤”，而是 result-focus 在移动端的内容可达性缺陷。

## 二、图片/视觉设计分析

### A. 桌面首屏：结果没有成为首屏主角

[01-initial.png](<artifacts/task-page-analysis-2026-08-06/screenshots/01-initial.png>) 反映出：

- 顶部全局 Header、任务 Header、五阶段栏、结果审核卡、最终结果卡层层叠加；
- 工作区从 y=219 才开始，结果主体从 y=569 才开始，首屏底部只够露出结果概览顶部；
- “结果待审核”卡虽然提供了正确的接受/修改动作，但高度约 114px，和 Header 的 `Result ready`、阶段栏的 `Result` 重复表达同一个事实；
- 结果页仍保留“任务指挥中心 / 执行概览 / 最终结果”三层容器语义，视觉上像控制台嵌套在工作台中；
- 右侧固定 transcript 入口贴着 viewport 边缘，形成一个高对比、强存在感的调试入口，和主结果争夺注意力。

首屏应当让用户先看到“任务完成，结果待你验收”及结果摘要；当前首屏更像“进入一个复杂工作区后，再寻找结果”。

### B. 结果中段：内容层级正确了一半，但信息重复

[02-result-mid.png](<artifacts/task-page-analysis-2026-08-06/screenshots/02-result-mid.png>) 对应结果概览、注意事项和核心结果：

- 结果概览有一个不错的主标题、短摘要和四个指标，具备摘要层；
- 但“有注意事项，可使用”后面直接跟三条很长的限制说明，注意事项视觉权重接近正文，削弱了“可以直接看结论”的感觉；
- “今日新增 stars 最高的项目”五项摘要与下面 12 行全量表格重复展示前五项；
- 结果正文中使用的 `RESULT OUTPUT` 作为英文小标题，更像开发者标记，不像面向用户的产品语言；
- 最终结果的 AI 生成标记和“已验证”说明没有解释验证边界，而正文又明确提示渲染环境不可用、读取尾部有限制，容易造成“已验证”与“存在限制”的语义冲突。

建议保留摘要，但把内容分成清晰的三层：

1. 结论摘要：最多 3 个关键发现；
2. 主交付物：表格/报告/文件；
3. 证据和限制：默认折叠或弱化。

### C. 表格段：适合桌面，但不适合作为移动端默认内容

[03-result-table.png](<artifacts/task-page-analysis-2026-08-06/screenshots/03-result-table.png>) 的 12 行表格包含仓库、语言、总 stars、今日新增、简介五列。问题不是表格本身，而是：

- 对用户来说“今日新增”是主要排序字段，应该被视觉突出；当前列权重没有明显告诉用户哪个字段最重要；
- 官方仓库的长 URL 和简介会制造很宽的内容需求；
- 移动端依赖横向 overflow，而 UX 规范要求移动端无水平滚动；
- 每行既有数字又有解释，适合桌面数据浏览，不适合 390px 宽的结果阅读；
- 表格首列为空表头，axe 报告 `empty-table-header`；如果排名只是视觉列，应使用有意义的“排名”表头或 CSS/aria 处理。

建议：桌面保留表格；移动端转换为“排名卡片/列表”，每个项目显示仓库、今日新增（主数字）、语言和一句简介，总 stars/URL 进入展开详情。

### D. 底部：来源是必要证据，但不应与结果正文同等展开

[04-result-bottom.png](<artifacts/task-page-analysis-2026-08-06/screenshots/04-result-bottom.png>) 显示补充视图、数据源与排序口径、折叠的原始读取依据。它们对可信度有价值，但不是首次验收的主路径：

- “主题覆盖”又把项目按分类重新列了一遍，增加了二次阅读成本；
- “口径与依据”实际是 audit/evidence 区，应视觉上从结果主体退到证据区；
- 原始读取依据已折叠，方向正确，应该沿用到 Agent transcript 和原始事件。

### E. 交互态：操作存在，但语义仍偏内部工具

[07-transcript-drawer.png](<artifacts/task-page-analysis-2026-08-06/screenshots/07-transcript-drawer.png>) 显示固定的“Agent transcript”入口会打开一个大抽屉，里面有 100 events。它适合调试和审计，但不应在结果页作为高权重的常驻视觉元素。

[08-result-options.png](<artifacts/task-page-analysis-2026-08-06/screenshots/08-result-options.png>) 的“全部收起/全部展开”是合理的批量操作，但“结果选项”只解决渲染控制，没有解决结果导航：用户还需要知道哪些区块是结论、交付物、限制和证据。

[09-request-changes.png](<artifacts/task-page-analysis-2026-08-06/screenshots/09-request-changes.png>) 显示“要求修改结果”区域会插入到审核区下方、结果内容上方，这是正确的交互位置；但应在提交前明确“将重跑哪一步、是否可能重复外部副作用”，不能由系统静默猜测。

## 三、前端内容/信息架构分析

### 1. 状态文案重复且粒度不一致

真实页面同时出现：

- Header：`Result ready`、`Medium`、`4/4 steps`；
- 顶部助手入口：`NEXT / Accept result or request changes`；
- 阶段：`Brief / Plan / Review / Run / Result`；
- 工作区：`Result ready / Accept result or request changes`；
- 审核卡：`结果待审核`；
- 结果卡：`最终结果 / AI 生成 / 已验证的任务执行输出。`；
- 结果内部：`RESULT OUTPUT`；
- 侧边入口：`Agent transcript / Completed / 100 events`。

这些不是同一粒度：有的是任务状态，有的是下一步，有的是结果类型，有的是执行证据。它们现在以相似的 Badge/标题/按钮形式出现，用户需要自己推断层级。

建议把页面状态收敛成一个可见主句：

> 结果已生成，等待你验收
>
> 已完成 4/4 步骤 · 0 个文件交付 · 3 个结果限制

主操作只保留“接受结果”；次操作是“要求修改”；其他状态和证据都降级为辅助信息。

### 2. “无警告”与“有注意事项”互相冲突

真实页面审核摘要显示“无警告”，结果概览又显示“有注意事项，可使用”，并列出 3 条限制。这会让用户无法判断结果是：

- 没有执行诊断问题，但有内容适用边界；还是
- 上方摘要漏统计了结果限制。

建议把指标分成独立维度：

- 执行错误：0；
- 结果限制：3；
- 交付文件：0；
- 结构化结果：1。

不要用“无警告”覆盖所有质量风险。

### 3. “0 个交付文件”会贬低一个明显存在的结果

当前结果不是文件型交付物，而是一份完整的结构化报告。`0 个交付文件` 对内部数据模型可能正确，对用户却容易被理解为“什么都没产出”。建议改为：

- `最终结果 1`；
- `文件 0`；
- 或按统一结果模型显示“主交付物：报告；附件：0”。

### 4. 结果内容重复

页面先显示前 5 个项目的摘要，再显示包含同样前 5 个项目的 12 行表格，随后又按主题覆盖再次列举项目。这种重复对长报告尤其明显：它把“重点摘要”“完整数据”“分析视图”混在同一条长流水线上。

建议默认结构：

- 一句话结论；
- 3 个关键指标；
- 一个主表格；
- 衍生分析视图和来源放折叠区。

如果保留 Top 5 卡片，则完整表格默认收起，并显示“查看全部 12 项”。

### 5. 任务目标和验收依据缺席

结果焦点模式会隐藏计划工作台，但 Header 只带 title/status/progress/priority/occurrence/actions，没有 description、expected outcome 或 acceptance criteria。用户进入结果页后缺少“依据什么判断完成”的参照。

建议在结果摘要旁添加一个紧凑的“任务目标”卡：默认显示 2–3 行目标和预期输出，超出部分展开；不要恢复完整计划图。

### 6. 执行记录入口的语义不适合普通用户

“Agent transcript”有价值，但它是原始证据，不是结果本身。建议改成“执行记录（100 条）”或“查看执行证据”，默认关闭，抽屉内部使用：

- 阶段摘要；
- 节点尝试；
- 工具调用；
- 用户决策；
- 失败/重试；
- 原始事件。

当前 transcript snapshot 里 100 个事件中很多 article 的可访问文本为空，说明原始日志对用户并不一定提供可读信息，应该先聚合再暴露原始事件。

## 四、代码分析

### 1. 结果模式的组合已经表达了正确意图，但职责仍混在一起

关键链路：

- `features/task-workspace/ui/task-workspace-page.tsx:195-519`：页面同时编排 Header、计划、执行、运行事件、结果审核、接受结果、重跑、删除、编辑和 assistant context；
- `features/task-workspace/ui/task-workspace-plan-section-view.tsx:22-146`：根据 display mode 切换 brief/plan/run/result；
- `features/task-workspace/ui/task-workspace-plan-section-view.tsx:72-93`：result_focus 顺序为 `ResultLifecycle -> ResultChanges -> ResultInspector`；
- `features/execution-monitoring/ui/task-workspace-inspector.tsx:1-171`：Inspector 实际同时承载 command center、result output、activity、operation panel；
- `features/execution-monitoring/ui/execution-overview-content.tsx:590-812`：结果、Provider transcript、活动抽屉和 finalization retry 都在同一组件中；
- `features/execution-monitoring/ui/build-execution-overview-spec.ts:575-661`：输出文档、实时输出、artifact fallback 和按节点过滤被合并为一个 UiDocument。

这���释���为什么每次大改后仍然容易出现“局部更好、整体更乱”：显示模式虽然存在，但底层 Inspector 仍是全阶段通用组件，结果页只是把更多内容塞进 `result_focus`。

建议后续拆出明确产品组件：

- `TaskIdentityHeader`：身份、唯一状态、唯一主操作；
- `TaskStageSummary`：阶段/进度；
- `ResultReviewBar`：接受/要求修改；
- `ResultSummary`：AI 结果正文；
- `DeliverablesSection`：文件/报告/链接；
- `CaveatsAndEvidence`：限制和来源；
- `ExecutionEvidenceDrawer`：聚合后的运行记录；
- `CurrentOperationSurface`：只服务 running/waiting/blocked。

不要继续向 `TaskWorkspaceExecutionOverview` 增加跨阶段 props。

### 2. `blocked` display rule 没有对应专用视图分支

`features/task-workspace/model/task-workspace-interaction.ts:297-311` 将 blocked 定义为 `decision_focus`，但 `features/task-workspace/ui/task-workspace-plan-section-view.tsx:58-65` 只显式处理 `brief_focus`、`result_focus`、reviewing_plan、ready_to_run、running，blocked 会回落到 `PlanWorkspace`。

这会让状态模型宣称“以 blocker 为主”，实际 UI 却仍然显示通用 plan workspace。建议为 blocked/failed 增加专用 `PlanDecisionFocus`，至少包含：原因、影响范围、当前节点、可执行动作、重试风险。

### 3. Result changes 使用“最后一个 completed 节点”猜测结果归属

`features/task-workspace/ui/task-workspace-plan-section-runtime.ts:202-214` 通过反转 nodes 找第一个 completed 节点，然后以该节点作为 `retry_node` 目标。这是不安全的启发式：最后完成的节点不一定是最终结果 owner。

而 `features/execution-monitoring/ui/execution-overview-hooks.ts:104-151` 已经使用 `currentExecution.planOutput.updatedByNodeId` 作为 `outputOwnerNodeId`。结果审核和要求修改必须复用同一个 owner 来源；建议 review context 明确返回 `resultOwnerNodeId`，缺失时阻止提交并让用户选择。

### 4. 结果可用状态存在潜在语义漂移

`features/execution-monitoring/ui/execution-overview-hooks.ts:104-151` 中 `liveResultSpec` 固定为 `null`，但输出仍可能由 latest completed node 或 command-center document 构造。`TaskWorkspaceExecutionOverview` 又以 `Boolean(output.liveResultSpec) || executionResultState === "available"` 判断 `hasAvailableResult`。

因此可能出现“下方已经有结果，上面却显示等待输出”的状态/内容矛盾。建议从实际可渲染的 output spec、finalization status、artifact 是否存在统一派生 `ResultAvailability`，删除已废弃的 live-result 占位模型。

### 5. Header builder 仍输出硬编码英文

`packages/ui-protocol/src/builders/build-task-header-spec.ts:1-42,114-207` 的输入虽然接受已经格式化的 `statusLabel/priorityLabel/occurrenceLabel`，但执行按钮仍直接输出 `Start`、`Pause`、`Stop`、`Accept plan`、`Generate plan`、`Stop generation`。Occurrence label 也固定为 `Occurrence`。

`packages/engine/src/modules/tasks/get-task-header.ts:339-365` 还在服务端拼接 `progressLabel: "4/4 steps"` 和 `occurrenceLabel: "Occurrence · ..."`。这与 `/zh` 页面使用中文 dictionary 的期望不一致。

短期修复：所有 builder 输入增加完整 copy，并由 route locale 选择；不要只修 Header badge。长期修复：UiDocument 传语义 key/状态值，最终翻译在 Web 端完成。

### 6. Loader 没有把 locale 传给 workspace read models

`apps/web/src/loaders.ts:143-177` 能拿到 `locale` 和 `dictionary`，但 bootstrap、runtime-context、review-context、command-center、workspace/header 五个请求只传 `workBlockId`，没有传 locale。

如果服务端 read model/builder 生成自然语言，就无法稳定知道应返回中文。建议：

- 核心状态、按钮和阶段统一由客户端 locale dictionary 渲染；
- 若暂时由服务端生成文案，则所有端点统一接收 `locale`，并统一使用 locale-aware copy；
- 五个 read model 返回共同 `workspaceRevision`，避免完成/接受瞬间出现不同快照。

### 7. 组件 API 有明显漂移

`TaskWorkspaceExecutionOverview` 接收 `readiness`、`attention`、`primaryAction`、`activityLayout` 等参数，但当前结果实现的主路径并不直接消费这些值；`TaskWorkspaceInspector` 还固定传入 `primaryAction={null}`。这表明旧的 command-center 模型与新的 result-focus 模型并存。

建议先做一次 API 收缩，再做视觉改造：删除无效 props，或者明确拆分“执行中 overview”和“结果 review”。否则每次修复都可能只修到某个调用路径。

## 五、可访问性和响应式实测

### Desktop axe

实测 counts：42 passes，2 violations，1 incomplete。

- `empty-table-header`（minor，2 个节点）：两张表第一列表头为空；
- `region`（moderate，1 个节点）：部分滚动/表格内容未被 landmark 完整包含；
- `aria-prohibited-attr`（serious，incomplete）：结果完成摘要和结果审核操作把 `aria-label` 放在无有效 role 的 div 上。

### Mobile axe

实测 counts：42 passes，2 violations，2 incomplete。

- `empty-table-header`（minor，2 个节点）；
- `scrollable-region-focusable`（serious，2 个节点）：横向滚动区域不可键盘访问；
- `aria-prohibited-attr`（serious，incomplete）；
- `color-contrast`（serious，incomplete，5 个节点）：面包屑/Badge/4/4 steps 等元素因伪元素背景无法确认对比度，需人工或 CSS 明确背景。

另外，真实页面 console/error 检查没有发现运行时错误；这说明当前问题主要是信息架构、响应式和内容语义，而非页面崩溃。

## 六、推荐的目标页面结构

对于 `Result ready` 状态，建议把页面压缩成下面的单一主路径：

```text
任务标题 + 唯一状态 + 唯一主操作
└─ 阶段摘要：结果 · 4/4
   └─ 任务目标（紧凑，可展开）
      └─ 结果审核栏：接受结果 / 要求修改
         └─ 结果摘要：一句话结论 + 关键指标
            └─ 主交付物：报告/表格/文件
               └─ 结果限制：3 个注意事项
                  └─ 证据与来源（默认折叠）
                     └─ 执行记录（默认折叠，只有一个入口）
```

具体到本页面：

- `结果待审核` 保留，但改为页面唯一的状态标题；Header 和 stage rail 只显示短摘要，不再重复 next action；
- “接受结果”是 primary，放在结果审核栏右侧/移动端首屏；“要求修改”是 secondary；
- 将 “最终结果 / AI 生成 / 已验证” 合并成一行可信度 metadata，不要让三个标签各自像状态；
- 将 `Result output` 改为“结果”或“主结果”；
- 先显示 1 句摘要、3 个指标和 Top insights；
- 12 行全量表格保留在“完整数据”区，移动端转换为卡片列表；
- “主题覆盖”“数据源与排序口径”“原始读取依据”合并到“证据与来源”；
- 执行记录改成普通文案“执行记录 · 100 条”，默认关闭，不在 viewport 中央固定高对比 tab；
- “0 个交付文件”改成“最终结果 1 · 文件 0”，或由结果模型给出“主交付物：报告”。

## 七、优先级改造方案

### P0：直接解决当前“不舒服”的三项

1. `result_focus` 中先渲染结果审核和结果摘要，再渲染 artifacts/evidence，隐藏或默认折叠 transcript；
2. 用一个 `WorkStateView` 统一 `label/tone/stage/nextAction/primaryAction/blocker`，Header、stage bar、result lifecycle、assistant NEXT 共用；
3. 完成所有 `/zh` 硬编码英文清理：阶段、Result output、Agent transcript、Header action、Occurrence、工具/事件标签。

### P1：修复页面可用性和可信度

1. 移动端增加唯一页面滚动容器，保证 390×844 能访问完整结果；移除 result-focus 的 `overflow-visible` fallback；
2. 结果摘要拆分“执行错误”和“结果限制”，修复“无警告”与“有注意事项”的矛盾；
3. 显式传递 `resultOwnerNodeId`，要求修改不再猜测最后一个 completed node；
4. 修复表格空表头、横向滚动区域键盘访问、无效 `aria-label`、移动端对比度。

### P2：降低代码复杂度

1. 拆 `TaskWorkspaceInspector` / `TaskWorkspaceExecutionOverview` 为 ResultReviewSurface、CurrentOperationSurface、ExecutionEvidenceDrawer；
2. 收缩无效 props，删除 `liveResultSpec=null` 等漂移接口；
3. 为所有 canonical states 补齐 result-ready/done/blocked/failed 的视觉和内容 golden tests。

## 八、验收标准

### 页面和内容

- 1280×633 首屏能看到：任务状态、主结果摘要、接受/修改动作；不需要先滚动工作区才能知道结果是什么；
- 结果页只有一个主状态句和一个主操作；
- 没有任何用户可见的中英混杂（仓库名、语言名和原始 provider payload 除外）；
- 结果存在时不出现“等待输出”；
- 限制计数与实际限制数量一致；文件型和非文件型交付物语义清楚。

### 响应式

- 390×844 页面 `document.scrollHeight` 覆盖完整内容，用户可通过键盘/触摸向下访问所有结果；
- 无横向页面溢出；表格转为卡片或具备明确的 focusable scroll region；
- 主操作在移动端首屏可见；transcript 不遮挡右侧控件；
- 1024×768、1280×633、1440×900 均只有一个主滚动上下文。

### 状态和交互

- `result_ready`、`done`、`blocked`、`failed` 各自只有一套 label/tone/action；
- Header、阶段栏、助手 NEXT 和审核栏在同一状态下输出相同 next action；
- 要求修改显示明确的目标节点、重跑范围和副作用提示；
- 结果/证据/执行记录的折叠状态有稳定的可访问名称，实时日志不整段 `aria-live` 播报。

### 自动化测试

- 增加 completed/result-ready 截图 golden：桌面首屏、中段、移动端；
- 增加 390×844、1024×768、1280×633、1440×900 的滚动可达性断言；
- 增加 i18n 扫描，禁止核心 workspace UI 输出硬编码英文；
- 增加 axe 断言，至少清除 `empty-table-header`、`region`、`scrollable-region-focusable` 和 `aria-prohibited-attr`；
- 增加 result owner regression：结果修改必须重跑 `planOutput.updatedByNodeId` 对应节点；
- 增加结果语义测试：有结构化结果但无文件时，显示“主结果 1 / 文件 0”，而不是只显示“0 个交付文件”。

## 九、相关代码和规范索引

- 页面总装配：[task-workspace-page.tsx](<features/task-workspace/ui/task-workspace-page.tsx:195>)
- 状态/布局规则：[task-workspace-interaction.ts](<features/task-workspace/model/task-workspace-interaction.ts:218>)
- 结果焦点视图：[task-workspace-plan-section-view.tsx](<features/task-workspace/ui/task-workspace-plan-section-view.tsx:22>)
- 结果审核面板：[task-workspace-result-lifecycle-panel.tsx](<features/task-workspace/ui/task-workspace-result-lifecycle-panel.tsx:20>)
- 结果和执行记录：[execution-overview-content.tsx](<features/execution-monitoring/ui/execution-overview-content.tsx:590>)
- Inspector：[task-workspace-inspector.tsx](<features/execution-monitoring/ui/task-workspace-inspector.tsx:40>)
- 结果 spec 合并：[build-execution-overview-spec.ts](<features/execution-monitoring/ui/build-execution-overview-spec.ts:575>)
- 结果输出 hook：[execution-overview-hooks.ts](<features/execution-monitoring/ui/execution-overview-hooks.ts:104>)
- Header builder：[build-task-header-spec.ts](<packages/ui-protocol/src/builders/build-task-header-spec.ts:1>)
- Header read model：[get-task-header.ts](<packages/engine/src/modules/tasks/get-task-header.ts:339>)
- Loader：[loaders.ts](<apps/web/src/loaders.ts:143>)
- 目标 UX 规范：[task-workspace-mission-control.md](<docs/ux/task-workspace-mission-control.md:1>)
- 已有结果交互方案：[task-workspace-interaction-improvements.md](<docs/zh/task-workspace-interaction-improvements.md:1>)

## 十、建议实施顺序

先不要继续微调圆角和颜色。建议按下面顺序落地：

1. 先修 result-focus 的信息结构和首屏高度/滚动；
2. 再建立/接通 WorkStateView，消除状态重复；
3. 再做 i18n 和结果语义（警告、限制、文件、主交付物）；
4. 接着修 result owner 和结果可用判定等行为风险；
5. 最后拆组件、收缩 API，并补齐多 viewport/golden/a11y 回归。

这样每一步都能通过截图和状态测试验证，不会继续在同一个复杂 Inspector 上叠加局部修补。
