# Chrona 当前架构

Chrona 源码仓只维护通用内核及其运行所需的宿主、CLI、数据库和 SDK。具体应用的业务、会话、记忆、页面、通知、Provider 适配器、配置、构建和测试在独立仓库维护。主仓没有默认应用名单、应用共享业务包、固定应用输入或生成副本。

2026-11-17 本轮按此边界清理源码，未运行构建、编译或测试，未部署；下述代码归属不能作为当前版本可运行的证明。公开合同仍未冻结，见[API 目标规范](kernel-api-design.md)。

## 内核与宿主

| 所有者 | 职责 |
| --- | --- |
| kernel | 真实 caller、路由、精确授权、审批、凭据、硬预算、唯一 Run 队列、租约、取消、实际停止证据、持久回执、应用生命周期及持久唤醒 |
| host | 通用进程与后代监督、SDK 传输、解释器与依赖准备、资源定位；不持有具体应用或 Provider 配置 |
| CLI | 存储锁、迁移、默认工作区、运行组装、退出、停服管理、备份恢复和诊断 |
| HTTP | 健康、内核工具桥接、凭据 OAuth 回调及应用 listener 转发；应用客户端鉴权和会话由 listener 拥有者负责 |
| 独立应用 | 业务策略、会话、提示词、记忆、内容、页面、配置、通知和交付；具体 Provider 自行登记端点、管理适配器及模型配置 |

本轮删除远程交付、签名停止、模型中继及专用 Execution 表，也删除旧本地项目执行、build Run 通道、成组发布、网络 Git 开发流程和安装中的应用 tests/typecheck/调用方影响检查。Author 与 CLI 的单应用固定材料均经过同一安装检查和激活路径；真实数据迁移保留审批、备份与恢复。普通 `agent.run` 可指定已准备好的绝对 `cwd`，内核固定 context/Run 的目录，session 日志独立存放，Provider options 不授予身份或改写目录。

内核允许没有应用或 Provider 时启动。不自动安装或恢复应用，不按应用名暂停或授权，也不拼接某个官方应用仓库地址。显式本地发行输入可通过 `CHRONA_MODULE_RESOURCES` 配置，安装绑定 schema 1 完整材料的 SHA256、审批和受控生命周期。源码、锁、构建输入、材料记录、制品字节与 executable mode 存入不可变材料；恢复与 runtime store 的 GC 不依赖 Git。Git 历史、分支和可选 bundle 由 Author 或发行方管理。

公开目标为 `modules / approvals / settings / secrets / activity / timers / agent`。通用 Agent 七工具归 kernel，执行委托给已登记并绑定身份的 Provider。内部 `runtime-callback`、`workspace-local` 是执行边界，不是业务应用或公开命名空间。

## 权限、执行和恢复

当前使用 trusted-local。应用和 Provider 使用服务用户的 OS 权限；Manifest、路由、审批和凭据交付约束正常调用，不隔离同一 OS 用户下的恶意代码。退役的隔离配置明确拒绝，不静默降级。

调用绑定真实 caller 和当前批准版本。owner 工具核对显式 `authority: "owner"`；`uses` 只声明依赖。应用业务来源标签不进入内核枚举；内核只区分 owner、module 和自身执行来源。

内核保留唯一 Run 队列。取消请求不证明停止，未知停止继续占容量；未知外部效果不自动重放。权限、预算、回执、并发结算和后代停止证据不因应用迁出而删除。Linux 宿主为每个应用 generation 提供通用 guardian 停止回执，具体 Provider 可读取自己的恢复材料。

内核事务仅保存后续机制实际读取的有限事实。唯一选定接收应用负责持久接收、ack 与业务通知；没有接收应用不取消审批本体。详见[有限事实](kernel-notification-facts.md)。

HTTP 转发保持应用的 Authorization、Cookie 和 Set-Cookie，替换内部传输 token；接收应用验证其客户端身份和来源。内核不代替应用建立浏览器密码、会话或 MCP 凭据策略。Provider 的 Run 工具使用 SDK 委托，内核绑定接收者、授权者和目标版本。

## 存储和代码地图

| 位置 | 职责 |
| --- | --- |
| `apps/cli`、`apps/server` | 通用运行入口与 HTTP 传输 |
| `packages/contracts`、`packages/domain` | 合同 schema 与无 I/O 策略 |
| `packages/kernel` | Agent、Run、模块材料及生命周期、调用、凭据、timer、有限事实 |
| `packages/kernel/src/__testing__` | 隔离数据库和合成 Provider／SDK fixture，不消费具体应用制品 |
| `packages/host`、`packages/process` | 宿主对接与进程监督 |
| `packages/app-sdk` | 应用调用、wire、测试及类型检查合同，不依赖 kernel 实现 |
| `packages/db` | SQLite/Prisma、事务、迁移与完整备份恢复 |
| `packages/db/prisma` | 唯一数据库 schema、初始 SQL 和迁移锁 |
| `packages/runtime-config` | 配置加载、用户数据目录和数据库默认地址 |
| `packages/logging` | 通用文本／对象／错误脱敏；Pino logger 位于 Server |
| `scripts/build` | 通用内核二进制及 DB／SDK／runtime 资源发行 |

依赖方向为入口装配 `host → kernel → domain → contracts`；kernel 与 host 共用 SDK 传输合同。共享复用不构成把应用业务搬入内核的理由。

默认数据库位于平台用户数据目录的 `chrona.db`，支持显式 `CHRONA_DATA_DIR`／`DATABASE_URL`。根 `prisma/` 已按用户授权删除，不再是数据默认位置；`packages/db/prisma` 是源码，不能与本地运行数据混同。本轮没有生成 Prisma Client，也没有迁移其他实例的数据。完整数据及恢复边界见[运维](operations.md)。

源码修改、静态核对、测试、隔离验收、部署和真实使用分别报告。旧文档中的应用组合和测试计数仅描述历史版本，不证明当前内核已通过验证。

003 后续源码整合将执行身份收为一个 `AgentContext`，保存真实 owner/module/hash、cwd、Provider revision/session 与状态；内部 `Run.sessionId/session` 指向它，不再保存业务 Session。应用删除仅置空历史 context 的 moduleId，queued/running/unknown Run 仍阻止生命周期切换。全应用 Generation 快照及 Activation/ExecutionResult 的完整 Audit 镜像已移除，单应用 activation 与精确提交、动作回执分别保留。本次只有静态源码检查，Prisma Client、应用固定制品及运行验收尚未刷新。
