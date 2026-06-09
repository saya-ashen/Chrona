# Task Workspace 布局与信息架构重设计

> 本文档聚焦 task workspace 页面的**信息架构（IA）与布局**重设计，目标是解决三个面板
> （Header / Command Center / Node Details）之间的**职责重复、动作分裂、节点详情遮挡图**
> 三个核心可用性问题。
>
> 与 [`task-workspace-refactor-plan.md`](./task-workspace-refactor-plan.md) 的关系：
> 那份文档聚焦 **json-render 迁移**（把手写 JSX 迁到 `SpecRenderer` + 构建器），且其中对
> tab 结构的描述基于更早的代码状态（Command Center 4 tab、Node 含 Action tab），现已部分过时。
> 本文档是**布局层**的规划，与迁移工作正交：迁移让组件「可规格化」，本文档决定这些组件「放在哪、归谁管」。
> 两者可并行推进，本文档的 Phase 划分已考虑与迁移工作的协同点。

---

## 一、当前状态速览（对齐现行代码）

### 页面三段式结构

来源：`apps/web/src/components/tasks/workspace/page/task-workspace-page.tsx`

```
┌─ TaskWorkspaceHeaderCard（shrink-0，常驻顶部）──────────────────────────────┐
│  标题 / 用户状态 Badge / 任务状态 / 优先级 / occurrence 选择器               │
│  Plan 按钮(Generate·Accept·Regenerate) · Start · Pause · Stop · More · Edit │
└────────────────────────────────────────────────────────────────────────────┘

┌─ TaskWorkspacePlanSection（flex-1）─────────────────────────────────────────┐
│  [stale / permission / recovery 警告条]                                     │
│                                                                            │
│  ┌─ 主内容网格  xl:[1fr | 400px]  2xl:[1fr | 440px] ──────────────────────┐ │
│  │  ┌─ Plan Graph（TaskWorkspacePlanContent）─┐  ┌─ Command Center ──────┐│ │
│  │  │  图 / 空状态                            │  │  ● 标题 + 进度条       ││ │
│  │  │  data-plan-graph-surface               │  │  [Now | Output | Trail]││ │
│  │  └─────────────────────────────────────────┘  └────────────────────────┘│ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌─ 底部预留行（h-72px，pointer-events-none）─────────────────────────────┐ │
│  │  TaskWorkspaceNodeDetailPanel（variant="drawer"）                       │ │
│  │   折叠：60px pill / 展开：fixed 覆盖层 h-[min(76vh,720px)]              │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

### 三个面板的 tab 现状

| 面板 | 文件 | tabs |
|---|---|---|
| Command Center | `execution/task-workspace-execution-overview.tsx` | **Now / Output / Trail** |
| Node Details | `execution/task-workspace-node-detail-panel.tsx` | **Result / Activity / Details** |
| Header | `page/task-workspace-header-card.tsx` | 无 tab，按钮组 |

### 关键交互机制

- **Now tab 承载主操作**：`primaryAction` 可能是 generate / accept-or-regenerate / start-plan /
  current-operation（checkpoint），由 `task-workspace-plan-section.tsx` 的
  `resolveCommandCenterPrimaryAction` 决定，渲染进 Now tab（`task-workspace-execution-overview.tsx:256`）。
- **Now tab 自动抢焦点**：`needsNow` 由 false→true 时强制 `setActiveTab("now")`
  （`task-workspace-execution-overview.tsx:134`）。
- **Node Drawer 状态机**：`model/task-workspace-node-drawer-machine.ts`，
  collapsed/expanded 两态；点击图节点 arm `shouldAutoOpen`，选中则展开；点击外部折叠。
- **Drawer 定位**：展开态是 `fixed` 覆盖层，用 `ResizeObserver` 把 `drawerFrame`（left/width）
  对齐到左列（`task-workspace-plan-section.tsx:371-392`）。

---

## 二、核心问题诊断

### 问题 1：三个面板重复表达「动作 / 结果 / 活动」，仅 scope 不同且不可见

把三个面板的内容按语义对齐，会发现它们在重复同样三件事：

| 语义 | Header | Command Center | Node Details |
|---|---|---|---|
| **下一步动作** | Start/Pause/Stop + Plan 按钮 | **Now**（accept / 审批 / checkpoint） | （选中节点的可执行操作） |
| **产出结果** | — | **Output**（最近完成节点结果 + artifacts） | **Result**（选中节点结果） |
| **发生了什么** | — | **Trail**（任务级活动流） | **Activity**（节点级活动流） |

「节点结果」同时出现在 Command Center 的 Output 和 Node 的 Result；活动流分散在 Trail 与 Activity。
区别仅是 **task-scope vs selected-node-scope**，但界面没有任何视觉信号表达这个差异。
→ 用户不知道该去哪看、哪个是权威来源。**这是「不好用」的根因。**

### 问题 2：「下一步动作」被切碎到三处

执行一个任务时，操作可能落在 Header 的 Start、Command Center「Now」tab、以及节点抽屉。
最关键、最有时效性的「需要我操作」反而藏在一个 **tab 后面**；`needsNow` 还会强制切 tab，
把正在看 Trail 的用户硬拽走，造成打断。

### 问题 3：Node Details 展开时遮挡了它所属的图

展开态是 `fixed inset-x-2 bottom-2 h-[min(76vh,720px)]` 的覆盖层
（`task-workspace-node-detail-panel.tsx:299`）。节点详情本质是「图里某节点」的详情，
但展开后盖住了整张图——**用户读节点详情时看不到该节点在图中的位置与上下游**，
而这正是用户来看图的理由。典型的「模态盖住上下文」。

### 问题 4：底部抽屉实现脆弱且占空间

- 全局 capture 阶段 `document click` + `ResizeObserver` 对齐 fixed 覆盖层
  （`task-workspace-plan-section.tsx:354-392`），点击外部即折叠，易与用户操作打架。
- 无论折叠与否都预留 72px（pill 仅 60px），短屏浪费纵向空间。
- 折叠 pill 显示「current operation node」，展开看的可能是「selected node」，两种语义混在一个控件里。

### 问题 5：命名是行话

`Command Center / Now / Output / Trail` 对用户抽象，第一眼无法建立「审批在 Now、结果在 Output、
历史在 Trail」的映射。

### 问题 6：响应式断点割裂

两列网格只在 `xl` 生效；xl 以下全部纵向堆叠（图 → Command Center → 浮动抽屉）。
笔记本（1280–1440）上 400px 固定宽占比偏大，宽窄屏体验差异明显。

---

## 三、目标信息架构

核心心智模型：**图（Graph）是主轴；选中节点需要一个「检视器」；「需要我做什么」是最高时效信息，必须常驻不可藏。**

由此推导出三条不变量（invariants）：

1. **单一动作来源（Single source of action）**：「下一步动作」只在一个常驻位置出现，永不藏在 tab 后。
2. **scope 唯一化（One inspector, scope-aware）**：「结果 / 活动」只有一份呈现区，内容随「当前 scope = 任务 or 选中节点」切换，scope 始终可见、可逆。
3. **检视不遮挡上下文（Inspect without occluding）**：查看节点详情时图始终可见，二者并排而非叠加。

---

## 四、推荐方案：右栏 = 上下文检视器 + 常驻动作条

将「右栏 Command Center 三 tab」与「底部 Node Details 抽屉」**合并为单一右栏**，并把「Now」提为常驻条。

### 目标布局（xl 及以上）

```
┌─ Header（保留；仅全局管理动作：Pause/Stop/Edit/Delete/occurrence）────────────┐
└──────────────────────────────────────────────────────────────────────────────┘

┌─ TaskWorkspacePlanSection ────────────────────────────────────────────────────┐
│  [stale / recovery 警告条]                                                      │
│  ┌─ Plan Graph（1fr）──────────────────┐  ┌─ 右栏 检视器（clamp 360–460px）──┐ │
│  │                                     │  │ ⚠ Action 条（仅在有动作时出现）   │ │
│  │   选中节点高亮，始终可见             │  │   accept / 审批 / checkpoint /    │ │
│  │                                     │  │   start  → [主按钮]               │ │
│  │                                     │  ├──────────────────────────────────┤ │
│  │                                     │  │ Scope 指示：正在看「整个任务」     │ │
│  │                                     │  │   或「节点 X」 [← 返回任务总览]   │ │
│  │                                     │  ├──────────────────────────────────┤ │
│  │                                     │  │ 检视器主体（随 scope 切换）        │ │
│  │                                     │  │  · 任务 scope：进度 + 最新产出 +   │ │
│  │                                     │  │    Trail（任务级活动）            │ │
│  │                                     │  │  · 节点 scope：Result / Activity / │ │
│  │                                     │  │    Details（选中节点）            │ │
│  └─────────────────────────────────────┘  └──────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────┘
```

### 这一步解掉的问题

| 改动 | 解决的问题 |
|---|---|
| **删除底部浮动抽屉**，节点详情移入右栏 | 问题 3（遮挡）、问题 4（脆弱定位 + 72px 浪费） |
| **右栏 scope-aware**：任务级与节点级共用一块呈现区 | 问题 1（结果/活动重复）——从根上消除两份 |
| **「Now」升级为常驻 Action 条**，仅在有动作时出现，永不藏 tab | 问题 2（动作分裂）+ 移除自动跳 tab 打断 |
| **统一主操作入口**：accept/审批/checkpoint/start 全走 Action 条 | 问题 2 |
| **右栏宽度 `clamp()`** 替代固定 400/440 | 问题 6（笔记本占比） |
| **重命名**：Output→结果、Trail→活动、Now→待办、Command Center→执行 | 问题 5 |

### scope 切换规则

| 触发 | scope 变化 |
|---|---|
| 页面加载 / 无选中节点 | 任务 scope（进度 + 最新产出 + 任务级活动） |
| 点击图中节点 | 节点 scope（高亮该节点，右栏切到 Result/Activity/Details） |
| 点击「← 返回任务总览」/ 点击图空白 | 回到任务 scope |
| 执行推进到新当前节点 | **不自动切 scope**（避免抢用户视线）；改为在 Action 条提示「当前节点：X → 查看」 |

> 关键：把「自动跳转」从「切 tab/切 scope」降级为「在常驻 Action 条里给一个可点的提示」，
> 既不丢信息，也不打断用户当前的浏览。

### Action 条行为契约

- 仅当存在可执行项时渲染：`hasAttention || primaryAction.kind ∈ {current-operation, start-plan, accept-or-regenerate, generate}`。
- 内容由现有 `resolveCommandCenterPrimaryAction` 复用（逻辑不变，仅渲染位置从 Now tab 移到常驻条）。
- 多个动作并存时按优先级单条显示：审批/checkpoint > accept > start > generate。
- 无动作时整条隐藏（不占位），右栏直接显示检视器。

---

## 五、组件级改造方案

> 原则：**最大化复用现有逻辑**，本次主要是「搬位置 + 改容器」，而非重写业务规则。
> `resolveCommandCenterPrimaryAction`、`createTaskWorkspaceExecutionConsoleView`、
> 各 `build*Spec` 构建器、`ActionTab` / `useActionSpecRenderConfig` 全部保留。

### 5.1 新增：`TaskWorkspaceInspector`（右栏容器）

新文件：`apps/web/src/components/tasks/workspace/execution/task-workspace-inspector.tsx`

职责：右栏顶层容器，持有 `scope` 状态（`"task" | "node"`），组合：

```
TaskWorkspaceInspector
├─ <ActionRail/>                         // 常驻动作条（problem 2）
├─ <InspectorScopeHeader/>               // scope 指示 + 返回按钮
└─ scope === "task"
     ? <TaskOverviewPanel/>              // 进度 + 最新产出 + 任务级活动
     : <NodeInspectorPanel/>             // Result / Activity / Details（选中节点）
```

- `scope` 由「选中节点是否存在」派生：`selectedDetailNode ? "node" : "task"`，
  加一个用户显式「返回任务总览」的覆盖（清空选中）。
- 取代 `task-workspace-plan-section.tsx` 中的 `<aside>`（行 453-498）与底部 drawer 行（行 501-519）。

### 5.2 新增：`ActionRail`（常驻动作条）

从 `task-workspace-execution-overview.tsx` 的 Now tab 抽出渲染逻辑：

- 输入：`primaryAction: CommandCenterPrimaryAction`、`attention`、`taskId`（给 `ProviderApprovalBanner`）。
- 输出：有动作 → 渲染 `SpecRenderer`（`primaryAction.actionSpec`，复用 `nowHandlers`）+ `ProviderApprovalBanner`；无动作 → `return null`。
- **删除** `needsNow` 自动 `setActiveTab("now")` 那段 `useEffect`（`task-workspace-execution-overview.tsx:133-139`）。

### 5.3 重构：`TaskWorkspaceExecutionOverview` → `TaskOverviewPanel`

- 去掉 tab 容器与 Now tab。
- 保留进度卡（行 208-227）+ 「Output」「Activity」两块内容（去掉 tab，改为纵向堆叠或保留 2-tab）。
  - 由于「结果」与「活动」在任务 scope 下仍是两类信息，可保留**两个 tab：结果 / 活动**（不再有 Now）。
- Trail store / `trailStore` 逻辑（行 147-164）原样保留。

### 5.4 复用：`NodeInspectorPanel` ← `TaskWorkspaceNodeDetailPanel` 的 `variant="panel"` 分支

- `task-workspace-node-detail-panel.tsx` 已支持 `variant="panel" | "rail" | "drawer"`；
  本方案**只用 `panel`**，删除 `drawer` 分支（行 259-330）及其折叠 pill。
- 删除 drawer 相关：`NodeDrawerSize`、`NodeDrawerFrame`、`drawerFrame`、`onDrawerSizeChange`。
- `panel` 分支已是非覆盖、随容器高度自适应的形态，直接放进右栏即可。

### 5.5 删除：Node Drawer 状态机与定位副作用

- 删除 `model/task-workspace-node-drawer-machine.ts`（及其 `.test.ts`）。
- 删除 `task-workspace-plan-section.tsx` 中：
  - `nodeDrawerState` / `nodeDrawerFrame` / `nodeDrawerFrameRef`（行 156-159）
  - `document click` 监听 `useEffect`（行 354-370）
  - `ResizeObserver` 定位 `useEffect`（行 371-392）
  - `isNodeDetailDrawerTarget` / `isPlanGraphTarget` / `data-plan-graph-surface` 相关
- 选中态简化为：`handleSelectedPlanNodeChange` 直接驱动 `scope`，无需 drawer 状态机。

### 5.6 调整：`TaskWorkspacePlanSection`

- 网格从 `xl:grid-cols-[minmax(0,1fr)_400px] 2xl:[…440px]` 改为
  `xl:grid-cols-[minmax(0,1fr)_clamp(360px,28vw,460px)]`（问题 6）。
- 右侧 `<aside>` + 底部 drawer 行 → 替换为单个 `<TaskWorkspaceInspector/>`。
- `min-h-[760px]` 等为容纳 drawer 预留的高度约束可放宽，让右栏与图等高（`xl:h-full`）。

### 5.7 调整：`TaskWorkspaceHeaderCard`（可选，建议）

- 保持现有按钮，但在文案/视觉上弱化「执行类」动作，强调其为「全局管理」：
  把 Start 的主操作语义让位给右栏 Action 条（Header 的 Start 可保留为快捷入口，但不再是唯一入口）。
- 此项为渐进式，不阻塞主改造。

### 5.8 文案（i18n）

`messages.components.taskWorkspace` 与 `task-workspace-page.tsx` 的 `DEFAULT_COPY`：

| key | 现值 | 建议 |
|---|---|---|
| `commandCenter` | Command Center | 执行 / Execution |
| `commandCenterNowTab` | Now | （删除，动作条不带标签或用「待办」） |
| `commandCenterOutputTab` | Output | 结果 / Results |
| `commandCenterTrailTab` | Trail | 活动 / Activity |

---

## 六、次选方案（保留底部形态）

如果决定保留「详情在底部」的版式，至少做到**非遮挡**：

- 把展开态从 `fixed` 覆盖层改为 **docked split**：用 grid row 让图区随抽屉展开而**变矮**（图被挤上去而非被盖住），解决问题 3。
- 折叠态高度归 0 或并入图区，去掉常驻 72px（问题 4 的一半）。
- 仍**无法**解决问题 1（结果/活动两份重复）与问题 2（动作分裂）——这两个需要推荐方案的右栏合并才能根治。

> 结论：次选方案是「最小改动止血」，推荐方案是「根治」。若资源有限可先做次选的 docked split，再逐步收敛到推荐方案。

---

## 七、实施顺序（推荐方案）

### Phase 0：文案重命名（零风险，先行）

- 改 `DEFAULT_COPY` 与 i18n：Output→结果、Trail→活动、Command Center→执行。
- 收益立竿见影，且不依赖结构改动。

### Phase 1：Action 条提取（解问题 2）✅ 已完成

- 新增 `ActionRail`（`execution/action-rail.tsx`），把 Now tab 的 `primaryAction` 渲染搬出为常驻条，钉在进度条上方；Command Center tab 精简为 **Results / Activity**（Now tab 移除）。
- 删除 `needsNow` 自动切 tab 的 `useEffect`（及 `isActionablePrimary`/`showNowBadge`/`useRef`）。
- 内容来源优先级：`commandCenter.documents.now`（server 驱动）→ 否则前端 `buildCommandCenterNowSpec(primaryAction, readiness, attention, runtimeEvents)` 兜底。
- **顺带修复既有回归**：迁移提交 `4348567d` 为 Output/Trail 保留了 `?? build…` 兜底，却把 Now 改成 `documents.now ?? null` 并删除了 `buildCommandCenterNowTabSpec`，导致无 server 文档时前端 `primaryAction`（Generate/Start/Retry/accept/checkpoint）完全不渲染——8 个 plan-section 测试在 HEAD 即失败。Phase 1 以精简版 `buildCommandCenterNowSpec` 恢复该兜底，8 个测试转绿。
- 文件：`execution/action-rail.tsx`（新建）、`execution/build-execution-overview-spec.ts`（恢复 `buildCommandCenterNowSpec` + helpers）、`execution/task-workspace-execution-overview.tsx`、对应 `.test.tsx`。`task-workspace-plan-section.tsx` 未改动（其测试随兜底恢复而转绿）。
- 遗留给 Phase 2：`CommandCenterCopy.nowTab` 已成死字段（保留以免牵动 page/plan-section copy 管线）；「Now 内容含 live runtime events」按现状保留，待 Activity 成为单一来源时再移除。

### Phase 2+3：右栏检视器合并 + 删除底部抽屉（解问题 1、3、4）✅ 已完成

> Phase 2 把节点详情移入右栏后底部抽屉即冗余，故 2、3 合并执行。

- 新增 `TaskWorkspaceInspector`，引入 `scope` 状态（`"task" | "node"`）。
- scope 只跟显式选中的 plan node 走（`selectedPlanNode`），不被 current operation node 抢占；详情 query `enabled` 同样门控在 `Boolean(selectedPlanNode)`。
- 节点 scope：ActionRail + 返回按钮（`Task overview` / 任务总览，`onBackToTask` = 清空选中）+ `TaskWorkspaceNodeDetailPanel`。
- 任务 scope：`TaskWorkspaceExecutionOverview`（结果 / 活动）+ 计划生成面板。
- 删 `task-workspace-node-drawer-machine.ts` 及 `.test.ts`。
- 删 `node-detail-panel` 的 `drawer` / `rail` 分支、collapsed pill、`variant`/`drawerSize`/`drawerFrame` props 及相关类型导出。
- 删 `plan-section` 的 document-click capture / ResizeObserver frame 逻辑及对应 state。
- 网格宽度改 `xl:grid-cols-[minmax(0,1fr)_clamp(22rem,28vw,28rem)]`，min-h 放宽至 `680px`，移除 `data-plan-graph-surface`。
- 测试：`node-detail-panel` / `execution-overview` / `plan-section` 三套件重写为 inspector scope 语义，31 passed。

### Phase 4：Header 动作收敛（解问题 2 收尾，可选）✅ 已完成

- Header 弱化执行动作，确立右栏 Action 条为单一动作来源。
- `actionVariant`：start 从 `default`（亮色主 CTA）降为 `outline` 次级样式，pause 同为 `outline`，stop 保留 `destructive`；start 保留为快捷入口但不再抢主视觉。
- 去掉 start 的 `min-w-24` 额外强调，与其余动作按钮一致。
- planAction primary（生成计划）仍为 `default`——那是计划阶段 CTA，非执行动作，不在收敛范围。

### Phase 5：节点详情覆盖层（解「静默替换」体验问题）✅ 已完成

> 背景：Phase 2+3 让右栏在 task↔node scope 间整块条件替换，但替换是**静默**的——
> 点图里某节点右栏内容全变，却无过渡/来源指示，用户感知不到「为何变化、如何解除」。
> 根因是用了「替换」而非「叠加」语义；实际心智模型是「节点详情是图的临时聚焦态，总览才是基态」。

- `TaskWorkspaceInspector` 改为**基态 + 覆盖层**双层：
  - 基态：`TaskWorkspaceExecutionOverview`（总览）**始终挂载**，node scope 时加 `inert` + `aria-hidden`。
  - 覆盖层：node scope 时渲染 `role="dialog"` 的 `absolute inset-0` 面板，叠加在总览之上。
- 覆盖层带明确 header：`◀ 任务总览` 返回 + `正在查看节点 / <节点名>` + `✕ 关闭节点详情`。
- 解除入口三选一：顶部 `✕`、`◀ 任务总览` 按钮、`Esc` 键（`onKeyDown` 捕获）；均回到 `handleBackToTask`。
- slide-in 过渡：`animate-in slide-in-from-right-4 fade-in-0 duration-150` + 背板 `bg-background/95` + `backdrop-blur`，传达「临时进入、可关闭」。
- 焦点管理：覆盖层打开时 `useEffect` 把焦点移到关闭按钮，键盘用户即时可用 Esc。
- 新增 i18n 键：`nodeDetailOverlayAria` / `closeNodeDetail` / `backToTaskOverview` / `viewingNode`（en + zh）。
- 测试：plan-section 专测重写为覆盖层语义（dialog 出现/消失、`✕` 与 Esc 两条解除路径、基态不卸载），三套件 31 passed。

> 与 json-render 迁移的协同：迁移计划的「ResultTab 统一渲染路径」「ArtifactsSpec」等可在
> Phase 2 顺带完成（届时 `TaskOverviewPanel` / `NodeInspectorPanel` 都已是新容器，迁移落点更干净）。

---

## 八、风险与回归点

| 风险 | 说明 | 缓解 |
|---|---|---|
| 选中态语义变化 | drawer 状态机删除后，「current operation node」与「selected node」需明确区分 | scope 只跟 selected node 走；current node 在 Action 条用「查看」提示，不抢 scope |
| 现有测试大量引用 drawer | `*node-detail-panel.test.tsx`、`node-drawer-machine.test.ts`、`plan-section` 测试 | 随 Phase 3 同步重写/删除；Phase 1-2 不动 drawer 以隔离风险 |
| 右栏高度溢出 | 任务 scope 同屏显示进度+结果+活动可能过长 | 任务 scope 内用 2-tab（结果/活动）而非全堆叠；节点 scope 复用现有 tab |
| 窄屏（< xl）堆叠顺序 | 单列时 Action 条应紧跟图、置于检视器之前 | 移动端：图 → Action 条 → 检视器（scope-aware） |
| `commandCenterScopeKey` 重挂载 | 现以 `currentWorkBlock?.id ?? task.id` 作 key 强制重挂（`plan-section.tsx:454`） | 右栏容器保留同一 key 策略 |

---

## 九、不在本次范围

| 项目 | 原因 |
|---|---|
| Plan Graph 本身的渲染 | `TaskWorkspacePlanContent` / `TaskPlanGraphPanel` 不变 |
| `ConfigurationTab`（Details）内部 | 包装 `TaskPlanGraphInspectorDetails`，仅搬容器不改内部 |
| Recovery / stale 警告条 | 含动态 repair handler，保持现状 |
| Header 的编辑/删除/recurrence 交互 | 复杂交互，保持 React，仅做 Phase 4 的动作收敛 |
| 后端 / contracts / command-center spec 构建 | 本次纯前端布局；`get-task-command-center` 输出沿用 |

---

## 十、变更影响范围（推荐方案）

```
apps/web/src/components/tasks/workspace/
  execution/
    task-workspace-inspector.tsx          ← 新建（右栏容器 + scope）
    action-rail.tsx                       ← 新建（常驻动作条）
    task-workspace-execution-overview.tsx ← 重构为 TaskOverviewPanel（去 Now/去自动切 tab）
    task-workspace-node-detail-panel.tsx  ← 删 drawer 分支，仅留 panel
  sections/
    task-workspace-plan-section.tsx       ← 替换 aside+drawer 为 Inspector，网格宽度 clamp
  model/
    task-workspace-node-drawer-machine.ts ← 删除（含 .test.ts）
  page/
    task-workspace-page.tsx               ← DEFAULT_COPY 文案（Phase 0）
    task-workspace-header-card.tsx        ← Phase 4 动作收敛（可选）

i18n: messages.components.taskWorkspace   ← 重命名 tab/标题文案

测试：同步更新/删除
  task-workspace-node-detail-panel.test.tsx
  task-workspace-node-drawer-machine.test.ts（删除）
  task-workspace-execution-overview.test.tsx
  sections/task-workspace-plan-section.test.tsx
  page/task-workspace-page.test.tsx / task-workspace-msw.test.tsx
```
