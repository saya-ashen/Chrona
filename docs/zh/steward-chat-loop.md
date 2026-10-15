# 聊天交代 → 明确委托 → 持续跟进 → QQ 返回结果

状态：2026-10-14 实现。本文描述**当前代码**与 Chino 上的接入方式；部署与联调状态见文末「现状」。
产品方向见 [personal-steward](personal-steward.md)。

## 职责（单一调度与投递权威）

| 角色 | 负责 | 不负责 |
| --- | --- | --- |
| Hermes（日常助理，平台 `qqbot`） | 普通聊天；把 `/chrona` 命令分发给插件 | 调度、重试、发送 Chrona 通知、授权、调用 Chrona |
| `chrona-steward` 插件 0.2.0（Hermes 进程内） | `/chrona` 命令：从网关**已认证的会话上下文**取身份、确定性解析、带作用域凭据调用 Chrona、渲染回复；`pre_gateway_dispatch` 只记录命令消息 ID 与处理“引用通知 + /chrona” | 模型工具、上下文注入、线程、后台循环、发消息、授予权限 |
| Chrona | 委托/事务/待处理/通知发件箱/审计的持久状态；按委托检查来源；Pi 评估；确定性权限；投递与回执 | 持有 QQ 凭据 |
| `hermes send`（宿主官方 CLI） | 每次投递发送一条消息；自己读取 Hermes 的 QQ 凭据 | 重试、调度 |

Hermes cron 不参与本业务链路；Chrona tick 是唯一调度者。

## 入口规则：只有 `/chrona`（2026-10-14 起）

- 只有以 `/chrona` 开头的消息进入 Chrona。Hermes 把插件 slash 命令在**模型轮次之前**分发，插件确定性解析、直接回复，不经 LLM；模型没有任何 Chrona 工具，也不注入 Chrona 上下文。普通聊天（谈论 Chrona、问进度、提到日期、出现回复码）不会调用或写入 Chrona。
- 前缀规则沿用 Hermes：允许前导空白、命令名大小写不敏感；`/chronax`、句中 `/chrona`、引用块和代码块里的 `/chrona` 都不是入口；`/help` 等宿主命令不受影响。
- 只作用当前这条消息，没有 Chrona 模式；澄清回复要求用户重新发送完整的 `/chrona` 命令，不粘滞。
- 裸回复码（不带 `/chrona`）**不接管**。引用一条 Chrona 通知再发 `/chrona 暂后` 时，`pre_gateway_dispatch` 从被引用的通知文本中取唯一回复码改写为 `/chrona <码> 暂后`；QQ 引用元数据只有被引用内容，没有可与发送回执对应的稳定消息 ID，因此不以平台 ID 绑定。
- 路由≠授权：服务端要求 `chat.route = "chrona_command"`（缺失或其他值在输入校验阶段拒绝），身份白名单、聊天绑定、本条原话含回复码与动作、修订号 CAS、提议≠授权全部照旧。查询为纯读。
- 用户命令：`/chrona`（帮助）· `/chrona 委托`（只读）· `/chrona <任何需求>`（2026-10-14 晚起：插件不分类，记录为一件工作交给真实 Pi 处理，见 [steward-agent-work](steward-agent-work.md)）· `/chrona <码> 补充｜回答 <内容>` · `/chrona <码> 确认｜拒绝｜取消｜暂停｜恢复｜撤销` · `/chrona <码> 收到｜暂后 [N小时]｜完成｜忽略｜少提醒｜反馈 <文字>`。带动作不带回复码时只列出候选，不猜对象。
- 通知格式：`【Chrona】标题`（标题与正文重复时只留一行）· 为何重要 · 下一步 · 来源/详情 · `回复：/chrona <码> 收到｜暂后｜完成｜暂停（发送≠已读）`。

## 数据流

```text
QQ 私聊 "/chrona 盯着 Chino 服务健康，异常 QQ 告诉我"（2026-10-14 晚起先成为一件工作，由 Pi 判断后经 chrona_propose_delegation 走下面的提议流程）
  → 插件 /chrona 命令 → chrona_steward_chat_propose（chat 身份 + 本条原话 + route=chrona_command）
  → Chrona：唯一已连接的 chino_service_health 来源 → Delegation(proposed, channel=hermes_qqbot, recipient=qqbot:<openid>, replyRef=K7QM)
            + 决策待处理；不授权、不发通知
  → 插件回复「已记录提议 K7QM，尚未生效…确认请发：/chrona K7QM 确认」
QQ "/chrona K7QM 确认"
  → chrona_steward_chat_respond(ref=K7QM, action=confirm)
  → Chrona 校验：身份在服务端白名单、委托绑定到此聊天、本条原话含 K7QM 且表达了确认（否定/矛盾词→澄清）、修订号 CAS
  → Delegation active
Chrona tick（每 60 s）→ 按委托 cadence 轮询 → Pi 评估 → 确定性权限 → notify_now
  → 发件箱：claim 时以委托**当前**策略取 recipient、再次核对白名单、分配条目回复码
  → hermes send --to qqbot:<openid> --json --file -（正文经 stdin）
  → accepted(receiptRef=qqbot:<message_id>) / rejected(可重试 → 退避) / uncertain(不自动重发)
QQ "/chrona AB3D 暂后" / "/chrona K7QM 暂停" / "/chrona AB3D 反馈 …"
  → chat_respond → 待处理/委托状态改变 + 审计；网页同步可见
```

## 安全与授权要点

- **入口**：见上文「入口规则」。
- **身份**：插件只用 `HERMES_SESSION_PLATFORM/CHAT_TYPE/USER_ID/CHAT_ID/MESSAGE_ID`；要求 `qqbot` + `dm` + `user_id == chat_id`（QQ 单聊 openid）。Chrona 再以 `CHRONA_STEWARD_CHAT_RECIPIENTS`（逗号分隔 `qqbot:<openid>`）校验；未列入 → FORBIDDEN，审计只存哈希。
- **凭据**：插件持有专用管理凭据 `chrona_mgmt_…`（`steward-chat` 预设 = `steward:read` + `steward:chat`），文件 0600，只发往配置的回环 MCP 地址，拒绝重定向。该凭据不能捕获笔记、不能通过管理工具提议其他委托、不能授权工具或改连接。QQ 凭据始终只在 Hermes。
- **proposal ≠ grant**：聊天提议只建 `proposed`。确认必须由用户本条原话引用回复码并表达确认；Chrona 服务端复核（插件也复核）。缩小权限（暂停/撤销/暂后/忽略）同样需要回复码，避免误操作他项。
- **数据最小化**：只有用户本轮主动交代/回复的那一条消息进入 Chrona；提议保存原话（委托「原话」字段），回复只审计 SHA-256。不导入 QQ 聊天记录。外部事件文本是数据。
- **出站清洗**：通知正文中 `MEDIA:` 改为全角冒号、删除 `[[`/`]]`、去控制字符、分段截断（≤1500 字），防止事件文本触发 Hermes 附件/指令。参数固定，正文不进入 argv。
- **目的地**：只来自认证聊天绑定；事件或模型文本不能改变。投递时以委托当前修订的策略为准，暂停/撤销后待发通知被抑制。

## 幂等、失败与恢复

| 情况 | 行为 |
| --- | --- |
| QQ 消息重投 / Hermes 重启 | 插件以 `平台:chatId:messageId:工具:ref:动作` 生成 UUIDv5 requestId；Chrona 管理命令回执原样重放 |
| 同一委托再次确认 | `unchanged`，不再递增修订号 |
| 网页已撤销后聊天确认 / 修订号不符 | `conflict`，返回当前状态 |
| 无回复码 / 原话无回复码 / 否定或矛盾 | `needs_clarification`，助理需追问，不猜 |
| Pi 不可用 | 事件保持 pending，积压可见，恢复后评估一次 |
| QQ 全部端点拒绝 | `rejected` 可重试：1/5/15/60 分钟退避，最多 6 次 |
| 网络中途失败 / 未知输出 / 超时 | `uncertain`：不自动重发（QQ 无幂等键），网页提示人工确认 |
| Chrona 重启 | 5 分钟 claim 租约到期 → uncertain，不重发；已发送行不再发送 |
| 发送成功 | `sent` ≠ 已读；条目仍为 open，直到用户「收到/完成」 |

不刷屏：委托通知策略（即时/摘要/静默、冷却、免打扰、每日上限）在投递时强制执行；聊天提议默认即时、冷却 60 分钟、每日 ≤6 条。

## 配置（Chrona 服务）

| 环境变量 | 用途 |
| --- | --- |
| `CHRONA_STEWARD_CHAT_RECIPIENTS` | 允许的聊天身份/目的地，如 `qqbot:<openid>`；未设置 → 无 QQ 适配器、聊天工具一律拒绝 |
| `CHRONA_PUBLIC_URL` | 通知中「详情」链接的源，如 `https://chrona.saya.love` |
| `CHRONA_STEWARD_HERMES_COMMAND` | 可选，`hermes` 可执行文件路径 |

Chrona 必须以拥有 Hermes home 的同一宿主用户运行，`hermes send` 才能读取 Hermes 自己的凭据；Chrona 不读取它们。

## 代码位置

- 契约：`packages/contracts/src/steward/index.ts`（`CHAT_*`、`chatIdentitySchema`、`DeliveryMessage`）、`packages/contracts/src/api/management-steward.schema.ts`
- 回复码与意图：`packages/domain/src/steward/chat.ts`
- 聊天授权：`packages/engine/src/modules/steward/chat.ts`；管理入口 `packages/engine/src/modules/management/steward.ts`
- 投递：`packages/engine/src/modules/steward/delivery.ts`、`packages/integrations/src/steward/hermes-qq-delivery.ts`、`apps/server/src/steward-runtime.ts`
- Hermes 插件：`external-plugins/hermes-steward/`
- 网页：`features/steward/model/chat.ts` 及委托/今日/连接页面

## 现状（2026-10-14）

- 验证：`apps/server/src/__tests__/api/steward-chat-loop.bun.test.ts`（真实 HTTP、管理 MCP、假 `hermes` 子进程）12 项；领域/引擎/适配器/插件单测；全量 `test:bun`、`test:api`、typecheck、lint 棘轮、边界检查通过。
- Chino 生产：包 `chrona-0.3.1-steward-chat-20261014`，回执 `/var/lib/chrona-pi/deployment/20261014-chat-loop/receipt.json`。97 张旧表逐列不变，新增 5 列 2 个唯一索引。
- 真实 QQ：隔离测试实例（临时库）经真实 `hermes send` 向授权私聊发送 1 条「【Chrona链路验收】」测试通知，QQ 返回 message id（已发送，不代表已读）。
- Hermes：`chrona-steward` 插件已安装并经 `reload-plugins` 热加载（网关未重启）。Nix 安装下 `hermes plugins enable` 的 uv 准入失败，因此直接在 `plugins.enabled` 追加；home-manager 下次激活可能不保留，需要在 nix-config 中持久化。
- 待完成：用户在 QQ 中亲自交代一条委托并回复确认；之后由真实 Chino 服务状态变化触发通知。旧 `chrona` Hermes 插件（无鉴权 `/api/mcp`）此前就加载失败，与本链路无关。

### 入口规则上线（2026-10-14 晚）

- Chrona 包 `chrona-0.3.1-steward-chrona-cmd-20261014`（无 schema 变化），回执 `/var/lib/chrona-pi/deployment/20261014-chrona-command/`；生产读回：无 route / route=tool 的聊天调用被拒，route=chrona_command 的只读查询成功。
- 插件 0.2.0：`hermes plugins doctor` 通过（0 工具、1 钩子）；隔离 HERMES_HOME 中用 Hermes 自身的 MessageEvent/插件加载器/会话上下文/钩子运行器验证前缀边界、只读命令、身份拒绝与引用改写（`host-check.log`）；经网关控制 socket `reload-plugins` 热加载，网关 PID 不变，config.yaml 未改。旧版插件备份在 `plugin-backup/chrona-steward-0.1.0`。
- 待用户：在 QQ 发 `/chrona` 与 `/chrona 委托` 验收；需要建立委托时自行发送 `/chrona <需求>` 并确认。

## 独立 QQ 机器人（2026-10-15 起，取代经 Hermes 的链路）

Chrona 不再借 Hermes 的 QQ 机器人。Chrona 进程内直接连接用户自建的 QQ 官方机器人（`CHRONA_QQ_APP_ID`），Hermes 的机器人、凭据、聊天与 cron 均不变。方案与台账：`.claude/handoffs/dedicated-qq/`。

| 项 | 行为 |
| --- | --- |
| 传输 | `packages/integrations/src/steward/qq-official.ts`：token（AppSecret 只在需要时从 `CHRONA_QQ_SECRET_FILE` 读取，要求本用户 0600）、C2C REST、WS gateway（Identify/Resume、心跳与僵尸检测、op7/op9、4004 刷新 token、致命关闭码停止、退避 2–60 s、握手 20 s 超时）。只订阅单聊/群事件位并只处理 `C2C_MESSAGE_CREATE`；群聊不启用 |
| 身份 | 新 bot 的 openid 是应用作用域：独立命名空间 `chrona_qq:<openid>`、渠道 `chrona_qqbot`。管理 MCP（Hermes 插件凭据）只能提交 `qqbot` 身份 |
| 绑定 | `chrona qq bind-code --workspace <id>` 生成一次性码（只存加盐哈希；10 分钟；5 次错误作废；单次；跨进程加锁）。用户在新 bot 私聊发 `绑定 <码>`。绑定前只回复固定的绑定说明（每人每小时一次），不读 Chrona；绑定后其他人只得固定拒绝文本 |
| 入口 | 每条私聊都是 Chrona 输入，`/chrona` 前缀可选；`<码> <动作>`（或引用一条 `【Chrona】` 通知后只发动作）执行动作，动作后有多余文字时只澄清不执行；其余文本交给真实 Pi 作为一件工作；「进度」只读；「帮助」 |
| 去重 | 平台消息 id 先持久化（保留 2000 条/7 天）再处理：重放/重启不重复写入；处理前崩溃的那条需用户重发 |
| 回复/通知 | 回复用被动消息（入站 msg_id）；通知为主动消息，本地每接收者 ≤10 条/分钟；中断/5xx/无 id → `uncertain` 不自动重发，401 刷新后重试一次，限流 → 可重试拒绝走 outbox 退避 |
| 状态读回 | `<CHRONA_DATA_DIR>/qq-bot/<AppID>/status.json`：连接状态、token 是否持有及到期、是否绑定（只含哈希前缀）、是否有待用绑定码 |
| 切换 | 新链路验证后：插件 0.4.0（`/chrona` 只回迁移提示，不再调用 Chrona）热加载；Chrona 设置 `CHRONA_QQ_MIGRATE_FROM=qqbot:<旧>` 并从 `CHRONA_STEWARD_CHAT_RECIPIENTS` 去掉旧身份后重启 → `moveChatDestination` 在一个事务内把旧委托与未领取的 outbox 改到新目的地（修订号不变，旧回复码在新 bot 继续有效；已发送/uncertain 历史保留且不重发；可重复执行） |
