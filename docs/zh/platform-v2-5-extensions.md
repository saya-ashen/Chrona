# v2-5 规格：扩展面——对外动作审批、跨模块调用、事件源、本机环境

状态：§3 跨模块调用已在 `platform-v2` 分支实现（2026-10-24，与本文的差异见 §9）；其余仍为草案（2026-10-22）。总纲见 [platform-v2](platform-v2.md)；依赖 [v2-1](platform-v2-1-runtime.md) 至 [v2-4](platform-v2-4-entries-rescue.md)。
本文件是该部分的契约；实现与本文冲突时以本文为准。

## 1. 目标

模块已有的贡献面：工具、后台自动化、模型数据处理（v2-3）、交互入口与通知投递（v2-4）、HTTP 页面（v2-4）、内容区页面（v2-2）、经网络与凭据操作外部服务。本文再开：

| 贡献面 | 本文 |
|---|---|
| 对外动作经审批：模块工具执行发邮件等动作时走策略层 | §2 |
| 跨模块调用：模块组合其他模块的工具 | §3 |
| 事件源：把外部世界的变化带进 Chrona | §4 |
| 本机环境：读写主机文件、在主机路径上执行命令 | §5 |

## 2. 对外动作经审批

现在 `send_external_message`、`modify_external` 等动作由内核工具执行并经策略层。模块化以后执行者变成模块工具：

- 工具可声明 `"action": "send_external_message"`。
- 任何调用方（Provider、owner MCP、其他模块）调用这类工具时，内核先按策略层判定：`auto` 直接执行；`ask` 生成审批，**批准绑定工具名、模块版本 hash 与参数**，批准后由内核以相同参数调用；`never` 拒绝。
- 后台调用遇到 `ask` 时挂入待答复入口，调用方得到 `pending_approval`，不阻塞。
- 模块经 `network` 直接发出的请求无法由内核逐次拦截。因此声明 `network` 的模块，所有对外写行为都应通过声明了 `action` 的工具暴露；这一点写入构建通道提示词，并作为审查卡片的检查项。根本限制要靠 P5 的按主机放行网络。

## 3. 跨模块调用

> 已实现，实现与本节不同之处以 §9 为准（字段名 `uses`、可见性、异步调用、通知模块化）。

### 3.1 声明与调用

```json
"calls": ["translate.translate", "email.send"]
```

```ts
const zh = await chrona.call("translate.translate", { text, to: "zh" });
```

- 只能调用清单 `calls` 中列出的工具；被调用方必须是 `active` 模块，否则抛出 `not_available`。
- 被调用方以普通 `tool` 事件处理，事件带 `caller: { moduleId, eventId }`。
- **归属不变**：被调用方的内核方法调用归属被调用方自己（v2-1 §2.5），按它的能力、策略和预算判定。调用方只得到 `result`。
- Provider、owner MCP 与模块间调用走同一条工具调用路径。

### 3.2 限制

- 调用链深度上限 3；链上出现同一模块即拒绝（防止循环）。
- 被调用方的运行时间计入调用方当前事件的超时。
- 审计记录完整链：`session run → A.tool → B.tool`。

### 3.3 接口兼容

模块的工具名与参数 schema 是对调用方的契约：新版本删除或不兼容地修改了被调用的工具 → 构建报告列出受影响的调用方，**不自动启用**，审查卡片显示警告。回滚同样检查；用户仍可确认执行。

## 4. 事件源模块

### 4.1 拆分

现在连接器（`email.ts`、`chino-health-source.ts`、`local-test-source.ts`）是内核代码，新增来源只能改内核。v2 拆为：

- **抓取**是模块：连接、认证、轮询或长连接、把原始数据转成条目。可替换、可生长。
- **入站流水线**留在内核：去重、附件过滤、落文件、分流、路由。它是"外部文本不可信"的边界，规则不能被模块改写。

### 4.2 `emit`

```ts
await chrona.emit({
  externalId: "<来源内唯一 id>",   // 去重键
  from: "...", subject: "...", body: "...", receivedAt: "<ISO>",
  attachments: [{ name, mime, bytes }],
});
```

- 能力 `source`；事件源模块需声明 `"content": true`。
- 内核处理与现有连接器条目相同（`connectors.ts` `storeInboundItems`），只是落点改为**来源模块内容区**的 `inbox/<日期>/…`（用户在该应用页面看到收件箱，Provider 只读可见）；`InboundItem.connectorId` 改为来源模块 id。
- 分流规则文件从事务的 `.chrona/rules.json` 移到来源模块内容区的 `.chrona/rules.json`。

### 4.3 路由

- 其他模块用 `inbound` 触发订阅：`{ "inbound": { "source": "<模块名>", "match": { ... } } }`，取代 P4 的 `connector` 字段。
- 未被模块处理（或返回 `handled: false`）的条目按分流规则与批处理，在全新会话中唤起 Provider，结果以通知投递（v2-2 §2.4）。

### 4.4 内置事件源

| 模块 | 能力 | 来自 |
|---|---|---|
| `email` | `source`、`network`、`secret:email`、`content`，工具 `send`（§2，`send_external_message`） | 现 IMAP/SMTP 连接器；`chrona_send_email` 改为调用该工具 |
| `chino-health` | `source`、`network`、`content` | 现 Chino 健康来源 |

`local-test-source` 改为测试中的模块，不内置。删除内核连接器适配器与 `Connector` 表（凭据转为 `secret:*`）。

## 5. 本机环境

### 5.1 能力

```json
"effects": ["host:/home/saya/Downloads:rw", "host:/home/saya/photos:ro"]
```

- 内核把声明的主机路径以同一路径绑定进模块沙箱（`rw` 用 `--bind`，`ro` 用 `--ro-bind`）。模块可以用这些路径上的文件，也可以执行 `/nix/store` 中的程序处理它们。
- 规则沿用 Provider `hostPaths`（`pi-launch.ts` `hostMounts`）：绝对路径且存在；`<dataDir>` 始终遮蔽；固定拒绝 `/`、主目录本身、`~/.ssh`、`~/.gnupg` 等凭据目录。
- 声明 `host:*` 的模块从不自动启用；审批卡片逐条显示路径与读写权限。

### 5.2 超出文件的操作

systemd、桌面通知、Docker socket 等需要绑定特定 socket 或设备，权限远大于文件，v1 不提供。确有需要时以 `host:<socket 路径>:rw` 单独审批，并列入固定警告。

## 6. 分阶段

1. v2-5a：§2 对外动作审批、§3 跨模块调用。
2. v2-5b：§4 事件源模块化；`email`、`chino-health` 内置模块；删除内核连接器。
3. v2-5c：§5 本机环境。

## 7. 验收

1. `chrona_send_email` 经 `email.send` 生成绑定参数的审批；参数被改动后原批准无效。
2. 简报模块调用 `translate.translate` 成功；未声明的调用被拒；A→B→A 的循环被拒；`translate` 新版本删掉该工具时构建报告列出简报模块并阻止自动启用。
3. RSS 事件源模块按定时 `emit` 条目 → 出现在其内容区 `inbox/`，去重有效 → 订阅它的模块收到 `inbound` 事件；未处理的条目批量唤起 Provider。
4. 现有邮箱改由 `email` 模块抓取后，入站行为与现在一致。
5. 声明 `host:/home/saya/Downloads:rw` 的模块能整理该目录，读不到主目录其他位置与 `<dataDir>`；审批卡片列出路径。

## 8. 未决问题

- 分流规则文件是否保留：它是声明式数据，不是代码；但模块订阅已能覆盖其大部分用途。
- 条目目前按邮件建模（from、subject、body）；设备状态、价格等来源是否需要更一般的条目结构。
- 本机环境固定拒绝列表的完整内容。
- 跨模块调用中被调用方需要 `ask` 审批时，调用方如何在批准后继续（v1：收到 `pending_approval`，下次事件重试）。

## 9. 实现说明：跨模块调用与通知模块（2026-10-24）

### 9.1 接口与权限

> 当前模块调用规则见 [安全机制简化 §3.2](security-simplification.md)：模块可见工具面向任何模块，`uses` 不作运行时准入。
- 模块工具就是接口。每个工具声明 `visibility`（`provider`、`owner`、`modules`、`kernel`，默认 `provider`+`owner`，与此前行为相同）和 `idempotent`（默认 false）。
- 调用方在清单 `uses: ["<module>.<tool>"]` 中声明（本文原名 `calls`），随版本审批；审批卡显示“调用其他模块 / 供其他模块调用”。新增 `uses` 或接口可见范围变宽视为新能力，不自动启用。
- 被调用方决定谁能调用：内核在路由时按可见性判断受众。owner API（含 MCP）只能到达 `owner` 可见的工具，入口模块名作为 `via` 记录在审计里，不授予任何权限；Provider 只能到达 `provider` 可见的工具。

### 9.2 调用
- `chrona.call(target, args, { mode, key, reply, timeoutMs })`，经模块自己的 socket 进入内核，由 supervisor 投递为目标的 `tool` 事件。事件带内核记录的 `caller`（`module`/`provider`/`owner`/`kernel`）和 `call`（id、key、attempt、chain）。
- 同步（默认）：等待结果。目标已在本调用路径上等待时立即返回 `cycle`（目标的事件串行，永远无法应答）；路径长度上限 6。送达后超时或崩溃 → `unknown`，不重试；未送达 → `unavailable`；目标抛错 → `failed`。
- 异步：需要调用方的幂等 `key`，在调用方事务内写入 `ModuleInvocation`（同一调用方、目标、key 只有一条）。内核在 tick 旁投递：未送达（目标未安装、暂停、启动失败）退避重试，最多 6 次；送达后无应答、或 Chrona 中途重启导致租约过期 → 仅 `idempotent` 目标重新投递，否则标为 `unknown`。不承诺对外副作用恰好一次。`reply: true` 时把 `call_result` 事件回送调用方；也可 `chrona.callStatus(callId)` 查询。
- 异步调用不形成等待，A→B→A 可以通过异步完成；需要同步回调的设计应改为异步。

### 9.3 通知模块
- 内核不再含通知业务。内置 `notify` 模块负责预算（日上限、静默时段、负反馈降级、回复不计入）、摘要、出口与接收人选择（发送时判断聊天出口是否就绪，否则留在网页），并通过 `qq.deliver`（对模块可见）异步投递；结果未知记为 `uncertain`，从不自动重发。
- Chrona 自己要告诉用户的事（运行结果、审批、模块失败等）就是一次对 `notify.send` 的异步路由调用；Today、健康、设置和 `/notifications` 路由向 `notify` 同步查询，`notify` 不可用时显示为空。
- `chrona.notify(...)` 是兼容别名（`notify_user` 能力 → 对 `notify.send` 的异步调用），只为此前写成的模块保留；新模块用 `uses: ["notify.send"]`。没有活动版本调用它后删除。
- 旧 `Notification` 表不删除：新版本第一次 tick 时把各工作区的旧行与通知设置一次性复制给 `notify`（与标记同一事务）；持有发送租约的 queued 行导入为 `uncertain`。

### 9.4 未做
- §3.3 接口兼容检查（被调用工具删除或不兼容修改时列出调用方并阻止自动启用）尚未实现。
- §2 对外动作审批、§4 事件源、§5 本机环境未实现。
