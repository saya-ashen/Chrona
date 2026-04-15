# Schedule P0 UI Polish Plan

> 当前执行基线：只专注 `/schedule` 的前端 UI / 交互体验，不以现有后端能力为边界。凡是后端暂不支持但对最终可用性重要的能力，允许先做前端占位、假按钮、说明态和 mock 卡片，先把“最终应有的操作面”做出来。

Goal: 把 schedule 页面从“能用的排期页面”推进到“接近最终形态的 planning cockpit”，优先解决创建任务块难用、信息层级混乱、关键操作入口分散、页面可用性不足的问题。

Architecture:
- 保持改动严格在 `src/components/schedule/*` 和必要的 `schedule-page-copy.ts` 内。
- 这轮优先做前端结构、交互、视觉 hierarchy，不新增后端依赖；后端未支持的功能使用 disabled / placeholder / preview 状态表达。
- `schedule-page.tsx` 继续做 orchestration，新增 UI 尽量拆到独立组件。

Tech Stack: Next.js client components, existing schedule UI primitives, Tailwind utility classes, targeted Vitest where useful.

---

## P0 success criteria

完成后，页面应具备以下感受：

1. 用户进入页面后，第一眼就能理解“今天要做什么、有哪些风险、下一步可以点哪里”。
2. 创建一个任务块不再依赖沉重的 `TaskConfigForm`，而是先走轻量 capture flow。
3. timeline 本身像主工作区，而不是一块被各种卡片包围的功能区。
4. 右侧 rail 不只是列表切换，而是一个真正的 cockpit sidebar。
5. 即使部分 AI / automation 还没接后端，UI 上也已经能看到最终目标形态。

---

## Current UX gaps to fix first

### 1. 创建任务块入口不好用

现状：
- timeline 点击后直接进入较重的 `TaskConfigForm`
- command bar 只有一行输入框，缺少可视化引导
- queue / timeline gap / top bar 三处入口没有形成统一体验

P0 目标：
- 所有“创建任务”先进入统一的轻量 quick-create UI
- 高级配置退到第二步，不阻塞首次 capture
- 在时间轴空档、顶部栏、queue 头部都能快速加任务

### 2. 页面 hierarchy 还不够像 cockpit

现状：
- header、timeline、rail、today focus 都是并列卡片
- 关键动作不够集中
- metrics 只是 badge，不足以形成决策感

P0 目标：
- 顶部形成一个清晰的 cockpit header
- 中间 timeline 成为唯一主焦点
- 右侧 sidebar 固定承载 queue / risks / proposals / automation suggestions

### 3. timeline 仍然偏“组件”而不是“工作面板”

现状：
- 空状态、拖拽提示、block affordance 仍较弱
- block 卡片信息量多但操作性不足
- 创建、选中、调整缺少一套一致的视觉反馈

P0 目标：
- block 更像可操作对象，而不是信息展示卡
- 空档、插入点、hover、选中态、resize 态形成统一语言
- timeline 对新用户一眼可理解

### 4. 右侧 rail 过于被动

现状：
- 只是 queue / risks / proposals tab 容器
- 缺少“建议下一步”“自动化建议”“今日策略”等更强引导

P0 目标：
- 右侧变成 task cockpit sidebar
- 除现有列表外，加入 frontend-only 的 suggestions / automation / focus summary 区

---

## Planned UI changes

### Workstream A — Rebuild the top cockpit shell

Objective: 让页面顶部先讲清楚“今天状态 + 快速动作 + 视图切换”。

Files:
- Modify: `src/components/schedule/schedule-page.tsx`
- Modify: `src/components/schedule/planning-header.tsx`
- Modify: `src/components/schedule/schedule-page-copy.ts`
- Create: `src/components/schedule/schedule-cockpit-summary.tsx`

Changes:
1. 把现有 `PlanningHeader` 从 badge 条重构成 3 段式 header：
   - 左：页面标题 + 当前日期 + 今日一句话状态
   - 中：4 个 summary tiles（Today load / Queue / Risks / AI suggestions）
   - 右：主动作（Quick add、Auto arrange、Focus today、Review suggestions）
2. 主动作里允许加入前端占位按钮：
   - `Auto arrange`
   - `Plan with AI`
   - `Create from natural language`
   这些按钮即使后端未接，也先展示按钮、tooltip、coming soon 状态。
3. 将 timeline/list 切换、day switcher 收拢进 header，而不是散在不同 card 中。

Acceptance:
- 用户进入页面第一屏无需滚动即可看到：今日摘要、关键指标、主动作。
- header 看起来像“驾驶舱顶栏”，而不是一个普通信息卡。

### Workstream B — Replace current create-block flow with a two-step capture UI

Objective: 让“创建任务块”变成页面里最快的动作。

Files:
- Modify: `src/components/schedule/schedule-command-bar.tsx`
- Modify: `src/components/schedule/schedule-page.tsx`
- Modify: `src/components/schedule/schedule-page-timeline.tsx`
- Modify: `src/components/schedule/schedule-page-panels.tsx`
- Create: `src/components/schedule/schedule-quick-create-sheet.tsx`
- Create: `src/components/schedule/schedule-create-entry-points.tsx`
- Modify: `src/components/schedule/schedule-page-copy.ts`

Changes:
1. 统一所有创建入口：
   - top header 的 Quick add
   - queue header 的 New task
   - timeline 空档上的 `+`
   - empty day 的 prominent CTA
2. 第一层统一进入 `schedule-quick-create-sheet.tsx`：
   - title
   - when（today / tomorrow / custom）
   - duration chips（30m / 60m / 90m / 2h）
   - priority chips
   - optional preset chips（Debug / Writing / Research / Review）
3. 第二层才进入 advanced config：
   - 在 quick create sheet 里提供 “高级设置” 次级入口
   - 默认不要直接展开 `TaskConfigForm`
4. command bar 升级为“可视化 capture bar”：
   - 输入框
   - today/tomorrow toggle
   - duration pill
   - priority pill
   - presets
   - clear affordance
5. 即使暂时还是调用现有 action，前端也应先把 capture 体验做好；未来再无痛切到更轻的 server action。

Acceptance:
- 用户能在 5~10 秒内创建一个任务块。
- “点击 timeline 空白区域后出现大表单”的体验被弱化或替换。

### Workstream C — Turn the timeline into the dominant work surface

Objective: 让 timeline 成为页面中心，而不是众多模块之一。

Files:
- Modify: `src/components/schedule/schedule-page.tsx`
- Modify: `src/components/schedule/schedule-page-timeline.tsx`
- Modify: `src/components/schedule/schedule-timeline-primitives.tsx`
- Modify: `src/components/schedule/schedule-page-copy.ts`

Changes:
1. 加强 timeline 视觉层级：
   - 放大主区域宽度
   - 减少外围卡片边框干扰
   - 在 desktop 上维持稳定高度与滚动
2. 增加 gap insertion affordance：
   - block 之间 hover 出现 “Add here” 插入条
   - 空白 lane 居中 CTA
3. 强化 block 操作态：
   - hover 显示 drag handle / resize grip / quick actions
   - selected 态更明显
   - risk / ready / waiting 使用更直觉的视觉语义
4. block 信息减法：
   - 默认只显示 title、time、priority/risk 小标识
   - 详细信息移到右侧 inspector 或 hover/reveal
5. 添加 mock 级别的 block quick actions：
   - Split
   - Duplicate
   - Move to tomorrow
   - Ask AI to refine
   前端先做按钮和菜单，未接后端时显示 placeholder feedback。

Acceptance:
- timeline 一眼就是页面主区域。
- block 看起来像可以“拿来操作”的对象，而不是表单记录。

### Workstream D — Rebuild the right rail into a real cockpit sidebar

Objective: 让右侧不只是 tab container，而是持续给出下一步建议。

Files:
- Modify: `src/components/schedule/schedule-action-rail.tsx`
- Modify: `src/components/schedule/schedule-page-panels.tsx`
- Modify: `src/components/schedule/schedule-page.tsx`
- Create: `src/components/schedule/schedule-cockpit-sidebar.tsx`
- Create: `src/components/schedule/schedule-automation-preview.tsx`

Changes:
1. 右侧 sidebar 固定分成 3 层：
   - top: 今日 focus / today strategy summary
   - middle: queue / risks / proposals tabs
   - bottom: automation suggestions / coming soon quick actions
2. 把现有 `TodayFocusCard` 融进 sidebar 顶部，不再像独立 card 散落在页面。
3. 使用已经有的 read model：
   - `planningSummary`
   - `focusZones`
   - `automationCandidates`
4. 即使没有后端动作，也先显示 UI：
   - Auto-run candidates
   - Suggested moves
   - “Review before enabling” CTA
5. 对 queue 卡片做瘦身：
   - 列表默认更 compact
   - 只在展开时显示详细元数据
   - 增加一键“schedule next”/“quick place”前端按钮

Acceptance:
- 用户看右侧就知道：哪些要立刻处理、哪些可自动化、下一步建议是什么。

### Workstream E — Improve list mode and empty states so the page always feels intentional

Objective: 避免 timeline 之外的状态显得像 fallback 页面。

Files:
- Modify: `src/components/schedule/schedule-task-list.tsx`
- Modify: `src/components/schedule/schedule-page.tsx`
- Modify: `src/components/schedule/schedule-page-panels.tsx`
- Modify: `src/components/schedule/schedule-page-copy.ts`
- Create: `src/components/schedule/schedule-empty-states.tsx`

Changes:
1. list mode 也使用 cockpit hierarchy：
   - summary strip
   - grouped sections（Today / Upcoming / Unscheduled / Risk）
2. 为以下状态设计明确空态：
   - no blocks today
   - empty queue
   - no proposals
   - no risks
   - automation not enabled yet
3. 空态必须带 CTA，而不是纯说明文案。
4. 对未接后端能力的区域使用“Preview / Coming soon / Mock suggestion”文案，避免假装功能真实可用。

Acceptance:
- 即使数据为空，页面也像一个完整产品，而不是缺内容。

---

## Recommended implementation order

1. Workstream B — quick create UI first
   - 这是最痛点、收益最大的改动
2. Workstream A — top cockpit header
3. Workstream D — right sidebar cockpit
4. Workstream C — timeline visual/interaction polish
5. Workstream E — list mode and empty states cleanup

---

## Concrete file-level recommendations

### `src/components/schedule/schedule-command-bar.tsx`
- 不再只保留“输入框 + 提交按钮”
- 升级成可视化 capture bar
- 支持 chips / pills / presets / 快捷切换

### `src/components/schedule/schedule-page-timeline.tsx`
- 弱化大表单 inline composer
- 改成触发 quick-create sheet 或 compact popover
- 增加 gap insertion CTA、selected state、hover actions

### `src/components/schedule/schedule-page-panels.tsx`
- queue/risk/proposal 卡片做 compact 化
- TodayFocusCard 并入 sidebar 体系
- 减少“卡片像在堆功能”的感觉

### `src/components/schedule/planning-header.tsx`
- 从 badge header 变成 cockpit header
- 指标从纯 badge 升级到 tile/card
- 主动作集中到右上角

### `src/components/schedule/schedule-action-rail.tsx`
- 从简单 tabs 容器升级成 cockpit sidebar shell
- 支持顶部 summary + 中部 tabs + 底部 automation preview

### `src/components/schedule/schedule-page.tsx`
- 重新组织页面骨架
- 第一屏做到：header -> command/create -> main timeline + sidebar
- today focus 不再单独散落

---

## Out of scope for this P0 pass

以下内容可以先做 UI placeholder，但不要求本轮打通后端：
- 自然语言解析真正落库
- AI 自动排程真正执行
- 自动执行策略保存
- reminder policy 持久化
- queue/block quick actions 真正写入数据库

---

## Verification standard for this P0 pass

1. 主要验证标准不是“后端能力是否全通”，而是：
   - 首屏 hierarchy 是否清晰
   - quick create 是否显著更顺手
   - timeline 是否更像主工作面
   - sidebar 是否有明确 cockpit 感
2. 对新增纯 presentational 组件，优先做 targeted component tests。
3. 如果某项只做 placeholder，也要确保：
   - 有明确文案说明
   - 不误导用户为已正式可用
   - hover / disabled / preview 状态完整

---

## Next execution suggestion

从 `Workstream B — quick create UI first` 开始实现。

首批最值得动的文件：
- `src/components/schedule/schedule-command-bar.tsx`
- `src/components/schedule/schedule-page.tsx`
- `src/components/schedule/schedule-page-timeline.tsx`
- `src/components/schedule/schedule-page-copy.ts`
- `src/components/schedule/schedule-page-panels.tsx`

因为“创建任务块不好用”是当前最大痛点，而且它会直接带动 header / timeline / sidebar 的重组。 
