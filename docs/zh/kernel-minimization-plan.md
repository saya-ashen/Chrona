# 内核最小保留实施方案

状态：2026-11-08 已开始实施。阶段 1 代码清理及用户批准补修的既有门禁、阶段 2 反向调用解耦均已通过全量 `typecheck / lint / test:bun / test:api`，阶段 2 另通过三种视口真实浏览器检查；阶段 3 内容归属重构已完成开发检查；阶段 4–7 继续实施。详见[阶段 1 开发检查记录](kernel-minimization-stage1-validation.md)、[阶段 2 开发检查记录](kernel-minimization-stage2-validation.md)、[阶段 3 开发检查记录](kernel-minimization-stage3-validation.md)。用户已确认旧会话与附件导出备份后删除、通知先由单个选定应用消费、MCP 允许删除；技术边界见各阶段及 §5。用户随后明确只做本地开发与本地部署，不要求 chino 数据副本演练；后续验收使用本地隔离数据，不访问或部署 chino，不直接删除本地现有用户数据。本文是交给实施 Agent 的工作说明，不表示改动已完成，也不替代既有用户数据实际删除的授权。旧的阶段性审查见 [内核与系统模块职责审查](kernel-responsibility-audit.md)；两者冲突时以本文为准，但每一步落地前都必须对照源码复核。

## 1. 目标与判定标准

目标：让随发行冻结的部分（内核接口、运行能力、必须预装的应用）尽量少，**用户以后尽量少地需要更新这些东西**。

任何一项留在内核，只能有一个理由：**普通模块经路由调用无法安全做到**（真实调用方身份、隔离、事务、凭据、生命周期、停止证据）。以下都**不是**保留理由：

- “某个模块在用它”——调用方可以改为调用拥有该数据的应用。
- “内核在调用它”——内核调用应用是需要拆掉的耦合，不是预装依据。
- “很通用”——见 `AGENTS.md`：复用本身不构成提升层级的理由。

第二条判断：保留项里**会经常变**的部分（模型/Provider、展示文案、业务策略、第三方服务清单、文件名约定）也要拆出去，否则冻结区仍会频繁更新。

## 2. 目标终态

### 2.1 内核接口（`steward/system/*`）

| 接口 | 终态 | 动作 |
|---|---|---|
| `modules` | 保留，收窄 | 先提供缺失的最小设置读取、内核接口及本地能力元数据，再删除 `overview`、`system` 的页面聚合，由 web 自行组合。其余生命周期、发现、`contributions`、健康报告工具保留 |
| `approvals` | 保留，扩充 | 接收 `settings.grants/revoke-grant`。修正描述里过时的“先分级并经 AI 复核”（架构文档 §11：审批不分级） |
| `secrets` | 保留，改造 | Google/Microsoft 端点改为模块 manifest 声明（仅 HTTPS）；内核保留凭据与已批准 OAuth 定义的绑定、PKCE、state、refresh 机制，端点改变不能自动复用旧授权 |
| `schedules` | 保留，迁移 wake 编排 | 保留受治理的定时投递；旧 wake 会话生产者迁给所属应用，见阶段 5 |
| `projects` | 保留，收窄 | 保留 `list/register`；`default` 的选择策略移给 coding。先明确默认目录创建与宿主授权的最小安全路径，保留首次打开即可发送的体验，不把任意宿主路径读写权交给 coding |
| `activity` | 保留，收窄 | 保留 `runtime/runs/records`；删除 `list` 及其转发 `notify.activity` 的代码 |
| `settings` | 收窄为预算 | 只留模型档位、额度、预算等治理设置。`notifications`→notify，`builds`→随构建治理留在 modules 或迁出（见 §4 决策点 B），`memory`/`sessions`→入口应用自己的设置，`preferences/forget`→记忆应用，`grants`→approvals，`theme`→web |
| `content` | 删除 | 见阶段 3 |
| `memory` | 删除 | 见阶段 4 |
| `history` | 删除 | 见阶段 5 |
| `system/chat.ts`、`provider.ts`、`executions.ts` | 删除 | 已不在注册表，仅测试引用 |

### 2.2 运行能力（`steward/local-*`，visibility 均为 `kernel`）

| 能力 | 终态 |
|---|---|
| `runtime-callback` | 保留 |
| `workspace-local` | 保留 `prepare/release/cleanup`；`rules`（`local-workspace.ts:24` 写死读 `AGENTS.md`）移给 coding，由 coding 决定读哪些规则文件并作为任务输入传入；`capture/result` 见决策点 C |
| `content-local` | 删除 `mount/put/read`（对话附件遗留）；`reference` 退化为运行准入内部检查；`capture` 并入 `workspace-local` |
| 进程内 `agent`（`local-provider.ts` 的 `registerProviderModule` / `registerInjectedProvider`） | 移入测试 fixture，不进发行代码 |

### 2.3 内置应用

| 应用 | 终态 |
|---|---|
| `agent` | **唯一必须预装**（没有 Provider 就无法构建任何应用）。保持现有不可动态替换规则，只走可信发行更新；保留执行控制及现行应用所需的 `context/run/get/stream/write/respond/interrupt` 等窄原语，不将“窄面”误解为只剩五个宿主控制工具 |
| `web` | 默认预装、可受检定制，但内核不依赖它：删除 `today.ts` 对 `web.today` 的调用和 `chat.today` 兼容入口 |
| `notify` | 默认预装、可受检定制，但内核不依赖它：内核持久保存有限的审批/生命周期/问题及撤回事实，先由一个选定的通知应用消费，不做多消费者广播；明确确认消费和失败恢复语义，没有通知应用时审批仍可经 `approvals.list` 在任何入口处理 |
| `mcp`、`files`、`events` | 迁到 `steward/external/`，成为官方可选外置应用（可删除、可重装） |

### 2.4 内核其他入口

- `apps/server/src/rescue.ts:41` 仍调用内核旧对话 `chat.handleMessage`。终态：rescue 只保留审批列表/决定，加暂停与回滚应用；对话能力删除，深度修复走宿主 `chrona admin`。删除后内核 chat 服务（`steward/chat.ts` 及相关）应能整体移除。

## 3. 必须遵守的约束

- 读 `AGENTS.md`、`docs/zh/architecture.md`、`docs/zh/steward-goals.md`。
- **删除遗留**：每移除或替换一个机制，grep 代码、测试、文档、提示词、manifest、契约字段，同一提交内删干净；不留兼容层。只有已存数据仍需解析时才保留，并加一行注释说明。
- **先备份再删除**：用户已确认旧会话与旧附件一次性导出备份后从活动存储完全删除，不迁入入口应用，不保留在线兼容读路径。按用户最新范围，在本地隔离数据上演练导出、校验与删除，不要求 chino 数据副本；既有用户数据的实际删除仍须单独授权。该决定不包括记忆应用数据、其他应用私有数据、现行 Agent/Run 上下文及执行证据，不可扩大删除范围。
- 不新增特权应用、通用策略钩子、事件注册中心或第二套队列。
- Agent 身份与 Agent 更新规则不变。
- 改变 2026-11-08 已确认的“web/mcp/files/notify/events 为内置”决策（mcp/files/events 外迁）需要同步修改 `AGENTS.md` 与 `docs/zh/architecture.md` §2。
- 提交：在 `platform-v2` 分支上按阶段提交；可以 push，**不要 push 到 main**；不部署，部署由用户决定。
- 重型检查串行执行并加内存上限，例如：
  `systemd-run --user --scope --quiet -p MemoryMax=10G -p MemorySwapMax=1G -p CPUQuota=300% nice -n 15 bun run lint`
  （tsc/typecheck 需加 `-E NODE_OPTIONS=--max-old-space-size=6144`）。先跑定向 `bun test <paths>`，全量 `typecheck / lint / test:bun / test:api` 每阶段末跑一次。
- 测试只用临时数据库，不调用真实模型或 QQ。

## 4. 实施阶段

每阶段独立提交，先做纯删除，再做有迁移的。用户于实施中要求加快并允许子代理/worktree 并行：无共享写入和前置依赖的子项可提前并行；共享契约由协调者修改，按依赖整合后集中执行全量门禁，同一已验证快照不重复跑重型检查。未完成或未验证的并行子项不得记为已验收。

### 阶段 1：删除死代码（无行为变化）

1. 删除 `system/chat.ts`、`system/provider.ts`、`system/executions.ts` 及只服务它们的测试（`system-chat.bun.test.ts`、`system/executions.bun.test.ts`，以及 `module-model`、`module-tools`、`module-executor`、`execution-v2-tools`、`builtin/web/test.ts`、`builtin/web/lifecycle.bun.test.ts` 中对它们的引用——改为测试现行接口或删除该用例）。
2. 删除空目录 `builtin/{qq,remind,mind,memory-local}`。
3. 进程内 `agent` 注册移入测试 fixture；`apps/server/src/steward-runtime.ts` 的 `registerInjectedProvider` 只在测试注入路径存在。`local-provider.ts` 中现行 Agent 仍使用的 `retainProviderCallbacks/registerProviderCallbacks` 必须保留，不能整文件删除。
4. 修正 `approvals` 描述文字。

验收：注册表输出（`modules.system`）不变；全量检查通过。

### 阶段 2：拆掉内核对应用的反向调用

1. `steward/today.ts` 删除对 `web.today` 的调用；删除 `chat.today` 兼容入口；所有调用方改为直接调用 `web.today`。
2. `steward/activity.ts:53` 删除转发 `notify.activity`；删除 `activity.list` 工具；web/mcp 中的 `activity.list` 调用改为 `notify.activity` 或 `activity.records`。
3. `notify-user.ts`、审批和问题生命周期中对 `notify.approval/lifecycle/send/withdraw` 的调用：改为内核在状态事务中写入有限事实，由一个选定的通知应用经路由消费。复用现有存储/投递基础，不建第二套投递队列；但现有 `ModuleInvocation` 绑定目标与契约且仅原调用方可读，不可直接当作事实日志。实施前明确事实保留、消费确认、停用/失败后恢复和消费者切换语义，避免无条件重放已确认事实；只开放限定事实投影，不开放通用调用参数或输出。覆盖直接 `tx.approval.create` 的路径及既有未决审批；撤回使用同一问题键，并保持撤回先到也能抑制晚到通知的行为。
4. 先补齐设置声明/有效值读取，以及内核接口、本地能力的最小可信元数据，再删除 `modules.overview`、`modules.system` 的页面聚合，web 页面自行组合。现有 `list/permissions/diagnostics` 并不能完整替代。

验收：停用 web 与 notify 后，内核启动、审批创建与 rescue 审批处理仍正常（API 测试）；另覆盖通知应用恢复后的未消费事实处理、审批各创建路径、重复消费和问题撤回乱序，不因恢复重复提醒已完成的问题。

### 阶段 3：删除 `content`

1. 对话附件归入口应用：web、qq（以及仍上传附件的 mcp）把附件存进自己的内容区（manifest `content: true`），自行读取；删除 `content.read` 调用（`builtin/web/index.ts:204`、`external/qq/conversations.ts:55` 等）。
2. 跨应用读取文件改为调用归属应用自己的工具（例如 `image-generation` 已有读取工具）；文件归属方决定可见性。
3. 区分三条路径：Agent 输入准入保持发起方内容归属检查；跨应用读取经归属应用工具；运行输出附件交付由接收应用持有。`tools.ts` 的 `replyFile` 属于输出交付，不是输入准入，不能套用归属检查而取消跨应用成果交付。
4. 先改造构建参考文件、后台回复与运行输出的生产者，移除 `runFile/readChatFile/storeChatFile` 对共享附件存储的依赖；仅搬 `capture` 仍会生成 `chat/` 引用。完成归属替换后，删除 `system/content.ts`、`content-local` 的 `mount/put/read`，把仍必要的运行捕获并入 `workspace-local`，删除 `contentRefSchema` 的 `chat/` 前缀。
5. 旧附件只导出备份，不复制到入口应用、不改写旧消息为新在线引用；校验备份包含引用清单和实际文件后，从活动存储删除旧附件及对应旧引用。与阶段 5 的旧会话清理按同一清单实施，在本地隔离数据演练；不再要求 chino 数据副本，不得影响现行上下文与执行证据。

### 阶段 4：删除 `memory`

1. 先调整受限发现契约与记忆工具受众，再让入口应用（web/qq/mcp）发现记忆应用并直接调用。当前 `modules.contributions` 要求 `section === caller.module`，`memory-local` 工具仅允许 kernel，不能直接照搬 `section: "memory"` 的调用；不得公开全部 contribution 或借 kernel 身份绕过真实调用方。自动召回/保存的时机归入口或记忆应用，并承接关闭、脱敏和保存水位。
2. 删除 `steward/memory.ts`（含 `autoRetain`、`memoryInput`）及 `settings.memory`；`memory-local` 的 `contributes.memory` 契约按需简化。
3. `settings.preferences/forget` 移给记忆应用。

### 阶段 5：删除 `history` 与内核 chat

1. 按真实路由调用查清 `history.*` 消费者，并区分旧会话与仍产生的 build/wake/rescue 会话。coding 文件中的局部 `history` 缓存不是旧路由消费者，不能按文本命中删除现行 Agent events/snapshot 能力。
2. build 会话读取改由 `modules` 提供有界只读构建事实；构建状态中文文案移到 web。保留目标绑定、授权和唯一 Run 队列；替换构建参考文件与 UI preferences 的旧存储依赖后，才能删除相关共享服务。
3. wake 单列迁移：由所属应用接收定时事件、调用 Agent、持有上下文和结果、承接审批续跑关联。迁移现有 wake 定时器后停止旧生产者；不把废除定时功能当作删除历史数据。
4. 旧会话与附件一次性导出备份，校验引用完整性及备份可读取后，从活动存储完全删除；不迁入入口应用，不保留旧 history/chat 兼容读路径。真实数据操作须另获授权。
5. rescue 去掉对话（§2.4），删除旧业务 chat 服务。删除范围明确排除现行 Agent `source: "module"` 上下文身份、Provider continuation、Run/执行日志与不可变成果证据，不按 `sessions` 表或目录名一刀切。

### 阶段 6：收窄 `settings`、`projects`、`workspace-local`，改造 OAuth

1. 按 §2.1 把各设置项迁到所属应用（应用设置已有 `modules.settings-set` 机制，优先复用）。
2. `projects.default` 的选择策略移给 coding；现有 `register` 只登记已有目录，须先解决默认目录的受控创建和授权，再删除旧 default 原语，不取消默认空间体验。
3. 规则文件选择策略移给 coding；读取仍绑定真实调用方及已授权项目，不能允许任意宿主路径访问。处理排队到执行之间的规则更新，保留必要的执行时校验。
4. OAuth 端点及提供方参数改为 manifest 声明；HTTPS 校验之外，凭据绑定已批准的定义身份，更换接收端点必须确认，不能因凭据名称相同自动启用。发起授权时冻结定义，回调校验绑定，缓存和并发刷新键包含定义身份。迁移 mail 的 Google 配置，验证旧 token 刷新、新授权、更新/回滚期间的回调；保留 Google 离线授权参数与 Microsoft `offline_access`。

### 阶段 7：mcp/files/events 外迁

1. 目录移到 `steward/external/`，按官方外置应用的安装与种子流程处理；保留名称规则相应调整。
2. 已部署实例上这三个应用的数据目录和 active 定制需保持不变（迁移只改类别，不改 moduleId 与数据）。
3. MCP 明确允许删除；当前入口应用统一禁止删除的规则须作有限调整，保留审批、在途/未知调用及依赖检查，不能为了 MCP 一并放开所有入口的删除。删除前落实不依赖 Web/MCP 的宿主官方包安装恢复路径，并验证删除后重启不会被种子流程自动装回、显式重装可恢复访问；恢复命令的具体接口在实施前确定。
4. 同步更新 `AGENTS.md`、`docs/zh/architecture.md` §2、`builtin/README.md`。

## 5. 已确认决策与实施边界

以下三项由用户于 2026-11-08 明确确认，不重复申请同一产品决策；具体真实数据操作与部署仍单独授权：

- **A. 旧数据处置（已确认）**：旧会话与旧附件只导出备份，随后从活动存储完全删除；不迁入入口应用长期保留。范围不扩展到其他应用私有数据和现行运行上下文。
- **D. MCP 外迁（已确认）**：MCP 允许删除、显式重装。必须提供独立于 Web/MCP 的宿主恢复路径；尚待确定具体命令，不可把现有入口删除禁令忽略不计。
- **E. 通知消费（已确认）**：先支持一个选定的通知应用，不做多消费者广播。事实存储、消费确认及恢复的具体契约须在阶段 2 落地前明确，不把定向调用表直接当日志。

源码审查确定的技术边界：

- **B. 构建会话编排**：目标模块绑定、授权和唯一 Run 队列留在内核。提示词与队列展示可按职责拆出，但必须先替换参考文件及 UI preferences 等依赖；不要新建可替任意应用提交代码的特权构建应用。若发现必须改变授权模型，先报告。
- **C. `workspace-local.capture/result`**：capture 不是停止证据，但提供运行结果的时序与不可变性保证。保留可信执行宿主在真实退出后、释放目录前生成有界快照的原语；coding 负责成果组织与人工验收，不能事后重读已释放目录来替代。

## 6. 完成标准

- §2 表中每一项的终态都已落地，或在本文中标注了被用户否决的决策点。
- `grep` 不再有已删除接口名（`content.read`、`history.`、`memory.recall` 等）的生产引用。
- 停用 web 与 notify 后，内核启动、审批、定时投递和 rescue 审批仍工作（自动化测试）。
- 全量 `typecheck / lint / test:bun / test:api` 通过；页面改动在真实浏览器检查过。
- 旧会话与附件的导出、备份完整性检查和删除在本地隔离数据演练通过；不要求 chino 数据副本，现行上下文、其他应用数据及执行证据不受影响，并记录到 [运维说明](operations.md)。
- 单个选定通知应用的停用/恢复、消费确认及撤回乱序行为通过；MCP 删除与独立宿主恢复路径通过，不被启动种子自动装回。
- `docs/zh/architecture.md`、`AGENTS.md` 与代码一致；本文状态改为“已完成”并列出各阶段提交。
