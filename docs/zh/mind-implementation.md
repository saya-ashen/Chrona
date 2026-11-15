# Mind 普通可选应用实施与验收记录

> 当前状态：Coding 与 coding-web 已退役，包含旧 work-v2；当前 Chat 独立拥有会话与执行记录。本文的 Coding/Editor 接口、源码路径、验收和部署描述仅作历史记录，不是现行接入指引。详见[Coding 退役说明](coding-retirement.md)。

## 2026-11-15：真实任务反馈后的任务入口与执行效率（已部署，恢复阻塞已修复）

- Chat 增加持续任务入口，读取 Mind 现有事项、成果、操作和交付记录；跨 Run 保持事项 ID，关联仍可用的原始会话。补充要求、暂停、继续复用已有控制回执，未知结果核对原请求；原会话暂不可读不阻止查看任务。Mind 使用派生可读标题，技术身份可展开，等待用户不显示为完成。
- 正常进度、下一步、成果、责任释放不再改变交付授权摘要；目标、范围、验收、来源和用户控制仍参与授权。已撤回但结果未知或已有回执的交付继续进入接续上下文，保留原始身份。
- Prompt 只描述实际选择的能力，共享应用身份，保留发现工具和必要交付材料。15 应用、121 项真实工具说明的 fixture：理解 34904→9364 字符，首次任务 47201→18604，两次接续 50882→21980、51891→22989。此为相同上下文的序列化字符对比，不是线上 token 或费用承诺。
- 已审核 apps.overview 可按目标投影，明确标记省略信息并保留原始清理后回执。完整视图具有独立稳定引用，独立核验需同时核对原动作和实际读取。省略内容不算已验证，未匹配不能证明目标不存在。
- Web 取消组件工具名称数量上限，保留格式、重复声明和真实调用身份检查；HTTP 失败保留结构化错误码，避免确定拒绝仍锁住任务操作。离线登记 helper 支持应用断开清理。
- 用户随后明确授权部署到 chino；已部署 `0.9.32-real-task-20261115`。实际 `/proc/2851949/exe` 为 `/nix/store/pidnylrigb3366m1y6mrm2zs7h1sjmid-chrona-0.9.32-real-task-20261115/libexec/chrona/chrona`，只切换 Chrona 服务，未激活整机 flake。内核及原生进程 helper 与上一包不同，均已重新构建；Author 的 16 项明确材料与线上一致，未更新。
- 活动版本：Mind `1c0e5a557abbca812b0d10248373056d0056d052`、Chat `705b65e5f4753d36f7c3753b28d03283f048adc9`、Web `c17e3357809bc0c18137753c839c17c27d63b7ba`。官方更新保留 Git 合并历史，候选 commit 与发行 seed 不同；已核对发行 ancestry、完整 tree、实际材料字节（Mind 73、Chat 46、Web 114 项）、完整 schema 解析清单、持久安装回执及 activeHash。不是只根据 CLI exit 0 判定成功。
- Author 仍为 `9cc0b01461f0116b116d492316984c70b88a2152`，用户改进的 apps 仍为 `477b950e8aed71b78ed8480ed73e000d0b0a1e9c`；pi、notify、qq、mcp 与部署前的身份、活动 hash 和启用状态相同。九个应用均 active，既有审批身份与状态未改。
- 在实际排空后停服，冷备份为 `chino:/var/lib/chrona-pi/backups/20261115-real-task/before.db` 及 `.tar`；另保留 `20261115-real-task-r3/` 和 `20261115-real-task-runtime-repair/` 两组同名文件。三组数据库 quick_check=ok，tar 全部成员已逐字节读取并核对长度；备份工具排除两个历史 Bun 缓存链接。
- 首次回执核验把合并 commit 错当成必须等于 seed，触发回滚并恢复旧服务。恢复工具按设计省略可重建依赖，旧 store 启动未补装，导致五个原启用应用因缺少 zod／@chrona/pi 自动暂停。已再次排空停服、备份，按原锁文件冻结安装依赖且不执行安装脚本，核对全部批准材料未变，再通过正常 enable 流程恢复原状态。最终服务 active/running、NRestarts=0，`/health`、`/ready`、本机带 Host 首页均 200，Pi available=true；开发机公网及真实 Chrome 首页 200，服务器直接访问公网仍为 403。
- **剩余阻塞**：受支持的回滚恢复生成了新的恢复标记，Mind 正常触发“恢复数据需要你核对”，暂停学习与后台行动。只读 Chat task-view 到达 Mind 后返回 `RESTORE_BLOCKED`，Chat 转发该错误发生事件超时（只读 invocation `146941c1-2da2-4864-83c4-4b7a8a3aa44d` 结果 unknown）。没有替用户重新授权恢复数据，也未修改用户任务或审批；因此任务列表的生产端到端验收未通过。
- 页面登记核对成功：Chat 17 项组件工具包含 task-view/task-control，Mind 和 Chat 实际登记 JS/CSS 与新包逐字节一致。真实 Chrome 三尺寸（1440×900、1024×768、390×844）用生产登记组件及只读 API 快照验证任务入口、两个可读 Mind 标题、技术详情和恢复提示，无横向溢出；工具错误在本地隔离，不能等同于已登录生产壳页或真实任务链路验收。
- 部署证据与脚本在 `.tmp/real-task-20261115/verification.json` 及 chino 的 `/home/saya/.local/share/chrona-deploy/real-task-20261115/`。保留全部工作区 dirty，未 commit/push，未主动创建付费模型任务。既有 39 个关联测试文件、TypeScript、最终 guardrails 和最后 78 测试／602 断言通过；全 lint 仍因 835 项存量 errors 失败，未放宽检查。真实 token、费用及首次交付成功率未验证。

- **21:36 部署收尾修复**：主协调核对第一次停服备份与当前 Mind 数据，retraction、pursuit、understanding、feedback 逐项相同；备份到恢复期间服务停止，未发现遗漏的遗忘或任务修改。通过正式 recovery 接口核对当前 restoreId/visibilityRevision 后确认本次恢复，未直接改数据库或删除标记。返回 blocked=false；随后实际 Web→Chat→Mind task-view 成功返回 3 个事项（waiting、ended、ended），health/ready 与 Provider 正常。此前任务查询受阻的记录为已解决历史；未执行任务控制或新建模型验收任务。证据 `.tmp/real-task-20261115/evidence/recovery-repair-verification.json`。

## 2026-11-15：持续交付优化部署 chino

- 最终运行包 `0.9.31-mind-closure-r3-20261115`；实际进程路径核对一致。Mind `d0bdefcf8ce50694038ff5a903ad28fce8d3d5cb`、Author `9cc0b01461f0116b116d492316984c70b88a2152` 均 approved/active；其余七个应用身份和活动版本保持不变。
- 部署首次发现 Mind 42 项 uses 被旧 `.max(40)` 拒绝。按用户明确要求删除 uses 数量上限，不改成更大的固定上限；保留单项接口格式。完整 Mind 清单及 200 项合法依赖测试通过，生成合同同步。最终类型和 guardrails 复验通过；部署期间统一 verify:slice 四项通过、33 个关联文件通过。
- 冷备份分别在 `chino:/var/lib/chrona-pi/backups/20261115-mind-closure/` 和 `20261115-mind-closure-r3/`，含 before.db 与完整配套 tar；数据库 quick_check=ok。备份工具报告排除两个历史 Bun 缓存链接，未删除实际用户数据。
- 本机健康、就绪、Host 指定首页及开发机访问公网首页均 200；服务器直接访问公网域名返回 403，开发机公网访问正常。Pi provider_available。未主动创建模型验收任务；服务重启后既有后台任务可按原配置自动恢复。
- 部署记录 `.tmp/mind-closure-r3-20261115/verification.json`；chino 同名目录 `/home/saya/.local/share/chrona-deploy/mind-closure-r3-20261115/` 保存包、服务声明、安装回执与记录。此次只切换 Chrona systemd 单元，未激活整机 NixOS 配置。真实任务质量等待用户测试后复盘。

## 2026-11-15：Mind 与 Author 持续交付收敛（工作区实现，未部署）

本轮围绕“应用反馈 → 当前 Run 修改 → 交付 → 独立核验 → 继续修复”修改核心链路，不能据此声称最终产品目标或完整真实使用验收已经完成。

- **可接续开发**：工作执行窗口统一十分钟；已有成果、材料路径、原回执与失败原因进入下一次上下文。新成果可推进同一事项，核验失败和确定提交失败采用既有三次尝试与一分钟／五分钟间隔；重复正文换 ID 不算进展。最终进展优先于早期 checkpoint；用户、权限、外部及 Provider 等待在能力变化后也保持等待，明确 resume 后才继续。
- **交付恢复**：发送前失败与候选拒绝释放阻塞；仅原提交的 `not_dispatched` 或 `submission_refused` 证明可把未知转为失败。回执查询 not_found、传输丢失、解析异常均不能代替该证明。kernel 复用原 invocation 持久记录防止同 key 并发发布推翻拒绝证明，未增加数据库状态。关闭 autoSubmit 仍核对既有交付，不重新提交。
- **实际可用工具与成果**：Mind 开发工具补齐 Author import/validate 和自身 artifact。大文档按实际 JSON/UTF-8 预算分段，核验必须取得全部真实段落；完整读取加 verdict 仍受工具次数预算约束。Agent detail 返回索引，owner 与页面保留全文。接续正文预算按 JSON 转义后大小计算。
- **Author 材料开发**：prepare 返回可保存的验收工作单；stage 复用结构核验。validate 按声明顺序运行支持的测试，测试在精确材料副本执行，避免污染原摘要；没有测试时返回未运行，不伪造通过。依赖完整 SDK、外部包的测试仍须在已准备工作区或 kernel harness 运行；结构校验不能代替真实运行验收。
- **页面**：列表与详情支持“提交失败”“交付已被拒绝”；拒绝详情可查原回执。构建产物在真实 Chrome 的 1440×900、1024×768、390×844 尺寸通过详情与查询检查，工具为隔离替身，并非生产链路验收。证据位于 `.agent-artifacts/mind-integration-hygiene/`。
- **验证范围**：增加真实应用入口、临时 SQLite、SDK 子进程、状态机反例及材料副本测试；独立审查发现的最终等待覆盖、转义超限和能力变化绕过等待均补回归。未调用真实模型，未访问或迁移生产数据，未部署、提交或推送。最终 `bun run verify:slice` 四项全部通过：lint 无新增 warning/error、全项目 TypeScript 零错误、全部 guardrails 通过、33 个关联测试文件通过。Author 另有 32 项材料与工作流测试通过；页面定向 26 项通过。最终统一检查日志为 `/tmp/mind-verify-final.log`。

## 2026-11-15：真实读取链路修复（0.9.30 已部署）

- 工具目录直接沿用已提交的输入合同，不再在 `anyOf` 外层追加 `additionalProperties: false`；合法 `modules.receipt({receiptId})` 不再被包装层拒绝，各分支原有字段校验保留。
- 删除 Mind 应用读取额外的 32 KiB 拒绝上限，保留 JSON 验证、凭据脱敏、精确应用版本及异步授权复核。真实来源撤回仍清理其派生成果；无关会话遗忘导致的全局版本变化不再清除其他事项的回执，新核验可以复用仍可读的原成果。
- Pi 对短模型名核对真实 model ID，对完整模型名继续核对 provider/model；修复合法短名必然被误判为模型不匹配的问题，不修改用户默认 Profile 或模型配置。
- 8 个相关测试文件 156 项通过；Pi 28 项通过，包含短模型名失败复现及真实不同模型仍拒绝的回归。最终工具目录两文件 44 项复跑通过。源码 TypeScript 检查通过；根目录完整检查因纳入 `.tmp`/`plans` 历史副本而耗尽 6 GiB 堆，改为临时配置检查 apps/packages/scripts/build/prisma 源码，借用已有 Chat `happy-dom` 类型，未改依赖。定向 lint 无 error，保留已有 warning。
- `chino` 已部署 `0.9.30-mind-chain-20261115`，Mind `29ddd5b97b97c86be07a8fb3198cd286167329d5`、Pi `48b63f628f4b14360ce1bac13746fd88a0328e81`；线上受检构建、类型检查与数据连续性通过，其他七应用不变，实际进程与新包二进制一致。
- 原事项自动接续：Run `b0135b7c-20d6-40cc-ae23-270de16b0d1f` finished/confirmed，实际回执查询成功，完整应用读取约 37 KB，进展已应用、负责人已释放。原 v2.7 候选是 rejected/approvalId=null，不能再报告为待审批；原安装业务目标并未因此完成。
- 第二条接续 Run `c96bd9ba-75c9-4609-b62b-5831d71f4891` 同样 finished/confirmed，新的约 37 KB 读取成功；两条进展均 applied，负责人均释放，回执未被后续同步清除。当前等待已变为具体外部证据：旧拒绝候选的审批审计，以及当前实际活动版本的宿主页面验收；不再是读取超限或工具参数拒绝。
- 停服完整备份：`chino:/var/lib/chrona-pi/backups/20261115-mind-chain/before.db` 及 `.tar`，SQLite quick_check=ok；仅遗漏两个可重建 Bun 缓存符号链接。旧逻辑已经清除的正文未伪造恢复，需真实重读。未提交、推送或修改应用中心、凭据及其他应用配置。未新增真实小模型测试调用，不以假进程回归证明线上小模型已成功运行。
- 本轮生产代码切片：工具目录净增 1 行，Mind 读取净减 2 行、核验条件净增 0 行，Pi 模型匹配净增 1 行；生产代码总行数不增加。证据目录 `.tmp/mind-chain-20261115/` 与 `/tmp/chrona-mind-chain-*.log`。

## 2026-11-15：来源同步与旧执行恢复修复（已部署线上）

- Chat 的 `snapshot.objectRef.kind` 声明补充真实存在的 `execution`，修复执行结果在路由校验阶段被拒绝、Mind 持续停留 `source_rebuilding` 的问题。来源集成测试现在同时校验 Chat 的工具输入声明。
- Mind 从持久化的真实 `agent.read` 终态、非活跃且事件读完的观察恢复旧负责人；不把旧版本上下文查不到当成停止证明，也不重放旧动作。未知工具副作用仍占用执行槽，必须继续查询原回执。
- 来源调用错误增加工具名与有界错误码诊断，不记录输入、来源正文或凭据。
- 不可读、已撤回或不属于当前事项的结果不能降为“无附件进展”后继续采信；候选改为明确等待核实并释放已停止的负责人。已处理的进展回执重放不再次应用，避免在结算阶段反复报绑定不匹配。
- `chino` 已更新为 `0.9.29-mind-settlement-20261115`：Chat `0c209bd1f6d05949b34e75b17177b0e8a92ed52b`、Mind `eb4635161677b7f0b0745bb41eff505d26b108e5`。Chat 保留线上已有源码与制品，仅更正上述声明；内核及其他应用未改。
- 定向来源、观察、执行测试通过；执行恢复回归 42 项、最终运行时回归 17 项（包含不可读及重复进展回执）与严格类型检查通过。线上受检构建和数据连续性检查通过；来源已恢复完整，旧负责人已释放，原有后台策略已启动新的真实执行。长期模型质量需另行核对。
- 线上真实执行 `f95877dd-5e70-444b-bcb0-b0c38d0c5e9e` 已完成并正常结算：无效旧回执对应事项进入 `waiting/verification` 且不再占用负责人，另一事项继续后台执行。新版本观察期没有来源同步、上下文恢复或结算重试错误；旧回执不可用的诊断仍保留，不恢复其可见性或冒充成功。整理模型配置未改，尚未验证小模型实际调用。
- 各阶段停服完整备份位于 `chino:/var/lib/chrona-pi/backups/20261115-mind-repair/`、`20261115-mind-terminal/`、`20261115-mind-settlement/`，各含 `before.db` 和配套 `.tar`；未直接修改线上数据库。
- 本次修复相对上一部署的代码与测试切片：来源同步净增 5 行（含 Chat 声明），执行结算与恢复净增 53 行；未增加依赖。

## 2026-11-15：应用进化与页面重组（已部署线上）

- Mind 交付支持已有普通应用的精确版本更新；新增与更新复用同一材料和生命周期路径，准入证明、目录与回执均绑定基线。自更新仍由外部生命周期排空和切换，不由运行中的 Mind 自行替换。
- 可选整理模型仅筛选应用操作，用户消息和纠正直接进入主模型；失败回到原始记录，暂缓事件每日或手动复查，费用未知时不伪造计量。整理与主工作共用原执行队列和预算。
- 新增有界 `mind.observe` 应用自报来源；真实 caller 绑定身份与版本，不赋予动作权限。现有 Chat 来源继续使用原同步机制，其他应用需实际接入。
- Mind 页面按概览、改进、理解与反馈、设置拆分；Web 提供带应用、版本和路径的用户反馈入口。候选、审批、启用及效果分别呈现；完成后可反馈仍未解决并重新打开原事项。
- 已部署 `chino` / `https://chrona.saya.love`，发行版本 `0.9.26-mind-evolution-20261115`；Mind 激活版本 `65f798f432e2fa8776bcf8cc0d8153e934af561b`，Web 激活版本 `8c69af2134fa3e0397fb0473a4edbff4773df94d`。两者的线上受检构建、类型检查、生命周期测试和数据连续性检查通过，其他应用及内核未变。
- 停服完整备份位于 `chino:/var/lib/chrona-pi/backups/20261115-mind-evolution/before.db` 及配套 `.tar`；SQLite 完整性通过。服务恢复后健康、就绪、未登录鉴权和跨源拒绝检查通过；既有 40 个执行均已结束，本次未启动真实模型。
- 开发阶段三尺寸浏览器检查通过；本次线上登录后页面验收因浏览器连接工具错误未完成。部署不代表已验证真实模型效果或长期智能质量。细节见应用 README。

## 2026-11-14：原会话跟进状态

本节记录当前 CoreMind/Chat 增量；下文 2026-11-09 的旧工具、存储和实例验收是历史，不是当前合同。

- `mind.updates` 是普通应用间只读工具，只接受实际绑定的 Chat caller。Chat 传原会话 ID 及当前来源 `epoch/scopeRevision`；Mind 必须已有对应完整 checkpoint，才返回同一来源、同一原会话的目标、阻塞和下一步。所有支持/反对证据仍须可读、未撤回、未过期且来源覆盖完整；恢复待审时不公开内容。
- 来源范围变更后，即使关闭学习又立即开启，也不能在 Mind 尚未同步撤回时重新展示旧状态。Chat 在异步读取后复核来源版本；私密、排除和全局关闭继续阻止查询。状态最多八项，按最终投影 UTF-8 字节限制到 16 KiB，不把源消息正文计入状态预算。
- Chat 将结果放在原会话独立的 `role=status` 区域，不伪造消息、不写 observation、不启动模型，也不依赖外部 Notify。后台刷新使用 `read(observe:true)`，只观察已有执行，不恢复或补发未知命令。
- 通用交付指引要求真实 owner 入口对已授权任务使用精确 Author、targets/baselines 和固定回执完成候选交接；不能等待并不存在的外部协调者，也不产生自审批或自动安装权限。真实阻塞应记录具体负责方与下一步，候选提交或 Run 完成不等于用户目标完成。

部署、真实使用结果与检查证据分别记录在 `plans/030-application-center/`；本节描述合同，不把旧隔离验收当作当前模型质量证明。

日期：2026-11-09。**当前状态：实现与隔离验收完成，已部署到本地 3112 实例。** 当时 Mind 已安装并激活，自动检查和通知均保持关闭。新安装现在默认预装 Mind 并开启后台照看，通知默认关闭（仅网页）；现有实例保留已有选择。

2026-11-10 的新内核源码适配见[普通应用迁移记录](application-migration.md)。本页的本地部署与真实实例状态只指上述 2026-11-09 版本；本工作分支后续的持久工具结果和分页游标改动尚未部署。2026-11-11 的持久 timer、恢复提示与隔离验证见[持续关注与恢复](continuous-steward-journey.md)。

Mind 是 `external/mind` 中的普通默认预装应用，新安装默认开启后台照看、默认不推送（仅网页）。整应用暂停名单仅保留 Remind。Agent 仍是唯一不可替换的 builtin 应用，Pi 仍是唯一内置 Provider；本轮没有新增内核公开工具。恢复 Mind 不增加离线来源数量，发行仍包含 13 个来源。

本轮使用新临时数据，不迁移旧 Mind 数据。发现旧 `agenda.json`、`decisions.json`、`state.json` 时明确拒绝，等待用户决定。没有恢复旧 `wakeProvider`、内核日历、全局聊天或内容读取接口。

## 行为与边界

- 关注项支持项目分组、目标、优先级、截止时间、预期进展、复查、暂缓和精确等待条件。来源模块身份来自真实 caller；事件、引用、线程、发送者、域及辅助文本共同匹配。关联只触发核实，不自动完成关注项。
- 来源通过已认证模块调用 `signal` 推送事件或有界摘要。尚未实现主动拉取来源的读取适配器。链接只保存来源、引用、版本、核实时间和结论，不提供调用权限。
- 未匹配消息进入有界每日复查。建议必须经用户接受才成为关注项；不按每条未匹配消息立即唤醒。
- 反馈区分新证据、进展、内部工作、重复、不可用、用户可见结果。不可用不记作负反馈，不推进成功检查或证据消费标记。独立重试等待从一小时退避至最多 24 小时；新的证据或关注项修订可触发重新检查。
- 低优先级重复消息仅在足够近期样本及衰减规则满足时延至每日复查。明确用户事项、截止时间和关键事项不受这种反馈抑制。
- 新安装配置默认 `enabled: true`、`notifyEnabled: false`，结果仅显示在今日页和应用页；已有配置不被覆盖。普通后台检查受间隔、静默时段和每日预算约束；手动检查明确发起前台工作，仍受 Agent 和内核治理约束。

## 权限与工具

| 受众 | 工具 | 约束 |
| --- | --- | --- |
| owner 路由 | `ui-agenda`、`ui-dismiss`、`decisions`、`note`、`check`、`ui-settings` | 内核先验证当前批准的 owner 调用身份，入口只对这些路由传内部准入事实；Web 保留真实 module caller 和请求回执作用域 |
| 模块推理 | `agenda`、`propose`、`report` | Agent 只选择这三个 Mind 工具；普通来源不能读取私有 agenda，提交建议不等于修改关注项或产生可信报告 |
| 来源模块 | `signal` | 来源名称和 moduleId 取真实身份，输入不能伪造 caller；来源只能引用自己的信号提出建议 |

`propose` 只产生待确认建议，拒绝用旧 action/id 参数执行 owner 删除。用户忽略建议走独立 `ui-dismiss`。授权在回执重放之前核对。SDK 使用带代码的错误，保留 `invalid`、`forbidden`、`conflict`、`capacity`；输入、输出及持久化状态均有本地严格 schema 校验。

关注项及决策返回完整记录的有界分页，实际计算 UTF-8 编码的 `{result: ...}`，上限 230 KiB。`nextCursor`、`limited`、`total` 明确表示后续页；游标绑定状态修订，数据变化后须回到第一页。主页面提供第一页、下一页及部分结果提示。决策列表不返回提示词、启动请求键和内部报告候选。

## 持久化和真实结果

私有 `mind-v1.json` 采用严格版本 schema、串行事务、0600 文件、文件 fsync、原子替换及目录 fsync。状态损坏、权限异常、未知 schema 或不确定落盘均失败关闭，不清空重建。请求键对应精确参数和持久化回执，未知结果不换键重试。

Agent context/run 的键、提示词、工具选择和关注项修订在调用前落盘。同一时刻只有一个未决推理；重启后核对既有 run，或者以相同键重放创建。未知状态保留原槽位，不另起执行队列。报告最多保留八个候选，只有当前真实 Run 的持久 `tool-result` 事件中匹配成功、完整且未过滤的报告回执，并且 `agent.get` 确认为 finished 才应用；按分页游标事务性保存已读位置和已验证报告，重启不依赖 transcript 尾部。模型文字、失败工具结果、其他 run 和 owner 自述不能证明完成。报告不会自行把关注项状态改为 done。

状态上限 8 MiB；200 关注项、64 待处理建议、512 活跃信号、4096 归档事件身份、256 决策、1024 反馈和 2048 请求回执。失效或被新版本替代的信号可归档，但保护未决执行和待确认建议引用的证据，保留事件去重身份。结束建议可移除，原始请求回执保留。终态提示词按字节压力压缩，并为执行结算预留容量；保留 run 身份、可信报告和未知通知。无法安全回收时明确拒绝新工作。

Notify 为可选依赖。仅验证过且包含实际用户可见信息、证据可用的报告可提出通知；先落盘固定键和未知发送状态。未知发送不自动重复，Notify 接受不等同外部送达。

## 页面

Mind 注册主页面和 `purpose: settings` 设置页，使用现有 Web 声明式组件。设置在应用详情内嵌显示，仍由 Mind 保存。页面覆盖关注项创建编辑、项目、证据、建议接受/忽略、决策、分页、等待及未知状态。数值表单以十进制字符串输入，应用校验范围后保存数字。没有 iframe、中央业务配置表或额外特权 Web 适配器。

## 验收记录

所有验证使用临时数据库和数据目录；重检查通过 `/tmp/chrona-permanent-check.lock` 串行、设置内存上限。计数不累加重试，也不把重叠套件相加。

| 检查 | 当前证据 |
| --- | --- |
| 独立策略回归、后端、运行时失败场景 | 36 pass；`.tmp/mind/runtime-followup-tests.log`，含 21 独立回归及 13 运行时专项测试 |
| UI 与本地离线检查 | UI 12 pass；后端 2 pass，内部 17 个离线场景；`/tmp/chrona-mind-service-focused.log` |
| 最终静态检查 | PASS：`bun scripts/chrona.ts check all`；`/tmp/chrona-mind-static.log`，0 errors、36 条依赖规则 warning |
| 最终受影响 Bun 测试 | PASS：7 文件 61 pass、0 fail；`/tmp/chrona-mind-focused.log`。另在提取私有准入证明后，Agent 工具／路由／Mind 页面 3 文件 51 pass、0 fail，`/tmp/chrona-mind-entry-proof.log`；两组存在重叠，不相加 |
| 完整服务器 API | PASS：19 文件 111 pass、1 skip、0 fail；`/tmp/chrona-mind-api.log` |
| 三种尺寸真实浏览器 | PASS：95 项、0 fail、`sourceDrift: []`；`.tmp/mind/browser-run-1794214050/report.json` 及同目录 `gallery.html` |
| 13 来源和 Linux 发行构建 | PASS：`/tmp/chrona-mind-build.log`，`BUILD_EXIT=0` |
| 真实发行包离线安装、批准激活、页面和重启回执 | PASS：`/tmp/chrona-mind-release-smoke.log`，`SMOKE_EXIT=0`；实际检查安装、批准、页面绑定读取、0600 文件、相同键重放、改参数 409 和重启持久性 |

最终串行入口为 `.tmp/mind/final-acceptance.sh`。浏览器使用真实 Mind/Web SDK 和渲染器，Agent 及有限内核记录为离线替身；真实 HTTP/准入另由生产 Hono、SDK、SQLite 测试和发行包安装冒烟验证。没有真实模型调用、外部账号发送、现有用户数据迁移、部署或 push；此记录不能作为这些事项的验收证明。


## 最终发行与验收补充

- 发行文件：`dist/releases/chrona-linux-x64/chrona`，SHA-256 `ae7af15e474b9e8d46fd8ffc4fc5abfc2c9e77686fae5ca8fce330982ff7d40a`。
- Mind 离线来源 commit：`b2b81b50698486916f9fb06067e860f1a0ab948b`；bundle SHA-256 `12514eb6c2cd72c242e563addfd5f6758e6c0061e0fbbdb8733f7d698e4eada0`。实际安装使用声明的 `zod: 4.3.6` 和锁文件，执行离线冻结安装；不依赖仓库根目录的 node_modules。
- 实际发行安装发现并修复页面 `layout` / `purpose` 的类型扩大问题。先前安装失败的运行保留为失败证据，最终成功来自重新构建后的一套全新临时数据。
- 激活哈希写入早于 activated 处理结束。发行夹具等待激活投递验证完成后才发起独立 owner HTTP 请求，避免将页面注册中的同步环拒绝误当成安装完成后的读取结果；没有绕过或放宽环检测。
- 独立 Agent context 的自身应用工具调用经真实持久化 run、原始模块身份、工具选择、租约、期限和取消状态检查后，才获得精确 origin 的临时宿主证明。证明放在私有叶子文件以避免循环导入；不能从 JSON 参数构造、传给子调用或复用到其他数据库。普通同步自身调用、嵌套环和跨事件等待环继续拒绝。新增准入证明后的专门回归已重新通过。
- 本轮未调用真实模型，未激活现有实例中的 Mind，未迁移旧 Mind 文件，未部署、提交或推送。发行烟雾测试的临时数据在结束后删除。


## 本地部署记录

- 部署完成时间：`2026-11-09T09:03:52.553652+00:00`；实例 `chrona-kernel-preview.service`，端口 `3112`。旧 `chrona-v1-preview.service` 保持停止，3111 未重新启动。
- 已核对实际运行进程的二进制 SHA-256 为 `ae7af15e474b9e8d46fd8ffc4fc5abfc2c9e77686fae5ca8fce330982ff7d40a`，Mind 激活 commit 为 `b2b81b50698486916f9fb06067e860f1a0ab948b`。通过停止服务后的正式检查安装和精确候选批准完成部署。
- 原有应用身份、应用版本、Agent 模型策略、记忆偏好、Notify 设置、内核预算及服务环境文件保持不变；现有数据保留。Mind 使用新的私有数据，未迁移旧实例中的 Mind 文件。
- 部署后核对：9 个应用激活、5 个公开内核命名空间和 32 个工具、MCP 24 个工具、Coding 只读协议、六个应用设置页及页面身份/版本绑定读取、Mind 空白关注列表、鉴权拒绝和 Pi 可用性。Run 总数未增加，未调用真实模型。
- 线上 Chromium 桌面/手机只读检查共 12 项通过，无页面异常、iframe 或横向溢出；报告 `.tmp/mind/live-readonly/report.json`。没有通过浏览器保存或开启自动检查。
- 停机冷备份：`/home/saya/workspace/Chrona/.tmp/kernel-minimization/local-deploy/rollback-mind-20261109T090337Z`，包含部署前的数据、配置和发行文件。
- 部署脚本 `.tmp/mind/deploy-local.py`；机器记录 `.tmp/mind/local-deployment.json`；日志 `/tmp/chrona-mind-local-deploy.log`。前文“未部署”描述限定为隔离验收阶段，此节记录随后明确授权的本地部署。
