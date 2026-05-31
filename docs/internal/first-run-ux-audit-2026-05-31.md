# 首次使用体验审计 / First-Run UX Audit

Date: 2026-05-31

Scope: 从 **Chrona 目标用户视角**（而非工程实现视角）做的新用户首次使用体验
审计。聚焦：用户能否快速理解 Chrona、首次成功体验是否足够快、何处会困惑或
放弃、缺失的反馈/空状态/错误提示/引导、以及已完成但用户感知价值不足的功能。
结论基于对路由、首屏、AI 配置流程、空状态文案、种子数据和词汇体系的代码核查，
不含后端 API 改动建议。

## 核查依据（关键证据）

| 主题 | 证据位置 | 发现 |
| --- | --- | --- |
| 首次运行/路由 | `apps/web/src/router.tsx`、`pages.tsx` | `/` → `/{locale}` → 立即 `<Navigate>` 到 `/schedule`，无 welcome/onboarding/setup 页。 |
| 主导航 | `apps/web/src/components/control-plane-shell.tsx` | 侧边栏仅 Schedule / Tasks / Settings；Inbox、Memory 有路由但不在导航。 |
| Access Key 门 | `access-key-gate.tsx`、`lib/access-key.ts` | 反应式（仅 HTTP 401 后触发），文案不提 key 来源。 |
| AI 配置 | `ai-clients-manager.tsx` | 空状态「Click the button above to add one」，不解释 Hermes 是什么；表单直暴 Base URL/API Key/Timeout/scope。 |
| 首屏 cockpit | `schedule-page-main-panel.tsx:124-130`、`schedule-page-copy.ts:113-116` | 3 个主操作中 `Auto arrange`、`Plan with AI` 均 `disabled: true` + "Coming soon"。 |
| 空状态文案 | `schedule-page-copy.ts` | `emptyDayLane`、`noAiProposals` 等仅描述现状，无 CTA。 |
| 错误文案 | `schedule-page-copy.ts` `quickCreateUnsafeAiInput` | 含内部术语「Local parser fallback was not used」。 |
| 种子数据 | `prisma/seed.ts` | "Demo Workspace" + 开发者黑话任务（task projection / adapter mapping 等）。 |
| 词汇体系 | `apps/web/src/i18n/messages/en.json` | cockpit/projection/runnable/dispatch_task/bindings 等内部术语外露；Tasks vs "Task Center" 命名不一致；tasks/:taskId 与 work/:taskId 双页重叠。 |

## 一、五个核心问题的判断

### 1. 能否快速理解 Chrona 是什么？— 不能

定位语三处不一致，强调点各异：

- README：`planning work and automatically completing scheduled tasks with AI`
- 侧边栏 tagline：`Turn tasks into executable AI work`
- metadata：`turn tasks into plans, place them on your schedule, and move work forward with AI`

新用户落地即进入 `/schedule` 时间轴，无欢迎页、无一句话说明。产品的差异点
（AI 自动推进/执行任务）在首屏完全未传达。

### 2. 首次成功体验是否足够快？— 慢，且路径隐藏

要拿到核心价值（AI 跑任务），用户须自行摸索：

```
Settings → AI Clients → 新建 Hermes → 选 Local/Remote
  → Diagnose/Auto-configure → 绑定 client 到 generate_plan/suggest/chat/dispatch_task
  → 建任务 → 生成 plan → accept → execute
```

首屏（Schedule）没有任何指向该链路的入口。不配置 AI 则所有 AI 功能不可用，
而配置入口埋在 Settings 二级弹窗。这是激活率最大的杀手。

### 3. 何处会困惑或放弃

| 位置 | 问题 |
| --- | --- |
| 首屏 cockpit | 3 个主操作有 2 个（`Auto arrange`、`Plan with AI`）显示 "Coming soon" 且禁用；核心卖点 "Plan with AI" 一眼是灰的。 |
| 种子数据 | 默认 "Demo Workspace"，任务全是开发者黑话（Write task projection / Review adapter mapping / Recover overdue adapter run），真实用户看不懂。 |
| Access Key 弹窗 | 仅说「Enter Access Key to continue」，不提 key 从哪来，用户被卡死。 |
| AI Clients 表单 | 直暴 Base URL/API Key/Timeout/hermesScope；空状态不解释 Hermes 是什么、为何需要。 |
| 错误提示 | quickCreate 失败弹「...Local parser fallback was not used」，内部术语，用户无法理解或行动。 |

### 4. 缺失的反馈 / 空状态 / 错误提示 / 引导

- 缺首次运行引导：无 welcome、无 setup checklist、无"3 步开始"。
- 空状态不可操作：`emptyDayLane`、`noAiProposals` 仅描述现状，无 CTA，尤其缺
  「连接 AI 才能开始」的引导。
- 缺全局空看板引导：零任务时无「创建第一个任务」主动指引。
- 导航缺失：Inbox、Memory 有路由但不在侧边栏，用户发现不了。

### 5. 已完成但用户感知价值不足的功能

- 状态感知的 Work 页（`taskReadySummary`/`taskRunningSummary`，决策导向）：写得
  好，但藏在二级 `work/:taskId`。
- Plan 生成进度步骤（Prepare → Generate → Organize → Finish）：优质反馈，但须
  先配好 AI 才看得到。
- AI 侧栏 "Ask Chrona"（staleWarning、确认前预览）：强能力，首屏无提示。
- 冲突卡片带建议、Hermes 一键 Auto-configure：价值高但埋得深。

共性：最好的功能放在最难到达处，首屏反而摆着禁用的 "Coming soon"。

## 二、UX 改进建议（按目标分类）

### 提升激活率

1. 加首次运行引导卡片：检测到无 AI client 或仅 demo 数据时，在 Schedule 顶部插
   「3 步开始：① 连接 AI（Hermes）② 创建第一个任务 ③ 让 AI 生成计划」checklist，
   每步直达。
2. 把"连接 AI" CTA 提到首屏：空状态/cockpit 显眼处放「Connect AI to unlock
   planning」按钮，直接打开 AI Clients 弹窗，不要求用户去 Settings 找。
3. 去掉首屏两个 "Coming soon" 禁用按钮，或换成可用真实入口。
4. 空状态全部加主操作：`emptyDayLane`、空看板加「+ 创建第一个任务」。

### 提升留存

5. 换掉开发者种子数据：新用户首启给 1–2 个贴近真实场景的可操作示例任务（如
   「写周报 @周五 14:00」），或空工作区 + 引导；移除 task projection / adapter
   mapping 这类黑话。
6. 把 Inbox、Memory 放进侧边栏，让已完成功能可被发现。
7. 首屏暴露高价值功能入口：首次有数据时用 onboarding tooltip 主动提示 "Ask
   Chrona" 与 AI proposals。

### 提升信任感

8. Access Key 弹窗加来源说明（key 在哪生成/启动日志/配置文件），给帮助链接。
9. 统一定位语：README、tagline、metadata 用同一句用户语言价值主张（例：「把任务
   排进日程，让 AI 自动推进」）。
10. 重写技术性错误文案：把「Local parser fallback was not used」改成可行动的话，
    如「没看懂这条输入，试试『写周报 @14:30 90分钟』这样的格式」。
11. AI 执行前预览/审批已存在（preview-before-confirm、WaitingForApproval），应在
    首屏就告知「AI 不会未经允许就执行」——本地优先工具最重要的信任锚点，目前前台
    未传达。

### 降低学习成本

12. 解释 Hermes：AI Clients 空状态加「Hermes 是 Chrona 的本地 AI 运行时，用于生成
    计划和执行任务」+ 「Auto-configure local Hermes」一键按钮置顶，高级字段
    （Base URL/Timeout）折叠到 Advanced。
13. 收敛重复任务界面：`tasks/:taskId`（详情）与 `work/:taskId`（执行）并存，文案
    自称 "secondary task detail" / "task-center successor"，迁移期割裂使用户迷路；
    明确一个主入口，另一个降级或合并。
14. 统一命名：导航 "Tasks" vs 页面标题 "Task Center"；cockpit/projection/runnable/
    dispatch_task/bindings 等内部词换成用户语言或加 tooltip。

## 三、优先级（若只做三件，按 ROI）

1. 首屏加「连接 AI + 建第一个任务」引导 — 解决激活率第一杀手。
2. 换掉开发者种子数据 / 给干净空状态 — 解决"这不是给我用的"困惑。
3. 去掉首屏 "Coming soon" 禁用的核心按钮 — 避免核心卖点一眼劝退。

三项均为纯前端文案/引导改动，无需改后端 API，符合"视觉与交互打磨不改后端"原则。
