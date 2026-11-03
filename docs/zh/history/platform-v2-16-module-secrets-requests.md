# v2-16 规格：普通模块的凭据与模块发起的审批

状态：已实现（2026-10-27）；第 5 节已由用户确认。依赖 [v2-10](platform-v2-10-ai-calls.md)（`secrets.get`）、[v2-7](platform-v2-7-system-modules.md)（`approvals`）。

## 1. 背景

`okx-ai-trader` 要在 OKX 模拟盘上跑 24 小时实验，现有内核缺两样：

- 凭据：清单 `secrets` 只允许入口模块，内核也只认 `qq_bot`（来自环境变量）。普通模块拿不到 OKX 模拟盘的 API key。
- 需要用户决定的事：只有 Provider（`chrona_request_approval`）能发起审批；模块无法请用户决定一件具体的事（如“开始这次实验”），也收不到决定。

模型费用不在本版：`provider.complete` 已按清单 `model.maxCalls`（每次事件）、`moduleModel.dailyCalls`（每天）和 `maxOutputTokens` 限额，审计记录每次的输入/输出 token。

## 2. 凭据

- 清单 `secrets` 对所有模块开放（数量不限（2026-11-01 用户决定取消原 5 个上限），名称 `^[a-z][a-z0-9_]{1,40}$`）；`qq_bot` 仍只给入口模块，继续来自环境变量。
- 其他凭据存于 `<dataDir>/secrets/<name>.json`（`createSecrets`：0600、单链接、非符号链接、≤1 MiB、值均为字符串）。
- `secrets` 系统模块新增（只有入口模块可调用，须在 `uses` 声明；Provider 不可见）：
  - `secrets.set({ name, value })`：`value` 为 JSON 对象文本（值均为字符串）；参数不进调用记录、审计和日志。不能写 `qq_bot`。
  - `secrets.remove({ name })`。
  - `secrets.list()`：已配置的名称、更新时间，以及哪些已启用模块声明了它；从不返回值。
- 网页：内置 `web` 的设置页增加“凭据”一栏，按模块列出声明的凭据和是否已配置，按 §2.1 逐字段填写、删除；不显示已保存的值。线上运行的是定制 `web`，不随发布替换，需另经模块构建合并。
### 2.1 字段声明与按字段保存（2026-11-02）

用户反馈：页面只给“字段名 + 值”空行，要猜字段名；“替换”会冲掉没重新填写的字段。

- 清单 `secrets` 的每项可以是名称，也可以是对象 `{ name, label?, description?, fields?, extraFields?, oauth? }`：
  - `fields: [{ name, label, description?, optional?, plain? }]`：页面逐个询问的字段；`plain` 为非机密（如 Client ID），用明文输入框。
  - `extraFields: { label, valueLabel, description? }`：由用户命名的键，例如每个账户 id 一个授权码。
  - `oauth: { provider, scopes, accounts? }`（v2-30 §4）：页面另外询问 `clientId`/`clientSecret`，并提供“授权”；`accounts` 为真时可授权多个账户。
  - 只写名称照旧可用，页面列出已保存的字段名并允许按名称添加。
- `secrets.set({ name, value, merge? })`：`merge` 时只写入给出的字段、保留其余，且不能写内核字段（`refreshToken*`、`scope*`、`oauthManaged`）；页面一律合并。不带 `merge` 仍整体替换（命令行）。
- `secrets.remove({ name, field? })`：带 `field` 只删一个字段（最后一个字段删完即删除凭据），可用来移除某个账户的密码或 OAuth 授权。
- `modules.permissions` 的每个凭据带上声明的字段、哪些已保存、用户命名的键、已授权的 OAuth 账户；只有字段名，从不含值。
- 内核写凭据（OAuth 回调、令牌轮换）与页面合并、删除字段共用同一把按凭据的锁。

- 命令行：`chrona admin secret-set <name>` 从标准输入读 JSON 对象写入（不回显）；`chrona admin secret-remove <name>`。
- 对话（QQ、网页会话、MCP 会话）不提供设置：消息会进入会话记录和模型上下文。
- `secrets.get`：模块声明了该名称即可读；未声明 `forbidden`、未配置 `unavailable`；构建和测试期间一律 `unavailable`。
- 能力：声明了 `secrets` 的版本不自动启用；审批卡列出“凭据：okx_demo”。

## 3. 模块发起的审批（需要用户决定的事）

`approvals` 新增两个工具，任何模块在 `uses` 声明后可调用：

- `approvals.request({ title, detail, preview })`：**只能异步调用**（`chrona.call(..., { mode: "async", key, reply: true })`；同步调用返回 `invalid`）。
  - 内核为调用模块创建一张审批：`action` 为 `modify_external`，`moduleId` 为调用模块，`payload` 为 `{ kind: "module_request", hash, call }`（`hash` 为调用时的版本，`call` 为这次异步调用）。同一调用重复投递只建一张（异步调用本身按 `key` 幂等）。
  - 调用进入 `waiting` 状态，直到用户决定；不会被租约回收或重试。
  - 用户批准或拒绝后，调用变为 `succeeded`，输出 `{ approval, decision: "approved" | "denied" }`，经现有 `call_result` 事件推回源模块（当前启用的版本）。
  - 显式请求始终等待用户决定，不由长期授权代替本次审批。
- `approvals.status({ approval })`：只能查本模块发起的审批，返回 `{ status, hash, resolvedAt }`，用于重启后补查。
- 只能“本次”批准：以 `always` 批准会被拒绝，且批准不产生任何授权（grant）。QQ 与内置网页对这类审批不显示“始终允许”。
- 通知沿用现有审批通知（标题“需要你批准：<模块名>：<title>”）。
- 结果是否“只用一次”由模块自己记录（审批 id 绑定它自己的对象，如实验 id 和 revision）。

## 4. 不在本版

- 联网目标白名单（模块联网仍是全部或没有）。
- 模型金额预算与实际计费。
- “始终允许”绑定版本与审批内容（需要时再加，只增不改）。

## 5. 用户确认（2026-10-27）

1. 凭据可在网页设置页设置（另有命令行）；不在对话中设置。
2. 模块发起的审批只能“本次”批准；只影响通过 `approvals.request` 发起的审批，模块更新审批与 Provider 审批不变。
3. 审批结果推送回源模块（异步调用 + `call_result`），不需要模块轮询。
4. 模型费用以调用次数和 token 限制，不设金额上限。

## 6. 验证

- 表格测试：非入口模块声明 `secrets` 通过校验，`qq_bot` 仍限入口模块；`secrets.get` 读文件、未声明、未配置；`set`/`remove`/`list` 仅入口模块、不记录参数、`list` 不含值、不能写 `qq_bot`；`secret-set` 写出 0600 文件。
- `approvals.request`：同步调用被拒；异步调用创建一张审批并 `waiting`；租约回收不碰 `waiting`；批准/拒绝后 `call_result` 送回；`always` 被拒且无 grant；`status` 只查本模块。
- 声明 `secrets` 的版本不自动启用。
- 回归：现有 qq 凭据、审批、异步调用、自动启用测试不变。

## 7. 之后：okx-ai-trader 第二版（模块构建，不属于本规格）

沿用旧程序限额：本金 2000 USDT、最大亏损 100 USDT、单笔买入 ≤ 500 USDT、最多 12 笔、最小下单 10 USDT、时长 24 小时、BTC-USDT 模拟盘。模型用 `moduleModel`。联网、`secrets: ["okx_demo"]`、`uses: ["approvals.request", "approvals.status", "provider.complete"]`、15 分钟排期；`start` 发起审批，批准结果推回后才开始。
