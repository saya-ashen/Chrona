# Provider 运行与宿主接线

具体 Provider 是普通应用，通用 Agent API 由 kernel 提供。Pi 后端适配位于 `packages/pi`，普通 Pi 应用从固定输入恢复到 `.generated/applications/pi`；源码与发行来源见[独立应用](independent-applications.md)。当前注册、配置和运行合同见 [Agent](agent-builtin-application.md)及 [API 规范](kernel-api-design.md)。

Provider 持有后端句柄、配置、原生协议与操作回执。kernel 绑定真实 caller、工作区、Run、宿主会话与回调身份，保留唯一队列、硬预算、租约、取消和实际停止证据。会话、消息、业务提示词与交付归应用，不在 kernel 或 Pi 中重建业务系统。文件、命令、网页、技能和扩展复用 Provider 能力。

启动请求固定操作身份与请求摘要；同 key 改变内容拒绝。丢失结果查询原持久回执，不重放启动。取消只是请求，断线或超时不证明实际停止；未知停止继续占容量。Provider 的 journal 与真实停止回执用于对账，不替 kernel 决定 Run 终态。

configured/minimal 等资源选择由可信启动点落实。任务文字不授予系统权限；模型、工具、配置版本和宿主路径不得由模型回复自行替换。配置或依赖缺失须记录原因，不能以新凭据或放宽鉴权作为兜底。

问答请求绑定当前 Run 和独立身份，重复回答只接收一次；期限、取消、进程退出和重启使失效请求不能继续授权。敏感原文与自由文本回答不进入普通审计或在重启时重放。记录答复不等于外部动作成功。通知由应用按自身策略投递，不承诺渠道必达。

进度、最终结果、用量与交付分开。截断 transcript 不是完整执行录像；缺失统计保持未知，不填零。费用估算不等于账单。应用先持久化交付，再发送；未知外部投递不重放，详见[编排](agent-module-orchestration.md)和[交付](app-authoring-delivery.md)。

通用远端宿主仍属后续工作，当前设备协议保持自己的认证、目标绑定和停止边界。旧内置 Agent、Coding、`chat.*` 与 `provider.*` 接线和阶段验收从 Git 历史查阅，不恢复这些公开接口。历史替身和 Linux 检查不证明当前版本已部署、三端已验收或真实账号可用。
