# 内核职责减重计划

基线：`b8b971c0`；调查日期：2026-11-17。

本目录使用 `advisor-plans/`，避免与现有 `plans/` 中的任务和数据留存材料混用。初始调查已由用户后续授权的实施取代；最新分工与禁止运行检查的边界见 [002-execution-board.md](002-execution-board.md)。上一轮已整合源码并完成独立静态审阅，未运行验证。随后完成的当前工作树逐文件审计见 [003-file-audit.md](003-file-audit.md)：区分保留、删除、移出及合并；其建议随后获用户授权，六 lane 与共享接缝已完成源码整合；独立静态审阅提出的一项 Darwin 原子发布 P1 已补源码，待同一 reviewer 定向复核。本次禁止运行检查，尚无运行验收。

原调查计划：[001-kernel-responsibility-reduction.md](001-kernel-responsibility-reduction.md)。它包含删除、应用迁移、路径归并、直接调用方、保留边界及验证命令。

| 切片 | 内容 | 工作量 | 风险 | 依赖 | 状态 |
| --- | --- | --- | --- | --- | --- |
| S1 | 删除无生产入队方的 build Agent 通道 | S | MED | 无 | 源码已整合并静态复核，未运行验证 |
| S2 | 单应用发布，合并直接版本与固定候选的激活判定 | L | HIGH | 无硬依赖，建议 S1 后 | 源码已整合并静态复核，未运行验证 |
| S3 | 开发检查/Git 演化迁入 Author，安装归并固定材料路径 | L | HIGH | S2 | 原切片已整合；剩余Git职责见003，未运行验证 |
| S4 | 项目/worktree 归 Author，本地 execution 合入普通 Agent Run | L | HIGH | S1；建议 S3 后 | 源码已整合并静态复核，未运行验证 |

实际按五个独立 lane 并行修改，再由 integration 独占共享合同、DB、宿主与文档。

## 已考虑但不直接采用

- 删除整个 `execution/`：普通 Agent 仍消费其中的 Run、认证、事件及启动逻辑；远程与旧本地专用实现已退役。
- 合并所有回执表：工具返回、材料提交、生命周期完成不是同一状态。
- 立即删除全部 Git 代码：当前恢复/GC仍依赖它，不能直接拆掉。003进一步建议材料存储独立后，将Git开发历史移交Author/发行端；这不是恢复内核开发流水线。
- 删除所有探测/类型资源：加载与 SDK 握手保留，SDK loader/迁移仍使用运行资源。
- 复制一套开发平台到新应用：复用 Author 和现有 Agent，不恢复 Coding/Editor。
- 把远程 model 中继改为嵌套 Agent Run：远程能力已全部退役，不迁移或保留其协议；未来另行设计。
- 用源代码行数推断内存改善：未做资源测量，不声称性能收益。

## 检查状态

- 已检查相关源码、生产导入与调用方、独立应用消费者及计划引用路径。
- 未运行编译、自动测试、性能测量或服务验收。
- 主仓及独立 Author/Pi 已有未提交源码改动；生成客户端和固定应用制品未刷新。原有 `anti-slop/` 保持不动。

003 后续整合的基线是 `.worktrees/audit-reduction/baseline-files`（502 个原始文件），不是 HEAD。精确路径、净行数及主仓/独立 Author/Pi 的本轮 diff 见 `.worktrees/audit-reduction/review-diffs/`。单实体 AgentContext、完整材料独立恢复/GC、单应用 activation 及恢复/日志缺陷已改源码；源合同和 JSON 的明确变更手工同步，未运行生成器。Prisma Client、独立应用固定材料、发行锁和制品尚未刷新；所有新测试均未执行。独立审阅后已在共享发布 helper 补 Darwin `renameatx_np(RENAME_EXCL)`，并补无制品提交/恢复、空或非空 winner 及不同 sourceParent 的测试源码；Apple 官方 headers/man 已核对，Darwin FFI 与文件系统行为尚未执行验证。仅该 P1 的修复增量见 `review-diffs/darwin-p1.diff`；全轮清单与统计同步更新，待定向复核。原始用户改动及 anti-slop 保留，没有暂存、提交、部署或操作真实数据。
