# Chrona 当前架构

本文是当前仓库实现的阅读入口，不是新规格，也不表示这些代码已部署。产品意图见[设计目标](steward-goals.md)；执行与审批规则见[安全机制简化](security-simplification.md)，依赖与登记模式见[模块依赖方向](module-dependency-direction.md)，启动、配置和备份见[运维说明](operations.md)。[历史设计](history/README.md)仅供追溯，冲突时以本文和当前实现为准。

下文路径均相对仓库根目录；`steward/` 简指 `packages/engine/src/modules/steward/`。

## V1 本机统一与后续远端宿主

当前本机实现统一经 `module-calls.ts` 调用受信任能力：`agent` 负责 Provider 启动、等待、注入、取消、completion 与 transcript；`runtime-callback` 提供绑定 workspace 的短期事件／问答引用；`workspace-local` 负责项目准备、锁释放、规则、成果捕获与清理；`content-local` 负责附件与内容读取。物理适配器、文件 I/O 与进程内 handle 留在能力实现内部，消费端使用 JSON 契约及路由代理。内核保留唯一 Run 队列、授权、事务、预算、停止证据和启动持久化。

受信任能力使用发行代码与进程内投递，应用模块继续通过 SDK/socket 独立运行；双方复用身份、visibility、schema、调用记录与错误机制。本机能力只开放 kernel audience，不赋予普通应用进程／任意路径权限。平台快照和数据库保持内核内部实现。通用远端宿主留到后续版本，现有设备协议保持有效。实施范围、验证进度与限制见[统一模块协议实施方案](unified-module-runtime-plan.md)。

## 当前开发集成边界

[M1 P0 契约](chrona-workbench-p0-contract.md) 冻结当前开发接口。共享 origin/capabilities、身份断言、可信发行解析、持久安装回执/初始化 helper、catalog/install 接线与 fixtures 已落地；qq/remind/mind/memory-local 已整体搬至 `steward/external/`。内置仅 web/mcp/files/notify/events；内核与这五个名字无 DB 行也保留。服务器 `executions`、可选 `coding/editor`、固定设备执行器和有界并行已进入开发集成树。

A–E 已进入开发集成树：内置 registrar 从可信发行资源恢复并逐项诊断，不通过普通提案更新内置；动态构建、审批和领取事务均复核外置身份。官方安装适配器复用受检提案/构建，固定 request key 的持久回执在构建、审批、迁移恢复后刷新；首次初始化仅入队三个预装外置包，不等待作者测试，删除后不自动复活。未配置适配器仍明确 unavailable。M1 运行时集成、完整 Bun/API、typecheck/lint、三尺寸浏览器及 Linux x64 真实发行 smoke 已完成开发验证；协调者已签署 M1 开发验收，未部署。[P1 契约](chrona-workbench-p1-contract.md)与 [P2 固定设备契约](chrona-workbench-p2-contract.md)已冻结并实现；[M2](chrona-workbench-m2-acceptance.md)、[M3](chrona-workbench-m3-acceptance.md)均已完成开发集成签收，包含真实 Hono/SDK/SQLite、受控 fake Pi、Neovim、独立工作树与设备协议恢复证据。真实模型、个人设备安装、生产部署和公开发行不在该验收范围。历史冻结树与逐项证据保留于各阶段记录，接线细节见[共享接线记录](chrona-workbench-m1-shared-integration.md)。

## 1. 用途与信任模型

Chrona 是单一 owner 的个人工具：用户通过聊天或应用工具办事，Provider 处理需求，需要持久能力时构建或修改应用。默认执行模式为 `trusted-local`：Provider 与应用在本机受信环境运行，manifest、路由和审批用于接口约束、防误操作与留痕，不是抵御同一 OS 用户下恶意代码的隔离边界。显式选择 `required-isolation` 时，bubblewrap 不可用即失败；目前需要宿主依赖安装的候选也被拒绝，不静默降级。

代码：`apps/server/src/steward-runtime.ts`、`packages/integrations/src/steward/script-sandbox.ts`、`packages/integrations/src/steward/pi-launch.ts`。细节：[安全机制简化](security-simplification.md)、[运维说明](operations.md#脚本限制)。

## 2. 内核、系统模块、内置模块与自定义应用

功能归属优先级：**普通模块 → 预装模块 → 内核模块（system）→ 内核本身**。预装是交付方式，不代表更高权限。内核模块同样必须最小，只提供带身份、校验与治理的原语；只有无法通过这些原语安全实现的信任根、路由和生命周期机制进入内核。业务策略、展示、聚合和工作流程优先归现有应用；复用本身不构成提升层级的理由。验收标准：改变业务策略或新增应用通常只需改模块。既有 immutable builtin 的发行身份不因该原则自动改变，本轮不扩大动态更新权限。

- **内核是信任根**：管理真实调用方、会话与运行、版本切换、构建检查、数据迁移、凭据、审批、预算与事件投递，不把具体应用业务塞进内核。
- **系统模块**是随服务运行的进程内接口，不经过应用提案、沙箱构建或暂停。`steward/system/*` 提供 `chat`、`modules`、`approvals`、`settings`、`schedules`、`provider`、`executions`、`secrets`、`activity`、`content`；`memory.ts` 也注册为系统模块。系统模块不是可由 AI 替换的应用进程。
- **受信任本机能力模块**位于 `steward/local-*`，通过独立 local registry 注册到同一路由，发行身份为 `local:<name>`。工具输入与输出均有 schema，失败输出校验会拒绝调用；敏感输入／输出及适配器错误正文不落通用日志。它们不由应用提案替换，保留名称发生安装冲突时拒绝解析。
- **内置模块**位于 `steward/builtin/*`：`web`、`mcp`、`files`、`notify`、`events`。官方外置 `qq`、`remind`、`mind` 和可选 `memory-local` 位于 `steward/external/*`；可选 `coding/editor` 同在该目录；共用 SDK/路由/独立进程协议，但类别和发行方式按 P0 契约区分。
- **外置应用**由 `module.json`、入口和测试组成，在独立 SDK 进程中处理工具、定时等事件，数据与内容目录按模块分开。外置受检更新和回滚；内置代码只随 Chrona 发行变更，禁止定制内置双轨。

代码：`steward/system-modules.ts`、`module-calls.ts`、`module-builtin.ts`、`module-supervisor.ts`、`module-build.ts`。细节：[模块依赖方向](module-dependency-direction.md)、[模块恢复](module-recovery.md)。

## 3. 版本、构建会话与启用

`modules.build` 仅为外置应用创建独立的 `build` 会话，保存目标、意图、参考文件和当前版本快照；队列有 FIFO、并发、时限与提交次数约束。构建会话可搜索和调用普通会话可见的应用工具，但只能提交内核记录的目标模块。`modules.checkout/reference/propose/check` 分别提供源码、接口契约、候选提交与检查结果；候选从提交目录复制到内核管理的 staging，按文件内容计算 hash，再进入版本 store。

检查包括 manifest 与工具契约、依赖、入口类型检查、作者测试、数据连续性/副本迁移、smoke 启动、重复事件的 key probe，以及受影响调用方的类型检查。失败不会靠人工批准绕过。通过检查的新应用或更新通常自动启用，并经 notify 事后汇总告知；已有数据迁移、新增凭据仍需一次确认，回滚恢复旧数据快照也要确认。内置发行版新增凭据声明不问，实际凭据仍由用户填写。多模块构建逐个检查后由 `modules.request-group` 统一切换；组内需迁移的模块须先单独处理，有新增凭据时整组询问。

`modules.build-owner` / MCP `chrona_build` 则是 owner 明确授权的单模块有界构建：固定 Provider/model、时限、提交上限及单次 request key，重复请求不重跑。它仍走相同检查与启用规则。

代码：`steward/module-build-session.ts`、`module-proposal.ts`、`module-build.ts`、`module-continuity.ts`、`module-typecheck.ts`、`module-probe.ts`、`module-group.ts`、`owner-build.ts`。细节：[安全机制简化](security-simplification.md#31-模块启用检查通过即自动启用第-3-项)、[Owner 单次受控构建](owner-bounded-builds.md)。

## 4. 回滚与故障恢复

外置版本以 hash 保留，可显式回滚到已批准版本；内置无动态代码回滚。外置普通更新保留暂停，显式回滚恢复启用。新激活外置版本在任何事件投递前启动失败时，内核评估一次自动代码回滚：当前激活身份/hash 未变、尚无成功验证能力、前后版本均已批准且 manifest 有效，数据 schema 一致，无迁移/恢复记录，也无不兼容日程等阻碍。符合条件则切回前一版本，保留当前数据与兼容日程，不重放工作；恢复目标不会继续自动回滚。不能安全回滚时保留诊断，交由人工恢复。

supervisor 另有 keepAlive 进程退避重启与连续失败暂停；三败暂停由当前 activationId 的实际执行结果经唯一持久化策略判断（Audit.module_execution_result），supervisor 重建不丢次数，同 hash 再激活不继承次数。成功事件清零；通过结构校验的业务拒绝（例如输入、权限、目录冲突）仅结束该调用，不重启健康进程；连接及输出契约 mismatch 均不改变连续次数；内存仅负责退避与有限重启执行，incident 与日程累计数不参与暂停判断。新 incident 快照带 activationId 与单调递增的 revision；旧 hash-only 快照保留并标记 legacy-unattributed，不猜测激活。连接恢复只表示待验证，不代表原操作成功，投递结果未知也不会被诊断逻辑偷偷重放。

代码：`steward/module-generation.ts`、`module-activation.ts`、`module-supervisor.ts`、`module-diagnostics.ts`、`module-evolution.ts`。`modules.list` 的当前运行状态与故障摘要位于 `health.runtime`、`health.incident`。具体资格、证据与人工入口：[模块故障诊断与恢复](module-recovery.md)。

## 5. Routed calls 与接口契约

模块通过 `chrona.call("模块.工具", args, options)` 交互；同一路由也连接系统模块，其中 `provider.complete/wake` 是受治理门面。底层 ProviderAdapter 由本机 `agent` 能力持有，普通会话、编码、构建/admin、completion、transcript 和 health 经同一路由到达它。内核记录真实调用方，校验参数和声明的输出，处理同步等待、异步调用、`call_result`、幂等键与结果未知状态。页面、渠道和订阅保存真实 moduleId 与工具 contractHash；调用可带 `expectedTarget`，在入队事务及实际发送前复核，不能让同名重装接管登记。异步新调用与目标绑定原子提交，旧的无归属记录不猜身份；确定未发送的显式缺失目标可以晚绑定，未知结果不重绑或重放。

`visibility` 定义工具面向 Provider、owner、其他模块或内核的受众；`uses` 是生成调用类型、影响分析和依赖签名的契约，不是普通模块调用的运行时许可名单。`uses: ["*"]` 还让入口模块代表用户访问 owner 工具；这不赋予其 Provider 专用接口。凭据读取仍有独立的按名声明检查。不能把这些路由规则称为 OS 隔离。

代码：`steward/module-calls.ts`、`module-tools.ts`、`module-contracts.ts`、`system/shared.ts`、`packages/integrations/src/steward/module-sdk/sdk.ts`。细节：[安全机制简化 §3.2](security-simplification.md#32-usescallersvisibility-降为契约第-2-项)。

## 6. Contributions、events 与 activated

manifest 的 `contributes` 保存面向通用模块的声明；`modules.contributions({ section })` 让对应模块读取自己的部分，业务解释不进内核。内置 `events` 读取 `contributes.events.emits`；订阅者登记自己的回调工具，事件经异步 routed call 扇出，发布者和订阅者身份取自真实调用方。

声明 `activated: true` 的应用在自身版本或显式 `uses` 依赖版本变化后收到 `on("activated")`，可在此幂等登记页面、渠道等。supervisor 以自身 hash 加依赖 hash 组成签名，保存到 `platform/activated.json`；失败在后续轮询重试，单次变化至多尝试三次。它是登记时机，不是业务操作成功证明。

代码：`steward/system/modules.ts`、`module-supervisor.ts`、`builtin/events/events.ts`、`builtin/files/index.ts`。细节：[模块依赖方向 §4](module-dependency-direction.md#4-web应用登记页面规格草案)；早期设计见[历史索引](history/README.md)。

## 7. 网页与应用页面登记

网页由内置 `web` 入口提供，不存在 Next.js 或单独的 owner HTTP 业务 API。`/api/web` 是该模块自己的适配层，再调用系统与应用工具。web 保存应用经 `web.page-set` 登记的 json-render 页面结构及本应用工具引用，校验组件、动作与引用；用户打开页面时读取业务数据、执行回调。应用无需让 web 硬编码认识自己；未登记时仍有通用工具页，停用应用的页面隐藏，已删除应用的登记按真实 moduleId 清理。页面 revision 与工具契约在读取、内容和动作调用时复核；同名新应用不会继承旧页面，目录读取失败不能当成空目录清理。

Today 的七天范围、排序、通知与应用健康摘要在 web 的 `today.ts` 中经 routed calls 聚合；`chat.today` 是转发到 `web.today` 的兼容入口，web 内部不回调该入口。内核 `chat.runtime` 只返回自身运行事实，`chat.sessions` 提供按入口身份过滤的读取，`schedules.list` 可排除静态轮询。没有可用 web 时 overview 明确失败，不回退到内核再实现一套聚合；独立 `/health` 不依赖该页面。

所有页面（系统页与应用登记页）共用 `pages.js` 的 React/json-render 渲染器，由 `src/pages.tsx` 构建；系统 spec 位于 `src/system/`，仅系统页面获得访问现有数据 API 的 adapter。`app.js` 只负责认证、请求、路由与单一 SSE 等 shell 基础设施，样式统一在 `style.css`；共享显示组件及绑定规则由 `catalog.ts` / `web.catalog` 提供。

代码：`steward/builtin/web/index.ts`、`pages.ts`、`catalog.ts`、`src/pages.tsx`、`build.ts`、`builtin/files/page.ts`。细节：[模块依赖方向 §4](module-dependency-direction.md#4-web应用登记页面规格草案)，具体可用格式以 `web.catalog` 与代码为准。

## 8. 通知渠道、日程与定时器

**通知**由内置 `notify` 处理 now / digest / web、每日上限、安静时段、队列与送达。审批事实由内核经 `notify.approval` 投递，摘要、文案和页面引导归 notify；审批决定与幂等记录仍归内核。内核自己的通知也经 `notify.send`。渠道模块调用 `notify.channel` 登记自己的投递工具，notify 校验回调归属与可见性后统一投递；没有就绪渠道时退到网页，不承诺外部渠道必达。QQ 是登记渠道之一，不是 notify 写死的业务依赖。

**调度**由系统 `schedules` 保存与投递。manifest 的静态日程随版本启用安排；模块可用 `schedules.create/cancel/mine` 管理按自身 key 归属的运行时定时器，到时收到带 payload 的 `schedule` 事件。Provider 的 `chrona_schedule` 安排唤起；提醒是预装外置 `remind` 应用，使用同一套模块定时器。日程推进与本次模块投递记录在同一事务提交（`ModuleInvocation.mode = schedule`），投递在 tick 外执行，同一应用串行、最多四个应用同时处理。明确未送达按退避最多尝试六次；处理失败或结果未知不重放，重启后过期的投递标为未知并通知核对。记录绑定版本及激活身份，变更后不投递旧事件；取消或替换定时器会取消尚未送出的记录。

代码：`steward/schedule-delivery.ts`、`steward/notify-user.ts`、`builtin/notify/*`、`external/qq/index.ts`、`system/schedules.ts`、`schedules.ts`、`module-generation.ts`、`tick.ts`、`external/remind/*`。细节：[模块依赖方向](module-dependency-direction.md)、[运维说明](operations.md#qq-状态与绑定)。

## 9. 凭据与 OAuth

凭据保存在内核管理的 secrets 目录。应用在 manifest 声明名称，通过 `secrets.get` 按名读取；入口负责用户填写、按字段保存或删除，列表与审计只记录名称等元数据，不返回凭据值。`chrona.exec` 可将声明凭据或 OAuth token 注入一个子进程的环境变量或临时私有文件，并脱敏输出，避免把密钥放进 Provider prompt。

OAuth 由 `secrets.authorize` 发起 PKCE，用户在服务商页面同意；内核 `/oauth/callback` 用一次性 state 识别回调，不要求浏览器携带 API key。refresh token 留在内核，`secrets.token` 刷新并提供短期 access token，需重新授权时明确返回 `reauthorize`。这不替代服务商账户授权，也不隔离同用户的恶意进程。

代码：`steward/system/secrets.ts`、`secrets.ts`、`oauth.ts`、`packages/integrations/src/steward/module-sdk/sdk.ts`、`apps/server/src/app.ts`。配置与安全保存：[运维说明](operations.md)；新增凭据确认：[安全机制简化](security-simplification.md)。

## 10. Memory 与 mind

**memory** 是受治理的系统转发接口：把 retain / recall / forget 交给 `settings.memory` 选中的、声明 `contributes.memory` 的应用。应用可在同一 contribution 中声明 `context` 与 `afterRun` 工具名，由该应用决定自动召回查询、保存频率、摘要与提示。可选外置 `memory-local` 目前采用首次召回、每四条用户消息保存、会话轮换时保存剩余消息的策略；改变这些策略只改模块。内核仅核实入口会话、选中模块、脱敏和有界快照，以及回执/水位；模块上下文作为不可信任务数据。未声明这两个工具的既有提供者继续支持手动 retain / recall / forget，不自动获得对话快照；更新适配模块后才启用自动策略。失败不阻断对话。

**mind** 是官方预装外置应用：读取 Chrona 状态、应用的 `contributes.mind.attention` 和自身 agenda，按变化、截止时间与复查时间决定是否 `provider.wake`。可选直觉模型辅助判断，有调用预算和规则回退；agenda、评估与决策日志存于 mind 的数据目录，工作由被唤起的 Provider 用工具推进，不靠通知文字假装已执行。mind 的工作协议作为模块数据随唤起传入，不是内核按模块名添加的系统指令。

代码：`steward/memory.ts`、`module-builtin.ts`、`external/memory-local/*`、`external/mind/index.ts`、`external/mind/agenda.ts`。边界：[模块依赖方向](module-dependency-direction.md)；配置与诊断：[运维说明](operations.md)。

## 11. 审批与 grants

确定性策略只有 `allow` / `ask`。grant 可为全局或单应用，并可设过期、撤销与 once；同一作用域一次授权优先于长期规则，否则 ask 优先于 allow。运行时动作审批可以留下“仅这次”或长期 allow；等待的工作据此继续，once 使用后被消费。

应用的 `approvals.request` 是一次具体决定，异步结果经 `call_result` 返回，不产生让应用日后自行批准的长期 grant。需要确认的版本启用/删除同样直接绑定审批 payload，不生成或检查启用 grant。运行时审批不分红黄绿，用户可从网页、QQ、MCP 等入口批准或拒绝。删除应用先确认并备份；内置应用、入口应用及仍被其他启用应用显式依赖的应用不能直接删除。暂停/恢复应用直接生效并留审计。

代码：`packages/domain/src/steward/policy.ts`、`steward/grants.ts`、`approvals.ts`、`system/approvals.ts`、`module-remove.ts`、`module-status.ts`。细节：[安全机制简化](security-simplification.md)。

## 12. Provider、会话与用户入口

会话保存交流上下文与入口归属；一次处理是 run，有队列、deadline、能力 token、预算与取消记录。普通运行连续失败三次后停止自动续跑；Provider 不可用或存在结果未知的应用调用时立即停止自动续跑并通知用户。可重试的失败继续使用原会话和文件，并要求先核对已有结果，构建不自动重试。入口经 `chat.send` 进入会话，回复推送到会话所属入口的 reply 工具。模块唤起与构建使用独立会话并向发起会话报告；完成构建可继续唤起原会话，但连续次数有界。持久业务状态仍应保存在应用中，而不是只留聊天记录。

当前适配器是 Pi RPC：Provider 负责推理和原生文件、命令、网页等工具，Chrona 提供 `m_*` 应用工具与运行通道。Provider 的可信指令与资源范围由内核显式传入，不内置管家业务流程或根据 execution 引用选择编码策略；coding 的工作说明来自模块任务输入，权限、预算、取消和停止核实仍由内核与可信执行点落实。专用命令、版本、profile 和显式资源由 owner 配置；附件与会话工作目录按运行上下文提供。构建会话与主会话可调用同类应用工具，反思会话保留独立工具边界。

owner 操作通过 routed calls，不存在旧 owner REST API：网页用 `/api/web`，内置 MCP 用 `/api/mcp` 对用户自己的 Agent 提供 owner 工具而非 Provider 运行能力；官方预装外置 QQ 入口负责 Bot 私聊、会话与回复。Hono 内核保留 Provider bridge、健康与 OAuth 等路由，其余入口 HTTP 由 manifest `listen` 声明后代理，`/api/*` 在内核验证认证（专用 bridge 使用自己的窄凭据）。

代码：`steward/chat.ts`、`chat-replies.ts`、`sessions.ts`、`runs.ts`、`tick.ts`、`provider-channel.ts`、`packages/integrations/src/steward/pi-provider.ts`、`builtin/mcp/*`、`external/qq/*`、`apps/server/src/app.ts`、`routes/api.ts`。细节：[Provider 运行说明](provider-runtime.md)、[运维说明](operations.md)。

## 13. Rescue、admin、存储与备份

rescue 是独立、不可由应用替换的救援入口，使用独立监听与 `RESCUE_KEY`，提供对话和审批，不依赖 web 模块正常工作。宿主 `chrona admin` 提供应用、版本、审批、诊断及恢复操作；`admin build` 是停服、独占数据库锁下的一次授权构建，不启动普通 tick 或内置升级，检查后的启用仍遵守统一规则。

SQLite 保存会话、调用、版本元数据、日程、审批与审计；`<dataDir>/platform` 保存版本代码、应用数据和内容等，`sessions` 保存会话工作目录，`secrets` 保存凭据。备份须停服，用 `chrona backup` 同时生成一致性数据库副本与数据 tar（platform、sessions、secrets、qq-bot）；依赖等可重建目录不打包，Provider 私有 profile 不在这份 tar 内，须单独安全归档。恢复不能只拿数据库文件，备份也不是加密导出。

代码：`apps/server/src/rescue.ts`、`packages/cli/src/admin.ts`、`admin-build.ts`、`packages/db/src/sqlite-backup.ts`、`sqlite-backup-files.ts`、`prisma/schema.prisma`。操作步骤：[运维说明](operations.md#备份与恢复)、[模块恢复](module-recovery.md)、[Owner 单次受控构建](owner-bounded-builds.md)。
