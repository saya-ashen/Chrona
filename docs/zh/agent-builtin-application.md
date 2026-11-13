# Kernel Agent 与已登记 Provider

2026-11-11 的工作树实现改为通用 kernel Agent API 与普通 Provider 应用。本页取代旧的不可变 builtin Agent 设计；文件名保留供既有文档引用。接口目标见[规范第 9 节](kernel-api-design.md#9-agent)，源码、测试、实际部署分别判断。此前 builtin Agent 的验收不能证明新版通过，也不会更新既有实例。

## 所有权

kernel 保存 Provider 登记、真实 caller、上下文归属、Run 准入、唯一队列、硬预算、租约、取消、事件和实际停止证据。kernel 不创建 Pi 适配器，不拥有模型、thinking、profile、Skill、扩展或原生协议的策略。

Pi 位于 `external/pi`，是默认预装的普通应用，可按受控生命周期暂停、更新和移除。Pi 拥有适配器、配置、现有 RPC 进程、操作回执和原生协议。初始化记录安装或跳过，删除后不自动补装；升级 Chrona 不自动替换 Pi。Web、Coding、Mind 等业务应用拥有会话和业务编排。

## 七个公开工具

| 工具 | 用途 |
| --- | --- |
| `agent.register` | 当前已批准、活跃应用登记自己的执行端点、协议版本、能力和配置入口；不能传入另一应用身份 |
| `agent.providers` | 分页查看登记、能力、配置入口和观测可用性 |
| `agent.run` | 创建或继续上下文，按 `kind: conversation | completion` 入唯一 Run 队列，接受 Provider 自有 `providerOptions` |
| `agent.read` | 根据绑定 Run、视图及游标读取事件、状态和交互；支持有界等待 |
| `agent.write` | 向已有 Run 发送消息，或按 questionId 回答已有交互 |
| `agent.stop` | 请求停止并返回实际确认状态；收到请求不等于停止 |
| `agent.native` | 在该 Run 已有的 Provider 操作上发送原生请求并返回结构化响应 |

输入、输出以 `packages/contracts/src/steward/agent-provider.ts` 与生成的 `schemas/system-tools.json` 为准。写入的请求 key 在 `chrona.call` 的 `options.key` 中。没有旧 `context/get/stream/respond/interrupt/complete/configure` 别名；模型及 profile 配置由 Provider 的普通工具或页面处理。

上下文归实际入口应用所有。首次 Run 固定 Provider 登记版本，后续控制和恢复继续使用该绑定；选择新的默认 Provider 不切换已运行任务。没有可用 Provider 时报告不可用，多个可选项时须明确选择。登记提供实际执行端点，不只是展示信息。

## 同步受理与 Run 完成

七个 Agent 工具都只接受 `mode: "sync"`（省略时即为 sync）。`mode: "async"` 会以 `invalid` 拒绝，不会创建异步调用回执；不能再拿返回值当 `callId` 轮询 `callStatus`。SDK 对推断出的已知字面量目标做类型约束；显式结果泛型或动态目标仍可能通过类型检查，运行时统一拒绝非法 Agent async 调用。普通应用的 `{ moduleId, tool }` 目标仍按该应用合同调用。

`agent.run` 同步返回 `{ runId, contextId, status, active }`，表示已受理入队，不表示模型执行完毕，也没有生成文本或异步路由的 `callId`。先持久化由业务操作派生的 key 和完整请求，再发送；收到响应后保存 Run 身份。以下示例中的 `operationId`、`prompt` 由应用提供，持久化由应用自己的数据层完成：

```ts
const key = `completion:${operationId}`;
const args = { kind: "completion" as const, prompt, providerOptions: {} };
const started = await chrona.call("agent.run", args, { mode: "sync", key });
// 此处保存 started.runId/contextId；后续恢复和继续会话都使用它们。
let cursor: string | undefined;
const deadline = Date.now() + 30_000;
do {
  const page = await chrona.call("agent.read", {
    runId: started.runId, ...(cursor ? { cursor } : {}), waitMs: 1000,
  });
  // 按 sequence 消费并保存 items；completion 的 payload 是 { text, inputTokens, outputTokens }。
  // 将消费结果和 nextCursor 一起持久化；Run 状态以 page.run 为准。
  cursor = page.nextCursor ?? cursor;
  if (page.ended && !page.nextCursor) break;
} while (Date.now() < deadline);
// 到达本地等待上限只表示本次观察结束，不能据此宣布完成或另起 Run。
```

`ended` 表示执行已结束，不表示分页已读完；仍有 `nextCursor` 时继续读取。成功与否还须检查 `page.run.status`；失败、取消和未知不能当作成功。持续对话复用 `contextId`。`agent.write`（消息或 questionId 绑定的回答）、`agent.stop`、`agent.native` 同样使用同步调用和各自稳定的 `options.key`。`write` 返回 `{ accepted: true }` 只表示输入受理；停止响应必须检查 `stopConfirmed`，未确认停止时保留原 Run 并继续核对。

## 丢回复后的 key 恢复

`callStatus` 查询的是调用回执，`agent.read` 查询的是 Run；两者的状态不是同一生命周期。带 key 的同步 `agent.run/write/stop`（以及 `register`）会保留返回输出，因此即使没有拿到 `callId`，原调用应用也可以查询：

```ts
const receipt = await chrona.callStatus({ target: "agent.run", key });
// receipt.status === "succeeded" 时，receipt.output 是原受理结果；
// 校验并保存其中的 runId/contextId，再用 agent.read 读取当前 Run。
```

恢复须遵循以下合同：

1. 保存并沿用同一个调用应用、活动版本、目标、key 和完整参数。同步 `agent.run` 用原参数、原 key 再调用，会恢复同一 Run 的受理身份；原始受理状态可能已过时，当前状态仍从 `agent.read` 获取。改参数复用 key 报 `conflict`，换应用版本不能继承原版本回执（`forbidden`）。
2. `callStatus` 的 `running/unknown/failed` 不是模型运行状态。`not_found` / `Call not found` 只说明未查到该调用回执，不能推出任务已停止或授权换 key 重跑。先核对原目标和 key；已知 `runId` 时直接读原 Run，否则用原请求、原 key 同步恢复受理。原调用若是被拒绝的 async Agent 调用，本来就没有异步回执，应修正模式并保持原业务身份。
3. `write/stop/native` 的未知效果须核对原 Run 或 Provider 操作；用原 key 恢复仍可能返回 `unknown`，不得因此改 key 重复控制或另起模型。`callStatus` 不保留 `read/providers/native` 的私有返回输出，不能把它当作原生响应或事件数据的恢复接口；需要这些数据时按对应工具合同读取或核对原操作。

## 登记与回调

登记记录绑定当前 moduleId、批准活动 hash、协议版本及每个执行端点的 contractHash。health/start/status/inject/abort/release 和可选 transcript/native/complete 都是登记应用自己的 kernel-only 工具。配置入口面向 owner，不接收内核 token 或 callback 身份。

kernel 在调用执行端点前验证固定身份及合同，签发绑定 Run 的 token、路径、操作 ID 和 callbackId。`runtime-callback.event` 只接收绑定 Provider 版本的事件；普通应用不能借请求参数自授回调身份。用户工具仍以原入口应用的准入执行，不借 Provider 身份扩权。

Provider 在外部启动前保存启动摘要，终态先持久化再通知。只有启动摘要而没有终态的操作保持未知；查询、重启或丢失响应均不授权重复执行。停止及 host 后代回执保留实际证据，不能从错误文案或进程自报推导树已停止。

## Pi 配置与原生协议

Pi 使用显式选定 profile，未选定时遵循宿主 Pi 环境及该服务用户的默认配置。服务用户与交互用户可能不同，配置页应显示实际来源。模型和 thinking 归 Pi；不再以 fast/balanced/deep 为内核固定政策。用户的 Skill、扩展、模板、上下文和原生审批配置由 Pi 正常加载，Chrona 的桥接资源按需追加。

`providerOptions` 是启动参数，`agent.native` 使用已经存在的同一进程。Provider 负责校验自身协议、关联响应及同步执行状态；不能通过原生命令另起隐藏任务、切换上下文身份或重放不确定操作。原生输出保留结构和明确的保留缺口，凭据继续脱敏；缺少原始数据不应伪装成完整原生输出。

宿主通过通用 `providerModules` 接线，并只向核验过的发行应用版本交付相应环境。配置不包含数据库或其他应用凭据。trusted-local 使用同一服务用户的 OS 权限，路由及 Manifest 不构成恶意代码隔离。required-isolation 仍明确拒绝。

## 验证范围

开发和测试使用全新临时数据库与假 Provider/假 Pi，不调用真实模型或账号。应验证无 Provider 启动、登记归属及冲突、端点合同固定、跨 Run 控制拒绝、原生同进程关联、未知效果不重放、原始事件保留、预算以及实际停止。当前改动引入新的初始 schema；不能直接将新程序覆盖到旧数据实例，不提供旧库兼容或校验绕过。
