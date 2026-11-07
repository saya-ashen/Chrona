# Provider、内核执行层与业务模块：实施计划

状态：Provider 分离与后续内核/系统模块职责最小化、全范围职责审查及本地自动验证已完成；真实模型四路径冒烟未执行，生产部署继续暂停。完整职责清单见 [内核职责审查](kernel-responsibility-audit.md)，本轮验证记录见第 10 节；第 8–9 节是先前阶段的历史证据。
基线：`platform-v2`，`5737b72159ab8182fba66067c55ed1d716a75f67`。规划前工作树干净。
部署另行暂停；本文不授权继续生产变更。

## 1. 目标与约束

补充原则：功能优先放 **普通模块 → 预装模块 → 内核模块 → 内核**。内核和内核模块分别最小化；业务策略和聚合不因“通用”进入其中。只有无法用现有受治理原语安全实现的必要机制进入内核。既有 builtin 的可信发行身份本轮保持，不能借重构开放动态更新。

后续实施：自动记忆策略归选中的记忆应用；Today 聚合归 web；审批通知展示归 notify。系统保留受控快照/运行事实与兼容转发，避免另建事件框架。本轮验证单独记录于第 9 节，先前 Provider 测试不代表本轮通过。

Provider 只提供启动、注入、语义事件、停止和结束结果，并落实必须在执行点强制实施的约束。内核向模块提供受治理的执行原语，掌握真实 caller、权限、租约、deadline、预算、取消、审计、持久化、问答和资源占用。模块持有业务目标、工作分解、placement 选择、worktree 的使用策略、成果比较与人工接受。

- 维持一个 `ProviderAdapter`，不拆能力中心、Provider 注册框架或后端与运行方式的组合配置。
- 保留 `complete` 与 `start/inject/abort/done`；模型单次调用不强行变成 Agent Run。
- 暂不引入 herdr-core，不新增其他后端；先用现有 Pi 验证边界。
- 模块不直接取得 Provider、原始 RPC、运行 token 或内核数据库。`raw_rpc` 保持 false。
- 工具白名单、工具调用上限、受控目录挂载和进程终止约束保留在可信执行点。模块提交的 prompt 不能扩大权限。
- 有两个真实业务使用方且需要独立状态的复杂能力，才考虑拆共用模块；服务端与设备端运行同一 coding 业务不算两个业务使用方。
- 本轮优先不改 schema、迁移、设备线协议、公开工具与身份模型；发现必须改时先单列必要性与兼容方案，不暗中扩展。

## 2. 已核对的现状

源码目录均相对仓库根目录。

| 位置 | 当前事实 | 处理 |
| --- | --- | --- |
| `packages/contracts/src/steward/index.ts` | 一个 ProviderAdapter 同时有可选 complete 和 Agent 生命周期；ProviderRunInput 携带执行引用与执行点约束 | 保留主接口，只为移出硬编码增加实际必需的输入 |
| `packages/integrations/src/steward/pi-provider.ts` | 适配器内有长 STEWARD_PROMPT，包含文档组织、提醒、后台安排和具体模块使用策略；spawn 根据 execution 判断编码身份并选择 system prompt | 移除业务默认提示和按业务身份选择提示的职责 |
| `packages/integrations/src/steward/pi-launch.ts` | 根据 input.execution 决定 Chrona 工具、显式技能/扩展加载；附带 lane 文本 | 将资源与工具选择改为内核明确传入的运行约束，Pi 只转换和执行 |
| `packages/engine/src/modules/steward/tick.ts` | 另有一份 STEWARD_PROMPT；组装普通上下文、构建上下文及编码分流，负责 Provider 实际退出后的收尾 | 统一指令来源，继续保留领取、启动竞态和治理收尾 |
| `packages/engine/src/modules/steward/execution-context.ts` | 内核有 CODING_PROMPT，读取项目规则，核实授权、构造受治理输入并持久化事件 | 编码工作说明归 coding；身份、目录核验、边界约束和事件写入保留 |
| `packages/engine/src/modules/steward/external/coding/work-v2.ts`、`results.ts`、`workspaces.ts` | 工作依赖、placement 选择、结果处理和清理意图已有模块归属，执行通过 executions routed call | 保留并复用，不重建业务模型或第二个队列 |
| `packages/engine/src/modules/steward/system/provider.ts`、`module-model.ts` | complete 核实模块身份并预留预算；wake 将来源文本作为不可信数据入队 | 继续作为薄内核系统工具，不拆新应用 |
| `packages/engine/src/modules/steward/module-build-session.ts` | 构建指令、目标登记和构建治理位于现有模块管理流程 | 不迁入 Provider，不因名称含 build 就整体搬成新应用 |
| `packages/integrations/src/executor/daemon.ts` | 设备端同样调用 createPiProvider，使用 assignment.goal；当前与服务端编码提示组装存在差异 | 同步纳入改造与验收，不能只改服务器路径 |

现有 diff/源码捕获在内核可信执行路径中，与 Provider 退出证据、目录持有和文件安全校验关联；编码成果版本、比较、接受属于 coding。不能把可信文件捕获直接移给普通模块以求目录整齐。

## 3. 实施顺序

### 第一步：收窄 Provider 输入和实现

交付：Pi 适配器不再自带管家/编码业务说明，且不再通过 execution 的存在推断业务用途。

1. 在现有 ProviderRunInput 增加真正需要的 system 指令输入；所有可信调用点显式供给。Provider 不按 lane、模块名或 execution 选择业务提示。
2. 工具与显式资源加载使用内核决定的最小运行约束。具体字段依据当前 piArguments 消费点确定；不加入多个可任意组合的配置轴，不给模块暴露任意扩展路径或 native tool 名单。
3. 保留 execution 引用用于事件关联；保留预算前置守卫、脱敏、超时、注入竞态、会话恢复、取消与进程退出核实。这些不因“低级化”而删除。
4. Pi 命令行、版本探测、RPC 编解码、profile 与资源的物理加载留在 Pi 实现。内核传语义约束，不拼 Pi 专用命令。
5. 同时更新服务端 tick、设备 daemon、owner/admin 构建的实际调用点、fixtures 和测试。不能只让主要聊天路径编译通过。

验收：相同窄输入可以运行不同业务提示；适配器不生成业务任务策略；没有 execution 的普通运行不会因此丢工具，带 execution 的受限运行不会因此继承个人技能/扩展。

### 第二步：让模块持有业务说明，内核保留治理

交付：coding 对自己的执行目标和成果要求负责，内核不硬编码 coding 的工作协议。

1. coding 在现有 dispatch/goal 组装处形成编码工作说明、用户目标和已有依赖结果，继续通过现有 executions 请求提交。
2. 用户原始目标保留在 coding 原有工作记录中；发送给 Agent 的文本与用户目标不要混成权限来源。
3. 内核提供通用执行边界：只能使用核验过的目录和能力、不得把来源内容当授权、预算与截止时间由执行层落实。模块文本放在数据/任务输入中，不升级成可信 system 指令。
4. 项目规则的读取继续通过可信目录核验路径，服务端与设备端都读取实际选中的工作目录；规则是任务数据，不代替权限校验。
5. 不改变现有 work/run/attempt/session 身份及结果回调，保持不明结果不自动重跑、取消不伪装停止完成。

验收：服务器与设备执行都收到完整 coding 任务说明；内核和 Provider 不依赖 coding 名称选择业务策略；恶意任务文本不能修改 caller、目录、预算或工具权限。

### 第三步：清理普通管家策略的错误归属

交付：删除 Provider 中第二份 STEWARD_PROMPT，区分平台交互约定与应用业务内容。

1. 回复必须经会话通道、外部内容不构成授权、数据经 routed call 访问等平台约定，由现有内核会话上下文统一提供。
2. README 组织、打卡格式、提醒选择、特定应用的工作流程等，不机械搬到内核另一个长常量；从全局默认中移除，已有相关模块通过工具描述或现有 prompt 数据通道提供自己的说明。
3. 逐条给旧提示标注归属：平台约定、模块业务、重复/陈旧策略。只有会造成用户可见行为损失的具体条目才迁移到真实模块；不为保留每条提示新造模块或全局注册协议。
4. 构建的目标限制、提交次数、真实模型绑定、版本检查/激活仍保留在内核模块管理流程；不得当作普通 prompt 策略移给应用。
5. complete/wake 的校验、预算预留和失败语义保留，不把它们包装成新的独立模块。

验收：删除/停用某个可选业务模块后，通用 Provider 不仍然指令 Agent 必须调用它；构建结果仍以实际检查/激活记录为准。

### 第四步：验证边界并收口文档

- 更新 `docs/zh/provider-runtime.md` 与当前架构涉及 Provider/执行职责的段落，只修本轮涉及内容。
- 引用 M1–M3 已完成的实现证据，同时区分旧文档中的历史状态；不把本次重构写成已部署或真实模型已验收。
- 删除被取代的提示和分支，不保留旧/新模式切换开关。
- 本轮不提取多 placement/结果比较共用模块；当前核查没有证据证明存在第二个真实使用方。

## 4. 变更范围

首批允许修改的主要位置：

- `packages/contracts/src/steward/index.ts`：运行输入，保持现有单一适配器。
- `packages/integrations/src/steward/pi-provider.ts`、`pi-launch.ts`：移除业务解释、执行显式约束。
- `packages/engine/src/modules/steward/tick.ts`、`execution-context.ts`：可信输入组装和治理接线。
- `packages/integrations/src/executor/daemon.ts`：设备端对称接线。
- `packages/engine/src/modules/steward/external/coding/work-v2.ts` 及其现有目标组装 helper：模块自己的工作说明。
- 上述消费者、fixture、生成契约和对应测试；生成文件只经现有生成脚本更新。

条件触及：owner/admin 构建入口和 prompt 相关测试，只有实际消费新输入或旧提示时修改。版本检查、审批与模块激活算法不在重构目标内。

## 5. 验证计划

使用现有 Orca 专用终端执行检查，记录退出状态并关闭已结束终端；不启动额外协调 worker。

首先补充/调整能验证职责与行为的目标测试：

- PiProvider：不同调用方显式指令、受限工具和资源不泄漏、模型精确绑定、流事件、注入、取消及真实退出。
- execution-context：caller/attempt 绑定、来源文本不授予权限、项目规则/目标完整、丢事件与停止未知状态。
- coding：goal 与依赖结果正常传递，重复请求不重复启动，worktree/placement/结果接受行为不变。
- module-model：未声明/未配置拒绝、并发预算预留、超时与模型输出仍为不可信数据。
- module-build-session：授权目标/模型/提交上限与检查结果不被 prompt 重构绕过。
- 设备执行：服务器与设备在新运行输入上的一致性，丢 ACK/撤权/重启/停止确认保持原义。
- API：继续经 executions/模块路由访问；raw_rpc、direct_bash 等关闭项不因重构开放。

执行顺序：受影响目标测试 → typecheck/lint/check:boundaries → 现有完整 Bun/API 检查。涉及契约生成时运行现有生成与一致性检查；未改变 UI 时不重跑浏览器截图。若触及实际设备发布入口，追加既有 compiled executor smoke，不以 fake Pi 代替真实模型验收。

真实模型冒烟是独立验证项：受控聊天、模块构建、一次模块 complete、一次 coding 执行；记录实际后端和用量，不读取或复制个人认证、不擅自生产部署。是否使用真实账户与产生费用按届时明确授权执行。

## 6. 完成标准

1. Provider 不再包含管家文档/提醒流程或编码工作协议，也不按业务身份推导指令。
2. 内核仍掌握身份、权限、预算、取消、持久化、问答与恢复；可信文件捕获和资源占用不丢失。
3. coding 保有业务工作与成果语义；构建仍受统一生命周期约束。
4. 单次模型调用保持轻量；所有后端仍实现同一个现有适配器。
5. 服务端与设备端调用点共同验证，没有只改一侧的隐式降级。
6. 不引入 herdr、第二个执行循环、第二个队列、新共享业务模块或迁移。

实施风险集中在工具/资源加载与停止证明的接线；每一步应能独立运行现有目标测试。计划不是授权跳过安全边界，也不等同于已验证所有历史调用点。

## 7. 本轮实现与提示归属

- `ProviderRunInput` 必须显式提供 `systemPrompt` 和 `resources: configured | minimal`。Pi 不再按 lane/execution 决定业务提示或资源；execution 继续用于详细事件关联，`executionBudget` 独立执行。
- 通用执行边界由 domain 常量供服务端与设备端使用；项目规则、原始目标及 coding 说明作为任务数据。coding 原始记录不被派发文本覆盖。
- 普通会话和 owner 构建显式使用 configured；编码执行显式使用 minimal。没有新增配置开关、执行循环或模块直连 Provider。

| 旧全局提示内容 | 本轮归属或处理 |
| --- | --- |
| 回复通道、后台回复投递、外部动作/宿主目录审批、私有数据边界 | 内核 `run-instructions.ts` 保留平台约定 |
| 构建/提交/检查/激活与跨模块变更 | 现有模块管理流程及其工具；内核保留简短引导，并修正可定制 builtin 的旧限制 |
| 编码报告、实际检查、问题和成果引用 | coding `instructions.ts`，经原有 goal 派发 |
| README、按日拆文件、打卡组织和 UI 偏好 | 删除全局强制组织策略；实际操作遵循已安装模块接口，不把整份提示迁到内核 |
| 自动安排提醒、先回复再后台排队、固定通知频率 | 删除硬编码业务选择；保留调度成功才可声称已安排、通知应克制等通用约定 |
| 邮件/文件/项目规则不能授予权限、未知副作用不盲重放 | 内核通用执行与会话边界，执行点守卫保留 |

coding 离线 Git 种子沿既有父提交更新为本地候选 `453ae363402e5585f556c23b19ddd91b3c09ad5c`；`repository: null` 明确未发布。其余 10 个模块固定提交未变，11 个候选源码/种子一致性均已验证。不执行远端推送、发布或生产切换。

## 8. 本地验证记录

使用 Bun 1.4.2、独立临时 SQLite 与仓库隔离测试入口。typecheck、lint ratchet、包边界检查通过；lint 留有既有 doctor 警告，包边界有既有 22 条 warning、0 error。

- 完整保留的 Bun 测试：1404 pass、7 skip、0 fail。
- 独立设备集成测试：30 pass、0 fail；覆盖真实 fake-Pi 子进程、工具预算、任务/规则与系统边界，以及原有 ACK/重启/停止和清理竞态。
- API 测试：64 pass、3 skip、0 fail。
- coding 作者测试通过真实 SDK sandbox 运行模块声明的测试入口，覆盖原目标保留、派发说明和依赖结果。

完整日志：`/tmp/chrona-provider-{typecheck,lint,boundaries,device,bun,api}-final.log`；种子候选与一致性记录：`/tmp/chrona-provider-seeds-final.log`。最初直接测试使用环境旧数据库触发 migration checksum 错误；改用独立测试数据库后通过，未修改迁移校验或生产数据库。

真实模型聊天/构建/complete/coding 冒烟未执行；以上 fake-Pi/SDK 测试不代表真实账户行为。未构建新的发行二进制，未提交或推送主仓库。

## 9. 内核最小化：应用策略下放

- 自动记忆：`memory-local/conversation.ts` 持有提示、召回查询/条数、保留周期和转录拼接。`contributes.memory.context/afterRun` 绑定应用自己声明的 kernel-visible 工具；内核核实选中模块 ID 与工具契约、有界脱敏快照、入口身份、回执与水位。关闭自动写入不调用 retain；关闭自动检索不传对话正文。脱敏在截断之前执行，快照正文总量上限 20,000 字符。未声明两个可选工具的提供者只保留手动 API，不获得自动快照。
- Today：`builtin/web/today.ts` 经现有 governed reads 组合页面；七天范围、排序、通知与问题摘要归 web。`chat.today` 兼容转发至 `web.today`，保留 deadline/run 治理信息；web 自身不调用该兼容入口。内核仅补充 `chat.runtime` 事实读取、入口会话过滤及静态轮询排除；独立 health 不依赖 web 可用。
- 审批通知：内核幂等入队审批事实至 kernel-only `notify.approval`；notify 持有摘要、文案与下一步提示。真实 SDK/routing 测试确认重复扫描只产生一次投递、普通模块无法伪造审批通知、展示不改变审批状态。
- 未创建事件/策略框架或新业务队列，未改 schema、迁移、权限模型、设备协议；builtin 仍保持原有可信发行身份。该阶段只覆盖三项下放；后续全范围职责审查和实现见第 10 节。

本轮完整 Bun 回归：1412 pass、7 skip、0 fail；typecheck、lint ratchet 和 check:boundaries 通过，保留既有 doctor/边界 warnings。API 首次完整运行发现 listen 测试仍期待旧的 `chat.today` 调用，已更新为模块实际读取的 `chat.runtime`；修正后的精确单文件复测 2 pass、2 skip、0 fail，与未改文件的完整 API 结果合并为 64 pass、3 skip、0 fail（未重复跑其余已通过文件）。日志：`/tmp/chrona-minimal-final-{bun,api,typecheck,lint}.log`、`/tmp/chrona-minimal-closeout-{api,seeds,lint}.log`。最后补齐无标题 wake 不显示指令、notify 不可用仍展示其余 overview 的原有行为；相关三文件复测 7 pass、0 fail，typecheck/lint 复验通过，见 `/tmp/chrona-minimal-last-{targeted,typecheck,lint}.log`；最终发行暂存校验见 `/tmp/chrona-minimal-seeds-final.log`。

发行暂存包含 `buildExecutionContracts`，11 个模块源码/种子一致性通过。本轮只新增 web `802e84fa753af585f7247d5692059aa630c3ea30`、notify `73899fd04ff5691aa66f2299824caef981e09b03`、memory-local `2f9e91afaaf1fdde2842d40a8b082c0f0f86f639` 本地候选；coding 保留上一轮 `453ae363402e5585f556c23b19ddd91b3c09ad5c`，editor 与其余模块提交不变。暂存时遗漏生成步骤产生的 coding/editor 候选已撤回，未发布。

没有 UI 布局修改；该阶段未执行浏览器多尺寸检查、真实模型四路径冒烟或发行二进制构建。生产仍暂停，主仓库未提交、未推送。

## 10. 全范围内核/系统模块最小化收尾

继续审查顶层运行时、全部 `system/` 工具、Provider 与 SDK/发行接线；没有在第 9 节的三项下放后结束。完整职责、不可外置理由、应用所有者与兼容影响记录于 [内核职责审查](kernel-responsibility-audit.md)。

新增下放：

- Pi transcript 解析回适配器；内核只保留作用域、数量、脱敏和输出限长。没有 transcript 的 Provider 仍能运行。
- 活动文案/归类/扫描策略归 notify，增加有界脱敏的 `activity.records`；审批与运行、日程、模块生命周期和旧反思退役通知均由 notify 呈现。
- 会话标题、上下文轮换和管家工作指导归 Web/MCP/QQ。入口提交观测和意图，内核复核活动时间、身份与忙闲状态，不自行决定轮换。
- Web 负责构建会话七天空闲回收，MCP 负责自身一天空闲回收；`chat.end-idle` 保留事务锁、跨 workspace、旧观测、排队/运行及停止未确认保护。入口停用不回收，恢复后按每小时周期处理；不删除内容。
- SDK 编写/测试/提交契约随 SDK 资源交付；最小实现、库选择、模型成本和视觉检查偏好回到入口指导。构建目标、工具授权、预算、检查与真实启用状态仍由内核统一实施。完成回流只传有界的不可信完成事实，不在内核规定业务下一步，也不按 Web/QQ/MCP 名单决定入口资格。
- 保留的故障熔断、有限恢复、生命周期和完成回流均列出资源/授权/投递理由；旧反思退役仅保留一次性历史升级保护，不恢复主动反思实现。

验证：

- 完整 Bun 回归 **1438 pass、7 skip、0 fail**：`/tmp/chrona-minimal-verified-bun.log`。
- 完整 API **64 pass、3 skip、0 fail**：`/tmp/chrona-minimal-closure-api.log`。首次全量发现活动投影测试缺少 notify、工具目录和提示断言仍期待旧行为，已修正；另有 API 命中了更新前的种子，重建种子后完整重跑通过。
- 相关职责投影、工具目录、提示边界、退役迁移与四个作者模块复测 **47 pass、0 fail**：`/tmp/chrona-minimal-closure-affected.log`。
- transcript 与发行构建最后精确文件复测 **6 pass、0 fail**；typecheck、lint ratchet、依赖边界通过。清理后的最终复核日志 `/tmp/chrona-minimal-accepted-{targeted,typecheck,lint,boundaries}.log`。既有 doctor / dependency warning 保留。
- **11 个**模块发行暂存源码与离线 Git 种子一致，包含生成后的 coding/editor 执行契约：`/tmp/chrona-minimal-closure-seeds.log`。Web `428b634cd09e76d80e0d6b53043bcd8c7511dbe2`、MCP `f701d4216cafa115297819fde8b38a1464165a92`、notify `c0e0b6a2600bbf6001a52d5d78dc0beaa39f1689`、QQ `d4a2d4b26d23eef3f0802767c47860b147892acc`；其余七个种子复用既有提交。候选均未发布。
- Linux x64 二进制已在 `/tmp/chrona-minimal-release/chrona-linux-x64/chrona` 编译；portable ELF、发行资源、两份 SDK 契约、独立模块类型检查和种子一致性通过：`/tmp/chrona-minimal-verified-release.log`。此项使用 `smokeRelease(..., { runtime: false })`，没有服务启动冒烟；不声称完整运行时发行验收。

本轮没有修改页面布局，未做多尺寸浏览器验证；真实模型四路径冒烟未执行。生产仍暂停，没有主仓库提交、推送或候选发布。
