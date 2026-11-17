# Chrona 内核职责减重计划

- 日期：2026-11-17
- 基线：`b8b971c0`
- 状态：原调查计划；最新授权与分工见 [002-execution-board.md](002-execution-board.md)。远程保留结论已撤销，本轮整合源码，禁止运行构建、编译、测试或生成器。
- 目标：保留受控执行和可靠安装，删除内核的软件开发工作流与本地项目管理职责。
- 范围：发布、开发检查、本地项目执行及其直接调用方；不是全仓漏洞或性能审计。
- 本轮初始工作树：存在未跟踪 `anti-slop/`，不得修改或清理。

## 实施约束

1. 本计划不是启动实现、迁移真实数据、部署、发送消息、Git push 的授权。实施前检查所有涉及仓库的 `AGENTS.md`、`git status` 和 diff，保留用户改动。
2. Chrona 主仓仅维护 kernel、host、CLI、DB、SDK；应用业务只放独立应用仓。复用 `../chrona-module-author`、`../chrona-module-pi`，不恢复 Coding/Editor，不另造发布平台。
3. 各切片交付完整调用链和必要合同、SDK、测试、文档更新；不保留旧公开 API 兼容层。不能只移动文件却继续让内核编排原流程。
4. 真实 caller、固定 Provider、精确授权、硬预算、唯一 Run 队列、取消、未知停止占容量、实际停止证据、固定回执及数据安全保证保持不变。
5. 使用全新临时数据。schema 改动同步 `packages/db/prisma/migrations/0001_initial`，保持旧库拒绝及 checksum 守卫；不转换现有实例。
6. 每个切片报告主仓与应用仓各自的 `git diff --numstat`，区分代码迁移与真正删除；计划阶段不虚报净删行数或性能收益。
7. 仅变更下文明确列出的行为。与本任务无关的日志、lint、UI 等问题单独记录，不顺手扩大修复范围。

## 一、核实的当前状态

### 1. 两种名为 build 的机制必须分开

- `packages/kernel/src/execution/runs.ts:65–123` 有 `build` Agent Run 通道、FIFO 特例、专属超时及向 prompt 注入候选提交次数限制。
- `packages/kernel/src/runtime/tick.ts:130` 每轮仍调度 `foreground / background / build`。
- 生产源码中检出的 `enqueue` 调用为 Agent 和旧 execution 准入；公开 `agent.run` 的 lane 只有 `foreground / background`。未找到生产代码创建 build-lane Run。
- `runtime/tick.ts:71–74` 的 `startBuild` 另行执行 `modules.buildPending`，这是实际使用的应用安装检查，不是 build-lane Agent。不能因前者无入队调用而一起删掉后者。

### 2. 发布并非只有一个入口

- `modules/module-candidates.ts`：Author 的材料准入、冻结、固定集合及回执。
- `modules/module-proposal.ts`：内部源码提案及版本入队。
- `modules/module-install.ts`：CLI/发行安装、持久提交跟踪、exact-release 与普通更新。
- `modules/module-upstream.ts:29–48`：内核合并 Git 分支，再调用 propose。
- `modules/module-build-review.ts:78–147` 与 `modules/module-group.ts:66–171`：分别处理直接版本与固定集合的激活/审批；单应用候选也使用集合路径。
- `apps/cli/src/admin.ts:59–65` 直接消费安装接口。必须保留停服后的救援安装能力，不能让它依赖 Author 已启动。

### 3. 内核的开发检查确实超出材料接收

- `modules/module-build.ts:84–151`：准备依赖、类型检查、执行 tests、数据连续性演练、启动检查、检查受影响调用方。
- `modules/module-output-impact.ts:26–49` 将合同改变可能影响的活跃应用列出；它不是可靠的实际调用关系图，不能将结果解释为真实依赖使用记录。
- `modules/checks/module-continuity.ts` 不仅检查 schema，还复制应用真实数据到临时目录、执行迁移与作者测试。
- `modules/checks/module-probe.ts:9–20` 只检查加载与 SDK 连接，应保留最小安装检查，不能与业务测试一起删除。
- `../chrona-module-author/validate.ts:140` 已有快照检查和本地测试；`material.ts` 已有源码/制品/构建说明及摘要；不需要从零建设第二套创作流水线。

### 4. 本地项目执行仍显式装配

- `apps/server/src/steward-runtime.ts:27–78` 装配项目注册表、配置映射、工作区准备、cleanup、execution 服务与事件存储。
- `execution/execution-admission.ts:42–55` 为目录保留占用，并保存项目、映射修订、baseline、workspace 信息。
- `execution/execution-context.ts:18–80` 构造专用执行 prompt、事件及项目复核；`runtime/tick.ts` 对本地 execution 另行 claim、启动及捕获 Git 结果。
- `apps/server/src/execution-server-workspace.ts`、`execution-workspace-cleanup.ts` 使用 `@chrona/git-workspaces`；生产导入检索只发现这两个 Server 适配器消费该包。
- `execution/runs.ts:77` 普通 Agent 固定 cwd 到 session 目录；`../chrona-module-pi/schema.ts:9` 的运行选项仅接受 model/thinking。目前不能直接把任意准备好的工作目录塞进现有 Pi providerOptions。

### 5. 远程执行全部退役（替代原保留结论）

原调查根据消费者存在建议保留远程。用户随后明确撤销该判断：删除 remote delivery、carrier、签名停止、模型中继、治理和专用 Execution 表。只把普通 completion 仍消费的 helper 移到 `agent/provider-completion.ts`；普通 Agent 的生命周期排空由 `agent/module-drain.ts` 承担。独立 remote-execution 应用仓和真实数据保留，不保留旧协议兼容入口。

## 二、实施切片与顺序

### S1：删除无生产入队方的 build Agent 专用通道

**优先级 P1；工作量 S；风险 MED；无前置依赖。**

**改动范围**

- `packages/kernel/src/execution/runs.ts`、`run-finish.ts`、`runtime/tick.ts`、`settings.ts`。
- `packages/contracts/src/steward/index.ts` 的 build lane、专用 limits/settings，以及它们的实际消费者。
- `packages/kernel/src/build-settings.bun.test.ts` 和直接受影响的 Run、通知、合同测试。

**步骤**

1. 重跑生产调用检索，确认无 build-lane 入队方；若发现真实调用方，先将其切到 `agent.run`，不要恢复 build 专用 API。
2. 删除 build lane 调度、FIFO 特例、专属预算参数、prompt 追加及 `build-paused` 专属通知。通用超时、每日/会话预算、前后台优先级保留。
3. `SESSION_SOURCES / RUN_TRIGGERS` 中带 build 的值及 `chrona_reply` 只在确认所有消费者后删除；名字里有 build 不是删除依据。
4. 保留实际安装所需 `modules.buildPending`、`module-build-failed` 及运行时类型检查资源；这些在 S3 另行拆分。

**验证**

- `bun run verify:slice packages/kernel/src/execution packages/kernel/src/runtime packages/kernel/src/settings.ts packages/contracts/src/steward`。
- 将有意义的 build 通道测试改为普通 Agent Run 测试；覆盖前后台调度、预算耗尽、取消及未知停止占用。
- 预期：生产调度不再有 build lane；应用候选仍能进入现有安装检查。状态机测试采用 `packages/kernel/src/__testing__/state-machine-invariants.ts` 对应反例。

### S2：单应用发布，合并两条激活判定路径

**优先级 P1；工作量 L；风险 HIGH；可在 S1 后独立推进。**

**改动范围**

- `modules/module-candidates.ts`、`module-candidate-records.ts`、`module-group.ts`、`module-build-review.ts`、`module-activation.ts`、`module-context.ts`、`module-generation.ts`。
- `packages/contracts/src/steward/module-candidates.ts` 及系统工具输入/输出、SDK 生成材料。
- `../chrona-module-author/{contracts.ts,workflow.ts,module.json}` 及直接候选集成测试。
- DB 的 Candidate/Review/Activation 中仅服务成组发布的字段与关系；保留单应用回执所需数据。

**目标合同**

- `modules.admit / source / submit / receipt` 保留工具名，准入和提交面向一个应用，使用单目标/单材料字段，不再以完整集合建立联合基线。
- Author 如处理多应用任务，在自身任务中分别调用单应用发布；不承诺原子成组切换，不在内核增加批量兼容入口。
- 固定 receipt 仍能区分材料接收、检查、审批、版本获准与当前选中；同名重装、回复丢失和审批后基线变化语义不变。

**步骤**

1. 将固定材料、真实提交方、精确活动基线及单应用 receipt 从集合逻辑提取到现有材料准入代码，不创建另一套发布服务。
2. 让固定候选与直接版本安装使用同一单应用激活判定：当前基线、权限变化、迁移、排空、批准后复核。
3. 删除 `activate_modules`、`groupPayloadSchema`、group preview、联合批准、跨应用全有或全无切换及仅为它们服务的恢复状态。
4. 删除 `module-group.ts` 前，将其中单候选必须保留的逻辑并入单应用路径；不能只删除调用而使候选永久等待。
5. 更新 Author 单目标合同、所有直接调用测试及目标规范 §3；这明确改变现有成组承诺，不伪装成内部无行为重构。

**验证**

- `bun test packages/kernel/src/modules/module-candidates.bun.test.ts packages/kernel/src/modules/module-candidate-refusal.bun.test.ts packages/kernel/src/modules/fixed-candidate-recovery.bun.test.ts packages/kernel/src/modules/module-owner.bun.test.ts`（更新旧断言后运行）。
- `bun run verify:slice packages/kernel/src/modules packages/contracts/src/steward`。
- 新增/改写单应用表驱动用例：重复 key、不同材料冲突、冻结后源码变化、丢回复、审批期间重启/基线改变、无权限扩张自动激活、迁移批准、忙碌后恢复。
- Author 定向验证使用其现有 `author.bun.test.ts / material.bun.test.ts`，先核对该仓测试入口和依赖，不凭历史命令宣称已通过。
- 预期：多目标输入明确失败；单应用候选与 CLI 安装均能走到终态；既有批准不能批准另一份材料。

### S3：开发检查与 Git 演化迁到 Author，安装归并为固定材料路径

**优先级 P1；工作量 L；风险 HIGH；依赖 S2。**

**移交与保留**

| 当前职责 | 目标 |
| --- | --- |
| 类型检查、业务 tests、受影响调用方的源码检查 | 当前 Agent/Author 的开发工作区；复用 Author validate 和现有 SDK typecheck |
| 自动复制私有真实数据再执行作者 tests | 删除默认行为；开发仅使用 fixture，真实数据演练须另有具体授权，不建新的导出平台 |
| fetch/merge、上游关联及 push 工作流 | Author/当前 Agent 使用普通 Git；通过公开 source/material 接口，不读取 kernel 数据库或裸仓路径 |
| 源码、锁、制品、模式与摘要验证 | kernel/host 保留 |
| 固定 Git bundle 读取/校验、版本源码恢复 | kernel/host 保留，不因带 git 字样删除 |
| 运行依赖准备、最小加载/SDK 握手 | 通用 host 安装职责保留 |
| 真实数据迁移、备份、批准、原子切换和失败恢复 | kernel 生命周期保留 |

**改动范围**

- `modules/module-build.ts`、`module-build-review.ts`、`module-output-impact.ts`、`checks/module-typecheck.ts`、`checks/module-continuity.ts`。
- `modules/module-upstream.ts`、`module-git-upstream.ts`、`module-install.ts`、`module-proposal.ts`、`module-exact-release.ts`、`module-source.ts` 的相关职责。
- `apps/cli/src/admin-module-git.ts` 及 `program.ts` 的关联/推送入口；不修改通用救援启停、备份和恢复。
- `../chrona-module-author` 的开发检查、Git 工作流、工具声明和测试。SDK 类型检查资源放 `packages/app-sdk`；宿主通用运行能力不移到 Author。

**步骤**

1. 将 `typecheckAndTest / checkDependentCallers` 的开发职责交给当前工作区和 Author；复用已有检查，不把 kernel DB 依赖搬入应用。
2. 移除 kernel 发布门禁中的调用方源码检查与全局影响扫描。保留声明依赖及运行时固定合同的拒绝行为；不承诺静态兼容分析或自动修复全部调用方。
3. 拆分 `checkContinuity`：schema 升降级、迁移入口和是否需要批准由安装/生命周期检查；业务测试和可选 fixture 演练归开发侧。保留 `module-migration.ts / module-data.ts` 的真实数据安全流程。
4. 拆分 `module-git-upstream.ts`：bundle 校验/import/固定版本读取保留；网络 fetch、merge-tree/commit-tree、上游工作分支管理移到 Author。应用工作区拥有自己的 Git 历史，不直接操作 kernel 的 `platform/repos`。
5. 删除内核普通 update 隐式合并上游的行为。CLI 安装与 Author 提交最终调用同一固定材料准入/检查/激活核心；入口各自可以保留必要回执，但不再各自调用一套 propose/build/review 状态机。
6. 将 `module-exact-release.ts` 中“为特殊更新入口判断是否能合并”的部分随入口合并退役；保留不覆盖用户修改的明确基线前置条件。CLI 对本地修改冲突返回明确失败，不自动丢弃修改。
7. 最小安装检查继续异步可恢复；可复用现有版本状态和 tick，不为改名新增队列或操作账本。提交方检查结果只作为绑定材料摘要的报告，不作为内核亲自执行的证明。
8. 删除仅用于展示开发报告的 evolution 字段；保留 health/rollback/故障归属实际消费的 activation 身份和运行事实，不能整个删除 `module-evolution.ts`。

**验证**

- `bun test packages/kernel/src/modules/module-install.bun.test.ts packages/kernel/src/modules/module-exact-release.bun.test.ts packages/kernel/src/modules/module-source-recovery.bun.test.ts packages/kernel/src/modules/module-migration.bun.test.ts packages/kernel/src/modules/module-migration-ownership.bun.test.ts packages/kernel/src/modules/checks/module-probe.bun.test.ts`。
- `bun run verify:slice packages/kernel/src/modules packages/host/src apps/cli/src packages/app-sdk`。
- 用例：host 不再执行应用 tests/调用方 typecheck；冻结材料和执行模式篡改被拒绝；运行依赖或 SDK 握手失败可诊断；Author 未启动时 CLI 仍能安装确定制品；有本地修改时显式冲突；迁移失败保住原数据，批准/重启不重放未知效果。
- Author 检查覆盖测试失败/未执行的区别及材料 digest 关联；不新增模型调用。

### S4：项目与 worktree 迁到 Author，合并本地 execution 到普通 Agent Run

**优先级 P1；工作量 L；风险 HIGH；依赖 S1，建议在 S3 后实施以减少并行触碰。**

**职责归属**

- Author/当前 Agent：项目列表、映射、baseline、工作区准备、目录并发策略、Git diff 和成果接受/保留/清理。
- Pi 等 Provider：具体引擎启动、执行环境接入、后端恢复和实际停止证据。
- kernel/host：冻结实际 Run 身份和执行 cwd、工具准入、预算、唯一队列、进程/后代监督、停止及恢复。

**改动范围**

- Server 的 `config/execution-projects.ts / execution-project-registry.ts`、`execution-server-workspace.ts / execution-workspace-cleanup.ts`、`steward-runtime.ts` 及直接测试。
- `packages/git-workspaces` 迁到应用拥有的源码/库位置；只在仍有消费者时保留，不在主仓留业务共享包或复制多份。
- kernel 的本地 `execution.ts / execution-admission.ts / execution-admission-intent.ts / execution-v2-tools.ts / execution-server-workspace.ts / execution-workspace-cleanup.ts / execution-context.ts / execution-result.ts / local-workspace.ts`。
- 共享的 `runs.ts / run-finish.ts / runtime/tick.ts / ports.ts / index.ts` 及 Agent 输入合同。
- `../chrona-module-author` 的项目/工作区工具；`../chrona-module-pi` 的工作目录接入和测试。不修改它的 UI。

**步骤**

1. 为普通 `agent.run` 补最小的可选 `cwd` 执行输入，缺省仍用当前 session 目录；不新增 project/workspace 命名空间、映射表或环境凭证体系。trusted-local 下这是已认证调用方的执行请求，不是 OS 沙箱授权。
2. kernel 校验输入形状并冻结到 Run/context 的执行关联；继续同一 context 时不得悄悄切换 cwd。Provider 必须使用该固定值，不能通过 providerOptions 改写 Run token、caller 或工具身份。session 日志目录与实际工作 cwd 分离。
3. Author 准备工作目录后调用正常 Agent 路径；Pi 按通用 ProviderRunInput 中的 cwd 启动。保留宿主失败诊断，不用新的“项目可信注册”取代已移除映射。
4. 本地 `executionRunInput` 的专用 system prompt、baseline/预算提示和 Git 结果整理迁到应用；原 Agent `read / write / stop` 承担执行控制，不再暴露 start-v2/local workspace 控制路径。
5. 删除 Server 项目配置/注册/工作区端口接线、`workspace-local.prepare/release/cleanup/capture/result` 和无人再用的本地导出。`workspace-local.capture-file` 被 Run 文件交付使用，须保留或并入现有通用文件交付，不能随工作区适配器一起删掉。
6. 删除 tick 本地 coding 专属 claim/launch/capture 分支，统一为普通 Agent 启动；迁移本地事件消费者到 Agent 事件，不搬一套 execution 事件数据库进 Author。
7. 删除远程和旧本地 Execution 专用模型及字段；保留普通 Run/Agent、`Module.executionFenceAt`、真实停止证据、未知占用和通用生命周期守卫。
8. 若 `codingCapacity` 的某项限制是需要保持的全局 Agent 容量保证，将其收敛到现有 Run 准入；项目目录冲突策略由 Author 承担，不再用 kernel 目录占用表实现。

**验证**

- `bun test packages/kernel/src/agent/agent-projects.bun.test.ts packages/kernel/src/agent/agent-provider-kernel.bun.test.ts packages/kernel/src/agent/agent-recovery.bun.test.ts packages/kernel/src/agent/provider-fence-recovery.bun.test.ts`。
- `bun run verify:slice apps/server/src packages/kernel/src/agent packages/kernel/src/execution packages/kernel/src/runtime packages/contracts/src/steward`。
- Author 迁入工作区测试使用新临时 Git 仓：独立树、目录冲突、成果保留、未确认停止时拒绝清理；Pi 定向测试使用假后端，不调用模型。
- 统一路径新增用例：指定 cwd 实际生效、继续上下文不能换目录、来源不同仍同一队列、启动失败、取消/后代停止、停止未知不释放容量、前端输入与回答继续绑定原 Run。
- 远程专用回归随实现退役；普通 Agent 回归覆盖取消、租约过期、生命周期排空、未知停止占用和后续结算。

## 三、明确不在第一轮合并或删除的部分

1. **不合并所有回执表。** 通用 call 返回、材料提交和生命周期完成具有不同语义。归并底层发布流程，不以减少表数混淆完成状态。
2. **保留普通 Run 的源码。** `execution/` 中仍由普通 Agent 使用的 Run、认证、事件和启动逻辑保留；删除旧本地与远程专用文件及表。
3. **远程模型中继已退役。** 不保留协议、治理或兼容入口；普通 completion 继续沿唯一 Run 队列、真实 caller、硬预算和原回执结算。
4. **不删除通用进程监督、SDK loader、runtime declarations 或 `sandbox.runModule`。** 真实迁移仍消费它们；开发 typecheck 迁出不代表运行依赖资源可删。
5. **不删除 activation 世代身份和健康事实。** 当前 health、故障策略、回滚和 Provider 生命周期使用它们；只删开发报告投影和 group 专属字段。
6. **不实现 Rust、跨语言 SDK、迁移框架或全新发布服务。** 保留公开 wire、确定性材料与合同语义，先完成职责收敛。

## 四、收工条件

- 上列检查命令仅供后续获准的验证阶段使用。本轮用户明确禁止构建、编译、测试、lint、verify 和生成器；只交付源码及静态检索，不宣称运行通过。
- 新状态机或跨模块实现完成后，按项目指引安排独立只读 reviewer，核对空 catch/压行、无消费者持久化，以及配额/游标/幂等 key 的异常并发死锁；本次计划阶段不启动委托。
- 最小端到端路径：Agent 在应用拥有的工作区开发测试 → Author 提交单应用固定材料 → kernel/host 安装检查 → 必要权限/数据决定 → 激活 → 查询原回执。
- 无 Author/Provider 的空内核仍可启动；损坏的入口应用仍可经 CLI 救援。
- 原调用者、原 key、原材料和原版本可追溯；未知结果不自动重跑，实际停止之前不释放占用或清理工作目录。
- 没有未经授权的真实库迁移、服务操作、外部 Git 操作、部署、自动提交或推送。

## 五、停止与澄清条件

- 发现本文未覆盖的活跃生产消费者：记录具体入口和所需能力，再调整对应切片，不直接删除或恢复旧兼容系统。
- 迁出实现必须读取其他应用/kernel 私有数据库，或需要新的通用任务平台才能成立：停止该方向，回到公开工具和当前 Agent 工作区。
- 现有检查失败先判断与切片关系；相关失败解决，无关存量失败独立记录，不反复重跑碰运气。
- 若目标要求保留原子多应用发布，这与 S2 目标冲突，应先决定产品承诺，不能同时实现单应用简化和隐藏 group 协议。
