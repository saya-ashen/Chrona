# Documentation

## Users and operators

- [English README](../README.md) / [中文 README](../README.zh.md): purpose, pages, setup, configuration and limits.
- [运维说明](zh/operations.md): data directories, backups, recovery, health and QQ diagnostics (Chinese).

## Product and development

- [设计目标](zh/steward-goals.md): product authority; goals are not a shipped-feature checklist.
- [当前架构](zh/architecture.md): implementation map, trust model and module lifecycle.
- [统一模块协议与本地／远端宿主](zh/unified-module-runtime-plan.md): local V1 implementation, routed Provider/workspace/content contracts and U0–U4 roadmap; [本机 V1 最终验收](zh/unified-module-v1-acceptance.md) records review fixes, real-model coding/cancellation/crash recovery and final verification; general remote hosts are deferred.
- [模块 Git 工作流](zh/module-git.md): per-app source history, checked customization, explicit upstream updates and legacy limits; [发行种子与发布](zh/module-git-release.md) covers offline bundles and public-release gates.
- [安全机制简化](zh/security-simplification.md) / [模块依赖方向](zh/module-dependency-direction.md): current rules and registration patterns.
- [服务器编码工作](zh/server-coding.md): server/device placement, project authorization, results, recovery and explicit cleanup.
- [统一开发方案](zh/chrona-workbench-unified-development-plan.md) / [M3 开发验收](zh/chrona-workbench-m3-acceptance.md): completed M1–M3 development integration, exact evidence and unverified environments; not a public release or deployment.
- [Provider 运行](zh/provider-runtime.md) / [模块恢复](zh/module-recovery.md) / [Owner 单次受控构建](zh/owner-bounded-builds.md): focused runtime references.
- [历史设计索引](zh/history/README.md): superseded staged specifications, not current instructions.
- [Contributing](../CONTRIBUTING.md) and [repository rules](../AGENTS.md): implementation and checks.
- [Domain agent notes](agents/domain.md) / [issue-tracker agent notes](agents/issue-tracker.md): contributor guidance, not operator instructions.

The README and operations guide describe the current rebuilt code. Historical examples in design or agent notes do not establish current commands or shipped capabilities.
