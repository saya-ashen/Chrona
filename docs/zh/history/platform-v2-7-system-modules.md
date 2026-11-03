# v2-7 规格：系统模块与对话接口（草案，待确认）

状态：已实现（2026-10-24，`platform-v2` 分支，未部署）。依赖 [v2-5 §9](platform-v2-5-extensions.md) 的模块路由。

> 当前模块调用规则见 [安全机制简化 §3.2](../security-simplification.md)：`uses` 是契约；任何模块可调用 `modules` 可见工具。

## 1. 目标

- 入口模块（`qq`，以后的其他聊天入口）与对话之间只用一种通信方式：经内核路由的调用，和模块之间的调用相同。
- 对话回复由 Chrona 按**会话**推送给入口模块，不再由入口模块按**运行**轮询。续跑、失败提示等回复都能送达（修复 2026-10-24 续跑回答没有发到 QQ 的问题）。
- 信任边界不变：会话、Provider 运行、审批、构建与启用仍在内核进程内，不能被 AI 修改。

## 2. 系统模块

- **系统模块**是内核进程内的模块：在路由注册表中有名字和工具声明（`visibility`、`idempotent`，与普通模块相同），由内核代码直接处理调用，可以使用调用方所在的数据库事务。
- 不进模块商店，不经构建、审批与启用，不能被提案、回滚或暂停；名字保留，普通模块不能使用。
- 调用方式、`uses` 声明、真实调用者记录、循环检测、异步调用的持久化与重试，与普通模块完全相同。系统模块作为调用方时，调用者记为 `{ kind: "system", module: "chat" }`，系统模块可调用 `modules` 可见的工具。
- 第一个系统模块是 `chat`。以后需要时可以把接口不变地移到独立进程。

## 3. `chat` 接口

全部 `visibility: ["modules"]`；入口模块在 `uses` 中声明。会话的**入口模块**就是调用 `chat.send` 的模块（内核记录，不由参数提供）。

| 接口 | 模式 | 作用 | 取代的 owner API |
|---|---|---|---|
| `chat.send` | 同步 | 记录一条用户消息（`key` 如 `qq:dm`、`text`、`externalId`、`quotedExternalId`、附件引用），排运行或注入正在运行的运行；立即返回 `{ sessionId, messageId }`，不等回答 | `POST /chat` |
| `chat.attach` | 同步 | 收下一个附件（base64，≤20 MiB），返回附件引用 | `POST /chat/attachments` |
| `chat.new-session` | 同步 | 结束某个 key 的当前会话（QQ `/new`） | `POST /sessions/new` |
| `chat.file` | 同步 | 读取**本会话某条回复**附带的内容文件字节（发图片用），不能读其他文件 | `GET /apps/:id/raw` |
| `chat.delivered` | 异步，幂等 | 记录回复或通知在入口上的外部 id（引用回复用） | `PATCH /messages/:id`、`POST /messages` |

审批由系统模块 `approvals` 提供：`approvals.list`、`approvals.resolve`（同步）。回复推送里直接带附件所属应用的 id，入口模块不再需要 `/apps`。至此 QQ 模块不再需要 `owner`。web 页面和 owner MCP 走用户的 HTTP 请求，不变。

**入口模块**：在 `uses` 中声明 `chat.send` 或 `approvals.resolve` 的模块代表用户说话或做决定，与声明 `owner` 的模块一样属于入口模块：每个版本都需要用户批准，不自动启用；`secrets` 也只允许入口模块声明。

## 4. 回复推送

- 入口模块提供工具 `reply`（`visibility: ["modules"]`，不幂等）。参数：会话、消息 id、文本、附件引用、它回答的那条用户消息的 `externalId`。
- 以下消息写入一个**有入口模块**的会话时，`chat` 在**同一个事务**里对该入口发异步调用 `<entry>.reply`，key 为 `reply:<messageId>`：
  - 该会话里运行（包括超时后的续跑）用 `chrona_reply` 写的回复；
  - 运行失败时的提示（“模型暂时不可用……”）。
- `wake` 等后台运行把结果复制回原会话时：原会话有入口模块 → 推送进原对话，**不再另发通知**；原会话没有入口模块（例如网页会话）→ 照旧发一条通知。
- 送达语义沿用路由：没送到就重试；送到后结果不明标为 `unknown`，不重发。

## 5. QQ 模块

- 收到消息 → `chat.send`，立即返回；不再轮询 `/chat/runs/:id`，也不再自己发“处理尚未完成，请稍后在网页查看”。
- 30 秒还没有回复时，仍由 QQ 模块自己发“我还在处理”（现有逻辑）。
- `qq.reply`：在被动回复窗口内（原消息 1 小时内、最多 4 条）作为被动回复发出；窗口用完或原消息不明时，交给 `notify.send`（`responds: true`，固定发给原发送者）。发出后调用 `chat.delivered` 记录外部 id。
- 清单：`uses` 为 `chat.*`、`approvals.list`、`approvals.resolve`、`notify.send`、`notify.channel`；工具增加 `reply`；去掉 `owner`。

## 6. 迁移

- 数据库：会话增加 `entryModuleId`（可空，只新增列）。已有的 `qq:dm` 会话在第一次 `chat.send` 时补上入口。
- 部署时正在进行的运行：部署后写出的回复按新规则推送；部署前已写出、还没被旧 QQ 模块取走的回复不补发（数量很少，网页可见）。
- owner API 的 `/chat`、`/chat/runs/:id`、`/messages` 保留给 web 页面和 MCP。

## 7. 验收

1. QQ 模块经 `chat.send` 发消息，回复以 `qq.reply` 调用送回，调用者记为 `system:chat`。
2. 运行超时后的续跑写出的回答被推送到 QQ（复现 2026-10-24 的情形）。
3. 被动回复窗口用完后，回复经 `notify.send` 送达，且只送一次。
4. 普通模块不能调用 `qq.reply`，也不能注册名为 `chat` 的模块。
5. wake 结果推送进原 QQ 对话，且不再另发通知；网页会话的 wake 结果仍以通知送达。
6. QQ 模块不声明 `owner` 也能完成对话、附件、`/new`、审批按钮与文字审批。

## 8. 已确认的决定（2026-10-24）

- 会话入口记录在新列 `entryModuleId`。
- wake 结果推送进原对话（原会话有入口时不再另发通知）。
- 审批接口这次一起拆出，QQ 模块去掉 `owner`。
