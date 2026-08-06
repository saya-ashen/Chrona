# Chrona 前端问题修复清单

基于 `artifacts/agent-browser/chrona-frontend-qa-2026-08-06/REPORT.md` 的真实 `agent-browser` 测试结果维护。状态：`[ ]` 未开始，`[-]` 处理中，`[x]` 已完成，`[~]` 已定位但需要更大测试 fixture。

## 高优先级

- [x] F-01 修复 Schedule 中“安排任务”弹窗没有使用当前 URL `day` 的问题，并补充回归测试。
- [x] F-02 修复 Task 列表行级更多操作的鼠标触发问题，并补充键盘/鼠标回归测试。
- [x] F-03 对非法“标记完成”状态进行前端约束，并显示服务端错误反馈。
- [x] F-04 已加入计划生成期间的 5 秒兜底轮询、修复停止后的 session 状态，并加入 provider readiness 前置检查。
- [-] F-08 follow-up 成功后主动 invalidate 源 Task workspace page；retry/accept result 现在会显式重新拉取活动 page projection，仍待真实 completed-run 回归。

## 中优先级

- [-] F-05 已补齐 common.close、Action Center input/approval/clear filters、Task Workspace plan setup 的中英文文案；Schedule、Goals 等英文 fallback 仍待处理。
- [-] F-06 已修复 Action Center tab 语义和 AI client enabled checkbox label；Schedule/Goals 的其余 axe critical 结构及颜色对比度待处理。
- [x] F-07 持久化或重新加载 OMP client 后的 readiness 状态，避免健康检查结果回到“未测试”。
- [x] F-09 修复 Agent transcript Close 按钮被标题层遮挡的问题。
- [-] F-10 已修复执行页面重复 React key，并为 Task Workspace accessibility 加入 console error gate；完整 OMP 执行期间的 console gate 待长任务 fixture。

## 需要专用测试 fixture

- [~] 使用较长 OMP 任务验证 Pause / Resume / Stop / Retry 的完整生命周期。
- [~] 使用真实 Artifact 输出验证 Promote result to Goal。
- [-] 补充修复后的 agent-browser 真实回归测试；F-01、F-02、F-04 provider guard、F-07 已现场/自动化复测通过，F-08 及长任务/Artifact fixture 流程待继续。

## 修复记录

| 日期 | 项目 | 结果 | 验证 |
| --- | --- | --- | --- |
| 2026-08-06 | F-01 / F-02 / F-03 第一批修复 | 已完成 | selected-day 默认日期、受控 TaskActionsMenu、completed-run 状态判断；Vitest 3 个文件、4 个测试通过 |
| 2026-08-06 | F-07 / F-09 / F-10 第二批修复 | 部分完成 | readiness localStorage 缓存、Sheet close z-index、ActivityTimeline duplicate-key 消歧；console error E2E gate 待补 |
| 2026-08-06 | F-04 部分修复 | 处理中 | generation active 时每 5 秒 refetch plan state；Stop 成功后立即标记 cancelled，失败时恢复 running；workspace hooks Vitest 通过 |
| 2026-08-06 | F-06 部分修复 | 处理中 | Action Center filter buttons 改为 role=tab/aria-selected，AI client enabled checkbox 增加 aria-label；Action Center 相关 Vitest 通过 |
| 2026-08-06 | F-05 Task Workspace 文案部分修复 | 处理中 | Plan setup 的状态标题、质量提示和后续步骤补齐中英文 keys；plan-setup-panel Vitest 通过 |
| 2026-08-06 | F-05 / F-08 部分修复 | 处理中 | i18n common.close 与 Action Center filters 增补中英文文案；follow-up 成功后 invalidate 源 workspace query；Vitest 相关集合通过 |
| 2026-08-06 | F-08 result projection refresh | 处理中 | retry finalization 和 accept result 在执行/计划查询后显式 refetch 活动 Task Workspace page，避免 accepted projection 被旧缓存覆盖 |
| 2026-08-06 | F-04 部分修复 | 处理中 | generation active 时每 5 秒 refetch plan state；Stop 成功后立即标记 cancelled，失败时恢复 running；workspace hooks Vitest 通过 |
| 2026-08-06 | F-04 provider readiness 前置检查与 smoke/accessibility 回归 | 已完成 | 无 provider 时显示 Connect AI provider 且不发送 plan.generate；Playwright task-workspace-smoke 与 task-workspace-accessibility 均通过 |
| 2026-08-06 | F-05 Task Workspace plan setup localization | 处理中 | 状态标题、质量提示和后续步骤使用中英文 i18n keys；21 个相关 Vitest 测试与 app typecheck 通过 |
| 2026-08-06 | 修复后真实 UI 回归 | 进行中 | agent-browser 复测 Schedule 2026-08-07 显示 Aug 7、Task actions 鼠标打开菜单、OMP readiness 刷新后保持 Ready；截图 30 已保存 |
