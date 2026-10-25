# v2-10 规格：AI、唤醒与凭据也是路由调用

状态：已实现（2026-10-24）。依赖 [v2-8](platform-v2-8-calls-only.md)、[v2-9](platform-v2-9-owner-api.md)。

## 1. 背景

v2-8 定下“模块之间只有路由调用”，但模块与内核之间还有一条单独的“内核方法”通道：`model`（单次调用模型）、`wakeProvider`（唤醒 Provider）、`secret`（读凭据）、`notify`（`notify.send` 的旧别名），权限靠清单的 `effects` 而不是 `uses`。

## 2. 改动

- 模块通道上只剩 `call` 与 `callStatus`。
- 新系统模块：
  - `ai.complete`（同步）：一次模型调用；档位与额度仍由清单 `model: { tier, maxCalls, maxOutputTokens }` 与 owner 的 `moduleModel` 决定，失败的消息以原原因开头（unconfigured、budget_exceeded、provider_error、timeout、undeclared）。
  - `ai.wake`（异步）：以模块输出为不可信数据，在新会话中启动 Provider。
  - `secrets.get`（同步）：入口模块读取清单 `secrets` 中列出的凭据。
- `ai.complete` 与 `secrets.get` 不记录内容：调用记录里不存参数和返回值（模型的提示与回复、凭据），因此只能同步调用。模型调用的预算记录与审计照旧，同样不含内容。
- 清单：新模块在 `uses` 中列出 `ai.complete`、`ai.wake`、`notify.send`；`effects` 只保留 `network`。旧声明继续有效（`grantedUses`）：`effects` 的 `model`、`wake_provider`、`notify_user` 分别等于 `ai.complete`、`ai.wake`、`notify.send`，列出 `secrets` 等于 `secrets.get`。所以已启用的模块不用改。
- SDK：`chrona.model`、`chrona.wakeProvider`、`chrona.notify`、`chrona.secret` 保留为路由调用的简写。`notify` / `wakeProvider` 的键限定在当前事件（`<事件 id>:<firedAt>:<key>`），与原来内核限定效果键的语义相同；`chrona.call` 的键保持调用方给出的原样。
- 发往 `notify.send` 的异步调用在 notify 模块暂时不可用（如重建中）时仍先存下，送达时再找目标，与原 `chrona.notify` 相同。
- 系统模块名 `ai`、`secrets` 保留。

## 3. 顺带修正

- 内置 `notify` 的作者测试用墙上时钟，在 Asia/Shanghai 的安静时段（23:00–08:00）会把通知归入汇总而失败：夜间构建或部署时内置 `notify` 会被拒。改为固定的白天时钟。

## 4. 之后

旧声明（`effects` 的 `model` / `wake_provider` / `notify_user`）与 SDK 简写在所有模块重建后可以删除，与 v2-8 遗留的兼容字段一起收尾。
