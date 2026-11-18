# 当前工作树逐文件减重审计

审计阶段记录：静态审计完成；四个分区报告已到齐，父级复核主要建议的源码与调用方，并核对逐文件表覆盖。该阶段只修改审计材料，不修改实现。

后续经用户授权完成并行实施、提交和验证。主仓运行版本 `bf63e751`：全量 `verify:slice` 通过，Bun 1564 pass / 23 平台限定 skip，API 75 pass；Author 39 pass，Pi 默认测试入口 313 pass。独立静态复核的 Darwin P1 已关闭，单次条件包装建议已落实。2026-11-18 已在 chino 以独立新数据目录部署空内核，保留旧状态；实际范围与恢复路径见 `docs/zh/operations.md`。以下无测试记录属于先前实施阶段，不代表最终验证结果。

## 后续获授权实施补记（2026-11-17）

用户在审计之后批准实施 P1–P12 及已列缺陷。六个隔离 lane 已按 `baseline-files` 的真实字节差异整合；整合者补齐共享 schema/唯一初始 SQL、合同、宿主、审批及跨模块调用。原审计、旧行号与历史验收记录保留，不将它们改写为本轮验收。

| 切片 | 实际源码结果 | 本轮证据边界 |
| --- | --- | --- |
| P1/P2/P7/P8 | 删旧业务 domain、Session/schedule/reply 视图、continuation/文件投递、callsContracts 和死 guard | 静态引用检查；不恢复旧 API |
| P3/P4 | schema 1 完整 SHA256 材料独立保存源码、锁、构建输入、材料记录、制品和模式；恢复/GC 不依赖 Git；Author 保留当前 Agent 的导入/导出/提交流程 | 独立 Author 已改；无生成、构建或实际恢复验收 |
| P5/P6/P11 | 删除全应用 Generation、builtin 分类及两类完整 Audit 镜像；保留单应用 activation、真实结果、精确批准与迁移归属；应用移除备份完整材料 | 历史 AgentContext 的 moduleId 置空；queued/running/unknown 及真实停止守卫保留 |
| P9/P10 | 移除生产 Provider facade，登记 Run 固定启动；AgentContext 保存真实 owner/module/hash、cwd、Provider revision/session；Run.sessionId 关联该实体 | 独立 Pi 两个测试源码已同步；未调用模型 |
| P12/DX | 合并两套 runner，保留隔离/退出码/无副作用 list，去 CI 重复；typecheck 非零不再被范围过滤吞掉 | 新测试源码未运行；旧 safety 负例移入 DB 测试 |
| 可靠性缺陷 | 复用 restore marker 覆盖 DB/platform/sessions/secrets，中断后同组恢复；补 secrets/回滚日志、Error 循环脱敏、SDK 原 key 回执替身 | 故障注入与日志测试只有源码；掉电/硬件损坏不在已证明范围 |

精确逐文件行数、静态删除反证及仅本轮的 diff 见 `.worktrees/audit-reduction/review-diffs/`。主仓原本已脏，本轮不以 `git diff HEAD` 作为 patch。独立 Author/Pi 分别比较各 lane 保存的外仓基线，未复制 vendor 或固定制品。源合同及公开 JSON 只作明确最小的手工同步，没有运行生成器；新 Prisma Client、固定应用材料/锁/制品仍需后续获准刷新。审计历史中的旧 Git 文档已标注退役，现行边界见架构及材料专题。

本轮未运行构建、编译、测试、lint、verify、Prisma、生成器、服务、部署或真实数据操作；没有暂存或提交。整合提交时独立 reviewer 尚未开展，后续结果见下节；“源码已整合”不等于静态审阅通过、测试通过、隔离验收或已部署。无性能和 token 对照测量，不宣称收益。

### 独立审阅后：Darwin 原子发布 P1

独立静态审阅已完成，指出材料 CAS 与 checkout 共用的 `publishModuleDirectory` 仅支持 Linux，令 Darwin 的无制品材料也无法提交。已在同一 helper 增加 Darwin `renameatx_np` / `RENAME_EXCL` 原生分支，保留现有 winner 校验，不使用可覆盖目标的普通 rename。Apple 官方 XNU 的 [stdio.h](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/sys/stdio.h)、errno.h 及 rename(2) 已核对：`RENAME_EXCL = 0x4`，`EEXIST = 17`，errno 从 `__error()` 读取。

复用材料提交用例增加 `artifacts: []` / `commands: []` 与缺 checkout 恢复；恢复测试补不同 sourceParent 下目标不存在、空 winner、非空 winner 的行为断言。只写测试源码，未运行；不支持原生排他重命名的文件系统仍报错，不降级覆盖。精确修复增量见 `review-diffs/darwin-p1.diff`，全轮 diff/清单/统计已同步。本 P1 已由同一 reviewer 定向静态复核通过；Darwin FFI、文件系统行为及其余编译/运行检查均未执行，不宣称 macOS 已验收。

## 范围与判断依据

- 基线 HEAD：`b8b971c0`，审计对象是上一轮减重后的未提交工作树，不是 HEAD 旧版本。
- `apps/`、`packages/`、`scripts/` 中现存 tracked/new 文件共 427 个，其中名称含 `.test.` 的文件 159 个。已删除文件不计入；node_modules、生成 Prisma Client、dist、临时 worktree、日志、原有 anti-slop 材料不计入。另查根配置及 CI。
- 个人、本地、单 owner、可信应用；以 `docs/zh/steward-goals.md` 和本次用户确认的目标为准。未来 Rust 替换不构成删除公开 wire 合同的理由。
- 保留：真实调用身份、精确授权、唯一 Run 队列、硬预算、取消与实际停止的区分、未知效果不自动重放、持久唤醒、完整备份及安全版本切换。
- 删除：没有目标需求且没有现行消费者的功能、只为兼容已退役实现的分支。
- 移出应用：开发历史、业务文档和页面规则等；没有实际接收应用时直接删除死代码，不为“移动”另造应用。
- 合并：同一份事实或同一行为被重复维护；不把提交回执和动作完成误合成一个状态。
- 本轮没有运行构建、编译、测试、lint、生成器或验证流水线。全文阅读也不是运行验收。

## 总结

当前主体已经是通用内核。下一轮优先处理无消费者的旧接口、重复持久化和旧执行接线，不宜再把宿主、进程管理、回执、审批与恢复整包移出。

| 类别 | 建议 | 保留边界 |
| --- | --- | --- |
| 删除 | domain 旧面板/短码；旧 Agent/schedule/reply 合同；无调用的 callsContracts、device write guard、continuation 遍历；旧 fixture；空 builtin；明确的旧格式兼容 | 不删有界输入读取、事务、真实身份、通用 Provider 合同 |
| 移到应用 | Git 开发历史/分支/候选 ref/bundle 组织归 Author 或发行端；Provider 专属解码归 Provider | 内核独立复算并保存完整不可变材料，不仅信任提交方的测试或摘要 |
| 合并 | Session/AgentContext；Provider 旧 facade 与登记启动路径；两套测试执行实现 | 不合并不同效果与回执，不恢复业务 sessions API，不破坏测试数据隔离 |
| 减少持久化 | 全应用 Generation 快照；两类无读取方的完整 Audit 镜像 | 保留单应用 activation、真实结果、故障计数、有限通知事实及必要保留策略 |
| 必须保留 | 唯一 Run、预算/租约/取消、unknown 占用、实际进程停止、持久唤醒、精确回执、权限/凭据、依赖检查、数据恢复 | trusted-local 不是可以丢失身份与数据保护；未来 Rust 替换不需要再造兼容平台 |

## 父级已核实的问题

### P1：旧业务代码留在 domain，只有自己的测试在消费

`packages/domain/src/steward/markdown.ts:5-91` 实现任务勾选、chrona-panel 解析和 CSV 写入；`tool-spec.ts:4-85` 实现面板与表单规则；`refs.ts:5-15` 实现四字符回复码。当前主仓生产代码不导入这些功能；跨独立应用的 TypeScript 消费者检索也没有找到这些 API 的现行生产调用方。`execution-instructions.ts:2` 同样没有消费者。

结论：删除无消费者的业务实现及对应专用测试，清理 `domain/src/index.ts` 导出；若独立应用以后真需要，放该应用里。保留 `local-day.ts` 及 Provider 的通用授权/交互/脱敏逻辑。不要把整个 domain 包删除。

### P2：公开合同还保留已移除功能的模型与兼容字段

`contracts/src/steward/index.ts` 中 `reflect`、`chrona_qqbot`、`messageSchema`、`attachmentSchema`、无调用的 session/run 旧视图、`REF_ALPHABET`；`moduleEventSchema` 的私有旧 `schedule` 和 `moduleEventReplySchema.result.handled`。这些不是普通 Run/Timer 所必需的业务模型；SDK 甚至显式从公开 Trigger 中排除了 schedule。

`contracts/src/steward/agent.ts:11-24,30-56` 的 `agentTools/agentInput/contextRunOutput/moduleAgentInputs/moduleAgentOutputs/moduleAgentInput/camelArguments` 没有主仓生产消费者，旧 health/complete/completion 与现行七工具重复。保留 `THINKING_LEVELS`、`hardLimitsSchema`、`runToolResultSchema` 的实际消费者所需部分。

`chronaToolInputSchemas.chrona_reply` 已不由运行入口提供，`scripts/generate-contract-schemas.ts:20` 却仍把它加入 system-tools.json。应一起删除源声明、生成器注入和对应生成项，不恢复工具来迁就旧测试。

结论：收敛现行合同；相关 JSON Schema 和测试要同步。`contentRefSchema`、provider/runtime wire、模块输入输出校验仍有真实消费者，必须保留。

### P3：安全版本材料仍与 Git 开发历史强耦合

`modules/module-git.ts:120-139` 为所有提交维护 bare repo、本地分支和候选 ref；`module-candidates.ts` 将材料冻结后再提交 Git；`module-proposal.ts:85-103` 比对源码与 commit、导入 bundle，并用本地 head 决定版本推进；`module-release.ts:78-107` 要求额外 module-git/lock.json 和 bundle。

结论：将源码历史、branch、commit 关系和 bundle 分发移交 Author/发行方；内核只保留确定材料、源码/锁/构建输入/制品字节和 executable mode 的不可变摘要、单应用活动版本基线及回滚材料。不是删除材料验证，也不是删除可恢复的版本存储。此项改动跨材料/发行合同，风险高，不能直接删 Git 文件而留下空恢复路径。

### P4：无旧库兼容需求，仍有运行时旧版本导入

`module-source.ts:17-40` 为旧 SHA256 版本读取 legacyDir、导入 Git 并回写 report；`module-git.ts:164-176` 有 `importLegacyModuleSource`；`module-release.ts:31-46,59-63` 接受旧材料布局和旧 hash。当前开发规则明确只用新库，不做旧库兼容。

结论：在明确当前材料格式后删除这组兼容分支。注意 SHA256 材料摘要本身不是“旧功能”；删除的是为旧数据库/布局补 Git provenance 的运行逻辑，不是所有 64 位摘要。

### P5：单应用更新仍持久化全应用版本快照，没有对应恢复消费者

`module-generation.ts:28-33` 每次激活/回滚都查询全部应用并写 `Generation.modules`；全仓生产搜索中 `generation.findFirst` 仅用于生成下一个 seq，`generation.create` 用于继续保存快照；其余只是传递 generationId。没有按此快照恢复整个应用集合的生产路径。

结论：删除全应用 Generation 快照及序号/引用，保留单应用 activationId、previousHash、候选 hash、切换和停止/迁移结果。自动回滚和按 activationId 隔离故障计数有实际消费者，不可一并删除。

### P6：空内置应用名单仍维持内置应用发行与权限分支

`BUILTIN_MODULE_NAMES=[]`，但 `module-release.ts:72-74` 保留 builtin release resolver，`module-identity.ts` 和 DB 仍维护 builtin/external 双轨。当前发行无内置应用，公共服务是固定 kernel 命名空间，不是可安装 builtin 应用。

结论：删除不可达的 builtin 应用发行分支和配置，统一普通应用身份。保留 kernel/private capability 保留名与真实 moduleId；不能把无默认应用错误解释为无需权限检查。

### P7：旧 execution 的可选 guard 与自动 continuation 遍历仍在普通通道

`agent/provider-journal.ts:11-21` 的 `ProviderWriteGuard` 保留可选 device fence；`provider-channel.ts:27` 的第四参数及相应分支没有实际传入方。生产 tick 只传 ports/run，第三个观察回调仍有测试消费者。删除第四参数和专属 fence 分支，保留现行事务及事件/交互写入。

`agent/provider-cancel.ts:5-24` 还解析 `run_continuation` Audit、递归寻找子尝试，并维护 seen/32节点上限。当前生产没有该记录的写入方，自动重试链已经删除。移除遍历，不删除 `cancelRequestedAt`、queued 的 never_started 原子结算、实际 abort 和 unknown 保持占用。

### P8：移除安装期类型检查后留下无消费者的合同汇总

`modules/module-contracts.ts:10` 的 `callsContracts` 只被 `module-reference.bun.test.ts` 消费；其 `module-contract-types.ts` 只被这个文件引用。可删除汇总及伴生断言。不要删除 `module-reference.ts`、`module-tool-contract.ts` 的实时发现、路由和校验。

### P9：Provider 生产 facade 与实际启动路径重复

`agent/agent-client.ts:7-30` 将登记 Provider 包成旧 ProviderAdapter；`apps/server/src/steward-runtime.ts:25-34` 又包装 start 并维护 handles。但实际 tick 在 `runtime/tick.ts:101` 直接调用 `startLocalProvider`，不经过这层 start。facade 仍有 health 消费者，不能孤立删除。

建议直接查询登记 Provider 健康状态，生产启动只留固定 Run 绑定路径，移除无效 handles 跟踪及旧注入门面；测试 adapter 留在测试 fixture。同步删除无实际读取方的 `chatTimeoutMs` / `gitHealth`。保留真实 `stopAgentRuns`、handle.abort/done、supervisor 和 settled 等待。

### P10：无消费者的文件投递路径与双上下文实体

`workspace-files.ts:39-82` 通过 Session origin/entryModuleId 寻找收件应用，注册 kernel-only `workspace-local.capture-file`；当前实际调用只在自己的测试中。它不是普通 Agent 必须使用的成果保存方式，应删除投递及旧来源链；实际文件/聊天应用按私有数据与工具合同管理成果。`readBoundedFile` 和现有受身份绑定的输入读取仍保留。

`agent-context-admission.ts:45-56` 同时创建 Session 和 AgentContext；`agent-context-state.ts:29-33` 每次读取再拼接两表身份。移除旧投递字段后可收为一个执行上下文实体，保留 contextId、owner/module/hash、cwd、Provider revision/session、状态、预算、Run 和活动引用。此项属于跨 schema 收敛，不是只把两个文件拼接，也不能把应用聊天会话放回内核。

### P11：重复保存完整结果，而非保存不同事实

`module-evolution.ts:23-25` 在 Activation 后写完整 `module_evolution_outcome` Audit；`module-failure-policy.ts:29-33` 在 ExecutionResult 后写完整 `module_execution_result` Audit。生产读取故障策略和结果使用事实表，Audit 镜像只有写入及保留名单，并被 activity 排除。删镜像及无效保留项，不删 Activation/ExecutionResult 或真实诊断。

`module-generation.ts:70,76` 根据 `uses.includes("schedules.create")` 阻止自动回滚，是已退役能力的字符串守卫；声明也不能证明实际外部效果。应删除这项旧判断，保留真实数据迁移、审批及启动效果约束。

### P12：开发工具存在重复，但不是整个平台都多余

- `scripts/run-api-tests.ts` 与 `scripts/run-bun-tests.ts` 重复临时 DB 初始化、环境、并发和失败收集。复用现有执行逻辑，API 保留薄入口与发现规则，删除固定为空的 serialFiles 分支；保留每文件 DB/data 隔离、清理、退出码、native helper 和无副作用的 --list。
- `apps/server/src/test-tick-pump.ts` 只有自身测试消费者；旧 `__tests__/fixtures/fake-pi-agent.ts` 没有运行消费者，可删除。`test-database-safety.ts` 的重导出和重复测试可并入 DB 测试，保留额外负例。
- 根 `postinstall` 已生成 Prisma，`.github/workflows/ci.yml:35` 在普通 install 后又生成；ci:local 已发现的三个脚本测试随后再执行一次。相同 job、相同输入可去重。Docker 的 --ignore-scripts 后生成、独立 builder、native/打包后 smoke 不属于可直接删的重复。
- 质量工具 ratchet、guardrails、发行字节/模式校验本身保留。它们不是内核开发发布业务状态机。

## 父级逐文件清单（58 个）

“全文”指本轮实际读取全文；“索引”指生成文件只检查结构/关联条目，没有逐行审计机器生成文本。

| 文件 | 结论 | 阅读 | 依据 |
| --- | --- | --- | --- |
| packages/contracts/docs/module-wire.md | 保留并修订 | 全文 | wire 规范有价值；HTTP Header 转发说明与当前架构不一致，不能作为实现证据 |
| packages/contracts/package.json | 保留 | 全文 | 对外合同入口与 zod 依赖 |
| packages/contracts/schemas/module-manifest.json | 保留 | 索引 | 生成的 Manifest 合同，不手工逐条维护新规则 |
| packages/contracts/schemas/module-wire.json | 保留并减字段 | 索引 | 同步移除退役 schedule/handled，保留通用传输 |
| packages/contracts/schemas/system-tools.json | 保留并减字段 | 索引 | 删除 chrona_reply 等旧声明；不能删现行公开合同 |
| packages/contracts/src/index.ts | 保留 | 全文 | 包入口导出 |
| packages/contracts/src/steward/agent-provider.ts | 保留 | 全文 | Provider 登记、固定 Run、七工具及有界事件 |
| packages/contracts/src/steward/agent.ts | 合并并删旧合同 | 全文 | 未消费的旧 Agent API 应删；保留实际消费的预算/结果结构 |
| packages/contracts/src/steward/index.ts | 部分删除/移出应用 | 全文 | Manifest/wire 必留；聊天投递、reflect、旧视图与旧工具不属内核 |
| packages/contracts/src/steward/kernel-api.ts | 保留 | 全文 | 路由、错误、分页、窄 timer 与生命周期回执 |
| packages/contracts/src/steward/local-runtime.bun.test.ts | 保留 | 全文 | 显式 deadline/null wire 边界 |
| packages/contracts/src/steward/local-runtime.ts | 保留，可删不消费字段 | 全文 | Provider 的启动、结果和回调 wire，非已删除的远程执行 |
| packages/contracts/src/steward/module-candidates.ts | 保留并简化表示 | 全文 | 单应用精确提交/回执；不恢复成组协议 |
| packages/contracts/src/steward/module-entry.bun.test.ts | 保留 | 全文 | 真实入口路径及 argv 边界 |
| packages/contracts/src/steward/module-entry.ts | 保留 | 全文 | 通用 native/interpreter 入口，不是项目管理 |
| packages/contracts/src/steward/module-input.bun.test.ts | 保留 | 全文 | 输入声明结构、大小与递归深度边界 |
| packages/contracts/src/steward/module-input.ts | 保留 | 全文 | 外来材料的参数合同边界；不是敌对租户隔离 |
| packages/contracts/src/steward/module-lifecycle.ts | 部分删除 | 全文 | kernel 保留名和生命周期必留；空 builtin 名单与虚构能力位可收敛 |
| packages/contracts/src/steward/module-manifest-boundary.bun.test.ts | 保留 | 全文 | 禁止旧业务字段重新进入 Manifest |
| packages/contracts/src/steward/module-material.ts | 保留 | 全文 | 确定源码、构建输入、制品与可执行模式 |
| packages/contracts/src/steward/module-output.bun.test.ts | 保留 | 全文 | 输出合同编译和信任边界 |
| packages/contracts/src/steward/module-output.ts | 保留 | 全文 | 结果校验与编译复用，不必另造 validator |
| packages/contracts/src/steward/module-tool.ts | 保留 | 全文 | 工具可见性、输入输出与幂等声明 |
| packages/contracts/src/steward/module-version.bun.test.ts | 随版本合同更新 | 全文 | 保护版本身份；不要用旧 Git 兼容测试阻止格式收敛 |
| packages/contracts/src/steward/module-wire.bun.test.ts | 保留 | 全文 | 独立校验语言无关 wire 和传输限制 |
| packages/contracts/src/steward/module-wire.ts | 保留 | 全文 | 应用进程交换与认证 wire；未来 Rust 复用此边界 |
| packages/contracts/src/steward/provider.ts | 保留 | 全文 | 通用进度、预算报告和交互结果；Provider 特有解码不应加入 |
| packages/contracts/src/steward/public-boundary.bun.test.ts | 保留并扩退役项 | 全文 | 公开命名空间与不恢复旧 API 的约束 |
| packages/domain/package.json | 保留 | 全文 | 剩余纯策略仍被 kernel 消费，不因删业务而删包 |
| packages/domain/src/index.ts | 删旧导出 | 全文 | 清理 refs/tool-spec/markdown 导出，不加兼容转发 |
| packages/domain/src/steward/execution-instructions.ts | 删除 | 全文 | 旧执行提示词没有消费者 |
| packages/domain/src/steward/local-day.bun.test.ts | 保留 | 全文 | 每日预算的时区与 DST 边界 |
| packages/domain/src/steward/local-day.ts | 保留 | 全文 | Run、模型及唤醒每日预算共同消费 |
| packages/domain/src/steward/markdown.bun.test.ts | 删除或随真实业务迁移 | 全文 | 只保护已无消费者的旧面板/CSV 实现 |
| packages/domain/src/steward/markdown.ts | 删除或移至实际应用 | 全文 | 页面文档业务，无主仓生产调用 |
| packages/domain/src/steward/modules.bun.test.ts | 保留并清陈旧断言 | 全文 | Manifest/channel 跨模块合同；不应按文件名误删 |
| packages/domain/src/steward/provider.bun.test.ts | 保留核心，删无消费者部分 | 全文 | 活性/交互/脱敏有消费者；Pi 风格统计和工具名映射主仓未使用 |
| packages/domain/src/steward/provider.ts | 保留核心，删/迁解码 | 全文 | 保留通用交互与脱敏；providerUsage/providerToolPhase 属后端适配且无主仓生产调用 |
| packages/domain/src/steward/refs.bun.test.ts | 删除 | 全文 | 仅消费旧短码实现 |
| packages/domain/src/steward/refs.ts | 删除 | 全文 | 无生产消费者的四字符回复码 |
| packages/domain/src/steward/tool-spec.bun.test.ts | 删除或随实际业务迁移 | 全文 | 旧面板表单规则专用测试 |
| packages/domain/src/steward/tool-spec.ts | 删除或移至实际应用 | 全文 | 表单/趋势图业务，不是通用内核合同 |
| packages/kernel/README.md | 保留并同步接线说明 | 全文 | 职责索引；Provider adapter 表述应随门面收敛更新 |
| packages/kernel/package.json | 保留 | 全文 | 正式包/目录/test-support 入口；依赖不因内部文件精简而整体删除 |
| packages/kernel/src/system/activity.ts | 保留 | 全文 | 内核运行、预算、审计及有限事实查询；不接管业务通知 |
| packages/kernel/src/system/agent.ts | 保留 | 全文 | 七工具绑定身份与固定执行端点；原生控制仍需防重放 |
| packages/kernel/src/system/approvals.ts | 保留 | 全文 | 具体用户决定和应用等待；不是通用治理平台 |
| packages/kernel/src/system/modules.ts | 保留 | 全文 | 通用材料与生命周期入口，开发策略不应塞回 |
| packages/kernel/src/system/secrets.ts | 保留，补诊断 | 全文 | 真正保护凭据值；readSecret 的 catch(()=>null) 丢原因属诊断缺陷，不是删除授权的理由 |
| packages/kernel/src/system/settings.ts | 保留 | 全文 | 内核预算设置，非应用偏好配置 |
| packages/kernel/src/system/shared.ts | 保留，可删无调用导出 | 全文 | 真实 owner 与 caller 边界；不按小文件判多余 |
| packages/kernel/src/system/system-contracts.bun.test.ts | 保留 | 全文 | 输出合同与精确一次审批 |
| packages/kernel/src/system/system-modules.ts | 保留 | 全文 | 七个内核服务统一登记 |
| packages/kernel/src/system/system-outputs.ts | 保留并删旧表示 | 全文 | 运行输出校验；应随 Generation/Git/builtin 合同同步收敛 |
| packages/kernel/src/system/system-secrets.bun.test.ts | 保留 | 全文 | 凭据版本身份绑定、主机默认值优先级与不泄漏 |
| packages/kernel/src/system/timers.ts | 保留 | 全文 | 持久唤醒的窄路由 |
| packages/kernel/src/system/tool-contract-declarations.ts | 保留并删无用分支 | 全文 | 公开声明有必要；receipt 的旧 requestKey 形状、重复声明可收敛 |
| packages/kernel/src/system/tool-declaration.ts | 保留 | 全文 | 共享声明与 contractTarget 绑定，10 行不需另造层 |

## 额外静态发现，不与减重混淆

- `system/secrets.ts:69-70` 读取失败被 `.catch(() => null)` 转成“未配置”，没有记录实际原因。应保留外部脱敏并记录脱敏后的失败类别。
- `modules/module-generation.ts:140` 回滚失败状态写入再次失败时 `.catch(() => {})` 吞错。不能把最后一次审阅“未发现新增空 catch”当作整个现存仓库没有空 catch。
- `contracts/docs/module-wire.md` 对 Authorization/Cookie/Set-Cookie 的剥离描述与当前架构的应用自主管理方向不一致。应核对当前生产转发实现后修文档，不凭旧文档改回实现。

- `modules/module-release.bun.test.ts:12` 调用 fixture，但全文件没有定义或导入。`db/src/sqlite-migrations.bun.test.ts:75-79` 仍有五条缺表名的旧二元 tuple，循环却按三元组读取。属于上一轮删除后的测试源码收口缺口，不是已运行得到的失败结果。
- `scripts/verify-slice.ts:153-157` 在 tsc 已失败但诊断不在切片内时返回 ok，并称切片外错误为 pre-existing；没有基线比较支持这个归因。保留 tsc 失败退出码，路径筛选只做展示，不新增诊断基线平台。
- `db/src/sqlite-backup-files.ts:214` 的目录交换进度只存内存；`sqlite-backup.ts:353` 在目录交换之后才进入带 DB marker 的恢复。进程被强制终止时，现有 DB marker 不覆盖已经交换的 platform/sessions/secrets。需要把完整恢复阶段纳入已有持久恢复记录，不应删备份恢复机制。
- `sqlite-backup.ts:333` 的完整 restore 没有 backup 在134行使用的 `assertPrivateProcessesStopped`；运行锁不等于孤儿应用已经停止。补足真实停止边界，不自动杀任意PID。
- `logging/src/redaction.ts:32` 在 WeakSet 检查前处理 Error，safeError 再递归 cause；自引用 Error 可无限递归。复用现有循环检测，不新增脱敏框架。
- `app-sdk/testing.ts:43-58` 的 callStatus 总为 queued，重复 key 返回新的 call.id。修成保存原回执的最小替身，不复制生产调度系统。
- `apps/server/src/steward-runtime.ts:68` health 异常空 catch 丢原因，工厂无 onError 时部分失败也没有默认日志；应走现有脱敏日志，公开 health 继续只返回有限状态。

以上仅静态发现，没有运行复现；未经后续授权不实施。文档 HTTP 转发差异仍列为需逐条对照的文档项，不作为本轮已证实的运行缺陷。

## 完整覆盖、分区报告与证据限度

现存文件清单与各报告逐文件表做只读集合核对：主范围 **427/427** 有表项（父级58、modules107、其余kernel105、基础包79、apps/scripts78）。原来的父级56项遗漏 kernel 包级 README/package.json，已补读补表；子报告中的80还包含范围外配置项，不能直接相加。

这表示每文件均有职责分类，**不表示427个文件全部全文或逐行审完**。modules 有68全文/14局部/25索引；较长内核测试也存在局部读取；三个合同 JSON 只查结构与关联项。基础包79个全文。根配置/CI另查，bun.lock局部，未全面审计所有历史文档、部署制品、生成客户端或仓外私有消费者。

四份详细逐文件表位于以下工作流 artifact 目录，报告保留每行的阅读深度、消费者与建议，不能用摘要替代它们：

`/home/saya/.pi/agent/sessions/--home-saya-workspace-Chrona--/subagent-artifacts/outputs/95e57273-5410-4b0e-8300-950fc486997b/chrona-file-audit/`

| 报告 | 范围 |
| --- | --- |
| report.task-1.md | packages/kernel/src/modules；子报告对现行 Git 路径判保留，父级P3进一步按目标职责提出未来迁移，不是当前可直接删除 |
| report.task-2.md | 其余 kernel（不含 system/modules），普通执行、Provider、通知、timer及测试 |
| report.task-3.md | host/process/db/app-sdk/logging/runtime-config |
| report.task-4.md | apps/scripts、根配置与CI |

仍需证据、暂不删除：SDK源码 typecheck工具、DB ambient helper、file: resolver／外部集成，以及 Candidate/CLI installation 和各层 native 回执的进一步合并。只有测试消费者的开发测试工具不自动等于死代码；要区分工具本身的用途与测试只为孤立实现自证。

## 后续实施顺序（本轮不执行）

1. **先处理影响可信交付的缺陷**：测试源码缺口、verify:slice错误归因、日志吞错；完整恢复一致性另作高风险修复，不和大规模删除混改。
2. **低风险删除**：P1/P2/P6/P7/P8，以及无人消费的fixture与无效字段。同步调用方、合同源/生成材料/测试源码；当前用户仍禁止运行生成器。
3. **删除重复持久化**：P5/P11，同步 schema、唯一初始迁移、公开输出与测试；保留真正的状态消费者。
4. **路径与实体收敛**：P9/P10/P12，先移除旧文件投递，再合执行上下文；测试runner独立收敛。
5. **最后调整材料边界**：P3/P4，先让确定材料独立支持恢复和GC，再移交Git历史与删除兼容布局；不可先删存储、后补恢复。

建议不是执行授权；本轮没有源码/测试/配置变更，相关实现切片净增减均为0。未做CPU、内存、存储或耗时测量，不根据删行预测性能收益。上一轮实现也仍未构建、编译、测试、生成或实际部署验收。
