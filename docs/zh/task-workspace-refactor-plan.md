# Task Workspace 重构规划

> 本文档描述 task workspace 页面的两项并行工作：
> 1. **布局与职责重组** — Command Center 和 Node Detail Panel 的 tab 结构调整
> 2. **json-render 迁移** — 将剩余手写 JSX 组件迁移到 `SpecRenderer` + 规格构建器

---

## 一、当前状态速览

### 页面整体布局（xl 及以上）

```
┌─ TaskWorkspaceHeaderCard ──────────────────────────────────────┐
│  任务标题 / 状态 / Start·Pause·Stop / 编辑展开                  │
└────────────────────────────────────────────────────────────────┘
  ProviderApprovalBanner（条件渲染）

┌─ TaskWorkspacePlanSection ─────────────────────────────────────────────────┐
│ ┌─ 状态警告条（stale / permission / recovery 等）────────────────────────┐  │
│ │                                                                        │  │
│ ├─ 主内容网格 [graph 区 | sidebar 352px] ────────────────────────────────┤  │
│ │  ┌─ TaskWorkspacePlanContent ──┐  ┌─ Command Center ──────────────────┐│  │
│ │  │  Plan Graph / 空状态        │  │  [Now|Result|Artifacts|Activity]  ││  │
│ │  │                            │  │  + 可选 TaskPlanGenerationPanel    ││  │
│ │  └────────────────────────────┘  └───────────────────────────────────┘│  │
│ │                                                                        │  │
│ └─ 底部 drawer 行（高度 60px，用于定位 Drawer）────────────────────────  │  │
│    └─ TaskWorkspaceNodeDetailPanel（variant="drawer"，悬浮叠层）          │  │
└────────────────────────────────────────────────────────────────────────────┘
```

### 已完成 json-render 迁移的组件

| 组件 | 构建器 | 说明 |
|---|---|---|
| `WorkspaceActivityFeed` | `buildActivitySpec` | 完全迁移 |
| `ActionTab` | `buildActionSpec` | 完全迁移，含 action handlers |
| `ResultTab`（有 `kind:"ui"` 输出时） | AI 生成的 spec | 部分迁移 |

### 尚未迁移的组件（手写 JSX）

**Command Center（`task-workspace-execution-overview.tsx`）：**

| 子组件 | 说明 | 迁移难度 |
|---|---|---|
| `CurrentOperationCard` | 展示当前操作 + 通过 `actionControls?: ReactNode` 注入任意 React 节点 | 高（含嵌入式 React controls） |
| `LatestResultSummaryCard` | 纯展示型：标题/状态标签/摘要文本/导航链接 | 低 |
| `ArtifactIndexCard` | 工件列表 + 展开/收起 | 低 |

**Node Detail Panel（`task-workspace-node-detail-panel.tsx`）：**

| 子组件 | 说明 | 迁移难度 |
|---|---|---|
| `ResultTab` 空/错误状态 | 无 UI output 时的 fallback JSX | 低（`buildResultSpec` 已存在） |
| `ConfigurationTab` | 包装 `TaskPlanGraphInspectorDetails` | 高（图形化复杂组件） |
| `WorkspaceNodeActionControls` | 已被 `ActionTab` 取代，仍有导出 | 不迁移，直接删除 |

**Plan Section（`task-workspace-plan-section.tsx`）：**

| 区域 | 说明 |
|---|---|
| `primaryAction.actionControls` | 计划验收 UI（Textarea + 按钮），以 ReactNode 注入 Command Center | 需结构性调整，非简单迁移 |
| 状态警告条 / recovery 警告条 | 带动态 handler 的 alert div | 保持 React，不迁移 |

---

## 二、Command Center 布局重设计

### 问题诊断

1. **"Now" tab 职责过重**：既要展示当前操作状态，又要内嵌计划验收（Textarea + 两个按钮）和 checkpoint 动作控件。`actionControls?: ReactNode` 的设计使这个 tab 变成了一个"什么都塞"的地方，无法被规格化。

2. **4 列 tab 在 352px 侧边栏里拥挤**：每个 tab 标签只剩约 80px，移动端更差。

3. **最重要信息藏在 tab 后**：当前操作状态是用户最需要实时关注的，却需要点一次 tab 才能看到。

4. **plan 验收控件位置不合理**：计划是否接受是影响整个执行流程的关键操作，放在一个可折叠 tab 内部的次级区域里，优先级表达失误。

### 方案：分层 Command Center（推荐）

将 Command Center 拆分为**固定头部区域** + **3 个 archive tabs**：

```
┌─ Command Center ────────────────────────────────┐
│  ● Task  Command Center                         │  ← 标题行不变
│                                                 │
│  ┌─ 当前操作状态卡（持久展示，不进 tab）──────────┐ │
│  │  [Operation label]          [status badge]  │ │
│  │  描述文字                                    │ │
│  │  （无 actionControls；需要操作→打开 node 抽屉）│ │
│  └──────────────────────────────────────────────┘ │
│                                                 │
│  ┌─[Result | Artifacts | Activity]─────────────┐ │  ← 3 tabs，不再有 "Now"
│  │  …                                          │ │
│  └──────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

**变化细节：**

| 项目 | 现状 | 改后 |
|---|---|---|
| Tab 数量 | 4（Now/Result/Artifacts/Activity） | 3（Result/Artifacts/Activity） |
| 当前操作展示 | "Now" tab 内 | 固定在 tab 上方，始终可见 |
| Plan 验收 UI | "Now" tab 内 `actionControls` | 移至 `task-workspace-plan-section.tsx` 的独立警告卡区域（图表区上方） |
| Checkpoint 控件 | "Now" tab 内 `actionControls` | 通过 Node Detail Drawer 的 "Action" tab 操作（已完整实现） |
| `actionControls` prop | `CommandCenterPrimaryAction` 的可选 ReactNode | **删除**；Command Center 不再接收嵌入式控件 |

**Plan 验收 UI 新位置：**

```
┌─ TaskWorkspacePlanSection ──────────────────────────────────┐
│  [stale warning / recovery warning]                         │
│  ┌─ 计划验收卡（isPlanAwaitingAcceptance 时显示）──────────┐  │  ← 新增
│  │  "Plan generated"  [Accept Plan]  [指令 Textarea]      │  │
│  │                    [Regenerate with instruction]        │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌─ graph 区 ────────────────────┐ ┌─ Command Center ───────┐  │
│  │  …                           │ │  …                     │  │
│  └──────────────────────────────┘ └────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 持久当前操作状态卡的规格化

这个卡片（原 `CurrentOperationCard` 的纯展示部分）可被 `buildOperationStatusSpec` 构建器输出，通过 `SpecRenderer` 渲染。交互操作（打开 Node Drawer）以 `dispatch-execution` 或页面级 action 处理，不注入 ReactNode。

---

## 三、Node Detail Panel 布局重设计

### 现状

4 tabs：**Result → Activity → Action → Configuration（Details）**

默认 tab 逻辑：
- 有 checkpoint/action → 默认选中 "Action"
- 有 UI 输出或已完成 → 默认选中 "Result"
- 运行中 → 默认选中 "Activity"

### 问题诊断

1. **ResultTab 渲染路径不一致**：有 `kind:"ui"` 输出时走 `SpecRenderer`，无输出时回退到手写 JSX。两套代码同时存在，不统一。

2. **buildResultSpec 已存在但未被 ResultTab 使用**：builder 已支持 `markdown/json/file/link` 输出类型，但 `ResultTab` 跳过了它，只处理 `kind:"ui"` 类型，其他 output 类型（markdown/json/file）产出的内容丢失了。

3. **ConfigurationTab** 包装了 `TaskPlanGraphInspectorDetails`，这是一个图形化组件，迁移成本极高，暂不考虑。

4. **WorkspaceNodeActionControls** 仍被导出，但功能已完全由 `ActionTab` 覆盖，是死代码。

### 方案：统一 ResultTab 渲染路径

**ResultTab 改造目标：**

```
node.resultOutputs 中所有 output：
  kind === "ui"   → 优先使用 AI 生成的 spec（当前逻辑不变）
  kind 为其他类型  → buildResultSpec(outputs) → SpecRenderer（新增路径）
  无任何 output   → buildResultSpec([]) → SpecRenderer 渲染空状态文字
  run error       → buildResultSpec([]) with error Alert 元素 → SpecRenderer
```

这样 `ResultTab` 中不再有任何手写 JSX 的输出区域，空状态和错误状态都通过 spec 表达。

**tab 顺序和命名：**保持不变，"Configuration" 保留但不迁移到 spec（实现成本过高、无明显收益）。

---

## 四、json-render 迁移具体方案

### 4.1 新增构建器

#### `buildOperationStatusSpec`（`packages/ui-protocol/src/builders/build-operation-status-spec.ts`）

输入：
```ts
interface OperationStatusInput {
  label: string;
  description: string;
  statusLabel?: string;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
  isLoading?: boolean;
}
```

输出：一个 `Card`（或带 tone 的 `Alert`）包含 `Heading` + `Text` + 可选 `Badge`。

#### `buildArtifactsSpec`（`packages/ui-protocol/src/builders/build-artifacts-spec.ts`）

输入：
```ts
interface ArtifactItemInput {
  id: string;
  title: string;
  type: string;
  uri?: string;
}
```

输出：`Stack` 包含若干 `Card`（title + type + uri link）。去掉客户端展开/收起状态（改为默认全量展示，或 catalog 层面实现 collapse）。

#### `buildResultSummarySpec`（`packages/ui-protocol/src/builders/build-result-summary-spec.ts`）

Command Center "Result" tab 用的摘要卡，区别于 Node Result（Node 详细输出用 `buildResultSpec`）。

输入：
```ts
interface ResultSummaryInput {
  title: string;
  statusLabel?: string;
  summary?: string;
  sourceNodeTitle?: string;
  isEmpty: boolean;
  emptyMessage: string;
}
```

输出：`Card` 包含 `Heading` + `Badge` + `Text`（摘要/占位文字）。

### 4.2 ResultTab 完整迁移

在 `task-workspace-node-detail-panel.tsx` 的 `ResultTab` 中：

```ts
// 当前：
if (uiOutput) return <SpecRenderer spec={uiOutput.spec} ... />;
return emptyResult; // 手写 JSX

// 改后：
if (uiOutput) return <SpecRenderer spec={uiOutput.spec} ... />;

const nonUiOutputs = allOutputs.filter(o => o.kind !== "ui");
if (nonUiOutputs.length > 0) {
  return <SpecRenderer spec={buildResultSpec(nonUiOutputs)} />;
}

// 空状态 / 错误状态也通过 spec 表达
return <SpecRenderer spec={buildResultEmptySpec({ runError, nodeStatus })} />;
```

`buildResultEmptySpec` 可作为 `buildResultSpec` 的内部分支，或单独的小 helper。

### 4.3 ArtifactIndexCard 迁移

在 `task-workspace-execution-overview.tsx` 中，"Artifacts" tab 内容改为：

```tsx
<SpecRenderer spec={buildArtifactsSpec(artifacts)} />
```

去掉 `ArtifactIndexCard` 组件及其展开/收起本地状态。

### 4.4 LatestResultSummaryCard 迁移（Command Center "Result" tab）

"Result" tab 内容改为：

```tsx
<SpecRenderer spec={buildResultSummarySpec({
  title: latestResult.title,
  statusLabel: latestResult.statusLabel,
  summary: latestResult.summary,
  sourceNodeTitle: latestResult.sourceNodeTitle,
  isEmpty: !latestResult.summary,
  emptyMessage: copy.resultPlaceholder,
})} />
```

去掉 `LatestResultSummaryCard` 组件。

### 4.5 WorkspaceNodeActionControls 删除

该组件已被 `ActionTab` 完全取代：
- 从 `task-workspace-node-detail-panel.tsx` 中删除 `WorkspaceNodeActionControls` 函数
- 从导出中移除
- 在 `task-workspace-plan-section.tsx` 中用 `ActionTab` 替换对它的引用（当前 "current-operation" action 控件注入路径）

---

## 五、catalog 组件扩展

`build-artifacts-spec` 需要表达工件卡片，需评估是否要在 catalog 新增：

| 候选 | 方案 |
|---|---|
| 工件卡片 | 复用 `Card` + `Stack` + `Text` + `Link`（catalog 已有，足够） |
| 操作状态卡 | 复用 `Alert`（已有 tone 属性）或 `Card` + `Badge` |
| 结果摘要卡 | 复用 `Card` + `Heading` + `Text` + `Badge` |

结论：**无需新增 catalog 组件**，用现有原语组合即可覆盖这三个 builder 的输出需求。

---

## 六、实施顺序（推荐）

### Phase 1：清理死代码 + ResultTab 统一渲染路径

- 删除 `WorkspaceNodeActionControls`（已有 `ActionTab` 覆盖）
- `ResultTab` 改用 `buildResultSpec` 处理 non-UI outputs
- `ResultTab` 空/错误状态改为 spec 渲染
- 新增 `buildResultSpec` 对空输入的空状态文字支持（或 `buildResultEmptySpec` helper）

涉及文件：
- `apps/web/src/components/tasks/workspace/execution/task-workspace-node-detail-panel.tsx`
- `packages/ui-protocol/src/builders/build-result-spec.ts`

### Phase 2：ArtifactIndexCard 迁移

- 新增 `buildArtifactsSpec` 构建器 + 测试
- Command Center "Artifacts" tab 改为 `SpecRenderer`
- 删除 `ArtifactIndexCard` 组件

涉及文件：
- `packages/ui-protocol/src/builders/build-artifacts-spec.ts`（新建）
- `packages/ui-protocol/src/builders/index.ts`
- `apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.tsx`

### Phase 3：LatestResultSummaryCard 迁移

- 新增 `buildResultSummarySpec` 构建器 + 测试
- Command Center "Result" tab 改为 `SpecRenderer`
- 删除 `LatestResultSummaryCard` 组件

涉及文件：
- `packages/ui-protocol/src/builders/build-result-summary-spec.ts`（新建）
- `apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.tsx`

### Phase 4：Command Center 布局重组

- 将 plan 验收 UI 从 `CurrentOperationCard.actionControls` 提取到 `TaskWorkspacePlanSection` 的独立 `PlanAcceptanceCard` 组件
- 移除 `CommandCenterPrimaryAction.actionControls` prop
- Command Center 精简：固定头部（当前操作状态） + 3 tabs（Result/Artifacts/Activity）
- 新增 `buildOperationStatusSpec` + 构建器迁移 `CurrentOperationCard` 展示部分

涉及文件：
- `apps/web/src/components/tasks/workspace/execution/task-workspace-execution-overview.tsx`
- `apps/web/src/components/tasks/workspace/sections/task-workspace-plan-section.tsx`
- `packages/ui-protocol/src/builders/build-operation-status-spec.ts`（新建）

---

## 七、不在本次范围内的内容

| 项目 | 原因 |
|---|---|
| `ConfigurationTab` 迁移 | `TaskPlanGraphInspectorDetails` 依赖图形化渲染，迁移成本远高于收益 |
| Recovery/stale 警告条 | 含动态 handler（repair actions），保持 React 更合理 |
| `TaskWorkspacePlanContent` 图表区 | Plan Graph 本身不适合 spec 模型 |
| `TaskWorkspaceHeaderCard` | Header 含复杂交互（编辑展开、删除确认、recurrence picker），保持 React |

---

## 八、变更影响范围

```
packages/ui-protocol/src/builders/
  build-result-spec.ts         ← 修改（增加空状态支持）
  build-artifacts-spec.ts      ← 新建
  build-result-summary-spec.ts ← 新建
  build-operation-status-spec.ts ← 新建
  index.ts                     ← 更新导出

apps/web/src/components/tasks/workspace/execution/
  task-workspace-execution-overview.tsx  ← 重组（移除 actionControls，精简 tabs）
  task-workspace-node-detail-panel.tsx   ← 修改（ResultTab + 删除 WorkspaceNodeActionControls）

apps/web/src/components/tasks/workspace/sections/
  task-workspace-plan-section.tsx        ← 修改（提取 PlanAcceptanceCard，移除 actionControls 注入）
```

测试文件同步更新：对应的 `.test.tsx` 和 `.bun.test.ts` 文件。
