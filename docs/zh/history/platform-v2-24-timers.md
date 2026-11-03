# v2-24 规格：应用自己的定时与日历

状态：第 1 步内核已实现并部署（2026-10-29，`fb5dcbc3`）；第 2 步 `calendar` 2f8f1471 与 `web` 9fc35bac 已启用（2026-10-29）；第 3 步待做。用户已确认三步都做。依赖 [v2-3](platform-v2-3-remind-model.md)、[v2-9](platform-v2-9-owner-api.md)、[v2-17](platform-v2-17-approval-levels-model-tiers.md)。

## 1. 背景

所有定时都存在 `Schedule` 表、由同一个 `fireDue` 触发，但只有 Provider 能在运行时新建（`chrona_schedule` 的 remind/wake），动态日程曾只给声明 `dynamicSchedules` 的内置 `remind`（该清单字段现已删除，统一用 `schedules.*`）。应用只能用 manifest 里写死的 `triggers`（最短 5 分钟），做不了“这个事件前 10 分钟提醒”。

## 2. 内核：应用的定时（第 1 步）

- 系统模块 `schedules` 新增三个工具，任何在 `uses` 里声明它们的应用都能调用（新增 `uses` 照常为黄色审批）：
  - `create({ key, rule, payload, label, until? })`：登记本应用名为 `key` 的定时；同一 `key` 再登记就替换规则和数据。`rule` 与 `chrona_schedule` 相同（at/daily/weekly/every≥5 分钟，所有者时区）；`payload` 为 JSON 对象，最多 4000 字符；`label` 是日程页上用户看到的名字。
  - `cancel({ key })`：取消本应用的这个定时；没有时返回 `{ cancelled: false }`。
  - `mine()`：本应用有效与暂停的定时（含 key、payload），按时间排序。
- 到点时内核把 schedule 事件（`scheduleId`、`payload`）交回登记它的应用的 `on("schedule")`；事件 id 为 `s-<日程 id>`，与 remind 的行相同。
- 只碰自己的：key 按应用区分，别的应用取消不到；审计记真实调用方 `module:<名称>`，`createdBy` 为 `module`。
- 每个应用最多 500 个有效或暂停的定时；替换已有 key 不受限。
- 存储不变、无迁移：`mode: "module"`、`moduleId` 为应用、`payload` 非空、`triggerId` 为空、`text` 存 key。
- 新版本不再声明 `schedules.create`时，启用即取消它的定时；保留声明的版本更新或回滚时定时保留。应用删除时随应用删除。
- 日程页（`schedules.list` / `schedules.update`）照旧列出并可暂停、取消所有定时，包括应用的。
- 内核规则不扩展：每月、每年、按次数结束等由应用自己算，每次只登记下一次 `at`，触发后再登记下一次。
- 构建说明（`modules.propose` 与构建会话）写明这组接口；`chrona_schedule` 说明：有提供提醒或日历的应用时用应用。

## 3. 日历应用（第 2 步，线上构建）

- `calendar`：事件（标题、开始/结束或全天、地点、备注、重复、多个提前提醒）、`list/get/create/update/delete/upcoming`，提醒经 `schedules.create` 给自己登记，到点 `notify.send`。事件可关联 `planning` 的计划（`uses: ["planning.get"]` 读标题）。
- `web`：日历页（月/周视图），同时用 `schedules.list` 把其他应用的定时和唤醒作为只读项显示。

## 4. 合并提醒（第 3 步）

- Provider 收到“提醒我…”时用 `calendar.create`；`chrona_schedule` 的 remind 模式保留为没有日历应用时的兜底。
- 现有 remind 日程迁入日历需用户单独批准（动真实数据）。
