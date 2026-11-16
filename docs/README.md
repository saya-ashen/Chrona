# 文档入口

按任务阅读，不要求通读全部专题或历史。目标、当前代码、验收及部署分别记录；旧记录中的“当前”“已完成”和优先级不自动适用于本次开发。

## 核心文档

| 文档 | 解决的问题 |
| --- | --- |
| [产品目标](zh/steward-goals.md) | 为什么做、用户价值与真实使用验收；最高产品依据 |
| [内核 API 目标规范](zh/kernel-api-design.md) | 公开合同与待实现的七工具 Agent／Provider 注册制；未冻结 |
| [内核 API 实施记录](zh/kernel-api-implementation.md) | 当前实现、自动检查及未覆盖范围 |
| [持续关注与恢复](zh/continuous-steward-journey.md) | timer、来源、记忆纠正、恢复与用量的实施证据及未完成项 |
| [当前架构](zh/architecture.md) | 当前源码边界、所有权和代码地图 |
| [现有边界盘点](zh/kernel-permanent-boundary-contract.md) | 前一阶段工具与边界盘点；新版接口见 API 规范与实施记录 |
| [开发路线](zh/development-roadmap.md) | 待推进工作及证据入口，不重复阶段流水账 |
| [开发指引](../AGENTS.md) | 必守规则、最小实现和检查方式 |

## 使用与运维

- [中文 README](../README.zh.md) / [English README](../README.md)：安装与运行范围。
- [运维](zh/operations.md)：启动、数据目录、完整备份、恢复与诊断。
- [Coding 退役说明](zh/coding-retirement.md)：旧 Coding/coding-web 已移除，当前 Chat 独立运行。
- [本地桌面应用](zh/desktop-applications.md) / [桌面会话](zh/desktop-session.md)：窗口与宿主环境。

## 按任务阅读

| 任务 | 专题入口 |
| --- | --- |
| 运行与恢复 | [Agent](zh/agent-builtin-application.md)、[Provider](zh/provider-runtime.md)、[应用恢复](zh/module-recovery.md)、[任务时限](zh/task-timeout.md) |
| 应用开发与材料 | [依赖方向](zh/module-dependency-direction.md)、[版本材料](zh/author-version-materials.md)、[当前对话创作](zh/author-current-conversation.md)、[Git 发行](zh/module-git-release.md) |
| Web 与设置 | [外壳与组合](zh/web-components-and-shell.md)、[可执行页面](zh/web-executable-components.md)、[应用设置](zh/application-settings.md) |
| 通知与自动化 | [有限内核事实](zh/kernel-notification-facts.md)、[Mind](zh/mind-implementation.md)、[应用迁移](zh/application-migration.md) |
| 源码验收证据 | [内核/Agent 迁移](zh/kernel-agent-migration.md)、[普通应用迁移](zh/application-migration.md)、[边界实施](zh/kernel-permanent-boundary-implementation.md) |
| 退役与历史证据 | [Coding 退役](zh/coding-retirement.md)、[Editor 退役](zh/editor-retirement.md)；旧 Coding 协议、实施与工作台验证从 Git 历史查阅 |
| 可选代理工具 | [context-mode / CodeGraph](agents/tooling.md)：仅在当前会话提供对应工具时按需读取 |
| 历史背景 | 已归档的早期方案从 Git 历史查阅，不作为当前开发规则 |

安全简化的历史依据见[安全机制简化](zh/security-simplification.md)，跨平台范围及证据见[可移植方案](zh/kernel-portability-plan.md)和[验证记录](zh/kernel-portability-verification.md)；两者都按各自版本和验收范围阅读。贡献说明见[Contributing](../CONTRIBUTING.md)。

早期归档已从工作树删除，可用 `git log --all -- docs/zh/history/` 定位，再用 `git show <revision>:<path>` 查阅。清理前的架构及路线正文分别查其原文件历史。阶段验收与验证记录（M1–M3、kernel-minimization 各阶段、portability S0 等）同样从工作树删除，从 git 历史查阅。
