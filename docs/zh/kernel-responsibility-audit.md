# 内核与系统模块职责审查

审查范围：`packages/engine/src/modules/steward` 顶层运行时代码、`system/`，以及 Provider 接入和模块交付边界。工作分支 `platform-v2`；源码改动未提交，生产仍暂停。自动验证记录见 [实施计划](provider-kernel-module-plan.md)。

## 完成标准

最小化按职责和权限判定，不以目录大小、删行数或把函数换个文件名判定。每项业务策略有应用所有者；每项保留职责有不能交给应用的具体约束。应用可以调整目标、标题、上下文轮换、通知、记忆策略和工作指导，无需改 Provider 或运行队列。内核仍统一执行身份、授权、预算、期限、取消、审计、数据安全及真实停止确认。

不为迁出少量逻辑引入新的特权应用、通用策略钩子、事件注册中心或第二套队列。SDK 协议文档属于接入契约，不因存放于外层就取得权限。内置应用的不可动态替换身份不变。

## 已迁出的职责

| 职责 | 所有者 | 内核剩余边界 |
| --- | --- | --- |
| 管家人格、语言、业务工作方式、构建质量策略、完成后的下一步选择 | `builtin/web/conversation.ts`、`builtin/mcp/conversation.ts`、`external/qq/conversation.ts` | 接收有长度上限的不可信指导；不能修改授权或受信任执行边界 |
| 初始会话标题、按空闲时间和 token 数轮换 | 同上三个入口 | `chat.conversation-state` 提供事实；条件轮换复核会话、活动时间和忙闲状态 |
| 构建历史一周、MCP 一天空闲回收 | Web / MCP 自己的 `endIdleConversations` | `chat.end-idle` 验证观测未过期、workspace、活动状态，无排队/运行任务或未确认停止的 execution；事务内关闭 |
| 自动记忆的查询、提示、窗口、保留节奏、记录构造 | 选中的 `external/memory-local/conversation.ts` | 配置、贡献身份、脱敏有界快照、输出校验、成功回执与 watermark |
| Today 的时间跨度、排序、问题与通知聚合 | `builtin/web/today.ts` | `chat.today` 受治理转发；`chat.runtime` 独立提供运行事实 |
| 活动文案、事件分组、模块筛选与扫描策略 | `builtin/notify/activity.ts` | `activity.records` 只返回 workspace 内有界、白名单、脱敏的审计事实；旧接口转发 |
| 审批和生命周期通知的标题、正文、级别 | `builtin/notify/approval.ts`、`lifecycle.ts` | 与状态事务一起幂等排队事实；kernel-only 来源不可被普通应用伪造 |
| Pi JSONL 遍历、解析、消息类型归一化 | `packages/integrations/src/steward/pi-transcript.ts` | 核验会话访问、路径作用域、数量上限，脱敏先于截断；没有 transcript 的适配器返回空历史 |
| 编码任务目标、成果要求、工作分解与比较 | `external/coding` | 执行身份、目录、预算、Q&A、事件、成果安全捕获与停止证据 |
| SDK 模块编写、离线测试和多模块提交协议说明 | `module-sdk/build-contract.md`、`group-build-contract.md` | 只选择已随发行交付的 SDK 契约；动态目标、可用工具、模型档位和预算仍由真实治理状态决定 |

## 保留职责及必要性

| 文件组 | 保留职责 | 必须集中治理的原因 |
| --- | --- | --- |
| `module-calls`, `module-tools`, `module-contracts`, `module-capabilities`, `module-reference`, `module-channel`, `module-effects`, `system-modules`, `system-outputs` | 调用路由、真实 caller、visibility、参数/结果契约、目标身份固定、异步回执和未知结果处理 | 调用方不能自行宣称身份、变更受众或把未知结果改成可安全重放；必须在所有应用调用经过的边界执行 |
| `approvals`, `grants`, `secrets`, `secret-fields`, `oauth`, `root-guard` | 决策、授权规则、凭据保护、受信任恢复与根目录边界 | 被约束的应用不能成为自己的授权者或凭据泄露审查者 |
| `execution-*`, `executions`, `executor-*`, `provider-cancel`, `provider-start`, `provider-channel`, `provider-journal` | 执行身份、领取/容量、事件持久化、Q&A、取消、续租、设备回执、成果捕获 | 服务端与设备端必须共享同一撤销/容量/停止事实；回调和模型自报不能证明进程已退出 |
| `runs`, `module-model`, `build-queue`, `build-execution`, `owner-build`, `owner-build-run` | 队列、全局/会话互斥、预算、deadline、领取、结果提交、恢复上限、离线 owner 构建 | 应用停用、崩溃或结果丢失时约束仍必须生效；owner 单次授权不能被自动续跑扩大 |
| `module-proposal`, `module-build*`, `module-typecheck`, `module-probe`, `module-preview`, `module-continuity`, `module-output-impact` | 候选源码、依赖与离线检查、目标绑定、报告、提交次数 | 候选代码不能自行宣布检查通过、读取生产数据或跳过受影响调用方检查；工作质量偏好已移给入口 |
| `module-activation`, `module-group`, `module-migration`, `module-generation`, `module-remove*`, `module-status` | 原子切换、审批绑定、多模块一致性、数据副本、回滚/删除保护 | 将代码状态与数据库/文件状态分给普通应用会产生半启用和数据丢失；旧审批必须绑定确切 hash、schema 与快照 |
| `module-supervisor`, `module-build-process`, `module-diagnostics`, `module-failure-policy`, `module-evolution` | 进程事实、激活世代、失败连续计数、熔断、有限回退、诊断证据 | 故障应用不能负责停止自己；三次连续故障、启动失败的一次回退是所有应用共同的安全/资源上限，不是业务修复策略；主动修复决定在 mind |
| `module-files`, `module-source`, `module-context`, `module-data`, `module-git`, `module-git-upstream`, `module-upstream`, `module-release`, `module-install`, `module-install-types`, `module-identity`, `module-builtin`, `module-initialization` | 源码与 hash、安全路径、数据快照、可信发行、安装回执、首次初始化 | 不能让待安装/运行模块自己证明其来源或覆盖内置可信身份；安装中断不能通过盲重试复制外部副作用 |
| `chat`, `chat-replies`, `sessions`, `conversation-state`, `content`, `store`, `audit` | 作用域持久化、消息幂等、入口归属、回复投递、附件安全、并发条件更新 | 入口提供内容和策略；中央机制防跨 workspace、旧观测覆盖、新旧会话混投和重复回复 |
| `schedules`, `schedule-delivery` | 定时器持久化、到期领取、投递状态、取消与未知结果 | 提醒内容、重复业务和何时新建定时器归应用；准时领取互斥和断线不盲重放必须由调度边界落实 |
| `memory`, `preferences`, `settings` | 选定提供者、用户配置、受控共享、偏好存储、资源使用事实 | 不决定业务记忆内容；配置和 watermark 不能由另一个应用越权修改。模型/构建预算必须在执行入口重核；通知预算由 notify 实施 |
| `runtime-health`, `activity`, `today`, `notify-user`, `module-overview`, `system-apps`, `apps` | 实际运行事实、生命周期控制面视图、模块设置校验、兼容转发与事务排队 | 导出必须脱敏、workspace 有界；模块无法伪造 activeHash、审批或 runtime 状态。业务聚合、措辞和通知投递不在这些文件决定 |
| `tick`, `service`, `tools`, `index`, `ports`, `errors`, `run-instructions` | 依赖接线、领取/启动/最终化顺序、受信任工具与执行边界 | 实际 Provider 退出、token 认证、事务提交与资源释放必须顺序一致；不存在按应用名称分派业务策略 |
| `reflection-retirement` | 一次性旧反思退役：停止历史运行、保留审计、保守转移旧偏好 | 有明确 `reflection-retired:<workspace>` 完成标记；不是日常反思/修复流程。保留历史升级证据与用户关闭意愿，不能因删旧逻辑重新开启自主行为；旧系统不再运行 |

`module-build-outcome` 保留可核验的启用/待审批/未启用结论：它把本会话的提交回执与实际 activeHash、审批关联，不能让 Agent 的“测试通过”替代产品状态。附加最终事实行用于防止把检查通过报告成已启用；它不选择业务下一步。构建完成的有限 origin wake 是已授权请求的完成投递，受活动会话、现有队列与连续唤醒上限保护；新的业务执行仍受原授权及工具治理。

系统工具 `chat / approvals / modules / schedules / provider / activity / content / secrets / settings / executions` 均是上述机制的受治理入口。`system/shared.ts` 只复用参数、caller 与 JSON 编码；不创建第二套授权。`provider.complete` 预留模块预算、`provider.wake` 将调用方输出标为不可信数据，不暴露适配器或 raw RPC。

## 行为变化与兼容边界

- 原来的每 tick 空闲回收改为入口进程每小时执行；入口停用期间不回收，恢复入口后按原阈值回收。会话保留，不删除消息、文件或构建产物。
- `ProviderAdapter.transcript` 可选；历史读取与 Provider 格式解耦，输出仍由内核脱敏。
- 旧 Today / activity 接口保留受治理转发；Web 或 notify 不可用时明确暴露不可用，内核不重建同一套业务呈现。
- 自动记忆扩展只对实现对应贡献的选定 provider 使用；旧 provider 手动读写仍可用。关闭自动召回不发送消息正文，关闭保留不调用 retain。
- 不改变 builtin 的发行权限，不开放 Provider/raw RPC，不改 schema 或设备协议，不部署或发布候选。
