# v2-9 规格：删除 owner HTTP API

状态：已实现（2026-10-24，未部署；v2-8 之后的内核盘点第 1 项）。依赖 [v2-8](platform-v2-8-calls-only.md)。

## 1. 背景

v2-8 之后，网页、MCP、QQ 都经路由调用工作；救援控制台与 `chrona admin` 在进程内直接调用服务。owner HTTP API（`/api/steward/*`，34 条路由）已没有 HTTP 使用者，但其中几项功能只有它提供，网页和 MCP 都没有入口：设置（通知、模块模型）、授权规则、偏好、日程管理、通知反馈与重试、回答运行中 Provider 的提问与取消运行。回答提问是实际缺口：Pi 运行中请用户确认或选择时，现在只能等它超时。

## 2. 改动

把这些功能做成系统模块接口（`visibility: ["modules"]`，入口模块在 `uses` 中列出），由 web 与 MCP 提供入口，然后删除 owner HTTP API。

| 接口 | 作用 | 取代 |
|---|---|---|
| `chat.runs` | 最近的 Provider 运行（进度、用量、提问），可按会话过滤 | `GET /provider/runs` |
| `chat.answer` | 回答运行中的一个提问（`submit` 值或 `cancel`） | `POST /provider/interactions/:id/answer` |
| `chat.cancel` | 停止一个运行 | `POST /provider/runs/:id/cancel` |
| `settings.get` / `settings.update` | 通知设置与模块模型（`moduleModel`） | `GET/PATCH /settings` |
| `settings.grants` / `settings.revoke-grant` | 授权规则的查看与撤销 | `GET /grants`、`POST /grants/:id/revoke` |
| `settings.preferences` / `settings.forget` | 偏好的查看与删除 | `GET /preferences`、`DELETE /preferences/:id` |
| `schedules.list` / `schedules.update` | 日程列表；暂停、恢复、取消 | `GET /schedules`、`PATCH /schedules/:id` |
| `notify.list` / `notify.feedback` / `notify.retry` | 内置 `notify` 模块的工具，增加 `owner` 可见性，经 `*` 调用 | `GET /notifications` 等 |

- 不提供的：新建授权（授权来自审批时选“始终允许”）、新建偏好（Provider 用 `chrona_remember`）、手动新建日程（Provider 用 `chrona_schedule`）、`POST /chat` 等对话路由（已由 `chat.send` / `chat.ask` 取代）。
- 设置与授权的修改不另走 `change_policy` 审批（v2-4 草案中有，从未实现）：入口模块每个版本都需要用户批准，它们本身就代表用户；再加一层审批也由同一入口处理，不增加安全性。
- 新系统模块名 `settings`、`schedules` 保留，普通模块不能使用。
- 结构化参数（设置、回答）以 JSON 文本传递（工具参数只有标量），与 `chat.send` 的附件相同。
- `uses` 上限由 20 提到 40：web 现在列出 21 个系统接口。

## 3. 入口

- web：新增“设置”页（通知设置、模块模型、授权规则、偏好、日程）；“今天”页列出运行中 Provider 的待答提问（确认 / 选择 / 输入 / 编辑）并可回答，运行中的对话可停止。
- MCP：新增 `chrona_runs`、`chrona_run_answer`、`chrona_run_cancel`；其他管理功能留在网页。

## 4. 删除

- `apps/server/src/routes/steward.routes.ts` 与 `/api/steward/*`、`/api/workspaces`；保留 `/api/steward-agent`（Provider 工具桥）与 `/health`。
- 发布冒烟改为检查 `/health` 与 `/api/web/today`。
- 只测 owner HTTP 映射的测试删除；服务层测试保留。
