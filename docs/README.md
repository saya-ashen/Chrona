# Documentation

## Users and operators

- [English README](../README.md) / [中文 README](../README.zh.md): purpose, pages, setup, configuration and limits.
- [运维说明](zh/operations.md): data directories, backups, recovery, health and QQ diagnostics (Chinese).
- [Editor 退役记录](zh/editor-retirement.md): removed legacy application, current Coding protocol, scope and pending cleanup validation; existing 3112 deployment unchanged.
- [连续编码工作台](zh/coding-web-workbench.md): add local directories, edit directly, continue conversations, answer questions and stop; development status and current limits.

## Product and development

- [设计目标](zh/steward-goals.md): product authority; goals are not a shipped-feature checklist.
- [开发目标与统一路线](zh/development-roadmap.md): current backlog, priorities, dependencies and documentation status; prioritizes the usable coding Web workbench, records the five-builtin customization decision and tracks release gaps.
- [编码工作台实现评估](zh/coding-workbench-implementation-assessment.md): approved scope and retained pre-implementation analysis; [开发验证记录](zh/coding-workbench-validation.md) covers the integrated implementation, regression checks and browser evidence.
- [编码工作台参考项目调研](zh/workbench-reference-research.md): primary sources and interaction comparisons behind the approved lightweight conversation page.
- [Web 外壳与应用组合组件](zh/web-components-and-shell.md): uniform whole-Web theme/navigation, app-private declarative props/events/slots, ownership and validation evidence.
- [当前架构](zh/architecture.md): implementation map, trust model and module lifecycle.
- [调用上下文、Run 与产出](zh/call-context-run-artifact-roadmap.md): later architecture work after the usable workbench; freeze the minimum delegation contract when starting that architecture change.
- [Agent 原语与应用编排](zh/agent-module-orchestration.md) / [基础编码工作台](zh/coding-web-workbench.md): current application ownership, interfaces and product limits.
- [统一模块协议与本地／远端宿主](zh/unified-module-runtime-plan.md): completed local V1 implementation, routed Provider/workspace/content contracts and U0–U4 roadmap; [本机 V1 最终验收](zh/unified-module-v1-acceptance.md) records review fixes, real-model coding/cancellation/crash recovery and final verification; general remote hosts are deferred. [模块安装与就绪报告](zh/module-installation-readiness.md) records removal of fabricated business probes, module-owned diagnostics and the local preview follow-up. [Agent 内置应用](zh/agent-builtin-application.md) records the subsequent extraction into a real SDK process, short execution/control requests, callback identity and restart receipts.
- [模块 Git 工作流](zh/module-git.md): per-app source history, checked customization, explicit upstream updates and legacy limits; [发行种子与发布](zh/module-git-release.md) covers offline bundles and public-release gates.
- [普通应用的本地桌面窗口](zh/desktop-applications.md): host desktop session, application-owned windows, Author materials and lifecycle acceptance; [桌面会话启动](zh/desktop-session.md) explains direct and user-service startup.
- [内核可移植、可信本地运行与远程执行应用化实施方案](zh/kernel-portability-plan.md): S0–S3 implemented; Linux trusted-local execution and remote-device delivery validated locally. S4/S5 remain partial: macOS full descendant supervision is missing, Windows native validation and safe archival remain pending. [Verification and release evidence](zh/kernel-portability-verification.md) records actual results and remaining gates. [Archived original cross-platform plan](zh/history/cross-platform-runtime-and-remote-execution-plan.md).
- [安全机制简化](zh/security-simplification.md) / [模块依赖方向](zh/module-dependency-direction.md): current rules and registration patterns.
- [当前 Coding 客户端协议](zh/coding-peer-clients-protocol.md) / [实施与原部署记录](zh/coding-peer-clients-implementation.md): shared headless Coding service and peer clients. [旧服务器编码工作](zh/server-coding.md) retains historical server/device placement and recovery evidence; its Editor installation instructions are obsolete.
- [统一开发方案](zh/chrona-workbench-unified-development-plan.md) / [M3 开发验收](zh/chrona-workbench-m3-acceptance.md): completed M1–M3 development integration, exact evidence and unverified environments; not a public release or deployment.
- [Provider 运行](zh/provider-runtime.md) / [模块恢复](zh/module-recovery.md) / [Owner 单次受控构建](zh/owner-bounded-builds.md): focused runtime references.
- [任务总时限](zh/task-timeout.md): ordinary tasks default to unlimited; optional global Settings timeout, new-task scope and explicit execution budgets.
- [历史设计索引](zh/history/README.md): superseded staged specifications, not current instructions.
- [Contributing](../CONTRIBUTING.md) and [repository rules](../AGENTS.md): implementation and checks.
- [Domain agent notes](agents/domain.md) / [issue-tracker agent notes](agents/issue-tracker.md): contributor guidance, not operator instructions.

The README and operations guide describe the current rebuilt code. Historical examples in design or agent notes do not establish current commands or shipped capabilities.
