# Agent 原语与应用编排

Agent 是发行内置的独立 SDK 应用，持有 Provider/Pi 句柄。业务应用通过普通模块路由调用它；内核保留真实 caller、授权、预算、唯一 Run 队列和停止证据。本页描述当前开发树，不表示已经部署。

## 接口与职责

通用上下文使用 `agent.context` 创建，以调用模块的 moduleId/hash 绑定归属。`agent.run` 接受 context-id、request-key、prompt、lane，以及明确选择的 tools 和当前模块的 content 引用。`get` 读取单个 Run，`stream` 返回技术事件游标、经过脱敏的最近 transcript 快照及交互问题；它不是逐 token 增量流。`write/interrupt/respond` 提供有请求身份的控制。接口不接受模块伪造的 caller、token、cwd 或宿主路径。

项目执行也使用 `run/get/lookup/stream/write/interrupt/respond/inspect/placement/locations/cleanup`，以 execution-id、run-id、attempt-id 精确限定目标。项目授权、工作区占用与成果校验继续由现有执行服务治理。Agent 不提供业务会话列表或切换策略。

上下文创建、Run 启动与控制具有持久请求身份；同一身份改变参数会冲突。控制记录只有意图、没有完成证据时，重试返回 unknown。Agent/应用失联不证明子进程停止。通用上下文在未知停止状态下继续占用会话和执行容量，直到收到真实证据。一个上下文同一时间只允许一个未确认结束的 Run。

应用选择的工具必须经过原模块 caller 的现有权限检查。执行时继续使用原模块身份，不能变成 owner 或 Provider。工具选择只约束这次运行的可调用集合，不授予额外权限。`modules.build` 仅接受已绑定活动上下文的内部执行引用，并保留原有构建预算和审批。

## 应用拥有的行为

- coding 管理项目任务、成果解释和业务会话索引。选择会话本身不会启动、恢复或中断模型；当前会话索引绑定既有单项工作，不宣称支持分组工作的模型恢复。
- Web、MCP、QQ 管理自己的私有会话、标题、提示词、消息、切换、等待与交付。共享源码位于 `entry-app/conversations.ts`，发行构建把副本放入三个应用；运行时各自使用私有数据，不经过通用 SDK 或内核共享业务状态。
- Web 先保存回复再发 SSE，页面重连按持久消息 ID 合并；MCP 在应用侧短轮询；QQ 将回复绑定到原接收者，先保存投递意图再调用传输。重启后不自动重放无法确认的 QQ 投递，绑定变化时保留而不误投。
- QQ 的入口 manifest 现在声明 `uses: ["*", ...]`，与 Web/MCP 一样通过正常权限规则选择面向用户的工具。这扩大了 QQ 模块可调用的 owner 接口范围；Agent 仍保留原 QQ moduleId/hash，并且只向该次运行开放明确选择的工具。该声明不提供宿主隔离。
- mind 提供自己的协议和提示词，选择明确工具集合，再请求背景 Run。它通过 Web 的 today 工具聚合业务概览，通过 activity 读取运行事实。
- SDK `chrona.model` 使用 `agent.complete/completion`，保留原模块的事件额度与用量结算。`wakeProvider` 使用 `agent.context/run`，应用负责 prompt 与 tools，不再调用内核唤醒业务接口。

## 旧数据与接口

生产注册表已移除 `chat`、`provider`、`executions` 三个系统目标。旧会话、消息、transcript 和附件通过只读 `history.sessions/session/messages/transcript/file` 查看；history 拒绝新 Agent 上下文以及跨工作区读取。构建记录仍显示真实排队和结束状态。`activity.runtime/runs` 提供只读运行事实。

新应用会话不迁入旧数据库消息表。旧记录保持只读；继续交流需新建应用会话。内部旧服务仍供既有内核路径使用，部分回归测试显式注册旧服务测试夹具；这些注册不进入生产装配。没有执行生产数据迁移。

## 验证边界

集成测试使用真实 SDK 进程和受控 fake Pi，覆盖归属、去重、取消、问题回复、未知停止、工具选择、原 caller 预算、会话重启和 QQ 投递。自动测试不使用真实模型、QQ 账号或设备。最近 transcript 是经过截断的快照；当前入口回复主要从该快照生成，不宣称逐 token 推送或完整文件成果交付。发行检查和本机试用结果以本轮验收记录为准。
