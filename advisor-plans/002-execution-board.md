# 全部减重项实施分工

授权：用户于 2026-11-17 明确要求开始，使用并行子 agent，禁止运行构建、编译、测试、lint、verify 或代码生成流水线。基线 `b8b971c0`。

纠正：现有远程功能全部退役，不保留旧 remote-execution 协议、签名停止、交付、模型中继或其专用状态；未来重新设计。独立 remote-execution 应用仓及真实数据不删除。

| Lane | 独占工作区 | 职责和文件边界 | 下一步与交接 |
| --- | --- | --- | --- |
| remote | `.worktrees/kernel-reduction/remote` | 远程 delivery 实现/专用测试退役；共享 completion helper 移到通用 agent 位置 | 输出未提交 diff 和共享合同/DB 删除清单 |
| runtime | `.worktrees/kernel-reduction/runtime` | Run、tick、生命周期排空：删除 build 通道和旧 execution 特例，保留普通 Agent 可靠性 | 输出未提交 diff 和 index 合同建议 |
| publishing | `.worktrees/kernel-reduction/publishing` | kernel 单应用固定材料发布、检查减重、Git 演化退役，合并安装路径 | 输出未提交 diff 和 DB/index 需求 |
| author | `.worktrees/kernel-reduction/author` + 独立 Author 仓 | Author 单应用合同、开发检查、Git/工作区策略；不再另建执行器 | 输出应用未提交 diff；不得读取 kernel 私有 DB |
| local | `.worktrees/kernel-reduction/local` + 独立 Pi 仓 | 本地旧 execution/Server 项目管理退役，正常 Agent 固定 cwd，Pi 执行接入 | 输出未提交 diff 和通用合同需求 |
| integration | 主仓，前五 lane 完成后独占 | 静态审阅并整合 patch，统一 `contracts/index.ts`、DB/schema/初始 SQL、SDK、入口和文档 | 无构建/编译/测试，仅静态查漏 |
| reviewer | 主仓，只读 | 独立静态检查：漏接线、权限/停止退化、无消费者状态、幂等/配额死锁 | 不启动任何验证流水线 |

所有执行者：不提交、不推送、不部署、不安装依赖，不读取凭据或操作真实库；不动原有 `anti-slop/`。各 writer 用独立 worktree，不互相写入文件。共享 `packages/contracts/src/steward/index.ts`、DB schema 与初始 SQL 只由 integration 写入，其余 lane 提议变更。报告实际净增减行和未验证边界，不声称测试通过。

约定合同：单应用发布使用 `target`、`item`、`member`（替代 `targets/items/members`）；Agent 通过顶层可选 `cwd` 请求准备好的执行目录，由 kernel 固定绑定，Provider 不得覆写身份。Author 只准备工作区并使用正常 Agent 路径，不能自行安排另一队列。远程和本地旧 ExecutionAttempt 系列全部退役后，DB 删除相关模型；通用 Run/Agent/调用回执/迁移保护保留。

状态：五个 lane 的源码已整合；共享合同、DB 初始 SQL、宿主、SDK 和文档已同步。远程 lane 的 completion helper、runtime lane 的 drain helper 和测试源码已带入。独立 Author/Pi 仅修改源码，固定材料/vendor/bundle/pin 未刷新。独立静态审阅已完成，未发现由当前 diff 和源码可证明的阻断问题；该结论不代表运行验收。构建、编译、测试和生成器均未运行。

最终源码行数（不含计划和原有 anti-slop 材料）：主仓 tracked +1266/-11134，四个新增源码文件 +207，净 -9661；独立 Author +223/-895，净 -672；独立 Pi +52/-266，净 -214。三仓合计净 -10547。全部修改保持未提交、未暂存。Prisma Client 及应用固定材料尚未重新生成；初始 SQL 变更会触发现有数据库 checksum 拒绝，不包含旧库迁移。

独立审阅报告：`/home/saya/.pi/agent/sessions/--home-saya-workspace-Chrona--/subagent-artifacts/outputs/adada521-616b-4aa6-9754-87319306e207/chrona-review/report.md`。
