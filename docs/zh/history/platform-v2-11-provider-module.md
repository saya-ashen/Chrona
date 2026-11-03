# v2-11 规格：Provider 是系统模块

状态：已实现（2026-10-25）。依赖 [v2-10](platform-v2-10-ai-calls.md)；修改其中的 `ai` 系统模块。

## 1. 背景

v2-10 之后模块已经只通过路由调用使用 AI（`ai.complete`、`ai.wake`），但背后有两个分开的内核端口：`ports.provider`（完整 agent 运行）和 `ports.modelGateway`（单次补全），用同一套 Pi 启动配置分别创建。`ai` 这个名字也没有说明它背后就是 Provider。

## 2. 改动

- 系统模块 `ai` 改名为 `provider`：`provider.complete`（单次补全，原 `ai.complete`）、`provider.wake`（在新会话中启动 Provider，原 `ai.wake`）。档位、额度、记录与审计不变（`moduleModel` 设置、清单 `model`）。
- 内核只有一个 Provider 端口：`ProviderAdapter` 增加可选的 `complete`，Pi 适配器用原来的模型网关提供它；`ports.modelGateway` 删除。没有配置 Provider（`CHRONA_STEWARD_AGENT` 不是 `pi`）时 `provider.complete` 返回 `unconfigured`；此前网关不依赖这个开关。
- SDK：`chrona.model`、`chrona.wakeProvider` 调用 `provider.*`；构建提示与测试内核用新名字。

## 3. 边界

- `provider` 是内核进程内的系统模块，与 `chat`、`approvals` 一样：不能被提议、修改或替换，不在沙箱里运行。Provider 负责写和改模块，若它能改自己，就绕开了策略层，坏了也无法再通过对话回滚（兜底仍是 `chrona admin`）。
- 运行队列、令牌、每次工具调用的策略判定、预算和审批仍在内核；`provider` 模块只负责“怎样调用模型、怎样运行 agent”。
- Provider 自己的工具（文件、shell、web，以及 [v2-12](platform-v2-12-provider-browser.md) 的浏览器截图）仍是 Provider 的能力，通过启动参数与扩展配置，不是模块工具。

## 4. 兼容

已批准的模块版本按内容哈希绑定，其 `uses` 和代码中的 `ai.complete` / `ai.wake` 继续有效：`currentTarget` 把它们映射到 `provider.*`，用于 `grantedUses` 的契约分析、路由目标解析（含升级前已排队的调用）、构建内核与测试内核；`uses` 不再作运行时准入，见 [安全机制简化 §3.2](../security-simplification.md)。所有模块重建后删除这个映射，与 v2-10 的旧声明一起收尾。
