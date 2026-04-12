# Agent Dashboard P0 Plan

## 目标

在不扩大战线的前提下，把产品从“可演示”推进到“我自己每天能实际使用”。

## 成功标准

满足这 4 条就算 P0 成功：

1. 我每天打开 **Schedule** 就能知道今天该做什么
2. 我能在 **Schedule** 里完成任务创建、排期、调整，而不用频繁跳页
3. 我在 **Work** 里能直接处理运行、输入、审批、失败、结果验收
4. 一次任务能形成最小闭环：
   **创建/排期 → 开始执行 → 介入处理 → 验收结果 → 完成/生成 follow-up**

---

## 范围

### 本次只做

- Schedule 页产品化
- Work 页产品化
- 最小任务收口闭环
- 最小可靠性提示

### 本次不做

- Inbox / Memory / Settings 全量建设
- 多 workspace 运营能力
- 模板系统
- 多 runtime/provider 扩展
- 完整权限/团队协作体系

---

## 设计原则

1. **先自用，不先平台化**
2. **主动作优先，观察信息次之**
3. **能在当前页完成，就不要跳页**
4. **先把闭环跑通，再做复杂能力**

---

## Phase 1：重做 Schedule 为“每日主控台”

### 目标

让 Schedule 成为每天进入系统后的第一工作页。

### 改造重点

#### 1. 重排页面信息层级

改成：

1. 今日焦点
2. 今日时间轴
3. 待排队列
4. 次级信息（proposal / week overview / guide）

#### 2. 收敛顶部导航和噪音

处理这些现有区域：

- `Today / Tomorrow / Current Plan` → 合并成一个日期切换器
- `Planning Guide` → 折叠或移除
- `AI Proposals` → 无数据时不占大面板
- `Week Overview` → 降级到次级区域
- 顶部指标卡 → 精简成真正影响今天决策的内容

#### 3. 强化“今日焦点”

新增一个聚合区，优先显示：

- overdue
- at risk
- waiting for input
- waiting for approval
- 今天已排但还没开始的高优任务

#### 4. 让队列操作更轻

未排队列里直接支持快速编辑：

- 标题
- 优先级
- due date
- prompt/model 是否已配置
- 一键补全 preset

#### 5. 把创建流程做轻

`Create Task Block` 默认只要求：

- title
- priority
- due date

其他：

- model / prompt 由 preset 自动填
- advanced 默认折叠

### 主要文件

- `src/components/schedule/schedule-page.tsx`
- `src/components/schedule/task-config-form.tsx`
- `src/components/schedule/schedule-task-list.tsx`
- `src/app/actions/task-actions.ts`

### 验收标准

- 打开 Schedule 3 秒内知道今天最重要事项
- 1 分钟内能完成新建并排进 timeline
- 不需要看 Planning Guide 才知道怎么用
- proposal 为空时页面不显得“占位”

---

## Phase 2：重做 Work 为“执行决策台”

### 目标

让 Work 不只是观察 run，而是完成执行与收口的主页面。

### 改造重点

#### 1. 顶部状态条收敛

现在 badge 太多。改为：

- 一个主状态：`Running / Needs Input / Needs Approval / Failed / Completed`
- 一个次状态：`Schedule impact` 或 `due risk`

其余信息降到详情区。

#### 2. 把 Next Action 做成绝对主区

页面一打开就明确：

- 当前为什么需要介入
- 现在应该按哪个按钮
- 如果要输入，直接在主区完成
- 如果要审批，直接在主区完成
- 如果失败，直接在主区恢复

#### 3. Shared Output 保留“最新有用结果”

默认只展示：

- 最新 agent 输出
- 最新 artifact
- 与当前决策最相关的信息

不要默认把历史信息和对话细节放在同级。

#### 4. Workstream 保留，Conversation 降级

- 默认主 tab：`Workstream`
- `Conversation` 作为次级排查入口
- 右侧 `RunSidePanel` 折叠或弱化存在感

#### 5. 增加可靠性提示

至少明确显示：

- 上次刷新时间
- sync 是否 stale
- run 卡住多久
- 当前停止原因

### 主要文件

- `src/components/work/work-page-client.tsx`
- `src/modules/queries/get-work-page.ts`
- `src/components/work/execution-timeline.tsx`
- `src/components/work/run-side-panel.tsx`
- `src/app/api/work/[taskId]/projection/route.ts`

### 验收标准

- 进入 Work 后 5 秒内能知道是否需要介入
- 输入/审批/重试都能直接在主区完成
- 不需要先读 conversation 才理解当前状态
- run 异常时能快速知道原因

---

## Phase 3：补最小“结果收口闭环”

### 目标

补上当前最缺的一环：执行结束后能真正收口。

### 必做能力

当 run = `Completed` 时，Work 页直接出现：

1. **Accept Result**
2. **Mark Task Done**
3. **Create Follow-up**
4. **Retry / Re-open**

### 推荐收口流程

#### 结果满意

- Accept Result
- Mark Task Done

#### 结果部分满意

- Accept Result
- Create Follow-up
- follow-up 自动回到 Schedule queue

#### 结果不满意

- Retry / Re-open
- 带着修正 prompt 重新进入执行

### 需要补的数据动作

可能需要新增 server actions：

- `acceptTaskResult`
- `markTaskDone`
- `createFollowUpTask`
- `reopenTask`

### 主要文件

- `src/app/actions/task-actions.ts`
- `src/components/work/work-page-client.tsx`
- 任务相关 query / task projection 逻辑

### 验收标准

- Completed 不再只是 `Review result`
- 可以直接在 Work 页完成任务
- follow-up 能无缝回流到 Schedule

---

## Phase 4：补最小状态模型和约束

### 目标

让 Schedule 和 Work 的状态足够可信，不只是 UI 演示。

### 必补内容

#### Task 层

明确任务主状态：

- Draft
- Ready
- Running
- WaitingForInput
- WaitingForApproval
- Failed
- Completed
- Done

#### Schedule 层

明确排期状态：

- Unscheduled
- Scheduled
- AtRisk
- Overdue

#### 约束

至少加最小校验：

- scheduled end 不能早于 start
- overdue / at risk 逻辑统一
- follow-up 默认进入 unscheduled queue
- 已完成任务不能继续作为 active run 入口

### 验收标准

- Schedule / Work / Task 状态表达一致
- 结束后不会留在奇怪的半完成状态

---

## 推荐实施顺序

### 第 1 周：先做 Schedule

1. 精简顶部结构
2. 做今日焦点区
3. 重排 timeline + queue
4. 简化创建 block 表单
5. proposal / guide / week overview 降级

### 第 2 周：再做 Work

1. 重构 Next Action 主区
2. 收敛 badge / sidebar / tabs
3. 强化 latest useful output
4. 增加最小可靠性提示
5. 补 Completed 收口动作

### 第 3 周：补闭环

1. `Mark Done`
2. `Create Follow-up`
3. `Re-open / Retry`
4. Schedule 接住 follow-up 回流

---

## 优先级排序

### P0 必做

- Schedule 信息层级重排
- Work `Next Action` 重构
- Completed 收口动作
- follow-up 回流 Schedule
- 最小可靠性提示

### P1 再做

- Inbox 真正可用化
- Memory capture/promote
- 搜索 / 批量操作
- 更细的运行配置

---

## 最后一句

这份 plan 的核心不是“把两个页面做更漂亮”，而是让它们形成真正的个人工作闭环。
