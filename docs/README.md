# 文档入口

本源码仓维护通用 kernel、宿主、CLI、数据库和 SDK。具体应用源码、页面、私有配置、构建和发行在各自仓库维护；kernel 不预装应用，也不恢复固定应用副本。

按任务阅读。目标、当前实现、静态核对、测试及部署分别记录；旧文档中的“当前”“已完成”和优先级不自动适用于本次开发。

| 任务 | 入口 |
| --- | --- |
| 产品目标与公开合同 | [设计目标](zh/steward-goals.md)、[API 规范](zh/kernel-api-design.md) |
| 当前代码与开发规则 | [架构](zh/architecture.md)、[开发指引](../AGENTS.md)、[贡献说明](../CONTRIBUTING.md) |
| 安装与运维 | [中文 README](../README.zh.md)、[English README](../README.md)、[运维](zh/operations.md) |
| 通用 Agent 与 Provider | [Agent 边界](zh/agent-builtin-application.md)、[Provider 运行](zh/provider-runtime.md)、[任务时限](zh/task-timeout.md) |
| 应用接入与材料 | [独立应用边界](zh/independent-applications.md)、[依赖方向](zh/module-dependency-direction.md)、[版本材料与 Git 边界](zh/module-git.md)、[安装就绪](zh/module-installation-readiness.md)、[恢复](zh/module-recovery.md) |
| 内核事实与唤醒 | [有限事实](zh/kernel-notification-facts.md)、[API 规范](zh/kernel-api-design.md) |
| 实施证据与后续工作 | [API 实施记录](zh/kernel-api-implementation.md)、[路线](zh/development-roadmap.md)、[可移植方案](zh/kernel-portability-plan.md)、[历史验证](zh/kernel-portability-verification.md) |
| 按需代理工具 | [context-mode / CodeGraph](agents/tooling.md)，仅在当前会话提供时读取 |

Web、聊天、通知、应用创作、记忆和桌面示例的实现文档随源码归各应用仓库；不在主仓维护应用页面合同或视觉系统。相关入口见[独立应用边界](zh/independent-applications.md)。

历史部署、应用组合、旧 Workbench、统一宿主方案和阶段验收通过 Git 历史查阅。历史测试计数只证明记录中的版本；2026-11-17 本轮清理受用户限制仅编辑文件和静态核对，没有构建、测试或部署结论。
