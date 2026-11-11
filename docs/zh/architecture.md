# Chrona 当前架构

本文概述当前源码边界。公开 API 按[目标规范](kernel-api-design.md)调整为七命名空间、显式 authority 与统一回执；验证状态见[API 实施记录](kernel-api-implementation.md)，尚未冻结。旧[边界盘点](kernel-permanent-boundary-contract.md)描述上一阶段。

## 1. 用途与信任模型

Chrona 是单一 owner 的个人工具：用户自然交流，Agent 选择方法，普通应用提供持续能力。产品判断以[设计目标](steward-goals.md)为准。

当前使用 trusted-local。应用和 Provider 使用服务用户的 OS 权限；Manifest、路由、审批和凭据交付约束正常调用、防误操作，不隔离同一 OS 用户下的恶意代码。退役的 required-isolation/bwrap 配置明确拒绝。主机程序和浏览器须预先安装，不从接口声明推断 OS 权限限制。

## 2. 内核与应用

| 所有者 | 职责 |
| --- | --- |
| kernel | 真实身份、路由、精确授权、生命周期、审批、凭据、硬预算、唯一 Run 队列、租约、取消、实际停止证据和持久回执 |
| Provider 应用 | 登记自己的执行端点，持有后端适配器、进程、配置、原生协议与操作回执；Pi 是默认预装普通应用 |
| 普通应用 | 业务策略、会话、提示词、记忆、内容、配置、页面、通知和交付；预装不授予权力 |
| 私有宿主 | `runtime-callback`、`workspace-local` 是内部执行边界，不是第三类应用或公开发现目标 |

当前公开目标为 `modules / approvals / settings / secrets / activity / timers / agent`。通用 Agent 七工具归 kernel，具体执行委托给绑定的已登记 Provider；不存在公开 schedules、projects、history、chat、provider、executions、content 或 memory。完整工具清单在[API 规范](kernel-api-design.md)维护；源码和生成合同确定实际可调用面。

Web、Notify、QQ、Author、Pi 是普通默认预装应用；可选应用通过受控生命周期安装。初始化不覆盖已有选择、不自动补装删除应用。Remind 仍暂停并保留材料；Mind 是普通可选应用，Editor 已退役。具体适配和验收见[普通应用迁移](application-migration.md)，Mind 的本地部署及版本限制见[实施记录](mind-implementation.md)。

## 3. 调用、执行与恢复

- 路由绑定真实 caller 和活动版本，敏感处理器核对实际权限。owner 工具检查实际批准版本的 `authority: "owner"`；`uses` 只声明依赖。
- 入口应用拥有会话和交付。Agent 使用原应用获准的工具，不借 Provider 或 owner 身份提权。
- 内核保留单 Run 队列；取消请求不证明停止，未知停止仍占容量。Agent 持久化结果并发送事件，丢通知核对原回执，重启不重新执行未知效果。
- 身份、运行准入、候选、安装、激活及恢复采用专用记录；审计用于观察，不作为备用授权来源。结构化工具结果绑定实际 Run、目标版本和合同，过滤或遗漏结果不能证明完整交付。
- 当前材料创作复用现有 Agent Run，经 Author 导入源码和产物，再按精确准入提交；Author 不启动模型或编译器。pending 回执不表示激活。
- 内核事务保存有限事实，唯一选定应用持久接收、ack 后负责通知；恢复投递前核对撤回。没有 Notify 不取消审批本体。

相关合同：[Agent](agent-builtin-application.md)、[结构化状态与恢复](kernel-agent-migration.md)、[版本材料](author-version-materials.md)、[有限事实](kernel-notification-facts.md)。

## 4. 代码地图

| 位置 | 职责 |
| --- | --- |
| `apps/server` | Bun/Hono HTTP、运行时 tick、Provider 桥、鉴权代理及救援入口 |
| `packages/contracts/src/steward` | zod、工具与 wire 合同 |
| `packages/domain/src/steward` | 无 I/O 的纯策略 |
| `packages/engine/src/modules/steward` | kernel Agent API、Provider 登记与 external 应用 |
| `packages/integrations/src/steward`、`packages/pi` | 宿主、SDK、进程监管与 Pi Provider |
| `packages/db`、`packages/cli` | SQLite/Prisma、迁移与备份恢复、启动和诊断 |

依赖方向：`apps → engine → domain → contracts`。页面由普通 Web 应用承载，共用 React/json-render；Web 拥有外壳，业务应用拥有内容及设置。可信可执行组件无浏览器沙箱。详见[Web 合同](web-components-and-shell.md)、[应用设置](application-settings.md)、[依赖方向](module-dependency-direction.md)。

## 5. 运行与证据

数据为 SQLite 加 dataDir 下的 platform、sessions 和 secrets；停机完整备份，不能只复制数据库。开发及验收使用全新临时数据，初始迁移不兼容旧库。实际操作见[运维](operations.md)。

内核/Agent 和普通应用的当前阶段证据分别见[内核迁移](kernel-agent-migration.md)、[应用迁移](application-migration.md)。源码、离线测试、隔离验收、部署及真实使用分开判断；文档中的完成不自动覆盖后续代码或既有实例。

旧系统接口、构建和健康自报机制的正文从本文件的 Git 历史查阅，不再作为当前开发规则。
