# 应用健康机制整合提案

状态：2026-11-04 用户确认（第 4 节各项均选推荐项 A：mind 唤醒 Provider 普通构建自主修复；暂停/回滚失败保留确定性最小通知、mind 只补充；沿用 mind 6 次/24h 与公共构建日预算；仅旧 reflection 与 mind 都启用时自动接管；诊断详情保持模块可读；输出 mismatch 不计入三败熔断）。按第 4 节步骤实施中。

步骤 1 已完成（2026-11-04）：自动/手动暂停共用实现，审计记录原因、关联 incident（如有）及精确日程 IDs；恢复仅处理最近一次暂停记录的日程，不重放错过或未知工作；历史自动暂停缺 IDs 时保留日程暂停并记录 unrestoredLegacyPause，保留确定性最小通知。

步骤 2 已实施（2026-11-04，工作区待验收）：实际执行结果按 activationId 写入唯一连续失败策略，supervisor 重建保留次数，同 hash 再激活从零开始；删除 ModuleRun.error 回看暂停判断，mismatch 不计失败且不算恢复。内存仅保留退避/有限重启执行状态；incident 累计与单日程统计不决定暂停。新 incident 快照带 activationId 与逐次 revision，旧 hash-only 快照只读标记 legacy-unattributed，禁止猜测激活；进程/socket 重复观察及同 runId 重记均幂等。未更改自动回滚门槛、未知结果/不重放语义或共享契约。步骤 2 已验收提交（b709d72c）。

步骤 3 已实施（2026-11-04）：`moduleHealthSummary`（`E/modules.ts`）是唯一的当前健康投影，不含 stderr：observedAt、runtime、当前 activation 与已观测能力、策略连续失败数、当前激活的 incident（原因截 300 字）、当前激活的契约失败数、open、nextAction、truncated（有界扫描未能证明完整）。`modules.list` 以 `health` 字段替换原 `runtime`/`incident`；`modules.diagnostics` 在摘要上附历史（incidents/contractFailures/evolution）；新增只读 `modules.health` 按名称分页（每页 50，`open=true` 只列未解决），构建会话的 Provider 只见授权目标。输出 mismatch 记录 activationId，旧 hash-only 记录不计入当前激活。步骤 4–7 未实施。

## 1. 现状：代码中的事实、判断与动作

基线：`platform-v2` 当前工作区；仅阅读源码，未验证部署。开始时 `git status --short` 与 `git diff --stat` 均为空，与任务背景所述未提交内容不同。本次只新增本文。
路径简写：`E/` = `packages/engine/src/modules/steward/`，`C/` = `packages/cli/src/`；下列 `E/文件:行` 均可直接映射到仓库文件。行数是源码总行数，不是新增工作量。
已读 `AGENTS.md`、architecture、security-simplification、module-dependency-direction、module-recovery；背景文档与注释有过时内容，以下以代码为准。

### 1.1 演化记录与启动前自动回滚

- **触发**：激活/显式回滚写 activation；当前激活的实际事件成功、运行失败、输出契约错误更新结果；只有未连接、事件尚未送达的启动失败才进入自动回滚判断。
- **读事实**：`Module/ModuleVersion` 的当前 hash、批准状态、manifest、intent/report，`Generation`、迁移/组审批审计，当前 activationId、已观测能力、schema 与静态日程兼容性。
- **写数据**：`Audit.kind=module_evolution_outcome` 不可变快照，含 activationId、前后 hash、checks、observedCapabilities、status、rollback、dataHandling、nextAction；并无独立 activations/failures 表。切换另写 `Module.activeHash/status`、`Generation`、`module_activate/module_rollback`；普通激活重排静态 `Schedule`，自动回滚保留既有日程。
- **动作**：自动回滚只切代码，事务内复核身份；前后版本均批准、schema 一致、无迁移/恢复、无动态/变化日程、非分组激活、无已验证能力；每激活最多一次实际尝试，恢复目标禁止再次自动回滚。不恢复旧数据、不重放事件；此函数不直接通知或启动构建。
- **消费者**：supervisor 用 activationId 防过时回调；diagnostics/应用页和构建诊断快照展示演化结果。`verified` 仅表示列出的能力成功，不等于全部能力健康。
- **代码**：`E/module-evolution.ts:7-105`（105 行）；`E/module-generation.ts:19-53,57-150`（158 行）；启动门槛 `E/module-supervisor.ts:120-137`；UI `E/builtin/web/app.js:230-237`。

### 1.2 故障诊断与有界恢复入口

- **触发**：supervisor 的启动/进程/事件失败、连接成功与实际事件成功；路由另记输出 schema mismatch。诊断查询是被动读取，不启动进程、探针或模型。
- **读事实**：真实 PID、退出码/信号、脱敏 stderr、运行/触发器、delivery stage、内存限制；当前激活、同 hash 故障快照和演化快照；在线 runtime 来自 supervisor 内存，离线为 unobserved。
- **写数据**：`Audit.kind=module_runtime_incident`，同 hash 未恢复故障合并，累积 failures、pendingTriggers、deliveryUnknown，保留首次/最近证据及最近 10 步；`module_output_mismatch` 单列输出问题，并可标演化失败。查询每模块扫描最近 30 个 incident 快照取最近 5 个故障；演化扫描最近 600 个快照取 5 次激活。
- **动作**：诊断本身只记证据/状态：retrying → verifying → recovered 或 unresolved；连接不算恢复，成功一个能力不清除其他失败能力；deliveryUnknown 恢复后仍保留。不会自动重放、改代码或改资源。
- **消费者**：`modules.list` 给摘要；`modules.diagnostics/overview` 给详情；网页「故障与恢复」、MCP `chrona_module_diagnostics`、Provider `m_modules_diagnostics`、CLI `admin diagnostics`；构建准备写 `sessions/<id>/references/target-diagnostics.json`（可过时、非授权）。
- **代码**：`E/module-diagnostics.ts:8-32,61-153`（153 行）；`E/modules.ts:24-36,74-89`；`E/module-build-session.ts:46-63,84-107,124-129`；`C/admin.ts:31-49`（96 行）。
- **边界更正**：当前详细接口 visibility 含 modules，普通应用无需 uses 也可读取；只有 build Provider 另按可信 `build_request` 逐次缩小目标。恢复文档“仅 owner/Provider/web/mcp”已不符合代码（`E/system/modules.ts:125-126,157-158`，`E/module-calls.ts:89-96`，回归例 `E/module-diagnostics.bun.test.ts:95-109`）。

**显式有界构建不是故障自动重试：**
- **触发/读事实**：owner 明确提交单模块目标、精确 Provider/model、timeout、提交上限、单次 requestKey；检查配置上限、重复请求、现有工作和目标诊断。在线 `modules.build-owner`/MCP `chrona_build` 与停服 CLI 共用 admission。
- **写数据**：`Session(source=build)`、`Run(lane=build)`、`Audit.kind=build_request/build_execution/run_claimed/module_submission` 等公共构建记录；会话目录 request.json、current 源码和 references。候选继续写 `ModuleVersion.report/status`，通过公共构建/激活路径处理。
- **动作/消费者**：调用一次 Provider、处理候选检查；重复 key 返回原结果，不恢复/重试。CLI 要独占数据库锁、无 queued/running run 和 building/testing 候选，不运行普通 tick/内置升级；结果供 owner、构建会话、诊断/活动/版本页消费。检查通过通常自动启用，迁移/新增凭据仍确认。
- **代码**：`E/owner-build.ts:11-45`；`E/owner-build-run.ts:14-53`（53 行）；`E/module-build-session.ts:154-206`；`C/admin-build.ts:17-44`（44 行）。

### 1.3 supervisor、连续失败暂停与日程失败

- **触发**：keepAlive reconcile、进程意外退出/断连、事件投递失败；实际事件成功清内存连续失败数。keepAlive 失败安排指数退避；新调用不能绕过已安排退避。
- **读事实**：当前 activeHash/activationId、manifest.keepAlive、进程/连接状态、内存 failures/restarts，以及同 module/hash 最近两条其他 `ModuleRun.error`。
- **写数据**：内存 `failures` 按 moduleId:hash 计数、`restarts` 按 moduleId 保存 timer；失败更新/创建 `ModuleRun`、写 incident/演化；三连败写 `Module.status=paused`、相关 active 模块 `Schedule.status=paused`，经 `notifyUser` 排队 `notify.send`。自动暂停本身未写 `module_disabled`。
- **动作**：默认退避 1s 起、指数增长上限 60s，内存计数 ≥3 不重启；启动前安全回滚优先，成功则不再执行此次暂停；数据库最近两条均 error 时暂停当前 hash 并通知。成功事件才重置内存计数，单纯连接不重置。
- **消费者**：路由/HTTP/日程使用 supervisor；diagnostics 和 modules.list 展示 runtime；notify 负责预算和送达；模块暂停影响后续调度。activated 登记另用 `platform/activated.json` 与内存尝试数，最多 3 次，是登记投递状态，不是业务健康结论。
- **代码**：`E/module-supervisor.ts:71-75,104-161,186-198,244-303,344-354,381-396,434-439`（439 行）；`E/module-effects.ts:48-58`（60 行）；通知排队 `E/notify-user.ts:21-24`。
- **日程补充**：到期先推进 `Schedule.nextAt/status`、写 `schedule_fired`，再调用 supervisor；模块日程将失败累加到 `Schedule.failures` 并写 lastResult，成功清零；此计数不单独决定暂停，也不补跑未知调用。读 active 模块/当前日程与调用数，消费者是 schedules 列表、today 近期安排和排障者。`E/schedules.ts:21-31,69-115`（154 行），表字段 `prisma/schema.prisma:173-198`。

### 1.4 reflection：另一套主动改进闭环

- **触发**：tick 的 reflect 阶段；开关启用且 Provider 存在，无在途 reflect run；距上次 ≥6h、当地日 <2 次，且有新 `module_activate/module_auto_activated`（跳过入口和非定制版）或 `module_runtime_incident(status=unresolved)`。并不要求 failures ≥某阈值，非 keepAlive 的一次失败也可能 unresolved。
- **不是每日定时/周上限**：无新信号不运行；代码只有每日 2 次、每运行最多 3 建议、同 key 30 天不重复，以及共用构建预算，没有独立每周 cap。7 天窗口用于初始信号/近期故障，不是周配额。
- **读事实**：各模块当前 manifest/status、7 天内有界 incidents 累计、最近 60 天最多 30 个 build 会话及 request.json/最后回复、提交/激活审批推断 outcome；最多 50 条近期 suggestion 审计。无 evolution/输出 mismatch 直接输入，反思 run 只能用 suggest，不能实时核实诊断。
- **写数据**：`Session(source=reflect)`、后台 `Run`、`Audit.kind=reflection_started/reflection_suggested`；suggestion ledger 就是审计中的 key/title/why/sessionId/modules，不是独立待用户挑选的建议表。
- **动作**：Provider 判断页面缺失或重复失败是否需改进；`reflection.suggest` 立即 `startBuild`，不是仅留建议；之后发 digest 通知。构建不因“建议”跳过公共检查/审批。
- **消费者**：反思 Provider、构建 Provider、activity、系统应用页的 reflect/build 过程和主动反思开关、notify。提示词/通知仍写“低风险复核后上线，其余审批”，与当前检查通过自动启用规则冲突。
- **代码**：`E/reflection.ts:14-30,43-102,105-161`（161 行）；`E/tick.ts:51-55,126-128`；工具限制 `E/tools.ts:128-129,175-176`；公共预算 `E/module-build-session.ts:181-188`。

### 1.5 mind：周期感知、agenda 与 Provider 唤醒

- **触发**：manifest 每 5 分钟 sense、每天 09:00 daily；默认实际 sense 间隔 15 分钟；enabled=false 不判断。新摘要/到期/复查触发判断，daily 在距上次回顾 ≥20h 且有开放关注或摘要变化时回顾。
- **读事实**：`chat.today`（审批、日程、通知反馈、入口会话、Provider 可用性）、`modules.list`（当前 hash、incident）、`chat.runs`（等待问题）、自身 agenda；经 `modules.contributions({section:"mind"})` 发现 attention 回调（最多 10 源、每源最多 20 项、10s 超时）。
- **写数据**：模块私有 `platform/data/<mindId>/state.json`（seen/handled/hash、唤醒/直觉调用时间）、`agenda.json`（关注/评估/承诺/升级）、`decisions.json`（最多 500 判断、report 结果）。`provider.wake` 另建 `Session(source=module)` 与后台 Run；普通路由/执行留公共记录，无专门 mind audit kind。
- **动作**：规则或可选直觉模型决定是否唤醒；默认滚动 24h 最多 6 次，常规间隔 1h、紧急 15min，直觉调用默认 96/24h，仍受内核运行预算。mind 本身不构建/回滚/发通知；唤起的完整 Provider 按协议核实、推进、通知或构建，再 note/report。
- **消费者**：Provider 收到不可信模块数据中的协议、变化和关注；agenda/decisions 工具供 Provider/用户入口消费，7 天有效性统计不是周上限。当前内置 mind 无 page-set 登记，网页通过通用应用工具而非专门 mind 面板访问。
- **代码**：`E/builtin/mind/index.ts:7-14,51-58,89-123,187-195,218-260`（260 行）；`agenda.ts:13-28,40-49,64-118`（118 行）；`module.json:5-24`；`E/system/provider.ts:29-37`。

### 1.6 activity 与 today：读视图，不是第三套决策器

- **activity 触发/读事实**：`activity.list` 查询白名单 Audit，关联模块、版本、审批名称，按时间/模块分页；详情为内核措辞，不由应用改写。**写/动作**：无额外业务状态、通知或恢复动作，只投影句子。**消费者**：网页活动流/应用详情、MCP `chrona_activity`、模块调用方；Provider 也可经 owner 工具目录取得（`E/module-tools.bun.test.ts:68`）。
- **activity 代码**：`E/activity.ts:7-17,32-47,57-79,94-109`（109 行）；`E/system/activity.ts:8-17`（17 行），visibility 实为 modules/owner，不是注释所称仅页面和 owner。
- **today 触发/读事实**：`chat.today` 汇总 open Approval、7 天 active Schedule、notify 最近 20 通知、入口 Session、应用基础信息；health 另查 Provider、Run、到期日程、notify status、StewardState。**写/动作**：不持久化汇总、不启动恢复/构建；但调用 notify.list/status 和 Provider.health，并非完全无 I/O 的纯投影。
- **today 消费者/代码**：网页今日、MCP `chrona_today/notifications`、mind；`E/today.ts:13-54`（54 行）、`E/apps.ts:4-15`、`E/builtin/web/app.js:104-131`、`E/builtin/mcp/index.ts:10,34-48`。Today.apps 没有诊断/演化，health.failedRunsToday 是 Provider Run，不是 ModuleRun 失败数。

## 2. 重叠与缺口（代码证据）

1. **同一故障三路处理，可叠加但不保证同时发生**：失败先写 incident，三连败通知；reflection 读取 unresolved，mind 从 list 读取相同 incident 唤醒，两个 Provider 都被提示可发起修复构建。通知 key 各异，没有跨链路同问题锁。证据：`E/module-supervisor.ts:135-137`、`E/module-effects.ts:48-58`、`E/reflection.ts:51-53,137-145`、`E/builtin/mind/index.ts:11,55,246-253`。预算/关闭开关可能阻止其中一路；真实重复次数未确认。
2. **上线也有双入口，覆盖口径不同**：reflection 排除入口/内置未定制版本；mind 首次只学习 seen，之后所有 hash 变化都算，回滚亦可算更新；没有相同 activationId 关联。证据：`E/reflection.ts:51-53,116-119`、`E/builtin/mind/index.ts:51-57,129,239-240`。首次安装是否需要页面改进不能靠当前 mind 的 hash 机制完整接替。
3. **四种失败数不是一个数字，不能直接相加**：内存连续失败数控制重启；最近 ModuleRun.error 控制暂停；incident.failures 是未恢复故障累计；Schedule.failures 是单日程连续失败。成功事件清内存，不会清除其他 pendingTriggers。证据：`E/module-supervisor.ts:130,140,353-354`、`E/module-effects.ts:50-51`、`E/module-diagnostics.ts:93-108,127-134`、`E/schedules.ts:82`。输出 mismatch 只写 ModuleRun 错误/演化失败，不走普通 failure，却可能被后续暂停的“最近两条 error”算入（`E/module-supervisor.ts:347-350`）。
4. **演化 verified 与故障未恢复可以并存**：成功任一 capability 会写 verified，而 incident 仍按各 pendingTriggers 等待；反过来失败也可保留既有 observedCapabilities。不是事实互斥，但单标签容易误读。证据：`E/module-evolution.ts:93-103`、`E/module-diagnostics.ts:117-134`；UI 分别显示两个状态 `E/builtin/web/app.js:230-244`。
5. **激活身份与故障归并身份不一致**：evolution 按 activationId；incident schema 仅 hash、按 hash 找旧故障，同 hash 再激活仍可能延续旧 pendingTriggers。内存失败数同样仅按 hash；过时回调虽有激活校验，历史归属仍不够精确。证据：`E/module-evolution.ts:50-64`、`E/module-diagnostics.ts:16-20,92-98,139-143`、`E/module-supervisor.ts:96-101,129-130`。
6. **自动暂停后的恢复日程缺口**：自动暂停只更新 Schedule.status，未写 module_disabled/所暂停日程 ID；resume 只恢复最近 module_disabled 中的 IDs，故首次自动暂停后 enable 可让模块 active 而日程仍 paused（有旧记录则可能恢复错误子集）。证据：`E/module-effects.ts:52-58`、`E/module-status.ts:22-24,31-42`。这是静态可确认路径；未运行复现。
7. **活动流会把恢复也写成“运行出错”**：连接/验证写的 incident 快照仍用 module_runtime_incident，activity 不看 status/attempt.action，全按 evidence.reason 渲染；一个故障产生多条貌似新错误。证据：`E/module-diagnostics.ts:74-76,131-134`、`E/activity.ts:34-45`。白名单也遗漏 module_evolution_outcome、module_output_mismatch 和暂停/恢复审计（`E/activity.ts:7-9`），看活动不等于看完整健康事实。
8. **反思有重复推导和失真窗口**：自己按提交/activeHash/审批推断构建 outcome，故障按 lastAt 和有界 incidents 求 7 天累计（故障起点可早于 7 天），未用 evolution 关联激活。证据：`E/reflection.ts:64-85,94-102`。这不是精确 7 天失败事件统计，也不是权威构建结果。
9. **有界查询会漏近期视图外仍未解决的问题**：incident 从 30 快照取 5 故障、evolution 从 600 快照取 5 激活；并非按未解决优先，消费者不能把“没读到”当“无故障”。证据：`E/module-diagnostics.ts:62-70`、`E/module-evolution.ts:51-57,76-85`、`E/reflection.ts:64-66`；是否已有线上漏项未确认。
10. **mind 信号粒度过粗，缺修复中的关联**：incident key 只有 id，新增次数/证据不改 key；summary 也只记 key。相同 incident 被处理后恶化可能不再触发；没有结构化 buildSessionId 关联供 mind 去重。证据：`E/builtin/mind/index.ts:55,128-129,239-243,257`；agenda Concern 没 source/build 字段 `E/builtin/mind/agenda.ts:13-17`。
11. **今日不是健康事实源，且失联可能被投影为空**：Today.apps 只有基础配置，notify 查询失败返回 []/null，health 又将 null 计为 0；mind 的反馈上下文可能失真。证据：`E/apps.ts:8-11`、`E/notify-user.ts:62-80`、`E/today.ts:22-24`、`E/builtin/mind/index.ts:113-118`。全局 Provider 不可用也会阻止 mind 唤醒（`index.ts:243`），不能指望后台 AI 修复自身不可用。
12. **旧安全措辞与实现分叉**：reflection prompt/通知仍说分级复核，当前规则已删除；详细诊断也已对普通模块开放。证据：`E/reflection.ts:17,30,145`、`E/system/modules.ts:125-126`、`E/module-calls.ts:89-96`；与 security-simplification §3.1–3.2、module-recovery「存储与隐私」对读，后者可见性段已过时。不能把用途契约说成恶意代码隔离。

## 3. 目标设计：事实 → 关注 → 行动

### 3.1 一条链路，保留不同事实的语义

`运行/路由/激活/日程事实 → modules 的只读健康投影 → mind 关联关注并决定时机 → Provider 核实后调用现有动作 → 结果回到事实源`。
确定性保护动作是短路：`事实 → 内核回滚/退避/熔断暂停 → 事实结果`，不等待 mind、模型或通知渠道。mind 关注的是保护之后仍需处理的事项，而不是批准保护动作。

| 现有机制 | 归属与处理 |
| --- | --- |
| diagnostics、evolution、输出契约证据 | **事实层保留并整合读取**；共同健康投影，不把 incident/activation 合成一个模糊 healthy 布尔值 |
| supervisor 计数、重启、pauseFailedModule、rollbackFailedStart、schedules | **事实采集＋行动层保留**；统一失败归属/连续失败策略和暂停实现，删除重复计数决策，不删必要执行记录 |
| reflection 的触发、prompt、专用 Provider run、suggest 工具/开关 | **删除**；上线改进、重复错误的关注交给 mind；去重/冷却/构建结果关联合并进 mind，而不是复制整份 reflection |
| mind 的 sense、attention、agenda、直觉/规则、wake/report | **关注层唯一主动判断者**；保留整个用户事务 agenda，健康关注只是有来源引用的一类，不另建监控应用 |
| 普通 modules.build、owner bounded build、CLI admin build、手动回滚/恢复 | **行动层保留**；自主构建走普通 Provider build；明确授权的 owner 单次构建绝不自动续跑或换 key 重试 |
| activity、today、web/MCP | **读模型/入口**；复用事实或关注的公开读取接口，不保存另一份健康结论，不触发模型 |

### 3.2 事实层：内核持有证据，系统 modules 提供单一读取

- 继续用 Module/Version/Generation、ModuleRun、Schedule、Audit；先不加健康数据库/事件总线。模块日志始终脱敏、不可信；成功、失败、未知结果分别保存。
- 为新的 incident 快照补 `activationId` 与稳定 revision；失败/恢复记录引用 runId、incidentId、capability，自动动作引用同一 cause。旧 hash-only 记录保留为 legacy/归属未确认，禁止猜测 activationId。
- 统一投影至少给出 `configuredStatus`、runtime（观测时刻/是否可得）、当前激活/观测能力、未解决能力、contractFailures、rollback 结果、恢复动作与构建关联、source revision/截断标记；current 与 history 分开。详细 stderr 不进入 mind 的低成本感知/可选外部直觉请求。
- 连续失败规则以当前激活的真实执行结果为准，集中在一个确定性策略中；supervisor 内存只保存退避执行状态，不再独立决定“是否三败”。明确区分连续计数、incident 累计和每日程失败；读取不重算成另一份持久化总数。
- 自动/手动暂停共用暂停实现，记录原因、关联 incident 和精确 Schedule IDs；恢复只恢复本次暂停影响的日程，不重放错过/未知业务。输出 mismatch 是否计入熔断需定案，不能继续偶然混入。
- 对当前未解决 incident 提供独立有界分页，不让历史快照数量挤掉 open 状态；第一步可扫描/分页既有 Audit，性能不足再提索引或可重建投影表，不能静默拿最近 5 个充当全集。
- 不持久化 UI 文案为第二份状态：nextAction 从事实及动作限制推导；evolution 的历史说明保留历史语义。激活验证覆盖与故障恢复分别展示，正常休眠、连接成功不等于功能成功。

### 3.3 关注层：把 reflection 的有效能力移入 mind，删除第二条后台链路

- mind 读取统一摘要，不再从 chat.today 的 UI 投影凑健康信息；业务 attention 仍按贡献登记回调，健康是通用 modules 接口，不认识具体应用名。
- 关注引用 `moduleId + activationId + incidentId/改进主题`，另记 lastAssessedRevision、revisitAt、building session、处理/拒绝/静默期限。revision 变化能再次评估；构建中抑制同因重复构建，恢复后关闭故障关注但不抹历史/未知效果。
- 保留 reflection 的 30 天主题冷却、历史尝试和用户拒绝语义；拒绝优先于普通 hash 变化，除非有明确新事实。首次接管读取当前开放问题及近期激活，不依赖 mind 已有 seen 才发现。
- “值得处理”与“具备行动能力”分开：可安静观察、登记下一次复查、调用 notify 提醒，或 wake 完整 Provider。Provider 先实时查诊断和已有构建再行动；无需重复 reflect run，也无需 reflection.suggest 桥接。
- mind 的 decision/report 保存 why、source refs、wake/build/session 关联及结果；同关注同 revision 同阶段的 wake/建议原子去重（模块本地文件原子替换），不要仅靠提示词要求模型记住。
- 构建 admission 再对相同目标/来源关联的在途自主修复做确定性去重，避免不同 Provider 会话绕过 mind；公共内核只认通用 request/cause，不知道 mind/reflection 名字。用户显式另建构建仍是新的授权，冲突时明确返回已有工作，不暗中合并目标。
- 唤醒和自主构建使用统一可见预算；7 天统计仅评价有效性。若增加周构建额度，由通用构建预算执行，不在新内核健康逻辑里另起规则。
- 建议保留暂停/回滚失败的最小确定性通知兜底（仍经 notify），标记同 cause；mind 不重复“已暂停”通知，只补充新结论/需用户决定的下一步。普通变更/改进提醒由 mind 决定。mind 停用/崩溃时保护动作、诊断、CLI/rescue 均可用，不自动自我构建修复。

### 3.4 契约、页面、迁移与依赖方向

- **modules 契约**：保留 diagnostics 名称与只读语义，增补 activation/source/revision/completeness；抽出 modules 可见的轻摘要供 mind，owner/Provider 按决定读取详情。共享 `packages/contracts/src/steward/index.ts` 只能由主管实施，本文不改。构建诊断继续逐次校验 build_request，快照不是授权。
- **mind 契约**：note/agenda 增 source/action refs、冷却与关联字段；report 不能仅以“acted”充当动作成功，结果链接实际工具记录。通用网页通过公开工具操作，专门关注面板由 mind 自己向页面服务登记，不让 web 写死 mind 名称/字段。
- **web/MCP**：应用故障页同时展示运行、待验证能力、未解决问题、已采取保护与修复进度；activity 按 failure/connected/verified/paused/rollback 区分措辞并按 cause 聚合；今日只放重要未解决摘要、用户下一步及链接，不塞日志。MCP 保留 diagnostics/activity/today/build 名称，扩展一致字段；不向 owner 暴露 Provider 能力。
- **删除面**：同一交付删除 tick.reflect、reflection 系统模块/专用工具/prompt、反思设置声明、工具 allowlist、活跃 source 创建分支及旧 UI 文案/测试；新行为不保留双开兼容开关。历史 source=reflect 与 activity.session.source 作为存储读取格式保留，不重新调度旧反思会话。
- **迁移**：保留所有既有审计、版本、会话和诊断证据；schema-versioned Audit/agenda 读写即可先落地，不需立即改 SQL 表。若增加索引/投影表需单独数据库迁移。既有自动暂停缺 IDs 无法无损回填，标记待人工选择恢复日程，不自动启用所有 paused 日程。
- **迁移 suggestion ledger**：一次性读取最近 30 天 reflection_suggested，转换为 mind 的来源/主题冷却/已有 build 链接；不复制错误文本或推断成已修复。进行中的 reflect run 应停止/结算，已启动 build 按原预算完成，不取消/重跑 owner build；移除写入口后保留历史投影。
- **迁移偏好**：reflection.enabled 与 mind.enabled 曾独立，不能简单 OR 后扩大主动性；关闭主动行为优先，冲突组合待用户选择。定制 mind/web 不被发行内置覆盖，须合并到活动定制版；这是实施发布步骤，不是本文授权部署。
- **依赖理由**：应用/关注者 → 通用 modules 事实、schedules/provider/notify/actions；模块提供业务 attention、页面登记，不让内核/通用 UI 认识应用业务。内核只保留真实身份、证据完整性、版本/数据切换、幂等、资源/预算、故障保护等信任根；价值判断、复查/打扰时机和改进目标在可替换 mind/Provider。activity 是审计读模型，不是新判断服务；可信本地前提不变。

## 4. 分步实施与待决定事项

以下是建议提交顺序，不是已执行计划；每步独立可测试，先保持已有行为，切换时不允许两套主动判断同时生效。

| 步骤 | 独立提交范围与验收 | 规模 / 风险 |
| --- | --- | --- |
| 1 | 固化现状表驱动测试；统一自动/手动暂停记录和恢复日程 IDs，标明历史不可恢复归属；测三败、版本过时、手动暂停日程、未知调用不重放 | S / 中：恢复语义敏感 |
| 2 | 统一失败归属/连续失败策略，incident 增 activation/revision；旧记录只读明确标记；测同 hash 再激活、重启后计数、mismatch、真实退出重复观察不双计 | M / 高：影响重启/熔断，不能削弱现有安全回滚门槛 |
| 3 | 提供统一只读摘要与 open 问题分页，diagnostics 复用；测 current/history、部分验证、截断、unobserved、workspace 与 build 目标约束、脱敏；无 Provider 调用 | M / 中：契约和查询成本；主管改共享契约 |
| 4 | mind 加来源关联/冷却/构建关联及 revision 判断，扩展 agenda 数据版本；在假内核中测重复故障、新恶化、修复中、拒绝、首次接管、配额。此提交不切换 reflection | M / 中：重复处理或漏处理，需文件升级/回退测试 |
| 5 | 公共 build admission 加通用 cause 去重与结果关联；测不同会话同因并发、旧工作结束后重评估、owner key 重放不重试、timeout/提交额度 | M / 高：不能错误合并用户授权或影响 owner 单次约束 |
| 6 | 一次性迁移冷却/偏好、结算旧 reflect 后启用 mind 健康关注；同提交删除 reflection 的运行/工具/设置/提示词及被替代测试，只保留历史存储读取。测各种旧开关组合、未完成 build、无 mind/无 Provider 降级 | L / 高：切换漏提醒/扩大主动性；偏好冲突必须先决定 |
| 7 | activity 修正转换措辞，web/MCP/today 读统一事实与关注；mind 自登记可选面板；测空/加载/错误/待验证/未解决/恢复，1440×900、1024×768、390×844 无横向滚动，MCP/CLI 离线仍可诊断 | M / 中：用户理解和跨入口一致性 |

步骤 1–5 使用定向 Bun 测试与假 Provider/临时数据库；切换步再做相关集成和类型检查；UI 步做真实浏览器验证。任何测试不得调用真实模型/QQ，也不得触及真实数据。本次设计任务未运行这些行为测试。

**需要用户选择（推荐项不是既有授权）：**

1. **自主构建权**：A 保持现有自主改进范围，统一由 mind 唤醒 Provider 普通 build（推荐）；B 健康问题仅提示，由用户明确启动 owner build。二者都保留确定性自动回滚/暂停，迁移/凭据确认不变。
2. **故障通知归属**：A 暂停/回滚失败保留确定性最小通知＋mind 只补新结论（推荐）；B 所有非审批提醒都经 mind（mind 故障时可能无提醒）。两项均只通过 notify 投递。
3. **额度**：A 沿用 mind 默认 6 wakes/24h＋公共构建日预算，不设周硬上限（推荐）；B 新增通用自主修复周额度，需给定次数和周界/滚动窗口；C 每次修复构建均要求确认。不能称现有代码已有周上限。
4. **开关迁移**：A 仅旧 reflection 与 mind 都启用时自动接管，其他组合保持较保守状态并请用户选（推荐）；B 强制统一为某个明确新开关值。不得把 reflection 关闭用户自动升级成自主修复。
5. **诊断可见性**：A 按当前 trusted-local 实现，保留模块可读脱敏详情（最少契约变化）；B 普通模块仅轻摘要，详情限 owner/Provider，build 仍按目标授权。B 是用途/隐私边界，不是 OS 安全隔离，需调整 visibility 及说明。
6. **输出 mismatch 与熔断**：A 作为独立契约问题供关注，不计进程三败（推荐）；B 连续三次真实契约失败同样熔断，需统一计数和明确 UI 原因。无论何者都不得标能力验证成功。

**未确认/剩余风险**：未读生产数据、活动定制版本、journal 或真实运行时序，未做性能/并发/浏览器/测试执行；未逐行审计所有构建检查、Provider 适配器、notify 内部预算和历史迁移文件。提案中的线上频率、迁移数据量、旧自动暂停恢复 ID 可得性均需实施前只读核实；不以源码分析冒充部署或测试结果。
