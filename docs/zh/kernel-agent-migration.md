# 内核与 Agent 重构

状态：本阶段内核与唯一内置 Agent 迁移及离线验收完成；普通应用迁移未包含。工作分支 `work/kernel-agent-migration`，起点为 `f95a63ae` 加 2026-11-10 原工作区未提交材料快照，现已合入原仓库 `b65e7ece`；worktree 位于 `.worktrees/kernel-agent-migration`，快照证据在本 worktree 的 `.tmp/kernel-agent-baseline`。快照属于既有改动，不是本轮实现。

## 授权范围

只迁移内核、唯一内置 Agent 及必要宿主、SDK、构建、合同、离线测试和文档。普通应用保留源码，不要求本阶段迁移或可用。不部署、不提交、不推送、不调用真实模型、不迁移真实用户数据；初始数据库 schema 按新数据基线更新，不添加旧接口兼容层。

## 完成条件

1. 核心运行身份、准入和回执使用明确存储；`Audit` 不再决定 Agent 上下文归属、运行工具集或命令幂等。
2. 停止未知使用结构化状态，不能从错误文字推导授权或执行容量。
3. 工具结果带实际运行与目标身份，以结构化事件持久化；脱敏、有界，未来应用无需解析 Provider transcript 建立交付关联。
4. Agent 运行控制采用结果事件和持久回执对账；保留唯一 Run 队列、真实 caller、预算、租约、取消、未知停止容量和实际停止证据。
5. 全新临时数据库与假 Provider 验证准入、执行、控制、故障恢复；记录实际命令与结果，未通过不得标完成。

## 实施进度

- [x] 创建独立 worktree，复制既有未提交材料，保存基线。
- [x] 首批运行状态存储、候选集合与通知事实，迁移对应内核调用方及离线测试。
- [x] 结构化工具结果、持久 Run 关联、中断未知与迟到回执。
- [x] Provider Run 结果事件、操作身份固定与重启对账。
- [x] 激活验证、连续失败策略与执行结果去重迁出审计读取。
- [x] 上游版本来源与固定合并请求回执迁出审计读取。
- [x] 安装请求、最新回执、提交恢复与删除身份记录迁出审计读取。
- [x] 私有构建的精确 Provider/模型/时限/次数准入迁出审计读取。
- [x] 构建目标、请求去重、版本归属、审核材料及迁移/组激活守卫使用专用存储。
- [x] 移除无生产调用方的内核 completion 网关；保留唯一的应用补全操作及精确预算结算。
- [x] 构建、合同、文档和最终离线检查。

构建目标、请求和审核使用明确字段；没有调用方的旧构建结果拼接文件已删除，未另建通用 JSON 状态中心。普通应用的私有会话存储及默认管家拆分不属于本阶段。

## 已实现的状态边界

| 事实 | 权威存储 |
| --- | --- |
| 应用上下文的 workspace/module/version 绑定 | `AgentContext`，关联 `Session` |
| 单次运行的工具和内容选择 | `AgentRunAdmission`，关联 `Run` |
| 上下文与控制命令的固定幂等回执 | `AgentCommand`，不保存控制输入或回答正文 |
| 内置 Agent 精确启动准入 | `ProviderLaunch`，关联 `Run` |
| 遥测及结构化工具结果 | `RunEvent`，共享事务内递增游标 |
| 安全问题元数据与回答状态 | `RunInteraction`，不保存回答正文 |
| 取消与停止未知 | `Run.cancelRequestedAt / stopStatus`，错误文案不授予权限或占用容量 |
| 路由目标固定身份与合同 | `ModuleInvocation.runId / targetBound / targetModuleId / targetHash / targetContractHash` |
| 精确材料准入、完整固定集合与版本查找绑定 | `CandidateAdmission / CandidateReceipt / CandidateMember` |
| 有限内核事实、消费回执、单消费者选择 | `KernelFact / KernelFactConsumer` |
| 独立激活 epoch、验证状态与回滚观察 | `ModuleActivation`，明确版本身份，展示用有界 JSON |
| 激活内执行结果、连续失败计数与去重 | `ModuleExecutionResult`，绑定 module/hash/activation/result |
| 上游来源与合并固定回执 | `ModuleUpstream / ModuleUpstreamMerge`，请求键绑定实际 module/base/commit |
| 安装请求、最新指针与提交恢复 | `ModuleInstallation / ModuleInstallationHead / ModuleInstallationSubmission` |
| 已删除应用身份与版本 | `ModuleRemoval`，与删除事务绑定，不能由同名重装替代 |
| 私有构建的精确执行准入 | `BuildExecutionAdmission`，关联实际 Run |
| 固定构建目标与请求去重 | `BuildTargets / BuildRequest`，关联真实 Session/Workspace |
| 提交归属与审核 | `ModuleVersion.buildSessionId / ModuleReview` |
| 迁移归属与禁止部分回滚 | `ModuleMigration / ModuleActivation.grouped` |
| 内置 Agent 的应用补全操作 | 既有应用私有 `module-operations/*.json`，真实 caller/version/commandKey/digest 与预算预留绑定 |

候选回执保留完整不可变成员快照；`CandidateMember` 只是版本到集合的独立绑定，缺失绑定不能让成员从完整集合消失。审批后必须重新核对完整集合、真实提交方、授权方和版本基线。

### 结构化结果

`agent.stream.items` 的 `kind: "tool-result"` 项来自真实内核路由，payload 为 `{type:"tool-result",at,value}`。`value` 使用共享 `runToolResultSchema` 的字段：`runId/callId/target/moduleId/hash/contractHash/status/outputState/output`。原始参数不进入该事件。

`outputState` 为 `complete / filtered / omitted`。输出递归脱敏并限制字节；敏感工具的输出省略。过滤、截断、遗漏和非成功状态都不能作为完整交付证据。实际 Run、版本与合同在投递前持久绑定。事件与调用终态在同一 SQLite 事务内保存；它不声称应用激活、页面可用或业务验收成功。普通应用对该事件的消费留待后续迁移，既有 transcript 提取代码本轮保留。Run 中断时，尚无回执的同步调用与有界未知结果在同一事务内保存；实际迟到回执可以补充结果，不重放调用。回执写入失败返回 unknown，不把已执行效果伪装成可重试失败或成功。私有宿主不计算或持久化不存在的公共合同。

### Agent 结果与恢复

内置 Agent 在持久化停止结果后通过当前 workspace、当前运行的短期 callback 发送 `settled`。内核仍是 Run 状态的唯一决策点；Agent journal 只是精确操作的实际停止回执。正常运行等待结果事件，丢失通知时每五秒核对原操作回执，不重新启动 Provider。

重启后 tick 对已有启动准入、停止未知且没有本机 live handle 的上下文运行核对 `agent.status`，只在有实际结果时确认停止。缺失或未知回执继续占容量，不创建新 Run，不重放外部效果。该路径不对远端 execution 的独立签名停止协议作推断。

## 当前限制与剩余工作

本文件记录实施分支，不宣布整个内核重构完成或发布可用。

- 授权、准入、固定目标、预算、回执、停止和迁移归属使用明确存储。Audit 仍保留诊断观察与历史展示，包括状态历史的单调时间排序；它不成为上述控制记录的备用来源。
- Provider Run 使用事件唤醒、持久回执对账。应用补全使用既有 Agent 私有持久操作和 `agent-settle` 结算；未知结果不发送停止证明，内核预算预留继续 pending。无生产调用方的内核补全网关已删除。
- 唯一 Run 队列与现有 execution 证明协议保留。可信 `agent-admit/agent-settle` 回调保留为必要内核执行边界：从当前真实路由调用推导 caller、授权和预算，Agent 不提交自称身份。没有再添加一套调度或授权运行时。
- Agent 源码产物和 Git bundle 已同步，资源目录的精确材料校验通过；二进制与最终回归结果见本文件末尾。本阶段不授权部署。
- 普通应用迁移、跨入口管家、应用私有 SQLite、持久唤醒机制、真实模型及生产验收均不在本阶段验证结果之内。
- 原工作区在本轮期间继续发生了独立改动。本 worktree 保留创建时快照；后续整合须基于快照逐项合并，不能整体覆盖原工作区。

## 检查记录

- Prisma Client 7.9.1 已生成；NixOS 使用本机 `/nix/store/...prisma-engines_7-7.8.0/bin/schema-engine`。首次默认下载在沙箱中解析失败，提升权限后确认 NixOS 远端引擎不存在，随后使用仓库 Nix 配置同类本机引擎。
- `0001_initial` 按完整 schema 重新生成；原 `0002_s5_kernel_execution` 合并回唯一初始基线。已有数据库的 checksum 守卫保留，测试仅用新数据库。
- 全仓 `tsc --noEmit --pretty false`：通过。使用 `NODE_OPTIONS=--max-old-space-size=6144`；当前 shell 没有 user systemd bus，无法使用 `systemd-run --user`。
- 定向结果协议/恢复检查：50 项通过，0 失败（加入后续夹具调整前的一轮）。
- 一次直接在同一 Bun 进程执行 137 个文件得到 1512 通过、56 失败、1 跳过；包含全局环境串扰、旧夹具和普通应用问题，不作为验收通过。后续使用仓库脚本 `CHRONA_TEST_CONCURRENCY=1 bun scripts/run-bun-tests.ts ...`，每文件独立临时数据库与环境；最终合并有效的逐文件重测结果：48 个内核/Agent 文件加 4 个 API 文件，共 52 文件、718 项通过、0 失败。API 在最终 schema 上以独立临时数据库重新运行。两组普通应用检查未纳入此通过范围，见下条。
- 测试监管器使用本机 Nix GCC，通过 `CC` 指定；运行时不调用编译器。
- 未提交、推送、部署或操作真实用户数据。

### 阶段一门禁与未通过项（历史记录）

- TypeScript 全仓检查通过；`git diff --check` 通过。
- `LINT_RATCHET_BASE=f95a63ae bun scripts/lint-ratchet.ts` 通过：124 个已跟踪变更文件，0 错误；保留 14 个既有/基线允许的警告，没有增加逐文件 lint 债务。新增运行事件及恢复源文件另经定向 ESLint 检查。
- 更广检查中的 `module-policy-author.bun.test.ts` 仍有 QQ/MCP 自测及 Author 提示约束共 3 项失败；`module-typecheck.bun.test.ts` 有 QQ 依赖/类型检查 1 项失败。普通应用业务未修改，这 4 项不能计为通过，需在普通应用迁移时核查。
- `modules.bun.test.ts` 发现源码与完整材料的缺失错误映射不一致；已将 ENOENT 映射集中到共同的 `versionSource` 边界，避免 checkout 泄露内部路径；该文件重测 105 项通过。
- 原生材料往返夹具改为遵守标准 `CC` 环境变量，使用真实本机 C 编译器；往返验收通过，不把改名后无法运行的多调用宿主程序当作原生制品证明。
- 上述阶段尚未完成发行材料与后续迁移；本文件末尾记录最终代码与验收结果。永久边界冻结声明不因本分支离线检查自动生效。

详细日志、逐文件结果、基线快照及本轮文件清单保存在本 worktree 的 `.tmp/kernel-agent-baseline`，属于开发证据，不进入发行材料。

### 后续迁移：激活与失败策略

激活验证改为直接查询 `ModuleActivation`，不再扫描最多 600 条审计推断当前 epoch。创建顺序与观察更新时间分开，保留同哈希重新激活隔离、旧回执失效和回滚守卫。`ModuleExecutionResult` 保存真实执行结果与连续失败数，固定结果 ID 去重；审计仅保留事务内观察副本。清空审计不会清除激活归属、重置连续失败或重复计入同一执行。新数据基线同步 `0001_initial`，不迁移已有数据库。

本次定向与关联调用验证：9 文件、192 项通过，0 失败；包含激活并发、监管器、诊断、身份、状态、工具、执行交付、私有日程交付和 SQLite 初始基线。全仓 TypeScript 检查通过。该结果是本次改动验证，不替代此前 52 文件检查，也不声明未重跑的整包或普通应用检查通过。日志：`.tmp/kernel-agent-baseline/lifecycle-*.log`。

### 后续迁移：上游来源与合并回执

`ModuleUpstream` 保存当前应用的仓库、分支和精确提交；`ModuleUpstreamMerge` 保存工作区请求键、原应用身份、基线、所选提交、实际准备提交及结果。应用删除不级联删除合并回执，避免同名重新安装接管旧请求。移除审计读写依赖；成功结果丢回复、合并冲突、提交未知的既有去重与拒绝重放行为保留。测试在成功和冲突后清空审计，确认依然返回原结果或拒绝重新合并。

上游、安装、内置注册、SQLite 基线 4 文件、54 项定向检查通过；全仓类型检查与 lint ratchet 通过（0 错误、14 项基线允许警告，未增加逐文件债务）。本批未修改任何普通应用业务；安装机制的剩余审计状态仍待迁移。

### 后续迁移：安装恢复与精确构建执行准入

安装请求键绑定工作区、应用名和原始 install/update 模式；可变回执使用显式状态、实际模块身份、版本、审批和有界错误字段。最新回执指针与首次请求在同一事务内创建。提交阶段独立保留精确 hash、原 moduleId、既有 versionId、标记和阶段；持久阶段损坏时拒绝恢复，不猜测成功。初始化读取原模式，不会把丢失回复的 install 升级为 update。

删除在同一事务保存 `ModuleRemoval` 并删除应用。安装回执和删除身份不随应用删除消失。清空审计后，丢失回复的提交仍可恢复，已删除应用不会被同名同版本重装接管，没有提交证据的请求不会重新执行。材料往返测试通过完整安装入口建立准入，不再直接绕过回执适配器。

私有构建的 Provider、模型、超时和提交次数由 `BuildExecutionAdmission` 固定，工作区请求文件和旧审计不能改写它。请求键、固定目标及构建结果关联仍待后续迁移，此处不声明整个构建控制面已脱离审计。

扩展检查中的 Files/MCP 文件未通过：Files 的临时发行资源含缺失的 `builtin/agent/node_modules` 路径；MCP 的应用 SDK 自测连接失败。二者未计入本批通过范围，也未通过修改普通应用业务绕过。

本批最终 schema 下隔离验证：11 个文件、191 项通过，0 失败，包含安装/删除/初始化/暂停应用边界、材料往返、私有构建与 SQLite 基线。全仓 TypeScript、lint ratchet 与 `git diff --check` 通过；lint 保留 14 项基线允许警告，无新增逐文件债务。新增持久阶段损坏测试确认拒绝猜测恢复。证据：`.tmp/kernel-agent-baseline/install-final-tests.log`、`install-final-typecheck.log`、`install-final-lint.log`。

### 收尾：构建控制、补全与发行材料

固定目标不再从审计或可写 request.json 回退读取；请求键绑定原 Session 与精确请求指纹，按原因去重读取专用记录。版本归属与审核材料直接关联受信任 Session/Version；只有现有可信内核路径能写入，没有新增 Provider 可自称身份的公共接口。移除无调用方的 `module-build-outcome.ts`。迁移启动记录与状态切换同事务提交；迁移、恢复以及组激活禁止部分回滚的判定不依赖审计是否保留。

调用盘点确认旧内核 `completeForModule` 没有生产调用方。删除 `module-model.ts`、`waitAgentCompletion`、内核 direct/tier completion 合同与内置 Agent 的内核补全处理，而不是迁移出第二套 completion 执行/恢复系统。应用 `agent.complete/completion` 仅对 modules 暴露结构化参数，保留既有 `createModuleAgentOperations`：由真实路由调用准入，绑定 owner/hash/commandKey/digest，模型开始前保存私有回执和预算预留，完成后持久化再调用 `agent-settle`。重启不重放未知操作；未知结果不结算为已停止。内核不能通过 encoded input 绕过此入口。应用可读自己的 operation 状态；内核不再 100ms 轮询。

发行打包会重新生成已保留入口应用的共享资源并同步精确 bundle，这不代表普通应用业务已迁移或可用。没有调用真实模型、真实账号、QQ、部署或旧数据迁移。

## 本阶段最终验收

基准 revision：`f95a63ae3d8683950ab8bf7f0dc1a67d934dd929`；分支 `work/kernel-agent-migration`。未创建代码提交，验收针对保留原工作区快照后的实际 worktree 内容，不能将 HEAD 单独视为已提交成果。

- 58 个核心文件、877 项测试通过；Agent 私有补全操作专项 1 文件、3 项通过；API 4 文件、11 项通过。共 **63 文件、891 项通过，0 失败**。使用仓库测试监管器逐文件独立临时数据库与环境，`CHRONA_TEST_CONCURRENCY=1`；不以中间尝试的失败/重试结果冒充最终通过。
- 全仓 `tsc --noEmit --pretty false` 通过；`LINT_RATCHET_BASE=f95a63ae bun scripts/lint-ratchet.ts` 通过（0 错误，14 项基线允许警告，无新增逐文件债务）；`git diff --check` 通过。
- 通过正常打包函数重新生成精确本地 Git 材料，重建 `linux-x64` 二进制和 tar.gz。普通应用的保留源码仅经现有资源生成过程打包，不因此成为已迁移或已验收应用。
- `smokeRelease("linux-x64", {runtime:false})` 通过，检查 CLI、原生监管器、资源及打包后的模块类型契约；另以完全隔离的临时数据/配置目录、未继承模型/账号环境启动最终编译二进制，`/health` 通过。未对普通 Web/QQ/MCP 业务运行作成功推断。
- 发现并修复审核记录外键跟随重投版本 ID 的问题：同 hash 的拒绝版本重新提交后，在同一事务删除旧审核，防止旧材料被下一轮复用；相应回归测试通过。

证据位于本 worktree 的 `.tmp/kernel-agent-baseline/`：`final-core-files.txt`、`final-core-tests.log`、`final-module-operations-tests.log`、`final-api-tests.log`、`final-typecheck.log`、`final-lint.log`、`final-package.log`、`final-release-smoke.log`、`final-kernel-health.log`、`final-evidence.json`。实际打包编排 `.tmp/final-kernel-package.ts` 调用 `prepareReleaseResources`、`prepareModuleGitRelease`、`buildBinary`；构建环境使用本机 Nix Prisma schema engine 与 GCC，`NODE_OPTIONS=--max-old-space-size=6144`。

本阶段无剩余实现项；普通应用业务迁移、真实模型/账号、现有用户数据迁移、跨平台/生产环境、部署、主工作区整合与永久边界冻结均未包含。以上为合并上游前的验收记录；后续整合见下节。前述普通应用扩展检查失败仍如实保留，不计入本阶段的 891 项通过结果。

## 原仓库提交整合（2026-11-10）

已将原仓库 `platform-v2` 的 `b65e7ece`（完整应用材料、桌面窗口与可选任务超时）纳入 `work/kernel-agent-migration`。分支 HEAD 快进至该提交，再恢复并整合未提交迁移；没有创建代码提交或推送，原仓库工作区保持干净。迁移备份 stash `2f03a1b3a4f97f578fcad83b9f9db661b8c3a2c9` 保留。

冲突整合保留上游可选超时、无限时运行与交付终态重试，同时保留迁移后的结构化取消、停止证据、Provider 启动与候选材料回执。普通应用新功能和发行版本沿用上游；仅重建 Agent 发行版本，并验证其 Git 父版本包含上游材料提交。

合并后定向验证：13 个核心/材料/SQLite 测试文件 111 项通过，4 个 API 文件 11 项通过，共 **17 文件、122 项通过，0 失败**。全仓 TypeScript、基于 `b65e7ece` 的 lint ratchet（0 错误、5 项基线允许警告）通过。Linux 二进制与归档重建成功；最终产物静态 smoke 与隔离临时数据启动 `/health` 验证通过。未重新运行合并前全部 891 项测试，也未验证普通应用业务、真实模型、真实账号、部署或现有数据迁移。

证据：本 worktree 的 `.tmp/upstream-integration/` 下 `typecheck.log`、`tests.log`、`lint.log`、`api-summary.log`、`package.log`、`release-smoke.log`、`kernel-health.log`；原始补丁与 stash 标识也保存在该目录。迁移实现仍为未暂存改动。

## 普通应用后续阶段

用户随后授权处理全部普通应用，当前源码适配和验证见[普通应用迁移记录](application-migration.md)。前述“普通应用未包含”仅描述内核阶段的验收边界，不表示本工作分支此后没有普通应用改动。
