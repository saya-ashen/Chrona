# 历史设计记录

本目录保存 Chrona 按阶段形成的平台设计、讨论与当时的实现记录，不是当前功能或部署状态说明。文中的计划、验收结果和“当前”均属于记录形成时的上下文；与[当前架构](../architecture.md)冲突时，以当前架构为准。保留原文以便追溯，仅修正归档后的链接；当前执行、依赖和操作规则分别见[安全机制简化](../security-simplification.md)、[模块依赖方向](../module-dependency-direction.md)和[运维说明](../operations.md)。

旧 Editor 应用已退役并移除，当前仅 Mind、Remind 整应用暂停。删除范围和待补验证见[退役记录](../editor-retirement.md)，当前接入见[Coding 客户端协议](../coding-peer-clients-protocol.md)。本页链接到的旧 Editor 安装、接口和源码保留说法属于历史，不表示仍支持安装或要求保留该应用。

## 根目录保留的阶段记录

以下文件保留原路径以维持源码、契约和证据链接；属于阶段记录，不再是独立开发入口。全项目待办见[统一开发路线](../development-roadmap.md)。

| 系列 | 方案与契约 | 证据与后续 |
| --- | --- | --- |
| 最小架构与多入口初稿 | [最小模块方案](../minimal-module-architecture-plan.md)、[Workbench 讨论稿](../agent-workbench-execution-design.md) | 已合并到 M1–M3 方案，不独立派工 |
| M1–M3 | [统一方案](../chrona-workbench-unified-development-plan.md)、[P0](../chrona-workbench-p0-contract.md)、[P1](../chrona-workbench-p1-contract.md)、[P2](../chrona-workbench-p2-contract.md) | [M1](../chrona-workbench-m1-acceptance.md)、[共享接线](../chrona-workbench-m1-shared-integration.md)、[M2](../chrona-workbench-m2-acceptance.md)、[M3](../chrona-workbench-m3-acceptance.md)、[签收后 lint](../chrona-workbench-post-acceptance-lint.md) |
| Provider/职责收窄 | [实施计划](../provider-kernel-module-plan.md)、[职责审查](../kernel-responsibility-audit.md) | 当前接口另见[应用编排](../agent-module-orchestration.md) |
| 本机统一 V1 | [实施方案](../unified-module-runtime-plan.md) | [最终验收](../unified-module-v1-acceptance.md)；U3/U4 仍是未实现的远端专题 |
| 应用健康整合 | [历史提案及步骤记录](../health-consolidation.md) | 当前[安装与业务就绪](../module-installation-readiness.md)、[故障恢复](../module-recovery.md) |
| Git 发行打包 | [Docker/Nix 验证](../module-git-packaging-validation.md) | 保留当时十一份种子的检查结果；当前数量与来源见[发行说明](../module-git-release.md) |

安全与依赖方向文档同时包含当前原则和有日期的旧生产审查；旧迁移应用名单不进入当前开发队列，部署与数据转换按实际实例另行盘点。

## 文件索引

- [platform-v2.md](platform-v2.md)
- [platform-v2-1-runtime.md](platform-v2-1-runtime.md)
- [platform-v2-2-sessions-content.md](platform-v2-2-sessions-content.md)
- [platform-v2-3-remind-model.md](platform-v2-3-remind-model.md)
- [platform-v2-4-entries-rescue.md](platform-v2-4-entries-rescue.md)
- [platform-v2-5-extensions.md](platform-v2-5-extensions.md)
- [platform-v2-6-packages.md](platform-v2-6-packages.md)
- [platform-v2-7-system-modules.md](platform-v2-7-system-modules.md)
- [platform-v2-8-calls-only.md](platform-v2-8-calls-only.md)
- [platform-v2-9-owner-api.md](platform-v2-9-owner-api.md)
- [platform-v2-10-ai-calls.md](platform-v2-10-ai-calls.md)
- [platform-v2-11-provider-module.md](platform-v2-11-provider-module.md)
- [platform-v2-12-provider-browser.md](platform-v2-12-provider-browser.md)
- [platform-v2-13-modules-tools.md](platform-v2-13-modules-tools.md)
- [platform-v2-14-contributions-events.md](platform-v2-14-contributions-events.md)
- [platform-v2-15-multi-module-builds.md](platform-v2-15-multi-module-builds.md)
- [platform-v2-16-module-secrets-requests.md](platform-v2-16-module-secrets-requests.md)
- [platform-v2-17-approval-levels-model-tiers.md](platform-v2-17-approval-levels-model-tiers.md)
- [platform-v2-18-activity.md](platform-v2-18-activity.md)
- [platform-v2-19-reflection.md](platform-v2-19-reflection.md)
- [platform-v2-20-system-apps.md](platform-v2-20-system-apps.md)
- [platform-v2-21-memory.md](platform-v2-21-memory.md)
- [platform-v2-23-app-pages.md](platform-v2-23-app-pages.md)
- [platform-v2-24-timers.md](platform-v2-24-timers.md)
- [platform-v2-25-contracts.md](platform-v2-25-contracts.md)
- [platform-v2-26-mind.md](platform-v2-26-mind.md)
- [platform-v2-27-trusted-local-evolution.md](platform-v2-27-trusted-local-evolution.md)
- [platform-v2-28-mind-agenda.md](platform-v2-28-mind-agenda.md)
- [platform-v2-29-content-refs.md](platform-v2-29-content-refs.md)
- [platform-v2-30-secrets-for-tools.md](platform-v2-30-secrets-for-tools.md)
- [cross-platform-runtime-and-remote-execution-plan.md](cross-platform-runtime-and-remote-execution-plan.md)（已合并入[内核可移植方案](../kernel-portability-plan.md)）
