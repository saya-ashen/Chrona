# 前端组件文档

## 组件架构

前端基于 Next.js App Router + React 19，使用 Server Components 加载数据、Client Components 处理交互。

```
app/
├── layout.tsx              # 根布局
├── page.tsx                # 首页 (Server Component)
├── schedule/page.tsx       # 排期页面 (→ 调用 getSchedulePage → 传给 Client Component)
├── inbox/page.tsx          # 收件箱
├── memory/page.tsx         # 记忆控制台
├── tasks/page.tsx          # 任务中心
└── workspaces/[id]/work/[taskId]/page.tsx  # 工作台

components/
├── ui/                     # 基础 UI 组件 (shadcn/ui)
├── control-plane-shell.tsx # 应用外壳
├── schedule/               # 排期页面组件集
├── work/                   # 工作台组件集
├── inbox/                  # 收件箱组件
├── memory/                 # 记忆控制台组件
└── tasks/                  # 任务中心组件
```

## 应用外壳

### `ControlPlaneShell`

全局应用外壳，提供：
- 顶部导航栏
- 侧边栏导航
- h-screen 固定视口布局（无页面滚动）
- 主内容区 flex-1

```tsx
<ControlPlaneShell>
  <SchedulePage />  {/* 各页面填充 flex-1 区域 */}
</ControlPlaneShell>
```

---

## 基础 UI 组件 (`components/ui/`)

| 组件 | 说明 |
|------|------|
| `Button` | 按钮，支持 variant/size 变体 (shadcn) |
| `SurfaceCard` | 卡片容器，统一的边框/阴影/圆角 |
| `StatusBadge` | 状态标签（带颜色编码） |
| `Field` | 表单字段容器（label + input + error） |
| `TaskContextLinks` | 任务相关链接集合 |

---

## 排期页面组件 (`components/schedule/`)

排期页面是组件最丰富的页面，采用 Google Calendar 风格的三栏布局。

### 布局结构

```
┌─────────────────────────────────────────────────────────┐
│ PlanningHeader (顶部工具栏)                              │
│ [日期切换] [视图切换] [指标摘要] [快捷操作]               │
├────────┬──────────────────────────────┬──────────────────┤
│ 左栏    │ 中央                         │ 右栏              │
│ 320px  │ flex-1                       │ 340px            │
│        │                              │                  │
│ Mini   │ ScheduleCommandBar           │ ScheduleAction   │
│ Calendar│ (命令/输入栏)                │ Rail             │
│        │                              │ (操作面板)        │
│ Today  │ DayTimeline                  │                  │
│ Focus  │ (时间线)                      │ - 队列           │
│        │                              │ - 风险           │
│ Week   │ 或 ScheduleTaskList          │ - 建议           │
│ Overview│ (列表视图)                   │ - 冲突           │
│        │                              │ - 分解           │
└────────┴──────────────────────────────┴──────────────────┘
```

### 核心组件

#### `ScheduleCommandBar`
命令栏 / 快速任务创建。

**功能：**
- 自然语言输入解析（时间、优先级）
- AI 自动补全下拉（≥3 字触发）
- 一键创建任务 + 排期

**输入示例：**
```
"下午2点 分析数据 @High"       → 解析时间 + 优先级
"代码审查 PR #42"              → 创建任务（AI 建议补全）
```

#### `SchedulePageTimeline` / `DayTimeline`
Google Calendar 风格的日视图时间线。

**功能：**
- 时间轴压缩（24h → 实际工作时段）
- 拖拽创建排期（点击空白区域）
- 拖拽移动已排期任务
- 拖拽调整时长（resize）
- 键盘微调（↑↓ 调整时间）
- 当前时间指示器
- 冲突高亮

#### `TaskCreateDialog`
Google Calendar 风格的任务创建对话框。

**功能：**
- 居中模态（fixed + translate-50%）
- 半透明背景遮罩（无 blur）
- 标题、日期、时间、描述、优先级
- ESC 关闭、点击遮罩关闭
- AI 自动化建议

#### `ScheduleMiniCalendar`
左侧迷你日历。

**功能：**
- 月视图日期选择
- 日期上的事件指示器
- 快速跳转日期

#### `ScheduleActionRail`
右侧操作面板，多 Tab 切换。

**Tab 页：**
| Tab | 组件 | 说明 |
|-----|------|------|
| 队列 | `ScheduleTaskList` | 未排期任务列表 |
| 风险 | Risk items | 风险项列表 |
| 建议 | `AutomationSuggestionPanel` | AI 建议 |
| 冲突 | `ConflictCard` | 冲突检测结果 |
| 分解 | `TaskDecompositionPanel` | 任务分解 |
| 时段 | `TimeslotSuggestionPanel` | 时间建议 |

#### `ScheduleEditorForm`
排期编辑表单，用于手动调整排期窗口。

#### `ScheduleInlineQuickCreate`
行内快速创建组件（精简版命令栏）。

### 辅助文件

| 文件 | 说明 |
|------|------|
| `schedule-page-types.ts` | 排期页面所有 TypeScript 类型 |
| `schedule-page-utils.ts` | 纯函数工具（时间解析、草稿构建、冲突检测） |
| `schedule-page-copy.ts` | 所有 UI 文案（支持国际化） |
| `schedule-page-panels.tsx` | 面板容器组件 |

---

## 工作台组件 (`components/work/`)

工作台是单任务的深度执行视图。

### 布局结构

```
┌─────────────────────────────────────────────────┐
│ TaskBriefCard (任务概要)                          │
├─────────────────────────────────────────────────┤
│ Tab: 协作推进 | 执行记录                          │
│                                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ ConversationFeed (对话流)                     │ │
│ │ 或 ExecutionTimeline (执行时间线)              │ │
│ │                                             │ │
│ │ [消息卡片1]                                  │ │
│ │ [消息卡片2]                                  │ │
│ │ [...]                                       │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ WorkbenchComposerCard (输入框 - 固定底部)      │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

### 核心组件

#### `WorkPageClient`
工作台页面的主客户端组件。

#### `work-page/` 子目录

| 组件 | 说明 |
|------|------|
| `TaskBriefCard` | 任务概要卡片（标题、状态、优先级、运行时信息） |
| `ConversationFeed` | 对话流（跨执行的会话历史） |
| `WorkbenchComposerCard` | 底部固定的消息输入框 |
| `HeroApprovals` | 待审批卡片 |
| `CurrentStepCallout` | 当前执行步骤提示 |
| `LatestResultClosure` | 最新执行结果展示 |
| `useWorkPageController` | 工作台页面状态管理 Hook |

#### 其他工作台组件

| 组件 | 说明 |
|------|------|
| `TaskShell` | 任务外壳容器 |
| `WorkInspector` | 工作检查器 |
| `NextActionHero` | 下一步操作引导 |
| `ExecutionTimeline` | 执行时间线 |
| `CollaborationStream` | 协作流 |
| `LatestResultPanel` | 最新结果面板 |
| `RunSidePanel` | 执行侧边栏 |
| `TaskPlanSidePanel` | 任务计划侧边栏 |

---

## 收件箱组件 (`components/inbox/`)

| 组件 | 说明 |
|------|------|
| `InboxPageClient` | 收件箱客户端组件 |
| `InboxList` | 待处理项列表（审批、输入请求、排期建议） |

---

## 记忆控制台 (`components/memory/`)

| 组件 | 说明 |
|------|------|
| `MemoryPageClient` | 记忆控制台客户端组件 |
| `MemoryConsole` | 记忆条目列表 + 管理界面 |

---

## 任务中心 (`components/tasks/`)

| 组件 | 说明 |
|------|------|
| `TaskPage` | 任务详情页 |
| `TaskCenterTable` | 任务列表表格（支持筛选/排序） |

---

## Hooks (`hooks/`)

### `useAutoComplete(input)`
AI 自动补全 Hook。

```typescript
const { suggestions, isLoading, error } = useAutoComplete("分析");
// suggestions: AutoCompleteSuggestion[]
```

### `useSmartDecomposition(input)`
AI 任务分解 Hook。

### `useBatchDecompose()`
批量分解 Hook（手动触发）。

### `useSmartTimeslot(input)`
AI 时间建议 Hook。

---

## 国际化 (`i18n/`)

支持中英文双语。

**配置：**
- `config.ts` — 语言列表和默认语言
- `routing.ts` — 路由国际化配置
- `get-dictionary.ts` — 服务端字典加载
- `client.tsx` — 客户端 i18n Hook (`useI18n`)
- `messages/` — 翻译文件

**使用方式：**

```tsx
// 客户端组件
const { messages } = useI18n();
const copy = getSchedulePageCopy(messages.components?.schedulePage);

// 服务端组件
const dict = await getDictionary(lang);
```

**所有排期页面文案集中在 `schedule-page-copy.ts`**，便于统一管理和国际化。
