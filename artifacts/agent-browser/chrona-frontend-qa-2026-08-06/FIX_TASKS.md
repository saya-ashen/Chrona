# Chrona 前端问题修复清单

基于 `artifacts/agent-browser/chrona-frontend-qa-2026-08-06/REPORT.md` 的真实 `agent-browser` 测试结果维护。状态：`[ ]` 未开始，`[-]` 处理中，`[x]` 已完成，`[~]` 已定位但需要更大测试 fixture。

## 高优先级

- [x] F-01 修复 Schedule 中“安排任务”弹窗没有使用当前 URL `day` 的问题，并补充回归测试。
- [x] F-02 修复 Task 列表行级更多操作的鼠标触发问题，并补充键盘/鼠标回归测试。
- [x] F-03 对非法“标记完成”状态进行前端约束，并显示服务端错误反馈。
- [-] F-04 已加入计划生成期间的 5 秒兜底轮询，并修复停止后的 session 状态；provider readiness 前置检查待处理。
- [ ] F-08 修复 retry/follow-up 后 accepted result 状态短暂回退的问题。

## 中优先级

- [ ] F-05 补齐中文界面的英文 fallback 和未解析 i18n key。
- [-] F-06 已修复 Action Center tab 语义和 AI client enabled checkbox label；Schedule/Goals 的其余 axe critical 结构及颜色对比度待处理。
- [x] F-07 持久化或重新加载 OMP client 后的 readiness 状态，避免健康检查结果回到“未测试”。
- [x] F-09 修复 Agent transcript Close 按钮被标题层遮挡的问题。
- [-] F-10 已修复执行页面重复 React key；将 console error 设为 E2E gate 待处理。

## 需要专用测试 fixture

- [~] 使用较长 OMP 任务验证 Pause / Resume / Stop / Retry 的完整生命周期。
- [~] 使用真实 Artifact 输出验证 Promote result to Goal。
- [-] 补充修复后的 agent-browser 真实回归测试；已现场复测 F-01、F-02、F-07，F-08/F-04 provider readiness 等剩余流程待继续。

## 修复记录

| 日期 | 项目 | 结果 | 验证 |
| --- | --- | --- | --- |
| 2026-08-06 | F-01 / F-02 / F-03 第一批修复 | 已完成 | selected-day 默认日期、受控 TaskActionsMenu、completed-run 状态判断；Vitest 3 个文件、4 个测试通过 |
| 2026-08-06 | F-07 / F-09 / F-10 第二批修复 | 部分完成 | readiness localStorage 缓存、Sheet close z-index、ActivityTimeline duplicate-key 消歧；console error E2E gate 待补 |
| 2026-08-06 | F-04 部分修复 | 处理中 | generation active 时每 5 秒 refetch plan state；Stop 成功后立即标记 cancelled，失败时恢复 running；workspace hooks Vitest 通过 |
| 2026-08-06 | F-06 部分修复 | 处理中 | Action Center filter buttons 改为 role=tab/aria-selected，AI client enabled checkbox 增加 aria-label；Action Center 相关 Vitest 通过 |
| 2026-08-06 | 修复后真实 UI 回归 | 进行中 | agent-browser 复测 Schedule 2026-08-07 显示 Aug 7、Task actions 鼠标打开菜单、OMP readiness 刷新后保持 Ready；截图 30 已保存 |
