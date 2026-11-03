# v2-18 规格：活动记录

状态：已实现（2026-10-27），未部署；用户已确认范围。依赖 [v2-17](platform-v2-17-approval-levels-model-tiers.md)。

## 1. 背景

批准一张审批后，网页上看不出是否成功、应用现在运行哪个版本。内核的审计表记着这些事，但没有任何接口能读，网页只能看到零散的版本列表。

## 2. 内核

- 新系统模块 `activity`，工具 `activity.list({ module?, before?, limit? })`：只读，对模块和 owner 可见，Provider 不可见；当前准入规则见 [安全机制简化 §3.2](security-simplification.md)。
- 内核从审计表挑出与用户相关的记录，并由内核写成中文句子（模块只能显示，不能改写或伪造）：审批生成、AI 复核结果、你的决定与渠道；候选版本提交、检查完成/失败；启用、自动更新、回滚、数据迁移、运行故障；你新增或撤销的授权（Chrona 为低风险更新生成的一次性授权不单列）；设置改了哪一项；凭据设置/删除（只记名称）；每周审批习惯。
- 按时间倒序；`before` 翻页；`module` 只看一个应用。
- `secrets.set`/`secrets.remove` 写审计 `secret_set`/`secret_removed`，只含名称。命令行 `chrona admin secret-set` 不经数据库，暂不进活动记录。
- MCP 新增 `chrona_activity` 与 `chrona_module_permissions`（MCP 不转发 `modules.*`）。

## 3. 网页

- 新页面“活动”（`/activity`，导航栏），可点应用名筛选，“更早的”翻页。
- 审批卡点“批准/拒绝”后在原位显示结果（如“已批准：启用模块 web · web 当前版本 5caef53c”），失败时显示原因并恢复按钮，几秒后刷新。
- 应用页顶部显示“当前版本 xxxxxxxx · 时间 · 怎么切换过来的”，以及最近几条活动和“查看全部活动”。
- 线上运行的是定制 web，需另经构建合并。

## 4. 不在本版

- 主机的 systemd 服务日志（量大、可能含敏感信息；模块故障已有“诊断”）。
