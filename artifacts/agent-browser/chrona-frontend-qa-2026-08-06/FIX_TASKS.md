# Chrona 前端问题修复清单

基于 `artifacts/agent-browser/chrona-frontend-qa-2026-08-06/REPORT.md` 的真实 `agent-browser` 测试结果维护。状态：`[ ]` 未开始，`[-]` 处理中，`[x]` 已完成，`[~]` 已定位但需要更大测试 fixture。

## 高优先级

- [x] F-01 修复 Schedule 中“安排任务”弹窗没有使用当前 URL `day` 的问题，并补充回归测试。
- [x] F-02 修复 Task 列表行级更多操作的鼠标触发问题，并补充键盘/鼠标回归测试。
- [x] F-03 对非法“标记完成”状态进行前端约束，并显示服务端错误反馈。
- [x] F-04 已加入计划生成期间的 5 秒兜底轮询、修复停止后的 session 状态，并加入 provider readiness 前置检查。
- [-] F-08 follow-up/retry/accept result 已加入带 `workBlockId` 的 query prefix 失效和 projection settled 等待；deterministic completed-run accepted projection 已回归，真实 OMP completed-run 仍需单独复测。

## 中优先级

- [-] F-05 已补齐 common.close、Action Center input/approval/clear filters、Task Workspace plan setup 的中英文文案；Schedule、Goals 等英文 fallback 仍待处理。
- [x] F-06 已修复 Action Center tab 语义、AI client enabled checkbox label、页面 ARIA 结构和浅色主题颜色对比度；Schedule、Goals、Action Center、Settings axe 当前均为 0 violations。
- [x] F-07 持久化或重新加载 OMP client 后的 readiness 状态，避免健康检查结果回到“未测试”。
- [x] F-09 修复 Agent transcript Close 按钮被标题层遮挡的问题。
- [-] F-10 已修复执行页面重复 React key，并为 deterministic Task Workspace lifecycle 加入 console/pageerror gate；真实 OMP 长任务 console gate 仍待长任务 fixture。

## 需要专用测试 fixture

- [x] deterministic provider 已覆盖 Pause/Resume/Stop/Retry 的完整可重复生命周期，并新增 workspace command receipt 等待，验证 session、task projection 和 retry 后 Stop 最终 settled；真实 OMP 长任务仍需补充性验证。
- [x] deterministic provider 已通过 test-only completed-run Artifact seam 验证真实生成文件、accepted result、Promote result to Goal 和幂等 replay；真实 OMP 生成文件链路仍需单独 fixture。
- [-] 修复后的 agent-browser 主要回归已完成；F-01、F-02、F-04 provider guard、F-06、F-07、deterministic lifecycle/promotion 已通过，F-08 真实 OMP completed-run 与 F-10 OMP 长任务控制仍待补充验证。

## 修复记录

| 日期 | 项目 | 结果 | 验证 |
| --- | --- | --- | --- |
| 2026-08-06 | F-01 / F-02 / F-03 第一批修复 | 已完成 | selected-day 默认日期、受控 TaskActionsMenu、completed-run 状态判断；Vitest 3 个文件、4 个测试通过 |
| 2026-08-06 | F-07 / F-09 / F-10 第二批修复 | 部分完成 | readiness localStorage 缓存、Sheet close z-index、ActivityTimeline duplicate-key 消歧；console error E2E gate 待补 |
| 2026-08-06 | F-04 部分修复 | 处理中 | generation active 时每 5 秒 refetch plan state；Stop 成功后立即标记 cancelled，失败时恢复 running；workspace hooks Vitest 通过 |
| 2026-08-06 | F-06 部分修复 | 处理中 | Action Center filter buttons 改为 role=tab/aria-selected，AI client enabled checkbox 增加 aria-label；Action Center 相关 Vitest 通过 |
| 2026-08-06 | F-05 Task Workspace 文案部分修复 | 处理中 | Plan setup 的状态标题、质量提示和后续步骤补齐中英文 keys；plan-setup-panel Vitest 通过 |
| 2026-08-06 | F-05 / F-08 部分修复 | 处理中 | i18n common.close 与 Action Center filters 增补中英文文案；follow-up 成功后 invalidate 源 workspace query；Vitest 相关集合通过 |
| 2026-08-06 | F-08 result projection refresh | 部分完成 | retry finalization、accept result 和 follow-up 在执行/计划查询后等待活动 Task Workspace page projection settled；带 `workBlockId` 的 query-key regression 已通过，真实 OMP accepted-run 仍待补充验证 |
| 2026-08-06 | F-04 部分修复 | 处理中 | generation active 时每 5 秒 refetch plan state；Stop 成功后立即标记 cancelled，失败时恢复 running；workspace hooks Vitest 通过 |
| 2026-08-06 | F-04 provider readiness 前置检查与 smoke/accessibility 回归 | 已完成 | 无 provider 时显示 Connect AI provider 且不发送 plan.generate；Playwright task-workspace-smoke 与 task-workspace-accessibility 均通过 |
| 2026-08-06 | Wait checkpoint resume 修复 | 已完成 | WaitNodeExecutor 接收到 inputFields/userInput 时现在返回 done；真实 OMP 任务已验证 wait checkpoint → input resume → approval checkpoint，并继续到下游节点 |
| 2026-08-06 | Deterministic execution controls E2E | 已完成 | 以独立数据库覆盖 pause 稳定性、checkpoint resume、approval → blocked、blocked-node retry、workspace Stop；修复 workspace orchestration 使用 `executionSessionId` 而非 main session id，Stop 最终正确落为 Cancelled |
| 2026-08-06 | Task Workspace deterministic lifecycle E2E | 已完成 | 以 debug provider 在独立 E2E 数据库完成 4 个 Chromium 测试；覆盖 provider guard、plan persistence、plan → run → result accept、实际生成文件 Artifact → UI Promote to Goal、幂等 replay 和完整运行 console error gate |
| 2026-08-06 | Task Workspace axe 修复 | 已完成 | 修复图形/语言切换容器 ARIA role、compact graph 键盘滚动及浅色主题对比度；agent-browser axe 在 Task Workspace 页面达到 0 violations |
| 2026-08-06 | Schedule / Goals / Action Center / Settings axe 回归 | 已完成 | 四个页面 axe violations 均为 0；Action Center 最后一个 color-contrast incomplete 已通过补充明确背景/前景 token 消除 |
| 2026-08-06 | 长任务/Artifact fixture follow-up | 未闭环 | 新一轮真实 OMP 运行在第二个节点执行期间触发 Stop，最终进入 Paused/Failed recovery，保留 4 个中间 Artifact，但未稳定到最终结果接受或 Promote to Goal；该 fixture 仍不能作为完整生命周期通过证据 |
| 2026-08-06 | 修复后真实 UI 回归 | 进行中 | agent-browser 复测 Schedule 2026-08-07 显示 Aug 7、Task actions 鼠标打开菜单、OMP readiness 刷新后保持 Ready；截图 30 已保存 |
