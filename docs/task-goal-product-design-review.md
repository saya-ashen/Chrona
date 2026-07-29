# Chrona Task / Goal 产品设计审查

> 审查范围：当前仓库中可识别的 Task 与 Goal 路由、页面组件，以及空态、列表、详情、创建、编辑、计划、执行、结果、归档等可见状态。  
> 审查视角：视觉层级、可用性、信息架构、交互与功能设计。  
> 证据边界：结论仅基于仓库中明确存在的界面结构、文案、操作和状态分支；真实尺寸、滚动、动效、首屏位置与视觉质感需要运行态截图验证。

## 1. 总体结论

Chrona 已形成完整产品链路：Task 从定义、计划、执行、人工介入进入结果验收；Goal 从创建、推进、准则确认进入达成或停止归档；被接受的结果还能继续追问、创建后续 Task，并沉淀到 Goal Workbench。

当前主要问题不是缺少功能，而是**同一屏的状态、解释、操作和元信息过多，用户最需要知道的“现在处于什么状态、为什么、下一步做什么”容易被淹没**。优先级如下：

1. **P1：统一 Task 生命周期的页面心智。** 列表、计划、执行和结果采用不同组织方式，用户需要重复判断当前位置。
2. **P1：降低 Goal Overview 与 Workbench 的决策密度。** 当前焦点、Brief、准则、Task、Review 和资产状态缺少渐进披露。
3. **P1：明确“接受结果”“确认 Goal 达成”“保存草稿”“发布正式版本”四类承诺的差异。** 这些动作决定内容是否成为长期依据，应明显区别于普通操作。
4. **P2：统一中文界面的术语和语言。** 仓库中仍可见 Work、Results、Plan setup、Current operation、Context strategy 等英文回退文案。
5. **P2：减少固定解释、Badge 和并列筛选器，把空间留给当前任务、风险和主操作。**

本次未发现可由仓库界面证据直接支持的 P0 问题。

### 严重级别定义

- **P0**：阻断关键流程，或会让多数用户作出不可逆的错误决定。
- **P1**：显著影响核心任务完成率、决策正确性或对结果的信任。
- **P2**：造成持续认知负担、效率损失或学习成本。
- **P3**：局部一致性、文案或视觉精修问题。

## 2. 全局路由与信息架构

仓库中可识别的直接路由为：

- `/:lang/tasks`：Task 列表。
- `/:lang/tasks/:taskId`：独立 Task 工作区。
- `/:lang/goals`：Goal 列表与创建入口。
- `/:lang/goals/:goalId`：Goal 工作区。
- `/:lang/goals/:goalId/workbench/tasks/:taskId`：Goal 内 Task 检视页。

对应包装器为 `TaskListRoutePage`、`TaskDetailRoutePage`、`GoalListRoutePage`、`GoalWorkspaceRoutePage`、`GoalTaskInspectorRoutePage`，证据位于 `apps/web/src/router.tsx` 与 `apps/web/src/pages.tsx`。

### 问题 IA-1：同一个 Task 有两个详情入口，父级关系需要持续可见

- **问题描述**：独立 Task 与 Goal 内 Task 使用不同 URL，但都进入 Task 工作区。若用户在处理过程中忘记入口来源，返回路径和结果归属会变得不确定。
- **严重级别**：P1
- **受影响用户/场景**：从 Goal 的 Work 或 Focus queue 打开 Task、随后编辑或处理结果的用户。
- **仓库中的界面或交互证据**：`GoalTaskInspectorRoutePage` 与 `TaskDetailRoutePage` 都承载 Task 检视；`TaskWorkspaceHeaderCard` 对 Goal Task 显示所属 Goal 路径，对独立 Task 显示返回 Task 列表。
- **具体改进建议**：保持现有父级路径，但增加明确的返回语义“返回 Goal 工作”；接受结果或创建后续 Task 后仍保留所属 Goal 提示，避免上下文在状态切换时消失。

### 问题 IA-2：跨页面的结果生命周期词汇不统一

- **问题描述**：同一份产出在不同阶段被称为 Results、accepted result、candidate、asset、draft 或 version，用户难以理解这些对象是否相同、是否已被确认、是否会被后续 Task 使用。
- **严重级别**：P1
- **受影响用户/场景**：完成 Task、验收结果、将结果归入 Goal、之后再次检索资产的用户。
- **仓库中的界面或交互证据**：`TaskListPage` 的 Results；`ResultLifecyclePanel` 的 Accept result；`GoalAssetWorkbench` 的 Inbox/Library/Archived；`InboxCandidate` 的 create asset/append version/reject；`AssetEditor` 的 draft/formal version。
- **具体改进建议**：建立统一可见生命周期：**待验收结果 → 已接受结果 → 待归属候选 → Goal 资产正式版本**。每页只突出当前阶段，并用一句话说明进入下一阶段的影响。

## 3. Task 列表页：`/:lang/tasks`

覆盖组件：`TaskListPage`、`TaskListHero`、`TaskStat`、`TaskFilterBar`、`TaskRow`。覆盖状态：Work、Results、加载、请求失败、默认空态、筛选无结果、结果空态、选择/批量操作、删除确认、分页和操作反馈。

### 问题 TLIST-1：生命周期筛选与 Work/Results 形成双重分类

- **问题描述**：页面先要求选择 Work 或 Results，再使用状态、日期、来源、优先级等筛选。生命周期状态和内容类型并列，用户难以预测 Completed Task 或待验收结果应在哪一层查找。
- **严重级别**：P1
- **受影响用户/场景**：寻找刚完成但尚未接受的 Task、回看已接受结果、处理失败 Task 的用户。
- **仓库中的界面或交互证据**：`TaskListPage` 同时渲染一级 Work/Results、`TaskFilterBar` 生命周期筛选，以及 Results 的日期、状态与来源 Task 筛选。
- **具体改进建议**：一级视图改为用户目标，如“待处理 / 进行中 / 结果 / 全部”；每个视图只保留必要筛选。明确 Completed Task 与待验收结果分别出现在哪里。

### 问题 TLIST-2：页头状态字典长期占据任务内容空间

- **问题描述**：Needs you、Ready、Running、Failed 的完整解释有助首次学习，但对回访用户是重复信息，并与统计、筛选和 Task 卡片争夺首屏。
- **严重级别**：P2
- **受影响用户/场景**：每天多次进入列表、目标是快速找到下一项工作的用户。
- **仓库中的界面或交互证据**：`TaskListHero` 同时显示当前筛选、Total/Needs you/Ready 统计和四类状态解释文本。
- **具体改进建议**：首屏仅保留当前视图说明；状态字典放入可展开“状态说明”或首次使用引导。Needs you 统计应可直接进入对应任务集合。

### 问题 TLIST-3：Task 卡片信息密度过高，扫读主线不稳定

- **问题描述**：单卡同时展示状态、优先级、自动化模式、外部日历来源、描述、更新时间和菜单。Badge 数量随属性变化，标题与当前阻塞原因反而不稳定。
- **严重级别**：P2
- **受影响用户/场景**：从大量 Task 中寻找“现在需要我处理什么”的用户。
- **仓库中的界面或交互证据**：`TaskRow` 渲染多个 Badge、来源、描述预览、更新时间，以及 Open、Start、Complete/Reopen、Delete。
- **具体改进建议**：固定三层：标题与唯一状态；下一步或阻塞原因；可选元信息。优先级仅在非默认或高风险时突出，自动化与来源移入次级详情。

### 问题 TLIST-4：批量模式与单项操作作用域容易混淆

- **问题描述**：页面同时提供单项 Start、Complete/Reopen、Delete 和批量操作。选择多项后若单卡菜单仍同等突出，用户难以确认动作作用于单项还是选择集。
- **严重级别**：P2
- **受影响用户/场景**：批量清理或调整历史 Task 的用户。
- **仓库中的界面或交互证据**：`TaskListPage` 有选择与批量操作；`TaskRow` 同时保留单项菜单；删除另有确认态。
- **具体改进建议**：进入选择后切换为明确批量模式，弱化单卡菜单；固定显示“已选择 N 项”和作用范围。删除与普通生命周期变更分组。

### 问题 TLIST-5：中文界面存在核心英文术语

- **问题描述**：Work、Results、Any date、Accepted、Needs review 等词若出现在中文 locale，会破坏术语连贯性。
- **严重级别**：P2
- **受影响用户/场景**：使用中文界面的所有 Task 列表用户。
- **仓库中的界面或交互证据**：`TaskListPage` 的一级视图与 Results 筛选包含这些可见文案。
- **具体改进建议**：统一为“工作 / 结果”“不限日期 / 最近 7 天 / 最近 30 天”“已接受 / 待验收”，并与 Task 详情术语一致。

### 问题 TLIST-6：各类空态缺少一致的恢复方向

- **问题描述**：默认空态、筛选无结果、Results 无结果均存在，但用户更需要区分“尚无内容”和“内容被筛选隐藏”，并看到唯一下一步。
- **严重级别**：P2
- **受影响用户/场景**：新用户、筛选后看不到 Task 的用户、尚未接受过结果的用户。
- **仓库中的界面或交互证据**：`TaskListPage` 存在加载、错误、默认空态、筛选无结果和 Results 无结果分支。
- **具体改进建议**：默认空态主操作为“创建 Task”；筛选无结果为“清除筛选”；结果空态为“查看待验收 Task”。每个空态只保留一个主操作。

### 问题 TLIST-7：Results 来源筛选的完整范围无法确认

- **问题描述**：仓库可确认存在来源 Task 筛选，但无法仅从界面结构确认选项覆盖全部历史来源，还是只覆盖当前已加载数据。
- **严重级别**：P1（条件性）
- **受影响用户/场景**：Task 较多、跨分页检索历史结果的用户。
- **仓库中的界面或交互证据**：Results 视图包含 source Task 筛选；真实选项完整性与跨分页体验**无法从仓库验证**。
- **具体改进建议**：产品规则应保证来源筛选覆盖当前查询范围内的全部来源，并支持搜索；需使用跨分页历史数据运行验证。

## 4. Task 工作区：详情、编辑与头部

覆盖组件：`TaskWorkspacePage`、`TaskWorkspaceHeaderEditor`、`TaskWorkspaceHeaderCard`、`TaskWorkspaceEditSection`。覆盖状态：加载、请求失败、正常详情、Goal 内详情、编辑、未保存变更、保存中、保存成功、保存失败、外部来源字段锁定、运行中 Provider 不可改、删除确认、重启确认和操作反馈。

### 问题 TDETAIL-1：头部同时承担身份、父级、知识状态与生命周期控制

- **问题描述**：头部需要同时显示返回路径、所属 Goal、Goal knowledge 计数、Task 标题、状态以及编辑/删除/执行操作，容易从“对象身份”变成第二个操作中心。
- **严重级别**：P2
- **受影响用户/场景**：运行中频繁查看 Task 状态，或从 Goal 打开 Task 的用户。
- **仓库中的界面或交互证据**：`TaskWorkspaceHeaderCard` 显示 Goal/Tasks 返回路径、Goal knowledge captured/read、结构化 Header，以及 edit/delete/restart 和执行动作。
- **具体改进建议**：头部固定只保留身份、父级、当前总状态和一个主操作；知识计数移入 Goal 上下文详情；破坏性操作放入统一更多菜单。

### 问题 TDETAIL-2：Goal knowledge 以计数表达，用户不清楚内容与影响

- **问题描述**：“captured/read”数量说明系统使用了 Goal 知识，却不能回答具体读了什么、是否影响当前结果。
- **严重级别**：P2
- **受影响用户/场景**：需要判断 Task 是否正确利用 Goal 工作资料的用户。
- **仓库中的界面或交互证据**：`TaskWorkspaceHeaderCard` 仅显示 `captured` 与 `read` 数量及提示。
- **具体改进建议**：改为可展开“本次使用的 Goal 资料”，列出名称与版本；默认仅显示“已使用 N 项资料”，不要暴露两个难以解释的计数。

### 问题 TDETAIL-3：编辑态同时包含配置约束与 Assistant proposal，决策层级混杂

- **问题描述**：用户既要编辑 Task 配置，又可能审查 Assistant proposal diff，还要理解外部来源锁定和运行中不可修改项，单一表单承载过多模式。
- **严重级别**：P2
- **受影响用户/场景**：运行前修改 Task、从外部日历导入 Task、审查 AI 建议修改的用户。
- **仓库中的界面或交互证据**：`TaskWorkspaceEditSection` 包含 Task 配置表单、锁定字段提示、Provider 禁用、未保存变更、成功/失败反馈和 proposal diff preview。
- **具体改进建议**：将“直接编辑”和“审查建议”设计为两个明确模式；被锁字段在字段旁解释原因与可变更位置；关闭时对未保存内容提供明确保护。

### 问题 TDETAIL-4：重启风险信息完整，但动作命名仍可能被理解为普通重试

- **问题描述**：重启确认已说明保留计划、重置进度及可能重复外部动作，但“Run plan from beginning”与普通 Retry 仍可能在不同入口并存。
- **严重级别**：P1
- **受影响用户/场景**：执行已产生外部副作用后尝试恢复的用户。
- **仓库中的界面或交互证据**：`TaskWorkspaceHeaderCard` 和 `TaskWorkspaceOperationPanel` 都提供从头运行；确认文案警告已完成步骤可能重复外部动作。
- **具体改进建议**：全产品只使用“从头重新执行”，并附“可能重复外部操作”的风险标签；普通“重试当前步骤”必须是另一名称和入口。

## 5. Task 工作区：计划准备、生成与审查

覆盖组件：`PlanSetupPanel`、`PlanGenerationProgressPanel`、`StageBarCard`、`TaskWorkspacePlanContent`、`PlanNodeDetailCard`、`PlanReviewSummaryCard`、`PlanReviewDecisionPanel`。覆盖状态：无计划、准备度检查、生成中、生成失败/恢复信息、草案审查、节点选中、紧凑/图形视图、接受失败、请求修改和重新生成。

### 问题 TPLAN-1：准备页解释完整，但首要决策被多层说明包围

- **问题描述**：Plan setup 同时呈现准备度、Provider、任务摘要、改进建议、生成按钮和“What happens next”四步说明。首次用户能理解流程，回访用户却需要穿过大量解释才能开始。
- **严重级别**：P2
- **受影响用户/场景**：频繁创建相似 Task、已理解计划流程的用户。
- **仓库中的界面或交互证据**：`PlanSetupPanel` 包含 required checks、recommended improvements、Provider、任务 Brief、主操作和四步说明。
- **具体改进建议**：默认只显示“已准备/需补充”结论、关键阻塞项和生成按钮；详细检查与流程说明折叠。对必填未通过项直接提供“编辑 Task”。

### 问题 TPLAN-2：生成中状态缺少用户可判断的阶段信息

- **问题描述**：生成页说明 Chrona 正在准备可审查计划、不会执行，但用户无法判断当前进展、是否仍正常、何时应该停止。
- **严重级别**：P2
- **受影响用户/场景**：计划生成时间较长或经历重试的用户。
- **仓库中的界面或交互证据**：`PlanGenerationProgressPanel` 为集中式进度视图；可见文案强调 draft 会在验证和保存后替换此页。
- **具体改进建议**：显示稳定的产品阶段，如“理解任务 → 组织步骤 → 校验计划 → 保存草案”，无需虚构百分比；同时保留停止生成入口与停止后影响说明。

### 问题 TPLAN-3：计划审查同时要求理解图、节点详情、摘要和决策侧栏

- **问题描述**：审查态采用执行流主区加决策侧栏，并可能同时显示选中节点详情和审查摘要。用户在接受计划前需要在多个区域拼接完整判断。
- **严重级别**：P1
- **受影响用户/场景**：审查长计划、包含 checkpoint/condition/wait 的计划用户。
- **仓库中的界面或交互证据**：`TaskWorkspacePlanSection` 的 reviewing_plan 布局并列 `TaskWorkspacePlanContent` 与 `PlanReviewDecisionPanel`；节点可打开 `PlanNodeDetailCard`，另有 `PlanReviewSummaryCard`。
- **具体改进建议**：建立固定审查顺序：先风险与人工停点摘要，再步骤浏览，最后接受/修改。决策侧栏持续显示未解决风险数量；节点修改入口应明确影响范围。

### 问题 TPLAN-4：接受计划与请求修改缺少“执行影响”对照

- **问题描述**：用户可以接受或提交修改说明，但仅看计划结构时不一定理解自动化模式、预计人工停点和外部动作风险。
- **严重级别**：P1
- **受影响用户/场景**：使用自动执行、审批点或外部工具动作的用户。
- **仓库中的界面或交互证据**：`PlanReviewDecisionPanel` 提供接受与 revision instruction；`RunLaunchPanel` 在接受后才集中展示步骤、时长和 stops。
- **具体改进建议**：在接受按钮上方提前显示“接受后会怎样”：手动/自动启动、预计停点、潜在外部动作。把关键启动影响从接受后前移到接受前。

## 6. Task 工作区：启动、执行、人工介入与恢复

覆盖组件：`RunLaunchPanel`、`ExecutionFocusHeader`、`ExecutionNavigator`、`TaskWorkspaceOperationPanel`、`SelectedNodeCue`、`DecisionRecoveryCard`、`ProviderApprovalBanner`、`TaskWorkspaceInspector`、`ActivityTimeline`/`ActivityRailTimeline`。覆盖状态：待启动、运行、查看当前/其他节点、等待输入、等待批准、阻塞、失败、取消、暂停/继续/停止、checkpoint 操作、Provider 批准、恢复选项、从头执行、重新生成计划、实时活动和历史运行分隔。

### 问题 TEXE-1：运行态存在多个竞争性的“当前状态”区域

- **问题描述**：运行态同时有 Stage bar、Execution focus header、Navigator、Inspector、Current operation、节点操作和 Activity。每个区域都可能显示状态或下一步，用户难以判断哪个具有最终权威。
- **严重级别**：P1
- **受影响用户/场景**：等待输入、执行失败或需要快速判断当前节点的用户。
- **仓库中的界面或交互证据**：`TaskWorkspacePlanSection` running 布局并列 `ExecutionNavigator` 与 `TaskWorkspaceInspector`，Inspector 可嵌入 `TaskWorkspaceOperationPanel`；页面上方还有 Stage bar 与 Execution focus header。
- **具体改进建议**：建立唯一“当前状态条”，固定显示 Task 状态、当前节点、阻塞原因和唯一主操作；Navigator 只负责定位，Activity 只负责证据，不再重复主状态。

### 问题 TEXE-2：人工输入、批准、失败和阻塞虽可区分，但视觉恢复路径不统一

- **问题描述**：Decision recovery、Provider approval、结构化 checkpoint 和 task primary action 可能在相邻区域分别出现。用户需要先识别问题类别，再寻找对应操作。
- **严重级别**：P1
- **受影响用户/场景**：Task 处于 WaitingForInput、WaitingForApproval、blocked 或 failed 的用户。
- **仓库中的界面或交互证据**：`DecisionRecoveryCard` 覆盖 waiting_for_input、waiting_for_approval、blocked、failed、cancelled；`ProviderApprovalBanner` 独立渲染；`SpecRenderer` 渲染 execution-action/execution-blocked 控件。
- **具体改进建议**：统一成“需要你处理”区域，按类型显示输入/批准/恢复，但每次只突出一个当前主操作。保留类别和已保存进度作为次级证据。

### 问题 TEXE-3：恢复对话框提供两个高影响选项，比较成本仍然较高

- **问题描述**：“从头执行当前计划”和“生成新计划”同时出现，并附保留内容、重置内容和副作用警告。信息完整，但紧急恢复时阅读成本高。
- **严重级别**：P1
- **受影响用户/场景**：Task 失败、阻塞或取消后希望恢复的用户。
- **仓库中的界面或交互证据**：`TaskWorkspaceOperationPanel` 的 recovery dialog 并列两个选项，另有动态说明和可选指令。
- **具体改进建议**：先问用户目标：“计划没问题，只需重跑”或“方案需要改变”；选择后再展示对应影响。默认不替用户预选高影响动作。

### 问题 TEXE-4：Activity 同时承担实时反馈、审计记录和工具细节

- **问题描述**：Activity 组合 run divider、node header、tool lifecycle、plan phase、execution header 和单事件。虽然按生命周期合并，但仍同时服务“现在发生什么”和“之后追溯什么”两种需求。
- **严重级别**：P2
- **受影响用户/场景**：运行中只想确认系统没有停滞，以及完成后追查步骤的用户。
- **仓库中的界面或交互证据**：`ActivityTimeline`/`ActivityRailTimeline` 渲染多类事件，工具 started/progress/completed 合并，运行间用 divider 区分。
- **具体改进建议**：默认显示产品级活动摘要；工具细节折叠到每个节点。运行中突出最新状态与耗时，完成后切换为可追溯时间线。

### 问题 TEXE-5：真实双栏滚动与移动端节点操作体验无法确认

- **问题描述**：静态结构显示多个独立滚动区、最小高度和桌面双栏，但无法确认在不同视口是否出现滚动争夺、当前操作离开首屏或横向溢出。
- **严重级别**：P1（条件性）
- **受影响用户/场景**：桌面长计划、平板和手机上处理 checkpoint 的用户。
- **仓库中的界面或交互证据**：运行态使用 Navigator/Inspector 双栏，多个容器带 overflow；真实布局**无法从仓库验证**。
- **具体改进建议**：需要 `1440×900`、`1024×768`、`390×844` 的运行截图和操作录像，验证主操作持续可见、每屏只有一个主要滚动容器、手机无横向滚动。

## 7. Task 工作区：结果终结、验收与后续动作

覆盖组件：`ResultLifecyclePanel`、`RequestResultChangesCard`、`TaskResultFollowUpPanel`，以及 `workspace-registry.tsx` 中的结果组件：`ResultSummary`、`ResultHero`、`ResultDeliverable`、`ResultInsight`、`ResultActionPlan`、`ResultCaveats`、`ResultEvidence`、`ResultOverview`、`ResultReadiness`、`ResultSection`、`ResultMetricGrid`、`ResultComparison`、`ResultTimeline`、`ResultChecklist`、`ResultChangeSummary`、`FileView`、`WorkspaceArtifactList`、`WorkspaceActionGroup`、`WorkspaceActionCard`、`WorkspaceTable`、`VirtualizedCsvPreview`。覆盖状态：终结中、终结失败/重试、结果可验收、接受中、接受失败、已接受折叠/展开、请求修改、追问、创建后续 Task、原会话可用/压缩/不可用、空回答、提交中、错误和创建成功。

### 问题 TRESULT-1：结果内容与验收控制的主次关系可能反转

- **问题描述**：`ResultLifecyclePanel` 固定在结果表面顶部，验收控制可能比结果本身更先占据注意力。用户尚未阅读证据和限制就先看到 Accept result。
- **严重级别**：P1
- **受影响用户/场景**：验收长报告、多文件或包含 caveats 的结果用户。
- **仓库中的界面或交互证据**：result_focus 布局先渲染 sticky `ResultLifecyclePanel`，再渲染 AI-authored final result surface。
- **具体改进建议**：顶部仅显示“待验收”状态和阅读进度；接受/要求修改操作在结果末尾提供主入口，顶部可保留次级快捷入口。若存在 caveats，接受前需明确确认已查看。

### 问题 TRESULT-2：结果组件目录丰富，但没有保证长结果的固定阅读顺序

- **问题描述**：结果可组合 Hero、Summary、Evidence、Deliverable、Metrics、Timeline、Checklist 等多种块。灵活性高，但用户无法预期“结论、依据、限制、文件、下一步”出现在哪里。
- **严重级别**：P1
- **受影响用户/场景**：比较不同 Task 结果、快速判断可信度和可执行性的用户。
- **仓库中的界面或交互证据**：`workspace-registry.tsx` 注册大量可组合结果组件；最终结果由这些组件构成。
- **具体改进建议**：规定最低阅读骨架：结论/状态 → 关键发现 → 交付物 → 证据与限制 → 下一步。组件可适配内容，但不能打乱这些语义层级。

### 问题 TRESULT-3：接受结果后的多种后续动作聚集在同一展开区

- **问题描述**：接受后可追问、创建后续 Task、从结果创建 Goal，并可能显示 Goal knowledge。用户完成关键验收后立即面对新的选择集，完成感被打断。
- **严重级别**：P2
- **受影响用户/场景**：验收结果后只想离开，或尚不确定下一步的用户。
- **仓库中的界面或交互证据**：`ResultLifecyclePanel` 在 accepted 展开态嵌入 `TaskResultFollowUpPanel`，并支持 createGoalAction；追问面板有 Ask/Create task 两模式。
- **具体改进建议**：接受成功后先显示简短确认；将“追问 / 创建下一任务 / 创建 Goal”作为三个次级动作，不自动展开复杂表单。

### 问题 TRESULT-4：创建后续 Task 暴露会话策略，超出普通用户任务心智

- **问题描述**：用户需要选择 handoff to a new session 或 use clean context，并理解 source session、compacted、prompt cache 等概念。这些是执行上下文决策，不是用户目标。
- **严重级别**：P1
- **受影响用户/场景**：从已接受结果创建下一项工作的非技术用户。
- **仓库中的界面或交互证据**：`TaskResultFollowUpPanel` 的 Create task 模式显示 Context strategy、handoff/fresh 单选，以及 session health/cache 文案。
- **具体改进建议**：默认由产品选择可靠策略，用户只描述下一步；将高级上下文设置放入可展开选项，并改成用户结果语言，如“沿用本次背景”与“仅使用最终结果”。

### 问题 TRESULT-5：结构化结果的真实可读性无法从仓库验证

- **问题描述**：仓库可确认 Markdown、文件、表格、虚拟化 CSV 等呈现能力，但无法确认真实结果在不同长度和视口下是否具有稳定层级、适当字号与可读列宽。
- **严重级别**：P1（条件性）
- **受影响用户/场景**：阅读长 Markdown、宽 CSV、多交付物结果的用户。
- **仓库中的界面或交互证据**：结果 registry 提供多种组件；实际组合和视觉效果**无法从仓库验证**。
- **具体改进建议**：用短结果、长报告、宽 CSV、多个文件四组真实样本，在三种目标视口截图验证；重点检查标题重复、首屏结论、表格横向滚动和验收操作位置。

## 8. Goal 列表与创建：`/:lang/goals`

覆盖组件：`GoalListPage`、`CreateGoalDialog`、`GoalCard`、`GoalSection`、`GoalListEmpty`。覆盖状态：加载、错误、ongoing、archive、attention/progress/stable 分组、默认空态、归档空态、创建、提交中、创建失败和创建成功导航。

### 问题 GLIST-1：创建 Goal 强制同时定义 First Task

- **问题描述**：用户不能只记录一个长期结果，再稍后规划工作；创建门槛从“定义目标”变成“同时承诺第一项行动”。
- **严重级别**：P1
- **受影响用户/场景**：目标尚处于探索期、需要先整理准则或资料的用户。
- **仓库中的界面或交互证据**：`CreateGoalDialog` 要求 title 与 firstTaskTitle 均非空，提交时一并创建 Goal 与首个 Task。
- **具体改进建议**：允许“仅创建 Goal”和“创建并添加首个 Task”两条路径；默认根据用户输入情况选择，而不是强制。

### 问题 GLIST-2：Outcome、Additional context 与 First Task 的边界不够清楚

- **问题描述**：三个字段都可能被用户写成相似句子，导致 Goal 与 Task 重复，后续页面难以形成清晰层级。
- **严重级别**：P2
- **受影响用户/场景**：首次创建 Goal、尚未理解 Goal/Task 区别的用户。
- **仓库中的界面或交互证据**：`CreateGoalDialog` 同时收集 Goal outcome/title、additional context/description 和 first task title。
- **具体改进建议**：用示例表达差异：Goal 是长期可验证结果，Context 是约束/背景，First Task 是近期可完成动作；表单中实时预览三者在 Goal 页的位置。

### 问题 GLIST-3：用户不可见的固定高优先级削弱优先级可信度

- **问题描述**：新建 Goal 的首个 Task 固定为 High，但表单不让用户选择或解释。多个 Goal 都以 High 开始后，优先级失去区分意义。
- **严重级别**：P2
- **受影响用户/场景**：同时管理多个 Goal、依赖优先级安排工作的用户。
- **仓库中的界面或交互证据**：`CreateGoalDialog` 创建首个 Task 时使用固定 High；创建 Goal 内 Task 也采用固定 High。
- **具体改进建议**：若产品规则是 Goal Task 默认高优先级，应在表单中明确显示并允许调整；否则取消该用户不可见的排序信号。

### 问题 GLIST-4：生命周期与 attention/progress/stable 双层分组增加定位成本

- **问题描述**：页面先分 ongoing/archive，ongoing 内再分 attention/progress/stable；Goal 卡片又显示 Draft/Active/Paused/Achieved/Stopped。用户需要同时理解三套状态维度。
- **严重级别**：P1
- **受影响用户/场景**：拥有多个不同阶段 Goal、希望快速找到下一步的用户。
- **仓库中的界面或交互证据**：`GoalListPage` 的 Tabs 区分 ongoing/archive；`goalListGroup` 按 attention/activity 分组；`GoalCard` 显示生命周期状态。
- **具体改进建议**：ongoing 默认按“需要你处理 / 其余进行中”两组；生命周期用轻量标签保留。progress/stable 改为排序依据，不作为显式分类。

### 问题 GLIST-5：Goal 卡片的状态、活动、统计与描述竞争

- **问题描述**：卡片同时承载状态、attention/activity 色彩、描述、Task/criteria 统计和 next review，核心结果与下一步不够突出。
- **严重级别**：P2
- **受影响用户/场景**：扫读多个 Goal、判断今日投入方向的用户。
- **仓库中的界面或交互证据**：`GoalCard` 呈现上述多类摘要，且列表分组本身也表达 attention/activity。
- **具体改进建议**：卡片固定显示 Goal outcome、当前主要动作和一条进度；其余统计进入详情。分组已表达 attention 时，卡片不重复同等强度的视觉信号。

## 9. Goal 工作区总览与 Work：`/:lang/goals/:goalId`

覆盖组件：`GoalWorkspacePage`、`GoalSectionNavigation`、`ActiveSummary`、`OperationalBriefCard`、`FocusQueue`、`TaskRow`、`TaskGroupSection`、`CreateTaskDialog`、`PrimaryAction`。覆盖状态：Draft、Active、Paused；Overview、Work；空 Focus queue、空 Task；Brief 查看/空白自动编辑/保存中/成功/失败；Task 创建；建议名称重命名；resume、pause、stop、add task、continue work、resolve attention。

### 问题 GWORK-1：Overview 同时放置 Focus queue、Brief、Summary 和主操作

- **问题描述**：Overview 首屏既解释当前焦点，又并列任务焦点队列与完整 Operational Brief，下方再显示进度摘要，页面 Header 还有 PrimaryAction。多个“总览核心”竞争。
- **严重级别**：P1
- **受影响用户/场景**：每天打开 Goal、只想知道当前下一步的用户。
- **仓库中的界面或交互证据**：ongoing Overview 渲染 Current focus、`FocusQueue`、`OperationalBriefCard` 和 `ActiveSummary`；`PageHeader` 同时渲染 `PrimaryAction`。
- **具体改进建议**：Overview 第一屏只回答三件事：目标、当前下一步、阻塞原因。Brief 折叠为“策略与约束”，统计进入次级摘要；主操作只保留一个权威位置。

### 问题 GWORK-2：空 Brief 自动进入完整编辑态，首次认知负担高

- **问题描述**：没有 Brief 时直接显示 Outcome、Current focus、Strategy、Constraints 编辑字段，用户尚未开始 Goal 就被要求一次性完善管理结构。
- **严重级别**：P2
- **受影响用户/场景**：刚创建 Goal、只写了 Outcome 和首个 Task 的用户。
- **仓库中的界面或交互证据**：`OperationalBriefCard` 在无 brief 时默认编辑，表单包含四类内容。
- **具体改进建议**：先显示轻量空态“补充 Goal 工作说明”，只要求 Current focus；Strategy/Constraints 按需展开。可从创建时已有内容预填，避免重复输入。

### 问题 GWORK-3：Goal 内 Work 分组与全局 Task 列表不一致

- **问题描述**：Goal Work 使用 attention/active/planned/completed，全局 Task 列表使用 Work/Results 与生命周期筛选。用户在两个页面间切换需要重新学习任务分类。
- **严重级别**：P1
- **受影响用户/场景**：同时从全局 Task 和单个 Goal 推进工作的用户。
- **仓库中的界面或交互证据**：`TaskGroupSection` 明确渲染四组；全局 `TaskListPage` 使用另一套视图和筛选。
- **具体改进建议**：跨页面采用同一用户状态词汇；Goal Work 可在统一状态上增加 Goal 特有的“计划中”，但不改变 Needs you/Running/Ready/Result 的基本含义。

### 问题 GWORK-4：Focus queue 与 Work 页重复呈现 Task，边界不够明确

- **问题描述**：Overview 的 Focus queue 与 Work 的分组列表都可打开 Task。用户不清楚前者是算法推荐、待办摘要还是完整列表子集。
- **严重级别**：P2
- **受影响用户/场景**：发现某 Task 未出现在 Focus queue、或在两个位置看到同一 Task 的用户。
- **仓库中的界面或交互证据**：`FocusQueue` 使用 needsYou/active/newResults；Work 使用 attention/active/planned/completed。
- **具体改进建议**：将 Focus queue 命名为“现在处理”，明确只显示少量优先项，并提供“查看全部工作”；不要复制完整 Task 元信息。

### 问题 GWORK-5：生命周期菜单的失败反馈无法确认

- **问题描述**：Pause、Resume、Stop 是 Goal 高影响操作。仓库可确认按钮进入 pending，但无法确认失败后用户是否在当前视图获得可见、可恢复的反馈。
- **严重级别**：P1（条件性）
- **受影响用户/场景**：网络或服务异常时暂停、恢复、停止 Goal 的用户。
- **仓库中的界面或交互证据**：`PrimaryAction` 提供生命周期菜单；失败后的真实页面反馈**无法从仓库验证**。
- **具体改进建议**：每次生命周期动作都应在 Header 附近显示成功或失败结果；Stop 必须确认并说明保留哪些结果。需在失败场景运行验证。

## 10. Goal 成功准则、Review 与历史

覆盖组件：`CriteriaCard`、`ReviewApplyDialog`、`AchievementDialog`、`GoalHistory`。覆盖状态：无准则、satisfied/proposed/pending、编辑 proposed criterion、选择证据、备注、确认；Review 无 proposal、生成中、失败、Ready、PartiallyApplied、选择应用、拒绝；达成确认、证据必选、提交中、错误；空历史和时间线。

### 问题 GCRIT-1：准则确认把编辑、证据选择、备注和确认压在单条流程中

- **问题描述**：每个 criterion 可能需要理解状态、编辑描述、选择证据、填写 note 并确认。复杂 Goal 有多条准则时，重复操作成本很高。
- **严重级别**：P1
- **受影响用户/场景**：准则多、证据分散、需要定期 Review 的 Goal 用户。
- **仓库中的界面或交互证据**：`CriteriaCard` 支持 satisfied/proposed/pending，proposed 可编辑，另有证据选择、note 与确认操作。
- **具体改进建议**：先做准则清单级审查，再进入单条证据确认；允许批量选择共同证据，但每条保留独立确认。明确“编辑准则”与“确认已满足”是两种动作。

### 问题 GCRIT-2：Proposed criterion 直接变成输入框，审查语义弱

- **问题描述**：AI 或系统提出的准则以普通输入框可编辑，用户不易区分原建议、自己的修改和最终确认内容。
- **严重级别**：P2
- **受影响用户/场景**：需要对 Goal 成功定义保持可追溯理解的用户。
- **仓库中的界面或交互证据**：`CriteriaCard` 对 proposed criterion 提供直接编辑与 review。
- **具体改进建议**：显示“建议内容”和“你的最终版本”对照；编辑后明确标记“已修改，待确认”，确认时简述对 Goal 完成判断的影响。

### 问题 GCRIT-3：Review 对话框同时承担生成、选择、应用和拒绝

- **问题描述**：一个对话框覆盖无 proposal、Generating、Failed、Ready、PartiallyApplied，并在 Ready 后提供逐项选择、Apply 与 Reject。状态和决策层级过多。
- **严重级别**：P1
- **受影响用户/场景**：周期性 Review Goal、一次收到多条建议的用户。
- **仓库中的界面或交互证据**：`ReviewApplyDialog` 明确包含上述状态和操作，条目还有 decision badge 与 rationale。
- **具体改进建议**：拆成“生成 Review”与“审查建议”两步；Ready 页按影响类型分组，主操作写明将应用 N 项；拒绝整个 proposal 与取消对话框在视觉上分开。

### 问题 GCRIT-4：达成确认列出全部准则，但主要任务是证据与声明

- **问题描述**：达成对话框再次完整列出准则，随后要求选择证据和填写 confirmation。准则多时，真正需要完成的证据选择和声明可能下沉。
- **严重级别**：P2
- **受影响用户/场景**：确认复杂 Goal 达成的用户。
- **仓库中的界面或交互证据**：`AchievementDialog` 依次呈现所有 success criteria、artifact 多选、confirmation 文本和 Achieve 按钮；入口仅在所有准则 satisfied 时出现。
- **具体改进建议**：将准则压缩为“全部 N 项已确认”摘要，可展开核对；首要区域显示证据选择与最终声明，并清楚说明达成后进入只读归档的影响。

### 问题 GCRIT-5：History 的事件权重取决于时间线阅读，缺少决策摘要

- **问题描述**：时间线适合追溯，却不适合快速回答“Goal 为什么变成现在这样”。重要事件虽可突出，但仍需逐项阅读。
- **严重级别**：P2
- **受影响用户/场景**：长周期 Goal 的回顾者、新加入协作者。
- **仓库中的界面或交互证据**：`GoalHistory` 渲染 timeline，并突出 goal_achieved、result_accepted 等事件。
- **具体改进建议**：在时间线顶部提供“关键决策摘要”，包括最近一次 Review、准则变更、结果接受与生命周期变化；时间线保留完整证据。

## 11. Goal Workbench：Library、Inbox 与 Archived

覆盖组件：`GoalAssetWorkbench`、`AssetTile`、`InboxCandidate`、`AssetOwnershipRecommendation`。覆盖状态：Library、Inbox、Archived；搜索、类型/来源/状态/排序筛选；无资产、筛选无结果、Inbox clear、Archived empty；候选规则匹配/无匹配、AI recommendation 无/生成中/失败/Ready、选择目标、create/append/reject、提交中和错误。

### 问题 GWB-1：Library、Archived 与状态筛选的概念边界重叠

- **问题描述**：顶层有 Library/Inbox/Archived，Library 内又有 active/draft/processing/failed 状态筛选。用户需要区分“视图”“资产生命周期”和“后台处理状态”。
- **严重级别**：P1
- **受影响用户/场景**：寻找草稿、失败导出或已归档资产的用户。
- **仓库中的界面或交互证据**：`GoalAssetWorkbench` 顶层三 Tabs；Library filters 包含 state、kind、source、sort。
- **具体改进建议**：顶层只保留“资产 / 待处理”；Archived 作为资产状态筛选或独立次级入口。processing/failed 应作为任务提醒，不与资产生命周期并列。

### 问题 GWB-2：Archived 的数量和内容语义存在直接混淆风险

- **问题描述**：Archived 视图显示的计数与卡片来源指向全部传入资产，而非在界面上明确表达“仅已归档”。用户可能在归档页看到与 Library 相同对象或错误数量。
- **严重级别**：P1
- **受影响用户/场景**：归档后验证资产是否已移出 Library、恢复旧资产的用户。
- **仓库中的界面或交互证据**：Archived 内容使用 `initialAssets.length` 和 `initialAssets.map`；Library 则单独过滤 `archivedAt`。这是仓库中可见的交互结果证据。
- **具体改进建议**：Archived 只显示明确带归档状态的资产，并显示“已归档 N 项”；卡片提供归档日期与 Restore 主操作。Library 与 Archived 不应重复同一活动资产。

### 问题 GWB-3：Inbox 候选单卡包含过多决策信号

- **问题描述**：候选同时展示类型、规则匹配、来源 Task、change summary、原始内容、AI ownership recommendation、目标资产选择，以及 create/append/reject。用户需要一次完成内容判断、归属判断和版本策略判断。
- **严重级别**：P1
- **受影响用户/场景**：批量处理多个 Task 结果候选的 Goal 用户。
- **仓库中的界面或交互证据**：`InboxCandidate` 与 `AssetOwnershipRecommendation` 组合上述内容和三类处理动作。
- **具体改进建议**：分两步：先判断“是否属于本 Goal”，再决定“新建资产或追加版本”；AI recommendation 作为可解释建议，不与用户主决策同等突出。支持快速处理并保留撤销窗口。

### 问题 GWB-4：候选原始内容不适合结构化结果比较

- **问题描述**：候选内容以固定区域原始文本呈现时，长 Markdown、JSON 或结构化结果难以快速判断与现有资产的差异。
- **严重级别**：P2
- **受影响用户/场景**：将长结果追加到已有资产版本的用户。
- **仓库中的界面或交互证据**：`InboxCandidate` 展示原始内容预览；另有 change summary 和 destination 选择，但缺少与目标版本的内容对照。
- **具体改进建议**：按内容类型使用可读预览；选择“追加版本”后显示新旧摘要和关键差异；默认折叠原始数据。

### 问题 GWB-5：空资产与筛选无结果使用同一表达风险

- **问题描述**：Library 的 `assets.length === 0` 同时可能代表 Goal 从未有资产，或当前查询/类型/来源/状态没有匹配。统一的 noAssets 文案会误导用户。
- **严重级别**：P2
- **受影响用户/场景**：启用多个筛选后看不到资产的用户。
- **仓库中的界面或交互证据**：筛选后的 `assets` 为空即渲染 noAssets；页面另显示 active filters 与 clear filters。
- **具体改进建议**：有活动筛选时显示“没有匹配资产”并以“清除筛选”为主操作；真正零资产时解释资产从已接受 Task 结果进入 Inbox 的路径。

## 12. Goal Workbench：资产详情与编辑 Sheet

覆盖组件：`AssetEditor`、`AssetNavigation`、`AssetContentEditor`、`StructuredResultViewer`、`FormFillEditor`、`FormEditor`、`AssetDetails`。覆盖状态：选择/切换资产、三栏/折叠侧栏、移动端左右 Sheet、Markdown 预览/编辑、Form Fill/Design、结构化结果、文本/文件内容、autosave、manual save、draft available/no draft、publish formal version、下载源文件、导出、版本/草稿/submission、archive/restore、任务影响和操作反馈。

### 问题 GEDIT-1：资产工作区顶部动作过多，草稿与正式版本层级不够强

- **问题描述**：顶部同时存在打开 Assets、打开 Details、Save draft、Publish version、Download source、Export 和 Close。Save 与 Publish 相邻但视觉权重相近，用户可能低估发布正式版本的长期影响。
- **严重级别**：P1
- **受影响用户/场景**：编辑文档/Form 后保存或发布版本的用户。
- **仓库中的界面或交互证据**：`AssetEditor` Header 并列上述操作，并显示 draft available/no draft 与版本号。
- **具体改进建议**：草稿自动保存作为状态，不需要长期主按钮；“发布正式版本”作为唯一承诺动作，点击后显示变更摘要、版本影响与确认。下载/导出移入统一菜单。

### 问题 GEDIT-2：三栏布局信息完整，但默认认知密度过高

- **问题描述**：桌面同时显示资产导航、内容编辑和详情；详情又包含标题、描述、Future Task Impact、类型/版本/角色/来源、versions/drafts/submissions。用户编辑正文时仍被两侧大量信息包围。
- **严重级别**：P2
- **受影响用户/场景**：专注编辑长文档、审查结构化结果的用户。
- **仓库中的界面或交互证据**：`AssetEditor` 在 xl 采用 15rem/内容/19rem 三栏，左右可折叠；`AssetDetails` 包含多组信息和 Tabs。
- **具体改进建议**：默认保留内容区与窄资产导航，详情按需打开；将 Future Task Impact 提升为发布前摘要，而不是埋在长详情中。

### 问题 GEDIT-3：Form 的 Fill / Design 暴露模板结构概念

- **问题描述**：普通用户可能只想填写或查看表单，却需要理解 Fill 与 Design、submission 与 version 的关系。
- **严重级别**：P2（条件性）
- **受影响用户/场景**：非模板设计者使用 Goal 表单资产的用户。
- **仓库中的界面或交互证据**：`AssetContentEditor` 提供 `FormFillEditor` 与 `FormEditor`；真实目标用户是否理解这些术语**无法从仓库验证**。
- **具体改进建议**：默认进入“填写表单”；“编辑表单结构”作为有权限语义的次级模式。需要产品负责人确认主要用户是表单填写者还是模板设计者。

### 问题 GEDIT-4：自动保存反馈与发布反馈可能共享同一消息位置

- **问题描述**：autosave、manual save、publish、export 和失败均通过 Header 附近消息反馈。频繁自动保存可能覆盖用户更关心的发布或导出结果。
- **严重级别**：P2
- **受影响用户/场景**：连续编辑并立即发布/导出的用户。
- **仓库中的界面或交互证据**：`AssetEditor` 使用单一 `message` 显示 draftAutosaved、draftSaved、newFormalVersionCreated、exportReady 或错误。
- **具体改进建议**：自动保存使用稳定、不抢焦点的“已保存”状态；发布与导出使用独立完成反馈，并提供查看新版本或下载结果的后续动作。

### 问题 GEDIT-5：响应式三栏、移动 Sheet 与长内容滚动无法确认

- **问题描述**：静态结构提供桌面折叠栏和移动端左右 Sheet，但无法确认窄屏上资产切换后状态是否保留、多个 Sheet 是否造成方向迷失、长内容是否出现嵌套滚动。
- **严重级别**：P1（条件性）
- **受影响用户/场景**：平板和手机上查看资产、填写表单的用户。
- **仓库中的界面或交互证据**：`AssetEditor` 在 xl 以下使用 Assets/Details 两个 Sheet；真实视觉与滚动行为**无法从仓库验证**。
- **具体改进建议**：在三种目标视口验证资产切换、编辑、打开详情、关闭返回和发布；手机主内容必须只有一个垂直滚动区域，并持续显示当前资产名称与草稿状态。

## 13. Goal 归档：Achieved 与 Stopped

覆盖组件：`PrimaryOutcome`、`StoppedOutcomeArchive`、`ArtifactActions`。覆盖状态：Achieved 的 verified outcome、达成日期、confirmation、primary result、evidence、provenance/version，以及缺 primary result/confirmation/evidence；Stopped 的停止状态/原因、保留结果和来源；归档 Goal 的 Overview/Work/Workbench/Criteria/History。

### 问题 GARCH-1：Achieved 与 Stopped 必须维持不同的结果权威层级

- **问题描述**：两者都是 archive mode，但 Achieved 表示已确认 Outcome，Stopped 仅表示流程终止且可能保留部分结果。若视觉过于相似，用户会把保留结果误当作 Goal 成果。
- **严重级别**：P1
- **受影响用户/场景**：回顾历史 Goal、复用旧结果、向他人展示达成证据的用户。
- **仓库中的界面或交互证据**：Overview 根据 Stopped 渲染 `StoppedOutcomeArchive`，其他 archive 渲染 `PrimaryOutcome`；二者仍共享 Goal Header 与其余 Tabs。
- **具体改进建议**：Achieved 使用“已验证结果”作为首屏主语；Stopped 使用“目标已停止”作为主语，并将保留结果标为“未确认 Goal Outcome”。两者不可仅依赖颜色区别。

### 问题 GARCH-2：Achieved 的证据结构完整，但缺项时的信任表达需明确

- **问题描述**：归档首屏可显示 confirmation、primary result、evidence 和 provenance；若某项为空，用户需要知道是“不适用”还是“未记录”。
- **严重级别**：P1
- **受影响用户/场景**：审计 Goal 达成依据、比较多个历史 Goal 的用户。
- **仓库中的界面或交互证据**：`PrimaryOutcome` 对 primary result、confirmation、evidence 等使用条件分支；缺项后的真实文案与视觉完整性部分**无法从仓库验证**。
- **具体改进建议**：每个信任字段都显示明确状态：“已记录 / 未记录 / 不适用”；没有证据时不可留下看似完整的空白版式。

### 问题 GARCH-3：归档 Goal 仍保留五个工作区 Tabs，回顾主线可能被稀释

- **问题描述**：归档 Goal 仍可访问 Overview、Work、Workbench、Criteria、History。信息完整，但最重要的 Outcome、依据和保留资产与运行期管理视图同等并列。
- **严重级别**：P2
- **受影响用户/场景**：只为查找最终结果或证据而打开归档 Goal 的用户。
- **仓库中的界面或交互证据**：`GoalSectionNavigation` 对 archive 仍渲染五个固定 section；默认 Overview 展示归档结果。
- **具体改进建议**：归档模式使用“Outcome / Assets / History”三层主导航；Task 与 Criteria 作为 Outcome 的支持证据入口，不继续模拟运行期控制台。

## 14. 待产品负责人确认的问题

以下问题无法从仓库确定，不作确定性结论：

1. **Goal 创建是否必须立即产生 First Task？** 若这是核心业务规则，应解释为什么；若只是便捷默认，应允许跳过。
2. **Goal 内 Task 是否应统一固定为 High？** 若优先级用于跨 Goal 排序，固定值会失去意义。
3. **Form 资产主要面向填写者还是模板设计者？** 这决定 Fill/Design 是否应为同级模式。
4. **接受 Task 结果是否代表用户认可其真实性、仅认可其可用性，还是只是结束 Task？** 该定义决定验收文案和后续资产权威。
5. **发布 Goal 资产正式版本后，后续 Task 是否自动使用它？** 若会，发布确认必须展示影响范围；若不会，Future Task Impact 的表达需要调整。
6. **Stopped Goal 的保留结果可否被后续 Task 当作 Goal 知识？** 若可以，必须持续标注“未确认 Outcome”。

## 15. 无法从仓库验证的视觉与交互项

需要运行环境、真实数据或产品说明才能验证：

- `1440×900`、`1024×768`、`390×844` 下 Task 执行双栏、Goal Overview、Workbench 三栏的真实首屏与滚动行为。
- 中文字体、颜色对比、状态色区分、焦点态、hover、动效和视觉美观程度。
- 长 Task 标题、长 Goal outcome、多准则、多证据、宽 CSV、大量资产时的截断与可读性。
- SSE 实时变化时状态区、Activity、结果表面的视觉稳定性。
- 浏览器返回、深链接和刷新后 Tabs、筛选、选中资产、编辑草稿的用户感知连续性。
- Results 来源 Task 筛选是否覆盖全部查询范围。
- 归档 Goal 缺 confirmation/result/evidence 时的真实文案完整度。
- 生命周期操作失败后的用户可见恢复路径。

建议验证材料：三种目标视口的完整页面截图；一条从创建 Task 到接受结果的录屏；一条从创建 Goal 到 Achieved/Stopped 的录屏；包含长 Markdown、宽 CSV、多个候选和多个资产版本的真实样本。

## 16. 覆盖清单

### 路由与页面包装器

| 路由 | 包装器 | 页面/状态 | 报告章节 |
|---|---|---|---|
| `/:lang/tasks` | `TaskListRoutePage` | Work、Results、空态、筛选、批量操作 | §3 |
| `/:lang/tasks/:taskId` | `TaskDetailRoutePage` | 详情、编辑、计划、执行、结果 | §4–§7 |
| `/:lang/goals` | `GoalListRoutePage` | ongoing、archive、创建、空态 | §8 |
| `/:lang/goals/:goalId` | `GoalWorkspaceRoutePage` | Overview、Work、Workbench、Criteria、History、archive | §9–§13 |
| `/:lang/goals/:goalId/workbench/tasks/:taskId` | `GoalTaskInspectorRoutePage` | Goal 内 Task 详情与返回关系 | §2、§4–§7 |

### Task 列表组件与状态

| 组件/状态 | 覆盖章节 |
|---|---|
| `TaskListPage`、`TaskListHero`、`TaskStat`、`TaskFilterBar`、`TaskRow` | §3 |
| 加载、请求失败、默认空态、筛选无结果、Results 无结果 | §3 TLIST-6 |
| Work/Results、状态/日期/来源/优先级/排序、分页 | §3 TLIST-1、TLIST-5、TLIST-7 |
| 选择、批量操作、单项菜单、删除确认、操作反馈 | §3 TLIST-3、TLIST-4 |

### Task 工作区组件与状态

| 组件/状态 | 覆盖章节 |
|---|---|
| `TaskWorkspacePage`、`TaskWorkspaceHeaderEditor`、`TaskWorkspaceHeaderCard` | §4 |
| `TaskWorkspaceEditSection`：编辑、锁定字段、Provider 不可改、proposal、保存反馈 | §4 TDETAIL-3 |
| 删除确认、从头执行确认、Goal 父级路径、知识计数 | §4 TDETAIL-1、TDETAIL-2、TDETAIL-4 |
| `PlanSetupPanel`、`PlanGenerationProgressPanel`、`StageBarCard` | §5 TPLAN-1、TPLAN-2 |
| `TaskWorkspacePlanContent`、`PlanNodeDetailCard`、`PlanReviewSummaryCard`、`PlanReviewDecisionPanel` | §5 TPLAN-3、TPLAN-4 |
| 无计划、准备检查、生成中、失败/恢复、计划审查、接受/修改 | §5 |
| `RunLaunchPanel`、`ExecutionFocusHeader`、`ExecutionNavigator` | §6 |
| `TaskWorkspaceOperationPanel`、`SelectedNodeCue`、`DecisionRecoveryCard`、`ProviderApprovalBanner` | §6 TEXE-1–TEXE-3 |
| running、waiting input、waiting approval、blocked、failed、cancelled、暂停/继续/停止 | §6 |
| `ActivityTimeline`、`ActivityRailTimeline`：run/node/tool/phase/event | §6 TEXE-4 |
| `ResultLifecyclePanel`、`RequestResultChangesCard`、`TaskResultFollowUpPanel` | §7 |
| finalizing、finalization failed/retry、ready、accepting/error、accepted、request changes | §7 |
| Ask follow-up、Create next task、session active/compacted/unavailable、提交/错误/成功 | §7 TRESULT-3、TRESULT-4 |
| Result registry：全部结果块、文件、表格、CSV、`WorkspaceOccurrenceCalendar`、`ResultCollapseProvider`、`CollapsibleBlock`、`MaybeCollapsible`、`WorkspaceTableCell`、`WorkspaceButton`、`WorkspaceDropdownMenu` | §7 TRESULT-2、TRESULT-5 |
| `CheckpointChoiceField`：结构化 checkpoint 选择输入 | §6 TEXE-2 |
| Activity 子行：`NodeHeaderRow`、`SingleEventRow`、`ToolPairRow`、`PlanPhaseEvent`、`PlanGenerationPhaseRow`、`ExecutionHeaderRow`、`RunDividerRow`、`CollapsibleText`、`SpineIcon` | §6 TEXE-4 |
| 计划详情辅助组件：`NodeDetailRow`、`SummaryList` | §5 TPLAN-3 |
| 三种视口真实视觉、滚动、长结果呈现 | §6 TEXE-5、§7 TRESULT-5；**无法从仓库验证** |

### Goal 列表、创建与工作区组件

| 组件/状态 | 覆盖章节 |
|---|---|
| `GoalListPage`、`GoalCard`、`GoalSection`、`GoalListEmpty` | §8 |
| `CreateGoalDialog`：Outcome、Context、First Task、提交/失败/导航 | §8 GLIST-1–GLIST-3 |
| ongoing/archive、attention/progress/stable、默认/归档空态 | §8 GLIST-4、GLIST-5 |
| `GoalWorkspacePage`、`GoalSectionNavigation`、`PrimaryAction` | §9 |
| `ActiveSummary`、`OperationalBriefCard`、`FocusQueue` | §9 GWORK-1、GWORK-2、GWORK-4 |
| `TaskRow`、`TaskGroupSection`、`CreateTaskDialog` | §9 GWORK-3 |
| Draft、Active、Paused、suggested name、resume/pause/stop/add/continue/resolve | §9 |
| 生命周期失败后的可见反馈 | §9 GWORK-5；**无法从仓库验证** |

### Goal Criteria、Review、History 与归档组件

| 组件/状态 | 覆盖章节 |
|---|---|
| `CriteriaCard`：空态、satisfied/proposed/pending、编辑、证据、note、确认 | §10 GCRIT-1、GCRIT-2 |
| `ReviewApplyDialog`：无 proposal、Generating、Failed、Ready、PartiallyApplied、apply/reject | §10 GCRIT-3 |
| `AchievementDialog`：准则、证据、confirmation、提交/错误 | §10 GCRIT-4 |
| `GoalHistory`：空历史、timeline、关键事件 | §10 GCRIT-5 |
| `PrimaryOutcome`、`StoppedOutcomeArchive`、`ArtifactActions` | §13 |
| Achieved/Stopped、结果/confirmation/evidence/provenance 缺项 | §13 GARCH-1、GARCH-2 |
| 缺项真实文案与视觉 | §13 GARCH-2；**无法从仓库验证** |

### Goal Workbench 与资产编辑组件

| 组件/状态 | 覆盖章节 |
|---|---|
| `GoalAssetWorkbench`、`AssetTile` | §11 |
| Library/Inbox/Archived、搜索、类型/来源/状态/排序 | §11 GWB-1、GWB-2 |
| 无资产、筛选无结果、Inbox clear、Archived empty | §11 GWB-2、GWB-5 |
| `InboxCandidate`、`AssetOwnershipRecommendation` | §11 GWB-3、GWB-4 |
| recommendation 无/生成/失败/Ready、create/append/reject、提交/错误 | §11 |
| `AssetEditor`、`AssetNavigation`、`AssetContentEditor`、`AssetDetails` | §12 |
| `StructuredResultViewer`、`FormFillEditor`、`FormEditor` | §12 GEDIT-2、GEDIT-3 |
| autosave/manual save、draft/no draft、publish、download、export、archive/restore | §12 GEDIT-1、GEDIT-4 |
| versions/drafts/submissions、Future Task Impact、三栏/折叠/移动 Sheet | §12 GEDIT-2、GEDIT-5 |
| 响应式布局与长内容滚动 | §12 GEDIT-5；**无法从仓库验证** |

## 17. 建议的产品改进顺序

1. 先建立统一 Task/Result/Asset 生命周期词汇与唯一主状态区，解决 IA-2、TEXE-1、TRESULT-1。
2. 简化 Task 列表与 Goal Overview，只保留用户当前目标和下一步，解决 TLIST-1、GWORK-1、GWORK-4。
3. 重构高影响决策流程：计划接受、执行恢复、结果接受、Goal 达成、资产发布，解决 TPLAN-4、TEXE-3、TRESULT-1、GCRIT-4、GEDIT-1。
4. 简化 Workbench Inbox 和资产导航，解决 GWB-1–GWB-4。
5. 最后统一中文术语，并用真实数据完成三视口视觉与交互验证。
