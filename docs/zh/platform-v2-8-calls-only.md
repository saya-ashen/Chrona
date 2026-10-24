# v2-8 规格：模块之间只经路由调用

状态：用户已确认（2026-10-24）。§11 第 1 步已实现（`*` 授权、系统模块 `modules`、`chat` 会话接口、MCP 改为路由调用）；第 2–4 步未实现。依赖 [v2-5 §9](platform-v2-5-extensions.md) 的模块路由与 [v2-7](platform-v2-7-system-modules.md) 的系统模块。修改 [v2-2](platform-v2-2-sessions-content.md) 的内容区、[v2-4](platform-v2-4-entries-rescue.md) 的 web / MCP 设计与 v2-7 §3“web 页面和 owner MCP 走用户的 HTTP 请求，不变”。

## 1. 目标

- **模块之间只有一种交互方式：经内核路由的调用**（`uses` + `chrona.call`，被调方的 `visibility` / `callers` 决定谁能调用，内核记录真实调用者）。唯一例外是救援控制台与 `chrona admin`：它们是内核自带的应急入口，不是模块。
- **模块只对外开放查询和操作工具，不负责展示。** 怎么展示、放哪些按钮由 web 模块决定；某个模块需要在网页上有专门页面时，由 AI 修改 web 模块。
- web 与 owner MCP 成为普通入口模块（和 `qq` 一样），不再使用 owner API；`owner` 能力随之删除。
- 对话里的 Provider 读写模块数据也只用模块工具；内容区概念删除。
- 系统模块按普通模块的方式保存自己的数据（自己的数据目录），不再借用其他应用的内容区。
- 删除内核连接器（邮件、Chino 健康、测试来源）；以后需要外部来源时做成模块。

## 2. 通信规则

| 谁 → 谁 | 方式 |
|---|---|
| 模块 → 模块（含 web、MCP、qq） | 路由调用，按被调方 `visibility` / `callers` 与调用方 `uses` 检查 |
| 模块 → 内核掌握的事实（会话、审批、模块与运行记录） | 路由调用**系统模块**（`chat`、`approvals`、`modules`） |
| Provider → 模块 | 模块工具（`m_<module>_<tool>`，`visibility` 含 `provider`） |
| 浏览器 / MCP 客户端 → 入口模块 | HTTP（`listen`），内核先验 API key，再去掉凭据转发 |
| 救援控制台、`chrona admin` | 内核内的 owner 接口（不是模块，不经路由） |

内核掌握的事实（运行记录、版本、审批）只由系统模块提供，不由模块自己报告：模块崩溃或写错时这些记录仍然可信。

## 3. `*` 授权

- `uses` 可以写 `"*"`：可调用**所有对用户开放的工具**，不必逐个列出。用于 web、MCP 这类“把所有模块的功能摆给用户”的入口：它们的版本通过审批时，以后生成的模块还不存在。
- **入口模块**（取代 v2-7 的判定）：声明 `owner`、`listen: "/"`、`*`，或在 `uses` 中列出任何 `chat.*` / `approvals.*` 接口的模块。入口模块的每个版本都需要用户批准，不自动启用。所以声明 `*` 的模块必然是入口模块。
- 可见性判断（`module-calls.ts` `admitted`）：
  - 调用方在 `uses` 中列出了目标，且目标 `visibility` 含 `modules` → 允许（现有规则）；
  - 调用方声明了 `*`，且目标 `visibility` 含 `owner` → 允许（入口模块代表用户调用）。`*` 不覆盖只对模块开放、未列出的接口（如 `chat.send`）。
  - 两种情况都不越过 `callers`：只给特定模块的接口（如 `qq.deliver` 只给 `notify`）仍然只给它们。
- `owner` 可见性的含义变为“用户可以经入口模块（web、MCP）或救援控制台调用”。模块工具默认 `["provider", "owner"]` 不变。
- 每次调用照常检查、记录真实调用者（`web`、`mcp`）。

## 4. 系统模块

### 4.1 新增 `modules`

| 接口 | 可见性 | 作用 | 取代的 owner API |
|---|---|---|---|
| `modules.list` | modules | 模块列表：状态、启用版本、最近版本（含被拒原因）、最近运行（时间、触发器、是否出错） | `GET /modules` |
| `modules.tools` | modules | 调用方此刻可调用的模块工具（`<module>.<tool>`、说明、参数结构），按关键词过滤（每个词都要出现在名字或说明中） | `GET /modules/tools` |

不提供“手动触发一次”：触发的效果只有模块自己清楚，需要时由模块开放工具（如 `run_now`）。

### 4.2 `chat` 补充

在 v2-7 的接口之外增加（与其他 `chat` 接口一样 `visibility: ["modules"]`，调用方在 `uses` 中列出，因而是入口模块）：

- `chat.sessions`（列表，可按来源、状态过滤）、`chat.session`（读取）、`chat.session-update`（改名、结束）、`chat.messages`（最近消息）。取代 `GET/PATCH /sessions*`、`GET /sessions/:id/messages`。
- `chat.ask`（同步）：发出用户消息并等这次运行的回复（语义同 `POST /chat`，等待上限相同）。给一问一答的入口（MCP）用：会话**不记入口模块**，回复不推送，后台结果照旧发通知。需要推送的入口（qq、web）用 `chat.send`。

### 4.3 内置模块工具可见性调整

web 的“今天”页需要的数据改由各自的模块提供：`notify.list`、`notify.status`、`notify.feedback`、`notify.retry` 增加 `owner` 可见性；`remind` 增加 `upcoming`（未来 7 天的日程）；审批用 `approvals.list` / `approvals.resolve`。owner API 的 `/today` 不再给模块使用。

## 5. 入口模块的 HTTP

- `listen` 可以声明多个路径（数组，最多 4 个）。内核对 `/api/*` 路径先验 API key（现状），其他路径不验；同一路径只能有一个启用的模块。
- web：`listen: ["/", "/api/web"]`。`/` 只发静态页面（不含数据，不验证）；`/api/web/*` 是 web 模块自己的数据接口，浏览器带 API key 请求，内核验证后去掉凭据转发。
- MCP：`listen: ["/api/mcp"]`，不变。

## 6. web 模块

- 服务端：`/api/web/*` 把页面操作翻译成路由调用；`uses`：`chat.*`、`approvals.*`、`modules.*`、`*`。
- **通用页面**：对没有专门页面的模块，列出它的运行记录（来自 `modules.list`）和对用户开放的工具（来自 `modules.tools`），按参数结构生成表单与按钮；会改变状态的工具点击后先确认。新模块一启用就能在网页上用。
- **专门页面**：模块需要更好的展示时，由 AI 修改 web 模块（构建、测试、用户批准启用，与其他模块相同）。web 代码中按模块名组织专门页面；对应模块不存在或工具调用失败时退回通用页面。
- 对话：`chat.send` 发消息；web 提供 `reply` 工具接收回复推送（v2-7 §4），经 SSE（`GET /api/web/events`）推给浏览器，取代轮询。网页会话因此有入口模块，后台结果推回网页对话，不再另发通知。
- 今天：由 `approvals.list`、`notify.list`、`remind.upcoming`、`modules.list`、`chat.sessions` 组成。

## 7. MCP 模块

- `uses`：`chat.*`、`approvals.*`、`modules.*`、`*`；删除 `owner`。
- 工具映射：`chrona_chat` → `chat.ask`；会话类工具 → `chat.*`；审批 → `approvals.*`；`chrona_modules` → `modules.list`；`chrona_notifications` → `notify.list`；`chrona_module_tools` → `modules.tools`；`chrona_module_call` → 路由调用目标 `<module>.<tool>`（不接受系统模块，它们有专门的工具）。
- 第 1 步后：`chrona_today`、`chrona_apps`、`chrona_content_*`、`chrona_notifications` 仍走 owner API（保留 `owner`），第 2、3 步移走。
- 删除 `chrona_apps`、`chrona_content_tree`、`chrona_content_read`、`chrona_content_write`（内容经 `files` 等模块的工具读写）。

## 8. 删除内容区

| 现在依赖内容区的 | 改为 |
|---|---|
| `files` 模块的文档（`content/<files>/`） | `files` 模块私有数据目录；对外仍是 `files.*` 工具（list、read、write、move、delete、history、restore） |
| 用户上传的附件、Provider 回复附件（`chrona_reply.files`、`chat.file`） | **`chat` 的附件**：系统模块 `chat` 和普通模块一样把附件存在自己的数据目录（`<dataDir>/platform/data/chat/`），按会话组织；`chrona_reply.files` 改为 Provider 工作目录中的文件路径，`chat` 收进自己的数据目录；其他模块用 `chat.file` 取 |
| 通知附件（`chrona_notify.file`） | 同上，由 `chat` 收下，通知里带 `chat` 附件 id，入口模块用 `chat.file` 取 |
| 收件箱条目（`files/inbox/<connectorId>/…`） | 随连接器删除（§8.1） |
| AI 生成页面（`chrona_ui_set`、`chrona_ui_guide`、`*.ui.json`、面板） | 删除；展示由 web 模块负责 |
| Provider 工作目录中的 `content/` 与 `chrona_focus` | 删除；Provider 用模块工具 |
| 模块清单 `content`、`chrona.paths.content`、`content_edit` 事件 | 删除 |
| owner API `/apps/*` | 删除 |

迁移：`files` 的文档原样移动到其数据目录（保留历史）；已有附件引用 `<module>/<path>` 迁为 `chat` 附件；`github-trending-daily` 内容区的 3 个文件由 AI 改为工具后重建（迁移前通知用户）；`planning` 已只用工具，不受影响。

### 8.1 删除连接器

现状：邮件（IMAP/SMTP）、Chino 健康、测试来源是内核代码；chino 上没有配置任何连接器，没有收件条目，也没有模块订阅 `inbound` 触发器（2026-10-24 核实）。

- 删除：`packages/integrations/src/steward/` 的 `email.ts`、`chino-health-source.ts`、`local-test-source.ts`；内核连接器轮询、分流规则与 `storeInboundItems`；`Connector`、`InboundItem` 表（迁移只删表，表中无数据）；owner API `/connectors/*`；Provider 工具 `chrona_send_email`、`chrona_inbound`；清单触发器 `inbound`；动作 `send_external_message` 若无其他使用者一并删除。
- 不迁移数据。以后需要邮箱等外部来源时，按本规格做成模块：数据在模块自己的数据目录，对外开放工具，展示由 web 负责。v2-5 §2 的“来源模块”方案相应作废。

## 9. 内置模块与 AI 修改

- 内置模块（web、mcp、qq、files、notify、remind）可以由 AI 修改，版本照常构建、审批、启用、回滚。
- Chrona 启动时提交发布包内置版本（`module-builtin.ts`）：
  - 该模块当前启用的是发布包版本 → 照旧自动启用新发布版本；
  - 当前启用的是 AI 修改的版本 → 新发布版本只作为待审批提案保存，**不自动覆盖**；由用户或 AI 合并后再启用。

## 10. owner API 与 `owner` 能力

- 删除 `owner` 能力、`chrona.owner`、模块侧的 owner API 通道。
- owner HTTP API 保留给救援控制台与 `chrona admin`（内核进程内调用）。网页和 MCP 不再使用。

## 11. 实施步骤（每步单独部署）

1. `*` 授权与可见性规则；系统模块 `modules`；`chat` 补充接口；MCP 迁移为路由调用（内容类工具暂时保留走 owner API）。
2. `listen` 多路径；web 迁移：`/api/web`、通用页面、SSE 回复推送、今天页；`notify` / `remind` 可见性调整。
3. 删除内容区与连接器：`chat` 附件、`files` 迁移、Provider 工具调整、删除 `/apps/*`、`owner` 能力、MCP 内容类工具与连接器；`github-trending-daily` 重建。
4. 内置模块升级不覆盖 AI 修改版。

## 12. 验收

1. MCP 客户端经 `chrona_module_tools` / `chrona_module_call` 调用一个在其连接之后才启用的模块工具；调用者记为 `mcp`。
2. 未声明 `*` 的模块调用 `owner` 可见的工具被拒；声明 `*` 的模块不能越过 `callers`（调用 `qq.deliver` 被拒）。
3. 网页显示 `github-trending-daily` 的运行记录（来自 `modules.list`），并通过通用页面调用它的 `run_now`；调用者记为 `web`。
4. 网页发消息后回复经 `web.reply` 推送到浏览器；后台结果推回网页对话且不另发通知。
5. 删除内容区后：Provider 回复附件经 `chat` 附件送达 QQ 与网页；`files` 文档与历史完整；内核中不再有连接器代码与表。
6. 内置 web 有 AI 修改版本时，Chrona 升级后仍启用 AI 版本，新发布版本作为待审批提案出现。
