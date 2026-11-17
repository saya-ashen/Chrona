# Agent 与应用编排

通用 Agent API 归 kernel，具体 Provider 通过普通应用登记；内核不携带或预装具体 Provider。当前工具与参数见 [Agent 合同](agent-builtin-application.md)和 [API 规范](kernel-api-design.md)，不沿用旧 `agent.context/run` 或 `provider.complete/wake` 接口。

应用拥有业务会话、消息、提示词、工具选择、记忆与交付。Chat 独立保存自己的会话与执行记录；Web、QQ、MCP 等入口只使用各自数据。会话及交付源码由实际消费应用私有维护，主仓不保留共享业务包或复制生成器。

kernel 绑定真实 caller、批准版本、Run token、宿主 cwd/session 与回调身份，保留唯一 Run 队列、硬预算、租约、取消和实际停止证据。应用参数不能伪造身份；选定工具集合也不授予额外权限。owner 能力来自当前批准版本的显式 `authority: "owner"`，`uses: ["*"]` 只是合同声明。

同一请求身份改变参数必须冲突。未知效果查询原固定回执；应用或 Provider 失联不证明子进程停止，停止未知继续占用容量。取消、问答与结果交付分别处理，不用进度文字推导成功。

应用先持久保存回复与投递意图，再投递并按消息身份合并。无法确认的外部投递不自动重放；目标或绑定变化不能误投给新身份。完整且受检的工具结果才可作为提交关联，截断 transcript 不等于完整交付证据。详见[交付结果](../../../chrona-module-author/docs/app-authoring-delivery.md)、[有限事实](kernel-notification-facts.md)和[持续关注与恢复](continuous-steward-journey.md)。

旧内置 Agent、Coding、全局 history 和早期上下文协议的实施与验收记录从本文件 Git 历史查阅；不恢复这些公开接口，也不迁移真实数据。本次文档清理未部署或调用真实模型。
