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

默认预装普通应用为 Pi、Web、Notify、Author、Mind、Chat；QQ 随发行提供，通过受控生命周期按需安装。当前发行只包含这七个应用的源码和 Git 种子；其他保留源码的应用不进入发行资源，旧目录条目缺少资源时报告不可用。初始化不覆盖已有选择、不自动补装删除应用。Remind 仍暂停并保留材料；Mind 默认开启后台照看、默认不推送（仅网页），Editor 已退役。具体适配和验收见[普通应用迁移](application-migration.md)，Mind 的本地部署及版本限制见[实施记录](mind-implementation.md)。

## 3. 调用、执行与恢复

- 路由绑定真实 caller 和活动版本，敏感处理器核对实际权限。owner 工具检查实际批准版本的 `authority: "owner"`；`uses` 只声明依赖。
- 入口应用拥有会话和交付。Agent 使用原应用获准的工具，不借 Provider 或 owner 身份提权。
- 同一应用的普通工具事件允许并发；生命周期、timer 和 call_result 等事件等待已接纳投递，后续工具等待该屏障。内核和 SDK 以内部事件 ID 绑定独立调用 scope；公开 `chrona.call` 参数不变。单条调用链仍拒绝递归与过深调用，跨事件只拒绝实际生命周期等待环。应用负责跨 `await` 后重读并合并自己的可变数据。
- 内核保留单 Run 队列；取消请求不证明停止，未知停止仍占容量。Agent 持久化结果并发送事件，丢通知核对原回执，重启不重新执行未知效果。
- 身份、运行准入、候选、安装、激活及恢复采用专用记录；审计用于观察，不作为备用授权来源。结构化工具结果绑定实际 Run、目标版本和合同，过滤或遗漏结果不能证明完整交付。
- 当前材料创作复用现有 Agent Run，经 Author 导入源码和产物，再按精确准入提交；Author 不启动模型或编译器。pending 回执不表示激活。
- 内核事务保存有限事实，唯一选定应用持久接收、ack 后负责通知；恢复投递前核对撤回。没有 Notify 不取消审批本体。

相关合同：[Agent](agent-builtin-application.md)、[结构化状态与恢复](kernel-agent-migration.md)、[版本材料](author-version-materials.md)、[有限事实](kernel-notification-facts.md)。

## 4. 存储

kernel 不保存业务消息或通用偏好，Workspace 默认设置为 `{}`。已移除旧 `Preference / Grant / Message / BuildTargets / BuildRequest` 和旧 StewardState 租约字段。`Timer` 只承载应用的持久唤醒。remote-execution 的八张表仍有队列、授权、交付和停止证据消费者，继续保留。

应用摘要按应用分别执行最近五条版本及执行查询；SQLite 执行 LIMIT，使用确定的 `createdAt/id` 排序。主库连接建立时同步开启外键；共享连接保留事务全程 gate 和同步 `changes()` 处理。暂未新增专用只读连接：先消除已证实的历史全量读取，另开连接需要明确快照一致性及事务内读取路由，当前没有第二个连接的收益测量。

Mind 的组件和三类执行日志共用 `mind.sqlite`，执行预算与恢复按各自表读取；entry-app 会话按会话一行保存到 SQLite，只更新发生变更的行；列表查询只取摘要，详情及附件按会话或身份筛选读取，后台轮询先列摘要再逐会话恢复。留存及旧数据拒绝边界见[运维](operations.md#当前存储与旧数据边界)。这些源码改动未部署或转换真实数据。

## 5. 代码地图

| 位置 | 职责 |
| --- | --- |
| `apps/server` | Bun/Hono HTTP、运行时 tick、Provider 桥、鉴权代理及救援入口 |
| `packages/contracts/src/steward` | zod、工具与 wire 合同 |
| `packages/domain/src/steward` | 无 I/O 的纯策略 |
| `packages/engine/src/modules/steward` | `agent/` 管通用 Agent 与 Provider 登记，`execution/` 管 Run 准入与交付，`modules/` 管应用材料、调用与生命周期；13 个应用由独立仓库维护，固定输入恢复到私有 `applications/` staging |
| `packages/integrations/src/steward`、`packages/pi` | 宿主 `runtime/`、依赖安装 `packages/`、SDK 与类型检查资源，以及 Pi Provider |
| `packages/db`、`packages/cli` | SQLite/Prisma、迁移与备份恢复、启动和诊断 |

依赖方向：`apps → engine → domain → contracts`。页面由普通 Web 应用承载，共用 React runtime 与 UI 组件；Web 拥有外壳，业务应用拥有内容及设置。应用直接登记编译后的 React / TSX 页面，可信页面无浏览器沙箱。详见[Web 合同](web-components-and-shell.md)、[应用设置](application-settings.md)、[依赖方向](module-dependency-direction.md)。

## 6. 运行与证据

数据为 SQLite 加 dataDir 下的 platform、sessions 和 secrets；停机完整备份，不能只复制数据库。开发及验收使用全新临时数据，初始迁移不兼容旧库。实际操作见[运维](operations.md)。

内核/Agent 和普通应用的当前阶段证据分别见[内核迁移](kernel-agent-migration.md)、[应用迁移](application-migration.md)。源码、离线测试、隔离验收、部署及真实使用分开判断；文档中的完成不自动覆盖后续代码或既有实例。

当前源码归属、生成副本与发行消费者见[工程清理盘点](../tasks/cleanup-and-reorg/application-boundaries.md)。阶段验证记录见[阶段 1 基线](../tasks/cleanup-and-reorg/stage-1-summary.md)；其中的隔离发行包未部署，不能替代现有实例取证。

旧系统接口、构建和健康自报机制的正文从本文件的 Git 历史查阅，不再作为当前开发规则。
